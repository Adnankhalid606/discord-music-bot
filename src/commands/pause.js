import { SlashCommandBuilder } from 'discord.js';
import { audioPlayerManager } from '../music/AudioPlayerManager.js';
import {
  createSuccessEmbed,
  createInfoEmbed,
  createErrorEmbed,
  sendResponse,
} from '../utils/embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('pause')
    .setDescription('Pauses current audio playback.'),
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
      const result = audioPlayerManager.pause(guildId);

      if (!result.success) {
        if (result.reason === 'ALREADY_PAUSED') {
          const infoEmbed = createInfoEmbed({
            title: 'Already Paused',
            description: `Playback for **${result.track || 'current track'}** is already paused.\nUse \`/resume\` to continue playing.`,
          });
          return await sendResponse(context, { embeds: [infoEmbed] });
        }

        const infoEmbed = createInfoEmbed({
          title: 'Not Playing',
          description: 'There is no audio currently playing in this server.',
        });
        return await sendResponse(context, { embeds: [infoEmbed] });
      }

      const successEmbed = createSuccessEmbed({
        title: 'Playback Paused',
        description: `⏸️ Paused **${result.track || 'audio'}**.\nUse \`/resume\` to continue playback.`,
      });
      return await sendResponse(context, { embeds: [successEmbed] });
    } catch (error) {
      console.error(`[PAUSE ERROR] Guild ${guildId}:`, error?.message || error);
      const errEmbed = createErrorEmbed({
        title: 'Pause Failed',
        description: 'An unexpected error occurred while pausing audio playback.',
      });
      return await sendResponse(context, { embeds: [errEmbed] });
    }
  },
};
