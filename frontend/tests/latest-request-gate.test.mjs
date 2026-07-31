import assert from 'node:assert/strict';
import test from 'node:test';

import { createLatestRequestGate } from '../features/social/latest-request-gate.ts';

test('drops an older result that resolves after a newer refresh', async () => {
  const gate = createLatestRequestGate();
  let resolveOlder;
  let resolveNewer;
  const older = gate.run(
    () =>
      new Promise((resolve) => {
        resolveOlder = resolve;
      }),
  );
  const newer = gate.run(
    () =>
      new Promise((resolve) => {
        resolveNewer = resolve;
      }),
  );

  resolveNewer('one unread message');
  assert.equal(await newer, 'one unread message');

  resolveOlder('zero unread messages');
  assert.equal(await older, undefined);
});

test('invalidates an outstanding refresh', async () => {
  const gate = createLatestRequestGate();
  let resolveRequest;
  const result = gate.run(
    () =>
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
  );

  gate.invalidate();
  resolveRequest('stale account state');

  assert.equal(await result, undefined);
});

test('drops an older error after a newer refresh starts', async () => {
  const gate = createLatestRequestGate();
  let rejectOlder;
  const older = gate.run(
    () =>
      new Promise((_, reject) => {
        rejectOlder = reject;
      }),
  );
  const newer = gate.run(() => Promise.resolve('current state'));

  assert.equal(await newer, 'current state');
  rejectOlder(new Error('stale network failure'));

  assert.equal(await older, undefined);
});
