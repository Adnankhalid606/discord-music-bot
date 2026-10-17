import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { formatDiscordApiError, prepareCommandPayloads } from '../src/scripts/deploy-commands.js';

describe('Deploy Commands Helper & Error Handling', () => {
  test('prepareCommandPayloads serializes command definitions to JSON', () => {
    const mockCommands = [
      {
        data: {
          name: 'testcmd',
          description: 'A test command',
          toJSON: () => ({ name: 'testcmd', description: 'A test command' }),
        },
        execute: async () => {},
      },
    ];

    const payloads = prepareCommandPayloads(mockCommands);
    assert.equal(payloads.length, 1);
    assert.equal(payloads[0].name, 'testcmd');
    assert.equal(payloads[0].description, 'A test command');
  });

  test('formatDiscordApiError provides actionable message for 401 Unauthorized', () => {
    const error = new Error('401: Unauthorized');
    error.status = 401;
    const msg = formatDiscordApiError(error);
    assert.ok(msg.includes('DISCORD_TOKEN'), 'Should mention DISCORD_TOKEN');
  });

  test('formatDiscordApiError provides actionable message for 50001 Missing Access', () => {
    const error = new Error('Missing Access');
    error.code = 50001;
    const msg = formatDiscordApiError(error);
    assert.ok(msg.includes('applications.commands') || msg.includes('GUILD_ID'), 'Should mention permissions/scope/guild');
  });

  test('formatDiscordApiError provides actionable message for 10004 Unknown Guild', () => {
    const error = new Error('Unknown Guild');
    error.code = 10004;
    const msg = formatDiscordApiError(error);
    assert.ok(msg.includes('GUILD_ID'), 'Should mention GUILD_ID');
  });

  test('formatDiscordApiError never reveals bot token', () => {
    const fakeToken = 'MTIzNDU2Nzg5.SecretToken.ABCXYZ';
    const error = new Error(`Failed with token ${fakeToken}`);
    const msg = formatDiscordApiError(error, fakeToken);
    assert.ok(!msg.includes(fakeToken), 'Error message must not include the token');
    assert.ok(msg.includes('[REDACTED_TOKEN]'), 'Error message must include redacted placeholder');
  });
});
