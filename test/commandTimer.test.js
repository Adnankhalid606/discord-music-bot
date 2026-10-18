import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from 'discord.js';
import { createCommandExecutionTimer, sanitizeLogValue } from '../src/utils/commandTimer.js';
import messageCreateEvent from '../src/events/messageCreate.js';
import interactionCreateEvent from '../src/events/interactionCreate.js';

describe('Command Execution Timer & Diagnostics', () => {
  describe('sanitizeLogValue', () => {
    test('cleans whitespace, newlines, and tabs safely', () => {
      assert.equal(sanitizeLogValue('My\nServer\tName\r'), 'My Server Name');
      assert.equal(sanitizeLogValue(null), '');
      assert.equal(sanitizeLogValue(undefined), '');
      assert.equal(sanitizeLogValue('  normal text  '), 'normal text');
    });
  });

  describe('createCommandExecutionTimer', () => {
    test('logs start and success with correct timing format for prefix command', async () => {
      const logs = [];
      const logWriter = (msg) => logs.push(msg);

      const mockMessage = {
        guild: { name: 'MusicGuild' },
        receivedAt: 100,
        reply: async (payload) => payload,
      };

      const timer = createCommandExecutionTimer({
        name: 'help',
        type: 'prefix',
        context: mockMessage,
        logWriter,
        enabled: true,
      });

      await timer.executeWithTiming(async (ctx) => {
        await ctx.reply({ content: 'help message' });
        return 'done';
      });

      assert.equal(logs.length, 2, 'Should emit exactly two log lines: START and END');
      assert.ok(logs[0].startsWith('[CMD START] name=help type=prefix guild=MusicGuild'));
      assert.ok(logs[1].startsWith('[CMD END] name=help type=prefix'));
      assert.ok(logs[1].includes('execution='));
      assert.ok(logs[1].includes('total='));
      assert.ok(logs[1].includes('response='));
      assert.ok(logs[1].includes('status=success'));
    });

    test('logs failure with sanitized reason when command throws', async () => {
      const logs = [];
      const logWriter = (msg) => logs.push(msg);

      const mockContext = {
        guild: { name: 'TestServer' },
      };

      const timer = createCommandExecutionTimer({
        name: 'play',
        type: 'slash',
        context: mockContext,
        logWriter,
        enabled: true,
      });

      await assert.rejects(
        () => timer.executeWithTiming(async () => {
          throw new Error('Video unavailable\nSensitive detail');
        }),
        /Video unavailable/
      );

      assert.equal(logs.length, 2);
      assert.ok(logs[0].startsWith('[CMD START] name=play type=slash guild=TestServer'));
      assert.ok(logs[1].startsWith('[CMD END] name=play type=slash'));
      assert.ok(logs[1].includes('status=failure'));
      assert.ok(logs[1].includes('reason="Video unavailable Sensitive detail"'));
    });

    test('measures deferReply and editReply for slash commands without double-counting', async () => {
      const logs = [];
      const logWriter = (msg) => logs.push(msg);

      let deferCalls = 0;
      let editCalls = 0;

      const mockInteraction = {
        guild: { name: 'SlashServer' },
        deferReply: async () => {
          deferCalls++;
          return {};
        },
        editReply: async (payload) => {
          editCalls++;
          return payload;
        },
      };

      const timer = createCommandExecutionTimer({
        name: 'play',
        type: 'slash',
        context: mockInteraction,
        logWriter,
        enabled: true,
      });

      await timer.executeWithTiming(async (ctx) => {
        await ctx.deferReply();
        await ctx.editReply({ content: 'Now playing' });
      });

      assert.equal(deferCalls, 1);
      assert.equal(editCalls, 1);
      assert.equal(logs.length, 2);
      assert.ok(logs[1].includes('status=success'));
      assert.ok(logs[1].includes('response='));

      const stats = timer.getStats();
      assert.equal(stats.responseCount, 2, 'Should track both deferReply and editReply responses');
      assert.ok(stats.totalResponseDeliveryDuration >= 0);
    });

    test('does not log when enabled is false, but executes command normally', async () => {
      const logs = [];
      const logWriter = (msg) => logs.push(msg);

      const mockContext = {
        guild: { name: 'SilentGuild' },
        reply: async (msg) => msg,
      };

      const timer = createCommandExecutionTimer({
        name: 'ping',
        type: 'prefix',
        context: mockContext,
        logWriter,
        enabled: false,
      });

      let executed = false;
      const result = await timer.executeWithTiming(async (ctx) => {
        executed = true;
        await ctx.reply('pong');
        return 'finished';
      });

      assert.equal(executed, true);
      assert.equal(result, 'finished');
      assert.equal(logs.length, 0, 'No logs should be emitted when disabled');
    });

    test('emits logs exactly once per invocation even with multiple reply calls', async () => {
      const logs = [];
      const logWriter = (msg) => logs.push(msg);

      const mockContext = {
        guild: null, // Test DM fallback
        reply: async () => {},
        followUp: async () => {},
      };

      const timer = createCommandExecutionTimer({
        name: 'leave',
        type: 'slash',
        context: mockContext,
        logWriter,
        enabled: true,
      });

      await timer.executeWithTiming(async (ctx) => {
        await ctx.reply('first response');
        await ctx.followUp('second response');
      });

      assert.equal(logs.length, 2);
      assert.ok(logs[0].includes('guild=DM'));
      assert.ok(logs[1].includes('status=success'));
      assert.equal(logs.filter((l) => l.startsWith('[CMD END]')).length, 1);
    });
  });

  describe('Integration with messageCreate and interactionCreate events', () => {
    test('messageCreate executes command with timing instrumentation and handles error', async () => {
      let executed = false;
      let replyCalled = false;

      const mockMessage = {
        author: { bot: false },
        guild: { name: 'EventGuild', id: 'guild-1' },
        content: '!testcmd',
        client: {
          commands: new Collection([
            [
              'testcmd',
              {
                execute: async (msg) => {
                  executed = true;
                  await msg.reply('command done');
                },
              },
            ],
          ]),
        },
        reply: async () => {
          replyCalled = true;
        },
      };

      await messageCreateEvent.execute(mockMessage);

      assert.equal(executed, true);
      assert.equal(replyCalled, true);
    });

    test('interactionCreate executes slash command with timing instrumentation', async () => {
      let executed = false;
      let replyCalled = false;

      const mockInteraction = {
        isChatInputCommand: () => true,
        commandName: 'slashcmd',
        guild: { name: 'SlashGuild', id: 'guild-2' },
        client: {
          commands: new Collection([
            [
              'slashcmd',
              {
                execute: async (interaction) => {
                  executed = true;
                  await interaction.reply('slash done');
                },
              },
            ],
          ]),
        },
        replied: false,
        deferred: false,
        reply: async () => {
          replyCalled = true;
        },
      };

      await interactionCreateEvent.execute(mockInteraction);

      assert.equal(executed, true);
      assert.equal(replyCalled, true);
    });
  });
});
