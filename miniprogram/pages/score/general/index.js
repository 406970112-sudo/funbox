const base = require("../../../utils/score-entry-base");

Page({
  ...base,
  data: { ...base.data, gameType: "generic", roomName: "周末好友局" },
  buildCreateInput() {
    return {
      name: this.data.roomName.trim(),
      displayName: this.data.hostNickname.trim(),
      password: this.data.roomPassword,
      scene: "generic",
      gameType: "generic",
      maxPlayers: 0,
    };
  },
});
