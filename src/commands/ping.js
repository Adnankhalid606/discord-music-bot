import { SlashCommandBuilder } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Replies with Pong! and shows bot latency.'),
  async execute(context) {
    if (context.isChatInputCommand && context.isChatInputCommand()) {
      const sent = await context.reply({ content: 'Pinging...', fetchReply: true });
      const latency = sent.createdTimestamp - context.createdTimestamp;
      const wsPing = context.client.ws.ping;
      await context.editReply(`Pong! Roundtrip latency: ${latency}ms. WebSocket ping: ${wsPing}ms.`);
    } else {
      const sent = await context.reply('Pinging...');
      const latency = sent.createdTimestamp - context.createdTimestamp;
      const wsPing = context.client.ws.ping;
      await sent.edit(`Pong! Roundtrip latency: ${latency}ms. WebSocket ping: ${wsPing}ms.`);
    }
  },
};
