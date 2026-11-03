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

// All money comes from the server settlement, in integer cents.
function settlementView(room, selfId) {
  const { formatCNY, formatScore } = require('./score-format');
  const people = Object.fromEntries((room.participants || []).map(p => [p.id, p]));
  const settlement = room.settlement || { balances: [], transfers: [] };
  const name = id => people[id]?.displayName || '玩家';
  const known = !!people[selfId];
  const personalSettlementRows = known ? (settlement.transfers || []).filter(t => t.fromParticipantId === selfId || t.toParticipantId === selfId).map((t, i) => ({
    key: String(i), text: t.fromParticipantId === selfId ? `你需给${name(t.toParticipantId)} ${formatCNY(t.amountCents)}` : `你可收${name(t.fromParticipantId)} ${formatCNY(t.amountCents)}`,
  })) : [];
  const balances = (settlement.balances || []).map(b => `${name(b.participantId)}：${formatScore(b.totalPoints)} 分，${formatCNY(b.amountCents)}`);
  const transfers = (settlement.transfers || []).map(t => `${name(t.fromParticipantId)} → ${name(t.toParticipantId)}：${formatCNY(t.amountCents)}`);
  return {
    personalSettlementRows,
    personalSettlementTitle: !known ? '查看全桌结算建议' : personalSettlementRows.length ? '你的转账建议' : '你无需转账',
    settlementCopyText: [room.name || '未命名牌局', `每分金额：${formatCNY(room.centsPerPoint)} / 分`, '最终余额', ...balances, '转账建议（仅供核对，不代表已付款）', ...(transfers.length ? transfers : ['无需转账'])].join('\n'),
  };
}
function rematchRoute(room, self) {
  if (!room || room.status !== 'settled' || !['mahjong', 'generic'].includes(room.gameType)) return '';
  return `/pages/score/${room.gameType === 'generic' ? 'general' : 'mahjong'}/index?roomName=${encodeURIComponent(room.name || '')}&hostNickname=${encodeURIComponent(self?.displayName || '')}`;
}
module.exports.settlementView = settlementView;
module.exports.rematchRoute = rematchRoute;
