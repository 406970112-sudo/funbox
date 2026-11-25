const { formatScore } = require("./score-format");

function deriveGeneralScoreMotion(previous, next, oldRanking, ranking) {
  if (!previous || previous.id !== next.id || previous.gameType !== "generic" ||
      previous.status !== "active" || next.status !== "active" ||
      Number(next.version) !== Number(previous.version) + 1 ||
      oldRanking.length !== ranking.length) return null;

  const oldBatchIds = new Set((previous.giftBatches || []).map(batch => batch.id));
  const added = (next.giftBatches || []).filter(batch => !oldBatchIds.has(batch.id));
  if (added.length !== 1 || added[0].kind === "reversal" || added[0].reversesBatchId) return null;
  const batch = added[0];
  const gifts = batch.gifts || [];
  if (!gifts.length) return null;

  const oldRows = new Map(oldRanking.map(row => [row.id, row]));
  const deltas = new Map();
  for (const { fromParticipantId, toParticipantId, points } of gifts) {
    if (!oldRows.has(fromParticipantId) || !oldRows.has(toParticipantId) ||
        fromParticipantId === toParticipantId || !Number.isSafeInteger(points) || points <= 0) return null;
    deltas.set(fromParticipantId, (deltas.get(fromParticipantId) || 0) - points);
    deltas.set(toParticipantId, (deltas.get(toParticipantId) || 0) + points);
  }

  const rows = {};
  for (const player of ranking) {
    const prior = oldRows.get(player.id);
    const delta = deltas.get(player.id) || 0;
    if (!prior || player.totalPoints - prior.totalPoints !== delta) return null;
    if (delta || prior.rank !== player.rank) {
      rows[player.id] = {
        deltaText: delta ? formatScore(delta) : "",
        deltaClass: delta > 0 ? "gain" : "loss",
        shift: (prior.rank - player.rank) * 100,
      };
    }
  }

  // The grid gives each row the same height, even when a long name wraps.
  const rowPercent = 100 / ranking.length;
  const transfers = gifts.slice(0, 3).map((gift, index) => {
    const from = oldRows.get(gift.fromParticipantId).rank;
    const to = oldRows.get(gift.toParticipantId).rank;
    return {
      key: `${batch.id}-${index}`,
      fromY: (from - .5) * rowPercent,
      travelY: (to - from) * rowPercent,
    };
  });
  return { rows, transfers };
}

module.exports = { deriveGeneralScoreMotion };
