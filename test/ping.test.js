import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import pingCommand from '../src/commands/ping.js';

describe('Ping Command', () => {
  test('exports valid slash command data and category', () => {
    assert.ok(pingCommand.data);
    assert.equal(pingCommand.data.name, 'ping');
    assert.ok(pingCommand.data.description);
    assert.equal(pingCommand.category, 'Utility');
    assert.equal(typeof pingCommand.execute, 'function');
  });

  test('executes in ChatInputCommandInteraction context with embeds', async () => {
    let initialPayload = null;
    let finalPayload = null;

    const mockInteraction = {
      isChatInputCommand: () => true,
      createdTimestamp: 1000,
      client: {
        ws: { ping: 42 },
      },
      reply: async (payload) => {
        initialPayload = payload;
        return { createdTimestamp: 1085 };
      },
      editReply: async (payload) => {
        finalPayload = payload;
        return payload;
      },
    };

    await pingCommand.execute(mockInteraction);

    assert.ok(initialPayload?.embeds?.length, 'Initial payload must contain embeds');
    assert.ok(finalPayload?.embeds?.length, 'Final payload must contain embeds');

    const embedData = finalPayload.embeds[0].toJSON();
    assert.ok(embedData.fields.some(f => f.name.includes('Roundtrip') && f.value.includes('85ms')));
    assert.ok(embedData.fields.some(f => f.name.includes('WebSocket') && f.value.includes('42ms')));
  });

  test('executes in Message context with embeds', async () => {
    let initialPayload = null;
    let finalPayload = null;

    const mockMessage = {
      isChatInputCommand: () => false,
      createdTimestamp: 2000,
      client: {
        ws: { ping: 65 },
      },
      reply: async (payload) => {
        initialPayload = payload;
        return {
          createdTimestamp: 2120,
          edit: async (editPayload) => {
            finalPayload = editPayload;
            return editPayload;
          },
        };
      },
    };

    await pingCommand.execute(mockMessage);

    assert.ok(initialPayload?.embeds?.length, 'Initial message must contain embeds');
    assert.ok(finalPayload?.embeds?.length, 'Edited message must contain embeds');

    const embedData = finalPayload.embeds[0].toJSON();
    assert.ok(embedData.fields.some(f => f.name.includes('Roundtrip') && f.value.includes('120ms')));
    assert.ok(embedData.fields.some(f => f.name.includes('WebSocket') && f.value.includes('65ms')));
  });
});
