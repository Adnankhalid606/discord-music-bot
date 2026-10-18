import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits } from 'discord.js';
import joinCommand from '../src/commands/voice/join.js';
import leaveCommand from '../src/commands/voice/leave.js';
import { voiceManager } from '../src/music/VoiceManager.js';

describe('Voice Commands (/join and /leave)', () => {
  describe('join command', () => {
    test('exports slash command definition and Voice category', () => {
      assert.equal(joinCommand.data.name, 'join');
      assert.ok(joinCommand.data.description);
      assert.equal(joinCommand.category, 'Voice');
      assert.equal(typeof joinCommand.execute, 'function');
    });

    test('returns warning embed when user is not in a voice channel', async () => {
      let sentPayload = null;
      const mockInteraction = {
        isChatInputCommand: () => true,
        member: { voice: { channel: null } },
        guild: { id: 'guild-1' },
        reply: async (payload) => {
          sentPayload = payload;
          return payload;
        },
      };

      await joinCommand.execute(mockInteraction);

      assert.ok(sentPayload?.embeds?.length);
      const embedData = sentPayload.embeds[0].toJSON();
      assert.ok(embedData.title.toLowerCase().includes('voice channel') || embedData.title.toLowerCase().includes('join'));
      assert.ok(embedData.description.includes('must be in a voice channel'));
    });

    test('returns error embed when bot lacks Connect permission', async () => {
      let sentPayload = null;
      const mockChannel = {
        id: 'voice-1',
        name: 'Restricted Voice',
        permissionsFor: () => ({
          has: (perm) => perm !== PermissionFlagsBits.Connect,
        }),
      };

      const mockInteraction = {
        isChatInputCommand: () => true,
        member: { voice: { channel: mockChannel } },
        guild: {
          id: 'guild-1',
          members: { me: { id: 'bot-1' } },
        },
        reply: async (payload) => {
          sentPayload = payload;
          return payload;
        },
      };

      await joinCommand.execute(mockInteraction);

      assert.ok(sentPayload?.embeds?.length);
      const embedData = sentPayload.embeds[0].toJSON();
      assert.ok(embedData.title.toLowerCase().includes('permission') || embedData.description.toLowerCase().includes('permission'));
      assert.ok(embedData.description.includes('Connect'));
    });

    test('successfully joins voice channel and returns success embed for Slash command', async () => {
      let sentPayload = null;
      const mockChannel = {
        id: 'voice-1',
        name: 'General Voice',
        guild: { id: 'guild-1' },
        permissionsFor: () => ({
          has: () => true,
        }),
      };

      const originalJoin = voiceManager.join;
      voiceManager.join = async () => ({ state: { status: 'ready' } });

      try {
        const mockInteraction = {
          isChatInputCommand: () => true,
          member: { voice: { channel: mockChannel } },
          guild: {
            id: 'guild-1',
            members: { me: { id: 'bot-1' } },
          },
          reply: async (payload) => {
            sentPayload = payload;
            return payload;
          },
        };

        await joinCommand.execute(mockInteraction);

        assert.ok(sentPayload?.embeds?.length);
        const embedData = sentPayload.embeds[0].toJSON();
        assert.ok(embedData.description.includes('General Voice'));
      } finally {
        voiceManager.join = originalJoin;
      }
    });

    test('successfully joins voice channel and replies for Message context (prefix command)', async () => {
      let sentPayload = null;
      const mockChannel = {
        id: 'voice-1',
        name: 'Music Lounge',
        guild: { id: 'guild-1' },
        permissionsFor: () => ({
          has: () => true,
        }),
      };

      const originalJoin = voiceManager.join;
      voiceManager.join = async () => ({ state: { status: 'ready' } });

      try {
        const mockMessage = {
          isChatInputCommand: () => false,
          member: { voice: { channel: mockChannel } },
          guild: {
            id: 'guild-1',
            members: { me: { id: 'bot-1' } },
          },
          reply: async (payload) => {
            sentPayload = payload;
            return payload;
          },
        };

        await joinCommand.execute(mockMessage);

        assert.ok(sentPayload?.embeds?.length);
        const embedData = sentPayload.embeds[0].toJSON();
        assert.ok(embedData.description.includes('Music Lounge'));
      } finally {
        voiceManager.join = originalJoin;
      }
    });

    test('handles connection failure without exposing internal stack trace', async () => {
      let sentPayload = null;
      const mockChannel = {
        id: 'voice-1',
        name: 'General Voice',
        guild: { id: 'guild-1' },
        permissionsFor: () => ({
          has: () => true,
        }),
      };

      const originalJoin = voiceManager.join;
      voiceManager.join = async () => {
        throw new Error('Internal UDP socket binding timeout at /node_modules/@discordjs/voice/dist/index.js');
      };

      try {
        const mockInteraction = {
          isChatInputCommand: () => true,
          member: { voice: { channel: mockChannel } },
          guild: {
            id: 'guild-1',
            members: { me: { id: 'bot-1' } },
          },
          reply: async (payload) => {
            sentPayload = payload;
            return payload;
          },
        };

        await joinCommand.execute(mockInteraction);

        assert.ok(sentPayload?.embeds?.length);
        const embedData = sentPayload.embeds[0].toJSON();
        assert.ok(!embedData.description.includes('/node_modules'));
        assert.ok(!embedData.description.includes('UDP socket binding'));
      } finally {
        voiceManager.join = originalJoin;
      }
    });
  });

  describe('leave command', () => {
    test('exports slash command definition and Voice category', () => {
      assert.equal(leaveCommand.data.name, 'leave');
      assert.ok(leaveCommand.data.description);
      assert.equal(leaveCommand.category, 'Voice');
      assert.equal(typeof leaveCommand.execute, 'function');
    });

    test('returns info embed when bot is not connected', async () => {
      let sentPayload = null;
      const originalLeave = voiceManager.leave;
      voiceManager.leave = () => false;

      try {
        const mockInteraction = {
          isChatInputCommand: () => true,
          guild: { id: 'guild-1' },
          reply: async (payload) => {
            sentPayload = payload;
            return payload;
          },
        };

        await leaveCommand.execute(mockInteraction);

        assert.ok(sentPayload?.embeds?.length);
        const embedData = sentPayload.embeds[0].toJSON();
        assert.ok(embedData.title.toLowerCase().includes('not connected') || embedData.description.toLowerCase().includes('not connected'));
      } finally {
        voiceManager.leave = originalLeave;
      }
    });

    test('disconnects cleanly and returns success embed for Slash command', async () => {
      let sentPayload = null;
      const originalLeave = voiceManager.leave;
      voiceManager.leave = () => true;

      try {
        const mockInteraction = {
          isChatInputCommand: () => true,
          guild: { id: 'guild-1' },
          reply: async (payload) => {
            sentPayload = payload;
            return payload;
          },
        };

        await leaveCommand.execute(mockInteraction);

        assert.ok(sentPayload?.embeds?.length);
        const embedData = sentPayload.embeds[0].toJSON();
        assert.ok(embedData.title.toLowerCase().includes('disconnected') || embedData.description.toLowerCase().includes('left'));
      } finally {
        voiceManager.leave = originalLeave;
      }
    });

    test('disconnects cleanly and replies for Message context (prefix command)', async () => {
      let sentPayload = null;
      const originalLeave = voiceManager.leave;
      voiceManager.leave = () => true;

      try {
        const mockMessage = {
          isChatInputCommand: () => false,
          guild: { id: 'guild-1' },
          reply: async (payload) => {
            sentPayload = payload;
            return payload;
          },
        };

        await leaveCommand.execute(mockMessage);

        assert.ok(sentPayload?.embeds?.length);
        const embedData = sentPayload.embeds[0].toJSON();
        assert.ok(embedData.title.toLowerCase().includes('disconnected') || embedData.description.toLowerCase().includes('left'));
      } finally {
        voiceManager.leave = originalLeave;
      }
    });
  });
});
