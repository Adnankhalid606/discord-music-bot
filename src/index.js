import { Client, Collection, GatewayIntentBits } from 'discord.js';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { config } from './config/config.js';
import { loadCommands } from './handlers/commandHandler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function startBot() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildVoiceStates,
    ],
  });

  client.commands = new Collection();

  // Load slash commands
  await loadCommands(client);

  // Load events
  const eventsPath = join(__dirname, 'events');
  const eventFiles = readdirSync(eventsPath).filter((file) => file.endsWith('.js'));

  for (const file of eventFiles) {
    const filePath = join(eventsPath, file);
    const eventModule = await import(pathToFileURL(filePath).href);
    const event = eventModule.default || eventModule;

    if (event?.name && typeof event.execute === 'function') {
      if (event.once) {
        client.once(event.name, (...args) => event.execute(...args));
      } else {
        client.on(event.name, (...args) => event.execute(...args));
      }
    }
  }

  // Connect client
  try {
    await client.login(config.token);
  } catch (error) {
    console.error('Failed to authenticate with Discord. Please check your DISCORD_TOKEN.');
    process.exit(1);
  }
}

startBot().catch((err) => {
  console.error('Unexpected error during initialization:', err.message || 'Unknown error');
  process.exit(1);
});
