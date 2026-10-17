import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from 'discord.js';
import helpCommand from '../src/commands/help.js';
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

    assert.ok(embedData.title.includes('Command Directory') || embedData.title.includes('Help'));
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
    assert.ok(embedData.fields.some(f => f.value.includes(`${config.prefix}ping`)));
  });
});
