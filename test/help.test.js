import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from 'discord.js';
import helpCommand from '../src/commands/utility/help.js';
import { config } from '../src/config/config.js';

describe('Help Command', () => {
  test('exports valid slash command data and category', () => {
    assert.ok(helpCommand.data);
    assert.equal(helpCommand.data.name, 'help');
    assert.ok(helpCommand.data.description);
    assert.equal(helpCommand.category, 'Utility');
    assert.equal(typeof helpCommand.execute, 'function');
  });

  test('executes in ChatInputCommandInteraction and formats categories and dual invocation', async () => {
    let sentPayload = null;

    const mockCommands = new Collection();
    mockCommands.set('ping', {
      data: { name: 'ping', description: 'Replies with Pong!' },
      category: 'Utility',
    });
    mockCommands.set('help', {
      data: { name: 'help', description: 'Lists commands' },
      category: 'Utility',
    });

    const mockInteraction = {
      isChatInputCommand: () => true,
      client: {
        commands: mockCommands,
      },
      reply: async (payload) => {
        sentPayload = payload;
        return payload;
      },
    };

    await helpCommand.execute(mockInteraction);

    assert.ok(sentPayload?.embeds?.length, 'Must send embed');
    const embedData = sentPayload.embeds[0].toJSON();

    assert.ok(
      embedData.title.includes('Command Explorer') ||
      embedData.title.includes('Command Directory') ||
      embedData.title.includes('Help')
    );
    assert.ok(embedData.fields.some(f => f.name.includes('Utility')));

    const utilityField = embedData.fields.find(f => f.name.includes('Utility'));
    assert.ok(utilityField.value.includes('/ping'));
    assert.ok(utilityField.value.includes(`${config.prefix}ping`));
    assert.ok(utilityField.value.includes('/help'));
    assert.ok(utilityField.value.includes(`${config.prefix}help`));
  });

  test('executes in Message context with embed reply', async () => {
    let sentPayload = null;

    const mockCommands = new Collection();
    mockCommands.set('ping', {
      data: { name: 'ping', description: 'Replies with Pong!' },
      category: 'Utility',
    });

    const mockMessage = {
      isChatInputCommand: () => false,
      client: {
        commands: mockCommands,
      },
      reply: async (payload) => {
        sentPayload = payload;
        return payload;
      },
    };

    await helpCommand.execute(mockMessage);

    assert.ok(sentPayload?.embeds?.length, 'Must send embed for prefix message');
    const embedData = sentPayload.embeds[0].toJSON();
    assert.ok(embedData.fields.some((f) => f.value.includes(`${config.prefix}ping`)));
  });

  test('formats multiple categories and argument examples for commands with options', async () => {
    let sentPayload = null;

    const mockCommands = new Collection();
    mockCommands.set('ping', {
      data: { name: 'ping', description: 'Replies with Pong!', options: [] },
      category: 'Utility',
    });
    mockCommands.set('join', {
      data: { name: 'join', description: 'Joins voice', options: [] },
      category: 'Voice',
    });
    mockCommands.set('play', {
      data: {
        name: 'play',
        description: 'Plays music from YouTube',
        options: [{ name: 'query', description: 'Song to play', required: true }],
      },
      category: 'Music',
    });
    mockCommands.set('playfile', {
      data: {
        name: 'playfile',
        description: 'Plays local audio',
        options: [{ name: 'file', description: 'File name', required: true }],
      },
      category: 'Music',
    });

    const mockInteraction = {
      isChatInputCommand: () => true,
      client: {
        commands: mockCommands,
      },
      reply: async (payload) => {
        sentPayload = payload;
        return payload;
      },
    };

    await helpCommand.execute(mockInteraction);

    assert.ok(sentPayload?.embeds?.length);
    const embed = sentPayload.embeds[0].toJSON();

    // Verify all 3 category sections are present
    assert.ok(embed.fields.some((f) => f.name.includes('Utility')));
    assert.ok(embed.fields.some((f) => f.name.includes('Voice')));
    assert.ok(embed.fields.some((f) => f.name.includes('Music')));

    const musicField = embed.fields.find((f) => f.name.includes('Music'));
    // Verify examples are included for play and playfile
    assert.ok(musicField.value.includes('/play query:Bohemian Rhapsody'));
    assert.ok(musicField.value.includes('/playfile file:sample.mp3'));
    assert.ok(musicField.value.includes(`${config.prefix}play Bohemian Rhapsody`));
    assert.ok(musicField.value.includes(`${config.prefix}playfile sample.mp3`));

    // Verify footer displays server prefix and total command count
    assert.ok(embed.footer.text.includes(`Server Prefix: ${config.prefix}`));
    assert.ok(embed.footer.text.includes('Total Commands: 4'));
  });
});
