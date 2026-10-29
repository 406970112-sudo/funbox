const { createScoreRoom, getScoreErrorMessage, joinScoreRoom, listNearbyScoreRooms } = require("../../../utils/score-api");
const { clearScoreSession, saveScoreSession } = require("../../../utils/score-session");
const { getAccessToken, getStoredUser } = require("../../../utils/auth");
const { capSummary, formatCNY, formatDistance, parseYuanToCents } = require("../../../utils/score-format");
const { extractInviteScene, extractInviteToken } = require("../../../utils/invite");

function getLocation() {
  return new Promise((resolve, reject) => {
    wx.getLocation({
      type: "gcj02",
      isHighAccuracy: true,
      success: resolve,
      fail: reject,
    });
  });
}

Page({
  data: {
    mode: "create",
    isLoggedIn: false,
    userName: "游客",
    roomName: "今晚麻将",
    roomPassword: "",
    confirmPassword: "",
    rateInput: "1",
    capInput: "10",
    rateText: "¥1.00 / 分",
    capText: "10 分 / ¥10.00",
    publishNearby: true,
    creating: false,
    roomCode: "",
    joinPassword: "",
    nickname: "",
    joining: false,
    showNearby: false,
    nearbyLoading: false,
    nearbyRadius: 3000,
    nearbyRooms: [],
    selectedNearby: null,
    nearbyPassword: "",
    nearbyNickname: "",
    joiningNearby: false,
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
      nearbyNickname: this.data.nearbyNickname || (user && user.displayName ? user.displayName : ""),
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
    const patch = { [field]: value, errorMessage: "" };
    if (field === "rateInput") {
      const cents = parseYuanToCents(value);
      patch.rateText = cents ? `${formatCNY(cents)} / 分` : "金额格式待修正";
    }
    if (field === "capInput" || field === "rateInput") {
      const cap = Number(value === undefined ? this.data.capInput : field === "capInput" ? value : this.data.capInput);
      const cents = parseYuanToCents(field === "rateInput" ? value : this.data.rateInput);
      patch.capText = Number.isSafeInteger(cap) && cap > 0 && cents ? capSummary(cap, cents) : "封顶待修正";
    }
    this.setData(patch);
  },

  toggleNearbyPublish(event) {
    this.setData({ publishNearby: event.detail.value });
  },

  openAuth() {
    wx.navigateTo({ url: "/pages/auth/index" });
  },

  async createRoom() {
    if (this.data.creating) return;
    if (!this.data.isLoggedIn) {
      this.openAuth();
      return;
    }
    const roomName = this.data.roomName.trim();
    const password = this.data.roomPassword;
    const centsPerPoint = parseYuanToCents(this.data.rateInput);
    const capPoints = Number(this.data.capInput);
    if (!roomName) return this.setData({ errorMessage: "请输入房间名。" });
    if (!/^\d{4,6}$/.test(password)) return this.setData({ errorMessage: "房间密码需为 4～6 位数字。" });
    if (password !== this.data.confirmPassword) return this.setData({ errorMessage: "两次输入的房间密码不一致。" });
    if (!centsPerPoint) return this.setData({ errorMessage: "请输入大于 0、最多两位小数的每分金额。" });
    if (!Number.isSafeInteger(capPoints) || capPoints < 1 || capPoints > 2147483647) {
      return this.setData({ errorMessage: "封顶需为正整数分值。" });
    }

    this.setData({ creating: true, errorMessage: "" });
    try {
      let location = null;
      if (this.data.publishNearby) {
        try {
          location = await getLocation();
        } catch (error) {
          const proceed = await new Promise((resolve) => {
            wx.showModal({
              title: "无法获取位置",
              content: "房间仍可创建，但不会出现在附近房间列表。是否继续？",
              confirmText: "继续创建",
              success: (result) => resolve(result.confirm),
              fail: () => resolve(false),
            });
          });
          if (!proceed) return;
        }
      }
      const result = await createScoreRoom(getAccessToken(), {
        name: roomName,
        maxPlayers: 4,
        centsPerPoint,
        capPoints,
        password,
        scene: "generic",
        gameType: "mahjong",
        latitude: location ? location.latitude : undefined,
        longitude: location ? location.longitude : undefined,
      });
      clearScoreSession();
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

  async searchNearby() {
    if (this.data.nearbyLoading) return;
    this.setData({ nearbyLoading: true, errorMessage: "" });
    try {
      const location = await getLocation();
      const rooms = await listNearbyScoreRooms({
        latitude: location.latitude,
        longitude: location.longitude,
        radiusMeters: this.data.nearbyRadius,
        gameType: "mahjong",
      });
      this.setData({
        showNearby: true,
        nearbyRooms: rooms.map((room) => ({
          ...room,
          rateText: `${formatCNY(room.centsPerPoint)} / 分`,
          capText: capSummary(room.capPoints, room.centsPerPoint),
          distanceText: formatDistance(room.distanceMeters),
        })),
      });
      if (!rooms.length) wx.showToast({ title: "附近暂无等待中的房间", icon: "none" });
    } catch (error) {
      this.setData({ errorMessage: error && error.errMsg ? "定位失败，请授权位置后重试。" : getScoreErrorMessage(error) });
    } finally {
      this.setData({ nearbyLoading: false });
    }
  },

  changeNearbyRadius(event) {
    this.setData({ nearbyRadius: Number(event.currentTarget.dataset.radius) });
    this.searchNearby();
  },

  selectNearby(event) {
    const room = this.data.nearbyRooms.find((item) => item.id === event.currentTarget.dataset.roomId);
    if (!room) return;
    this.setData({
      selectedNearby: room,
      nearbyPassword: "",
      nearbyNickname: this.data.nickname || this.data.userName,
    });
  },

  closeNearbySheet() {
    this.setData({ selectedNearby: null, nearbyPassword: "", errorMessage: "" });
  },

  noop() {},

  handleNearbyField(event) {
    this.setData({ [event.currentTarget.dataset.field]: event.detail.value, errorMessage: "" });
  },

  async joinNearby() {
    if (this.data.joiningNearby || !this.data.selectedNearby) return;
    const displayName = this.data.nearbyNickname.trim();
    if (!/^\d{4,6}$/.test(this.data.nearbyPassword)) return this.setData({ errorMessage: "请输入 4～6 位房间密码。" });
    if (!displayName) return this.setData({ errorMessage: "请输入牌局内显示的昵称。" });
    this.setData({ joiningNearby: true, errorMessage: "" });
    try {
      const result = await joinScoreRoom({
        code: this.data.selectedNearby.code,
        password: this.data.nearbyPassword,
        displayName,
      });
      this.enterJoinedRoom(result);
    } catch (error) {
      this.setData({ errorMessage: getScoreErrorMessage(error) });
    } finally {
      this.setData({ joiningNearby: false });
    }
  },
});
