import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from 'discord.js';
import { getCommandModules, loadCommands } from '../src/handlers/commandHandler.js';

describe('Command Handler & Discovery', () => {
  test('getCommandModules returns array of valid commands with data and execute', async () => {
    const commands = await getCommandModules();

    assert.ok(Array.isArray(commands));
    assert.ok(commands.length >= 2, 'Expected at least ping and help commands');

    for (const cmd of commands) {
      assert.ok(cmd.data, 'Command must have data property');
      assert.equal(typeof cmd.data.name, 'string');
      assert.equal(typeof cmd.execute, 'function', 'Command must have execute function');
    }

    const commandNames = commands.map(c => c.data.name);
    assert.ok(commandNames.includes('ping'), 'Should load ping command');
    assert.ok(commandNames.includes('help'), 'Should load help command');
  });

  test('loadCommands populates client.commands Collection', async () => {
    const mockClient = {
      commands: new Collection(),
    };

    await loadCommands(mockClient);

    assert.ok(mockClient.commands.has('ping'));
    assert.ok(mockClient.commands.has('help'));
    const ping = mockClient.commands.get('ping');
    assert.equal(typeof ping.execute, 'function');
  });
});
