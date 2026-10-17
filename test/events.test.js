import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Collection, Events } from 'discord.js';
import interactionCreateEvent from '../src/events/interactionCreate.js';
import messageCreateEvent from '../src/events/messageCreate.js';

describe('Event Handlers', () => {
  test('interactionCreate executes slash command and handles error with error embed', async () => {
    assert.equal(interactionCreateEvent.name, Events.InteractionCreate);

    let sentPayload = null;
    const mockInteraction = {
      isChatInputCommand: () => true,
      commandName: 'broken',
      client: {
        commands: new Collection([
          [
            'broken',
            {
              execute: async () => {
                throw new Error('Sensitive internal database error at /var/secret/db.js');
              },
            },
          ],
        ]),
      },
      replied: false,
      deferred: false,
      reply: async (payload) => {
        sentPayload = payload;
        return payload;
      },
    };

    await interactionCreateEvent.execute(mockInteraction);

    assert.ok(sentPayload?.embeds?.length, 'Should return an embed on error');
    const embedData = sentPayload.embeds[0].toJSON();
    assert.equal(embedData.title, 'Command Execution Error');
    // Ensure no sensitive internal stack/path leaked
    assert.ok(!embedData.description.includes('Sensitive internal database error'));
    assert.ok(!embedData.description.includes('/var/secret'));
    assert.equal(sentPayload.ephemeral, true);
  });

  test('messageCreate executes prefix command and handles error with error embed', async () => {
    assert.equal(messageCreateEvent.name, Events.MessageCreate);

    let sentPayload = null;
    const mockMessage = {
      author: { bot: false },
      guild: { id: '123' },
      content: '!failing',
      client: {
        commands: new Collection([
          [
            'failing',
            {
              execute: async () => {
                throw new Error('Sensitive stack trace in private.js');
              },
            },
          ],
        ]),
      },
      reply: async (payload) => {
        sentPayload = payload;
        return payload;
      },
    };

    await messageCreateEvent.execute(mockMessage);

    assert.ok(sentPayload?.embeds?.length, 'Should reply with an embed on error');
    const embedData = sentPayload.embeds[0].toJSON();
    assert.ok(!embedData.description.includes('Sensitive stack trace'));
  });
});
