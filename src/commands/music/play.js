import { SlashCommandBuilder } from 'discord.js';
import { playbackLifecycleService } from '../../music/PlaybackLifecycleService.js';

export default {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Plays a song or URL from YouTube in your voice channel.')
    .addStringOption((option) =>
      option
        .setName('query')
        .setDescription('Song title or URL to search and play')
        .setRequired(true)
    ),
  category: 'Music',
  async execute(context, args) {
    const isSlash = typeof context.isChatInputCommand === 'function' && context.isChatInputCommand();

    let query = '';
    if (isSlash) {
      query = context.options.getString('query', true)?.trim();
    } else {
      query = Array.isArray(args) ? args.join(' ').trim() : String(args || '').trim();
    }

    return await playbackLifecycleService.executePlay({
      context,
      query,
      type: isSlash ? 'slash' : 'prefix',
    });
  },
};
