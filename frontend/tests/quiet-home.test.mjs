import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLocalHistoryRecord,
  buildLocalTrip,
  contactStatusLabel,
  emptyQuietHomeSettings,
  formatEtaLabel,
  formatEtaTime,
  graceMinutesLabel,
  historyStats,
  isPast,
  minutesUntil,
  notificationLabel,
  notificationStatusLabel,
  parseEtaInput,
} from '../lib/quiet-home.ts';
import {
  clearQuietHomeActiveTrip,
  clearQuietHomeHistory,
  clearQuietHomeSettings,
  getQuietHomeActiveTrip,
  getQuietHomeHistory,
  getQuietHomeSettings,
  setQuietHomeActiveTrip,
  setQuietHomeHistory,
  setQuietHomeSettings,
} from '../lib/quiet-home-storage.ts';

test('quiet home starts with empty settings and no preset trips or history', async () => {
  await clearQuietHomeSettings();
  await clearQuietHomeActiveTrip();
  await clearQuietHomeHistory();
  assert.equal(emptyQuietHomeSettings().defaultHome, '');
  assert.equal(emptyQuietHomeSettings().graceMinutes, 30);
  assert.deepEqual(await getQuietHomeActiveTrip(), null);
  assert.deepEqual(await getQuietHomeHistory(), []);
});

test('parseEtaInput only accepts a real future-parsable time', () => {
  assert.equal(parseEtaInput('not-a-time'), null);
  const parsed = parseEtaInput('2026-08-06 23:20');
  assert.equal(parsed instanceof Date, true);
});

test('time helpers format real event times without fake defaults', () => {
  const eta = '2026-08-06T23:20:00+08:00';
  assert.equal(formatEtaTime(eta), '23:20');
  assert.equal(formatEtaLabel(eta).includes('8月6日'), true);
  assert.equal(isPast('2020-01-01T00:00:00Z'), true);
  assert.equal(minutesUntil('2026-08-06T23:20:00Z', new Date('2026-08-06T23:00:00Z')), 20);
});

test('status labels only map known real states', () => {
  assert.equal(contactStatusLabel('agreed'), '已同意');
  assert.equal(notificationLabel('safe_arrival'), '已安全到家');
  assert.equal(notificationStatusLabel('failed'), '发送失败');
  assert.equal(graceMinutesLabel(30), '30 分钟');
});

test('history stats count only real ended trips', () => {
  const records = [
    { id: '1', createdAt: '', originLabel: '', destinationLabel: '', etaAt: '', checkedInAt: 'x', lateMinutes: 12, contactNotified: true },
    { id: '2', createdAt: '', originLabel: '', destinationLabel: '', etaAt: '', checkedInAt: 'y', lateMinutes: 0, contactNotified: false },
    { id: '3', createdAt: '', originLabel: '', destinationLabel: '', etaAt: '', checkedInAt: undefined, contactNotified: false },
  ];
  assert.deepEqual(historyStats(records), {
    total: 3,
    checkedIn: 2,
    late: 1,
    contactNotified: 1,
  });
});

test('local trip and history only use real user input', () => {
  const trip = buildLocalTrip({
    originLabel: '用户输入的公司',
    destinationLabel: '用户输入的我的家',
    etaAt: '2026-08-06T23:20:00Z',
    graceMinutes: 30,
    selfReminderEnabled: true,
    contactReminderEnabled: false,
    arrivalDetectionEnabled: false,
    lateSnapshotEnabled: false,
  });
  assert.equal(trip.status, 'active');
  assert.equal(trip.originLabel, '用户输入的公司');
  assert.equal(trip.destinationLabel, '用户输入的我的家');
  const record = buildLocalHistoryRecord(trip);
  assert.equal(record.id, trip.id);
  assert.equal(record.contactNotified, false);
});

test('local storage persists real quiet home state', async () => {
  const settings = { ...emptyQuietHomeSettings(), defaultHome: '我的家', updatedAt: 1 };
  await setQuietHomeSettings(settings);
  assert.deepEqual(await getQuietHomeSettings(), settings);

  const trip = buildLocalTrip({
    originLabel: '公司',
    destinationLabel: '家',
    etaAt: '2026-08-06T23:20:00Z',
    graceMinutes: 30,
    selfReminderEnabled: true,
    contactReminderEnabled: false,
    arrivalDetectionEnabled: false,
    lateSnapshotEnabled: false,
  });
  await setQuietHomeActiveTrip(trip);
  assert.deepEqual(await getQuietHomeActiveTrip(), trip);
  await setQuietHomeHistory([buildLocalHistoryRecord(trip)]);
  assert.equal((await getQuietHomeHistory()).length, 1);
});
