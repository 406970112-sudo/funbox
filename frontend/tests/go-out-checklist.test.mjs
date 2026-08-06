import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLocalHomeItems,
  buildLocalWeatherSuggestions,
  completionResultText,
  emptyGoOutSettings,
  formatGoOutDate,
  groupHomeItems,
  localHistoryStats,
  matchingLocalRule,
  resolveActiveScene,
  scheduleDaysLabel,
  scheduleLabel,
  weatherRuleLabel,
  GO_OUT_TEMPLATES,
} from '../lib/go-out-checklist.ts';
import {
  clearGoOutLocalState,
  emptyGoOutLocalState,
  getGoOutLocalState,
  setGoOutLocalState,
} from '../lib/go-out-checklist-storage.ts';

test('go out templates are product structure, not seeded user data', () => {
  assert.equal(GO_OUT_TEMPLATES.length, 3);
  assert.deepEqual(
    GO_OUT_TEMPLATES.find((item) => item.id === 'work')?.items.map((item) => item.name),
    ['手机', '钥匙', '工牌', '耳机'],
  );
});

test('go out home items group by real state and weather rules', () => {
  const state = {
    ...emptyGoOutLocalState(),
    items: [
      { id: 'phone', name: '手机', icon: 'smartphone', itemType: 'item', weatherRuleIds: [], createdAt: 1, updatedAt: 1 },
      { id: 'umbrella', name: '雨伞', icon: 'umbrella', itemType: 'item', weatherRuleIds: ['rain-umbrella'], createdAt: 2, updatedAt: 2 },
      { id: 'door', name: '门窗关闭', icon: 'door', itemType: 'safety', weatherRuleIds: [], createdAt: 3, updatedAt: 3 },
    ],
    scenes: [{ id: 'work', userId: '', name: '上班模式', icon: 'briefcase', sortOrder: 0, createdAt: 1, updatedAt: 1 }],
    sceneItems: [{ sceneId: 'work', itemId: 'phone', position: 0 }],
  };
  const weather = {
    available: true,
    status: 'complete',
    temperature: 34,
    precipProb: 52,
    uvIndex: 8,
    aqi: 37,
  };
  const items = buildLocalHomeItems(state, 'work', weather);
  const groups = groupHomeItems(items);
  assert.equal(groups.scene.length, 1);
  assert.equal(groups.weather.length, 1);
  assert.equal(groups.safety.length, 1);
  assert.equal(matchingLocalRule(['rain-umbrella'], weather), 'rain-umbrella');
});

test('weather suggestions only show missing items', () => {
  const state = {
    ...emptyGoOutLocalState(),
    items: [
      { id: 'a', name: '雨伞', icon: 'umbrella', itemType: 'item', weatherRuleIds: ['rain-umbrella'], createdAt: 1, updatedAt: 1 },
    ],
  };
  const weather = { available: true, status: 'complete', temperature: 34, precipProb: 52, uvIndex: 8, aqi: 37 };
  const suggestions = buildLocalWeatherSuggestions(state.items, weather);
  assert.equal(suggestions.some((item) => item.ruleId === 'rain-umbrella'), false);
  assert.equal(suggestions.some((item) => item.ruleId === 'heat-water'), true);
});

test('go out labels and schedule matching stay deterministic', () => {
  assert.equal(completionResultText(), '今日出门检查完成，没有遗漏。');
  assert.equal(weatherRuleLabel('rain-umbrella'), '降雨概率 >= 40% 或当前有雨');
  assert.equal(scheduleDaysLabel([1, 2, 3, 4, 5]), '工作日');
  assert.equal(scheduleDaysLabel([0, 6]), '周末');
  assert.equal(scheduleLabel({ id: 's1', sceneId: 'w', daysOfWeek: [1, 2, 3, 4, 5], time: '08:20', enabled: true }), '工作日 08:20');
  assert.equal(formatGoOutDate('2026-08-06T09:00:00Z'), '8月6日 周四');
});

test('resolveActiveScene only switches when user schedule matches real time', () => {
  const scenes = [{ id: 'work', userId: '', name: '上班模式', icon: 'briefcase', sortOrder: 0, createdAt: 1, updatedAt: 1 }];
  const schedules = [{ id: 's1', sceneId: 'work', daysOfWeek: [4], time: '08:20', enabled: true }];
  assert.equal(resolveActiveScene(scenes, schedules, 'work', new Date(2026, 7, 6, 9, 0)), 'work');
  assert.equal(resolveActiveScene(scenes, schedules, '', new Date(2026, 7, 6, 7, 0)), '');
});

test('go out history stats only count real records', () => {
  const records = [
    {
      id: '1',
      sceneId: 'work',
      sceneName: '上班模式',
      checkedAt: '2026-08-06T09:00:00Z',
      confirmedItems: [],
      weather: { available: false, status: 'unavailable' },
      resultText: completionResultText(),
    },
  ];
  const stats = localHistoryStats(records, new Date(2026, 7, 6, 12, 0));
  assert.deepEqual(stats, { today: 1, week: 1, streak: 1, total: 1 });
});

test('go out local storage starts empty and persists real state', async () => {
  await clearGoOutLocalState();
  assert.deepEqual(await getGoOutLocalState(), emptyGoOutLocalState());

  const state = {
    ...emptyGoOutLocalState(),
    settings: { ...emptyGoOutSettings(), city: '上海市', lat: 31.23, lon: 121.47, updatedAt: 1 },
    items: [
      { id: 'a', name: '雨伞', icon: 'umbrella', itemType: 'item', weatherRuleIds: ['rain-umbrella'], createdAt: 1, updatedAt: 1 },
    ],
  };
  await setGoOutLocalState(state);
  assert.deepEqual(await getGoOutLocalState(), state);
});
