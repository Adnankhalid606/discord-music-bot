import {
  joinVoiceChannel,
  getVoiceConnection,
  entersState,
  VoiceConnectionStatus,
} from '@discordjs/voice';

/**
 * VoiceManager manages Discord voice channel connections on a per-guild basis.
 * Ensures at most one active connection per guild, handles channel transitions,
 * status readiness, and prevents listener leaks.
 */
export class VoiceManager {
  constructor() {
    /**
     * Map of guildId -> { connection: VoiceConnection, channelId: string, channelName: string }
     * @type {Map<string, { connection: import('@discordjs/voice').VoiceConnection, channelId: string, channelName: string }>}
     */
    this.connections = new Map();
    this._cleanupCallbacks = [];

    // Internal delegates to allow testing and mocking
    this._joinVoiceChannel = joinVoiceChannel;
    this._entersState = entersState;
  }

  /**
   * Registers a callback invoked whenever a guild voice connection is cleaned up or destroyed.
   *
   * @param {(guildId: string) => void} callback
   */
  onCleanup(callback) {
    if (typeof callback === 'function') {
      this._cleanupCallbacks.push(callback);
    }
  }

  /**
   * Joins a voice channel or switches to it if already connected elsewhere in the guild.
   * Reuses connection if already connected and ready in the target channel.
   *
   * @param {import('discord.js').VoiceBasedChannel} voiceChannel
   * @param {object} [options]
   * @param {number} [options.timeoutMs=15000]
   * @returns {Promise<import('@discordjs/voice').VoiceConnection>}
   */
  async join(voiceChannel, { timeoutMs = 15000 } = {}) {
    if (!voiceChannel || !voiceChannel.guild) {
      throw new Error('A valid voice channel with a guild reference is required to join.');
    }

    const guildId = voiceChannel.guild.id;
    const existing = this.connections.get(guildId);

    // If already in the target channel and ready, reuse connection
    if (
      existing &&
      existing.channelId === voiceChannel.id &&
      existing.connection.state.status === VoiceConnectionStatus.Ready
    ) {
      return existing.connection;
    }

    try {
      const connection = this._joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: guildId,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        selfDeaf: true,
        selfMute: false,
      });

      // Update mapping immediately
      this.connections.set(guildId, {
        connection,
        channelId: voiceChannel.id,
        channelName: voiceChannel.name,
      });

      // Setup state event handlers with automatic cleanup
      this._setupLifecycleHandlers(guildId, connection);

      // Wait for the connection to reach the Ready state
      await this._entersState(connection, VoiceConnectionStatus.Ready, timeoutMs);

      return connection;
    } catch (error) {
      // Clean up failed connection attempt
      this._cleanupConnection(guildId);
      if (
        error?.name === 'AbortError' ||
        error?.code === 'ABORT_ERR' ||
        error?.message === 'The operation was aborted'
      ) {
        throw new Error(
          `Voice connection timed out after ${Math.round(timeoutMs / 1000)}s waiting to become ready. Please check bot permissions and Discord voice server status.`
        );
      }
      throw error;
    }
  }

  /**
   * Disconnects and destroys the voice connection for a given guild.
   *
   * @param {string} guildId
   * @returns {boolean} True if a connection was found and destroyed, false otherwise.
   */
  leave(guildId) {
    const existing = this.connections.get(guildId);
    if (!existing) {
      // Also check if @discordjs/voice has an unmanaged connection
      const voiceConn = getVoiceConnection(guildId);
      if (voiceConn) {
        voiceConn.destroy();
        return true;
      }
      return false;
    }

    this._cleanupConnection(guildId);
    return true;
  }

  /**
   * Returns the active voice connection for a guild if connected, or null.
   *
   * @param {string} guildId
   * @returns {import('@discordjs/voice').VoiceConnection|null}
   */
  getConnection(guildId) {
    const existing = this.connections.get(guildId);
    if (!existing) return null;
    if (existing.connection.state.status === VoiceConnectionStatus.Destroyed) {
      this.connections.delete(guildId);
      return null;
    }
    return existing.connection;
  }

  /**
   * Returns the channel ID the bot is currently connected to in a guild.
   *
   * @param {string} guildId
   * @returns {string|null}
   */
  getChannelId(guildId) {
    const existing = this.connections.get(guildId);
    return existing ? existing.channelId : null;
  }

  /**
   * Checks whether the bot is connected and ready in a guild.
   *
   * @param {string} guildId
   * @returns {boolean}
   */
  isConnected(guildId) {
    const conn = this.getConnection(guildId);
    if (!conn) return false;
    return conn.state.status === VoiceConnectionStatus.Ready;
  }

  /**
   * Sets up lifecycle handlers on the connection for disconnects and errors.
   *
   * @private
   * @param {string} guildId
   * @param {import('@discordjs/voice').VoiceConnection} connection
   */
  _setupLifecycleHandlers(guildId, connection) {
    // Prevent duplicate handlers if connection is reused
    connection.removeAllListeners('error');
    connection.removeAllListeners(VoiceConnectionStatus.Disconnected);
    connection.removeAllListeners(VoiceConnectionStatus.Destroyed);

    connection.on('error', (error) => {
      console.error(`[VOICE ERROR] Guild ${guildId}:`, error?.message || error);
    });

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          this._entersState(connection, VoiceConnectionStatus.Signalling, 5000),
          this._entersState(connection, VoiceConnectionStatus.Connecting, 5000),
        ]);
        // Reconnection succeeded
      } catch {
        // Reconnection failed, clean up
        this._cleanupConnection(guildId);
      }
    });

    connection.on(VoiceConnectionStatus.Destroyed, () => {
      this.connections.delete(guildId);
    });
  }

  /**
   * Destroys a connection and removes it from the tracking map.
   *
   * @private
   * @param {string} guildId
   */
  _cleanupConnection(guildId) {
    for (const callback of this._cleanupCallbacks) {
      try {
        callback(guildId);
      } catch (err) {
        console.error(`[VOICE CALLBACK ERROR] Guild ${guildId}:`, err?.message || err);
      }
    }

    const existing = this.connections.get(guildId);
    if (existing?.connection) {
      try {
        if (existing.connection.state.status !== VoiceConnectionStatus.Destroyed) {
          existing.connection.destroy();
        }
      } catch (err) {
        console.error(`[VOICE CLEANUP ERROR] Guild ${guildId}:`, err?.message || err);
      }
    }
    this.connections.delete(guildId);
  }
}

export const voiceManager = new VoiceManager();
