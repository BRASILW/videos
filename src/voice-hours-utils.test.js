const test = require('node:test');
const assert = require('node:assert/strict');
const { mergePersistedVoiceHours } = require('./voice-hours-utils');

test('keeps the larger confirmed total when the backup snapshot is stale', () => {
  const totals = mergePersistedVoiceHours(
    [{ guild_id: 'guild', user_id: 'user', voice_seconds: 7200 }],
    [{ guild_id: 'guild', user_id: 'user', voice_seconds: 1800 }]
  );

  assert.equal(totals.get('guild:user'), 7200);
});

test('recovers a larger backup total when the primary row is stale', () => {
  const totals = mergePersistedVoiceHours(
    [{ guild_id: 'guild', user_id: 'user', voice_seconds: 1800 }],
    [{ guild_id: 'guild', user_id: 'user', voice_seconds: 7200 }]
  );

  assert.equal(totals.get('guild:user'), 7200);
});

test('retains zeroed totals and ignores malformed rows', () => {
  const totals = mergePersistedVoiceHours(
    [
      { guild_id: 'guild', user_id: 'reset-user', voice_seconds: 0 },
      { guild_id: '', user_id: 'invalid', voice_seconds: 999 }
    ],
    [{ guild_id: 'guild', user_id: 'reset-user', voice_seconds: 0 }]
  );

  assert.equal(totals.get('guild:reset-user'), 0);
  assert.equal(totals.has(':invalid'), false);
});
