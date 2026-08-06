import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addSizeProfile,
  buildCopyText,
  buildShoppingCheck,
  canAddSizeProfile,
  clearSizeLibraryState,
  getMeasurementMap,
  relatedProfiles,
  removeSizeProfile,
  roomArea,
  scenarioProfileKind,
  shoppingScenarioLabel,
  updateSizeProfile,
  upsertSizeMeasurement,
  validateMeasurement,
} from '../lib/size-library.ts';
import {
  createEmptySizeLibraryState,
  SIZE_LIBRARY_MAX_PERSON_PROFILES,
} from '../types/size-library.ts';
import {
  clearSizeLibraryState as clearStoredState,
  getSizeLibraryState,
  setSizeLibraryState,
} from '../lib/size-library-storage.ts';

test('creates real person profile and rejects duplicates', () => {
  let state = createEmptySizeLibraryState();
  const added = addSizeProfile(state, 'person', '妈妈', '妈妈');
  assert.equal(added.error, null);
  assert.equal(added.profile?.name, '妈妈');
  state = added.state;

  const duplicate = addSizeProfile(state, 'person', ' 妈妈 ');
  assert.equal(duplicate.error, '妈妈 已存在');
  assert.equal(duplicate.state.profiles.length, 1);
});

test('enforces person profile ceiling', () => {
  let state = createEmptySizeLibraryState();
  for (let index = 0; index < SIZE_LIBRARY_MAX_PERSON_PROFILES; index += 1) {
    const added = addSizeProfile(state, 'person', `家人${index + 1}`);
    assert.equal(added.error, null);
    state = added.state;
  }
  assert.equal(canAddSizeProfile(state, 'person'), `最多只能添加 ${SIZE_LIBRARY_MAX_PERSON_PROFILES} 位家人`);
});

test('updates person name and relation without touching data', () => {
  let state = createEmptySizeLibraryState();
  state = addSizeProfile(state, 'person', '我', '本人').state;
  state = upsertSizeMeasurement(state, state.profiles[0].id, 'height', '身高', '168', 'cm', '').state;
  const updated = updateSizeProfile(state, state.profiles[0].id, {
    name: '我自己',
    relation: '本人',
  });
  assert.equal(updated.error, null);
  assert.equal(updated.state.profiles[0].name, '我自己');
  assert.equal(updated.state.measurements.length, 1);
});

test('validates numeric range and units', () => {
  const state = addSizeProfile(createEmptySizeLibraryState(), 'person', '我').state;
  const profileId = state.profiles[0].id;
  const rangeError = validateMeasurement(state, profileId, 'height', '身高', '999', 'cm', '');
  assert.equal(rangeError, '身高不能大于 250');
  const unitError = validateMeasurement(state, profileId, 'weight', '体重', '55', '斤', '');
  assert.equal(unitError, '单位只支持 cm、m、mm 或 kg');
  const ok = upsertSizeMeasurement(state, profileId, 'weight', '体重', '55', 'kg', '早晨称重');
  assert.equal(ok.error, null);
  assert.equal(ok.state.measurements[0].note, '早晨称重');
});

test('shopping check only includes relevant real fields', () => {
  let state = createEmptySizeLibraryState();
  state = addSizeProfile(state, 'person', '妈妈', '妈妈').state;
  const profileId = state.profiles[0].id;
  state = upsertSizeMeasurement(state, profileId, 'height', '身高', '158', 'cm', '').state;
  state = upsertSizeMeasurement(state, profileId, 'clothingSize', '衣服尺码', 'L', '', '肩宽偏窄').state;
  state = upsertSizeMeasurement(state, profileId, 'shoeSize', '鞋码', '37', '', '').state;

  const check = buildShoppingCheck(state, 'clothes', profileId);
  assert.equal(check.error, null);
  assert.equal(check.rows.some((row) => row.label === '鞋码'), false);
  assert.equal(check.rows.find((row) => row.dimensionKey === 'height')?.value, '158');
  assert.equal(check.rows.find((row) => row.dimensionKey === 'chest')?.filled, false);
});

test('copy text comes from real measurements only', () => {
  let state = createEmptySizeLibraryState();
  state = addSizeProfile(state, 'person', '妈妈', '妈妈').state;
  const profileId = state.profiles[0].id;
  state = upsertSizeMeasurement(state, profileId, 'height', '身高', '158', 'cm', '').state;
  state = upsertSizeMeasurement(state, profileId, 'clothingSize', '衣服尺码', 'L', '', '肩宽偏窄').state;
  const text = buildCopyText(state, 'clothes', profileId);
  assert.match(text, /妈妈 · 买衣服/);
  assert.match(text, /身高 158cm/);
  assert.match(text, /衣服尺码 L/);
  assert.match(text, /备注 肩宽偏窄/);
  assert.doesNotMatch(text, /鞋码/);
});

test('room area uses real length and width', () => {
  let state = createEmptySizeLibraryState();
  state = addSizeProfile(state, 'room', '主卧').state;
  const roomId = state.profiles[0].id;
  assert.equal(roomArea(state, roomId), null);
  state = upsertSizeMeasurement(state, roomId, 'roomLength', '房间长', '360', 'cm', '').state;
  state = upsertSizeMeasurement(state, roomId, 'roomWidth', '房间宽', '320', 'cm', '').state;
  assert.equal(roomArea(state, roomId), 115200);

  state = addSizeProfile(state, 'curtain', '主卧窗帘', '', roomId).state;
  assert.equal(relatedProfiles(state, roomId).length, 1);
});

test('scenario maps to correct profile kind and label', () => {
  assert.equal(scenarioProfileKind('shoes'), 'person');
  assert.equal(scenarioProfileKind('desk'), 'desk');
  assert.equal(shoppingScenarioLabel('curtain'), '买窗帘');
  assert.equal(shoppingScenarioLabel('room'), '房间软装');
});

test('removing room keeps linked profiles but clears relation', () => {
  let state = createEmptySizeLibraryState();
  state = addSizeProfile(state, 'room', '书房').state;
  const roomId = state.profiles[0].id;
  state = addSizeProfile(state, 'desk', '书房书桌', '', roomId).state;
  assert.equal(state.profiles[1].roomId, roomId);
  state = removeSizeProfile(state, roomId);
  assert.equal(state.profiles.length, 1);
  assert.equal(state.profiles[0].roomId, null);
});

test('local storage persists real size library', async () => {
  await clearStoredState();
  let state = createEmptySizeLibraryState();
  state = addSizeProfile(state, 'person', '我').state;
  state = upsertSizeMeasurement(state, state.profiles[0].id, 'height', '身高', '168', 'cm', '').state;
  await setSizeLibraryState(state);
  const loaded = await getSizeLibraryState();
  assert.equal(loaded.profiles.length, 1);
  assert.equal(loaded.measurements.length, 1);
});

test('clear returns an empty real-data state', () => {
  let state = createEmptySizeLibraryState();
  state = addSizeProfile(state, 'person', '我').state;
  assert.equal(getMeasurementMap(state, state.profiles[0].id) instanceof Object, true);
  const cleared = clearSizeLibraryState();
  assert.equal(cleared.profiles.length, 0);
  assert.equal(cleared.measurements.length, 0);
});
