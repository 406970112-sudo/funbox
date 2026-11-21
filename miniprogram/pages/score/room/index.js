const base = require("../../../utils/score-room-base");
const { extractInviteScene, isMahjongHandoverScene } = require("../../../utils/invite");

Page({
  ...base,

  onLoad(options = {}) {
    const scene = options.scene ? extractInviteScene(`scene=${options.scene}`) : "";
    this.routingHandover = isMahjongHandoverScene(scene);
    if (!this.routingHandover) return base.onLoad.call(this, options);
    wx.redirectTo({
      url: `/pages/score/mahjong-handover/index?scene=${encodeURIComponent(scene)}`,
      fail: () => this.setData({ loading: false, errorMessage: "接手邀请打开失败，请重新扫码。" }),
    });
  },

  onShow() {
    if (!this.routingHandover) base.onShow.call(this);
  },

  onHide() {
    if (!this.routingHandover) base.onHide.call(this);
  },

  onUnload() {
    if (!this.routingHandover) base.onUnload.call(this);
  },

  routePoker(room, preview) {
    if (room.gameType !== "zhajinhua") return false;
    const query = preview
      ? (this.data.inviteScene ? "scene=" + encodeURIComponent(this.data.inviteScene) : "invite=" + encodeURIComponent(this.data.inviteToken))
      : "roomId=" + encodeURIComponent(room.id);
    wx.redirectTo({ url: "/pages/score/poker-room/index?" + query });
    return true;
  },
});
