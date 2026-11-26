const { request } = require("../../utils/request");
const { getAccessToken, getStoredUser } = require("../../utils/auth");
const { getRecentScoreRoom, saveRecentScoreRoom, clearRecentScoreRoom, getScoreSession, saveScoreSession } = require("../../utils/score-session");
const { getScoreRoom, joinScoreRoom, getScoreErrorMessage } = require("../../utils/score-api");
const { extractInviteScene, extractInviteToken } = require("../../utils/invite");
const { reduceMotionEnabled } = require("../../utils/ui-motion");
const { discoverPath, watchHolidayCard, recordRecentTool } = require("../../utils/discover-entries");

Page({
  data: {
    recentRoom: null,
    resumeBusy: false,
    resumeState: "checking",
    resumeError: "",
    checking: false,
    backendStatus: "idle",
    statusLabel: "检测中",
    backendMessage: "正在连接牌局服务…",
    isLoggedIn: false,
    userName: "游客",
    reduceMotion: false,
    holidayCard: null,
    discoverSlide: 0,
    scanning: false,
    scanError: "",
    manualJoinOpen: false,
    manualKeyboardHeight: 0,
    roomCode: "",
    joinPassword: "",
    nickname: "",
    joining: false,
    joinSucceeded: false,
    focusedJoinField: "",
    joinErrorField: "",
    joinErrorMessage: "",
    // 暂时隐藏，待用户明确要求开放入口时再设为 true。
    showWebsiteEntry: false,
    websiteUrl: "https://xwhub.cn",
    copyingWebsite: false,
    showWebsiteDialog: false,
  },

  onLoad() {
    wx.showShareMenu({ menus: ["shareAppMessage", "shareTimeline"] });
  },

  onShow() {
    this._websiteHidden = false;
    this._resumeGeneration = (this._resumeGeneration || 0) + 1;
    this._resumeLookup = null;
    this._resumeNavigating = false;
    this.setData({ recentRoom: getRecentScoreRoom(), resumeError: "", resumeBusy: false, resumeState: "checking", scanError: "", joinSucceeded: false });
    const user = getStoredUser();
    const displayName = user && user.displayName ? user.displayName : "";
    this.setData({
      isLoggedIn: Boolean(getAccessToken()),
      userName: displayName || "游客",
      nickname: this.data.nickname || displayName,
      reduceMotion: reduceMotionEnabled(),
    });
    this.stopHolidayCard();
    this._stopHolidayCard = watchHolidayCard(this);
    return this.validateRecentRoom();
  },

  onHide() {
    this._websiteHidden = true;
    this._resumeLookup = null;
    this._resumeGeneration = (this._resumeGeneration || 0) + 1;
    this.stopHolidayCard();
    this.closeWebsiteDialog();
    if (this.data.manualJoinOpen) {
      this.setData({ manualJoinOpen: false, manualKeyboardHeight: 0 });
    }
  },

  onUnload() { this.stopHolidayCard(); },

  stopHolidayCard() {
    if (this._stopHolidayCard) this._stopHolidayCard();
    this._stopHolidayCard = null;
  },

  resumeRoom() {
    return this.validateRecentRoom(true);
  },

  validateRecentRoom(navigate = false) {
    const recent = getRecentScoreRoom();
    if (!recent || this._websiteHidden || this._resumeNavigating) return;
    const session = recent.credentialKind === "guest" ? getScoreSession() : null;
    const accountToken = getAccessToken();
    const accountUser = getStoredUser();
    const accountId = accountUser && accountUser.id;
    const credential = recent.credentialKind === "account" ? { kind: "account", token: accountToken } : session && { kind: "guest", token: session.guestToken };
    if (!credential || !credential.token) return;
    const generation = this._resumeGeneration;
    const snapshot = JSON.stringify(recent);
    const identityCurrent = () => {
      const user = getStoredUser();
      const activeSession = credential.kind === "guest" ? getScoreSession() : null;
      const identityMatches = getAccessToken() === accountToken && (user && user.id) === accountId && (credential.kind === "guest"
        ? activeSession && activeSession.roomId === recent.roomId && activeSession.guestToken === credential.token && activeSession.sessionId === recent.guestSessionId
        : accountId === recent.userId);
      return !this._websiteHidden && this._resumeGeneration === generation && identityMatches;
    };
    const current = () => identityCurrent() && JSON.stringify(getRecentScoreRoom()) === snapshot;
    // A tap can promote the visible background lookup to one navigation intent.
    const pending = this._resumeLookup;
    if (pending && pending.current()) {
      if (navigate) { pending.navigate = true; this.setData({ resumeBusy: true }); }
      return pending.promise;
    }
    const lookup = { current, navigate };
    this._resumeLookup = lookup;
    this.setData({ resumeBusy: navigate, resumeState: "checking", resumeError: "" });
    lookup.promise = (async () => {
      try {
        const room = await getScoreRoom(credential, recent.roomId);
        if (!current()) return;
        if (room.status !== "active" && room.status !== "waiting") {
          clearRecentScoreRoom(recent.roomId);
          this.setData({ recentRoom: null, resumeError: "牌局已结束。" });
          return;
        }
        saveRecentScoreRoom(room, credential);
        this.setData({ recentRoom: getRecentScoreRoom(), resumeState: "ready" });
        if (lookup.navigate) {
          this._resumeNavigating = true;
          const savedSnapshot = JSON.stringify(getRecentScoreRoom());
          const route = room.gameType === "zhajinhua" ? "poker-room" : "room";
          wx.navigateTo({ url: `/pages/score/${route}/index?roomId=${encodeURIComponent(room.id)}${credential.kind === "account" ? "&identity=account" : ""}`,
            fail: () => {
              if (identityCurrent() && JSON.stringify(getRecentScoreRoom()) === savedSnapshot) {
                this._resumeNavigating = false;
                this.setData({ resumeError: "打开牌局失败，请重试" });
              }
            } });
        }
      } catch (error) {
        if (!current()) return;
        if (error.statusCode === 401 || error.statusCode === 403 || error.statusCode === 404) {
          clearRecentScoreRoom(recent.roomId);
          this.setData({ recentRoom: null });
        }
        this.setData({ resumeState: "retry", resumeError: getScoreErrorMessage(error) });
      } finally {
        if (this._resumeLookup === lookup) {
          this._resumeLookup = null;
          if (identityCurrent()) this.setData({ resumeBusy: false });
        }
      }
    })();
    return lookup.promise;
  },

  scanToJoin() {
    if (this.data.scanning || this.data.manualJoinOpen) return;
    this.setData({ scanning: true, scanError: "" });
    wx.scanCode({
      scanType: ["qrCode", "wxCode"],
      success: (result) => {
        const scannedValue = result.path || result.result || "";
        const inviteScene = extractInviteScene(scannedValue);
        if (inviteScene) {
          wx.navigateTo({ url: `/pages/score/room/index?scene=${encodeURIComponent(inviteScene)}` });
          return;
        }
        const inviteToken = extractInviteToken(scannedValue);
        if (!inviteToken) {
          this.setData({ scanError: "未识别到有效的牌局邀请码。" });
          return;
        }
        wx.navigateTo({ url: `/pages/score/room/index?invite=${encodeURIComponent(inviteToken)}` });
      },
      fail: (error) => {
        if (/cancel/i.test((error && error.errMsg) || "")) return;
        this.setData({ scanError: "无法打开扫码，请检查相机权限，或点击「输码加入」。" });
      },
      complete: () => this.setData({ scanning: false }),
    });
  },

  openManualJoin() {
    if (this.data.scanning) return;
    this.setData({
      manualJoinOpen: true,
      manualKeyboardHeight: 0,
      scanError: "",
      joinErrorField: "",
      joinErrorMessage: "",
      joinSucceeded: false,
    });
  },

  closeManualJoin() {
    if (this.data.joining) return;
    this.setData({
      manualJoinOpen: false,
      manualKeyboardHeight: 0,
      focusedJoinField: "",
      joinErrorField: "",
      joinErrorMessage: "",
    });
    if (wx.hideKeyboard) wx.hideKeyboard();
  },

  handleManualKeyboard(event) {
    if (!this.data.manualJoinOpen) return;
    this.setData({ manualKeyboardHeight: Math.max(0, Number(event.detail.height) || 0) });
  },

  focusJoinField(event) {
    this.setData({ focusedJoinField: event.currentTarget.dataset.field });
  },

  blurJoinField() {
    this.setData({ focusedJoinField: "" });
  },

  handleJoinField(event) {
    if (this.data.joining) return;
    const field = event.currentTarget.dataset.field;
    this.setData({ [field]: event.detail.value, joinErrorField: "", joinErrorMessage: "" });
  },

  async joinByCode() {
    if (this.data.joining) return;
    const code = this.data.roomCode.trim();
    const displayName = this.data.nickname.trim();
    if (code.length !== 6 || !/^\d{6}$/.test(code)) {
      return this.setData({ joinErrorField: "roomCode", joinErrorMessage: "请输入 6 位数字房间码。" });
    }
    if (!/^\d{4,6}$/.test(this.data.joinPassword)) {
      return this.setData({ joinErrorField: "joinPassword", joinErrorMessage: "请输入 4～6 位数字房间密码。" });
    }
    if (!displayName) {
      return this.setData({ joinErrorField: "nickname", joinErrorMessage: "请输入牌局内显示的昵称。" });
    }
    this.setData({ joining: true, joinSucceeded: false, joinErrorField: "", joinErrorMessage: "" });
    try {
      const result = await joinScoreRoom({ code, password: this.data.joinPassword, displayName });
      saveScoreSession({ roomId: result.room.id, guestToken: result.guestToken, participantId: result.actor.participantId });
      if (this._websiteHidden) return;
      this.setData({ joinSucceeded: true, manualJoinOpen: false, manualKeyboardHeight: 0, roomCode: "", joinPassword: "" });
      if (wx.hideKeyboard) wx.hideKeyboard();
      const isPoker = result.room.gameType === "zhajinhua";
      const route = isPoker ? "poker-room" : "room";
      const suffix = result.room.gameType === "generic" || isPoker ? "" : "&joined=1";
      wx.navigateTo({ url: `/pages/score/${route}/index?roomId=${encodeURIComponent(result.room.id)}${suffix}` });
    } catch (error) {
      const joinErrorField = /password/.test(error.code || "") ? "joinPassword" : /not_found|code/.test(error.code || "") ? "roomCode" : "";
      if (!this._websiteHidden) {
        this.setData({ joinErrorMessage: getScoreErrorMessage(error), joinErrorField, joinSucceeded: false });
      }
    } finally {
      if (!this._websiteHidden) this.setData({ joining: false });
    }
  },

  copyWebsite() {
    if (this.data.copyingWebsite || this.data.showWebsiteDialog) return;
    this.setData({ copyingWebsite: true });
    wx.setClipboardData({
      data: this.data.websiteUrl,
      success: () => {
        wx.hideToast();
        this.setData({ copyingWebsite: false });
        if (this._websiteHidden) return;
        wx.hideTabBar({ animation: false });
        this.setData({ showWebsiteDialog: true });
      },
      fail: () => {
        this.setData({ copyingWebsite: false });
        if (!this._websiteHidden) {
          wx.showToast({ title: "复制失败，请重试", icon: "none" });
        }
      },
    });
  },

  closeWebsiteDialog() {
    if (!this.data.showWebsiteDialog) return;
    this.setData({ showWebsiteDialog: false });
    wx.showTabBar({ animation: false });
  },

  noop() {},

  async checkBackend() {
    if (this.data.checking) return;
    this.setData({
      checking: true,
      backendStatus: "checking",
      statusLabel: "检测中",
      backendMessage: "正在连接牌局服务…",
    });
    try {
      const result = await request({ path: "/system/ping" });
      this.setData({
        checking: false,
        backendStatus: "online",
        statusLabel: "在线",
        backendMessage: result.message || "pong",
      });
    } catch (error) {
      this.setData({
        checking: false,
        backendStatus: "offline",
        statusLabel: "离线",
        backendMessage: error.message || "牌局服务连接失败",
      });
    }
  },

  openNotebook() {
    if (recordRecentTool) recordRecentTool("notebook");
    wx.navigateTo({ url: discoverPath("notebook", Boolean(getAccessToken())) });
  },

  openMemes() {
    if (recordRecentTool) recordRecentTool("memes");
    wx.navigateTo({ url: discoverPath("memes") });
  },

  openDiscover() {
    const url = discoverPath("all");
    if (wx.switchTab) wx.switchTab({ url });
    else wx.navigateTo({ url });
  },

  openHolidays() {
    if (recordRecentTool) recordRecentTool("holidays");
    wx.navigateTo({ url: discoverPath("holidays") });
  },

  openLottery() {
    if (recordRecentTool) recordRecentTool("lottery");
    wx.navigateTo({ url: discoverPath("lottery") });
  },

  onDiscoverSlideChange(event) { this.setDiscoverSlide(event.detail.current); },

  selectDiscoverSlide(event) { this.setDiscoverSlide(Number(event.currentTarget.dataset.index)); },

  setDiscoverSlide(index) {
    if ((index === 0 || index === 1) && index !== this.data.discoverSlide) {
      this.setData({ discoverSlide: index });
    }
  },

  openPoker() { wx.navigateTo({ url: "/pages/score/poker/index" }); },

  openGeneral() { wx.navigateTo({ url: "/pages/score/general/index" }); },

  openMahjong() {
    wx.navigateTo({ url: "/pages/score/mahjong/index" });
  },

  showComingSoon(event) {
    wx.showToast({ title: `${event.currentTarget.dataset.scene}敬请期待`, icon: "none" });
  },

  openProfile() {
    wx.switchTab({ url: "/pages/profile/index" });
  },

  onShareAppMessage() {
    return { title: "FunBox 麻将记分", path: "/pages/index/index" };
  },

  onShareTimeline() {
    return { title: "FunBox 麻将记分", query: "" };
  },
});
