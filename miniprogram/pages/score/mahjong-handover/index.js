const { getStoredUser } = require("../../../utils/auth");
const { extractInviteScene, isMahjongHandoverScene } = require("../../../utils/invite");
const { acceptMahjongHandover, getScoreErrorMessage, previewMahjongHandover } = require("../../../utils/score-api");
const { formatScore } = require("../../../utils/score-format");
const { getScoreSession, saveScoreSession } = require("../../../utils/score-session");

const CLAIMS_KEY = "funboxMahjongHandoverClaimsV1";
const COMPLETION_WINDOW_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 3500;
const MAX_NAME_LENGTH = 16;
const SEATS = [
  { label: "东位", mark: "東" },
  { label: "南位", mark: "南" },
  { label: "西位", mark: "西" },
  { label: "北位", mark: "北" },
];
const TERMINAL_MESSAGES = {
  cancelled: "房主已取消这次接手邀请。",
  expired: "接手邀请已过期，请让房主重新生成。",
  claimed: "这次邀请已由其他牌友接受。",
};
const POINTS_CHANGED = "累计分数已变化，请核对后重新确认。";
const REFRESH_MESSAGES = {
  score_handover_score_changed: POINTS_CHANGED,
  score_handover_claimed: TERMINAL_MESSAGES.claimed,
  score_invalid_state: "牌局状态已变化，请核对后重试。",
  score_invite_invalid: "接手邀请已失效。",
};

function readClaims() {
  const stored = wx.getStorageSync(CLAIMS_KEY) || {};
  const current = {};
  for (const [scene, claim] of Object.entries(stored)) {
    if (isMahjongHandoverScene(scene) && claim && claim.expiresAt > Date.now()) current[scene] = claim;
  }
  if (Object.keys(current).length !== Object.keys(stored).length) wx.setStorageSync(CLAIMS_KEY, current);
  return current;
}

