const { clearSession, getAccessToken, getCurrentUser, getStoredUser } = require("../../utils/auth");
const { API_BASE_URL } = require("../../config/index");
const { reduceMotionEnabled } = require("../../utils/ui-motion");
const { request } = require("../../utils/request");
const { watchFeatureEntries, canOpenFeatureEntry } = require("../../utils/feature-entries");

const API_ORIGIN = API_BASE_URL.replace(/\/api\/v1\/?$/, "");

function maskPhone(value) {
  const text = String(value || "").trim();
  if (/^1\d{10}$/.test(text)) return `${text.slice(0, 3)}****${text.slice(-4)}`;
  return text;
}

function formatRegisteredAt(value) {
  if (!value) return "注册时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "注册时间未知";
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月加入`;
}

function initialOf(value) {
  const text = String(value || "").trim();
  return text ? Array.from(text)[0] : "游";
}

function resolveAvatarUrl(value) {
  const url = String(value || "").trim();
  if (!url || /^https?:\/\//i.test(url)) return url;
  return `${API_ORIGIN}${url.startsWith("/") ? "" : "/"}${url}`;
}

function syncAppAuthState() {
  try {
    getApp().syncAuthState();
  } catch (error) {
    // The profile still works when rendered outside a complete app runtime.
  }
}

Page({
  data: {
    isLoggedIn: false,
    userError: "",
    displayName: "游客",
    initial: "游",
    avatarUrl: "",
    maskedUsername: "",
    registeredAt: "",
    reduceMotion: false,
    featureEntries: {},
    showWorkbench: false,
  },

  onShow() {
    this.setData({ reduceMotion: reduceMotionEnabled() });
    this.loadFeatureEntries();
    this.loadProfile();
  },

  onPullDownRefresh() {
    this.loadFeatureEntries();
    this.loadProfile().finally(() => wx.stopPullDownRefresh());
  },

  onHide() { this.stopFeatureEntries(); },

  onUnload() {
    this.loadGeneration = (this.loadGeneration || 0) + 1;
    this.stopFeatureEntries();
  },

  loadFeatureEntries() {
    this.stopFeatureEntries();
    this._stopFeatureEntries = watchFeatureEntries("profile", featureEntries => this.setData({ featureEntries }));
  },

  stopFeatureEntries() {
    if (this._stopFeatureEntries) this._stopFeatureEntries();
    this._stopFeatureEntries = null;
  },

  resetLoggedOut() {
    this.workbenchToken = "";
    this.setData({
      isLoggedIn: false,
      userError: "",
      displayName: "游客",
      initial: "游",
      avatarUrl: "",
      maskedUsername: "",
      registeredAt: "",
      showWorkbench: false,
    });
  },

  applyUser(user) {
    const displayName = (user && user.displayName) || "FunBox 用户";
    this.setData({
      isLoggedIn: true,
      displayName,
      initial: initialOf(displayName),
      avatarUrl: resolveAvatarUrl(user && user.avatarUrl),
      maskedUsername: maskPhone(user && user.username),
      registeredAt: formatRegisteredAt(user && user.createdAt),
    });
  },

  async loadProfile() {
    const generation = (this.loadGeneration || 0) + 1;
    this.loadGeneration = generation;
    const token = getAccessToken();
    if (!token) {
      this.resetLoggedOut();
      return;
    }

    if (this.workbenchToken !== token) {
      this.workbenchToken = token;
      this.setData({ showWorkbench: false });
    }
    const cachedUser = getStoredUser();
    if (cachedUser) this.applyUser(cachedUser);
    this.setData({ userError: "" });
    const workbenchAccess = this.loadWorkbenchAccess(token, generation);
    try {
      const user = await getCurrentUser();
      if (generation !== this.loadGeneration || token !== getAccessToken()) return;
      if (!user) throw new Error("未获取到个人信息。");
      this.applyUser(user);
      syncAppAuthState();
    } catch (error) {
      if (generation !== this.loadGeneration || token !== getAccessToken()) return;
      if (error && error.statusCode === 401) {
        clearSession();
        this.resetLoggedOut();
        this.loadFeatureEntries();
        syncAppAuthState();
        return;
      }
      this.setData({ userError: error.message || "个人信息刷新失败，请稍后重试。" });
    }
    await workbenchAccess;
  },

  async loadWorkbenchAccess(token, generation) {
    const isCurrent = () => generation === this.loadGeneration && token === getAccessToken();
    try {
      const session = await request({ path: "/mini-admin/session", bearerToken: token });
      const showWorkbench = Boolean(session && (
        session.owner === true || (Array.isArray(session.permissions) && session.permissions.length)
      ));
      if (isCurrent() && this.data.showWorkbench !== showWorkbench) this.setData({ showWorkbench });
    } catch (error) {
      if (isCurrent() && this.data.showWorkbench && (error.statusCode === 401 || error.statusCode === 403)) {
        this.setData({ showWorkbench: false });
      }
    }
  },

  retryLoad() {
    this.loadProfile();
  },

  handleAvatarError() {
    this.setData({ avatarUrl: "" });
  },

  openHistory() {
    if (!canOpenFeatureEntry(this.data.featureEntries.gameHistory)) return;
    if (!getAccessToken()) {
      wx.navigateTo({
        url: `/pages/auth/index?mode=login&returnTo=${encodeURIComponent("/pages/game-history/index")}`,
      });
      return;
    }
    wx.navigateTo({ url: "/pages/game-history/index" });
  },

  openAuth() {
    wx.navigateTo({ url: "/pages/auth/index" });
  },

  openMemeFavorites() {
    if (!canOpenFeatureEntry(this.data.featureEntries.memes)) return;
    wx.navigateTo({ url: "/packages/meme/library/index?tab=favorites" });
  },

  openNotebook() {
    if (!canOpenFeatureEntry(this.data.featureEntries.notebook)) return;
    if (!getAccessToken()) {
      wx.navigateTo({
        url: `/pages/auth/index?mode=login&returnTo=${encodeURIComponent("/packages/notebook/index/index")}`,
      });
      return;
    }
    wx.navigateTo({ url: "/packages/notebook/index/index" });
  },

  openLegal(event) {
    const type = event.currentTarget.dataset.type === "privacy" ? "privacy" : "terms";
    wx.navigateTo({ url: `/pages/legal/index?type=${type}` });
  },

  openSettings() {
    if (!getAccessToken()) {
      this.openAuth();
      return;
    }
    wx.navigateTo({ url: "/pages/profile-settings/index" });
  },

  openWorkbench() {
    if (!this.data.showWorkbench || this.workbenchToken !== getAccessToken()) return;
    wx.navigateTo({ url: "/packages/admin/workbench/index" });
  },

  openFeedback() {
    if (!canOpenFeatureEntry(this.data.featureEntries.feedback)) return;
    if (!getAccessToken()) {
      wx.navigateTo({
        url: `/pages/auth/index?mode=login&returnTo=${encodeURIComponent("/pages/feedback/index")}`,
      });
      return;
    }
    wx.navigateTo({ url: "/pages/feedback/index" });
  },
});
