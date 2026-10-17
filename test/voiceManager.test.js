import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { VoiceManager } from '../src/music/VoiceManager.js';

class MockVoiceConnection extends EventEmitter {
  constructor() {
    super();
    this.state = { status: 'signalling' };
    this.destroyed = false;
  }

  destroy() {
    this.destroyed = true;
    this.state = { status: 'destroyed' };
    this.emit('stateChange', { status: 'ready' }, { status: 'destroyed' });
  }
}

describe('VoiceManager', () => {
  test('joins a voice channel and transitions to ready', async () => {
    const manager = new VoiceManager();
    const mockConnection = new MockVoiceConnection();

    manager._joinVoiceChannel = () => mockConnection;
    manager._entersState = async (conn, status, timeout) => {
      conn.state = { status: 'ready' };
      return conn;
    };

    const mockChannel = {
      id: 'voice-1',
      name: 'General Voice',
      guild: {
        id: 'guild-1',
        name: 'Test Server',
        voiceAdapterCreator: {},
      },
    };

    const conn = await manager.join(mockChannel);
    assert.equal(conn, mockConnection);
    assert.equal(manager.isConnected('guild-1'), true);
    assert.equal(manager.getChannelId('guild-1'), 'voice-1');
  });

  test('reuses connection if already in the same channel and ready', async () => {
    const manager = new VoiceManager();
    const mockConnection = new MockVoiceConnection();
    mockConnection.state = { status: 'ready' };

    let joinCalls = 0;
    manager._joinVoiceChannel = () => {
      joinCalls++;
      return mockConnection;
    };
    manager._entersState = async (conn) => conn;

    const mockChannel = {
      id: 'voice-1',
      name: 'General Voice',
      guild: { id: 'guild-1', voiceAdapterCreator: {} },
    };

    await manager.join(mockChannel);
    assert.equal(joinCalls, 1);

    // Call join again with same channel
    const reusedConn = await manager.join(mockChannel);
    assert.equal(reusedConn, mockConnection);
    assert.equal(joinCalls, 1, 'Should reuse connection without calling joinVoiceChannel again');
  });

  test('switches channels when joining a different channel in the same guild', async () => {
    const manager = new VoiceManager();
    const mockConnection = new MockVoiceConnection();
    mockConnection.state = { status: 'ready' };

    let joinCalls = 0;
    manager._joinVoiceChannel = () => {
      joinCalls++;
      return mockConnection;
    };
    manager._entersState = async (conn) => conn;

    const channel1 = {
      id: 'voice-1',
      name: 'Channel 1',
      guild: { id: 'guild-1', voiceAdapterCreator: {} },
    };
    const channel2 = {
      id: 'voice-2',
      name: 'Channel 2',
      guild: { id: 'guild-1', voiceAdapterCreator: {} },
    };

    await manager.join(channel1);
    assert.equal(manager.getChannelId('guild-1'), 'voice-1');

    await manager.join(channel2);
    assert.equal(manager.getChannelId('guild-1'), 'voice-2');
    assert.equal(joinCalls, 2);
  });

  test('cleans up and throws when connection times out or fails readiness', async () => {
    const manager = new VoiceManager();
    const mockConnection = new MockVoiceConnection();

    manager._joinVoiceChannel = () => mockConnection;
    manager._entersState = async () => {
      throw new Error('Connection timed out waiting for Ready');
    };

    const mockChannel = {
      id: 'voice-1',
      name: 'General Voice',
      guild: { id: 'guild-1', voiceAdapterCreator: {} },
    };

    await assert.rejects(
      async () => manager.join(mockChannel),
      /Connection timed out/
    );

    assert.equal(mockConnection.destroyed, true);
    assert.equal(manager.isConnected('guild-1'), false);
    assert.equal(manager.getConnection('guild-1'), null);
  });

  test('leave destroys connection and removes guild from tracking', async () => {
    const manager = new VoiceManager();
    const mockConnection = new MockVoiceConnection();
    mockConnection.state = { status: 'ready' };

    manager._joinVoiceChannel = () => mockConnection;
    manager._entersState = async (conn) => conn;

    const mockChannel = {
      id: 'voice-1',
      name: 'General Voice',
      guild: { id: 'guild-1', voiceAdapterCreator: {} },
    };

    await manager.join(mockChannel);
    assert.equal(manager.isConnected('guild-1'), true);

    const left = manager.leave('guild-1');
    assert.equal(left, true);
    assert.equal(mockConnection.destroyed, true);
    assert.equal(manager.isConnected('guild-1'), false);
  });

  test('leave returns false if no connection exists', () => {
    const manager = new VoiceManager();
    const left = manager.leave('non-existent-guild');
    assert.equal(left, false);
  });

  test('translates AbortError from entersState timeout into descriptive error', async () => {
    const manager = new VoiceManager();
    const mockConnection = new MockVoiceConnection();

    manager._joinVoiceChannel = () => mockConnection;
    manager._entersState = async () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      err.code = 'ABORT_ERR';
      throw err;
    };

    const mockChannel = {
      id: 'voice-1',
      name: 'General Voice',
      guild: { id: 'guild-1', voiceAdapterCreator: {} },
    };

    await assert.rejects(
      async () => manager.join(mockChannel, { timeoutMs: 5000 }),
      (err) => {
        assert.ok(err.message.includes('Voice connection timed out after 5s'));
        assert.ok(err.message.includes('bot permissions and Discord voice server status'));
        assert.notEqual(err.message, 'The operation was aborted');
        return true;
      }
    );

    assert.equal(mockConnection.destroyed, true);
    assert.equal(manager.isConnected('guild-1'), false);
  });
});
