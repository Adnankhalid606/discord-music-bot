import { REST, Routes } from 'discord.js';
import { fileURLToPath } from 'node:url';
import { config } from '../config/config.js';
import { getCommandModules } from '../handlers/commandHandler.js';

/**
 * Transforms loaded command modules into REST-ready JSON payloads.
 *
 * @param {Array<object>} commandModules
 * @returns {Array<object>}
 */
export function prepareCommandPayloads(commandModules) {
  return commandModules
    .filter((cmd) => cmd?.data && typeof cmd.execute === 'function')
    .map((cmd) => cmd.data.toJSON());
}

/**
 * Maps Discord API errors or HTTP statuses to actionable troubleshooting instructions.
 * Also ensures any token strings are redacted.
 *
 * @param {any} error
 * @returns {string}
 */
export function formatDiscordApiError(error, customToken = config.token) {
  let rawMessage = error?.message || String(error);
  if (customToken) {
    rawMessage = rawMessage.replaceAll(customToken, '[REDACTED_TOKEN]');
  }
  if (config.token && config.token !== customToken) {
    rawMessage = rawMessage.replaceAll(config.token, '[REDACTED_TOKEN]');
  }

  const code = error?.code;
  const status = error?.status;

  let advice = '';

  if (status === 401 || rawMessage.includes('401') || code === 0) {
    advice = 'Reason: Invalid or expired DISCORD_TOKEN.\nAction: Check your .env file and ensure DISCORD_TOKEN matches the bot token in the Discord Developer Portal under Applications -> [Your App] -> Bot.';
  } else if (code === 50001 || status === 403 || rawMessage.includes('Missing Access')) {
    advice = `Reason: Missing Access in Guild (${config.guildId}).\nAction:\n1. Verify the bot is a member of server ID ${config.guildId}.\n2. Ensure your bot was invited with the 'applications.commands' scope enabled in Discord Developer Portal -> OAuth2 -> URL Generator.\n3. Verify your CLIENT_ID (${config.clientId}) matches the application.`;
  } else if (code === 10004 || status === 404 || rawMessage.includes('Unknown Guild')) {
    advice = `Reason: Server with GUILD_ID ${config.guildId} was not found.\nAction: Enable Developer Mode in Discord Settings -> Advanced, right-click your server icon to Copy ID, and update GUILD_ID in .env.`;
  } else if (code === 50035 || rawMessage.includes('Invalid Form Body')) {
    advice = 'Reason: Discord rejected one or more command structures.\nAction: Verify command names are all-lowercase, 1-32 characters, and descriptions are 1-100 characters.';
  } else if (code === 20012) {
    advice = 'Reason: Unauthorized application operation.\nAction: CLIENT_ID in .env does not match the bot token application.';
  } else {
    advice = 'Action: Check your network connection, .env configuration, and Discord Developer Portal status.';
  }

  return `Discord API Error (${code ? `Code: ${code}, ` : ''}${status ? `Status: ${status}` : ''}):\n${rawMessage}\n\nTroubleshooting:\n${advice}`;
}

/**
 * Deploys slash commands directly to the configured development guild.
 */
export async function deployCommands() {
  console.log(`[DEPLOY] Loading command definitions from runtime source...`);
  const commandModules = await getCommandModules();
  const commands = prepareCommandPayloads(commandModules);
  const commandNames = commands.map((c) => `/${c.name}`);

  if (commands.length === 0) {
    console.warn('[DEPLOY WARNING] No valid commands found to register.');
    return;
  }

  console.log(`[DEPLOY] Target Guild ID: ${config.guildId}`);
  console.log(`[DEPLOY] Application Client ID: ${config.clientId}`);
  console.log(`[DEPLOY] Commands to register (${commands.length}): ${commandNames.join(', ')}`);

  const rest = new REST().setToken(config.token);

  try {
    console.log(`[DEPLOY] Registering commands with Discord REST API...`);

    // Using applicationGuildCommands to target development guild
    const data = await rest.put(
      Routes.applicationGuildCommands(config.clientId, config.guildId),
      { body: commands },
    );

    if (Array.isArray(data)) {
      const returnedNames = data.map((cmd) => `/${cmd.name}`);
      console.log(`[SUCCESS] Successfully registered and verified ${data.length} slash command(s) in guild ${config.guildId}:`);
      for (const cmd of data) {
        console.log(`  • /${cmd.name} (ID: ${cmd.id}) - ${cmd.description}`);
      }

      // Check if all requested commands are registered
      const missing = commandNames.filter((name) => !returnedNames.includes(name));
      if (missing.length > 0) {
        console.warn(`[WARNING] Some commands may not have been returned by Discord: ${missing.join(', ')}`);
      }
    } else {
      console.log('[SUCCESS] Commands deployed successfully.');
    }
  } catch (error) {
    console.error('\n[DEPLOY ERROR] Failed to deploy application commands:');
    console.error(formatDiscordApiError(error));
    process.exit(1);
  }
}

// Execute directly if run as a script
const isMain = process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === process.argv[1].toLowerCase();
if (isMain) {
  deployCommands().catch((err) => {
    console.error('[UNCAUGHT ERROR]', err);
    process.exit(1);
  });
}
