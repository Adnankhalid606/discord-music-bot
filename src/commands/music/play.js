import { SlashCommandBuilder } from 'discord.js';
import { voiceManager } from '../../music/VoiceManager.js';
import { audioPlayerManager } from '../../music/AudioPlayerManager.js';
import { trackResolver } from '../../music/TrackResolver.js';
import { config } from '../../config/config.js';
import {
  createSuccessEmbed,
  createWarningEmbed,
  createErrorEmbed,
  sendResponse,
} from '../../utils/embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Plays a song or URL from YouTube in your voice channel.')
    .addStringOption((option) =>
      option
        .setName('query')
        .setDescription('Song title or URL to search and play')
        .setRequired(true)
    ),
  category: 'Music',
  async execute(context, args) {
    const isSlash = typeof context.isChatInputCommand === 'function' && context.isChatInputCommand();
    const guildId = context.guild?.id;

    if (!guildId) {
      const errEmbed = createErrorEmbed({
        title: 'Error',
        description: 'This command can only be used within a Discord server.',
      });
      return await sendResponse(context, { embeds: [errEmbed] });
    }

    // Extract search query or URL
    let query = '';
    if (isSlash) {
      query = context.options.getString('query', true)?.trim();
    } else {
      query = Array.isArray(args) ? args.join(' ').trim() : String(args || '').trim();
    }

    if (!query) {
      const prefix = config.prefix;
      const warnEmbed = createWarningEmbed({
        title: 'Query Required',
        description: `Please specify a song title or URL to play.\nExamples: \`/play query:Bohemian Rhapsody\` or \`${prefix}play Bohemian Rhapsody\`.`,
      });
      return await sendResponse(context, { embeds: [warnEmbed] });
    }

    // Check user's voice channel
    const userVoiceChannel = context.member?.voice?.channel;
    if (!userVoiceChannel) {
      const warnEmbed = createWarningEmbed({
        title: 'Voice Channel Required',
        description: 'You must be in a voice channel to play music. Please join one and try again.',
      });
      return await sendResponse(context, { embeds: [warnEmbed] });
    }

    // Check if bot is connected to a different channel in the server
    const botChannelId = voiceManager.getChannelId(guildId);
    if (botChannelId && botChannelId !== userVoiceChannel.id && voiceManager.isConnected(guildId)) {
      const warnEmbed = createWarningEmbed({
        title: 'Already in Another Channel',
        description: 'I am already playing or connected to a different voice channel in this server. Please join my channel or use `/leave` first.',
      });
      return await sendResponse(context, { embeds: [warnEmbed] });
    }

    // Defer slash interaction to allow time for online track resolution
    if (isSlash && !context.deferred && !context.replied) {
      await context.deferReply();
    }

    try {
      // Resolve track metadata and stream URL via yt-dlp
      const track = await trackResolver.resolve(query);

      // Connect to voice if not already connected
      let connection = voiceManager.getConnection(guildId);
      if (!connection || !voiceManager.isConnected(guildId)) {
        connection = await voiceManager.join(userVoiceChannel);
      }

      // Start audio playback through the audio pipeline
      audioPlayerManager.playTrack(guildId, connection, track);

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

      return await sendResponse(context, { embeds: [successEmbed] });
    } catch (error) {
      console.error(`[PLAY ERROR] Guild ${guildId} Query "${query}":`, error?.message || error);

      const errEmbed = createErrorEmbed({
        title: 'Playback Failed',
        description: error?.message || 'An error occurred while resolving or playing the requested track.',
      });
      return await sendResponse(context, { embeds: [errEmbed] });
    }
  },
};
