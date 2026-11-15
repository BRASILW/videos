const assert = require('node:assert/strict');
const test = require('node:test');
const { shouldAnalyzeAIAttention } = require('./ai-attention-cooldown');

test('AI attention analysis reserves a cooldown after the first eligible message', () => {
  const cooldowns = new Map();

  assert.equal(shouldAnalyzeAIAttention(cooldowns, 'guild:user', 1000, 60_000), true);
  assert.equal(shouldAnalyzeAIAttention(cooldowns, 'guild:user', 2000, 60_000), false);
  assert.equal(shouldAnalyzeAIAttention(cooldowns, 'guild:user', 61_000, 60_000), true);
});
