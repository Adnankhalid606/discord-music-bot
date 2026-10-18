import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import pingCommand, { calculatePingTimings } from '../src/commands/utility/ping.js';

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
    assert.ok(embedData.fields.some(f => f.name.includes('Receive to Execution')));
    assert.ok(embedData.fields.some(f => f.name.includes('Command Execution')));
    assert.ok(embedData.fields.some(f => f.name.includes('Response Send Time')));
  });

  test('executes in Message context with embeds and diagnostic timings', async () => {
    let initialPayload = null;
    let finalPayload = null;

    const mockMessage = {
      isChatInputCommand: () => false,
      createdTimestamp: 2000,
      receivedAt: 2005,
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
    assert.ok(embedData.fields.some(f => f.name.includes('Receive to Execution')));
    assert.ok(embedData.fields.some(f => f.name.includes('Command Execution')));
    assert.ok(embedData.fields.some(f => f.name.includes('Response Send Time')));
  });

  describe('calculatePingTimings', () => {
    test('calculates accurate timings across all diagnostic stages', () => {
      const result = calculatePingTimings({
        receivedAt: 100,
        execStartTime: 102.5,
        responseStartTime: 105.0,
        responseEndTime: 525.0,
        execEndTime: 526.0,
        wsPing: 254,
        createdTimestamp: 1000,
        replyCreatedTimestamp: 1688,
      });

      assert.equal(result.receiveToExec, 2.5);
      // execTime = (105 - 102.5) + (526 - 525) = 2.5 + 1 = 3.5ms
      assert.equal(result.execTime, 3.5);
      // responseTime = 525 - 105 = 420ms
      assert.equal(result.responseTime, 420);
      assert.equal(result.wsPing, 254);
      assert.equal(result.roundtrip, 688);
    });

    test('handles fallback when receivedAt is missing but receivedTimestamp exists', () => {
      const now = Date.now();

      const result = calculatePingTimings({
        receivedTimestamp: now - 10,
        execStartTime: performance.now(),
        responseStartTime: 100,
        responseEndTime: 300,
        execEndTime: 301,
        wsPing: 120,
        createdTimestamp: 5000,
        replyCreatedTimestamp: 5250,
      });

      assert.ok(result.receiveToExec >= 5);
      assert.equal(result.responseTime, 200);
      assert.equal(result.roundtrip, 250);
    });
  });
});
