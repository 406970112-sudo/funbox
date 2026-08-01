import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hasIdentityBadge,
  identityPresentation,
  identityRoute,
} from '../lib/identity.ts';

test('VIP uses the gold premium token', () => {
  const vip = identityPresentation('vip');
  assert.equal(vip.color, '#e8a33d');
  assert.equal(vip.icon, 'diamond-stone');
  assert.equal(vip.label, 'VIP');
});

test('keeps the administrator badge readable in dark mode', () => {
  assert.equal(identityPresentation('admin', 'dark').color, '#c9f36a');
});

test('normal users do not get a constant badge', () => {
  assert.equal(identityPresentation('normal').label, '普通用户');
  assert.equal(hasIdentityBadge('normal'), false);
  assert.equal(hasIdentityBadge('vip'), true);
  assert.equal(hasIdentityBadge('svip'), true);
  assert.equal(hasIdentityBadge('admin'), true);
});

test('routes members to membership center and admins to the console', () => {
  assert.equal(identityRoute('vip'), '/profile/membership');
  assert.equal(identityRoute('svip'), '/profile/membership');
  assert.equal(identityRoute('normal'), '/profile/membership');
  assert.equal(identityRoute('admin'), '/admin');
});
