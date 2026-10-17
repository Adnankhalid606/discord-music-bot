import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { AudioPlayerStatus } from '@discordjs/voice';
import { AudioPlayerManager, resolveAudioFile, SUPPORTED_EXTENSIONS } from '../src/music/AudioPlayerManager.js';

class MockAudioPlayer extends EventEmitter {
  constructor() {
    super();
    this.state = { status: AudioPlayerStatus.Idle };
  }

  play(resource) {
    this.resource = resource;
    this.state = { status: AudioPlayerStatus.Playing, resource };
    this.emit(AudioPlayerStatus.Playing);
  }

  pause() {
    if (this.state.status === AudioPlayerStatus.Playing) {
      this.state = { status: AudioPlayerStatus.Paused, resource: this.resource };
      this.emit(AudioPlayerStatus.Paused);
      return true;
    }
    return false;
  }

  unpause() {
    if (this.state.status === AudioPlayerStatus.Paused) {
      this.state = { status: AudioPlayerStatus.Playing, resource: this.resource };
      this.emit(AudioPlayerStatus.Playing);
      return true;
    }
    return false;
  }

  stop(force = false) {
    this.state = { status: AudioPlayerStatus.Idle };
    this.resource = null;
    this.emit(AudioPlayerStatus.Idle);
    return true;
  }
}

class MockVoiceConnection extends EventEmitter {
  constructor() {
    super();
    this.subscribedPlayer = null;
  }

  subscribe(player) {
    this.subscribedPlayer = player;
    return {
      player,
      connection: this,
      unsubscribe: () => {
        this.subscribedPlayer = null;
      },
    };
  }
}

