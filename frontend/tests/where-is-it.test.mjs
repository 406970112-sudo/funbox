import assert from 'node:assert/strict';
import test from 'node:test';

import {
  eventActionLabel,
  lastSeenLabel,
  locationLabel,
  parseTags,
  roomIconName,
  tagsText,
  unconfirmedLabel,
} from '../lib/where-is-it.ts';
import { WHERE_IS_IT_CATEGORIES } from '../types/where-is-it.ts';

test('where is it room icons map to Material Community Icons', () => {
  assert.equal(roomIconName('sofa'), 'sofa');
  assert.equal(roomIconName('notebook-pen'), 'notebook-edit-outline');
  assert.equal(roomIconName('missing'), 'home-outline');
});

test('where is it tags parse from real user input', () => {
  assert.deepEqual(parseTags(' 钥匙,备用、应急 常用 '), ['钥匙', '备用', '应急', '常用']);
  assert.equal(parseTags('a,b,c,d,e,f,g,h,i,j').length, 8);
});

test('where is it labels stay stable', () => {
  assert.equal(tagsText(['钥匙', '备用']), '钥匙、备用');
  assert.equal(eventActionLabel('move'), '移动位置');
  assert.equal(eventActionLabel('confirm'), '确认还在');
  assert.equal(unconfirmedLabel(0), '最近已确认');
  assert.equal(unconfirmedLabel(181), '已 180+ 天未确认');
});

test('where is it item location combines real room and detail', () => {
  const item = { roomName: '客厅', locationDetail: '电视柜第二层' };
  assert.equal(locationLabel(item), '客厅 · 电视柜第二层');
  assert.equal(lastSeenLabel({ lastSeenAt: undefined }), '暂无确认记录');
});

test('where is it categories are product structure, not mock items', () => {
  assert.deepEqual(WHERE_IS_IT_CATEGORIES, ['钥匙', '证件票据', '工具', '数码', '药品', '衣物', '其他']);
});
