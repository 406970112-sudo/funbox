const { parsePoints } = require('./score-format');
const MAX = 2147483647;
function giftDraft(recipients) {
  let total = 0, valid = true;
  const parts = [];
  recipients.forEach(item => {
    const value = String(item.pointsInput == null ? '' : item.pointsInput).trim();
    if (!value) return;
    const points = parsePoints(value);
    if (!points) { valid = false; return; }
    total += points;
    parts.push(`${item.displayName || '玩家'} 增加 ${points} 分`);
  });
  if (total > MAX) valid = false;
  return { total, valid: valid && total > 0, preview: valid && total ? `你扣除 ${total} 分；${parts.join('，')}` : '' };
}
function giftHistory(batches, participants, isHost) {
  const reversed = new Set(batches.filter(b => b.reversesBatchId).map(b => b.reversesBatchId));
  const byId = Object.fromEntries(batches.map(b => [b.id, b]));
  return batches.slice(0, 6).map(batch => ({
    ...batch, reversed: reversed.has(batch.id),
    originalNumber: byId[batch.reversesBatchId]?.number || '',
    canReverse: !!isHost && batch.kind !== 'reversal' && !batch.reversesBatchId && !reversed.has(batch.id),
    items: (batch.gifts || []).map(gift => ({ ...gift, text: `${participants[gift.fromParticipantId]?.displayName || '玩家'} 给 ${participants[gift.toParticipantId]?.displayName || '玩家'} ${gift.points} 分` })),
  }));
}
function canCancelRoom(room, isHost) {
  if (!room || !isHost) return false;
  if (room.status !== 'waiting' && !(room.status === 'active' && ['generic', 'mahjong'].includes(room.gameType))) return false;
  return !(room.giftBatches || []).length && !(room.rounds || []).length && !(room.zhaJinHuaHands || []).length && !room.currentRound && !room.currentZhaJinHuaHand;
}
module.exports = { giftDraft, giftHistory, canCancelRoom };
