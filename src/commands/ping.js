import { SlashCommandBuilder } from 'discord.js';
import { createPingEmbed } from '../utils/embeds.js';

/**
 * Calculates diagnostic latency and execution timings for the ping command.
 *
 * @param {object} params
 * @param {number|null} [params.receivedAt] - performance.now() timestamp when bot received event
 * @param {number|null} [params.receivedTimestamp] - Date.now() timestamp when bot received event
 * @param {number} params.execStartTime - performance.now() timestamp when execute began
 * @param {number} params.responseStartTime - performance.now() timestamp before response send
 * @param {number} params.responseEndTime - performance.now() timestamp after response send
 * @param {number} params.execEndTime - performance.now() timestamp after local processing finished
 * @param {number} [params.wsPing=-1] - WebSocket heartbeat ping from client.ws.ping
 * @param {number} [params.createdTimestamp] - Discord snowflake timestamp of invoking message/interaction
 * @param {number} [params.replyCreatedTimestamp] - Discord snowflake timestamp of reply message
 * @returns {{
 *   receiveToExec: number,
 *   execTime: number,
 *   responseTime: number,
 *   wsPing: number,
 *   roundtrip: number|null,
 * }}
 */
export function calculatePingTimings({
  receivedAt,
  receivedTimestamp,
  execStartTime,
  responseStartTime,
  responseEndTime,
  execEndTime,
  wsPing = -1,
  createdTimestamp,
  replyCreatedTimestamp,
}) {
  // 1. Time from receiving the Discord message to starting command execution
  let receiveToExec = 0;
  if (typeof receivedAt === 'number' && typeof execStartTime === 'number') {
    receiveToExec = Math.max(0, execStartTime - receivedAt);
  } else if (typeof receivedTimestamp === 'number') {
    receiveToExec = Math.max(0, Date.now() - receivedTimestamp);
  }

  // 2. Command execution time (local processing time excluding network wait)
  let execTime = 0;
  if (
    typeof execStartTime === 'number' &&
    typeof responseStartTime === 'number' &&
    typeof responseEndTime === 'number' &&
    typeof execEndTime === 'number'
  ) {
    execTime = Math.max(
      0,
      (responseStartTime - execStartTime) + (execEndTime - responseEndTime)
    );
  }

  // 3. Time to send the Discord response (HTTP REST API roundtrip)
  let responseTime = 0;
  if (typeof responseStartTime === 'number' && typeof responseEndTime === 'number') {
    responseTime = Math.max(0, responseEndTime - responseStartTime);
  }

  // 4. Discord gateway WebSocket ping
  const resolvedWsPing = typeof wsPing === 'number' ? wsPing : -1;

  // Snowflake Roundtrip latency (end-to-end snowflake difference)
  let roundtrip = null;
  if (
    typeof replyCreatedTimestamp === 'number' &&
    typeof createdTimestamp === 'number'
  ) {
    roundtrip = Math.max(0, replyCreatedTimestamp - createdTimestamp);
  }

  return {
    receiveToExec: Number(receiveToExec.toFixed(2)),
    execTime: Number(execTime.toFixed(2)),
    responseTime: Math.round(responseTime),
    wsPing: resolvedWsPing,
    roundtrip,
  };
}

export default {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Replies with Pong! and shows bot latency.'),
  category: 'Utility',
  async execute(context) {
    const execStartTime = performance.now();
    const isSlash = typeof context.isChatInputCommand === 'function' && context.isChatInputCommand();
    const wsPing = context.client?.ws?.ping ?? -1;

    // Time from receiving the Discord message to starting command execution
    const receivedAt = context.receivedAt;
    const receivedTimestamp = context.receivedTimestamp;
    let receiveToExec = 0;
    if (typeof receivedAt === 'number') {
      receiveToExec = Math.max(0, execStartTime - receivedAt);
    } else if (typeof receivedTimestamp === 'number') {
      receiveToExec = Math.max(0, Date.now() - receivedTimestamp);
    }

    // Send measuring state first
    const initialEmbed = createPingEmbed({
      roundtrip: null,
      wsPing,
      receiveToExec,
      execTime: null,
      responseTime: null,
    });

    const responseStartTime = performance.now();
    let sent;
    if (isSlash) {
      sent = await context.reply({
        embeds: [initialEmbed],
        fetchReply: true,
      });
    } else {
      sent = await context.reply({ embeds: [initialEmbed] });
    }
    const responseEndTime = performance.now();
    const execEndTime = performance.now();

    const timings = calculatePingTimings({
      receivedAt,
      receivedTimestamp,
      execStartTime,
      responseStartTime,
      responseEndTime,
      execEndTime,
      wsPing,
      createdTimestamp: context.createdTimestamp,
      replyCreatedTimestamp: sent?.createdTimestamp,
    });

    const finalEmbed = createPingEmbed(timings);

    if (isSlash) {
      await context.editReply({ embeds: [finalEmbed] });
    } else {
      await sent.edit({ embeds: [finalEmbed] });
    }
  },
};
