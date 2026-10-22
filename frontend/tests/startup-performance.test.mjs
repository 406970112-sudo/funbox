import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getApplicableFeatureSnapshot,
} from '../features/access/feature-access-snapshot.ts';
import {
  shouldRefreshAfterSocketOpen,
  STARTUP_SOCIAL_REFRESH_DEDUPE_MS,
} from '../features/social/startup-refresh.ts';

test('accepts authenticated feature data only for the verified token', () => {
  const snapshot = { error: false, ids: ['visible'], token: 'token-a' };

  assert.equal(getApplicableFeatureSnapshot(snapshot, 'authenticated', 'token-a'), snapshot);
  assert.equal(getApplicableFeatureSnapshot(snapshot, 'authenticated', 'token-b'), null);
});

test('does not commit feature data while authentication is still loading', () => {
  const snapshot = { error: false, ids: ['visible'], token: 'token-a' };

  assert.equal(getApplicableFeatureSnapshot(snapshot, 'loading', null), null);
});

test('uses anonymous feature data only after the anonymous session settles', () => {
  const anonymousSnapshot = { error: false, ids: ['public'], token: null };
  const tokenSnapshot = { error: false, ids: ['private'], token: 'token-a' };

  assert.equal(getApplicableFeatureSnapshot(anonymousSnapshot, 'anonymous', null), anonymousSnapshot);
  assert.equal(getApplicableFeatureSnapshot(tokenSnapshot, 'anonymous', null), null);
});

test('skips the duplicate refresh immediately after the initial social snapshot', () => {
  assert.equal(shouldRefreshAfterSocketOpen(1_000, 1_000), false);
  assert.equal(
    shouldRefreshAfterSocketOpen(1_000, 1_000 + STARTUP_SOCIAL_REFRESH_DEDUPE_MS),
    true,
  );
});

test('refreshes when the socket opens before any social snapshot completed', () => {
  assert.equal(shouldRefreshAfterSocketOpen(0), true);
});
