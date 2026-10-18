import { SlashCommandBuilder } from 'discord.js';
import { audioPlayerManager } from '../../music/AudioPlayerManager.js';
import {
  createSuccessEmbed,
  createInfoEmbed,
  createErrorEmbed,
  sendResponse,
} from '../../utils/embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stops audio playback and releases resources (keeps voice connection).'),
  category: 'Music',
  async execute(context) {
    const guildId = context.guild?.id;

    if (!guildId) {
      const errEmbed = createErrorEmbed({
        title: 'Error',
        description: 'This command can only be used within a Discord server.',
      });
      return await sendResponse(context, { embeds: [errEmbed] });
    }

    try {
      const result = audioPlayerManager.stop(guildId);

      if (!result.success) {
        const infoEmbed = createInfoEmbed({
          title: 'Not Playing',
          description: 'There is no active or paused audio playback to stop.',
        });
        return await sendResponse(context, { embeds: [infoEmbed] });
      }

      const successEmbed = createSuccessEmbed({
        title: 'Playback Stopped',
        description: `⏹️ Stopped playback of **${result.track || 'audio'}** and released resources.\nBot remains connected to the voice channel.`,
      });
      return await sendResponse(context, { embeds: [successEmbed] });
    } catch (error) {
      console.error(`[STOP ERROR] Guild ${guildId}:`, error?.message || error);
      const errEmbed = createErrorEmbed({
        title: 'Stop Failed',
        description: 'An unexpected error occurred while stopping audio playback.',
      });
      return await sendResponse(context, { embeds: [errEmbed] });
    }
  },
};
