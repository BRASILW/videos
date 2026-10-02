const test = require('node:test');
const assert = require('node:assert/strict');
const { deleteBotMessagesFromDM } = require('./dm-cleanup');

function createMessage(id, authorId, onDelete = () => {}) {
  return {
    id,
    author: { id: authorId },
    async delete() {
      onDelete(id);
    }
  };
}

test('deletes only bot messages throughout DM history', async () => {
  const deleted = [];
  const pages = [
    Array.from({ length: 100 }, (_, index) => {
      const id = String(300 - index);
      return createMessage(id, index === 0 ? 'bot' : 'user', messageId => deleted.push(messageId));
    }),
    [
      createMessage('100', 'bot', id => deleted.push(id))
    ]
  ];
  const cursors = [];
  const channel = {
    isDMBased: () => true,
    messages: {
      async fetch(options) {
        cursors.push(options.before);
        return new Map(pages.shift().map(message => [message.id, message]));
      }
    }
  };

  const result = await deleteBotMessagesFromDM(channel, 'bot');

  assert.deepEqual(deleted, ['300', '100']);
  assert.deepEqual(cursors, [undefined, '201']);
  assert.deepEqual(result, { deleted: 2, failed: 0 });
});

test('limits scheduled cleanup to the newest page', async () => {
  let fetchCount = 0;
  const channel = {
    isDMBased: () => true,
    messages: {
      async fetch() {
        fetchCount += 1;
        return new Map([
          ['200', createMessage('200', 'user')],
          ['100', createMessage('100', 'bot')]
        ]);
      }
    }
  };

  const result = await deleteBotMessagesFromDM(channel, 'bot', { allHistory: false });

  assert.equal(fetchCount, 1);
  assert.deepEqual(result, { deleted: 1, failed: 0 });
});

test('rejects a guild channel instead of deleting its messages', async () => {
  const channel = {
    isDMBased: () => false,
    messages: { fetch: async () => new Map() }
  };

  await assert.rejects(
    deleteBotMessagesFromDM(channel, 'bot'),
    /canal de PV válido/
  );
});
