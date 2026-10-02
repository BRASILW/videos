function mergePersistedVoiceHours(botUserRows = [], backupRows = [], localHours = new Map()) {
  const totals = new Map();
  const backupKeys = new Set();

  for (const row of botUserRows) {
    const guildId = String(row.guild_id || '');
    const userId = String(row.user_id || '');
    const seconds = Number(row.voice_seconds);
    if (!guildId || !userId || !Number.isFinite(seconds) || seconds < 0) continue;
    totals.set(`${guildId}:${userId}`, Math.floor(seconds));
  }

  for (const row of backupRows) {
    const guildId = String(row.guild_id || '');
    const userId = String(row.user_id || '');
    const seconds = Number(row.voice_seconds);
    if (!guildId || !userId || !Number.isFinite(seconds) || seconds < 0) continue;

    const key = `${guildId}:${userId}`;
    backupKeys.add(key);
    totals.set(key, Math.max(totals.get(key) || 0, Math.floor(seconds)));
  }

  for (const [rawKey, rawSeconds] of localHours) {
    const key = String(rawKey);
    if (backupKeys.has(key)) continue;
    const seconds = Number(rawSeconds);
    if (!key.includes(':') || !Number.isFinite(seconds) || seconds < 0) continue;
    totals.set(key, Math.max(totals.get(key) || 0, Math.floor(seconds)));
  }

  return totals;
}

module.exports = { mergePersistedVoiceHours };
