const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateRankCallCurrentStreak,
  mergeRankCallStreakData,
  reconcileRankCallStreakData
} = require('./rank-call-streak-utils');

test('reconciles missing qualified dates from accumulated daily seconds', () => {
  const record = reconcileRankCallStreakData({
    dates: ['2026-09-28', '2026-09-30'],
    dailySeconds: {
      '2026-09-28': 1800,
      '2026-09-29': 3600,
      '2026-09-30': 1800
    },
    bestStreak: 4
  }, 1800, '2026-10-01');

  assert.deepEqual(record.dates, ['2026-09-28', '2026-09-29', '2026-09-30']);
  assert.equal(record.currentStreak, 3);
  assert.equal(record.bestStreak, 4);
});

test('does not qualify a day below the minimum threshold', () => {
  const record = reconcileRankCallStreakData({
    dates: [],
    dailySeconds: { '2026-10-01': 1799 }
  }, 1800, '2026-10-02');

  assert.deepEqual(record.dates, []);
  assert.equal(record.currentStreak, 0);
});

test('calculates the current streak only when the latest qualified date is today or yesterday', () => {
  assert.deepEqual(
    calculateRankCallCurrentStreak(
      ['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30'],
      '2026-10-01'
    ),
    { currentStreak: 4, bestStreak: 4, lastActiveDate: '2026-09-30' }
  );

  assert.deepEqual(
    calculateRankCallCurrentStreak(
      ['2026-09-28', '2026-09-29', '2026-09-30'],
      '2026-10-02'
    ),
    { currentStreak: 0, bestStreak: 3, lastActiveDate: '2026-09-30' }
  );
});

test('keeps a four-day streak visible on the following day while today is still pending', () => {
  const streak = calculateRankCallCurrentStreak(
    ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01'],
    '2026-10-02'
  );

  assert.equal(streak.currentStreak, 4);
  assert.equal(streak.lastActiveDate, '2026-10-01');
});

test('caps malformed daily values at one day and ignores malformed dates', () => {
  const record = reconcileRankCallStreakData({
    dates: ['not-a-date'],
    dailySeconds: {
      '2026-10-01': 100000,
      invalid: 20000
    }
  }, 1800, '2026-10-02');

  assert.deepEqual(record.dates, ['2026-10-01']);
  assert.equal(record.dailySeconds['2026-10-01'], 86400);
  assert.equal(record.dailySeconds.invalid, undefined);
});

test('merges local and database state without losing qualified dates or larger totals', () => {
  const merged = mergeRankCallStreakData(
    {
      dates: ['2026-09-28'],
      dailySeconds: { '2026-09-28': 2400 },
      bestStreak: 2
    },
    {
      dates: ['2026-09-29'],
      dailySeconds: {
        '2026-09-28': 1800,
        '2026-09-29': 3600
      },
      bestStreak: 3
    }
  );

  assert.deepEqual(merged.dates, ['2026-09-28', '2026-09-29']);
  assert.deepEqual(merged.dailySeconds, {
    '2026-09-28': 2400,
    '2026-09-29': 3600
  });
  assert.equal(merged.bestStreak, 3);
});
