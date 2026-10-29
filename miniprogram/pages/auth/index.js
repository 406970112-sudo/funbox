const { clearSession, getAuthErrorMessage, login, register } = require("../../utils/auth");

Page({
  data: {
    mode: "login",
    loading: false,
    errorMessage: "",
    returnTo: "",
    username: "",
    password: "",
    displayName: "",
    securityQuestion: "",
    securityAnswer: "",
  },

  onLoad(options) {
    this.setData({ returnTo: options.returnTo ? decodeURIComponent(options.returnTo) : "" });
  },

  switchMode(event) {
    this.setData({
      mode: event.currentTarget.dataset.mode,
      errorMessage: "",
    });
  },

  handleInput(event) {
    this.setData({ [event.currentTarget.dataset.field]: event.detail.value });
  },

  async handleSubmit() {
    if (this.data.loading) return;
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
        });
      } else {
        await login(username, password);
      }
      getApp().syncAuthState();
      wx.showToast({ title: this.data.mode === "register" ? "注册成功" : "登录成功", icon: "success" });
      setTimeout(() => this.finishAuth(), 350);
    } catch (error) {
      if (error && error.statusCode === 401) clearSession();
      this.setData({ errorMessage: getAuthErrorMessage(error) });
    } finally {
      this.setData({ loading: false });
    }
  },

  finishAuth() {
    if (this.data.returnTo) {
      wx.redirectTo({ url: this.data.returnTo });
      return;
    }
    if (getCurrentPages().length > 1) {
      wx.navigateBack();
      return;
    }
    wx.reLaunch({ url: "/pages/index/index" });
  },
});
