import { EmbedBuilder } from 'discord.js';

export const COLORS = Object.freeze({
  primary: 0x5865F2, // Discord Blurple
  success: 0x57F287, // Emerald / Mint Green
  warning: 0xFEE75C, // Amber / Warm Gold
  error: 0xED4245,   // Crimson / Coral Red
  latencyHealthy: 0x57F287,
  latencyModerate: 0xFEE75C,
  latencySlow: 0xED4245,
});

/**
 * Creates a base styled EmbedBuilder.
 *
 * @param {object} options
 * @param {string} [options.title]
 * @param {string} [options.description]
 * @param {number} [options.color]
 * @param {Array<{ name: string, value: string, inline?: boolean }>} [options.fields]
 * @param {string} [options.footer]
 * @param {boolean} [options.timestamp=true]
 * @returns {EmbedBuilder}
 */
export function createBaseEmbed({
  title,
  description,
  color = COLORS.primary,
  fields = [],
  footer,
  timestamp = true,
} = {}) {
  const embed = new EmbedBuilder().setColor(color);

  if (title) embed.setTitle(title);
  if (description) embed.setDescription(description);
  if (Array.isArray(fields) && fields.length > 0) {
    embed.addFields(fields);
  }
  if (footer) {
    embed.setFooter({ text: footer });
  }
  if (timestamp) {
    embed.setTimestamp();
  }

  return embed;
}

/**
 * Information state embed.
 */
export function createInfoEmbed({ title, description, fields, footer, timestamp = true } = {}) {
  return createBaseEmbed({
    title,
    description,
    color: COLORS.primary,
    fields,
    footer,
    timestamp,
  });
}

/**
 * Success state embed.
 */
export function createSuccessEmbed({ title = 'Success', description, fields, footer, timestamp = true } = {}) {
  return createBaseEmbed({
    title,
    description,
    color: COLORS.success,
    fields,
    footer,
    timestamp,
  });
}

/**
 * Warning state embed.
 */
export function createWarningEmbed({ title = 'Warning', description, fields, footer, timestamp = true } = {}) {
  return createBaseEmbed({
    title,
    description,
    color: COLORS.warning,
    fields,
    footer,
    timestamp,
  });
}

/**
 * Error state embed.
 */
export function createErrorEmbed({ title = 'Error', description = 'An unexpected error occurred.', fields, footer, timestamp = true } = {}) {
  return createBaseEmbed({
    title,
    description,
    color: COLORS.error,
    fields,
    footer,
    timestamp,
  });
}

/**
 * Formats a latency number in milliseconds.
 *
 * @param {number|null|undefined} ms
 * @param {object} [options]
 * @param {boolean} [options.isPending=false]
 * @returns {string}
 */
export function formatLatencyMs(ms, { isPending = false } = {}) {
  if (ms === null || (ms === undefined && isPending)) return 'Measuring...';
  if (ms === undefined) return 'N/A';
  if (typeof ms !== 'number' || isNaN(ms)) return 'N/A';
  if (ms < 1 && ms > 0) return `${ms.toFixed(1)}ms`;
  return `${Math.round(ms)}ms`;
}

/**
 * Ping / Latency embed.
 * Shows measured roundtrip latency, bot WebSocket heartbeat, diagnostic breakdown, and a justified health badge.
 *
 * @param {object} options
 * @param {number|null} options.roundtrip
 * @param {number} options.wsPing
 * @param {number|null} [options.receiveToExec]
 * @param {number|null} [options.execTime]
 * @param {number|null} [options.responseTime]
 * @returns {EmbedBuilder}
 */
export function createPingEmbed({
  roundtrip,
  wsPing,
  receiveToExec,
  execTime,
  responseTime,
}) {
  const isWsCalibrating = wsPing === -1;
  const wsText = isWsCalibrating ? 'Calibrating...' : `${wsPing}ms`;

  const isPending = roundtrip === null || roundtrip === undefined;
  const roundtripText = isPending ? 'Measuring...' : `${roundtrip}ms`;

  // Health assessment:
  // Healthy: wsPing < 150 && roundtrip < 250
  // Moderate: wsPing < 300 && roundtrip < 500
  // Slow: anything higher
  let statusBadge = '🟢 Healthy';
  let embedColor = COLORS.latencyHealthy;

  if (!isWsCalibrating && (wsPing >= 300 || (roundtrip !== null && roundtrip >= 500))) {
    statusBadge = '🔴 Slow';
    embedColor = COLORS.latencySlow;
  } else if (!isWsCalibrating && (wsPing >= 150 || (roundtrip !== null && roundtrip >= 250))) {
    statusBadge = '🟡 Moderate';
    embedColor = COLORS.latencyModerate;
  }

  const fields = [
    { name: 'WebSocket Ping', value: wsText, inline: true },
    { name: 'Response Send Time', value: formatLatencyMs(responseTime, { isPending }), inline: true },
    { name: 'Roundtrip Latency', value: roundtripText, inline: true },
    { name: 'Receive to Execution', value: formatLatencyMs(receiveToExec, { isPending }), inline: true },
    { name: 'Command Execution', value: formatLatencyMs(execTime, { isPending }), inline: true },
    { name: 'Health Status', value: statusBadge, inline: true },
  ];

  return createBaseEmbed({
    title: '🏓 Pong!',
    color: embedColor,
    fields,
    footer: 'Discord Music Bot • Performance Monitor',
    timestamp: true,
  });
}

/**
 * Unified response dispatcher supporting ChatInputCommandInteraction and Message contexts.
 *
 * @param {import('discord.js').ChatInputCommandInteraction | import('discord.js').Message} context
 * @param {object} payload - discord.js reply payload (e.g. { embeds, content, ephemeral })
 * @returns {Promise<any>}
 */
export async function sendResponse(context, payload) {
  if (typeof context.isChatInputCommand === 'function' && context.isChatInputCommand()) {
    if (context.deferred) {
      return await context.editReply(payload);
    }
    if (context.replied) {
      return await context.followUp(payload);
    }
    return await context.reply(payload);
  }

  // Fallback for Message context (prefix commands)
  return await context.reply(payload);
}
