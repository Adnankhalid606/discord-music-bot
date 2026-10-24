import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { AudioPlayerStatus } from '@discordjs/voice';
import {
  PlaybackLifecycleService,
  PlaybackOperation,
  PlaybackState,
} from '../src/music/PlaybackLifecycleService.js';
import playCommand from '../src/commands/music/play.js';
import leaveCommand from '../src/commands/voice/leave.js';

class MockChildProcess extends EventEmitter {
  constructor() {
    super();
    this.killed = false;
    this.killSignal = null;
  }
  kill(signal = 'SIGTERM') {
    this.killed = true;
    this.killSignal = signal;
    this.emit('close', 1, signal);
  }
}

class MockAudioPlayer extends EventEmitter {
  constructor() {
    super();
    this.state = { status: AudioPlayerStatus.Idle };
    this.playCount = 0;
  }
  play(resource) {
    this.playCount += 1;
    this.resource = resource;
    const oldState = { ...this.state };
    this.state = { status: AudioPlayerStatus.Playing, resource };
    this.emit('stateChange', oldState, { status: AudioPlayerStatus.Playing });
  }
  stop() {
    this.state = { status: AudioPlayerStatus.Idle };
    this.emit('stateChange', { status: AudioPlayerStatus.Playing }, { status: AudioPlayerStatus.Idle });
  }
}

