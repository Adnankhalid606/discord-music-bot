import { SlashCommandBuilder } from 'discord.js';
import { voiceManager } from '../../music/VoiceManager.js';
import { playbackLifecycleService } from '../../music/PlaybackLifecycleService.js';
import {
  createSuccessEmbed,
  createInfoEmbed,
  createErrorEmbed,
  sendResponse,
} from '../../utils/embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('leave')
    .setDescription('Disconnects the bot from the current voice channel.'),
  category: 'Voice',
  async execute(context) {
    const guildId = context.guild?.id;

    if (!guildId) {
      const errorEmbed = createErrorEmbed({
        title: 'Error',
        description: 'This command can only be executed within a Discord server.',
      });
      return await sendResponse(context, { embeds: [errorEmbed] });
    }

    try {
      // 1. Cancel any active or pending playback operations for this guild immediately
      playbackLifecycleService.cancelActiveOperation(guildId, 'Left voice channel via leave command');

      // 2. Disconnect and tear down connection
      const left = voiceManager.leave(guildId);

      if (!left) {
        const infoEmbed = createInfoEmbed({
          title: 'Not Connected',
          description: 'The bot is not currently connected to any voice channel in this server.',
        });
        return await sendResponse(context, { embeds: [infoEmbed] });
      }

      const successEmbed = createSuccessEmbed({
        title: 'Voice Disconnected',
        description: 'Successfully left the voice channel and cleaned up connection state.',
      });
      return await sendResponse(context, { embeds: [successEmbed] });
    } catch (error) {
      console.error(`[VOICE LEAVE ERROR] Failed to leave voice channel in guild "${guildId}":`, error?.message || error);

      const errorEmbed = createErrorEmbed({
        title: 'Disconnection Error',
        description: 'An error occurred while disconnecting from the voice channel.',
      });
      return await sendResponse(context, { embeds: [errorEmbed] });
    }
  },
};
