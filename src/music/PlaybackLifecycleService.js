import { performance } from 'node:perf_hooks';
import { EventEmitter } from 'node:events';
import { AudioPlayerStatus } from '@discordjs/voice';
import { trackResolver } from './TrackResolver.js';
import { voiceManager } from './VoiceManager.js';
import { audioPlayerManager } from './AudioPlayerManager.js';
import { config } from '../config/config.js';
import {
  createSuccessEmbed,
  createWarningEmbed,
  createErrorEmbed,
  sendResponse,
} from '../utils/embeds.js';

/**
 * Valid states of a PlaybackOperation
 */
export const PlaybackState = Object.freeze({
  IDLE: 'idle',
  RESOLVING: 'resolving',
  CONNECTING: 'connecting',
  PREPARING: 'preparing',
  PLAYING: 'playing',
  CANCELLED: 'cancelled',
  FAILED: 'failed',
  COMPLETED: 'completed',
});

/**
 * Manages an individual playback operation, its abort controller, owned subprocesses,
 * stage timing, and state transitions.
 */
export class PlaybackOperation extends EventEmitter {
  /**
   * @param {object} params
   * @param {string} params.opId
   * @param {string} params.guildId
   * @param {string} params.query
   * @param {any} params.context
   * @param {'prefix' | 'slash'} params.type
   * @param {Function} [params.logWriter=console.log]
   * @param {boolean} [params.timingEnabled=config.commandTimingLogs]
   */
  constructor({
    opId,
    guildId,
    query,
    context,
    type,
    logWriter = console.log,
    timingEnabled = config.commandTimingLogs,
  }) {
    super();
    this.opId = opId;
    this.guildId = guildId;
    this.query = query;
    this.context = context;
    this.type = type;
    this.logWriter = logWriter;
    this.timingEnabled = timingEnabled;

    this.state = PlaybackState.IDLE;
    this.abortController = new AbortController();
    this.cancellationReason = null;
    this.ownedChildProcess = null;

    this.opStartTime = performance.now();
    this.stages = {};

    // Forward abort signal
    this.abortController.signal.addEventListener('abort', () => {
      if (this.ownedChildProcess) {
        try {
          this.ownedChildProcess.kill('SIGTERM');
        } catch {}
      }
    });
  }

  get signal() {
    return this.abortController.signal;
  }

  get isCancelled() {
    return this.abortController.signal.aborted || this.state === PlaybackState.CANCELLED;
  }

  /**
   * Logs a stage timing measurement.
   *
   * @param {string} stage
   * @param {number} durationMs
   * @param {'success' | 'failed' | 'timeout' | 'cancelled'} status
   * @param {object} [extras]
   */
  logStage(stage, durationMs, status, extras = {}) {
    this.stages[stage] = { durationMs, status, ...extras };

    if (!this.timingEnabled) return;

    let line = `[PLAY TIMING] op=${this.opId} guild=${this.guildId} stage=${stage} duration_ms=${durationMs.toFixed(1)} status=${status}`;
    for (const [k, v] of Object.entries(extras)) {
      if (v !== undefined && v !== null && v !== '') {
        line += ` ${k}=${v}`;
      }
    }
    this.logWriter(line);
  }

  /**
   * Checks whether this operation has been cancelled. If cancelled, transitions state and throws.
   */
  checkCancelled() {
    if (this.isCancelled) {
      if (this.state !== PlaybackState.CANCELLED) {
        this.state = PlaybackState.CANCELLED;
      }
      const err = new Error(this.cancellationReason || 'Playback operation cancelled.');
      err.name = 'AbortError';
      err.code = 'ABORT_ERR';
      err.isPlaybackCancelled = true;
      throw err;
    }
  }

  /**
   * Cancels this playback operation with an explicit reason.
   *
   * @param {string} reason
   */
  cancel(reason = 'Playback operation cancelled') {
    if (this.isCancelled) return;

    this.cancellationReason = reason;
    this.state = PlaybackState.CANCELLED;

    try {
      this.abortController.abort(reason);
    } catch {}

    if (this.ownedChildProcess) {
      try {
        this.ownedChildProcess.kill('SIGTERM');
      } catch {}
    }

    this.emit('cancelled', reason);
  }

