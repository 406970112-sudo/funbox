const {
  bindWeChat,
  clearSession,
  getAccessToken,
  getAuthErrorMessage,
  getCurrentUser,
  getStoredUser,
  updateDisplayName,
  uploadAvatar,
} = require("../../utils/auth");
const { API_BASE_URL } = require("../../config/index");

const API_ORIGIN = API_BASE_URL.replace(/\/api\/v1\/?$/, "");
const MAX_AVATAR_BYTES = 3 * 1024 * 1024;

function resolveAvatarUrl(value) {
  const url = String(value || "").trim();
  if (!url || /^https?:\/\//i.test(url)) return url;
  return `${API_ORIGIN}${url.startsWith("/") ? "" : "/"}${url}`;
}

Page({
  data: {
    wechatBound: false,
    bindingWeChat: false,
    displayName: "",
    initial: "我",
    avatarUrl: "",
    userLoading: false,
    saving: false,
    uploading: false,
    errorMessage: "",
    loadFailed: false,
  },

  onLoad() {
    this.unloaded = false;
    this.loadProfile();
  },

  onShow() {
    if (!getAccessToken()) this.redirectToAuth();
  },

  onUnload() {
    this.unloaded = true;
  },

  isCurrentSession(token) {
    return !this.unloaded && token === getAccessToken();
  },

  redirectToAuth() {
    if (this.redirecting) return;
    this.redirecting = true;
    wx.redirectTo({
      url: `/pages/auth/index?mode=login&returnTo=${encodeURIComponent("/pages/profile-settings/index")}`,
    });
  },

  applyUser(user, preserveName = false) {
    const displayName = user.displayName || "FunBox 用户";
    this.setData({
      ...(preserveName ? {} : { displayName }),
      initial: Array.from(displayName)[0],
      avatarUrl: resolveAvatarUrl(user.avatarUrl),
      wechatBound: Boolean(user.wechatBound),
    });
  },

  async loadProfile() {
    if (this.data.userLoading) return;
    const token = getAccessToken();
    if (!token) {
      this.redirectToAuth();
      return;
    }
    const cached = getStoredUser();
    if (cached) this.applyUser(cached);
    this.setData({ userLoading: true, errorMessage: "", loadFailed: false });
    try {
      const user = await getCurrentUser();
      if (!this.isCurrentSession(token)) return;
      if (!user) throw new Error("未获取到个人信息，请重试。");
      this.applyUser(user);
    } catch (error) {
      if (!this.isCurrentSession(token)) return;
      this.setData({ loadFailed: true });
      this.handleError(error, token);
    } finally {
      if (!this.unloaded) this.setData({ userLoading: false });
    }
  },

  handleNameInput(event) {
    this.setData({ displayName: event.detail.value, errorMessage: "" });
  },

  handleAvatarError() {
    this.setData({ avatarUrl: "" });
  },

  handleError(error, token) {
    if (!this.isCurrentSession(token)) return;
    if (error && error.statusCode === 401 && error.code !== "wechat_code_invalid") {
      clearSession();
      getApp().syncAuthState();
      this.redirectToAuth();
      return;
    }
    this.setData({ errorMessage: getAuthErrorMessage(error) });
  },

  async bindWeChatAccount() {
    if (this.data.bindingWeChat || this.data.wechatBound || this.data.userLoading || this.data.saving || this.data.uploading) return;
    const token = getAccessToken();
    if (!token) { this.redirectToAuth(); return; }
    this.setData({ bindingWeChat: true, errorMessage: "" });
    try {
      const user = await bindWeChat({ isActive: () => !this.unloaded });
      if (!this.isCurrentSession(token)) return;
      this.applyUser(user, true);
      getApp().syncAuthState();
      wx.showToast({ title: "微信已绑定", icon: "success" });
    } catch (error) {
      if (error.code !== "session_changed") this.handleError(error, token);
    } finally {
      if (!this.unloaded) this.setData({ bindingWeChat: false });
    }
  },

  async saveName() {
    if (this.data.saving || this.data.uploading || this.data.userLoading) return;
    const displayName = this.data.displayName.trim();
    const length = Array.from(displayName).length;
    if (length < 1 || length > 32) {
      this.setData({ errorMessage: "昵称需为 1～32 个字符。" });
      return;
    }
    const token = getAccessToken();
    if (!token) {
      this.redirectToAuth();
      return;
    }
    this.setData({ saving: true, errorMessage: "" });
    try {
      const user = await updateDisplayName(displayName);
      if (!this.isCurrentSession(token)) return;
      this.applyUser(user);
      getApp().syncAuthState();
      wx.showToast({ title: "昵称已保存", icon: "success" });
    } catch (error) {
      this.handleError(error, token);
    } finally {
      if (!this.unloaded) this.setData({ saving: false });
    }
  },

  async chooseAvatar() {
    if (this.data.uploading || this.data.saving || this.data.userLoading) return;
    const token = getAccessToken();
    if (!token) {
      this.redirectToAuth();
      return;
    }
    this.setData({ uploading: true, errorMessage: "" });
    try {
      const result = await new Promise((resolve, reject) => {
        wx.chooseMedia({
          count: 1,
          mediaType: ["image"],
          sourceType: ["album", "camera"],
          sizeType: ["compressed"],
          success: resolve,
          fail: reject,
        });
      });
      if (!this.isCurrentSession(token)) return;
      const file = result.tempFiles && result.tempFiles[0];
      if (!file || !file.tempFilePath) return;
      if (Number(file.size) > MAX_AVATAR_BYTES) {
        this.setData({ errorMessage: "头像不能超过 3 MB，请压缩后重试。" });
        return;
      }
      const user = await uploadAvatar(file.tempFilePath);
      if (!this.isCurrentSession(token)) return;
      this.applyUser(user, true);
      getApp().syncAuthState();
      wx.showToast({ title: "头像已更新", icon: "success" });
    } catch (error) {
      const message = String((error && error.errMsg) || "");
      if (!message.includes("cancel")) {
        this.handleError(error && error.errMsg ? new Error("无法选择头像，请检查相册或相机权限。") : error, token);
      }
    } finally {
      if (!this.unloaded) this.setData({ uploading: false });
    }
  },

  logout() {
    if (this.data.saving || this.data.uploading || this.data.bindingWeChat || this.data.userLoading || this.confirmingLogout) return;
    const token = getAccessToken();
    this.confirmingLogout = true;
    wx.showModal({
      title: "退出登录",
      content: "退出后将以游客身份使用，已保存的牌局记录会保留在账号中。",
      confirmText: "退出登录",
      confirmColor: "#c95744",
      success: (result) => {
        if (!result.confirm || !this.isCurrentSession(token)) return;
        clearSession();
        getApp().syncAuthState();
        wx.switchTab({ url: "/pages/profile/index" });
      },
      complete: () => { this.confirmingLogout = false; },
    });
  },
});
