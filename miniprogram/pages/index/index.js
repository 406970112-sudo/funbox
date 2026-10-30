const { request } = require("../../utils/request");
const { getAccessToken, getStoredUser } = require("../../utils/auth");

Page({
  data: {
    checking: false,
    backendStatus: "idle",
    statusLabel: "检测中",
    backendMessage: "正在连接牌局服务…",
    isLoggedIn: false,
    userName: "游客",
  },

  onLoad() {
    wx.showShareMenu({ menus: ["shareAppMessage", "shareTimeline"] });

  },

  onShow() {
    const user = getStoredUser();
    this.setData({
      isLoggedIn: Boolean(getAccessToken()),
      userName: user && user.displayName ? user.displayName : "游客",
    });
  },

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
