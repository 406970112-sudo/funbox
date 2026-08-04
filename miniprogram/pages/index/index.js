const { createWebViewUrl } = require("../../utils/web-view-url");

Page({
  data: {
    webViewUrl: "",
  },

  onLoad() {
    this.loadWebsite();
  },

  onShow() {
    if (!this.hasShown) {
      this.hasShown = true;
      return;
    }

    this.loadWebsite();
  },

  loadWebsite() {
    this.setData({
      webViewUrl: createWebViewUrl(),
    });
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
