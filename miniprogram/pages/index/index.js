const { createWebViewUrl } = require("../../utils/web-view-url");

const ALLOWED_HOST_SUFFIX = ".qq.com";

Page({
  data: {
    shareData: null,
    webViewUrl: "",
  },

  onLoad(options) {
    this.loadWebsite(options);
  },

  onShow() {
    if (!this.hasShown) {
      this.hasShown = true;
      return;
    }

    this.loadWebsite();
  },

  loadWebsite(options = {}) {
    const target = this.resolveWebViewUrl(options.url);
    this.setData({
      webViewUrl: target,
    });
  },

  resolveWebViewUrl(rawUrl) {
    if (!rawUrl) {
      return createWebViewUrl();
    }
    try {
      const url = decodeURIComponent(rawUrl);
      if (!/^https:\/\//i.test(url)) {
        return createWebViewUrl();
      }
      const hostMatch = url.match(/^https:\/\/[^/?#]+/i);
      if (!hostMatch) {
        return createWebViewUrl();
      }
      const host = hostMatch[0].replace(/^https:\/\//i, "").toLowerCase();
      if (!host.endsWith(ALLOWED_HOST_SUFFIX)) {
        return createWebViewUrl();
      }
      const separator = url.includes("?") ? "&" : "?";
      return `${url}${separator}source=wechat-miniprogram&_wv_t=${Date.now()}`;
    } catch (error) {
      return createWebViewUrl();
    }
  },

  handleMessage(event) {
    const messages = event.detail && event.detail.data ? event.detail.data : [];
    const shareMessage = messages.find(
      (item) => item && item.type === "dnf-activity-share" && item.payload
    );
    if (!shareMessage) {
      return;
    }
    this.setData({
      shareData: shareMessage.payload,
    });
    wx.showShareMenu({
      withShareTicket: false,
      menus: ["shareAppMessage"],
    });
  },

  onShareAppMessage() {
    const payload = this.data.shareData || {};
    const targetUrl = this.resolveWebViewUrl(payload.url || "");
    return {
      title: payload.title || "DNF手游活动助手",
      path: `/pages/index/index?url=${encodeURIComponent(targetUrl)}`,
      imageUrl: payload.imageUrl || "",
    };
  },

  handleError() {
    wx.showModal({
      title: "页面加载失败",
      content: "请检查网络连接后重新加载。",
      confirmText: "重新加载",
      cancelText: "取消",
      success: ({ confirm }) => {
        if (confirm) {
          this.loadWebsite();
        }
      },
    });
  },
});
