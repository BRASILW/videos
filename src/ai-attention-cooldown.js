function shouldAnalyzeAIAttention(cooldowns, key, now, cooldownMs) {
  const last = cooldowns.get(key);
  if (last !== undefined && now - last < cooldownMs) {
    return false;
  }

  cooldowns.set(key, now);
  return true;
}

module.exports = { shouldAnalyzeAIAttention };
