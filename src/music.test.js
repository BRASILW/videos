const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MusicController,
  formatTrackDuration,
  nodeAddress,
  shuffleItems,
  tracksFromResult
} = require('./music');

test('explains the required Lavalink configuration when the service is absent', async () => {
  const music = new MusicController({}, {});
  let response = '';

  await music.run({
    guild: { id: 'guild-id' },
    send: async content => {
      response = content;
    }
  }, 'queue');

  assert.match(response, /LAVALINK_HOST/);
  assert.match(response, /LAVALINK_PASSWORD/);
});

test('formats music durations as mm:ss or h:mm:ss', () => {
  assert.equal(formatTrackDuration(0), '0:00');
  assert.equal(formatTrackDuration(62_000), '1:02');
  assert.equal(formatTrackDuration(3_723_000), '1:02:03');
  assert.equal(formatTrackDuration(Number.POSITIVE_INFINITY), 'Ao vivo');
});

test('extracts tracks from Lavalink track, search, and playlist results', () => {
  const track = { encoded: 'encoded-track' };
  assert.deepEqual(tracksFromResult({ loadType: 'track', data: track }), [track]);
  assert.deepEqual(tracksFromResult({ loadType: 'search', data: [track] }), [track]);
  assert.deepEqual(
    tracksFromResult({ loadType: 'playlist', data: { tracks: [track] } }),
    [track]
  );
  assert.deepEqual(tracksFromResult({ loadType: 'empty', data: {} }), []);
});

test('surfaces Lavalink load errors', () => {
  assert.throws(
    () => tracksFromResult({ loadType: 'error', data: { message: 'source unavailable' } }),
    /source unavailable/
  );
});

test('shuffles the queue in place', () => {
  const items = ['a', 'b', 'c'];
  assert.equal(shuffleItems(items, () => 0), items);
  assert.deepEqual(items, ['b', 'c', 'a']);
});

test('normalizes the Lavalink address and preserves an explicit port', () => {
  assert.equal(nodeAddress('lavalink.internal', 2333), 'lavalink.internal:2333');
  assert.equal(nodeAddress('https://music.example:8443/', 2333), 'music.example:8443');
});
