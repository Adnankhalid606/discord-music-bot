import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import playfileCommand from '../src/commands/playfile.js';
import pauseCommand from '../src/commands/pause.js';
import resumeCommand from '../src/commands/resume.js';
import stopCommand from '../src/commands/stop.js';
import { audioPlayerManager } from '../src/music/AudioPlayerManager.js';
import { voiceManager } from '../src/music/VoiceManager.js';

describe('Audio Commands (playfile, pause, resume, stop)', () => {
  const testTrack = 'sample_track.mp3';
  const testTrackPath = join(process.cwd(), 'audio', testTrack);

  before(() => {
    writeFileSync(testTrackPath, 'mock audio content');
  });

  after(() => {
    if (existsSync(testTrackPath)) {
      unlinkSync(testTrackPath);
    }
  });

  describe('playfile command', () => {
    test('exports slash command definition and Music category', () => {
      assert.equal(playfileCommand.data.name, 'playfile');
      assert.ok(playfileCommand.data.description);
      assert.equal(playfileCommand.category, 'Music');
      assert.equal(typeof playfileCommand.execute, 'function');
    });

    test('returns warning embed when no filename is specified', async () => {
      let sentPayload = null;
      const mockInteraction = {
        isChatInputCommand: () => true,
        options: { getString: () => null },
        guild: { id: 'guild-1' },
        member: { voice: { channel: { id: 'voice-1' } } },
        reply: async (payload) => {
          sentPayload = payload;
          return payload;
        },
      };

      await playfileCommand.execute(mockInteraction);

      assert.ok(sentPayload?.embeds?.length);
      const embedData = sentPayload.embeds[0].toJSON();
      assert.ok(embedData.title.includes('Filename') || embedData.description.includes('specify an audio file'));
    });

    test('returns warning embed when user is not in a voice channel', async () => {
      let sentPayload = null;
      const mockInteraction = {
        isChatInputCommand: () => true,
        options: { getString: () => testTrack },
        guild: { id: 'guild-1' },
        member: { voice: { channel: null } },
        reply: async (payload) => {
          sentPayload = payload;
          return payload;
        },
      };

      await playfileCommand.execute(mockInteraction);

      assert.ok(sentPayload?.embeds?.length);
      const embedData = sentPayload.embeds[0].toJSON();
      assert.ok(embedData.title.includes('Voice Channel') || embedData.description.includes('must be in a voice channel'));
    });

    test('returns warning embed when bot is already connected to another channel', async () => {
      let sentPayload = null;
      const origGetChannelId = voiceManager.getChannelId;
      const origIsConnected = voiceManager.isConnected;

      voiceManager.getChannelId = () => 'other-channel-99';
      voiceManager.isConnected = () => true;

      try {
        const mockInteraction = {
          isChatInputCommand: () => true,
          options: { getString: () => testTrack },
          guild: { id: 'guild-1' },
          member: { voice: { channel: { id: 'voice-1', name: 'User Channel' } } },
          reply: async (payload) => {
            sentPayload = payload;
            return payload;
          },
        };

        await playfileCommand.execute(mockInteraction);

        assert.ok(sentPayload?.embeds?.length);
        const embedData = sentPayload.embeds[0].toJSON();
        assert.ok(embedData.description.includes('different voice channel') || embedData.title.includes('Another Channel'));
      } finally {
        voiceManager.getChannelId = origGetChannelId;
        voiceManager.isConnected = origIsConnected;
      }
    });

    test('rejects path traversal and sends error embed', async () => {
      let sentPayload = null;
      const origGetChannelId = voiceManager.getChannelId;
      voiceManager.getChannelId = () => null;

      try {
        const mockInteraction = {
          isChatInputCommand: () => true,
          options: { getString: () => '../../secret.txt' },
          guild: { id: 'guild-1' },
          member: { voice: { channel: { id: 'voice-1', name: 'User Channel' } } },
          reply: async (payload) => {
            sentPayload = payload;
            return payload;
          },
        };

        await playfileCommand.execute(mockInteraction);

        assert.ok(sentPayload?.embeds?.length);
        const embedData = sentPayload.embeds[0].toJSON();
        assert.ok(embedData.description.includes('Path traversal'));
      } finally {
        voiceManager.getChannelId = origGetChannelId;
      }
    });

    test('successfully plays track and sends success embed for Slash command', async () => {
      let sentPayload = null;
      const origJoin = voiceManager.join;
      const origPlay = audioPlayerManager.play;
      const origGetChannelId = voiceManager.getChannelId;

      voiceManager.getChannelId = () => null;
      voiceManager.join = async () => ({ id: 'mock-conn' });
      audioPlayerManager.play = () => ({ track: testTrack, resolvedPath: testTrackPath });

      try {
        const mockInteraction = {
          isChatInputCommand: () => true,
          options: { getString: () => testTrack },
          guild: { id: 'guild-1' },
          member: { voice: { channel: { id: 'voice-1', name: 'Music Channel' } } },
          reply: async (payload) => {
            sentPayload = payload;
            return payload;
          },
        };

        await playfileCommand.execute(mockInteraction);

        assert.ok(sentPayload?.embeds?.length);
        const embedData = sentPayload.embeds[0].toJSON();
        assert.ok(embedData.title.includes('Playing') || embedData.description.includes('Playing'));
        assert.ok(embedData.description.includes(testTrack));
      } finally {
        voiceManager.join = origJoin;
        audioPlayerManager.play = origPlay;
        voiceManager.getChannelId = origGetChannelId;
      }
    });

    test('successfully plays track for Message context (prefix command)', async () => {
      let sentPayload = null;
      const origJoin = voiceManager.join;
      const origPlay = audioPlayerManager.play;
      const origGetChannelId = voiceManager.getChannelId;

      voiceManager.getChannelId = () => null;
      voiceManager.join = async () => ({ id: 'mock-conn' });
      audioPlayerManager.play = () => ({ track: testTrack, resolvedPath: testTrackPath });

      try {
        const mockMessage = {
          isChatInputCommand: () => false,
          guild: { id: 'guild-1' },
          member: { voice: { channel: { id: 'voice-1', name: 'Music Channel' } } },
          reply: async (payload) => {
            sentPayload = payload;
            return payload;
          },
        };

        await playfileCommand.execute(mockMessage, [testTrack]);

        assert.ok(sentPayload?.embeds?.length);
        const embedData = sentPayload.embeds[0].toJSON();
        assert.ok(embedData.description.includes(testTrack));
      } finally {
        voiceManager.join = origJoin;
        audioPlayerManager.play = origPlay;
        voiceManager.getChannelId = origGetChannelId;
      }
    });
  });

  describe('pause and resume commands', () => {
    test('pause pauses track when playing', async () => {
      let sentPayload = null;
      const origPause = audioPlayerManager.pause;
      audioPlayerManager.pause = () => ({ success: true, track: testTrack });

      try {
        const mockInteraction = {
          isChatInputCommand: () => true,
          guild: { id: 'guild-1' },
          reply: async (payload) => {
            sentPayload = payload;
            return payload;
          },
        };

        await pauseCommand.execute(mockInteraction);
        assert.ok(sentPayload?.embeds?.length);
        const embedData = sentPayload.embeds[0].toJSON();
        assert.ok(embedData.title.includes('Paused') || embedData.description.includes('Paused'));
      } finally {
        audioPlayerManager.pause = origPause;
      }
    });

    test('pause returns info embed when not playing', async () => {
      let sentPayload = null;
      const origPause = audioPlayerManager.pause;
      audioPlayerManager.pause = () => ({ success: false, reason: 'NOT_PLAYING' });

      try {
        const mockInteraction = {
          isChatInputCommand: () => true,
          guild: { id: 'guild-1' },
          reply: async (payload) => {
            sentPayload = payload;
            return payload;
          },
        };

        await pauseCommand.execute(mockInteraction);
        assert.ok(sentPayload?.embeds?.length);
        const embedData = sentPayload.embeds[0].toJSON();
        assert.ok(embedData.title.includes('Not Playing') || embedData.description.includes('no audio'));
      } finally {
        audioPlayerManager.pause = origPause;
      }
    });

    test('resume resumes track when paused', async () => {
      let sentPayload = null;
      const origResume = audioPlayerManager.resume;
      audioPlayerManager.resume = () => ({ success: true, track: testTrack });

      try {
        const mockInteraction = {
          isChatInputCommand: () => true,
          guild: { id: 'guild-1' },
          reply: async (payload) => {
            sentPayload = payload;
            return payload;
          },
        };

        await resumeCommand.execute(mockInteraction);
        assert.ok(sentPayload?.embeds?.length);
        const embedData = sentPayload.embeds[0].toJSON();
        assert.ok(embedData.title.includes('Resumed') || embedData.description.includes('Resumed'));
      } finally {
        audioPlayerManager.resume = origResume;
      }
    });
  });

  describe('stop command', () => {
    test('stops active playback and returns success embed', async () => {
      let sentPayload = null;
      const origStop = audioPlayerManager.stop;
      audioPlayerManager.stop = () => ({ success: true, track: testTrack });

      try {
        const mockInteraction = {
          isChatInputCommand: () => true,
          guild: { id: 'guild-1' },
          reply: async (payload) => {
            sentPayload = payload;
            return payload;
          },
        };

        await stopCommand.execute(mockInteraction);
        assert.ok(sentPayload?.embeds?.length);
        const embedData = sentPayload.embeds[0].toJSON();
        assert.ok(embedData.title.includes('Stopped') || embedData.description.includes('Stopped'));
      } finally {
        audioPlayerManager.stop = origStop;
      }
    });

    test('returns info embed when stop called with no active track', async () => {
      let sentPayload = null;
      const origStop = audioPlayerManager.stop;
      audioPlayerManager.stop = () => ({ success: false, reason: 'NOT_PLAYING' });

      try {
        const mockInteraction = {
          isChatInputCommand: () => true,
          guild: { id: 'guild-1' },
          reply: async (payload) => {
            sentPayload = payload;
            return payload;
          },
        };

        await stopCommand.execute(mockInteraction);
        assert.ok(sentPayload?.embeds?.length);
        const embedData = sentPayload.embeds[0].toJSON();
        assert.ok(embedData.title.includes('Not Playing') || embedData.description.includes('no active'));
      } finally {
        audioPlayerManager.stop = origStop;
      }
    });
  });
});
