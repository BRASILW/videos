const assert = require('node:assert/strict');
const test = require('node:test');
const { shouldRetryGemini } = require('./gemini-retry');

test('retries Gemini timeouts and temporary server failures only', () => {
  assert.equal(shouldRetryGemini({ name: 'TimeoutError' }), true);
  assert.equal(shouldRetryGemini({ name: 'AbortError' }), true);
  assert.equal(shouldRetryGemini(null, 503), true);
  assert.equal(shouldRetryGemini(null, 400), false);
  assert.equal(shouldRetryGemini(null, 429), false);
});
