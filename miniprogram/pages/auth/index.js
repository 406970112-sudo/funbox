const { getAuthErrorMessage, login, register, loginWithWeChat } = require("../../utils/auth");

Page({
  data: {
    mode: "wechat",
    agreed: false,
    loading: false,
    errorMessage: "",
    returnTo: "",
    username: "",
    password: "",
    passwordVisible: false,
    displayName: "",
    securityQuestion: "",
    securityAnswer: "",
  },

  onLoad(options) {
    this.unloaded = false;
    let returnTo = "";
    try { returnTo = options && options.returnTo ? decodeURIComponent(options.returnTo) : ""; } catch (error) { /* Ignore malformed return destinations. */ }
    if (!/^\/pages\/[a-z0-9/_-]+(?:\?.*)?$/i.test(returnTo) || returnTo.split("?")[0] === "/pages/auth/index") returnTo = "";
    this.setData({ mode: options && options.mode === "register" ? "register" : "wechat", returnTo });
  },

  onUnload() { this.unloaded = true; },

  toggleAgreement() {
    if (!this.data.loading) this.setData({ agreed: !this.data.agreed, errorMessage: "" });
  },

  handleAgreementChange(event) {
    if (this.data.loading) return;
    const values = event && event.detail && Array.isArray(event.detail.value) ? event.detail.value : [];
    this.setData({ agreed: values.includes("agree"), errorMessage: "" });
  },

  openLegal(event) {
    if (this.data.loading) return;
    const type = event.currentTarget.dataset.type === "privacy" ? "privacy" : "terms";
    wx.navigateTo({ url: `/pages/legal/index?type=${type}` });
  },

  async handleWeChatLogin() {
    if (this.data.loading) return;
    if (!this.data.agreed) {
      this.setData({ errorMessage: "请先阅读并同意用户协议和隐私政策。" });
      return;
    }
    this.setData({ loading: true, errorMessage: "" });
    try {
      await loginWithWeChat({ isActive: () => !this.unloaded });
      if (this.unloaded) return;
      getApp().syncAuthState();
      wx.showToast({ title: "登录成功", icon: "success" });
      this.finishAuth();
    } catch (error) {
      if (!this.unloaded && error.code !== "session_changed") this.setData({ errorMessage: getAuthErrorMessage(error) });
    } finally {
      if (!this.unloaded) this.setData({ loading: false });
    }
  },

  continueAsGuest() {
    if (this.data.loading) return;
    const pages = getCurrentPages();
    const previous = pages[pages.length - 2];
    if (previous && /^pages\/score\//.test(previous.route || "")) wx.navigateBack();
    else wx.switchTab({ url: "/pages/index/index" });
  },

  switchMode(event) {
    if (this.data.loading) return;
    this.setData({
      mode: event.currentTarget.dataset.mode,
      passwordVisible: false,
      errorMessage: "",
    });
  },

  handleInput(event) {
    this.setData({ [event.currentTarget.dataset.field]: event.detail.value });
  },

  togglePasswordVisibility() {
    this.setData({ passwordVisible: !this.data.passwordVisible });
  },

  async handleSubmit() {
    if (this.data.loading) return;
    if (!this.data.agreed) {
      this.setData({ errorMessage: "请先阅读并同意用户协议和隐私政策。" });
      return;
    }
    const username = this.data.username.trim();
    const password = this.data.password;
    if (!username || !password) {
      this.setData({ errorMessage: "请输入手机号和密码。" });
      return;
    }
    if (!/^1[3-9]\d{9}$/.test(username)) {
      this.setData({ errorMessage: "请输入有效的 11 位手机号。" });
      return;
    }
    if (this.data.mode === "register") {
      if (!this.data.displayName.trim() || !this.data.securityQuestion.trim() || !this.data.securityAnswer.trim()) {
        this.setData({ errorMessage: "请完整填写昵称、密保问题和密保答案。" });
        return;
      }
    }
    this.setData({ loading: true, errorMessage: "" });
    try {
      if (this.data.mode === "register") {
        await register({
          username,
          password,
          displayName: this.data.displayName.trim(),
          securityQuestion: this.data.securityQuestion.trim(),
          securityAnswer: this.data.securityAnswer.trim(),
        }, { isActive: () => !this.unloaded });
      } else {
        await login(username, password, { isActive: () => !this.unloaded });
      }
      getApp().syncAuthState();
      wx.showToast({ title: this.data.mode === "register" ? "注册成功" : "登录成功", icon: "success" });
      this.finishAuth();
    } catch (error) {
      if (!this.unloaded && error.code !== "session_changed") this.setData({ errorMessage: getAuthErrorMessage(error) });
    } finally {
      if (!this.unloaded) this.setData({ loading: false });
    }
  },

  finishAuth() {
    if (this.data.returnTo) {
      const path = this.data.returnTo.split("?")[0];
      if (["/pages/index/index", "/pages/profile/index"].includes(path)) wx.switchTab({ url: path });
      else wx.redirectTo({ url: this.data.returnTo });
      return;
    }
    if (getCurrentPages().length > 1) {
      wx.navigateBack();
      return;
    }
    wx.switchTab({ url: "/pages/index/index" });
  },
});
