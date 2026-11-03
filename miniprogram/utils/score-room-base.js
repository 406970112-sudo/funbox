const {
  bindScoreParticipantAccount,
  cancelScoreRoom,
  reverseScoreGiftBatch,
  getScoreErrorMessage,
  getScoreRoom,
  issueScoreInviteCode,
  issueScoreInviteToken,
  joinScoreRoom,
  previewScoreInvite,
  previewScoreInviteScene,
  settleScoreRoom,
  startScoreRoom,
  submitScoreGifts,
} = require("./score-api");
const { clearSession, getAccessToken, getStoredUser } = require("./auth");
const {
  clearHostRoomPassword,
  clearScoreSession,
  credentialForRoom,
  getHostRoomPassword,
  getScoreSession,
  saveScoreSession,
  saveRecentScoreRoom,
} = require("./score-session");
const { buildInviteContent } = require("./invite");
const { formatCNY, formatScore, parsePoints, parseYuanToCents } = require("./score-format");
const { connectScoreRealtime } = require("./score-realtime");
const { drawScoreQRCode } = require("./score-qr");
const { giftDraft, giftHistory: deriveGiftHistory, canCancelRoom, settlementView, rematchRoute } = require("./score-ux");
const { motionPage, motionData } = require("./mahjong-motion");

// Legacy waiting-room invites remain unchanged. V2 poker can also invite
// between hands, after the current frozen hand has finished and cleared.
function canInviteRoom(room) {
  return !!room && (room.status === "waiting" || (
    room.status === "active" && room.gameType === "zhajinhua" &&
    room.zhaJinHuaSettings && room.zhaJinHuaSettings.rulesVersion === 2 &&
    !room.currentZhaJinHuaHand
  ));
}

const REALTIME_ERRORS = {
  domain: "实时连接域名未获微信许可，请联系管理员检查小程序域名配置。",
  unauthorized: "房间身份已失效，请退出后重新进入房间。",
  forbidden: "实时连接被服务端拒绝，请更新小程序后重试。",
  tls: "无法建立安全连接，请检查手机时间或切换网络后重试。",
  timeout: "实时连接超时，请检查网络后重试。",
  network: "实时连接暂不可用，正在自动重连。",
};

function showModal(options) {
  return new Promise((resolve) => {
    wx.showModal({ ...options, success: resolve, fail: () => resolve({ confirm: false }) });
  });
}

function decodeOption(value) {
  const text = String(value == null ? "" : value);
  if (!text) return "";
  try {
    return decodeURIComponent(text);
  } catch (error) {
    return text;
  }
}

function getQrLargeSize() {
  let width = 375;
  let height = 667;
  try {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    width = info.windowWidth || width;
    height = info.windowHeight || height;
  } catch (error) {
    // Keep conservative defaults when window information is unavailable.
  }
  return Math.max(220, Math.min(360, Math.floor(width - 64), Math.floor(height * 0.58)));
}

function writeQrImageFile(imageBase64, roomId, mediaType) {
  return new Promise((resolve, reject) => {
    const extension = mediaType === "image/png" ? "png" : mediaType === "image/jpeg" ? "jpg" : "img";
    const filePath = `${wx.env.USER_DATA_PATH}/score-invite-${roomId}-${Date.now()}.${extension}`;
    wx.getFileSystemManager().writeFile({
      filePath,
      data: imageBase64,
      encoding: "base64",
      success: () => resolve(filePath),
      fail: reject,
    });
  });
}

function removeQrImageFile(filePath) {
  if (!filePath || !wx.getFileSystemManager) return;
  try {
    wx.getFileSystemManager().unlink({ filePath, fail: () => undefined });
  } catch (error) {
    // Temporary image cleanup is best effort.
  }
}

