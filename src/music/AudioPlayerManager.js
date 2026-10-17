import {
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
} from '@discordjs/voice';
import { existsSync, accessSync, constants } from 'node:fs';
import { join, resolve, extname, basename } from 'node:path';

export const SUPPORTED_EXTENSIONS = Object.freeze([
  '.mp3',
  '.wav',
  '.ogg',
  '.opus',
  '.flac',
  '.m4a',
  '.aac',
  '.webm',
]);

/**
 * Validates and resolves a filename against the audio directory.
 * Prevents path traversal and checks file existence and permissions.
 *
 * @param {string} filename
 * @param {string} [customAudioDir]
 * @returns {string} Absolute resolved file path
 */
export function resolveAudioFile(filename, customAudioDir) {
  if (!filename || typeof filename !== 'string') {
    throw new Error('A valid filename string must be provided.');
  }

  const trimmed = filename.trim();

  // Reject path traversal characters and directory delimiters
  if (
    trimmed.includes('..') ||
    trimmed.includes('/') ||
    trimmed.includes('\\') ||
    trimmed.includes('\0')
  ) {
    throw new Error('Invalid filename: Path traversal or subdirectories are not permitted.');
  }

  const ext = extname(trimmed).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    throw new Error(
      `Unsupported audio format "${ext}". Supported formats: ${SUPPORTED_EXTENSIONS.join(', ')}`
    );
  }

  const audioDir = resolve(customAudioDir || join(process.cwd(), 'audio'));
  const fullPath = join(audioDir, basename(trimmed));

  // Ensure resolved path is strictly within the audio directory
  if (!fullPath.startsWith(audioDir)) {
    throw new Error('Invalid filename: Path traversal is not permitted.');
  }

  if (!existsSync(fullPath)) {
    throw new Error(`Audio file "${trimmed}" was not found in the audio directory.`);
  }

  try {
    accessSync(fullPath, constants.R_OK);
  } catch {
    throw new Error(`Audio file "${trimmed}" exists but is not readable.`);
  }

  return fullPath;
}

/**
 * AudioPlayerManager manages audio players per guild.
 * Handles playback, pausing, resuming, stopping, and resource cleanup.
 */
export class AudioPlayerManager {
  constructor() {
    /**
     * Map of guildId -> { player, connection, subscription, currentTrack, resource }
     * @type {Map<string, { player: import('@discordjs/voice').AudioPlayer, connection: any, subscription: any, currentTrack: string|null, resource: any }>}
     */
    this.players = new Map();

    // Internal delegates to facilitate testing and mocking
    this._createAudioPlayer = () =>
      createAudioPlayer({
        behaviors: {
          noSubscriber: NoSubscriberBehavior.Pause,
        },
      });

    this._createAudioResource = (path, options) =>
      createAudioResource(path, options || { inputType: StreamType.Arbitrary });
  }

  /**
   * Retrieves or creates an AudioPlayer for a given guild.
   *
   * @param {string} guildId
   * @param {import('@discordjs/voice').VoiceConnection} [connection]
   * @returns {object} Guild audio entry
   */
  getOrCreatePlayer(guildId, connection) {
    let entry = this.players.get(guildId);

    if (entry) {
      if (connection && entry.connection !== connection) {
        if (entry.subscription) {
          entry.subscription.unsubscribe();
        }
        entry.subscription = connection.subscribe(entry.player);
        entry.connection = connection;
      }
      return entry;
    }

    const player = this._createAudioPlayer();
    let subscription = null;
    if (connection) {
      subscription = connection.subscribe(player);
    }

    entry = {
      player,
      connection,
      subscription,
      currentTrack: null,
      resource: null,
    };

    // Attach lifecycle listeners
    player.on(AudioPlayerStatus.Idle, () => {
      entry.resource = null;
      entry.currentTrack = null;
    });

    player.on('error', (error) => {
      console.error(`[AUDIO PLAYER ERROR] Guild ${guildId}:`, error?.message || error);
      entry.resource = null;
      entry.currentTrack = null;
      try {
        player.stop(true);
      } catch {}
    });

    this.players.set(guildId, entry);
    return entry;
  }

