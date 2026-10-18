import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  COLORS,
  createBaseEmbed,
  createInfoEmbed,
  createSuccessEmbed,
  createWarningEmbed,
  createErrorEmbed,
  createPingEmbed,
  formatLatencyMs,
  sendResponse,
} from '../src/utils/embeds.js';

describe('Embed Utilities', () => {
  test('COLORS defines expected semantic color codes', () => {
    assert.equal(typeof COLORS.primary, 'number');
    assert.equal(typeof COLORS.success, 'number');
    assert.equal(typeof COLORS.warning, 'number');
    assert.equal(typeof COLORS.error, 'number');
    assert.equal(typeof COLORS.latencyHealthy, 'number');
    assert.equal(typeof COLORS.latencyModerate, 'number');
    assert.equal(typeof COLORS.latencySlow, 'number');
  });

  test('createBaseEmbed creates an EmbedBuilder with title, description, and color', () => {
    const embed = createBaseEmbed({
      title: 'Test Title',
      description: 'Test Description',
      color: COLORS.primary,
      footer: 'Test Footer',
    });

    const data = embed.toJSON();
    assert.equal(data.title, 'Test Title');
    assert.equal(data.description, 'Test Description');
    assert.equal(data.color, COLORS.primary);
    assert.equal(data.footer?.text, 'Test Footer');
    assert.ok(data.timestamp, 'Timestamp should be included by default');
  });

  test('createSuccessEmbed uses success color and optional title', () => {
    const embed = createSuccessEmbed({
      title: 'Success!',
      description: 'Operation completed.',
    });
    const data = embed.toJSON();
    assert.equal(data.color, COLORS.success);
    assert.equal(data.title, 'Success!');
    assert.equal(data.description, 'Operation completed.');
  });

  test('createErrorEmbed defaults to Error title and uses error color', () => {
    const embed = createErrorEmbed({
      description: 'Something failed.',
    });
    const data = embed.toJSON();
    assert.equal(data.color, COLORS.error);
    assert.equal(data.title, 'Error');
    assert.equal(data.description, 'Something failed.');
  });

  test('createPingEmbed formats healthy, moderate, and slow latencies with badges', () => {
    const healthyEmbed = createPingEmbed({ roundtrip: 80, wsPing: 45 }).toJSON();
    assert.equal(healthyEmbed.color, COLORS.latencyHealthy);
    assert.ok(healthyEmbed.fields.some(f => f.name.includes('WebSocket') && f.value.includes('45ms')));
    assert.ok(healthyEmbed.fields.some(f => f.name.includes('Roundtrip') && f.value.includes('80ms')));
    assert.ok(healthyEmbed.fields.some(f => f.name.includes('Status') && f.value.includes('Healthy')));

    const slowEmbed = createPingEmbed({ roundtrip: 450, wsPing: 320 }).toJSON();
    assert.equal(slowEmbed.color, COLORS.latencySlow);
    assert.ok(slowEmbed.fields.some(f => f.name.includes('Status') && f.value.includes('Slow')));
  });

  test('formatLatencyMs formats milliseconds correctly across ranges', () => {
    assert.equal(formatLatencyMs(null), 'Measuring...');
    assert.equal(formatLatencyMs(undefined, { isPending: true }), 'Measuring...');
    assert.equal(formatLatencyMs(undefined, { isPending: false }), 'N/A');
    assert.equal(formatLatencyMs('not-a-number'), 'N/A');
    assert.equal(formatLatencyMs(0), '0ms');
    assert.equal(formatLatencyMs(0.4), '0.4ms');
    assert.equal(formatLatencyMs(1.2), '1ms');
    assert.equal(formatLatencyMs(254), '254ms');
  });

  test('createPingEmbed renders all diagnostic timings fields', () => {
    const embed = createPingEmbed({
      roundtrip: 688,
      wsPing: 254,
      receiveToExec: 0.8,
      execTime: 1.5,
      responseTime: 420,
    }).toJSON();

    assert.equal(embed.fields.length, 6);
    assert.ok(embed.fields.some(f => f.name === 'WebSocket Ping' && f.value === '254ms'));
    assert.ok(embed.fields.some(f => f.name === 'Response Send Time' && f.value === '420ms'));
    assert.ok(embed.fields.some(f => f.name === 'Roundtrip Latency' && f.value === '688ms'));
    assert.ok(embed.fields.some(f => f.name === 'Receive to Execution' && f.value === '0.8ms'));
    assert.ok(embed.fields.some(f => f.name === 'Command Execution' && f.value === '2ms'));
    assert.ok(embed.fields.some(f => f.name === 'Health Status' && f.value.includes('Slow')));
  });

  test('sendResponse handles ChatInputCommandInteraction (not deferred/replied)', async () => {
    let replyPayload = null;
    const mockInteraction = {
      isChatInputCommand: () => true,
      deferred: false,
      replied: false,
      reply: async (payload) => {
        replyPayload = payload;
        return payload;
      },
    };

    const embed = createInfoEmbed({ description: 'Testing info' });
    await sendResponse(mockInteraction, { embeds: [embed] });

    assert.ok(replyPayload);
    assert.equal(replyPayload.embeds.length, 1);
  });

  test('sendResponse handles ChatInputCommandInteraction when already deferred', async () => {
    let editPayload = null;
    const mockInteraction = {
      isChatInputCommand: () => true,
      deferred: true,
      replied: false,
      editReply: async (payload) => {
        editPayload = payload;
        return payload;
      },
    };

    const embed = createInfoEmbed({ description: 'Deferred update' });
    await sendResponse(mockInteraction, { embeds: [embed] });

    assert.ok(editPayload);
    assert.equal(editPayload.embeds.length, 1);
  });

  test('sendResponse handles Message context', async () => {
    let replyPayload = null;
    const mockMessage = {
      reply: async (payload) => {
        replyPayload = payload;
        return payload;
      },
    };

    const embed = createInfoEmbed({ description: 'Prefix command reply' });
    await sendResponse(mockMessage, { embeds: [embed] });

    assert.ok(replyPayload);
    assert.equal(replyPayload.embeds.length, 1);
  });
});
