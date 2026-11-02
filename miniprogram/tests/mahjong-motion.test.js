const test = require('node:test');
const assert = require('node:assert/strict');
const { deriveMahjongMotion, motionPage, motionData } = require('../utils/mahjong-motion');
function room(version, points = [16, 8, -12, -12], extra = {}) {
  return { id: 'r', gameType: 'mahjong', status: 'active', version, giftBatches: [],
    participants: points.map((totalPoints, index) => ({ id: String(index), status: 'active', totalPoints, displayName: `牌友${index}`, joinedAt: String(index) })), ...extra };
}
function page(extra = {}) {
  return { ...motionPage, data: { ...motionData, ...extra }, setData(patch) { Object.assign(this.data, patch); } };
}
function rows(snapshot) {
  return snapshot.participants.map((p, index) => ({ ...p, rank: index + 1, scoreText: String(p.totalPoints) }));
}
test('initial, repeated, stale, other-room and non-mahjong snapshots do not replay events', () => {
  const before = room(3);
  for (const [previous, next] of [[null, before], [before, before], [before, room(2)], [before, room(4, undefined, { id: 'other' })], [before, room(4, undefined, { gameType: 'generic' })]]) {
    assert.equal(deriveMahjongMotion(previous, next), null);
  }
});
test('a received gift animates an increase even if the total remains negative', () => {
  const motion = deriveMahjongMotion(room(1), room(2, [8, 8, -4, -12]));
  assert.deepEqual(motion.changes.map(({ id, delta }) => [id, delta]), [['0', -8], ['2', 8]]);
});
test('membership, start and settlement are distinct transitions', () => {
  const waiting = room(1, [0, 0], { status: 'waiting' });
  const joined = room(2, [0, 0, 0], { status: 'waiting' });
  assert.deepEqual(deriveMahjongMotion(waiting, joined).joined.map(p => p.id), ['2']);
  assert.equal(deriveMahjongMotion(joined, room(3)).started, true);
  assert.equal(deriveMahjongMotion(room(3), room(4, undefined, { status: 'settled' })).settled, true);
});
test('one batch can send to multiple players; old gift batches do not replay', () => {
  const oldBatch = { id: 'old', gifts: [{ fromParticipantId: '0', toParticipantId: '1', points: 2 }] };
  const newBatch = { id: 'new', gifts: [{ fromParticipantId: '0', toParticipantId: '1', points: 3 }, { fromParticipantId: '0', toParticipantId: '2', points: 5 }] };
  const motion = deriveMahjongMotion(room(1, undefined, { giftBatches: [oldBatch] }), room(2, [8, 11, -7, -12], { giftBatches: [newBatch, oldBatch] }));
  assert.equal(motion.transfers.length, 2);
  assert.equal(motion.transfers[1].points, 5);
});
test('reduced motion and resume apply final scores without historical effects', () => {
  for (const reducedMotion of [false, true]) {
    const next = room(2, [24, 8, -12, -20]);
    const p = page({ reducedMotion });
    p.motionResuming = true;
    p.updateMahjongMotion(room(1), next, rows(next));
    assert.equal(p.data.motionScoreRows[0].displayScoreText, '+24');
    assert.equal(p.data.motionScoreRows[0].deltaText, '');
    assert.equal(p.data.motionScene, '');
    assert.equal(Boolean(p.motionScoreTimer), false);
  }
});
test('hiding or disabling effects clears transient state and shows authoritative final scores', () => {
  const next = room(2, [24, 8, -12, -20]);
  const p = page({ room: next });
  p.updateMahjongMotion(room(1), next, rows(next));
  assert.equal(p.data.motionScoreRows[0].deltaText, '+8');
  p.clearMahjongMotion();
  assert.equal(p.data.motionScoreRows[0].displayScoreText, '+24');
  assert.equal(p.data.motionScoreRows[0].deltaText, '');
  assert.equal(p.data.motionNotice, '');
  assert.equal(p.motionScoreTimer, null);
});
test('a newer snapshot interrupts an unfinished score animation without overwriting final totals', () => {
  const p = page();
  const a = room(2, [24, 8, -12, -20]);
  const b = room(3, [32, 8, -12, -28]);
  p.updateMahjongMotion(room(1), a, rows(a));
  p.updateMahjongMotion(a, b, rows(b));
  p.clearMahjongMotion();
  assert.equal(p.data.motionScoreRows[0].displayScoreText, '+32');
  assert.equal(p.data.motionScoreRows[3].displayScoreText, '-28');
});

test('the positioned ranking reserves space for every player', () => {
  const next = room(1);
  const p = page();
  p.updateMahjongMotion(null, next, rows(next));
  assert.equal(p.data.motionBoardHeight, 472);
});

test('an in-flight response received while hidden cannot consume the resume guard', () => {
  const p = page();
  p.motionResuming = true;
  p.pageVisible = false;
  const hidden = room(2, [24, 8, -12, -20]);
  p.updateMahjongMotion(room(1), hidden, rows(hidden));
  assert.equal(p.motionResuming, true);
  p.pageVisible = true;
  const resumed = room(3, [32, 8, -12, -28]);
  p.updateMahjongMotion(hidden, resumed, rows(resumed));
  assert.equal(p.data.motionScoreRows[0].deltaText, '');
  assert.equal(p.data.motionScoreRows[0].displayScoreText, '+32');
  assert.equal(p.motionResuming, false);
});

test('score interpolation finishes at the authoritative value and a repeated poll does not replay it', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const next = room(2, [24, 8, -12, -20]);
  const p = page();
  p.updateMahjongMotion(room(1), next, rows(next));
  const timer = p.motionScoreTimer;
  p.updateMahjongMotion(next, next, rows(next));
  assert.equal(p.motionScoreTimer, timer);
  t.mock.timers.tick(500);
  assert.equal(p.data.motionScoreRows[0].displayScoreText, '+24');
  assert.equal(p.data.motionScoreRows[3].displayScoreText, '-20');
  p.clearMahjongMotion();
});
