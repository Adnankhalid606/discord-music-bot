import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Discovers and validates all command modules in the commands directory.
 *
 * @param {string} [customPath]
 * @returns {Promise<Array<object>>}
 */
export async function getCommandModules(customPath) {
  const commandsPath = customPath || join(__dirname, '..', 'commands');
  const validCommands = [];

  function getJsFilesRecursively(dir) {
    const entries = readdirSync(dir, { withFileTypes: true });
    let files = [];
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        files = files.concat(getJsFilesRecursively(fullPath));
      } else if (
        entry.isFile() &&
        entry.name.endsWith('.js') &&
        !entry.name.endsWith('.test.js') &&
        !entry.name.endsWith('.spec.js')
      ) {
        files.push(fullPath);
      }
    }
    return files;
  }

  const commandFiles = getJsFilesRecursively(commandsPath);

  for (const filePath of commandFiles) {
    try {
      const commandModule = await import(pathToFileURL(filePath).href);
      const command = commandModule.default || commandModule;

      if (command?.data && typeof command.execute === 'function') {
        validCommands.push(command);
      } else {
        console.warn(`[WARNING] Command at ${filePath} is missing required "data" or "execute" property.`);
      }
    } catch (err) {
      console.error(`[ERROR] Failed to load command file ${filePath}:`, err);
    }
  }

  return validCommands;
}

/**
 * Loads all discovered commands into client.commands collection.
 *
 * @param {import('discord.js').Client} client
 */
export async function loadCommands(client) {
  const commands = await getCommandModules();

  for (const command of commands) {
    client.commands.set(command.data.name, command);
  }
}
