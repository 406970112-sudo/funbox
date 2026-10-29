const { createScoreRoom, getScoreErrorMessage, joinScoreRoom } = require("../../../utils/score-api");
const { clearScoreSession, saveHostRoomPassword, saveScoreSession } = require("../../../utils/score-session");
const { getAccessToken, getStoredUser } = require("../../../utils/auth");
const { extractInviteScene, extractInviteToken } = require("../../../utils/invite");

Page({
  data: {
    mode: "create",
    isLoggedIn: false,
    userName: "游客",
    roomName: "今晚麻将",
    hostNickname: "",
    roomPassword: "",
    confirmPassword: "",
    creating: false,
    roomCode: "",
    joinPassword: "",
    nickname: "",
    joining: false,
    errorMessage: "",
  },

  onLoad() {
    this.syncAuth();
  },

  onShow() {
    this.syncAuth();
  },

  syncAuth() {
    const user = getStoredUser();
    this.setData({
      isLoggedIn: Boolean(getAccessToken()),
      userName: user && user.displayName ? user.displayName : "游客",
      nickname: this.data.nickname || (user && user.displayName ? user.displayName : ""),
    });
  },

  switchMode(event) {
    this.setData({ mode: event.currentTarget.dataset.mode, errorMessage: "" });
  },

  goBack() {
    wx.navigateBack();
  },

  handleField(event) {
    const field = event.currentTarget.dataset.field;
    const value = event.detail.value;
    this.setData({ [field]: value, errorMessage: "" });
  },

  openAuth() {
    wx.navigateTo({ url: "/pages/auth/index" });
  },

  async createRoom() {
    if (this.data.creating) return;
    const roomName = this.data.roomName.trim();
    const hostNickname = this.data.hostNickname.trim();
    const password = this.data.roomPassword;
    if (!roomName) return this.setData({ errorMessage: "请输入房间名。" });
    if (!this.data.isLoggedIn && !hostNickname) return this.setData({ errorMessage: "请输入房主昵称。" });
    if (!/^\d{4,6}$/.test(password)) return this.setData({ errorMessage: "房间密码需为 4～6 位数字。" });
    if (password !== this.data.confirmPassword) return this.setData({ errorMessage: "两次输入的房间密码不一致。" });

    this.setData({ creating: true, errorMessage: "" });
    try {
      const result = await createScoreRoom(getAccessToken(), {
        name: roomName,
        maxPlayers: 4,
        password,
        scene: "generic",
        gameType: "mahjong",
        ...(this.data.isLoggedIn ? {} : { displayName: hostNickname }),
      });
      saveHostRoomPassword(result.room.id, password);
      if (result.guestToken) {
        saveScoreSession({
          roomId: result.room.id,
          guestToken: result.guestToken,
          participantId: result.actor && result.actor.participantId,
        });
      } else {
        clearScoreSession();
      }
      wx.navigateTo({ url: `/pages/score/room/index?roomId=${encodeURIComponent(result.room.id)}&created=1` });
    } catch (error) {
      this.setData({ errorMessage: getScoreErrorMessage(error) });
    } finally {
      this.setData({ creating: false });
    }
  },

  scanToJoin() {
    wx.scanCode({
      scanType: ["qrCode", "wxCode"],
      success: (result) => {
        const scannedValue = result.path || result.result || "";
        const inviteScene = extractInviteScene(scannedValue);
        if (inviteScene) {
          wx.navigateTo({ url: `/pages/score/room/index?scene=${encodeURIComponent(inviteScene)}` });
          return;
        }
        const inviteToken = extractInviteToken(scannedValue);
        if (!inviteToken) {
          this.setData({ errorMessage: "未识别到有效的牌局邀请。" });
          return;
        }
        wx.navigateTo({ url: `/pages/score/room/index?invite=${encodeURIComponent(inviteToken)}` });
      },
      fail: () => undefined,
    });
  },

  async joinByCode() {
    if (this.data.joining) return;
    const code = this.data.roomCode.trim();
    const displayName = this.data.nickname.trim();
    if (code.length !== 6 || !/^\d{6}$/.test(code)) return this.setData({ errorMessage: "请输入 6 位房间码。" });
    if (!/^\d{4,6}$/.test(this.data.joinPassword)) return this.setData({ errorMessage: "请输入 4～6 位房间密码。" });
    if (!displayName) return this.setData({ errorMessage: "请输入牌局内显示的昵称。" });
    this.setData({ joining: true, errorMessage: "" });
    try {
      const result = await joinScoreRoom({ code, password: this.data.joinPassword, displayName });
      this.enterJoinedRoom(result);
    } catch (error) {
      this.setData({ errorMessage: getScoreErrorMessage(error) });
    } finally {
      this.setData({ joining: false });
    }
  },

  enterJoinedRoom(result) {
    saveScoreSession({
      roomId: result.room.id,
      guestToken: result.guestToken,
      participantId: result.actor.participantId,
    });
    wx.navigateTo({ url: `/pages/score/room/index?roomId=${encodeURIComponent(result.room.id)}` });
  },

});
