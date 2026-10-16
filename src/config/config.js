import 'dotenv/config';

const requiredKeys = ['DISCORD_TOKEN', 'CLIENT_ID', 'GUILD_ID'];
const missingKeys = requiredKeys.filter((key) => !process.env[key] || process.env[key].trim() === '');

if (missingKeys.length > 0) {
  console.error(`Error: Missing required environment variable(s): ${missingKeys.join(', ')}`);
  console.error('Please configure them in your .env file before starting the bot.');
  process.exit(1);
}

export const config = Object.freeze({
  token: process.env.DISCORD_TOKEN.trim(),
  clientId: process.env.CLIENT_ID.trim(),
  guildId: process.env.GUILD_ID.trim(),
  prefix: process.env.PREFIX ? process.env.PREFIX.trim() : '!',
});
