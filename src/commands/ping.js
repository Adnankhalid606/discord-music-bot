import { SlashCommandBuilder } from 'discord.js';
import { createPingEmbed } from '../utils/embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Replies with Pong! and shows bot latency.'),
  category: 'Utility',
  async execute(context) {
    const isSlash = typeof context.isChatInputCommand === 'function' && context.isChatInputCommand();
    const wsPing = context.client?.ws?.ping ?? -1;

    // Send measuring state first
    const initialEmbed = createPingEmbed({ roundtrip: null, wsPing });

    if (isSlash) {
      const sent = await context.reply({
        embeds: [initialEmbed],
        fetchReply: true,
      });

      const latency = Math.max(0, sent.createdTimestamp - context.createdTimestamp);
      const finalEmbed = createPingEmbed({ roundtrip: latency, wsPing });

      await context.editReply({ embeds: [finalEmbed] });
    } else {
      const sent = await context.reply({ embeds: [initialEmbed] });
      const latency = Math.max(0, sent.createdTimestamp - context.createdTimestamp);
      const finalEmbed = createPingEmbed({ roundtrip: latency, wsPing });

      await sent.edit({ embeds: [finalEmbed] });
    }
  },
};
