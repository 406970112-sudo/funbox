import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_MEMBERSHIP_PLANS,
  formatPriceCents,
  membershipPlanForTier,
  membershipPlanName,
} from '../lib/membership-payment-model.ts';

test('defaults match the VIP and SVIP monthly pricing', () => {
  assert.deepEqual(DEFAULT_MEMBERSHIP_PLANS, [
    { period: 'month', priceCents: 200, tier: 'vip' },
    { period: 'month', priceCents: 500, tier: 'svip' },
  ]);
});

test('formats membership prices with two decimals', () => {
  assert.equal(formatPriceCents(200), '2.00');
  assert.equal(formatPriceCents(500), '5.00');
});

test('maps tiers to membership plan names', () => {
  assert.equal(membershipPlanName('vip'), 'VIP 月卡');
  assert.equal(membershipPlanName('svip'), 'SVIP 月卡');
});

test('falls back to defaults when the server plan list is incomplete', () => {
  const plan = membershipPlanForTier('svip', [{ period: 'month', priceCents: 300, tier: 'vip' }]);
  assert.equal(plan.tier, 'svip');
  assert.equal(plan.priceCents, 500);
});
