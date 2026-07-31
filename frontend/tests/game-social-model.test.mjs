import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getGameSocialCapability,
  upsertGameMatch,
} from '../features/games/game-social-model.ts';

test('registers friend matches and score leaderboards by game capability', () => {
  assert.deepEqual(getGameSocialCapability('gomoku'), {
    friendMatch: true,
    friendLeaderboard: false,
    requiresAuthentication: true,
  });
  assert.deepEqual(getGameSocialCapability('tetris'), {
    friendMatch: false,
    friendLeaderboard: true,
    requiresAuthentication: true,
  });
  assert.equal(getGameSocialCapability('brain-challenge'), null);
});

test('upserts realtime matches without duplicating them and keeps open matches first', () => {
  const finished = {
    id: 'finished',
    status: 'finished',
    updatedAt: '2026-07-31T08:00:00Z',
  };
  const pending = {
    id: 'pending',
    status: 'pending',
    updatedAt: '2026-07-31T09:00:00Z',
  };
  const active = {
    id: 'pending',
    status: 'active',
    updatedAt: '2026-07-31T10:00:00Z',
  };

  assert.deepEqual(upsertGameMatch([finished], pending).map((match) => match.id), [
    'pending',
    'finished',
  ]);
  assert.deepEqual(upsertGameMatch([pending, finished], active), [active, finished]);
});