module.exports = {
  ...motionPage,
  data: {
    ...motionData,
    isGeneral: false,
    loading: true,
    busy: false,
    offline: false,
    networkSyncing: false,
    networkRecoveryError: "",
    settlementError: "",
    settlementCopyError: "",
    personalSettlementTitle: "",
    personalSettlementRows: [],
    settlementCopyText: "",
    errorMessage: "",
    actionError: "",
    canRetryLoad: false,
    feedback: "",
    roomId: "",
    inviteToken: "",
    inviteScene: "",
    previewRoom: null,
    joinNeeded: false,
    joinNickname: "",
    joining: false,
    room: null,
    self: null,
    isHost: false,
    isLoggedIn: false,
    showAccountBinding: false,
    accountBound: false,
    bindingAccount: false,
    hostRoomPassword: "",
    activePlayers: 0,
    canStart: false,
    startLabel: "至少 2 人才能开始",
    participants: [],
    vacantSeats: [],
    recipients: [],
    giftTotal: 0,
    giftPreview: "",
    giftError: "",
    canCancelRoom: false,
    canSubmitGifts: false,
    giftHistory: [],
    realtimeStatus: "connecting",
    realtimeError: "",
    syncWarning: "",
    qrSize: 112,
    qrLargeSize: 320,
    qrImageSrc: "",
    qrCodeLoading: false,
    qrCodeFailed: false,
    qrExpanded: false,
    settlementOpen: false,
    settlementRateInput: "",
    settlementRateValid: false,
    settlementRateError: "",
    settlementRows: [],
    settlementTransfers: [],
    hasSettlementTransfers: false,
  },

  onLoad(options) {
    this.pageActive = true;
    this.pageVisible = true;
    this.startNetworkWatch();
    this.pageOptions = options || {};
    this.loadAccessToken = getAccessToken();
    if (options.scene) {
      this.prepareInviteScene(decodeOption(options.scene));
      return;
    }
    if (options.invite) {
      this.prepareInvite(decodeOption(options.invite));
      return;
    }
    if (!options.roomId) {
      this.setData({ loading: false, errorMessage: "缺少牌局信息。" });
      return;
    }
    this.justJoined = options.joined === "1";
    const roomId = decodeURIComponent(options.roomId);
    const credential = options.identity === "account" && this.loadAccessToken
      ? { kind: "account", token: this.loadAccessToken }
      : credentialForRoom(roomId, this.loadAccessToken);
    if (!credential) {
      this.setData({ loading: false, errorMessage: "尚未加入该牌局，请返回后重新加入。" });
      return;
    }
    this.credential = credential;
    this.setData({ roomId });
    this.loadRoom();
  },

  onShow() {
    this.pageVisible = true;
    this.startNetworkWatch();
    this.setData({ isLoggedIn: Boolean(getAccessToken()) });
    if (this.credential && this.data.room) {
      this.startRealtime();
      this.startPolling();
      this.refreshRoom();
    }
  },

  onHide() {
    this.pageVisible = false;
    this.networkGeneration = (this.networkGeneration || 0) + 1;
    this.stopNetworkWatch();
    if (this.data.room) this.setData({ networkSyncing: true });
    this.networkStateChanged();
    this.stopRealtime();
    this.motionResuming = true;
    this.clearMahjongMotion();
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  },

  onUnload() {
    this.pageActive = false;
    this.onHide();
    if (this.qrRenderTimer) clearTimeout(this.qrRenderTimer);
    removeQrImageFile(this.data.qrImageSrc);
  },

  onPullDownRefresh() {
    const reload = this.data.room ? this.refreshRoom() : this.retryOpenRoom();
    Promise.resolve(reload).finally(() => wx.stopPullDownRefresh());
  },

  retryOpenRoom() {
    if (this.data.loading || this.data.joining) return;
    if (this.credential && this.data.roomId) return this.loadRoom();
    if (this.data.inviteScene) return this.prepareInviteScene(this.data.inviteScene);
    if (this.data.inviteToken) return this.prepareInvite(this.data.inviteToken);
  },

  async prepareInvite(inviteToken) {
    this.setData({ inviteToken, inviteScene: "", loading: true, errorMessage: "", canRetryLoad: false });
    return this.prepareInvitePreview(() => previewScoreInvite(inviteToken));
  },

  async prepareInviteScene(inviteScene) {
    this.setData({ inviteToken: "", inviteScene, loading: true, errorMessage: "", canRetryLoad: false });
    return this.prepareInvitePreview(() => previewScoreInviteScene(inviteScene));
  },

  async prepareInvitePreview(loadPreview) {
    try {
      const preview = await loadPreview();
      if (this.routePoker && this.routePoker(preview.room, true)) return;
      this.setRoomTheme(preview.room);
      const accountToken = getAccessToken();
      const savedSession = getScoreSession();
      if (savedSession && savedSession.roomId === preview.room.id) {
        this.credential = credentialForRoom(preview.room.id, accountToken);
        this.setData({ roomId: preview.room.id, previewRoom: preview.room, joinNeeded: false });
        await this.loadRoom();
        return;
      }
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
        joinNeeded: true,
        joinNickname: user && user.displayName ? user.displayName : "",
      });
    } catch (error) {
      this.setData({ loading: false, errorMessage: getScoreErrorMessage(error), canRetryLoad: Boolean(error.isNetworkError) });
    }
  },

  handleJoinField(event) {
    this.setData({ [event.currentTarget.dataset.field]: event.detail.value, errorMessage: "" });
  },

  async joinFromInvite() {
    if (this.data.joining || this.writesPaused() || !this.data.previewRoom) return;
    const displayName = this.data.joinNickname.trim();
    if (!displayName) {
      this.setData({ errorMessage: "请输入牌局内显示的昵称。" });
      return;
    }
    this.setData({ joining: true, errorMessage: "" });
    try {
      const inviteCredential = this.data.inviteScene
        ? { inviteScene: this.data.inviteScene }
        : { inviteToken: this.data.inviteToken };
      const result = await joinScoreRoom({
        ...inviteCredential,
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
      this.justJoined = true;
      await this.applyRoom(result.room);
    } catch (error) {
      this.setData({ errorMessage: getScoreErrorMessage(error) });
    } finally {
      this.setData({ joining: false });
    }
  },

  async loadRoom(options) {
    if (!this.credential || !this.data.roomId || this.pageActive === false || this.pageVisible === false) return false;
    const generation = this.networkGeneration || 0;
    const current = () => generation === (this.networkGeneration || 0) && this.pageActive !== false && this.pageVisible !== false;
    const quiet = options && options.quiet;
    if (!quiet) this.setData({ loading: true, errorMessage: "", canRetryLoad: false });
    try {
      const room = await getScoreRoom(this.credential, this.data.roomId);
      if (!current()) return false;
      if (this.data.room && this.data.room.id === room.id && Number(room.version) < Number(this.data.room.version)) {
        if (this.data.networkSyncing) this.setData({ networkRecoveryError: "同步未完成，请重试同步最新记录。" });
        return false;
      }
      await this.applyRoom(room);
      if (!current()) return false;
      this.setData({ syncWarning: "" });
      if (!this.data.offline) {
        this.setData({ networkSyncing: false, networkRecoveryError: "" });
        this.networkStateChanged();
        this.maybeBindParticipantAccount();
        if (this.data.isHost && canInviteRoom(this.data.room)) {
          this.ensureInviteToken();
          this.ensureInviteCode({ automatic: true });
        }
      }
      return true;
    } catch (error) {
      if (!current()) return false;
      if (this.data.networkSyncing) this.setData({ networkRecoveryError: "同步失败，操作仍已暂停，请重试同步。" });
      if (quiet && this.data.room && error.isNetworkError) {
        this.setData({ syncWarning: "网络暂不稳定，正在重试同步，当前显示上次记录。" });
        return false;
      }
      if (error && error.statusCode === 401 && this.credential.kind === "guest") clearScoreSession();
      this.setData({ errorMessage: getScoreErrorMessage(error), canRetryLoad: Boolean(error.isNetworkError) });
      if (!quiet) this.setData({ loading: false });
      return false;
    }
  },

  startNetworkWatch() {
    if (this.networkHandler || this.pageActive === false || this.pageVisible === false) return;
    const epoch = this.networkWatchEpoch = (this.networkWatchEpoch || 0) + 1;
    let receivedEvent = false;
    const current = () => this.networkWatchEpoch === epoch && this.pageActive !== false && this.pageVisible !== false;
    this.networkHandler = result => {
      if (!current()) return;
      receivedEvent = true;
      this.handleNetwork(result);
    };
    if (wx.onNetworkStatusChange) wx.onNetworkStatusChange(this.networkHandler);
    if (wx.getNetworkType) wx.getNetworkType({ success: result => {
      if (current() && !receivedEvent) this.handleNetwork({ isConnected: result.networkType !== "none" });
    } });
  },

  stopNetworkWatch() {
    this.networkWatchEpoch = (this.networkWatchEpoch || 0) + 1;
    if (this.networkHandler && wx.offNetworkStatusChange) wx.offNetworkStatusChange(this.networkHandler);
    this.networkHandler = null;
  },

  networkStateChanged() {
    if (this.updatePoker) this.updatePoker();
  },

  async handleNetwork(result) {
    if (this.pageActive === false || this.pageVisible === false) return false;
    if (!result.isConnected) {
      this.networkGeneration = (this.networkGeneration || 0) + 1;
      this.setData({ offline: true, networkSyncing: true, networkRecoveryError: "" });
      this.networkStateChanged();
      return false;
    }
    const recovering = this.data.offline || this.data.networkSyncing;
    if (!recovering) return true;
    if (this.data.offline) this.networkGeneration = (this.networkGeneration || 0) + 1;
    this.setData({ offline: false, networkSyncing: true, networkRecoveryError: "" });
    this.networkStateChanged();
    if (!this.credential && !this.data.room) {
      // An unjoined invitation has no prior seat snapshot to reconcile.
      this.setData({ networkSyncing: false });
      return true;
    }
    return this.refreshRoom();
  },

  writesPaused() {
    return this.data.offline || this.data.networkSyncing || this.pageActive === false || this.pageVisible === false;
  },

  retryNetworkSync() {
    if (!this.data.offline) return this.refreshRoom();
  },

  refreshRoom() {
    if (!this.credential || !this.data.roomId) return Promise.resolve(false);
    if (this.refreshPromise) {
      this.refreshQueued = true;
      return this.refreshPromise;
    }
    this.refreshQueued = false;
    this.refreshPromise = this.loadRoom({ quiet: true }).finally(() => {
      this.refreshPromise = null;
      if (this.refreshQueued) {
        this.refreshQueued = false;
        this.refreshRoom();
      }
    });
    return this.refreshPromise;
  },

  async applyRoom(room) {
    if (this.routePoker && this.routePoker(room, false)) return false;
    if (this.data.room && this.data.room.id === room.id && Number(room.version) < Number(this.data.room.version)) {
      return false;
    }
    saveRecentScoreRoom(room, this.credential);
    const previousRoom = this.data.room;
    this.setRoomTheme(room);
    const isGeneral = room.gameType === "generic";
    const participantMap = {};
    room.participants.forEach((participant) => {
      participantMap[participant.id] = participant;
    });
    const selfID = this.currentParticipantId(room);
    const self = participantMap[selfID] || null;
    const isHost = Boolean(self && self.role === "host");
    const isLoggedIn = Boolean(getAccessToken());
    const accountBound = Boolean(self && self.userId);
    const showAccountBinding = Boolean(this.credential && this.credential.kind === "guest" && self && self.status === "active");
    let hostRoomPassword = isHost ? getHostRoomPassword(room.id) : "";
    if (isHost && (room.status === "settled" || room.status === "cancelled")) {
      clearHostRoomPassword(room.id);
      hostRoomPassword = "";
    }
    const activePlayers = room.participants.filter((participant) => participant.status === "active").length;
    const seatMarks = ["東", "南", "西", "北"];
    const seatMap = {};
    room.participants
      .filter((participant) => participant.status === "active")
      .sort((left, right) => String(left.joinedAt).localeCompare(String(right.joinedAt)))
      .forEach((participant, index) => {
        seatMap[participant.id] = isGeneral
          ? (Array.from((participant.displayName || "").trim())[0] || "友")
          : seatMarks[index] || String(index + 1);
      });
    const participants = room.participants
      .filter((participant) => participant.status === "active")
      .sort((left, right) => right.totalPoints - left.totalPoints || String(left.joinedAt).localeCompare(String(right.joinedAt)))
      .map((participant, index) => ({
        ...participant,
        rank: index + 1,
        rankClass: index < 3 ? `rank-${index + 1}` : "",
        seatMark: seatMap[participant.id] || "友",
        scoreText: formatScore(participant.totalPoints),
        isSelf: participant.id === selfID,
      }));
    const vacantSeats = Array.from({ length: isGeneral ? 0 : Math.max(0, room.maxPlayers - activePlayers) }, (_, index) => ({
      key: `vacant-${index}`,
      mark: seatMarks[activePlayers + index] || "＋",
    }));
    const recipients = room.status === "active"
      ? participants.filter((participant) => participant.id !== selfID)
        .sort((left, right) => String(left.joinedAt).localeCompare(String(right.joinedAt)) || String(left.id).localeCompare(String(right.id)))
        .map((participant) => ({
        ...participant,
        pointsInput: this.data.recipients.find((item) => item.id === participant.id)?.pointsInput || "",
      }))
      : [];
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
        amountText: "",
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
    const giftHistory = deriveGiftHistory(room.giftBatches || [], participantMap, isHost && room.status === "active");
    const draft = giftDraft(recipients);

    this.setData({
      loading: false,
      errorMessage: this.data.canRetryLoad ? "" : this.data.errorMessage,
      canRetryLoad: false,
      room,
      self,
      isHost,
      isLoggedIn,
      showAccountBinding,
      accountBound,
      hostRoomPassword,
      activePlayers,
      canStart: activePlayers >= 2,
      startLabel: activePlayers >= 2 ? (isGeneral ? "开始记分" : "开始牌局") : "至少 2 人才能开始",
      participants,
      vacantSeats,
      recipients,
      giftHistory,
      ...settlementView(room, self && self.id),
      canCancelRoom: canCancelRoom(room, isHost),
      settlementRows,
      settlementTransfers,
      hasSettlementTransfers: settlementTransfers.length > 0,
      giftTotal: draft.total,
      giftPreview: draft.preview,
      giftError: this.data.giftError || (recipients.some(item => String(item.pointsInput || "").trim()) && !draft.valid ? "请输入有效的正整数，总分不能超过 2147483647。" : ""),
      canSubmitGifts: draft.valid,
      realtimeStatus: this.data.realtimeStatus,
      qrExpanded: canInviteRoom(room) ? this.data.qrExpanded : false,
      settlementOpen: room.status === "active" ? this.data.settlementOpen : false,
    });
    this.updateMahjongMotion(previousRoom, room, participants);
    if (this.justJoined && room.gameType === "mahjong") {
      this.justJoined = false;
      this.showMahjongNotice("加入成功，已为你入座", { motionScene: this.data.reducedMotion ? "" : "joined" }, 650);
    }
    if (isHost && room.status === "active" && this.data.settlementOpen) {
      this.updateSettlementPreview(this.data.settlementRateInput);
    }
    this.lastRoomSyncAt = Date.now();
    this.maybeBindParticipantAccount();
    this.startRealtime();
    this.startPolling();
    if (isHost && canInviteRoom(room) && !this.writesPaused()) {
      await this.ensureInviteToken();
      this.ensureInviteCode({ automatic: true });
    }
    return true;
  },

  currentParticipantId(room) {
    const session = getScoreSession();
    return room.selfParticipantId || (session && session.roomId === room.id && this.credential && this.credential.kind === "guest" && this.credential.token === session.guestToken ? session.participantId : "");
  },

  openAccountLogin() {
    if (this.data.bindingAccount) return;
    this.accountBindingPaused = false;
    wx.navigateTo({ url: "/pages/auth/index" });
  },

  setRoomTheme(room) {
    if (room.gameType === "mahjong" && !this.motionInitialized) {
      this.motionInitialized = true;
      this.initMahjongMotion();
    }
    const isGeneral = room.gameType === "generic";
    this.setData({ isGeneral, settlementRateText: formatCNY(room.centsPerPoint) });
    if (wx.setNavigationBarTitle && room.gameType !== "zhajinhua") {
      wx.setNavigationBarTitle({ title: isGeneral ? "通用记分" : "麻将牌局" });
    }
  },

  maybeBindParticipantAccount() {
    if (this.accountBindingPaused || this.writesPaused()) return;
    if (!this.credential || this.credential.kind !== "guest" || !this.data.room) return;
    if (!this.data.showAccountBinding || this.data.accountBound || this.data.bindingAccount) return;
    if (!getAccessToken()) return;
    this.bindParticipantAccount();
  },

  async bindParticipantAccount() {
    if (this.writesPaused() || !this.credential || this.credential.kind !== "guest" || !this.data.room || this.data.bindingAccount) return;
    if (!getAccessToken()) {
      this.openAccountLogin();
      return;
    }
    this.accountBindingPaused = false;
    this.setData({ bindingAccount: true, errorMessage: "" });
    try {
      const room = await bindScoreParticipantAccount(this.data.room.id, this.credential.token);
      await this.applyRoom(room);
      this.setData({ feedback: "已绑定账号，本局结算后会记录战绩。" });
    } catch (error) {
      if (error && error.statusCode === 401) {
        clearSession();
        this.setData({ isLoggedIn: false });
      } else {
        this.accountBindingPaused = true;
      }
      this.setData({ errorMessage: getScoreErrorMessage(error) });
    } finally {
      this.setData({ bindingAccount: false });
    }
  },

  async ensureInviteToken() {
    if (this.writesPaused() || !this.credential || !this.data.isHost || !canInviteRoom(this.data.room) || this.data.inviteToken || this.inviteTokenPending) return;
    this.inviteTokenPending = true;
    try {
      const inviteToken = this.data.inviteToken || await issueScoreInviteToken(this.credential, this.data.room.id);
      this.setData({ inviteToken }, () => this.renderInviteCode(
        this.data.qrExpanded ? "roomQrLarge" : "roomQr",
        this.data.qrExpanded ? this.data.qrLargeSize : this.data.qrSize
      ));
    } catch (error) {
      if (this.data.isHost) this.setData({ feedback: getScoreErrorMessage(error) });
    } finally {
      this.inviteTokenPending = false;
    }
  },

  async ensureInviteCode(options) {
    if (this.writesPaused() || !this.credential || !this.data.isHost || !this.data.room || !canInviteRoom(this.data.room)) return;
    if (this.data.qrImageSrc || this.data.qrCodeLoading || (options && options.automatic && this.data.qrCodeFailed) || !this.data.room.id) return;
    this.setData({ qrCodeLoading: true, qrCodeFailed: false });
    try {
      const result = await issueScoreInviteCode(this.credential, this.data.room.id);
      if (!result || !result.imageBase64) throw new Error("缺少微信邀请码图片。");
      const filePath = await writeQrImageFile(result.imageBase64, this.data.room.id, result.mediaType);
      if (this.pageActive === false || !this.data.room || !canInviteRoom(this.data.room)) {
        removeQrImageFile(filePath);
        if (this.pageActive !== false) this.setData({ qrCodeLoading: false });
        return;
      }
      const previousFile = this.data.qrImageSrc;
      this.setData({ qrImageSrc: filePath, qrCodeLoading: false, feedback: "" });
      removeQrImageFile(previousFile);
      if (this.qrRenderTimer) clearTimeout(this.qrRenderTimer);
    } catch (error) {
      if (this.pageActive === false) return;
      this.setData({
        qrCodeLoading: false,
        qrCodeFailed: true,
        feedback: "微信邀请码暂不可用，已切换备用二维码；也可转发邀请或使用房间码加入。",
      });
      this.renderInviteCode(this.data.qrExpanded ? "roomQrLarge" : "roomQr", this.data.qrExpanded ? this.data.qrLargeSize : this.data.qrSize);
    }
  },

  renderInviteCode(canvasId, size) {
    if (!this.data.inviteToken || this.data.qrImageSrc || !this.data.qrCodeFailed || this.data.qrCodeLoading) return;
    const targetExpanded = canvasId === "roomQrLarge";
    if (this.qrRenderTimer) clearTimeout(this.qrRenderTimer);
    this.qrRenderTimer = setTimeout(() => {
      if (!this.data.inviteToken || this.data.qrImageSrc || !this.data.qrCodeFailed || this.data.qrCodeLoading || this.data.qrExpanded !== targetExpanded) return;
      try {
        drawScoreQRCode(this, canvasId, buildInviteContent(this.data.inviteToken), size);
      } catch (error) {
        this.setData({ feedback: "二维码生成失败，请使用房间码加入。" });
      }
    }, 60);
  },

  toggleQrExpanded() {
    if (!this.data.inviteToken && !this.data.qrImageSrc) return;
    const qrExpanded = !this.data.qrExpanded;
    const patch = { qrExpanded };
    if (qrExpanded) patch.qrLargeSize = getQrLargeSize();
    this.setData(patch, () => {
      if (this.data.qrImageSrc) return;
      this.renderInviteCode(
        qrExpanded ? "roomQrLarge" : "roomQr",
        qrExpanded ? this.data.qrLargeSize : this.data.qrSize
      );
    });
  },

  closeQrExpanded() {
    if (!this.data.qrExpanded) return;
    this.setData({ qrExpanded: false }, () => {
      if (!this.data.qrImageSrc) this.renderInviteCode("roomQr", this.data.qrSize);
    });
  },

  copyRoomCode() {
    wx.setClipboardData({ data: this.data.room.code, success: () => this.showMahjongNotice("房间码已复制", { roomCodeCopied: true }, 1000) });
  },

  async confirmRoomAction(title, content, operation) {
    if (this.data.busy || this.writesPaused() || !this.data.room) return;
    const reviewed = this.data.room;
    this.setData({ busy: true, errorMessage: "", actionError: "" });
    try {
      const result = await showModal({ title, content, confirmText: "确认", confirmColor: "#2d5bff", cancelText: "再想想" });
      if (!result.confirm) return;
      if (this.writesPaused()) { this.setData({ actionError: "网络中断或尚未完成同步，请稍后重试。" }); return; }
      if (!this.data.room || this.data.room.id !== reviewed.id || this.data.room.version !== reviewed.version) {
        this.setData({ errorMessage: "房间状态已变化，请重新核对后操作。", actionError: "房间状态已变化，请重新核对后操作。" });
        return;
      }
      await operation(reviewed);
    } catch (error) {
      if (error && error.snapshot) await this.applyRoom(error.snapshot);
      this.setData({ errorMessage: getScoreErrorMessage(error), actionError: getScoreErrorMessage(error) });
    } finally { this.setData({ busy: false }); }
  },

  async startRoom() {
    if (this.data.busy || this.writesPaused() || !this.data.isHost || !this.data.canStart || !this.data.room || this.data.room.status !== "waiting") return;
    const start = async room => { await this.applyRoom(await startScoreRoom(this.credential, room)); this.setData({ feedback: "牌局已开始，可以给分了。" }); };
    if (this.data.room.gameType === "mahjong" && this.data.activePlayers < 4) {
      return this.confirmRoomAction(`以当前 ${this.data.activePlayers} 人开始？`, "开始后本局成员固定。", start);
    }
    this.setData({ busy: true, errorMessage: "", feedback: "" });
    try { await start(this.data.room); } catch (error) { await this.handleMutationError(error, "actionError"); }
    finally { this.setData({ busy: false }); }
  },

  updateGiftDraft(recipients) {
    const draft = giftDraft(recipients);
    const hasInput = recipients.some(item => String(item.pointsInput || "").trim());
    this.setData({ recipients, giftTotal: draft.total, giftPreview: draft.preview, canSubmitGifts: draft.valid,
      giftError: hasInput && !draft.valid ? "请输入有效的正整数，总分不能超过 2147483647。" : "" });
  },

  handleGiftInput(event) {
    const participantId = event.currentTarget.dataset.id;
    const value = String(event.detail.value == null ? "" : event.detail.value);
    this.updateGiftDraft(this.data.recipients.map(item => item.id === participantId ? { ...item, pointsInput: value } : item));
  },

  incrementGift(event) {
    if (this.data.busy) return;
    const { id, amount } = event.currentTarget.dataset;
    const increment = Number(amount);
    if (![1, 5, 10].includes(increment)) return;
    const item = this.data.recipients.find(entry => entry.id === id);
    if (!item) return;
    const text = String(item.pointsInput || "").trim();
    const previous = text ? parsePoints(text) : 0;
    if (previous === null) { this.setData({ giftError: "请先修正无效分数。" }); return; }
    this.updateGiftDraft(this.data.recipients.map(entry => entry.id === id ? { ...entry, pointsInput: String(previous + increment) } : entry));
  },

  clearGifts() {
    if (!this.data.busy) this.updateGiftDraft(this.data.recipients.map(item => ({ ...item, pointsInput: "" })));
  },

  async submitGifts() {
    if (this.data.busy || this.writesPaused() || !this.data.room) return;
    const draft = giftDraft(this.data.recipients);
    if (!draft.valid) { this.setData({ giftError: "请输入有效的正整数，总分不能超过 2147483647。" }); return; }
    const allocations = this.data.recipients.filter(item => String(item.pointsInput || "").trim()).map(item => ({ toParticipantId: item.id, points: parsePoints(item.pointsInput) }));
    this.setData({ busy: true, errorMessage: "", giftError: "", feedback: "" });
    try {
      const room = await submitScoreGifts(this.credential, this.data.room, allocations);
      this.setData({ recipients: this.data.recipients.map((item) => ({ ...item, pointsInput: "" })) });
      await this.applyRoom(room);
      this.setData({ busy: false, feedback: "给分已入账。" });
      this.showMahjongNotice("给分已入账", { giftConfirmed: true });
    } catch (error) { await this.handleMutationError(error, "giftError"); }
  },

  async reverseGift(event) {
    const id = event.currentTarget.dataset.id;
    if (this.data.busy || this.writesPaused() || !this.data.isHost || !this.data.room || this.data.room.status !== "active" || !this.data.giftHistory.some(item => item.id === id && item.canReverse)) return;
    return this.confirmRoomAction("撤销这笔给分？", "会新增一笔反向记录，原记录保留。", async room => {
      await this.applyRoom(await reverseScoreGiftBatch(this.credential, room, id));
      this.setData({ feedback: "给分已撤销。" });
    });
  },

  async cancelRoom() {
    if (this.data.busy || this.writesPaused() || !canCancelRoom(this.data.room, this.data.isHost)) return;
    const active = this.data.room.status === "active";
    return this.confirmRoomAction(active ? "结束空房间？" : "取消房间？", "仅无记分记录的房间可取消，操作后不能恢复。", async room => {
      await this.applyRoom(await cancelScoreRoom(this.credential, room));
      this.setData({ feedback: "房间已取消。" });
    });
  },

  openSettlement() {
    if (!this.data.isHost || !this.data.room || this.data.room.status !== "active") return;
    this.setData({
      settlementOpen: true,
      settlementRateInput: "1",
      settlementRateError: "",
      settlementError: "",
      errorMessage: "",
    }, () => this.updateSettlementPreview("1"));
  },

  closeSettlement() {
    if (!this.data.busy) this.setData({ settlementOpen: false });
  },

  handleSettlementRateInput(event) {
    this.updateSettlementPreview(event.detail.value);
  },

  updateSettlementPreview(value) {
    const rateInput = String(value == null ? "" : value);
    const centsPerPoint = parseYuanToCents(rateInput);
    const settlementRows = this.data.settlementRows.map((row) => ({
      ...row,
      amountText: centsPerPoint ? formatCNY((Number(row.totalPoints) || 0) * centsPerPoint) : "—",
    }));
    this.setData({
      settlementRateInput: rateInput,
      settlementRateValid: Boolean(centsPerPoint),
      settlementRateError: centsPerPoint ? "" : "请输入大于 0、最多两位小数的每分金额。",
      settlementRows,
    });
  },

  async confirmSettlement() {
    if (this.data.busy || this.writesPaused() || !this.data.settlementOpen || !this.data.isHost || !this.data.room || this.data.room.status !== "active") return;
    const centsPerPoint = parseYuanToCents(this.data.settlementRateInput);
    if (!centsPerPoint) {
      this.setData({ settlementRateValid: false, settlementRateError: "请输入大于 0、最多两位小数的每分金额。" });
      return;
    }
    const reviewed = this.data.room;
    this.setData({ busy: true, settlementError: "", errorMessage: "", feedback: "" });
    try {
      const result = await showModal({ title: "确认结算？", content: `将按 ${formatCNY(centsPerPoint)} / 分结算。结算后房间会立即结束，分数和金额都不能再修改。`, confirmText: "确认结算", confirmColor: "#b4472f", cancelText: "再看看" });
      if (!result.confirm) return;
      if (this.writesPaused()) { this.setData({ settlementError: "网络中断或尚未完成同步，请稍后重试。" }); return; }
      if (!this.data.room || this.data.room.id !== reviewed.id || this.data.room.version !== reviewed.version) {
        this.setData({ settlementError: "房间状态已变化，请核对后重新结算。" }); return;
      }
      const room = await settleScoreRoom(this.credential, reviewed, centsPerPoint);
      await this.applyRoom(room);
      this.setData({ settlementOpen: false, feedback: this.data.isGeneral ? "本次记分已结算。" : "牌局已结算。" });
    } catch (error) {
      await this.handleMutationError(error, "settlementError");
    } finally { this.setData({ busy: false }); }
  },

  async handleMutationError(error, field) {
    if (error && error.snapshot) await this.applyRoom(error.snapshot);
    this.setData({ busy: false, errorMessage: getScoreErrorMessage(error), ...(field ? { [field]: getScoreErrorMessage(error) } : {}) });
  },

  copySettlement() {
    if (!this.data.room || this.data.room.status !== "settled") return;
    this.setData({ settlementCopyError: "" });
    const view = settlementView(this.data.room, this.data.self && this.data.self.id);
    wx.setClipboardData({ data: view.settlementCopyText, fail: () => {
      if (this.pageActive !== false) this.setData({ settlementCopyError: "复制失败，请重试复制结算清单。" });
    } });
  },

  rematch() {
    const url = rematchRoute(this.data.room, this.data.self);
    if (url) wx.navigateTo({ url });
  },

  startRealtime() {
    if (this.pageActive === false || this.pageVisible === false) return;
    if (!this.credential || !this.data.room) return;
    if (this.realtimeClose && this.realtimeRoomID === this.data.room.id) return;
    this.stopRealtime();
    this.realtimeRoomID = this.data.room.id;
    const epoch = this.realtimeEpoch;
    const current = () => epoch === this.realtimeEpoch && this.pageActive !== false && this.pageVisible !== false;
    this.realtimeClose = connectScoreRealtime({
      credential: this.credential,
      roomId: this.data.room.id,
      onInvalidate: (version) => {
        if (!current() || !this.data.room || version <= this.data.room.version) return;
        this.refreshRoom();
      },
      onStatus: (status, reason) => {
        if (!current()) return;
        const reconnected = status === "online" && this.hadRealtimeConnection && this.data.realtimeStatus !== "online";
        if (status === "online") this.hadRealtimeConnection = true;
        if (reconnected) this.showMahjongNotice("已重连，正在同步最新分数");
        this.setData({
          realtimeStatus: status,
          realtimeError: status === "online" ? "" : (REALTIME_ERRORS[reason] || this.data.realtimeError),
        });
        if (status === "online" && this.data.room) this.refreshRoom();
      },
    });
  },

  async retryRealtime() {
    if (this.data.realtimeStatus === "online") return;
    const result = await showModal({
      title: "实时同步暂不可用",
      content: `${this.data.realtimeError || REALTIME_ERRORS.network} 分数仍会定时刷新。`,
      confirmText: "重新连接",
      cancelText: "稍后重试",
    });
    if (!result.confirm || this.pageActive === false || this.pageVisible === false) return;
    this.stopRealtime();
    this.startRealtime();
    this.refreshRoom();
  },

  stopRealtime() {
    this.realtimeEpoch = (this.realtimeEpoch || 0) + 1;
    if (this.realtimeClose) this.realtimeClose();
    this.realtimeClose = null;
    this.realtimeRoomID = "";
  },

  startPolling() {
    if (this.pageActive === false || this.pageVisible === false) return;
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      if (this.data.room && this.data.room.status !== "settled" && this.data.room.status !== "cancelled") {
        const lastSync = this.lastRoomSyncAt || 0;
        if (this.data.realtimeStatus !== "online" || Date.now() - lastSync >= 15000) {
          this.refreshRoom();
        }
      }
    }, 3000);
  },

  goHome() {
    wx.reLaunch({ url: "/pages/index/index" });
  },

  noop() {},

  onShareAppMessage() {
    const room = this.data.room;
    if (!this.data.inviteToken || !room || !canInviteRoom(room)) {
      return { title: this.data.isGeneral ? "FunBox 通用记分" : "FunBox 麻将记分", path: "/pages/index/index" };
    }
    return {
      title: room ? `邀请你加入「${room.name}」` : "邀请你加入麻将牌局",
      path: buildInviteContent(this.data.inviteToken),
    };
  },
};
