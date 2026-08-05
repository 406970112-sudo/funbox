import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addParticipants,
  appendRecord,
  buildRecentTasks,
  buildWheelSectors,
  clearParticipants,
  clearRecords,
  groupRecordsByDay,
  parseParticipantNames,
  recordStats,
  removeParticipant,
  resolveRecordTaskText,
  resolveSpinTarget,
  runSpin,
  updateParticipantName,
} from '../lib/who-does-it.ts';
import {
  createEmptyWhoDoesItState,
  WHO_DOES_IT_MAX_PARTICIPANTS,
} from '../types/who-does-it.ts';
import {
  clearWhoDoesItState,
  getWhoDoesItState,
  setWhoDoesItState,
} from '../lib/who-does-it-storage.ts';

test('parses real names from multiline and punctuation input', () => {
  assert.deepEqual(parseParticipantNames('阿伟\n小红，小蓝、小北 阿明'), [
    '阿伟',
    '小红',
    '小蓝',
    '小北',
    '阿明',
  ]);
});

test('add participants keeps only real unique names', () => {
  let state = createEmptyWhoDoesItState();
  const first = addParticipants(state, '阿伟,小红,小红');
  assert.deepEqual(first.errors, ['小红 已存在']);
  assert.deepEqual(first.added.map((item) => item.name), ['阿伟', '小红']);
  state = first.state;

  const second = addParticipants(state, '小蓝\n阿伟');
  assert.deepEqual(second.added.map((item) => item.name), ['小蓝']);
  assert.deepEqual(second.errors, ['阿伟 已存在']);
});

test('participant count respects 36 person ceiling', () => {
  let state = createEmptyWhoDoesItState();
  const names = Array.from({ length: WHO_DOES_IT_MAX_PARTICIPANTS }, (_, index) => `人${index + 1}`);
  state = addParticipants(state, names.join(',')).state;
  const overflow = addParticipants(state, '第37人');
  assert.equal(overflow.added.length, 0);
  assert.equal(overflow.errors[0], `最多只能添加 ${WHO_DOES_IT_MAX_PARTICIPANTS} 人`);
});

test('renames, removes and clears participants', () => {
  let state = createEmptyWhoDoesItState();
  state = addParticipants(state, '阿伟,小红').state;
  const renamed = updateParticipantName(state, state.participants[0].id, ' 阿伟2 ');
  assert.equal(renamed.error, null);
  assert.equal(renamed.state.participants[0].name, '阿伟2');

  const duplicate = updateParticipantName(renamed.state, state.participants[1].id, '阿伟2');
  assert.equal(duplicate.error, '阿伟2 已存在');

  state = removeParticipant(renamed.state, renamed.state.participants[1].id);
  assert.equal(state.participants.length, 1);
  state = clearParticipants(state);
  assert.equal(state.participants.length, 0);
});

test('spin result always comes from real participant list', () => {
  let state = createEmptyWhoDoesItState();
  state = addParticipants(state, '阿伟,小红,小蓝,小北').state;
  let randomCalls = 0;
  const result = runSpin(state, () => {
    randomCalls += 1;
    return 0.61;
  });
  assert.equal(result.winner.name, '小蓝');
  assert.deepEqual(result.record.participantNames, ['阿伟', '小红', '小蓝', '小北']);
  assert.equal(result.record.participantCount, 4);
  assert.ok(result.record.createdAt > 0);
  assert.ok(randomCalls >= 2);
});

test('spin target lands selected sector under the pointer', () => {
  const participantCount = 4;
  const winnerIndex = 1;
  const target = resolveSpinTarget(participantCount, winnerIndex, () => 0.5);
  const midAngle = -90 + (winnerIndex + 0.5) * (360 / participantCount);
  assert.equal((target + midAngle) % 360, 270);
});

test('wheel builds equal sectors with real names', () => {
  let state = createEmptyWhoDoesItState();
  state = addParticipants(state, '阿伟,小红,小蓝').state;
  const sectors = buildWheelSectors(state.participants);
  assert.equal(sectors.length, 3);
  assert.deepEqual(
    sectors.map((sector) => sector.name),
    ['阿伟', '小红', '小蓝'],
  );
  assert.equal(sectors[1].startAngle, 30);
  assert.equal(sectors[2].endAngle, 270);
});

test('custom task and recent tasks come from real records', () => {
  let state = createEmptyWhoDoesItState();
  state = addParticipants(state, '阿伟,小红').state;
  state = {
    ...state,
    settings: { ...state.settings, taskMode: 'custom', customTask: '去洗碗' },
  };
  const result = runSpin(state, () => 0.1);
  state = appendRecord(state, result.record);

  const second = runSpin(state, () => 0.2);
  state = appendRecord(state, second.record);
  assert.equal(resolveRecordTaskText(state.settings, state.records), '去洗碗');
  const recent = buildRecentTasks(state.records);
  assert.equal(recent[0].text, '去洗碗');
  assert.equal(recent.length, 1);
});

test('records keep snapshot even after participants change', () => {
  let state = createEmptyWhoDoesItState();
  state = addParticipants(state, '阿伟,小红').state;
  const result = runSpin(state, () => 0.1);
  state = appendRecord(state, result.record);
  state = clearParticipants(state);
  state = addParticipants(state, '小蓝').state;
  assert.equal(state.records[0].participantNames.length, 2);
  assert.equal(state.records[0].winnerName, '阿伟');
});

test('history groups by real date and keeps stats', () => {
  const now = Date.UTC(2026, 7, 5, 12, 0, 0);
  const records = [
    {
      id: 'r1',
      createdAt: now - 60 * 60 * 1000,
      participantNames: ['阿伟', '小红'],
      winnerName: '小红',
      taskText: '去洗碗',
      taskMode: 'custom',
      participantCount: 2,
    },
    {
      id: 'r2',
      createdAt: now - 3 * 24 * 60 * 60 * 1000,
      participantNames: ['阿伟', '小红'],
      winnerName: '阿伟',
      taskText: '',
      taskMode: 'person-only',
      participantCount: 2,
    },
  ];
  const groups = groupRecordsByDay(records, now);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].label, '今天');
  assert.deepEqual(recordStats(records, now), { today: 1, total: 2 });
  const cleared = clearRecords({ ...createEmptyWhoDoesItState(), records });
  assert.equal(cleared.records.length, 0);
});

test('local storage persists real state', async () => {
  await clearWhoDoesItState();
  let state = createEmptyWhoDoesItState();
  state = addParticipants(state, '阿伟,小红').state;
  await setWhoDoesItState(state);
  const loaded = await getWhoDoesItState();
  assert.deepEqual(loaded.participants.map((item) => item.name), ['阿伟', '小红']);
});