Page({
  data: {
    status: "loading",
    invite: null,
    displayName: "",
    nameError: "",
    errorMessage: "",
    submitting: false,
  },

  onLoad(options = {}) {
    const scene = options.scene ? extractInviteScene(`scene=${options.scene}`) : "";
    this.visibilityVersion = 0;
    if (!isMahjongHandoverScene(scene)) {
      this.setData({ status: "invalid", errorMessage: "请扫描房主出示的接手码。" });
      return;
    }
    this.scene = scene;
    const saved = readClaims()[scene];
    this.claimToken = saved ? saved.token : "";
    const user = getStoredUser();
    const displayName = user && user.displayName || "";
    if (displayName.length <= MAX_NAME_LENGTH) this.setData({ displayName });
  },

  onShow() {
    this.visible = true;
    return this.refreshInvitation();
  },

  onHide() {
    this.visible = false;
    this.visibilityVersion += 1;
    clearTimeout(this.pollTimer);
  },

  onUnload() {
    this.onHide();
  },

  handleNameInput(event) {
    this.setData({ displayName: event.detail.value, nameError: "" });
  },

  refreshInvitation() {
    return this.runRequest((isCurrent) => this.fetchInvitation(isCurrent));
  },

  async fetchInvitation(isCurrent, notice = "") {
    try {
      const result = await previewMahjongHandover(this.scene, this.claimToken);
      if (isCurrent()) {
        this.pollRetryAt = 0;
        this.applyInvitation(result, notice);
      }
    } catch (error) {
      if (!isCurrent()) return;
      if (error.scoreCode === "score_invite_invalid") {
        this.clearClaim();
        this.setData({ status: "invalid", errorMessage: "接手邀请已失效，请让房主重新生成。" });
        return;
      }
      if (error.scoreCode === "rate_limited") {
        const body = error.response && error.response.data;
        this.pollRetryAt = Date.now() + (Number(body && body.retryAfterSeconds) || 10) * 1000;
      }
      const status = this.data.status === "accepted" ? "accepted" : "retry";
      this.setData({ status, errorMessage: getScoreErrorMessage(error) });
    }
  },

  acceptInvitation() {
    const { status, invite } = this.data;
    if (status !== "open" && status !== "reconfirm") return;
    const displayName = this.data.displayName.trim();
    if (!displayName || displayName.length > MAX_NAME_LENGTH) {
      this.setData({ nameError: displayName ? "昵称最多 16 个字符。" : "请输入桌上昵称。" });
      return;
    }
    return this.runRequest(async (isCurrent) => {
      this.setData({ submitting: true, nameError: "", errorMessage: "" });
      try {
        const session = getScoreSession();
        const identity = session && session.roomId === invite.roomId ? { participantToken: session.guestToken } : {};
        const result = await acceptMahjongHandover({
          scene: this.scene, claimToken: this.claimToken, displayName, points: invite.points, ...identity,
        });
        if (isCurrent()) this.applyInvitation(result);
      } catch (error) {
        if (!isCurrent()) return;
        const notice = REFRESH_MESSAGES[error.scoreCode];
        if (notice || error.isNetworkError) {
          // A timed-out confirmation may already have reached the host.
          await this.fetchInvitation(isCurrent, notice || "未收到确认结果，请核对后重试。");
        } else {
          this.setData({ errorMessage: getScoreErrorMessage(error) });
        }
      }
    });
  },

  async runRequest(update) {
    if (!this.scene || !this.visible || this.requestActive || this.enteringRoom) return;
    const version = this.visibilityVersion;
    const isCurrent = () => this.visible && this.visibilityVersion === version;
    clearTimeout(this.pollTimer);
    this.requestActive = true;
    try {
      await update(isCurrent);
    } finally {
      this.requestActive = false;
      if (isCurrent()) {
        this.setData({ submitting: false });
        if (this.data.status === "accepted") {
          const retryDelay = (this.pollRetryAt || 0) - Date.now();
          this.pollTimer = setTimeout(() => this.refreshInvitation(), Math.max(POLL_INTERVAL_MS, retryDelay));
        }
      } else if (this.visible) {
        await this.refreshInvitation();
      }
    }
  },

  applyInvitation(result, notice = "") {
    const { status } = result;
    if (Object.prototype.hasOwnProperty.call(TERMINAL_MESSAGES, status)) {
      this.clearClaim();
      this.setData({ status, invite: null, errorMessage: TERMINAL_MESSAGES[status] });
      return;
    }
    if (status === "completed") {
      this.enterRoom(result);
      return;
    }
    const seat = SEATS[result.seat - 1];
    if (!seat || !result.roomId || !Number.isSafeInteger(result.points) || !["open", "accepted", "reconfirm"].includes(status)) {
      this.setData({ status: "retry", errorMessage: "接手邀请暂不可用，请重试。" });
      return;
    }
    const token = result.claimToken || this.claimToken;
    if (!token) {
      this.setData({ status: "retry", errorMessage: "未能验证接手邀请，请重试。" });
      return;
    }
    const claims = readClaims();
    const expiresAt = Date.parse(result.credentialExpiresAt) ||
      ((Date.parse(result.expiresAt) || Date.now()) + COMPLETION_WINDOW_MS);
    const saved = claims[this.scene];
    if (!saved || saved.token !== token || saved.expiresAt !== expiresAt) {
      claims[this.scene] = { token, expiresAt };
      wx.setStorageSync(CLAIMS_KEY, claims);
    }
    this.claimToken = token;
    this.setData({
      status,
      invite: {
        roomId: result.roomId, roomName: result.roomName, roomCode: result.roomCode,
        fromName: result.fromName, seat, points: result.points,
        scoreText: formatScore(result.points),
        scoreTone: result.points > 0 ? "positive" : result.points < 0 ? "negative" : "",
      },
      errorMessage: status === "reconfirm" ? POINTS_CHANGED : status === "open" ? notice : "",
    });
  },

  clearClaim() {
    const claims = readClaims();
    if (claims[this.scene] && claims[this.scene].token === this.claimToken) {
      delete claims[this.scene];
      wx.setStorageSync(CLAIMS_KEY, claims);
    }
  },

  enterRoom({ roomId, guestToken, participantId }) {
    if (!this.claimToken || !roomId || !guestToken || !participantId) {
      this.setData({ status: "retry", errorMessage: "暂时无法验证你的接手身份，请重试。" });
      return;
    }
    saveScoreSession({ roomId, guestToken, participantId });
    this.enteringRoom = true;
    this.setData({ status: "completed", errorMessage: "" });
    wx.redirectTo({
      url: `/pages/score/room/index?roomId=${encodeURIComponent(roomId)}&joined=1`,
      success: () => this.clearClaim(),
      fail: () => {
        this.enteringRoom = false;
        if (this.visible) this.setData({ status: "retry", errorMessage: "暂时无法进入牌局，请重试。" });
      },
    });
  },
});
