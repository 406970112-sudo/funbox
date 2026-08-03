import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildIntradayChartPoints,
  formatTriggerTime,
  getDirectionLabel,
  getSignalConditions,
  getSignalStatusLabel,
  getTriggerPrice,
  isValidIntradaySnapshot,
  isValidStockAlertEvent,
  isValidStockSymbol,
  isValidStockWatchItem,
} from '../lib/stock-alert.ts';

const rule = {
  buyTrigger: 1450,
  buyConditions: ['分时价站稳 1450 上方', '分时价位于分时均价上方', '量比 >= 1.1'],
  buyReferenceLow: 1440,
  buyReferenceHigh: 1458,
  sellTrigger: 1458.6,
  sellConditions: ['分时价放量突破 1458.60', '5 分钟涨速 >= 0.2%'],
  sellReferenceLow: 1458.6,
  sellReferenceHigh: 1510,
  stopLoss: 1440,
  validTradingDays: 5,
  reasons: ['现价贴近 MA20', 'RSI14 中性'],
  summary: '等待站稳后放量确认',
};

test('maps signal status to Chinese labels', () => {
  assert.equal(getSignalStatusLabel('buy-triggered'), '买入信号触发');
  assert.equal(getSignalStatusLabel('stop-triggered'), '止损信号触发');
  assert.equal(getSignalStatusLabel('data-missing'), '分时数据缺失');
});

test('returns exact trigger price and conditions per direction', () => {
  assert.equal(getTriggerPrice(rule, 'buy'), 1450);
  assert.equal(getTriggerPrice(rule, 'sell'), 1458.6);
  assert.equal(getTriggerPrice(rule, 'stop'), 1440);
  assert.equal(getSignalConditions(rule, 'buy').length, 3);
  assert.equal(getSignalConditions(rule, 'stop')[0], '分时价跌破止损价 1440.00');
  assert.equal(getDirectionLabel('sell'), '卖出');
});

test('builds intraday chart points from real minute prices', () => {
  const points = buildIntradayChartPoints(
    [{ price: 100 }, { price: 101 }, { price: 99 }],
    200,
    100,
  );
  assert.equal(points.length, 3);
  assert.equal(points[0].x, 0);
  assert.equal(points[2].x, 200);
  assert.equal(points[1].y, 0);
  assert.equal(points[2].y, 100);
});

test('validates real API response shapes without fake fallback', () => {
  assert.ok(isValidStockSymbol({ code: '600519', name: '贵州茅台', market: 'SH', secId: '1.600519' }));
  assert.ok(!isValidStockSymbol({ code: 600519 }));
  assert.ok(
    isValidStockWatchItem({
      id: 'w1',
      symbolCode: '600519',
      name: '贵州茅台',
      signalStatus: 'listening',
      reminderTypes: ['buy', 'sell', 'stop'],
    }),
  );
  assert.ok(!isValidStockWatchItem({ id: 'w1' }));
  assert.ok(
    isValidIntradaySnapshot({
      fetchedAt: '2026-08-05T09:41:00+08:00',
      points: [{ price: 1450 }],
      latest: { price: 1450 },
    }),
  );
  assert.ok(!isValidIntradaySnapshot({ points: [{ price: '1450' }] }));
  assert.ok(
    isValidStockAlertEvent({
      id: 'e1',
      direction: 'buy',
      triggerTime: '2026-08-05T09:41:00+08:00',
      triggerPrice: 1450,
      conditions: ['条件'],
    }),
  );
  assert.ok(!isValidStockAlertEvent({ id: 'e1', triggerPrice: 'x' }));
});

test('formats trigger time as local readable timestamp', () => {
  assert.equal(formatTriggerTime('2026-08-05T09:41:00+08:00').length, 14);
  assert.equal(formatTriggerTime('not-a-date'), 'not-a-date');
});
