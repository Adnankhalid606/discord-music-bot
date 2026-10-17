import { SlashCommandBuilder } from 'discord.js';
import { config } from '../config/config.js';
import { createInfoEmbed, sendResponse } from '../utils/embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Lists implemented commands and explains their purpose.'),
  category: 'Utility',
  async execute(context) {
    const isSlash = typeof context.isChatInputCommand === 'function' && context.isChatInputCommand();
    const commands = context.client?.commands || new Map();
    const prefix = config.prefix;

    // Group commands by category
    const categories = new Map();

    for (const cmd of commands.values()) {
      if (!cmd?.data?.name) continue;
      const cat = cmd.category || 'General';
      if (!categories.has(cat)) {
        categories.set(cat, []);
      }
      categories.get(cat).push(cmd);
    }

    const fields = [];
    for (const [categoryName, cmdList] of categories.entries()) {
      const formattedList = cmdList
        .map((cmd) => `\`/${cmd.data.name}\` • \`${prefix}${cmd.data.name}\`\n  ${cmd.data.description}`)
        .join('\n\n');

      fields.push({
        name: `📌 ${categoryName}`,
        value: formattedList || 'No commands listed.',
        inline: false,
      });
    }

    const helpEmbed = createInfoEmbed({
      title: '📖 Bot Command Directory',
      description: `Commands can be invoked using either slash syntax (\`/command\`) or the server prefix (\`${prefix}command\`).`,
      fields: fields.length > 0 ? fields : [{ name: 'Commands', value: 'No commands loaded.' }],
      footer: `Server Prefix: ${prefix} • Total Commands: ${commands.size || commands.length || 0}`,
      timestamp: true,
    });

    await sendResponse(context, {
      embeds: [helpEmbed],
      ephemeral: isSlash,
    });
  },
};