  /**
   * Sets the owned resolver child process.
   *
   * @param {import('node:child_process').ChildProcess} child
   */
  setOwnedProcess(child) {
    this.ownedChildProcess = child;
    if (this.isCancelled && child) {
      try {
        child.kill('SIGTERM');
      } catch {}
    }
  }
}

/**
 * PlaybackLifecycleService manages playback operations per guild.
 * Guarantees that only the latest active operation can connect or play,
 * and allows clean, race-free cancellation via leave or newer commands.
 */
export class PlaybackLifecycleService {
  constructor({
    resolver = trackResolver,
    voiceMgr = voiceManager,
    playerMgr = audioPlayerManager,
    logWriter = console.log,
  } = {}) {
    this.resolver = resolver;
    this.voiceMgr = voiceMgr;
    this.playerMgr = playerMgr;
    this.logWriter = logWriter;

    /**
     * Map of guildId -> current PlaybackOperation
     * @type {Map<string, PlaybackOperation>}
     */
    this.activeOperations = new Map();

    /**
     * Monotonic operation sequence counter
     */
    this._opCounter = 0;
  }

  /**
   * Generates a unique operation ID.
   *
   * @returns {string}
   */
  generateOpId() {
    this._opCounter += 1;
    return `play-${Date.now()}-${this._opCounter}`;
  }

  /**
   * Returns the active operation for a guild, if any.
   *
   * @param {string} guildId
   * @returns {PlaybackOperation|null}
   */
  getActiveOperation(guildId) {
    return this.activeOperations.get(guildId) || null;
  }

  /**
   * Cancels the currently active playback operation for a guild.
   *
   * @param {string} guildId
   * @param {string} [reason]
   * @returns {boolean} True if an operation was active and cancelled
   */
  cancelActiveOperation(guildId, reason = 'Voice connection left or stopped') {
    const existing = this.activeOperations.get(guildId);
    if (existing) {
      existing.cancel(reason);
      this.activeOperations.delete(guildId);
      return true;
    }
    return false;
  }

