import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLocalHome,
  deadlineLabel,
  eventActionLabel,
  localAddItem,
  localDiscard,
  localEat,
  localReheat,
  localUpdateItem,
  reheatLabel,
  remainingLabel,
  sourceTypeLabel,
  validateLeftoverItemInput,
  zoneLabel,
} from '../lib/leftover-manager.ts';
import {
  clearLeftoverLocalState,
  getLeftoverLocalState,
  setLeftoverLocalState,
} from '../lib/leftover-manager-storage.ts';
import { createEmptyLeftoverLocalState } from '../types/leftover-manager.ts';

test('leftover manager labels are stable', () => {
  assert.equal(sourceTypeLabel('takeout'), '外卖');
  assert.equal(zoneLabel('freezer'), '冷冻');
  assert.equal(reheatLabel(0), '未加热');
  assert.equal(reheatLabel(1), '已加热 1 次');
  assert.equal(eventActionLabel('eaten'), '吃完');
});

test('leftover input validation rejects empty and bad time', () => {
  const now = Date.now();
  const valid = {
    name: '昨天的红烧肉', sourceType: 'leftover', merchant: '',
    enteredFridgeAt: now - 1000, expectedConsumeAt: now + 1000,
    storedZone: 'fridge', remainingPercent: 50, remainingText: '一半',
    reheatCount: 0, tags: ['红烧肉'], costCents: 1800, notes: '',
  };
  assert.equal(validateLeftoverItemInput(valid), null);
  assert.equal(validateLeftoverItemInput({ ...valid, name: ' ' }), '名称需为 1-40 个字符');
  assert.equal(validateLeftoverItemInput({ ...valid, expectedConsumeAt: valid.enteredFridgeAt }), '预计食用期限必须晚于入冰箱时间');
});

test('local add update reheat eat discard uses real data', () => {
  let state = createEmptyLeftoverLocalState();
  const now = Date.now();
  const added = localAddItem(state, {
    name: '昨天的红烧肉', sourceType: 'leftover', merchant: '',
    enteredFridgeAt: now - 20 * 60 * 60 * 1000, expectedConsumeAt: now + 2 * 60 * 60 * 1000,
    storedZone: 'fridge', remainingPercent: 50, remainingText: '一半',
    reheatCount: 0, tags: ['红烧肉'], costCents: 1800, notes: '',
  });
  assert.equal(added.error, null);
  state = added.state;
  const itemId = state.items[0].id;
  state = localReheat(state, itemId).state;
  assert.equal(state.items[0].reheatCount, 1);
  state = localEat(state, itemId).state;
  assert.equal(state.items[0].status, 'eaten');
  const second = localAddItem(state, {
    name: '隔夜豆浆', sourceType: 'takeout', merchant: '',
    enteredFridgeAt: now - 1000, expectedConsumeAt: now - 100,
    storedZone: 'fridge', remainingPercent: 40, remainingText: '',
    reheatCount: 0, tags: [], costCents: 600, notes: '',
  });
  state = second.state;
  const discarded = localDiscard(state, second.item.id, '变质');
  assert.equal(discarded.error, null);
  assert.equal(discarded.item.status, 'discarded');
});

test('local suggestions only use active real items', () => {
  let state = createEmptyLeftoverLocalState();
  const now = Date.now();
  const tomato = localAddItem(state, {
    name: '西红柿', sourceType: 'ingredient', merchant: '',
    enteredFridgeAt: now - 1000, expectedConsumeAt: now + 24 * 60 * 60 * 1000,
    storedZone: 'fridge', remainingPercent: 100, remainingText: '',
    reheatCount: 0, tags: ['西红柿'], costCents: 0, notes: '',
  });
  state = tomato.state;
  const egg = localAddItem(state, {
    name: '鸡蛋', sourceType: 'ingredient', merchant: '',
    enteredFridgeAt: now - 1000, expectedConsumeAt: now + 48 * 60 * 60 * 1000,
    storedZone: 'fridge', remainingPercent: 100, remainingText: '',
    reheatCount: 0, tags: ['鸡蛋'], costCents: 0, notes: '',
  });
  state = egg.state;
  const home = buildLocalHome(state, now);
  assert.ok(home.suggestions.some((item) => item.recipeId === 'tomato-scrambled-eggs'));
  assert.equal(home.summary.activeCount, 2);
});

test('local storage persists real leftover state', async () => {
  await clearLeftoverLocalState();
  const state = createEmptyLeftoverLocalState();
  const added = localAddItem(state, {
    name: '半盒草莓', sourceType: 'opened', merchant: '',
    enteredFridgeAt: Date.now() - 1000, expectedConsumeAt: Date.now() + 1000,
    storedZone: 'fridge', remainingPercent: 50, remainingText: '半盒',
    reheatCount: 0, tags: ['草莓'], costCents: 1500, notes: '',
  });
  await setLeftoverLocalState(added.state);
  const loaded = await getLeftoverLocalState();
  assert.equal(loaded.items.length, 1);
  assert.equal(loaded.items[0].name, '半盒草莓');
  assert.equal(remainingLabel(loaded.items[0]), '半盒');
  assert.equal(deadlineLabel(loaded.items[0], Date.now() + 2000), '已过期');
});
