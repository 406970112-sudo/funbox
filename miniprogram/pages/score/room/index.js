const {
  getScoreErrorMessage,
  getScoreRoom,
  issueScoreInviteToken,
  joinScoreRoom,
  previewScoreInvite,
  settleScoreRoom,
  startScoreRoom,
  submitScoreGifts,
} = require("../../../utils/score-api");
const { getAccessToken, getStoredUser } = require("../../../utils/auth");
const { clearScoreSession, credentialForRoom, getScoreSession, saveScoreSession } = require("../../../utils/score-session");
const { buildInviteContent } = require("../../../utils/invite");
const { capSummary, formatCNY, formatScore, giftCapHint, parsePoints } = require("../../../utils/score-format");
const { connectScoreRealtime } = require("../../../utils/score-realtime");
const { drawScoreQRCode } = require("../../../utils/score-qr");

function showModal(options) {
  return new Promise((resolve) => {
    wx.showModal({ ...options, success: resolve, fail: () => resolve({ confirm: false }) });
  });
}

Page({
  data: {
    loading: true,
    busy: false,
    errorMessage: "",
    feedback: "",
    roomId: "",
    inviteToken: "",
    previewRoom: null,
    previewRateText: "",
    previewCapText: "",
    joinNeeded: false,
    joinNickname: "",
    joining: false,
    room: null,
    self: null,
    isHost: false,
    activePlayers: 0,
    canStart: false,
    startLabel: "至少 2 人才能开始",
    participants: [],
    recipients: [],
    giftTotal: 0,
    overCap: false,
    canSubmitGifts: false,
    capRemainingText: "",
    giftHistory: [],
    rateText: "",
    capText: "",
    realtimeStatus: "connecting",
    qrSize: 112,
    settlementOpen: false,
    settlementRows: [],
    settlementTransfers: [],
  },

  onLoad(options) {
    this.pageOptions = options || {};
    this.loadAccessToken = getAccessToken();
    if (options.invite) {
      this.prepareInvite(decodeURIComponent(options.invite));
      return;
    }
    if (!options.roomId) {
      this.setData({ loading: false, errorMessage: "缺少牌局信息。" });
      return;
    }
    const roomId = decodeURIComponent(options.roomId);
    const credential = credentialForRoom(roomId, this.loadAccessToken);
    if (!credential) {
      this.setData({ loading: false, errorMessage: "尚未加入该牌局，请返回后重新加入。" });
      return;
    }
    this.credential = credential;
    this.setData({ roomId });
    this.loadRoom();
  },

  onShow() {
    if (this.credential && this.data.room && !this.pageOptions.invite) {
      this.refreshRoom();
    }
  },

  onUnload() {
    this.stopRealtime();
    if (this.pollTimer) clearInterval(this.pollTimer);
  },

  onPullDownRefresh() {
    this.refreshRoom().finally(() => wx.stopPullDownRefresh());
  },

  async prepareInvite(inviteToken) {
    this.setData({ inviteToken, loading: true, errorMessage: "" });
    try {
      const preview = await previewScoreInvite(inviteToken);
      const accountToken = getAccessToken();
      if (preview.selfParticipantId && accountToken) {
        this.credential = { kind: "account", token: accountToken };
        this.setData({ roomId: preview.room.id, previewRoom: preview.room });
        await this.loadRoom();
        return;
      }
      const user = getStoredUser();
      this.setData({
        loading: false,
        previewRoom: preview.room,
        previewRateText: `${formatCNY(preview.room.centsPerPoint)} / 分`,
        previewCapText: capSummary(preview.room.capPoints, preview.room.centsPerPoint),
        joinNeeded: true,
        joinNickname: user && user.displayName ? user.displayName : "",
      });
    } catch (error) {
      this.setData({ loading: false, errorMessage: getScoreErrorMessage(error) });
    }
  },

  handleJoinField(event) {
    this.setData({ [event.currentTarget.dataset.field]: event.detail.value, errorMessage: "" });
  },

  async joinFromInvite() {
    if (this.data.joining || !this.data.previewRoom) return;
    const displayName = this.data.joinNickname.trim();
    if (!displayName) {
      this.setData({ errorMessage: "请输入牌局内显示的昵称。" });
      return;
    }
    this.setData({ joining: true, errorMessage: "" });
    try {
      const result = await joinScoreRoom({
        inviteToken: this.data.inviteToken,
        displayName,
      });
      saveScoreSession({
        roomId: result.room.id,
        guestToken: result.guestToken,
        participantId: result.actor.participantId,
      });
      this.credential = { kind: "guest", token: result.guestToken };
      this.setData({
        roomId: result.room.id,
        joinNeeded: false,
        previewRoom: null,
      });
      await this.loadRoom();
    } catch (error) {
      this.setData({ errorMessage: getScoreErrorMessage(error) });
    } finally {
      this.setData({ joining: false });
    }
  },

  async loadRoom(options) {
    if (!this.credential || !this.data.roomId) return;
    const quiet = options && options.quiet;
    if (!quiet) this.setData({ loading: true, errorMessage: "" });
    try {
      const room = await getScoreRoom(this.credential, this.data.roomId);
      await this.applyRoom(room);
    } catch (error) {
      if (error && error.statusCode === 401 && this.credential.kind === "guest") {
        clearScoreSession();
      }
      this.setData({ errorMessage: getScoreErrorMessage(error) });
      if (!quiet) this.setData({ loading: false });
    }
  },

  refreshRoom() {
    return this.loadRoom({ quiet: true });
  },

  async applyRoom(room) {
    const participantMap = {};
    room.participants.forEach((participant) => {
      participantMap[participant.id] = participant;
    });
    const selfID = room.selfParticipantId || (getScoreSession() && getScoreSession().participantId);
    const self = participantMap[selfID] || null;
    const isHost = Boolean(self && self.role === "host");
    const activePlayers = room.participants.filter((participant) => participant.status === "active").length;
    const participants = room.participants
      .filter((participant) => participant.status === "active")
      .sort((left, right) => right.totalPoints - left.totalPoints || String(left.joinedAt).localeCompare(String(right.joinedAt)))
      .map((participant, index) => ({
        ...participant,
        rank: index + 1,
        rankClass: index < 3 ? `rank-${index + 1}` : "",
        scoreText: formatScore(participant.totalPoints),
        amountText: formatCNY(participant.amountCents),
        isSelf: participant.id === selfID,
      }));
    const recipients = room.status === "active"
      ? participants.filter((participant) => participant.id !== selfID).map((participant) => ({
        ...participant,
        pointsInput: this.data.recipients.find((item) => item.id === participant.id)?.pointsInput || "",
      }))
      : [];
    const giftTotal = recipients.reduce((sum, item) => sum + (parsePoints(item.pointsInput) || 0), 0);
    const capPoints = room.capPoints || 0;
    const overCap = Boolean(capPoints && giftTotal > capPoints);
    const capRemainingText = giftCapHint(capPoints, room.centsPerPoint, giftTotal);
    const settlementRows = room.settlement
      ? room.settlement.balances.map((balance) => ({
        ...balance,
        name: participantMap[balance.participantId]?.displayName || "玩家",
        scoreText: formatScore(balance.totalPoints),
        amountText: formatCNY(balance.amountCents),
      }))
      : room.participants.map((participant) => ({
        participantId: participant.id,
        name: participant.displayName,
        totalPoints: participant.totalPoints,
        amountCents: participant.amountCents,
        scoreText: formatScore(participant.totalPoints),
        amountText: formatCNY(participant.amountCents),
      }));
    const settlementTransfers = room.settlement
      ? room.settlement.transfers.map((transfer, index) => ({
        ...transfer,
        key: `${transfer.fromParticipantId}-${transfer.toParticipantId}-${index}`,
        fromName: participantMap[transfer.fromParticipantId]?.displayName || "玩家",
        toName: participantMap[transfer.toParticipantId]?.displayName || "玩家",
        amountText: formatCNY(transfer.amountCents),
      }))
      : [];
    const giftHistory = (room.giftBatches || []).slice(0, 6).map((batch) => ({
      ...batch,
      items: batch.gifts.map((gift) => ({
        ...gift,
        text: `${participantMap[gift.fromParticipantId]?.displayName || "玩家"} 给 ${participantMap[gift.toParticipantId]?.displayName || "玩家"} ${gift.points} 分`,
      })),
    }));

    this.setData({
      loading: false,
      room,
      self,
      isHost,
      activePlayers,
      canStart: activePlayers >= 2,
      startLabel: activePlayers >= 2 ? "开始牌局" : "至少 2 人才能开始",
      participants,
      recipients,
      giftHistory,
      rateText: `${formatCNY(room.centsPerPoint)} / 分`,
      capText: capSummary(room.capPoints, room.centsPerPoint),
      settlementRows,
      settlementTransfers,
      giftTotal,
      overCap,
      canSubmitGifts: giftTotal > 0,
      capRemainingText,
      realtimeStatus: this.data.realtimeStatus,
    });
    this.startRealtime();
    this.startPolling();
    if (isHost && room.status === "waiting") {
      await this.ensureInviteToken();
    }
  },

  async ensureInviteToken() {
    if (!this.credential || !this.data.isHost || this.data.room.status !== "waiting") return;
    try {
      const inviteToken = this.data.inviteToken || await issueScoreInviteToken(this.credential, this.data.room.id);
      this.setData({ inviteToken }, () => this.renderInviteCode());
    } catch (error) {
      if (this.data.isHost) this.setData({ feedback: getScoreErrorMessage(error) });
    }
  },

  renderInviteCode() {
    if (!this.data.inviteToken) return;
    setTimeout(() => {
      try {
        drawScoreQRCode(this, "roomQr", buildInviteContent(this.data.inviteToken), this.data.qrSize);
      } catch (error) {
        this.setData({ feedback: "二维码生成失败，请使用房间码加入。" });
      }
    }, 60);
  },

  copyRoomCode() {
    wx.setClipboardData({ data: this.data.room.code });
  },

  async startRoom() {
    if (this.data.busy || !this.data.isHost) return;
    this.setData({ busy: true, errorMessage: "", feedback: "" });
    try {
      const room = await startScoreRoom(this.credential, this.data.room);
      await this.applyRoom(room);
      this.setData({ busy: false, feedback: "牌局已开始，可以给分了。" });
    } catch (error) {
      this.handleMutationError(error);
    }
  },

  handleGiftInput(event) {
    const participantId = event.currentTarget.dataset.id;
    const value = String(event.detail.value || "").replace(/\D/g, "").slice(0, 10);
    const recipients = this.data.recipients.map((item) => (
      item.id === participantId ? { ...item, pointsInput: value } : item
    ));
    const giftTotal = recipients.reduce((sum, item) => sum + (parsePoints(item.pointsInput) || 0), 0);
    const capPoints = this.data.room.capPoints || 0;
    const capRemainingText = giftCapHint(capPoints, this.data.room.centsPerPoint, giftTotal);
    this.setData({
      recipients,
      giftTotal,
      overCap: Boolean(capPoints && giftTotal > capPoints),
      canSubmitGifts: giftTotal > 0,
      capRemainingText,
      errorMessage: "",
    });
  },

  async submitGifts() {
    if (this.data.busy || !this.data.room) return;
    const allocations = this.data.recipients
      .map((item) => ({ toParticipantId: item.id, points: parsePoints(item.pointsInput) }))
      .filter((item) => item.points);
    if (!allocations.length) {
      this.setData({ errorMessage: "请至少给一位玩家填写大于 0 的整数分。" });
      return;
    }
    this.setData({ busy: true, errorMessage: "", feedback: "" });
    try {
      const room = await submitScoreGifts(this.credential, this.data.room, allocations);
      this.setData({ recipients: this.data.recipients.map((item) => ({ ...item, pointsInput: "" })) });
      await this.applyRoom(room);
      this.setData({ busy: false, feedback: "给分已入账。" });
    } catch (error) {
      this.handleMutationError(error);
    }
  },

  openSettlement() {
    if (!this.data.isHost) return;
    this.setData({ settlementOpen: true, errorMessage: "" });
  },

  closeSettlement() {
    if (!this.data.busy) this.setData({ settlementOpen: false });
  },

  async confirmSettlement() {
    if (this.data.busy || !this.data.settlementOpen) return;
    const result = await showModal({
      title: "确认结算？",
      content: "结算后房间会立即结束，分数和金额都不能再修改。",
      confirmText: "确认结算",
      confirmColor: "#b4472f",
      cancelText: "再看看",
    });
    if (!result.confirm) return;
    this.setData({ busy: true, errorMessage: "", feedback: "" });
    try {
      const room = await settleScoreRoom(this.credential, this.data.room);
      await this.applyRoom(room);
      this.setData({ busy: false, settlementOpen: false, feedback: "牌局已结算。" });
    } catch (error) {
      this.handleMutationError(error);
    }
  },

  handleMutationError(error) {
    if (error && error.snapshot) {
      this.applyRoom(error.snapshot);
    }
    this.setData({ busy: false, errorMessage: getScoreErrorMessage(error) });
  },

  startRealtime() {
    if (!this.credential || !this.data.room) return;
    if (this.realtimeClose && this.realtimeRoomID === this.data.room.id) return;
    this.stopRealtime();
    this.realtimeRoomID = this.data.room.id;
    this.realtimeClose = connectScoreRealtime({
      credential: this.credential,
      roomId: this.data.room.id,
      onInvalidate: (version) => {
        if (!this.data.room || version <= this.data.room.version || this.data.busy) return;
        this.refreshRoom();
      },
      onStatus: (status) => this.setData({ realtimeStatus: status }),
    });
  },

  stopRealtime() {
    if (this.realtimeClose) this.realtimeClose();
    this.realtimeClose = null;
    this.realtimeRoomID = "";
  },

  startPolling() {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      if (this.data.room && this.data.room.status !== "settled" && this.data.room.status !== "cancelled") {
        this.refreshRoom();
      }
    }, 15000);
  },

  goHome() {
    wx.reLaunch({ url: "/pages/index/index" });
  },

  noop() {},

  onShareAppMessage() {
    const room = this.data.room;
    if (!this.data.inviteToken || !room || room.status !== "waiting") {
      return { title: "FunBox 麻将记分", path: "/pages/index/index" };
    }
    return {
      title: room ? `邀请你加入「${room.name}」` : "邀请你加入麻将牌局",
      path: buildInviteContent(this.data.inviteToken),
    };
  },
});
