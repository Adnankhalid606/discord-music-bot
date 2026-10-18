import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from 'discord.js';
import { getCommandModules, loadCommands } from '../src/handlers/commandHandler.js';

describe('Command Handler & Discovery', () => {
  test('getCommandModules recursively discovers all commands across subdirectories', async () => {
    const commands = await getCommandModules();

    assert.ok(Array.isArray(commands));
    assert.equal(commands.length, 9, 'Expected exactly 9 registered commands');

    const expectedCommands = [
      'help',
      'ping',
      'join',
      'leave',
      'play',
      'playfile',
      'pause',
      'resume',
      'stop',
    ];

    const commandNames = commands.map((c) => c.data.name);
    for (const expected of expectedCommands) {
      assert.ok(
        commandNames.includes(expected),
        `Should recursively load command "${expected}" from subdirectories`
      );
    }

    for (const cmd of commands) {
      assert.ok(cmd.data, 'Command must have data property');
      assert.equal(typeof cmd.data.name, 'string');
      assert.equal(typeof cmd.execute, 'function', 'Command must have execute function');
      assert.ok(cmd.category, 'Command should have a category');
    }
  });

  test('loadCommands populates client.commands Collection with all categorized commands', async () => {
    const mockClient = {
      commands: new Collection(),
    };

    await loadCommands(mockClient);

    assert.equal(mockClient.commands.size, 9);
    assert.ok(mockClient.commands.has('ping'));
    assert.ok(mockClient.commands.has('help'));
    assert.ok(mockClient.commands.has('join'));
    assert.ok(mockClient.commands.has('leave'));
    assert.ok(mockClient.commands.has('play'));
    assert.ok(mockClient.commands.has('playfile'));
    assert.ok(mockClient.commands.has('pause'));
    assert.ok(mockClient.commands.has('resume'));
    assert.ok(mockClient.commands.has('stop'));
  });
});
