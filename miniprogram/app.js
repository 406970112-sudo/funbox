const { getAccessToken, getStoredUser } = require("./utils/auth");

App({
  globalData: {
    launchedAt: null,
  },

  onLaunch() {
    this.globalData.launchedAt = Date.now();
    this.globalData.accessToken = getAccessToken();
    this.globalData.user = getStoredUser();
  },

  syncAuthState() {
    this.globalData.accessToken = getAccessToken();
    this.globalData.user = getStoredUser();
  },
});
