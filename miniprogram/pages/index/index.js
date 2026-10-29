const { API_BASE_URL } = require("../../config/index");
const { request } = require("../../utils/request");

Page({
  data: {
    apiBaseUrl: API_BASE_URL,
    checking: false,
    backendStatus: "idle",
    statusLabel: "检测中",
    backendMessage: "等待连接",
  },

  onLoad() {
    this.checkBackend();
  },

  async checkBackend() {
    if (this.data.checking) {
      return;
    }

    this.setData({
      checking: true,
      backendStatus: "checking",
      statusLabel: "检测中",
      backendMessage: "正在连接统一后端…",
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
        backendMessage: error.message || "后端连接失败",
      });
    }
  },
});
