function mergePersistedVoiceHours(botUserRows = [], backupRows = []) {
  const totals = new Map();

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
    totals.set(key, Math.max(totals.get(key) || 0, Math.floor(seconds)));
  }

  return totals;
}

module.exports = { mergePersistedVoiceHours };
