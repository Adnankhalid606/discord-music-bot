import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { voiceManager } from '../../music/VoiceManager.js';
import {
  createSuccessEmbed,
  createWarningEmbed,
  createErrorEmbed,
  createInfoEmbed,
  sendResponse,
} from '../../utils/embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('join')
    .setDescription('Connects the bot to your current voice channel.'),
  category: 'Voice',
  async execute(context) {
    const member = context.member;
    const voiceChannel = member?.voice?.channel;

    // Check if user is in a voice channel
    if (!voiceChannel) {
      const warningEmbed = createWarningEmbed({
        title: 'Voice Channel Required',
        description: 'You must be in a voice channel to use this command. Please join one and try again.',
      });
      return await sendResponse(context, { embeds: [warningEmbed] });
    }

    // Check bot permissions
    const botMember = context.guild?.members?.me;
    if (botMember) {
      const permissions = voiceChannel.permissionsFor(botMember);
      if (!permissions || !permissions.has(PermissionFlagsBits.Connect)) {
        const permEmbed = createErrorEmbed({
          title: 'Permission Denied',
          description: `I do not have the **Connect** permission in **${voiceChannel.name}**.`,
        });
        return await sendResponse(context, { embeds: [permEmbed] });
      }
    }

    // Check if already connected to this exact channel and ready
    const currentChannelId = voiceManager.getChannelId(context.guild.id);
    if (currentChannelId === voiceChannel.id && voiceManager.isConnected(context.guild.id)) {
      const alreadyEmbed = createInfoEmbed({
        title: 'Already Connected',
        description: `I am already connected to **${voiceChannel.name}**.`,
      });
      return await sendResponse(context, { embeds: [alreadyEmbed] });
    }

    try {
      await voiceManager.join(voiceChannel);

      const successEmbed = createSuccessEmbed({
        title: 'Voice Connected',
        description: `Joined **${voiceChannel.name}** and ready for audio commands.`,
      });
      return await sendResponse(context, { embeds: [successEmbed] });
    } catch (error) {
      console.error(`[VOICE JOIN ERROR] Failed to join channel "${voiceChannel.name}" in guild "${context.guild?.id}":`, error?.message || error);

      const errorEmbed = createErrorEmbed({
        title: 'Connection Failed',
        description: 'Unable to establish a voice connection within timeout. Please ensure the bot has proper channel access and try again.',
      });
      return await sendResponse(context, { embeds: [errorEmbed] });
    }
  },
};
