App({
  globalData: {
    launchedAt: null,
  },

  onLaunch() {
    this.globalData.launchedAt = Date.now();
  },
});
