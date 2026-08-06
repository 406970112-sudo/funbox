import assert from 'node:assert/strict';
import test from 'node:test';

import {
  completionId,
  completionStats,
  formatChineseDate,
  groupSuggestions,
  isCompletionDone,
  removeCompletion,
  todayDateString,
  upsertCompletion,
} from '../lib/daily-luck-sign.ts';
import {
  clearDailyLuckSignCompletions,
  clearDailyLuckSignSettings,
  emptyDailyLuckSignSettings,
  getDailyLuckSignCompletions,
  getDailyLuckSignSettings,
  setDailyLuckSignCompletions,
  setDailyLuckSignSettings,
} from '../lib/daily-luck-sign-storage.ts';

test('todayDateString and formatChineseDate use local real date', () => {
  const now = new Date(2026, 7, 6, 12, 0, 0);
  assert.equal(todayDateString(now), '2026-08-06');
  assert.equal(formatChineseDate('2026-08-06'), '8月6日 周四');
});

test('suggestions are grouped into real categories with limits', () => {
  const items = [
    { id: '1', category: 'small-thing', title: '开窗', reason: '', ruleId: 'ventilate', sources: [] },
    { id: '2', category: 'small-thing', title: '散步', reason: '', ruleId: 'walk', sources: [] },
    { id: '3', category: 'small-thing', title: '补水', reason: '', ruleId: 'hydrate', sources: [] },
    { id: '4', category: 'small-thing', title: '防晒', reason: '', ruleId: 'uv', sources: [] },
    { id: '5', category: 'challenge', title: '喝水', reason: '', ruleId: 'water', sources: [] },
    { id: '6', category: 'encouragement', title: '鼓励', reason: '', ruleId: 'air', sources: [] },
  ];
  const grouped = groupSuggestions(items);
  assert.equal(grouped['small-thing'].length, 3);
  assert.equal(grouped.challenge.length, 1);
  assert.equal(grouped.encouragement.length, 1);
});

test('completion stats only count real user records for today and month', () => {
  const items = [
    { id: '1', date: '2026-08-06', ruleId: 'water-count', title: '喝水', completedAt: '' },
    { id: '2', date: '2026-08-05', ruleId: 'sleep-early', title: '早睡', completedAt: '' },
    { id: '3', date: '2026-07-31', ruleId: 'workday-write', title: '写字', completedAt: '' },
  ];
  assert.deepEqual(completionStats(items, '2026-08-06'), { today: 1, month: 2, total: 3 });
});

test('completion upsert keeps one real record per date and rule', () => {
  const first = { id: 'a', date: '2026-08-06', ruleId: 'water-count', title: '喝水', completedAt: '' };
  const second = { id: 'b', date: '2026-08-06', ruleId: 'water-count', title: '喝水 6 杯', completedAt: '' };
  const next = upsertCompletion([first], second);
  assert.equal(next.length, 1);
  assert.equal(next[0].id, 'b');
  assert.equal(isCompletionDone(next, '2026-08-06', 'water-count'), true);
  assert.equal(removeCompletion(next, 'b').length, 0);
});

test('local storage starts empty and persists real settings and completions', async () => {
  await clearDailyLuckSignSettings();
  await clearDailyLuckSignCompletions();
  assert.deepEqual(await getDailyLuckSignSettings(), emptyDailyLuckSignSettings());
  assert.deepEqual(await getDailyLuckSignCompletions(), []);

  const settings = { city: '上海市', lat: 31.23, lon: 121.47, source: 'manual', updatedAt: 1 };
  await setDailyLuckSignSettings(settings);
  assert.deepEqual(await getDailyLuckSignSettings(), settings);

  const completion = { id: completionId('2026-08-06', 'water-count'), date: '2026-08-06', ruleId: 'water-count', title: '喝水', completedAt: '2026-08-06T08:00:00Z' };
  await setDailyLuckSignCompletions([completion]);
  assert.deepEqual(await getDailyLuckSignCompletions(), [completion]);
});
