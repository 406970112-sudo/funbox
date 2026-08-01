import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatCNY,
  formatScore,
  extractScoreInviteToken,
  roundProgress,
  scoreDifference,
  sortedParticipants,
} from '../lib/card-score.ts';

test('score difference and money formatting stay integer-safe', () => {
  assert.equal(scoreDifference([{ submitted: true, deltaPoints: 8 }, { submitted: true, deltaPoints: -3 }]), -5);
  assert.equal(formatCNY(250), '¥2.50');
  assert.equal(formatCNY(-5), '-¥0.05');
  assert.equal(formatScore(0), '0');
  assert.equal(formatScore(7), '+7');
  assert.equal(formatScore(-2), '-2');
});

test('ranking is stable across ties', () => {
  const participants = [
    { id: 'b', totalPoints: 4, joinedAt: '2026-01-01T00:00:02Z' },
    { id: 'c', totalPoints: 8, joinedAt: '2026-01-01T00:00:03Z' },
    { id: 'a', totalPoints: 4, joinedAt: '2026-01-01T00:00:01Z' },
  ];
  assert.deepEqual(sortedParticipants(participants).map((participant) => participant.id), ['c', 'a', 'b']);
  assert.deepEqual(participants.map((participant) => participant.id), ['b', 'c', 'a']);
});

test('round progress counts roster states', () => {
  assert.deepEqual(roundProgress([
    { submitted: true, confirmed: true },
    { submitted: true, confirmed: false },
    { submitted: false, confirmed: false },
  ]), { confirmed: 1, submitted: 2, total: 3 });
});

test('invite token extraction supports deep links and raw tokens', () => {
  const raw = 'abc.def.ghi';
  assert.equal(extractScoreInviteToken(`myfirstexpoapp://tools/card-score?invite=${raw}`), raw);
  assert.equal(extractScoreInviteToken(`https://funbox.example/tools/card-score?invite=${encodeURIComponent(raw)}`), raw);
  assert.equal(extractScoreInviteToken(raw), raw);
  assert.equal(extractScoreInviteToken('not an invite'), null);
  assert.equal(extractScoreInviteToken(''), null);
});
