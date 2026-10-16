import { Events } from 'discord.js';
import { config } from '../config/config.js';

export default {
  name: Events.MessageCreate,
  async execute(message) {
    // Ignore bot messages and messages outside guilds
    if (message.author.bot || !message.guild) return;

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
      console.error(`Error executing prefix command ${commandName}:`, error);
      try {
        await message.reply('There was an error while executing this command!');
      } catch (replyError) {
        console.error('Failed to send error reply:', replyError);
      }
    }
  },
};
