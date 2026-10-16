import { SlashCommandBuilder } from 'discord.js';
import { config } from '../config/config.js';

export default {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Lists implemented commands and explains their purpose.'),
  async execute(context) {
    const commands = context.client.commands;
    const prefix = config.prefix;

    const commandList = Array.from(commands.values())
      .map((cmd) => `\`/${cmd.data.name}\` or \`${prefix}${cmd.data.name}\`\n  ${cmd.data.description}`)
      .join('\n\n');

    const content = `**Available Commands:**\n\n${commandList || 'No commands found.'}`;

    if (context.isChatInputCommand && context.isChatInputCommand()) {
      await context.reply({
        content,
        ephemeral: true,
      });
    } else {
      await context.reply(content);
    }
  },
};
