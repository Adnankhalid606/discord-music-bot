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
    .setName('resume')
    .setDescription('Resumes paused audio playback.'),
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
      const result = audioPlayerManager.resume(guildId);

      if (!result.success) {
        const infoEmbed = createInfoEmbed({
          title: 'Not Paused',
          description: 'Audio playback is not currently paused.',
        });
        return await sendResponse(context, { embeds: [infoEmbed] });
      }

      const successEmbed = createSuccessEmbed({
        title: 'Playback Resumed',
        description: `▶️ Resumed **${result.track || 'audio'}**.`,
      });
      return await sendResponse(context, { embeds: [successEmbed] });
    } catch (error) {
      console.error(`[RESUME ERROR] Guild ${guildId}:`, error?.message || error);
      const errEmbed = createErrorEmbed({
        title: 'Resume Failed',
        description: 'An unexpected error occurred while resuming audio playback.',
      });
      return await sendResponse(context, { embeds: [errEmbed] });
    }
  },
};