describe('AudioPlayerManager', () => {
  const testFileName = 'test_sample.mp3';
  const testFilePath = join(process.cwd(), 'audio', testFileName);

  before(() => {
    // Create a temporary dummy audio file for testing
    writeFileSync(testFilePath, 'dummy audio data');
  });

  after(() => {
    if (existsSync(testFilePath)) {
      unlinkSync(testFilePath);
    }
  });

  describe('resolveAudioFile & Security', () => {
    test('resolves an existing valid audio file in audio/', () => {
      const resolved = resolveAudioFile(testFileName);
      assert.ok(resolved.endsWith(testFileName));
      assert.ok(existsSync(resolved));
    });

    test('rejects path traversal attempts', () => {
      assert.throws(
        () => resolveAudioFile('../../secret.txt'),
        /Invalid filename/
      );
      assert.throws(
        () => resolveAudioFile('..\\..\\windows\\win.ini'),
        /Invalid filename/
      );
      assert.throws(
        () => resolveAudioFile('subfolder/music.mp3'),
        /Invalid filename/
      );
    });

    test('rejects unsupported extensions', () => {
      assert.throws(
        () => resolveAudioFile('dangerous.exe'),
        /Unsupported audio format/
      );
      assert.throws(
        () => resolveAudioFile('script.js'),
        /Unsupported audio format/
      );
    });

    test('throws when file does not exist in audio/', () => {
      assert.throws(
        () => resolveAudioFile('non_existent_track.mp3'),
        /was not found/
      );
    });
  });

  describe('Playback and Player Lifecycle', () => {
    test('play starts playback and subscribes connection', () => {
      const manager = new AudioPlayerManager();
      const mockPlayer = new MockAudioPlayer();
      const mockConn = new MockVoiceConnection();

      manager._createAudioPlayer = () => mockPlayer;
      manager._createAudioResource = (path) => ({ path });

      const result = manager.play('guild-1', mockConn, testFileName);

      assert.equal(result.track, testFileName);
      assert.equal(mockConn.subscribedPlayer, mockPlayer);
      assert.equal(mockPlayer.state.status, AudioPlayerStatus.Playing);

      const status = manager.getStatus('guild-1');
      assert.equal(status.isPlaying, true);
      assert.equal(status.currentTrack, testFileName);
    });

    test('pause and resume toggle player state', () => {
      const manager = new AudioPlayerManager();
      const mockPlayer = new MockAudioPlayer();
      const mockConn = new MockVoiceConnection();

      manager._createAudioPlayer = () => mockPlayer;
      manager._createAudioResource = (path) => ({ path });

      manager.play('guild-1', mockConn, testFileName);

      // Pause
      const pauseResult = manager.pause('guild-1');
      assert.equal(pauseResult.success, true);
      assert.equal(mockPlayer.state.status, AudioPlayerStatus.Paused);

      // Cannot pause already paused
      const secondPause = manager.pause('guild-1');
      assert.equal(secondPause.success, false);
      assert.equal(secondPause.reason, 'ALREADY_PAUSED');

      // Resume
      const resumeResult = manager.resume('guild-1');
      assert.equal(resumeResult.success, true);
      assert.equal(mockPlayer.state.status, AudioPlayerStatus.Playing);

      // Cannot resume when already playing
      const secondResume = manager.resume('guild-1');
      assert.equal(secondResume.success, false);
      assert.equal(secondResume.reason, 'NOT_PAUSED');
    });

    test('stop halts playback and clears current track without disconnecting voice', () => {
      const manager = new AudioPlayerManager();
      const mockPlayer = new MockAudioPlayer();
      const mockConn = new MockVoiceConnection();

      manager._createAudioPlayer = () => mockPlayer;
      manager._createAudioResource = (path) => ({ path });

      manager.play('guild-1', mockConn, testFileName);
      assert.equal(manager.getStatus('guild-1').isPlaying, true);

      const stopResult = manager.stop('guild-1');
      assert.equal(stopResult.success, true);
      assert.equal(mockPlayer.state.status, AudioPlayerStatus.Idle);
      assert.equal(manager.getStatus('guild-1').currentTrack, null);
      // Connection still intact
      assert.ok(mockConn.subscribedPlayer !== null);
    });

    test('maintains guild player isolation', () => {
      const manager = new AudioPlayerManager();
      const player1 = new MockAudioPlayer();
      const player2 = new MockAudioPlayer();
      const conn1 = new MockVoiceConnection();
      const conn2 = new MockVoiceConnection();

      let callCount = 0;
      manager._createAudioPlayer = () => {
        callCount++;
        return callCount === 1 ? player1 : player2;
      };
      manager._createAudioResource = (path) => ({ path });

      manager.play('guild-1', conn1, testFileName);
      manager.play('guild-2', conn2, testFileName);

      manager.pause('guild-1');

      assert.equal(manager.getStatus('guild-1').isPaused, true);
      assert.equal(manager.getStatus('guild-2').isPlaying, true);
      assert.equal(manager.getStatus('guild-2').isPaused, false);
    });

    test('cleanup tears down player and state', () => {
      const manager = new AudioPlayerManager();
      const mockPlayer = new MockAudioPlayer();
      const mockConn = new MockVoiceConnection();

      manager._createAudioPlayer = () => mockPlayer;
      manager._createAudioResource = (path) => ({ path });

      manager.play('guild-1', mockConn, testFileName);
      manager.cleanup('guild-1');

      assert.equal(manager.getStatus('guild-1').status, 'idle');
      assert.equal(manager.getStatus('guild-1').currentTrack, null);
    });

    test('playTrack starts playback for an online stream track', () => {
      const manager = new AudioPlayerManager();
      const mockPlayer = new MockAudioPlayer();
      const mockConn = new MockVoiceConnection();

      manager._createAudioPlayer = () => mockPlayer;
      manager._createAudioResource = (path) => ({ path });

      const track = {
        title: 'Online Stream Track',
        streamUrl: 'https://audio.stream.url/audio.m4a',
        webpageUrl: 'https://youtube.com/watch?v=123',
        duration: 200,
        uploader: 'Artist',
      };

      const result = manager.playTrack('guild-1', mockConn, track);

      assert.equal(result.track, 'Online Stream Track');
      assert.equal(mockConn.subscribedPlayer, mockPlayer);
      assert.equal(mockPlayer.state.status, AudioPlayerStatus.Playing);

      const status = manager.getStatus('guild-1');
      assert.equal(status.isPlaying, true);
      assert.equal(status.currentTrack, 'Online Stream Track');
    });

    test('handles player error gracefully and resets track state', () => {
      const manager = new AudioPlayerManager();
      const mockPlayer = new MockAudioPlayer();
      const mockConn = new MockVoiceConnection();

      manager._createAudioPlayer = () => mockPlayer;
      manager._createAudioResource = (path) => ({ path });

      manager.play('guild-1', mockConn, testFileName);
      assert.equal(manager.getStatus('guild-1').isPlaying, true);

      // Simulate a stream / decoding error on the player
      mockPlayer.emit('error', new Error('FFmpeg stream closed unexpectedly'));

      const status = manager.getStatus('guild-1');
      assert.equal(status.currentTrack, null);
      assert.equal(mockPlayer.state.status, AudioPlayerStatus.Idle);
    });
  });
});
