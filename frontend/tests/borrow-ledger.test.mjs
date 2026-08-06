import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addBorrowRecord,
  buildReminderText,
  clearBorrowLedgerState,
  completeBorrowRecord,
  recordStatus,
  reminderCandidates,
  searchBorrowRecords,
  validateBorrowRecord,
} from '../lib/borrow-ledger.ts';
import {
  clearBorrowLedgerState as clearStoredState,
  getBorrowLedgerState,
  setBorrowLedgerState,
} from '../lib/borrow-ledger-storage.ts';
import { createEmptyBorrowLedgerState } from '../types/borrow-ledger.ts';

const baseRecord = {
  id: 'r1',
  kind: 'lend_out',
  subjectType: 'item',
  title: 'JavaScript高级程序设计',
  counterparty: { name: '阿哲' },
  lentAt: '2026-07-25',
  dueAt: '2026-08-02',
  remindRule: 'before_3d',
  createdAt: 100,
  updatedAt: 100,
};

test('adds a real item record and rejects duplicates', () => {
  let state = createEmptyBorrowLedgerState();
  const added = addBorrowRecord(state, baseRecord);
  assert.equal(added.error, null);
  assert.equal(added.state.records.length, 1);
  assert.equal(added.state.records[0].counterparty.name, '阿哲');

  const duplicate = addBorrowRecord(added.state, baseRecord);
  assert.equal(duplicate.error, '记录已存在，不能重复添加');
  assert.equal(duplicate.state.records.length, 1);
});

test('rejects money records without a real amount', () => {
  const record = {
    ...baseRecord,
    id: 'money-1',
    subjectType: 'money',
    title: '借款',
    amount: 0,
    currency: 'CNY',
  };
  assert.match(validateBorrowRecord(record), /大于 0/);
});

test('derives active, overdue and done status from real dates', () => {
  const now = new Date(2026, 7, 6);
  assert.equal(recordStatus(baseRecord, now), 'overdue');

  const active = { ...baseRecord, id: 'active-1', dueAt: '2026-08-10' };
  assert.equal(recordStatus(active, now), 'active');

  const done = { ...baseRecord, id: 'done-1', returnedAt: '2026-08-01' };
  assert.equal(recordStatus(done, now), 'done');
});

test('reminder card comes from real fields and never exposes account credentials', () => {
  const accountRecord = {
    ...baseRecord,
    id: 'account-1',
    subjectType: 'account',
    title: '视频平台',
    platform: '视频平台',
    accountName: '我的会员账号',
    dueAt: '2026-08-10',
  };
  const text = buildReminderText(accountRecord, 'casual', new Date(2026, 7, 6));
  assert.match(text, /你在 12 天前借走了我的「视频平台 · 我的会员账号」/);
  assert.doesNotMatch(text, /密码|验证码|登录态/);
});

test('search finds people, items, amount and account fields', () => {
  const state = createEmptyBorrowLedgerState();
  const records = [
    baseRecord,
    {
      ...baseRecord,
      id: 'money-2',
      subjectType: 'money',
      title: '垫付费用',
      amount: 120,
      currency: 'CNY',
      counterparty: { name: '小王' },
      kind: 'paid_for',
      remindRule: 'none',
    },
    {
      ...baseRecord,
      id: 'account-2',
      subjectType: 'account',
      title: '视频平台',
      platform: '视频平台',
      accountName: '会员账号',
      counterparty: { name: 'Luna' },
    },
  ];
  assert.equal(searchBorrowRecords(records, '阿哲').length, 1);
  assert.equal(searchBorrowRecords(records, '120').length, 1);
  assert.equal(searchBorrowRecords(records, '视频平台').length, 1);
  assert.equal(searchBorrowRecords(records, '不存在').length, 0);
});

test('completing a record removes it from reminder candidates', () => {
  let state = createEmptyBorrowLedgerState();
  state = addBorrowRecord(state, baseRecord).state;
  assert.equal(reminderCandidates(state, new Date(2026, 7, 6)).length, 1);
  state = completeBorrowRecord(state, baseRecord.id, new Date(2026, 7, 6));
  assert.equal(state.records[0].returnedAt, '2026-08-06');
  assert.equal(reminderCandidates(state, new Date(2026, 7, 6)).length, 0);
});

test('local storage persists real borrow ledger state', async () => {
  await clearStoredState();
  let state = createEmptyBorrowLedgerState();
  state = addBorrowRecord(state, baseRecord).state;
  await setBorrowLedgerState(state);
  const loaded = await getBorrowLedgerState();
  assert.equal(loaded.records.length, 1);
  assert.equal(loaded.records[0].title, 'JavaScript高级程序设计');
});

test('clear returns an empty real-data state', () => {
  const cleared = clearBorrowLedgerState();
  assert.equal(cleared.records.length, 0);
});