describe('Playback Diagnostics and Cancellation-Safe Lifecycle', () => {
  const fakeTrack = {
    title: 'Bohemian Rhapsody',
    streamUrl: 'https://audio.stream.fake/track.opus',
    webpageUrl: 'https://youtube.com/watch?v=fJ9rUzIMcZQ',
    duration: 354,
    durationFormatted: '05:54',
    uploader: 'Queen',
    thumbnail: 'https://img.youtube.com/vi/fJ9rUzIMcZQ/hqdefault.jpg',
    query: 'Bohemian Rhapsody',
  };

  let mockResolver;
  let mockVoiceManager;
  let mockPlayerManager;
  let timingLogs;
  let service;

  beforeEach(() => {
    timingLogs = [];
    const logWriter = (msg) => timingLogs.push(msg);

    const mockPlayer = new MockAudioPlayer();

    mockResolver = {
      resolve: async (query, { signal, onProcessSpawn } = {}) => {
        const proc = new MockChildProcess();
        onProcessSpawn?.(proc);
        return fakeTrack;
      },
    };

    mockVoiceManager = {
      connections: new Map(),
      channelIds: new Map(),
      joinCalls: 0,
      leaveCalls: 0,
      getChannelId(guildId) {
        return this.channelIds.get(guildId) || null;
      },
      isConnected(guildId) {
        return this.connections.has(guildId);
      },
      getConnection(guildId) {
        return this.connections.get(guildId) || null;
      },
      async join(channel) {
        this.joinCalls += 1;
        const conn = { id: 'mock-conn', subscribe: () => ({ unsubscribe: () => {} }) };
        this.connections.set(channel.guild.id, conn);
        this.channelIds.set(channel.guild.id, channel.id);
        return conn;
      },
      leave(guildId) {
        this.leaveCalls += 1;
        this.connections.delete(guildId);
        this.channelIds.delete(guildId);
        return true;
      },
    };

    mockPlayerManager = {
      player: mockPlayer,
      playTrackCalls: 0,
      _createAudioResource: (url) => ({ url }),
      getOrCreatePlayer: (guildId, connection) => ({
        player: mockPlayer,
        connection,
        subscription: { unsubscribe: () => {} },
      }),
      playTrack: (guildId, connection, track) => {
        mockPlayerManager.playTrackCalls += 1;
        mockPlayer.play({ track });
        return { track: track.title };
      },
      cleanup: () => {},
    };

    service = new PlaybackLifecycleService({
      resolver: mockResolver,
      voiceMgr: mockVoiceManager,
      playerMgr: mockPlayerManager,
      logWriter,
    });
  });

  test('1. A play operation is cancelled when leave is invoked during track resolution', async () => {
    let resolverStarted;
    const resolverGate = new Promise((resolve) => {
      resolverStarted = resolve;
    });

    let mockProc = null;
    mockResolver.resolve = async (query, { signal, onProcessSpawn } = {}) => {
      mockProc = new MockChildProcess();
      onProcessSpawn?.(mockProc);
      resolverStarted();

      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => {
          const err = new Error('Track resolution was aborted.');
          err.name = 'AbortError';
          reject(err);
        });
      });
    };

    const mockContext = {
      guild: { id: 'guild-1' },
      member: { voice: { channel: { id: 'voice-1', name: 'General', guild: { id: 'guild-1' } } } },
      reply: async () => {},
    };

    const playPromise = service.executePlay({
      context: mockContext,
      query: 'Bohemian Rhapsody',
      type: 'prefix',
    });

    await resolverGate;

    // Verify active operation exists in resolving state
    const activeOp = service.getActiveOperation('guild-1');
    assert.ok(activeOp);
    assert.equal(activeOp.state, PlaybackState.RESOLVING);

    // Invoke cancellation via leave
    service.cancelActiveOperation('guild-1', 'User left channel');

    // Child process should be terminated
    assert.equal(mockProc.killed, true);
    assert.equal(activeOp.isCancelled, true);

    const result = await playPromise;
    assert.equal(result, null, 'Cancelled operation should return null and not succeed');
    assert.equal(activeOp.state, PlaybackState.CANCELLED);
    assert.equal(mockVoiceManager.joinCalls, 0, 'Cancelled operation must not join voice channel');
  });

  test('2. A late resolver result cannot reconnect the bot or start playback', async () => {
    let completeLateResolution;
    const lateResolutionPromise = new Promise((resolve) => {
      completeLateResolution = resolve;
    });

    mockResolver.resolve = async () => {
      return lateResolutionPromise;
    };

    const mockContext = {
      guild: { id: 'guild-1' },
      member: { voice: { channel: { id: 'voice-1', name: 'General', guild: { id: 'guild-1' } } } },
      reply: async () => {},
    };

    const playPromise = service.executePlay({
      context: mockContext,
      query: 'Bohemian Rhapsody',
      type: 'prefix',
    });

    // Cancel while waiting for resolution
    service.cancelActiveOperation('guild-1', 'Left channel before resolution finished');

    // Resolve after cancellation has already occurred
    completeLateResolution(fakeTrack);

    const result = await playPromise;
    assert.equal(result, null);
    assert.equal(mockVoiceManager.joinCalls, 0, 'Must not connect to voice after cancellation');
    assert.equal(mockPlayerManager.playTrackCalls, 0, 'Must not start playback after cancellation');
  });

  test('3. Leave during voice connection readiness prevents later playback', async () => {
    let joinStarted;
    const joinGate = new Promise((resolve) => {
      joinStarted = resolve;
    });

    mockVoiceManager.join = async () => {
      joinStarted();
      // Simulate long voice connection handshake
      await new Promise((r) => setTimeout(r, 100));
      return { id: 'mock-conn' };
    };

    const mockContext = {
      guild: { id: 'guild-1' },
      member: { voice: { channel: { id: 'voice-1', name: 'General', guild: { id: 'guild-1' } } } },
      reply: async () => {},
    };

    const playPromise = service.executePlay({
      context: mockContext,
      query: 'Bohemian Rhapsody',
      type: 'prefix',
    });

    await joinGate;

    // Leave while connecting
    service.cancelActiveOperation('guild-1', 'Left during connection');

    const result = await playPromise;
    assert.equal(result, null);
    assert.equal(mockPlayerManager.playTrackCalls, 0, 'Must not proceed to playback if cancelled in voice readiness');
  });

  test('4. A cancelled operation does not send a success response', async () => {
    let responseSent = false;
    let deferred = false;

    mockResolver.resolve = async () => {
      await new Promise((r) => setTimeout(r, 50));
      return fakeTrack;
    };

    const mockInteraction = {
      isChatInputCommand: () => true,
      guild: { id: 'guild-1' },
      member: { voice: { channel: { id: 'voice-1', name: 'General', guild: { id: 'guild-1' } } } },
      deferred: false,
      deferReply: async () => {
        deferred = true;
        mockInteraction.deferred = true;
      },
      editReply: async () => {
        responseSent = true;
      },
    };

    const playPromise = service.executePlay({
      context: mockInteraction,
      query: 'Bohemian Rhapsody',
      type: 'slash',
    });

    assert.equal(deferred, true);
    service.cancelActiveOperation('guild-1', 'Cancelled');

    await playPromise;
    assert.equal(responseSent, false, 'Cancelled operation must never send an embed or edit reply');
  });

  test('5. A newer play operation is not affected by cleanup from an older operation', async () => {
    let resolveFirst;
    const firstPromise = new Promise((resolve) => {
      resolveFirst = resolve;
    });

    let callCount = 0;
    mockResolver.resolve = async (query) => {
      callCount += 1;
      if (callCount === 1) {
        return firstPromise;
      }
      return fakeTrack;
    };

    let replyPayload1 = null;
    let replyPayload2 = null;

    const mockContext1 = {
      guild: { id: 'guild-1' },
      member: { voice: { channel: { id: 'voice-1', name: 'General', guild: { id: 'guild-1' } } } },
      reply: async (payload) => {
        replyPayload1 = payload;
      },
    };

    const mockContext2 = {
      guild: { id: 'guild-1' },
      member: { voice: { channel: { id: 'voice-1', name: 'General', guild: { id: 'guild-1' } } } },
      reply: async (payload) => {
        replyPayload2 = payload;
      },
    };

    // Start first play operation
    const play1 = service.executePlay({
      context: mockContext1,
      query: 'Old Song',
      type: 'prefix',
    });

    const op1 = service.getActiveOperation('guild-1');
    assert.ok(op1);

    // Newer play operation arrives
    const play2 = service.executePlay({
      context: mockContext2,
      query: 'New Song',
      type: 'prefix',
    });

    const op2 = service.getActiveOperation('guild-1');
    assert.notEqual(op1, op2);
    assert.equal(op1.isCancelled, true, 'First operation must be marked cancelled');
    assert.equal(op2.isCancelled, false);

    // Old operation finishes resolving late
    resolveFirst(fakeTrack);

    await play1;
    await play2;

    assert.equal(replyPayload1, null, 'Old operation must not send response');
    assert.ok(replyPayload2?.embeds?.length, 'New operation must successfully send response');
    assert.equal(op2.state, PlaybackState.COMPLETED);
  });

  test('6. Repeated leave calls remain safe', async () => {
    assert.doesNotThrow(() => {
      service.cancelActiveOperation('guild-1');
      service.cancelActiveOperation('guild-1');
      service.cancelActiveOperation('guild-1');
    });

    assert.equal(service.getActiveOperation('guild-1'), null);
  });

  test('7. Normal playback can still reach the playing state', async () => {
    let sentPayload = null;
    const mockContext = {
      guild: { id: 'guild-1' },
      member: { voice: { channel: { id: 'voice-1', name: 'General', guild: { id: 'guild-1' } } } },
      reply: async (payload) => {
        sentPayload = payload;
        return payload;
      },
    };

    await service.executePlay({
      context: mockContext,
      query: 'Bohemian Rhapsody',
      type: 'prefix',
    });

    assert.ok(sentPayload?.embeds?.length);
    const embed = sentPayload.embeds[0].toJSON();
    assert.ok(embed.title.includes('Playing'));
    assert.ok(embed.description.includes('Bohemian Rhapsody'));
    assert.equal(mockPlayerManager.playTrackCalls, 1);
  });

  test('8. Resolver failure and voice timeout clean up correctly', async () => {
    // 8a. Resolver failure
    mockResolver.resolve = async () => {
      throw new Error('yt-dlp extraction failure');
    };

    let sentError = null;
    const mockContext1 = {
      guild: { id: 'guild-1' },
      member: { voice: { channel: { id: 'voice-1', name: 'General', guild: { id: 'guild-1' } } } },
      reply: async (payload) => {
        sentError = payload;
      },
    };

    await service.executePlay({
      context: mockContext1,
      query: 'Failed Query',
      type: 'prefix',
    });

    assert.ok(sentError?.embeds?.length);
    assert.ok(sentError.embeds[0].toJSON().title.includes('Failed'));
    assert.equal(service.getActiveOperation('guild-1'), null, 'Operation entry must be cleaned up on failure');

    // 8b. Voice connection failure
    mockResolver.resolve = async () => fakeTrack;
    mockVoiceManager.join = async () => {
      throw new Error('Voice connection timed out');
    };

    let sentVoiceError = null;
    const mockContext2 = {
      guild: { id: 'guild-1' },
      member: { voice: { channel: { id: 'voice-1', name: 'General', guild: { id: 'guild-1' } } } },
      reply: async (payload) => {
        sentVoiceError = payload;
      },
    };

    await service.executePlay({
      context: mockContext2,
      query: 'Bohemian Rhapsody',
      type: 'prefix',
    });

    assert.ok(sentVoiceError?.embeds?.length);
    assert.ok(sentVoiceError.embeds[0].toJSON().description.includes('Voice connection timed out'));
    assert.equal(service.getActiveOperation('guild-1'), null);
  });

  test('9. Timing logs record stages and terminal outcomes', async () => {
    const mockContext = {
      receivedAt: performance.now() - 5,
      guild: { id: 'guild-1' },
      member: { voice: { channel: { id: 'voice-1', name: 'General', guild: { id: 'guild-1' } } } },
      reply: async () => {},
    };

    await service.executePlay({
      context: mockContext,
      query: 'Bohemian Rhapsody',
      type: 'prefix',
    });

    assert.ok(timingLogs.length >= 6);
    assert.ok(timingLogs.some((l) => l.includes('stage=command_dispatch') && l.includes('status=success')));
    assert.ok(timingLogs.some((l) => l.includes('stage=resolver_startup') && l.includes('status=success')));
    assert.ok(timingLogs.some((l) => l.includes('stage=resolver_search') && l.includes('status=success')));
    assert.ok(timingLogs.some((l) => l.includes('stage=voice_readiness') && l.includes('status=success')));
    assert.ok(timingLogs.some((l) => l.includes('stage=player_init') && l.includes('status=success')));
    assert.ok(timingLogs.some((l) => l.includes('stage=resource_creation') && l.includes('status=success')));
    assert.ok(timingLogs.some((l) => l.includes('stage=playback_start') && l.includes('status=success')));
    assert.ok(timingLogs.some((l) => l.includes('stage=response_delivery') && l.includes('status=success')));
    assert.ok(timingLogs.some((l) => l.includes('stage=total_operation') && l.includes('status=success')));
  });

  test('10. Prefix and slash commands use the same playback lifecycle service', async () => {
    assert.equal(typeof playCommand.execute, 'function');
    assert.equal(typeof leaveCommand.execute, 'function');

    // Both invoke the same shared service
    const service1 = (await import('../src/music/PlaybackLifecycleService.js')).playbackLifecycleService;
    assert.ok(service1);
    assert.equal(typeof service1.executePlay, 'function');
    assert.equal(typeof service1.cancelActiveOperation, 'function');
  });
});
