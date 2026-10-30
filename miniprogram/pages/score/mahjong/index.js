const { createScoreRoom, getScoreErrorMessage, joinScoreRoom } = require("../../../utils/score-api");
const { clearScoreSession, saveHostRoomPassword, saveScoreSession } = require("../../../utils/score-session");
const { getAccessToken, getStoredUser } = require("../../../utils/auth");
const { extractInviteScene, extractInviteToken } = require("../../../utils/invite");

Page({
  data: {
    mode: "create",
    isLoggedIn: false,
    userName: "游客",
    roomName: "老友局",
    hostNickname: "",
    authNickname: "",
    roomPassword: "666666",
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
    const isLoggedIn = Boolean(getAccessToken());
    const wasLoggedIn = this.data.isLoggedIn;
    const authNickname = user && user.displayName ? user.displayName : "";
    let hostNickname = this.data.hostNickname;
    if (isLoggedIn && (!wasLoggedIn || !hostNickname || hostNickname === this.data.authNickname)) {
      hostNickname = authNickname;
    } else if (!isLoggedIn && wasLoggedIn && hostNickname === this.data.authNickname) {
      hostNickname = "";
    }
    this.setData({
      isLoggedIn,
      userName: user && user.displayName ? user.displayName : "游客",
      nickname: this.data.nickname || (user && user.displayName ? user.displayName : ""),
      authNickname,
      hostNickname,
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
    if (!hostNickname) return this.setData({ errorMessage: "请输入房主昵称。" });
    if (!/^\d{4,6}$/.test(password)) return this.setData({ errorMessage: "房间密码需为 4～6 位数字。" });

    this.setData({ creating: true, errorMessage: "" });
    try {
      const result = await createScoreRoom(getAccessToken(), {
        name: roomName,
        maxPlayers: 4,
        password,
        scene: "generic",
        gameType: "mahjong",
        displayName: hostNickname,
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