  /**
   * Plays a local audio file in the specified guild.
   *
   * @param {string} guildId
   * @param {import('@discordjs/voice').VoiceConnection} connection
   * @param {string} filename
   * @returns {{ track: string, resolvedPath: string }}
   */
  play(guildId, connection, filename) {
    const resolvedPath = resolveAudioFile(filename);
    const entry = this.getOrCreatePlayer(guildId, connection);

    const resource = this._createAudioResource(resolvedPath);
    entry.resource = resource;
    entry.currentTrack = filename;

    entry.player.play(resource);

    return {
      track: filename,
      resolvedPath,
    };
  }

  /**
   * Plays a resolved online audio track in the specified guild.
   *
   * @param {string} guildId
   * @param {import('@discordjs/voice').VoiceConnection} connection
   * @param {{ title: string, streamUrl: string, webpageUrl?: string, duration?: number|null, uploader?: string }} track
   * @returns {{ track: string, trackData: object }}
   */
  playTrack(guildId, connection, track) {
    if (!track || !track.streamUrl) {
      throw new Error('A valid track object with streamUrl is required.');
    }

    const entry = this.getOrCreatePlayer(guildId, connection);

    const resource = this._createAudioResource(track.streamUrl);
    entry.resource = resource;
    entry.currentTrack = track.title || 'Online Track';
    entry.trackData = track;

    entry.player.play(resource);

    return {
      track: entry.currentTrack,
      trackData: track,
    };
  }

  /**
   * Pauses the current track for a guild.
   *
   * @param {string} guildId
   * @returns {{ success: boolean, reason?: string, track?: string }}
   */
  pause(guildId) {
    const entry = this.players.get(guildId);

    if (!entry || !entry.currentTrack || entry.player.state.status === AudioPlayerStatus.Idle) {
      return { success: false, reason: 'NOT_PLAYING' };
    }

    if (entry.player.state.status === AudioPlayerStatus.Paused) {
      return { success: false, reason: 'ALREADY_PAUSED', track: entry.currentTrack };
    }

    entry.player.pause();
    return { success: true, track: entry.currentTrack };
  }

  /**
   * Resumes playback for a paused guild.
   *
   * @param {string} guildId
   * @returns {{ success: boolean, reason?: string, track?: string }}
   */
  resume(guildId) {
    const entry = this.players.get(guildId);

    if (!entry || !entry.currentTrack || entry.player.state.status !== AudioPlayerStatus.Paused) {
      return { success: false, reason: 'NOT_PAUSED', track: entry?.currentTrack };
    }

    entry.player.unpause();
    return { success: true, track: entry.currentTrack };
  }

  /**
   * Stops playback and releases the audio resource without disconnecting voice.
   *
   * @param {string} guildId
   * @returns {{ success: boolean, reason?: string, track?: string }}
   */
  stop(guildId) {
    const entry = this.players.get(guildId);

    if (!entry || (!entry.currentTrack && entry.player.state.status === AudioPlayerStatus.Idle)) {
      return { success: false, reason: 'NOT_PLAYING' };
    }

    const prevTrack = entry.currentTrack;
    entry.player.stop(true);
    entry.resource = null;
    entry.currentTrack = null;

    return { success: true, track: prevTrack };
  }

  /**
   * Returns current playback state for a guild.
   *
   * @param {string} guildId
   * @returns {{ status: string, currentTrack: string|null, isPlaying: boolean, isPaused: boolean }}
   */
  getStatus(guildId) {
    const entry = this.players.get(guildId);
    if (!entry) {
      return { status: 'idle', currentTrack: null, isPlaying: false, isPaused: false };
    }

    const status = entry.player.state.status;
    return {
      status,
      currentTrack: entry.currentTrack,
      isPlaying: status === AudioPlayerStatus.Playing,
      isPaused: status === AudioPlayerStatus.Paused,
    };
  }

  /**
   * Cleans up the audio player and removes guild state.
   *
   * @param {string} guildId
   */
  cleanup(guildId) {
    const entry = this.players.get(guildId);
    if (entry) {
      if (entry.subscription) {
        try {
          entry.subscription.unsubscribe();
        } catch {}
      }
      try {
        entry.player.stop(true);
        entry.player.removeAllListeners();
      } catch {}
      this.players.delete(guildId);
    }
  }
}

export const audioPlayerManager = new AudioPlayerManager();

// Automatically clean up guild audio player when voice connection is destroyed
import { voiceManager } from './VoiceManager.js';
voiceManager.onCleanup((guildId) => {
  audioPlayerManager.cleanup(guildId);
});
