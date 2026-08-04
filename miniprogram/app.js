App({
  onLaunch() {
    if (!wx.canIUse("getUpdateManager")) {
      return;
    }

    const updateManager = wx.getUpdateManager();

    updateManager.onUpdateReady(() => {
      wx.showModal({
        title: "版本更新",
        content: "新版本已准备好，重启后即可使用。",
        showCancel: false,
        confirmText: "立即重启",
        success: () => updateManager.applyUpdate(),
      });
    });

    updateManager.onUpdateFailed(() => {
      wx.showToast({
        title: "更新失败，请稍后重试",
        icon: "none",
      });
    });
  },
});
