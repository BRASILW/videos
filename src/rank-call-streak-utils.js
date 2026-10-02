function shiftRankCallDate(dateKey, deltaDays) {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return date.toISOString().slice(0, 10);
}

function calculateRankCallCurrentStreak(dates, today) {
  const uniqueDates = [...new Set(
    (dates || [])
      .filter(value => /^\d{4}-\d{2}-\d{2}$/.test(String(value)))
      .map(String)
  )].sort();

  if (!uniqueDates.length) {
    return { currentStreak: 0, bestStreak: 0, lastActiveDate: '' };
  }

  let bestStreak = 1;
  let run = 1;
  for (let index = 1; index < uniqueDates.length; index += 1) {
    if (shiftRankCallDate(uniqueDates[index - 1], 1) === uniqueDates[index]) {
      run += 1;
    } else {
      run = 1;
    }
    bestStreak = Math.max(bestStreak, run);
  }

  const lastActiveDate = uniqueDates[uniqueDates.length - 1];
  const yesterday = shiftRankCallDate(today, -1);
  if (lastActiveDate !== today && lastActiveDate !== yesterday) {
    return { currentStreak: 0, bestStreak, lastActiveDate };
  }

  let currentStreak = 1;
  let cursor = lastActiveDate;
  for (let index = uniqueDates.length - 2; index >= 0; index -= 1) {
    const previous = shiftRankCallDate(cursor, -1);
    if (uniqueDates[index] !== previous) break;
    currentStreak += 1;
    cursor = uniqueDates[index];
  }

  return { currentStreak, bestStreak, lastActiveDate };
}

function reconcileRankCallStreakData(raw, minimumSeconds, today) {
  const dates = Array.isArray(raw?.dates)
    ? [...new Set(raw.dates
      .map(value => String(value).trim())
      .filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value)))]
      .sort()
    : [];
  const dailySeconds = {};

  if (raw?.dailySeconds && typeof raw.dailySeconds === 'object' && !Array.isArray(raw.dailySeconds)) {
    for (const [dateKey, value] of Object.entries(raw.dailySeconds)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) continue;
      const seconds = Math.max(0, Math.floor(Number(value) || 0));
      if (seconds > 0) dailySeconds[dateKey] = Math.min(seconds, 24 * 60 * 60);
    }
  }

  for (const [dateKey, seconds] of Object.entries(dailySeconds)) {
    if (seconds >= minimumSeconds && !dates.includes(dateKey)) dates.push(dateKey);
  }
  dates.sort();

  for (const dateKey of dates) {
    if (!Object.prototype.hasOwnProperty.call(dailySeconds, dateKey)) {
      dailySeconds[dateKey] = minimumSeconds;
    }
  }

  const historicalStats = calculateRankCallCurrentStreak(dates, today);
  const lastQualifiedDate = [
    String(raw?.lastQualifiedDate || ''),
    dates[dates.length - 1] || ''
  ].sort().pop() || '';

  return {
    dates,
    dailySeconds,
    currentStreak: historicalStats.currentStreak,
    bestStreak: Math.max(Number(raw?.bestStreak) || 0, historicalStats.bestStreak),
    lastActiveDate: historicalStats.lastActiveDate || String(raw?.lastActiveDate || ''),
    lastQualifiedDate,
    missedDayNotified: String(raw?.missedDayNotified || '')
  };
}

function mergeRankCallStreakData(primary = {}, secondary = {}) {
  const dailySeconds = { ...(primary.dailySeconds || {}) };
  for (const [dateKey, value] of Object.entries(secondary.dailySeconds || {})) {
    dailySeconds[dateKey] = Math.max(
      Number(dailySeconds[dateKey]) || 0,
      Number(value) || 0
    );
  }

  return {
    dates: [...new Set([...(primary.dates || []), ...(secondary.dates || [])])],
    dailySeconds,
    currentStreak: Math.max(Number(primary.currentStreak) || 0, Number(secondary.currentStreak) || 0),
    bestStreak: Math.max(Number(primary.bestStreak) || 0, Number(secondary.bestStreak) || 0),
    lastActiveDate: [String(primary.lastActiveDate || ''), String(secondary.lastActiveDate || '')].sort().pop() || '',
    lastQualifiedDate: [String(primary.lastQualifiedDate || ''), String(secondary.lastQualifiedDate || '')].sort().pop() || '',
    missedDayNotified: String(secondary.missedDayNotified || primary.missedDayNotified || '')
  };
}

module.exports = {
  calculateRankCallCurrentStreak,
  mergeRankCallStreakData,
  reconcileRankCallStreakData,
  shiftRankCallDate
};
