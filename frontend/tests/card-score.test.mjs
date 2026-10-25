import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildScoreGiftAllocations,
  canForceOpenZhaJinHua,
  formatCNY,
  formatRateInput,
  formatScore,
  extractScoreInviteToken,
  parseYuanToCents,
  roundProgress,
  scoreDifference,
  sortedParticipants,
  zhaJinHuaActivePlayerCount,
} from '../lib/card-score.ts';

test('score difference and money formatting stay integer-safe', () => {
  assert.equal(scoreDifference([{ submitted: true, deltaPoints: 8 }, { submitted: true, deltaPoints: -3 }]), -5);
  assert.equal(formatCNY(250), '¥2.50');
  assert.equal(formatCNY(-5), '-¥0.05');
  assert.equal(formatScore(0), '0');
  assert.equal(formatScore(7), '+7');
  assert.equal(formatScore(-2), '-2');
});

test('settlement rates parse to integer cents without floating point drift', () => {
  assert.equal(parseYuanToCents('0.5'), 50);
  assert.equal(parseYuanToCents('1'), 100);
  assert.equal(parseYuanToCents('2.00'), 200);
  assert.equal(parseYuanToCents('1.05'), 105);
  assert.equal(parseYuanToCents('0'), null);
  assert.equal(parseYuanToCents('1.234'), null);
  assert.equal(parseYuanToCents('abc'), null);
  assert.equal(formatRateInput(50), '0.5');
  assert.equal(formatRateInput(100), '1');
  assert.equal(formatRateInput(105), '1.05');
});

test('batch gifts keep each recipient amount and reject invalid drafts', () => {
  assert.deepEqual(buildScoreGiftAllocations(['b', 'c'], { b: '10', c: '5' }), {
    allocations: [{ toParticipantId: 'b', points: 10 }, { toParticipantId: 'c', points: 5 }],
    hasEnteredPoints: true,
    invalid: false,
    totalPoints: 15,
  });
  assert.equal(buildScoreGiftAllocations(['b', 'c'], { b: '10', c: '' }).invalid, false);
  assert.equal(buildScoreGiftAllocations(['b', 'c'], { b: '0' }).invalid, true);
  assert.equal(buildScoreGiftAllocations(['b', 'c'], { b: '1.5' }).invalid, true);
  assert.equal(buildScoreGiftAllocations(['b', 'c'], { b: '2147483647', c: '1' }).invalid, true);
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

test('zha jin hua force open follows remaining active player threshold', () => {
  const hand = {
    forceOpenThreshold: 2,
    currentBetPoints: 10,
    players: [
      { status: 'active' },
      { status: 'active' },
      { status: 'folded' },
    ],
  };
  assert.equal(zhaJinHuaActivePlayerCount(hand), 2);
  assert.equal(canForceOpenZhaJinHua(hand), true);
  assert.equal(canForceOpenZhaJinHua({ ...hand, players: hand.players.slice(0, 2).concat([{ status: 'active' }]) }), false);
  assert.equal(canForceOpenZhaJinHua({ ...hand, players: [{ status: 'active' }, { status: 'folded' }] }), false);
  assert.equal(canForceOpenZhaJinHua({ ...hand, currentBetPoints: 0 }), false);
});

test('invite token extraction supports deep links and raw tokens', () => {
  const raw = 'abc.def.ghi';
  assert.equal(extractScoreInviteToken(`myfirstexpoapp://tools/card-score?invite=${raw}`), raw);
  assert.equal(extractScoreInviteToken(`https://funbox.example/tools/card-score?invite=${encodeURIComponent(raw)}`), raw);
  assert.equal(extractScoreInviteToken(raw), raw);
  assert.equal(extractScoreInviteToken('not an invite'), null);
  assert.equal(extractScoreInviteToken(''), null);
});
