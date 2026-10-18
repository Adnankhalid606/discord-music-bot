import { Events } from 'discord.js';
import { config } from '../config/config.js';
import { createErrorEmbed, sendResponse } from '../utils/embeds.js';

export default {
  name: Events.MessageCreate,
  async execute(message) {
    // Record receipt timestamp immediately upon handler entry
    message.receivedTimestamp = Date.now();
    message.receivedAt = performance.now();

    // Ignore bot messages and messages outside guilds
    if (message.author?.bot || !message.guild) return;

    const prefix = config.prefix;

    // Avoid responding to ordinary messages that do not start with the prefix
    if (!message.content.startsWith(prefix)) return;

    // Parse the command name and remaining arguments
    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const commandName = args.shift()?.toLowerCase();

    if (!commandName) return;

    // Match command names case-insensitively
    const command = message.client.commands.get(commandName);

    // Handle unknown commands without crashing
    if (!command) return;

    // Prevent unhandled exceptions from command execution
    try {
      await command.execute(message, args);
    } catch (error) {
      console.error(`[PREFIX ERROR] Error executing command "${commandName}":`, error);
      try {
        const errorEmbed = createErrorEmbed({
          title: 'Command Execution Error',
          description: 'An unexpected error occurred while executing this command. Please try again later.',
        });
        await sendResponse(message, { embeds: [errorEmbed] });
      } catch (replyError) {
        console.error('[PREFIX ERROR] Failed to send error reply:', replyError);
      }
    }
  },
};
