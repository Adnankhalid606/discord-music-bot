import { Events } from 'discord.js';
import { config } from '../config/config.js';

export default {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    console.log(`Ready! Logged in as ${client.user.tag}`);
    console.log(`[CONFIG] yt-dlp executable path configured as: "${config.ytDlpPath}"`);
  },
};
