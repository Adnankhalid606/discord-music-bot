import { Events } from 'discord.js';
import { createErrorEmbed, sendResponse } from '../utils/embeds.js';
import { createCommandExecutionTimer } from '../utils/commandTimer.js';

export default {
  name: Events.InteractionCreate,
  async execute(interaction) {
    if (!interaction.isChatInputCommand()) return;

    // Record receipt timestamp immediately upon handler entry
    interaction.receivedTimestamp = Date.now();
    interaction.receivedAt = performance.now();

    const command = interaction.client.commands.get(interaction.commandName);

    if (!command) {
      console.error(`[INTERACTION] No command matching /${interaction.commandName} was found.`);
      const notFoundEmbed = createErrorEmbed({
        title: 'Command Not Found',
        description: `The command \`/${interaction.commandName}\` is not recognized.`,
      });
      await sendResponse(interaction, { embeds: [notFoundEmbed], ephemeral: true });
      return;
    }

    try {
      const timer = createCommandExecutionTimer({
        name: interaction.commandName,
        type: 'slash',
        context: interaction,
      });

      await timer.executeWithTiming((ctx) => command.execute(ctx));
    } catch (error) {
      console.error(`[INTERACTION ERROR] Error executing /${interaction.commandName}:`, error);
      const errorEmbed = createErrorEmbed({
        title: 'Command Execution Error',
        description: 'An unexpected error occurred while executing this command. Please try again later.',
      });

      try {
        await sendResponse(interaction, {
          embeds: [errorEmbed],
          ephemeral: true,
        });
      } catch (replyError) {
        console.error('[INTERACTION ERROR] Failed to send error response:', replyError);
      }
    }
  },
};
