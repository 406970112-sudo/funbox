import assert from 'node:assert/strict';
import test from 'node:test';

import {
  answerLabel,
  completionRateText,
  formatCents,
  formatHours,
  parseYuanToCents,
  remainingText,
  riskMeta,
  sourceLabel,
  statusMeta,
} from '../lib/impulse-cooler.ts';

test('price parsing keeps integer cents', () => {
  assert.equal(parseYuanToCents('1299'), 129900);
  assert.equal(parseYuanToCents('42.80'), 4280);
  assert.equal(parseYuanToCents('0'), null);
  assert.equal(parseYuanToCents(''), null);
});

test('price and hour formatting stay stable', () => {
  assert.equal(formatCents(129900), '1299.00');
  assert.equal(formatHours(30.36), '30.4');
  assert.equal(formatHours(undefined), '--');
});

test('risk and status labels are readable', () => {
  assert.equal(riskMeta('high').label, '高提醒');
  assert.equal(riskMeta('medium').label, '中提醒');
  assert.equal(statusMeta('pending_decision').label, '待决定');
  assert.equal(statusMeta('dropped').label, '已放弃');
  assert.equal(sourceLabel('screenshot'), '用户上传截图');
});

test('answers render without fake fallback values', () => {
  const answers = {
    whyBuy: 'promo',
    similarCount: 'one',
    similarInUse: 'no',
    usageFrequency: 'rarely',
    wantsAfter24h: 'unsure',
  };
  assert.equal(answerLabel(answers, 'whyBuy'), '被促销吸引');
  assert.equal(answerLabel(answers, 'similarCount'), '有 1 件，不经常使用');
  assert.equal(answerLabel(answers, 'usageFrequency'), '偶尔');
  assert.equal(answerLabel(answers, 'wantsAfter24h'), '不确定');
});

test('countdown and completion rate use real values', () => {
  assert.equal(remainingText(
    {
      coolEndsAt: new Date('2026-08-07T00:00:00.000Z').toISOString(),
    },
    '2026-08-06T00:00:00.000Z',
  ), '24:00:00');
  assert.equal(completionRateText({ completionRate: 33.333 }), '33.3%');
});