  /**
   * Executes a full playback lifecycle for a query.
   *
   * @param {object} params
   * @param {any} params.context - Discord Message or ChatInputCommandInteraction
   * @param {string} params.query - Song title or URL
   * @param {'prefix' | 'slash'} params.type
   * @returns {Promise<any>}
   */
  async executePlay({ context, query, type }) {
    const guildId = context.guild?.id;
    if (!guildId) {
      const errEmbed = createErrorEmbed({
        title: 'Error',
        description: 'This command can only be used within a Discord server.',
      });
      return await sendResponse(context, { embeds: [errEmbed] });
    }

    const isSlash = type === 'slash';
    const trimmedQuery = query?.trim();

    if (!trimmedQuery) {
      const prefix = config.prefix;
      const warnEmbed = createWarningEmbed({
        title: 'Query Required',
        description: `Please specify a song title or URL to play.\nExamples: \`/play query:Bohemian Rhapsody\` or \`${prefix}play Bohemian Rhapsody\`.`,
      });
      return await sendResponse(context, { embeds: [warnEmbed] });
    }

    const userVoiceChannel = context.member?.voice?.channel;
    if (!userVoiceChannel) {
      const warnEmbed = createWarningEmbed({
        title: 'Voice Channel Required',
        description: 'You must be in a voice channel to play music. Please join one and try again.',
      });
      return await sendResponse(context, { embeds: [warnEmbed] });
    }

    // Check if bot is connected to a different channel in the server
    const botChannelId = this.voiceMgr.getChannelId(guildId);
    if (botChannelId && botChannelId !== userVoiceChannel.id && this.voiceMgr.isConnected(guildId)) {
      const warnEmbed = createWarningEmbed({
        title: 'Already in Another Channel',
        description: 'I am already playing or connected to a different voice channel in this server. Please join my channel or use `/leave` first.',
      });
      return await sendResponse(context, { embeds: [warnEmbed] });
    }

    // Cancel any previous pending playback operation for this guild
    this.cancelActiveOperation(guildId, 'Superceded by newer play command');

    // Create unique operation
    const opId = this.generateOpId();
    const operation = new PlaybackOperation({
      opId,
      guildId,
      query: trimmedQuery,
      context,
      type,
      logWriter: this.logWriter,
      timingEnabled: config.commandTimingLogs,
    });

    this.activeOperations.set(guildId, operation);

    // Record command received and dispatch delay
    const receivedAt = context.receivedAt;
    if (typeof receivedAt === 'number') {
      const dispatchDelay = Math.max(0, operation.opStartTime - receivedAt);
      operation.logStage('command_dispatch', dispatchDelay, 'success');
    }

    // Defer slash interaction to allow time for resolution
    if (isSlash && !context.deferred && !context.replied) {
      await context.deferReply();
    }

    try {
      operation.checkCancelled();

      // Stage 1: Resolver process startup & search
      operation.state = PlaybackState.RESOLVING;
      let resolverStartupStart = performance.now();
      let resolverSearchStart = 0;

      const track = await this.resolver.resolve(trimmedQuery, {
        signal: operation.signal,
        onProcessSpawn: (child) => {
          operation.setOwnedProcess(child);
          const startupDuration = performance.now() - resolverStartupStart;
          operation.logStage('resolver_startup', startupDuration, 'success');
          resolverSearchStart = performance.now();
        },
      });

      const searchDuration = performance.now() - (resolverSearchStart || resolverStartupStart);
      operation.logStage('resolver_search', searchDuration, 'success');

      // Check cancellation post-resolution
      operation.checkCancelled();

      // Verify that this operation is still the active one
      if (this.activeOperations.get(guildId) !== operation) {
        throw Object.assign(new Error('Operation superceded by newer playback request.'), {
          isPlaybackCancelled: true,
        });
      }

      // Stage 2: Voice connection readiness
      operation.state = PlaybackState.CONNECTING;
      const voiceConnectStart = performance.now();

      let connection = this.voiceMgr.getConnection(guildId);
      if (!connection || !this.voiceMgr.isConnected(guildId)) {
        connection = await this.voiceMgr.join(userVoiceChannel);
      }

      const voiceConnectDuration = performance.now() - voiceConnectStart;
      operation.logStage('voice_readiness', voiceConnectDuration, 'success');

      // Check cancellation post-voice
      operation.checkCancelled();

      if (this.activeOperations.get(guildId) !== operation) {
        throw Object.assign(new Error('Operation superceded by newer playback request.'), {
          isPlaybackCancelled: true,
        });
      }

      // Stage 3 & 4: Audio resource creation & Player initialization
      operation.state = PlaybackState.PREPARING;

      const playerInitStart = performance.now();
      const entry = this.playerMgr.getOrCreatePlayer(guildId, connection);
      const playerInitDuration = performance.now() - playerInitStart;
      operation.logStage('player_init', playerInitDuration, 'success');

      const resourceCreationStart = performance.now();
      const resource = this.playerMgr._createAudioResource(track.streamUrl);
      const resourceCreationDuration = performance.now() - resourceCreationStart;
      operation.logStage('resource_creation', resourceCreationDuration, 'success');

      operation.checkCancelled();

      // Stage 5: Actual playback start verified by audio player state transition
      const playStart = performance.now();

      await new Promise((resolvePlay, rejectPlay) => {
        let cleanupListeners = null;
        let settled = false;

        const onStateChange = (oldState, newState) => {
          if (newState.status === AudioPlayerStatus.Playing && !settled) {
            settled = true;
            cleanupListeners?.();
            resolvePlay();
          }
        };

        const onError = (playerErr) => {
          if (!settled) {
            settled = true;
            cleanupListeners?.();
            rejectPlay(playerErr);
          }
        };

        const onAbort = () => {
          if (!settled) {
            settled = true;
            cleanupListeners?.();
            rejectPlay(Object.assign(new Error('Playback cancelled before playback started.'), {
              isPlaybackCancelled: true,
            }));
          }
        };

        cleanupListeners = () => {
          if (entry?.player) {
            entry.player.off('stateChange', onStateChange);
            entry.player.off('error', onError);
          }
          operation.signal.removeEventListener('abort', onAbort);
        };

        if (entry?.player) {
          entry.player.on('stateChange', onStateChange);
          entry.player.once('error', onError);
        }
        operation.signal.addEventListener('abort', onAbort, { once: true });

        // Trigger playback through AudioPlayerManager (honoring mocks or real player)
        try {
          this.playerMgr.playTrack(guildId, connection, track);
        } catch (playErr) {
          if (!settled) {
            settled = true;
            cleanupListeners();
            return rejectPlay(playErr);
          }
        }

        // If player already transitioned immediately (e.g. mock or synchronous event)
        if (entry?.player?.state?.status === AudioPlayerStatus.Playing) {
          if (!settled) {
            settled = true;
            cleanupListeners();
            resolvePlay();
          }
        }
      });

      const actualPlayDuration = performance.now() - playStart;
      operation.logStage('playback_start', actualPlayDuration, 'success');
      operation.state = PlaybackState.PLAYING;

      // Stage 6: Discord response delivery
      operation.checkCancelled();

      const userTag = context.user?.tag || context.author?.tag;
      const successEmbed = createSuccessEmbed({
        title: 'Now Playing',
        description:
          `🎶 [**${track.title}**](${track.webpageUrl})\n\n` +
          `**Duration:** \`${track.durationFormatted}\`\n` +
          `**Channel:** **${userVoiceChannel.name}**\n` +
          `**Uploader:** ${track.uploader}`,
        footer: userTag ? `Requested by ${userTag}` : undefined,
      });

      if (track.thumbnail) {
        successEmbed.setThumbnail(track.thumbnail);
      }

      const responseStart = performance.now();
      const sendResult = await sendResponse(context, { embeds: [successEmbed] });
      const responseDuration = performance.now() - responseStart;
      operation.logStage('response_delivery', responseDuration, 'success');

      // Total operation duration
      const totalOpDuration = performance.now() - operation.opStartTime;
      operation.logStage('total_operation', totalOpDuration, 'success');
      operation.state = PlaybackState.COMPLETED;

      return sendResult;
    } catch (error) {
      const isCancelled = operation.isCancelled || error.isPlaybackCancelled || error.name === 'AbortError';

      if (isCancelled) {
        operation.state = PlaybackState.CANCELLED;
        const totalDuration = performance.now() - operation.opStartTime;
        operation.logStage('total_operation', totalDuration, 'cancelled', {
          reason: operation.cancellationReason || error.message,
        });

        // Do not send a success or late response to Discord
        return null;
      }

      // Genuine failure
      operation.state = PlaybackState.FAILED;
      const totalDuration = performance.now() - operation.opStartTime;
      operation.logStage('total_operation', totalDuration, 'failed', {
        error: error?.message || 'Playback failed',
      });

      console.error(`[PLAY ERROR] op=${opId} Guild ${guildId} Query "${trimmedQuery}":`, error?.message || error);

      const errEmbed = createErrorEmbed({
        title: 'Playback Failed',
        description: error?.message || 'An error occurred while resolving or playing the requested track.',
      });

      try {
        return await sendResponse(context, { embeds: [errEmbed] });
      } catch (replyErr) {
        console.error(`[PLAY ERROR] op=${opId} Failed to send error embed:`, replyErr);
      }
    } finally {
      if (this.activeOperations.get(guildId) === operation) {
        this.activeOperations.delete(guildId);
      }
    }
  }
}

export const playbackLifecycleService = new PlaybackLifecycleService();
