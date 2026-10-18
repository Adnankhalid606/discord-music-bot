import { SlashCommandBuilder } from 'discord.js';
import { config } from '../../config/config.js';
import { createInfoEmbed, sendResponse } from '../../utils/embeds.js';

// Consistent category presentation metadata
const CATEGORY_META = {
  Utility: {
    emoji: '🛠️',
    label: 'Utility Commands',
    order: 1,
  },
  Voice: {
    emoji: '🎙️',
    label: 'Voice Channel',
    order: 2,
  },
  Music: {
    emoji: '🎵',
    label: 'Music & Audio',
    order: 3,
  },
};

/**
 * Builds a formatted syntax and usage line for a command dynamically from its data.
 *
 * @param {object} cmd
 * @param {string} prefix
 * @returns {string}
 */
export function formatCommandDetail(cmd, prefix) {
  const options = cmd.data?.options || [];
  const requiredOptions = options.filter((opt) => opt.required);

  let slashSyntax = `\`/${cmd.data.name}`;
  let prefixSyntax = `\`${prefix}${cmd.data.name}`;

  if (options.length > 0) {
    const slashArgs = options
      .map((opt) => (opt.required ? `<${opt.name}>` : `[${opt.name}]`))
      .join(' ');
    slashSyntax += ` ${slashArgs}\``;

    const prefixArgs = options
      .map((opt) => (opt.required ? `<${opt.name}>` : `[${opt.name}]`))
      .join(' ');
    prefixSyntax += ` ${prefixArgs}\``;
  } else {
    slashSyntax += '`';
    prefixSyntax += '`';
  }

  let line = `${slashSyntax} • ${prefixSyntax}\n${cmd.data.description}`;

  // Add helpful example if command takes arguments
  if (options.length > 0) {
    let example = '';
    if (cmd.data.name === 'play') {
      example = `\`/play query:Bohemian Rhapsody\` or \`${prefix}play Bohemian Rhapsody\``;
    } else if (cmd.data.name === 'playfile') {
      example = `\`/playfile file:sample.mp3\` or \`${prefix}playfile sample.mp3\``;
    } else {
      const sampleArgs = options.map((opt) => opt.name).join(' ');
      example = `\`${prefix}${cmd.data.name} <${sampleArgs}>\``;
    }
    line += `\n*Example:* ${example}`;
  }

  return line;
}

export default {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Lists implemented commands and explains their purpose.'),
  category: 'Utility',
  async execute(context) {
    const isSlash = typeof context.isChatInputCommand === 'function' && context.isChatInputCommand();
    const commands = context.client?.commands || new Map();
    const prefix = config.prefix;

    // Group commands dynamically by category
    const categories = new Map();

    for (const cmd of commands.values()) {
      if (!cmd?.data?.name) continue;
      const cat = cmd.category || 'General';
      if (!categories.has(cat)) {
        categories.set(cat, []);
      }
      categories.get(cat).push(cmd);
    }

    // Sort categories using metadata order or alphabetical
    const sortedCategories = Array.from(categories.entries()).sort(([a], [b]) => {
      const orderA = CATEGORY_META[a]?.order ?? 99;
      const orderB = CATEGORY_META[b]?.order ?? 99;
      return orderA - orderB || a.localeCompare(b);
    });

    const fields = [];
    for (const [categoryName, cmdList] of sortedCategories) {
      const meta = CATEGORY_META[categoryName] || {
        emoji: '📌',
        label: `${categoryName} Commands`,
      };

      const formattedList = cmdList
        .map((cmd) => formatCommandDetail(cmd, prefix))
        .join('\n\n');

      fields.push({
        name: `${meta.emoji} ${meta.label}`,
        value: formattedList || 'No commands listed.',
        inline: false,
      });
    }

    const totalCommands = commands.size || commands.length || 0;

    const helpEmbed = createInfoEmbed({
      title: '🎵 Discord Music Bot • Command Explorer',
      description:
        'High-performance Discord music bot with high-fidelity local and online playback.\n' +
        `Invoke commands using slash syntax (\`/command\`) or server prefix (\`${prefix}command\`).`,
      fields: fields.length > 0 ? fields : [{ name: 'Commands', value: 'No commands loaded.' }],
      footer: `Server Prefix: ${prefix} • Total Commands: ${totalCommands}`,
      timestamp: true,
    });

    await sendResponse(context, {
      embeds: [helpEmbed],
      ephemeral: isSlash,
    });
  },
};
