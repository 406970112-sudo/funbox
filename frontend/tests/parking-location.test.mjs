import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addParkingPhoto,
  addParkingRecord,
  calculateEstimatedFeeCents,
  clearParkingSearchHistory,
  deleteParkingFeeRule,
  deleteParkingRecord,
  filterParkingRecords,
  leaveParkingRecord,
  recordParkingSearchHistory,
  removeParkingPhoto,
  updateParkingSettings,
  upsertParkingFeeRule,
} from '../lib/parking-location.ts';
import {
  clearParkingLocationState,
  getParkingLocationState,
  setParkingLocationState,
} from '../lib/parking-location-storage.ts';
import { createEmptyParkingLocationState } from '../types/parking-location.ts';

test('creates a real parking record and rejects missing position', () => {
  const empty = createEmptyParkingLocationState();
  const missing = addParkingRecord(empty, {
    parkingLotName: '测试停车场',
    parkedAt: Date.now(),
  });
  assert.equal(missing.error, '楼层、区域或车位至少填写一项');

  const added = addParkingRecord(empty, {
    parkingLotName: '成都新世纪环球中心',
    floorLabel: 'B3',
    zoneLabel: 'C区',
    spotLabel: '328号',
    landmarkNote: '靠近蓝色电梯',
    parkedAt: Date.now(),
    reminderMinutes: 30,
    reminderMode: 'fixed',
  });
  assert.equal(added.error, null);
  assert.equal(added.record?.parkingLotName, '成都新世纪环球中心');
  assert.equal(added.state.records.length, 1);
});

test('fee estimate stays null without a real rule', () => {
  const empty = createEmptyParkingLocationState();
  const added = addParkingRecord(empty, {
    parkingLotName: '测试停车场',
    floorLabel: 'B1',
    parkedAt: Date.now() - 60 * 60 * 1000,
    reminderMode: 'none',
  });
  assert.equal(added.error, null);
  assert.equal(added.record?.estimatedFeeCents, null);
  assert.equal(calculateEstimatedFeeCents(added.state, added.record.id), null);
});

test('calculates fee from real user-entered rule', () => {
  let state = createEmptyParkingLocationState();
  const rule = upsertParkingFeeRule(state, {
    parkingLotName: '成都新世纪环球中心',
    firstRuleMinutes: 120,
    firstRuleAmountCents: 600,
    subsequentMinutes: 60,
    subsequentAmountCents: 400,
  });
  assert.equal(rule.error, null);
  state = rule.state;
  const added = addParkingRecord(state, {
    parkingLotName: '成都新世纪环球中心',
    floorLabel: 'B3',
    zoneLabel: 'C区',
    spotLabel: '328号',
    parkedAt: Date.now() - 3 * 60 * 60 * 1000,
    feeRuleId: rule.rule?.id,
    reminderMode: 'fixed',
    reminderMinutes: 30,
  });
  assert.equal(added.error, null);
  assert.equal(calculateEstimatedFeeCents(added.state, added.record.id), 1000);
});

test('leave records real departure time and actual fee', () => {
  let state = createEmptyParkingLocationState();
  const added = addParkingRecord(state, {
    parkingLotName: '测试停车场',
    floorLabel: 'B2',
    parkedAt: Date.now() - 60 * 60 * 1000,
    reminderMode: 'none',
  });
  assert.equal(added.error, null);
  state = added.state;
  const left = leaveParkingRecord(state, added.record.id, Date.now(), 1000);
  assert.equal(left.error, null);
  const record = left.state.records[0];
  assert.equal(record.status, 'left');
  assert.equal(record.actualFeeCents, 1000);
  assert.notEqual(record.leaveAt, null);
});

test('photos are real local attachments with limits', () => {
  let state = createEmptyParkingLocationState();
  const added = addParkingRecord(state, {
    parkingLotName: '测试停车场',
    floorLabel: 'B1',
    parkedAt: Date.now(),
    reminderMode: 'none',
  });
  assert.equal(added.error, null);
  state = added.state;
  for (let index = 0; index < 6; index += 1) {
    const photo = addParkingPhoto(state, added.record.id, {
      uri: `data:image/jpeg;base64,${index}`,
      takenAt: Date.now(),
    });
    assert.equal(photo.error, null);
    state = photo.state;
  }
  const overLimit = addParkingPhoto(state, added.record.id, {
    uri: 'data:image/jpeg;base64,7',
    takenAt: Date.now(),
  });
  assert.equal(overLimit.error, '每条记录最多 6 张照片');
  const removed = removeParkingPhoto(state, added.record.id, state.records[0].photos[0].id);
  assert.equal(removed.error, null);
  assert.equal(removed.state.records[0].photoCount, 5);
});

test('fee rules can be saved and deleted without fake data', () => {
  let state = createEmptyParkingLocationState();
  const rule = upsertParkingFeeRule(state, {
    parkingLotName: '测试停车场',
    firstRuleMinutes: 60,
    firstRuleAmountCents: 300,
    sourceNote: '现场价目表',
  });
  assert.equal(rule.error, null);
  state = rule.state;
  assert.equal(state.feeRules.length, 1);
  const deleted = deleteParkingFeeRule(state, rule.rule.id);
  assert.equal(deleted.state.feeRules.length, 0);
});

test('search and settings work from real user data', () => {
  let state = createEmptyParkingLocationState();
  state = addParkingRecord(state, {
    parkingLotName: '成都新世纪环球中心',
    floorLabel: 'B3',
    zoneLabel: 'C区',
    spotLabel: '328号',
    parkedAt: Date.now(),
    reminderMode: 'none',
  }).state;
  state = addParkingRecord(state, {
    parkingLotName: '成都东站',
    floorLabel: 'B1',
    zoneLabel: 'E区',
    spotLabel: '217号',
    parkedAt: Date.now(),
    reminderMode: 'none',
  }).state;
  assert.equal(filterParkingRecords(state, 'C区').length, 1);
  const updated = updateParkingSettings(state, { defaultReminderMinutes: 60 });
  assert.equal(updated.state.settings.defaultReminderMinutes, 60);
  const searched = recordParkingSearchHistory(state, '环球中心');
  assert.equal(searched.searchHistory[0], '环球中心');
  const cleared = clearParkingSearchHistory(searched);
  assert.equal(cleared.searchHistory.length, 0);
});

test('local storage persists only real state', async () => {
  await clearParkingLocationState();
  let state = createEmptyParkingLocationState();
  state = addParkingRecord(state, {
    parkingLotName: '测试停车场',
    floorLabel: 'B2',
    parkedAt: Date.now(),
    reminderMode: 'none',
  }).state;
  await setParkingLocationState(state);
  const loaded = await getParkingLocationState();
  assert.equal(loaded.records.length, 1);
  assert.equal(loaded.records[0].parkingLotName, '测试停车场');

  const removed = deleteParkingRecord(loaded, loaded.records[0].id);
  await setParkingLocationState(removed.state);
  const cleared = await getParkingLocationState();
  assert.equal(cleared.records.length, 0);
});
