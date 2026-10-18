import 'dotenv/config';
import { normalize } from 'node:path';

const requiredKeys = ['DISCORD_TOKEN', 'CLIENT_ID', 'GUILD_ID'];
const missingKeys = requiredKeys.filter((key) => !process.env[key] || process.env[key].trim() === '');

if (missingKeys.length > 0) {
  console.error(`Error: Missing required environment variable(s): ${missingKeys.join(', ')}`);
  console.error('Please configure them in your .env file before starting the bot.');
  process.exit(1);
}

/**
 * Normalizes the yt-dlp executable path for cross-platform consistency.
 *
 * @param {string|undefined} rawPath
 * @returns {string}
 */
export function resolveYtDlpPath(rawPath) {
  if (!rawPath || typeof rawPath !== 'string' || !rawPath.trim()) {
    return 'yt-dlp';
  }
  return normalize(rawPath.trim());
}

export const config = Object.freeze({
  token: process.env.DISCORD_TOKEN.trim(),
  clientId: process.env.CLIENT_ID.trim(),
  guildId: process.env.GUILD_ID.trim(),
  prefix: process.env.PREFIX ? process.env.PREFIX.trim() : '!',
  ytDlpPath: resolveYtDlpPath(process.env.YT_DLP_PATH),
  commandTimingLogs: process.env.COMMAND_TIMING_LOGS === undefined
    ? true
    : process.env.COMMAND_TIMING_LOGS.trim().toLowerCase() !== 'false' && process.env.COMMAND_TIMING_LOGS.trim() !== '0',
});
