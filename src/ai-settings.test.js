const assert = require('node:assert/strict');
const test = require('node:test');
const {
  AI_RESPONSE_CHANNEL_ID,
  DEFAULT_GEMINI_MODEL,
  isAIResponseChannel
} = require('./ai-settings');

test('AI responses are restricted to the configured channel', () => {
  assert.equal(isAIResponseChannel(AI_RESPONSE_CHANNEL_ID), true);
  assert.equal(isAIResponseChannel('another-channel-id'), false);
});

test('the default Gemini model is the currently supported Flash model', () => {
  assert.equal(DEFAULT_GEMINI_MODEL, 'gemini-3.8-flash');
});
