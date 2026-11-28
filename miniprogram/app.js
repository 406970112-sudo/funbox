const { getAccessToken, getStoredUser } = require("./utils/auth");
const { watchFeatureAccess } = require("./utils/feature-entries");

const SHARED_FEATURE_ROUTES = [
  ["packages/notebook/", "notebook"],
  ["packages/meme/", "memes"],
  ["packages/lottery/", "lottery"],
  ["packages/discover/holidays/", "holidays"],
];

function currentRoute() {
  if (typeof getCurrentPages !== "function") return "";
  const pages = getCurrentPages();
  return pages.length ? pages[pages.length - 1].route : "";
}

App({
  globalData: {
    launchedAt: null,
  },

  onLaunch() {
    this.globalData.launchedAt = Date.now();
    this.globalData.accessToken = getAccessToken();
    this.globalData.user = getStoredUser();
  },

  onShow(options = {}) {
    this.onHide();
    const candidates = [options.path, currentRoute()].filter(Boolean).map(path => path.replace(/^\//, ""));
    const match = SHARED_FEATURE_ROUTES.find(([prefix]) => candidates.some(path => path.startsWith(prefix)));
    if (!match) return;
    const [prefix, feature] = match;
    const path = candidates.find(route => route.startsWith(prefix));
    this.stopFeatureAccess = watchFeatureAccess(feature, (access, source) => {
      if (access === "available" || (source !== "live" && source !== "failed")) return;
      const shown = currentRoute();
      if (shown && shown !== path) return;
      wx.switchTab({
        url: "/pages/index/index",
        success: () => wx.showToast({
          title: access === "maintenance" ? "该功能维护中" : "当前账号暂未开放此功能",
          icon: "none",
        }),
      });
    });
  },

  onHide() {
    if (this.stopFeatureAccess) this.stopFeatureAccess();
    this.stopFeatureAccess = null;
  },

  syncAuthState() {
    this.globalData.accessToken = getAccessToken();
    this.globalData.user = getStoredUser();
  },
});
