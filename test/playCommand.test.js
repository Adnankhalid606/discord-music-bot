import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import playCommand from '../src/commands/music/play.js';
import { trackResolver } from '../src/music/TrackResolver.js';
import { audioPlayerManager } from '../src/music/AudioPlayerManager.js';
import { voiceManager } from '../src/music/VoiceManager.js';

describe('Play Command (/play and !play)', () => {
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

  test('exports slash command definition with query option and Music category', () => {
    assert.equal(playCommand.data.name, 'play');
    assert.ok(playCommand.data.description);
    assert.equal(playCommand.category, 'Music');
    assert.equal(typeof playCommand.execute, 'function');

    const queryOption = playCommand.data.options.find(o => o.name === 'query');
    assert.ok(queryOption);
    assert.equal(queryOption.required, true);
  });

  test('returns warning embed when no query is provided', async () => {
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

    await playCommand.execute(mockInteraction);

    assert.ok(sentPayload?.embeds?.length);
    const embedData = sentPayload.embeds[0].toJSON();
    assert.ok(embedData.title.includes('Query') || embedData.description.includes('specify a song'));
  });

  test('returns warning embed when user is not in a voice channel', async () => {
    let sentPayload = null;
    const mockInteraction = {
      isChatInputCommand: () => true,
      options: { getString: () => 'Bohemian Rhapsody' },
      guild: { id: 'guild-1' },
      member: { voice: { channel: null } },
      reply: async (payload) => {
        sentPayload = payload;
        return payload;
      },
    };

    await playCommand.execute(mockInteraction);

    assert.ok(sentPayload?.embeds?.length);
    const embedData = sentPayload.embeds[0].toJSON();
    assert.ok(embedData.title.includes('Voice Channel') || embedData.description.includes('must be in a voice channel'));
  });

  test('returns warning embed when bot is connected to another channel', async () => {
    let sentPayload = null;
    const origGetChannelId = voiceManager.getChannelId;
    const origIsConnected = voiceManager.isConnected;

    voiceManager.getChannelId = () => 'other-channel-99';
    voiceManager.isConnected = () => true;

    try {
      const mockInteraction = {
        isChatInputCommand: () => true,
        options: { getString: () => 'Bohemian Rhapsody' },
        guild: { id: 'guild-1' },
        member: { voice: { channel: { id: 'voice-1', name: 'User Channel' } } },
        reply: async (payload) => {
          sentPayload = payload;
          return payload;
        },
      };

      await playCommand.execute(mockInteraction);

      assert.ok(sentPayload?.embeds?.length);
      const embedData = sentPayload.embeds[0].toJSON();
      assert.ok(embedData.description.includes('different voice channel') || embedData.title.includes('Another Channel'));
    } finally {
      voiceManager.getChannelId = origGetChannelId;
      voiceManager.isConnected = origIsConnected;
    }
  });

  test('resolves track, defers reply, and starts playback for Slash command', async () => {
    let deferred = false;
    let editPayload = null;

    const origResolve = trackResolver.resolve;
    const origPlayTrack = audioPlayerManager.playTrack;
    const origJoin = voiceManager.join;
    const origGetChannelId = voiceManager.getChannelId;

    trackResolver.resolve = async () => fakeTrack;
    voiceManager.getChannelId = () => null;
    voiceManager.join = async () => ({ id: 'conn-1' });
    audioPlayerManager.playTrack = () => ({ track: fakeTrack.title });

    try {
      const mockInteraction = {
        isChatInputCommand: () => true,
        deferred: false,
        deferReply: async () => {
          deferred = true;
          mockInteraction.deferred = true;
        },
        options: { getString: () => 'Bohemian Rhapsody' },
        guild: { id: 'guild-1' },
        user: { tag: 'User#0001' },
        member: { voice: { channel: { id: 'voice-1', name: 'Music Lounge' } } },
        editReply: async (payload) => {
          editPayload = payload;
          return payload;
        },
      };

      await playCommand.execute(mockInteraction);

      assert.equal(deferred, true, 'Must defer reply for slash command during resolution');
      assert.ok(editPayload?.embeds?.length);
      const embedData = editPayload.embeds[0].toJSON();
      assert.ok(embedData.title.includes('Playing'));
      assert.ok(embedData.description.includes('Bohemian Rhapsody'));
      assert.ok(embedData.description.includes(fakeTrack.webpageUrl));
      assert.ok(embedData.description.includes('05:54'));
    } finally {
      trackResolver.resolve = origResolve;
      audioPlayerManager.playTrack = origPlayTrack;
      voiceManager.join = origJoin;
      voiceManager.getChannelId = origGetChannelId;
    }
  });

  test('resolves track and starts playback for Message context (prefix command)', async () => {
    let sentPayload = null;

    const origResolve = trackResolver.resolve;
    const origPlayTrack = audioPlayerManager.playTrack;
    const origJoin = voiceManager.join;
    const origGetChannelId = voiceManager.getChannelId;

    trackResolver.resolve = async () => fakeTrack;
    voiceManager.getChannelId = () => null;
    voiceManager.join = async () => ({ id: 'conn-1' });
    audioPlayerManager.playTrack = () => ({ track: fakeTrack.title });

    try {
      const mockMessage = {
        isChatInputCommand: () => false,
        guild: { id: 'guild-1' },
        author: { tag: 'User#0001' },
        member: { voice: { channel: { id: 'voice-1', name: 'Music Lounge' } } },
        reply: async (payload) => {
          sentPayload = payload;
          return payload;
        },
      };

      await playCommand.execute(mockMessage, ['Bohemian', 'Rhapsody']);

      assert.ok(sentPayload?.embeds?.length);
      const embedData = sentPayload.embeds[0].toJSON();
      assert.ok(embedData.title.includes('Playing'));
      assert.ok(embedData.description.includes('Bohemian Rhapsody'));
    } finally {
      trackResolver.resolve = origResolve;
      audioPlayerManager.playTrack = origPlayTrack;
      voiceManager.join = origJoin;
      voiceManager.getChannelId = origGetChannelId;
    }
  });

  test('handles resolution error and sends error embed', async () => {
    let sentPayload = null;

    const origResolve = trackResolver.resolve;
    const origGetChannelId = voiceManager.getChannelId;

    trackResolver.resolve = async () => {
      throw new Error('The requested video is unavailable or restricted.');
    };
    voiceManager.getChannelId = () => null;

    try {
      const mockInteraction = {
        isChatInputCommand: () => true,
        deferred: false,
        deferReply: async () => {
          mockInteraction.deferred = true;
        },
        options: { getString: () => 'Unavailable Video' },
        guild: { id: 'guild-1' },
        member: { voice: { channel: { id: 'voice-1', name: 'Music Lounge' } } },
        editReply: async (payload) => {
          sentPayload = payload;
          return payload;
        },
      };

      await playCommand.execute(mockInteraction);

      assert.ok(sentPayload?.embeds?.length);
      const embedData = sentPayload.embeds[0].toJSON();
      assert.ok(embedData.title.includes('Playback Failed') || embedData.title.includes('Error'));
      assert.ok(embedData.description.includes('unavailable or restricted'));
    } finally {
      trackResolver.resolve = origResolve;
      voiceManager.getChannelId = origGetChannelId;
    }
  });

  test('does not disconnect voice connection on track resolution failure', async () => {
    let leaveCalled = false;
    const origResolve = trackResolver.resolve;
    const origGetChannelId = voiceManager.getChannelId;
    const origIsConnected = voiceManager.isConnected;
    const origLeave = voiceManager.leave;

    trackResolver.resolve = async () => {
      throw new Error('yt-dlp resolution error');
    };
    voiceManager.getChannelId = () => 'voice-1';
    voiceManager.isConnected = () => true;
    voiceManager.leave = () => {
      leaveCalled = true;
      return true;
    };

    try {
      const mockInteraction = {
        isChatInputCommand: () => true,
        deferred: false,
        deferReply: async () => {
          mockInteraction.deferred = true;
        },
        options: { getString: () => 'Bad Track' },
        guild: { id: 'guild-1' },
        member: { voice: { channel: { id: 'voice-1', name: 'Music Lounge' } } },
        editReply: async () => {},
      };

      await playCommand.execute(mockInteraction);

      assert.equal(leaveCalled, false, 'Bot must not disconnect from voice when track resolution fails');
    } finally {
      trackResolver.resolve = origResolve;
      voiceManager.getChannelId = origGetChannelId;
      voiceManager.isConnected = origIsConnected;
      voiceManager.leave = origLeave;
    }
  });
});
