const { clearSession, getAccessToken, getCurrentUser, getStoredUser } = require("../../utils/auth");
const { API_BASE_URL } = require("../../config/index");

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
  },

  onShow() {
    this.loadProfile();
  },

  onPullDownRefresh() {
    this.loadProfile().finally(() => wx.stopPullDownRefresh());
  },

  resetLoggedOut() {
    this.setData({
      isLoggedIn: false,
      userError: "",
      displayName: "游客",
      initial: "游",
      avatarUrl: "",
      maskedUsername: "",
      registeredAt: "",
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

    const cachedUser = getStoredUser();
    if (cachedUser) this.applyUser(cachedUser);
    this.setData({ userError: "" });
    try {
      const user = await getCurrentUser();
      if (generation !== this.loadGeneration) return;
      if (!user) throw new Error("未获取到个人信息。");
      this.applyUser(user);
      syncAppAuthState();
    } catch (error) {
      if (generation !== this.loadGeneration) return;
      if (error && error.statusCode === 401) {
        clearSession();
        this.resetLoggedOut();
        syncAppAuthState();
        return;
      }
      this.setData({ userError: error.message || "个人信息刷新失败，请稍后重试。" });
    }
  },

  retryLoad() {
    this.loadProfile();
  },

  handleAvatarError() {
    this.setData({ avatarUrl: "" });
  },

  openHistory() {
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
    wx.navigateTo({ url: "/packages/meme/library/index?tab=favorites" });
  },

  openSettings() {
    if (!getAccessToken()) {
      this.openAuth();
      return;
    }
    wx.navigateTo({ url: "/pages/profile-settings/index" });
  },

  openFeedback() {
    if (!getAccessToken()) {
      wx.navigateTo({
        url: `/pages/auth/index?mode=login&returnTo=${encodeURIComponent("/pages/feedback/index")}`,
      });
      return;
    }
    wx.navigateTo({ url: "/pages/feedback/index" });
  },
});
