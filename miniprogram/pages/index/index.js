const { request } = require("../../utils/request");
const { getAccessToken, getStoredUser } = require("../../utils/auth");
const { getRecentScoreRoom, saveRecentScoreRoom, clearRecentScoreRoom, getScoreSession } = require("../../utils/score-session");
const { getScoreRoom, getScoreErrorMessage } = require("../../utils/score-api");

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
    this.setData({ recentRoom: getRecentScoreRoom(), resumeError: "", resumeBusy: false, resumeState: "checking" });
    const user = getStoredUser();
    this.setData({
      isLoggedIn: Boolean(getAccessToken()),
      userName: user && user.displayName ? user.displayName : "游客",
    });
    return this.validateRecentRoom();
  },

  onHide() {
    this._websiteHidden = true;
    this._resumeLookup = null;
    this._resumeGeneration = (this._resumeGeneration || 0) + 1;
    this.closeWebsiteDialog();
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

  openMemes() { wx.navigateTo({ url: "/packages/meme/library/index" }); },

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
