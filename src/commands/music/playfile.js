import { SlashCommandBuilder } from 'discord.js';
import { voiceManager } from '../../music/VoiceManager.js';
import { audioPlayerManager, resolveAudioFile } from '../../music/AudioPlayerManager.js';
import { config } from '../../config/config.js';
import {
  createSuccessEmbed,
  createWarningEmbed,
  createErrorEmbed,
  sendResponse,
} from '../../utils/embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('playfile')
    .setDescription('Plays a local audio file from the audio/ directory.')
    .addStringOption((option) =>
      option
        .setName('file')
        .setDescription('Filename of the audio track in audio/ (e.g. sample.mp3)')
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

    // Extract filename
    let filename = '';
    if (isSlash) {
      filename = context.options.getString('file', true);
    } else {
      filename = Array.isArray(args) ? args.join(' ').trim() : String(args || '').trim();
    }

    if (!filename) {
      const prefix = config.prefix;
      const warnEmbed = createWarningEmbed({
        title: 'Filename Required',
        description: `Please specify an audio file to play (e.g. \`/playfile file:track.mp3\` or \`${prefix}playfile track.mp3\`).\nPlace audio files in the bot's \`audio/\` folder.`,
      });
      return await sendResponse(context, { embeds: [warnEmbed] });
    }

    // Check user's voice channel
    const userVoiceChannel = context.member?.voice?.channel;
    if (!userVoiceChannel) {
      const warnEmbed = createWarningEmbed({
        title: 'Voice Channel Required',
        description: 'You must be in a voice channel to play audio. Please join one and try again.',
      });
      return await sendResponse(context, { embeds: [warnEmbed] });
    }

    // Check if bot is connected to a different channel
    const botChannelId = voiceManager.getChannelId(guildId);
    if (botChannelId && botChannelId !== userVoiceChannel.id && voiceManager.isConnected(guildId)) {
      const warnEmbed = createWarningEmbed({
        title: 'Already in Another Channel',
        description: 'I am already playing or connected to a different voice channel in this server. Please join my channel or use `/leave` first.',
      });
      return await sendResponse(context, { embeds: [warnEmbed] });
    }

    try {
      // Validate audio file early before attempting voice connection
      resolveAudioFile(filename);

      // Connect to voice if not already connected
      let connection = voiceManager.getConnection(guildId);
      if (!connection || !voiceManager.isConnected(guildId)) {
        connection = await voiceManager.join(userVoiceChannel);
      }

      // Start audio playback
      const playResult = audioPlayerManager.play(guildId, connection, filename);

      const successEmbed = createSuccessEmbed({
        title: 'Now Playing',
        description: `▶️ **${playResult.track}**\nChannel: **${userVoiceChannel.name}**`,
      });
      return await sendResponse(context, { embeds: [successEmbed] });
    } catch (error) {
      console.error(`[PLAYFILE ERROR] Guild ${guildId}:`, error?.message || error);

      const errEmbed = createErrorEmbed({
        title: 'Playback Failed',
        description: error?.message || 'An error occurred while loading or playing the audio file.',
      });
      return await sendResponse(context, { embeds: [errEmbed] });
    }
  },
};
