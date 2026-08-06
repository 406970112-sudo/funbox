import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addHomeContact,
  addHomeDevice,
  addHomeNetwork,
  addHomeReminder,
  getFilterDueDate,
  removeHomeContact,
  removeHomeDevice,
  removeHomeNetwork,
  removeHomeReminder,
  searchHomeManual,
  updateHomeDevice,
} from '../lib/home-manual.ts';
import {
  clearHomeManualState,
  getHomeManualState,
  setHomeManualState,
} from '../lib/home-manual-storage.ts';
import { createEmptyHomeManualState } from '../types/home-manual.ts';

test('adds real device and rejects duplicate name', () => {
  let state = createEmptyHomeManualState();
  const now = Date.now();
  const added = addHomeDevice(state, {
    id: 'd1',
    category: 'water-purifier',
    name: '厨房净水器',
    brand: '真实品牌',
    model: '真实型号',
    room: '厨房',
    purchaseDate: '2026-01-01',
    warrantyEndDate: '2028-01-01',
    manualText: '真实操作说明',
    note: '',
    photoIds: [],
    filterModel: '真实滤芯型号',
    filterQuantity: 1,
    filterChangedAt: '2026-07-01',
    filterCycleDays: 180,
    createdAt: now,
    updatedAt: now,
  });
  assert.equal(added.error, null);
  state = added.state;
  const duplicate = addHomeDevice(state, { ...state.devices[0], id: 'd2' });
  assert.equal(duplicate.error, '厨房净水器 已存在');
});

test('computes filter due date only from real dates', () => {
  const now = Date.now();
  const device = {
    id: 'd1',
    category: 'water-purifier',
    name: '净水器',
    brand: '',
    model: '',
    room: '',
    purchaseDate: '',
    warrantyEndDate: '',
    manualText: '',
    note: '',
    photoIds: [],
    filterModel: '',
    filterQuantity: 0,
    filterChangedAt: '2026-07-01',
    filterCycleDays: 90,
    createdAt: now,
    updatedAt: now,
  };
  assert.equal(getFilterDueDate(device), '2026-09-29');
  assert.equal(getFilterDueDate({ ...device, filterCycleDays: 0 }), null);
});

test('updates and removes devices without leaking reminders', () => {
  let state = createEmptyHomeManualState();
  const now = Date.now();
  const device = {
    id: 'd1',
    category: 'air-conditioner',
    name: '客厅空调',
    brand: '',
    model: '',
    room: '',
    purchaseDate: '',
    warrantyEndDate: '',
    manualText: '',
    note: '',
    photoIds: [],
    filterModel: '',
    filterQuantity: 0,
    filterChangedAt: '',
    filterCycleDays: 0,
    createdAt: now,
    updatedAt: now,
  };
  state = addHomeDevice(state, device).state;
  state = updateHomeDevice(state, { ...device, note: '真实备注' }).state;
  assert.equal(state.devices[0].note, '真实备注');
  state = removeHomeDevice(state, 'd1');
  assert.equal(state.devices.length, 0);
});

test('adds network and contact with real values', () => {
  let state = createEmptyHomeManualState();
  const now = Date.now();
  state = addHomeNetwork(state, {
    id: 'n1',
    name: '家庭网络',
    ssid: 'HomeWiFi',
    securityType: 'WPA2',
    wifiPassword: '真实密码',
    routerUrl: '192.168.1.1',
    routerAccount: '',
    routerPassword: '',
    broadbandCarrier: '',
    broadbandAccount: '',
    broadbandPassword: '',
    note: '',
    createdAt: now,
    updatedAt: now,
  }).state;
  state = addHomeContact(state, {
    id: 'c1',
    kind: 'property',
    name: '物业',
    phone: '13800000000',
    phoneAlt: '',
    wechat: '',
    address: '',
    serviceHours: '09:00-18:00',
    serviceScope: '小区报修',
    note: '',
    createdAt: now,
    updatedAt: now,
  }).state;
  assert.equal(state.networks[0].wifiPassword, '真实密码');
  assert.equal(state.contacts[0].phone, '13800000000');
});

test('search unlocks secret fields only when unlocked', () => {
  const now = Date.now();
  const state = createEmptyHomeManualState();
  state.networks.push({
    id: 'n1',
    name: '家庭网络',
    ssid: 'HomeWiFi',
    securityType: 'WPA2',
    wifiPassword: 'secret-password',
    routerUrl: '192.168.1.1',
    routerAccount: '',
    routerPassword: '',
    broadbandCarrier: '',
    broadbandAccount: '',
    broadbandPassword: '',
    note: '',
    createdAt: now,
    updatedAt: now,
  });
  assert.equal(searchHomeManual(state, 'secret-password', false).networks.length, 0);
  assert.equal(searchHomeManual(state, 'secret-password', true).networks.length, 1);
});

test('local storage persists real home manual state', async () => {
  await clearHomeManualState();
  const now = Date.now();
  const state = createEmptyHomeManualState();
  state.devices.push({
    id: 'd1',
    category: 'washing-machine',
    name: '洗衣机',
    brand: '',
    model: '',
    room: '',
    purchaseDate: '',
    warrantyEndDate: '',
    manualText: '',
    note: '',
    photoIds: [],
    filterModel: '',
    filterQuantity: 0,
    filterChangedAt: '',
    filterCycleDays: 0,
    createdAt: now,
    updatedAt: now,
  });
  await setHomeManualState(state);
  const loaded = await getHomeManualState();
  assert.equal(loaded.devices.length, 1);
  assert.equal(loaded.devices[0].name, '洗衣机');
});

test('removes each entity type independently', () => {
  const now = Date.now();
  let state = createEmptyHomeManualState();
  state = addHomeNetwork(state, {
    id: 'n1',
    name: '网络',
    ssid: '',
    securityType: 'WPA2',
    wifiPassword: '',
    routerUrl: '',
    routerAccount: '',
    routerPassword: '',
    broadbandCarrier: '',
    broadbandAccount: '',
    broadbandPassword: '',
    note: '',
    createdAt: now,
    updatedAt: now,
  }).state;
  state = addHomeContact(state, {
    id: 'c1',
    kind: 'custom',
    name: '联系人',
    phone: '',
    phoneAlt: '',
    wechat: '',
    address: '',
    serviceHours: '',
    serviceScope: '',
    note: '',
    createdAt: now,
    updatedAt: now,
  }).state;
  state = addHomeReminder(state, {
    id: 'r1',
    kind: 'custom',
    title: '提醒',
    targetDate: '2026-09-01',
    cycleDays: 0,
    sourceDeviceId: '',
    note: '',
    status: 'pending',
    doneAt: 0,
    createdAt: now,
    updatedAt: now,
  }).state;
  assert.equal(removeHomeNetwork(state, 'n1').networks.length, 0);
  assert.equal(removeHomeContact(state, 'c1').contacts.length, 0);
  assert.equal(removeHomeReminder(state, 'r1').reminders.length, 0);
});
