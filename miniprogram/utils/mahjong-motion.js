const { formatScore } = require('./score-format');
const MOTION_PREF = 'funboxMahjongReducedMotionV1';
const ROW_HEIGHT = 112;

// Only adjacent, newer snapshots can describe a new event. Initial loads are
// baselines, including reopening a room whose ledger already contains gifts.
function deriveMahjongMotion(previous, next) {
  if (!previous || !next || next.gameType !== 'mahjong' || previous.id !== next.id ||
      Number(next.version) <= Number(previous.version)) return null;
  const old = new Map(previous.participants.map(p => [p.id, p]));
  const active = next.participants.filter(p => p.status === 'active');
  const oldBatches = new Set((previous.giftBatches || []).map(b => b.id));
  return {
    joined: next.status === 'waiting' ? active.filter(p => !old.has(p.id)) : [],
    started: previous.status === 'waiting' && next.status === 'active',
    settled: previous.status === 'active' && next.status === 'settled',
    changes: next.status === 'active' && previous.status === 'active'
      ? active.filter(p => old.has(p.id) && p.totalPoints !== old.get(p.id).totalPoints)
        .map(p => ({ id: p.id, from: old.get(p.id).totalPoints, to: p.totalPoints, delta: p.totalPoints - old.get(p.id).totalPoints })) : [],
    transfers: next.status === 'active' && previous.status === 'active'
      ? (next.giftBatches || []).filter(b => !oldBatches.has(b.id)).flatMap(b => b.gifts || []) : [],
  };
}

const motionData = {
  reducedMotion: false,
  motionScene: '',
  motionNotice: '',
  motionScoreRows: [],
  motionBoardHeight: 24,
  motionTransfers: [],
  motionTransferSummary: '',
  motionEpoch: 0,
  motionJoinedIds: [], motionJoined: {},
  motionTiles: ['東', '南', '西', '北'],
  roomCodeCopied: false,
  giftConfirmed: false,
};

const motionPage = {
  initMahjongMotion() {
    this.setData({ reducedMotion: !!wx.getStorageSync(MOTION_PREF) });
  },

  toggleMahjongMotion() {
    const reducedMotion = !this.data.reducedMotion;
    wx.setStorageSync(MOTION_PREF, reducedMotion);
    this.clearMahjongMotion();
    this.setData({ reducedMotion });
  },

  clearMahjongMotion() {
    if (this.motionScoreTimer) clearTimeout(this.motionScoreTimer);
    if (this.motionEndTimer) clearTimeout(this.motionEndTimer);
    this.motionScoreTimer = null;
    this.motionEndTimer = null;
    this.setData({
      motionScene: '', motionNotice: '', motionTransfers: [], motionTransferSummary: '', motionJoinedIds: [], motionJoined: {}, roomCodeCopied: false, giftConfirmed: false,
      motionScoreRows: this.data.motionScoreRows.map(p => ({ ...p, displayScoreText: formatScore(p.totalPoints), deltaText: '' })),
    });
  },

  showMahjongNotice(text, patch = {}, duration = 1400) {
    if (this.pageVisible === false || this.pageActive === false || this.data.isGeneral || this.data.room?.gameType === 'zhajinhua') return;
    if (this.motionEndTimer) clearTimeout(this.motionEndTimer);
    this.setData({ motionNotice: text, ...patch });
    this.motionEndTimer = setTimeout(() => {
      this.motionEndTimer = null;
      if (this.pageVisible === false || this.pageActive === false) return;
      this.setData({ motionScene: '', motionNotice: '', motionJoinedIds: [], motionJoined: {}, motionTransfers: [], motionTransferSummary: '', roomCodeCopied: false, giftConfirmed: false,
        motionScoreRows: this.data.motionScoreRows.map(p => ({ ...p, deltaText: '' })) });
    }, duration);
  },

  updateMahjongMotion(previous, room, participants) {
    if (room.gameType !== 'mahjong') return;
    // Repeated polls must not interrupt an in-flight tween either.
    if (previous && previous.id === room.id && previous.version === room.version && !this.motionResuming) return;
    this.clearMahjongMotion();
    const play = !this.data.reducedMotion && !this.motionResuming && this.pageVisible !== false && this.pageActive !== false;
    if (this.pageVisible !== false && this.pageActive !== false) this.motionResuming = false;
    const event = play ? deriveMahjongMotion(previous, room) : null;
    const changes = new Map((event?.changes || []).map(p => [p.id, p]));
    const epoch = this.data.motionEpoch + 1;
    const scoreRows = participants.slice().sort((a, b) => String(a.id).localeCompare(String(b.id))).map(p => ({
      ...p,
      motionY: (p.rank - 1) * ROW_HEIGHT,
      displayScoreText: formatScore(changes.has(p.id) ? changes.get(p.id).from : p.totalPoints),
      deltaText: changes.has(p.id) ? formatScore(changes.get(p.id).delta) : '',
      deltaClass: changes.get(p.id)?.delta > 0 ? 'gain' : 'loss',
      effectKey: `${epoch}-${p.id}`,
    }));
    this.setData({ motionScoreRows: scoreRows, motionBoardHeight: scoreRows.length * ROW_HEIGHT + 24, motionEpoch: epoch });
    if (!event) return;
    if (event.started || event.settled) {
      this.showMahjongNotice(event.started ? '牌局已开始' : '账目已理清', { motionScene: event.started ? 'start' : 'settle' }, event.started ? 740 : 950);
    } else if (event.joined.length) {
      this.showMahjongNotice(`${event.joined.map(p => p.displayName).join('、')}已入座`, { motionJoinedIds: event.joined.map(p => p.id), motionJoined: Object.fromEntries(event.joined.map(p => [p.id, true])) });
    } else if (event.changes.length) {
      const byId = new Map(participants.map(p => [p.id, p]));
      const transfers = event.transfers.filter(g => byId.has(g.fromParticipantId) && byId.has(g.toParticipantId)).slice(0, 3).map((g, index) => ({
        key: `${epoch}-${index}`, from: byId.get(g.fromParticipantId).displayName, to: byId.get(g.toParticipantId).displayName,
        points: g.points, fromY: (byId.get(g.fromParticipantId).rank - 1) * ROW_HEIGHT + 56,
        travelY: (byId.get(g.toParticipantId).rank - byId.get(g.fromParticipantId).rank) * ROW_HEIGHT,
      }));
      this.showMahjongNotice('分数已更新', { motionTransfers: transfers, motionTransferSummary: transfers.map(g => `${g.from} → ${g.to} ${g.points}分`).join(' · ') }, 1100);
      const began = Date.now();
      const tick = () => {
        if (this.pageVisible === false || this.pageActive === false || this.data.reducedMotion) return;
        const progress = Math.min(1, (Date.now() - began) / 460);
        const eased = 1 - Math.pow(1 - progress, 3);
        this.setData({ motionScoreRows: scoreRows.map(p => {
          const change = changes.get(p.id);
          return { ...p, displayScoreText: change ? formatScore(Math.round(change.from + change.delta * eased)) : formatScore(p.totalPoints) };
        }) });
        this.motionScoreTimer = progress < 1 ? setTimeout(tick, 45) : null;
      };
      this.motionScoreTimer = setTimeout(tick, 45);
    }
  },
};

module.exports = { deriveMahjongMotion, motionPage, motionData };
