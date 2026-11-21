const { getScoreErrorMessage, issueMahjongHandoverCode, manageMahjongHandover } = require("./score-api");
const { formatScore } = require("./score-format");
const { drawScoreQRCode } = require("./score-qr");

const windNames = ["东", "南", "西", "北"];

function windName(seat) {
  return windNames[Number(seat) - 1] || "";
}

function clockTime(value) {
  const time = new Date(value);
  if (!Number.isFinite(time.getTime())) return "";
  return [time.getHours(), time.getMinutes()].map(part => String(part).padStart(2, "0")).join(":");
}

function handoverView(room, self, participants, isHost) {
  if (room.gameType !== "mahjong") return {};
  const eligibleTable = room.status === "active" && participants.length === 4 && !room.currentRound && !room.currentZhaJinHuaHand;
  const canManageMahjongHandover = isHost && eligibleTable;
  const pending = canManageMahjongHandover && room.mahjongHandover;
  const hostTarget = participants.find(person => person.id === room.pendingHostParticipantId);
  const sourceHost = participants.find(person => person.role === "host");
  return {
    canManageMahjongHandover,
    departedSeat: self?.status === "left" ? { wind: windName(self.mahjongSeat), scoreText: formatScore(self.leftAtPoints ?? self.totalPoints) } : null,
    handoverChoices: canManageMahjongHandover ? participants.slice().sort((left, right) => left.seatOrder - right.seatOrder)
      .map(person => ({ ...person, wind: windName(person.seatOrder) })) : [],
    handoverPending: pending ? {
      ...pending, wind: windName(pending.seat), pointsText: formatScore(pending.points),
      expiresTime: clockTime(pending.expiresAt), expired: Date.parse(pending.expiresAt) <= Date.now(),
    } : null,
    handoverHistory: (room.mahjongHandovers || []).slice().reverse().map(item => ({
      ...item, wind: windName(item.seat), pointsText: formatScore(item.points), time: clockTime(item.createdAt),
    })),
    pendingMahjongHost: canManageMahjongHandover ? hostTarget || null : null,
    mahjongHostOfferFrom: eligibleTable && self?.status === "active" && hostTarget && hostTarget.id === self.id
      ? sourceHost || null : null,
  };
}

const handoverData = {
  canManageMahjongHandover: false,
  departedSeat: null,
  handoverChoices: [],
  handoverPending: null,
  handoverHistory: [],
  pendingMahjongHost: null,
  mahjongHostOfferFrom: null,
  handoverSheet: "",
  handoverSelectedId: "",
  handoverSelection: null,
  handoverError: "",
  handoverCodePath: "",
  handoverCodeImage: "",
  handoverCodeSize: 150,
  handoverCodeLoading: false,
  handoverCodeError: "",
  handoverReceipt: null,
};

function createHandoverPage({ showModal, writeQrImageFile, removeQrImageFile }) {
  return {
    openMahjongHandover() {
      if (!this.data.canManageMahjongHandover || this.data.busy) return;
      this.setData({ handoverSheet: "seat", handoverSelectedId: "", handoverSelection: null, handoverError: "" },
        () => this.syncMahjongHandoverSheet(true));
    },

    openMahjongHostTransfer() {
      if (!this.data.canManageMahjongHandover || this.data.busy) return;
      this.setData({ handoverSheet: "host", handoverSelectedId: "", handoverSelection: null, handoverError: "" });
    },

    closeMahjongHandover() {
      this.setData({ handoverSheet: "", handoverSelectedId: "", handoverSelection: null, handoverError: "" });
    },

    selectMahjongHandoverPlayer(event) {
      if (this.data.busy) return;
      const selection = this.data.handoverChoices.find(person => person.id === event.currentTarget.dataset.id && person.role !== "host");
      if (selection) this.setData({ handoverSelectedId: selection.id, handoverSelection: selection, handoverError: "" });
    },

    syncMahjongHandoverSheet(redraw = false) {
      const { canManageMahjongHandover, handoverSheet, handoverPending, handoverChoices, handoverSelectedId } = this.data;
      if (!canManageMahjongHandover && handoverSheet) this.closeMahjongHandover();
      if (handoverSelectedId) {
        const selection = handoverChoices.find(person => person.id === handoverSelectedId && person.role !== "host") || null;
        this.setData({ handoverSelection: selection, handoverSelectedId: selection?.id || "" });
      }
      clearTimeout(this.handoverExpiryTimer);
      if (handoverPending && !handoverPending.expired) {
        const remaining = Date.parse(handoverPending.expiresAt) - Date.now();
        if (Number.isFinite(remaining)) {
          this.handoverExpiryTimer = setTimeout(() => {
            if (this.pageActive === false || this.data.handoverPending?.id !== handoverPending.id) return;
            this.setData({ handoverPending: { ...this.data.handoverPending, expired: true } });
            this.clearMahjongHandoverCode();
          }, Math.max(0, remaining));
        }
      }
      const canShowCode = handoverPending && !handoverPending.expired && handoverPending.status === "open";
      if (this.handoverCodeId && (!canShowCode || this.handoverCodeId !== handoverPending.id)) this.clearMahjongHandoverCode();
      if (canShowCode && handoverSheet === "seat" && !this.writesPaused()) {
        if (this.handoverCodeId !== handoverPending.id) this.ensureMahjongHandoverCode();
        else if (redraw) this.drawMahjongHandoverCode();
      }
    },

    clearMahjongHandoverCode() {
      this.handoverCodeId = "";
      this.handoverCodeRequest = null;
      removeQrImageFile(this.data.handoverCodeImage);
      if (this.pageActive !== false) {
        this.setData({ handoverCodePath: "", handoverCodeImage: "", handoverCodeLoading: false, handoverCodeError: "" });
      }
    },

    async ensureMahjongHandoverCode(event) {
      const pending = this.data.handoverPending;
      if (this.writesPaused() || !pending || pending.expired || pending.status !== "open") return;
      if (this.handoverCodeId === pending.id) {
        if (this.data.handoverCodeLoading || (!event && this.data.handoverCodeError)) return;
        if (this.data.handoverCodePath) {
          this.drawMahjongHandoverCode();
          return;
        }
      }
      const room = this.data.room;
      const request = {};
      const current = () => this.pageActive !== false && this.handoverCodeRequest === request;
      this.handoverCodeRequest = request;
      this.handoverCodeId = pending.id;
      this.setData({ handoverCodeLoading: true, handoverCodeError: "" });
      try {
        const code = await issueMahjongHandoverCode(this.credential, room.id, pending.id);
        if (!current()) return;
        if (!code?.inviteScene) throw new Error("暂时无法生成接手码，请重试。");
        const path = `/pages/score/room/index?scene=${encodeURIComponent(code.inviteScene)}`;
        let image = "";
        if (code.imageBase64) {
          try {
            image = await writeQrImageFile(code.imageBase64, `${room.id}-handover`, code.mediaType);
          } catch (error) {
            // The scene can still be shared and rendered as an in-app scan code.
          }
        }
        if (!current()) {
          removeQrImageFile(image);
          return;
        }
        this.setData({ handoverCodePath: path, handoverCodeImage: image, handoverCodeLoading: false }, () => this.drawMahjongHandoverCode());
      } catch (error) {
        if (current()) this.setData({ handoverCodeLoading: false, handoverCodeError: getScoreErrorMessage(error) });
      }
    },

    drawMahjongHandoverCode() {
      const { handoverCodePath, handoverCodeImage, handoverCodeSize, handoverSheet } = this.data;
      if (!handoverCodePath || handoverCodeImage || handoverSheet !== "seat") return;
      try {
        drawScoreQRCode(this, "mahjongHandoverQr", handoverCodePath, handoverCodeSize);
      } catch (error) {
        this.setData({ handoverCodeError: "二维码暂不可用，可以转发接手邀请。" });
      }
    },

    showHandoverCodeFallback() {
      if (!this.data.handoverCodeImage || !this.data.handoverCodePath) return;
      removeQrImageFile(this.data.handoverCodeImage);
      this.setData({ handoverCodeImage: "" }, () => this.drawMahjongHandoverCode());
    },

    async mutateMahjongHandover(action, payload, reviewed = this.data.room) {
      if (this.data.busy || this.writesPaused() || !reviewed || reviewed.status !== "active") return false;
      if (this.data.room?.id !== reviewed.id || this.data.room.version !== reviewed.version) {
        this.setData({ handoverError: "牌桌已更新，请核对后重试。" });
        return false;
      }
      this.setData({ busy: true, handoverError: "" });
      try {
        const room = await manageMahjongHandover(this.credential, reviewed, { action, ...payload });
        if (this.pageActive === false) return false;
        await this.applyRoom(room);
        return true;
      } catch (error) {
        if (this.pageActive === false) return false;
        if (error?.snapshot) await this.applyRoom(error.snapshot);
        else if (["score_handover_score_changed", "score_invalid_state"].includes(error?.scoreCode)) await this.refreshRoom();
        if (this.pageActive !== false) this.setData({ handoverError: getScoreErrorMessage(error) });
        return false;
      } finally {
        if (this.pageActive !== false) this.setData({ busy: false });
      }
    },

    async inviteMahjongHandover() {
      const { canManageMahjongHandover, handoverPending, handoverSelection } = this.data;
      if (!canManageMahjongHandover || (handoverPending && !handoverPending.expired) || !handoverSelection) return;
      const invited = await this.mutateMahjongHandover("invite", { participantId: handoverSelection.id });
      if (invited) this.setData({ handoverSelectedId: "", handoverSelection: null });
    },

    cancelMahjongHandover() {
      const pending = this.data.handoverPending;
      if (this.data.canManageMahjongHandover && pending && !pending.expired) {
        return this.mutateMahjongHandover("cancel", { handoverId: pending.id });
      }
    },

    async confirmMahjongHandover(event) {
      const { room, handoverPending: pending } = this.data;
      if (!this.data.canManageMahjongHandover || pending?.status !== "accepted" || pending.expired) return;
      const { id, version } = event.currentTarget.dataset;
      if (id !== pending.id || Number(version) !== Number(room.version)) {
        this.setData({ handoverError: "牌桌已更新，请核对后重试。" });
        return;
      }
      const confirmed = await this.mutateMahjongHandover("confirm", { handoverId: id }, room);
      if (confirmed && !this.data.handoverPending) this.closeMahjongHandover();
    },

    async offerMahjongHost() {
      const { room, handoverSelection, canManageMahjongHandover, pendingMahjongHost, busy } = this.data;
      if (!canManageMahjongHandover || pendingMahjongHost || !handoverSelection || busy || this.writesPaused()) return;
      const { confirm } = await showModal({
        title: "邀请新房主？", content: `向${handoverSelection.displayName}发出邀请。对方接受后，房主权限随即移交。`,
        confirmText: "发出邀请", confirmColor: "#2d5bff", cancelText: "返回",
      });
      if (confirm) await this.mutateMahjongHandover("offer_host", { participantId: handoverSelection.id }, room);
    },

    async acceptMahjongHost() {
      const { room, mahjongHostOfferFrom, busy } = this.data;
      if (!mahjongHostOfferFrom || busy || this.writesPaused()) return;
      const { confirm } = await showModal({
        title: "确认成为房主？", content: `接受${mahjongHostOfferFrom.displayName}的邀请，接管换人、撤销给分和结算。`,
        confirmText: "确认接任", confirmColor: "#2d5bff", cancelText: "返回",
      });
      if (!confirm) return;
      const accepted = await this.mutateMahjongHandover("accept_host", {}, room);
      if (accepted) this.setData({ feedback: "你已成为房主。" });
    },

    cancelMahjongHost() {
      if (this.data.canManageMahjongHandover && this.data.pendingMahjongHost) {
        return this.mutateMahjongHandover("cancel_host");
      }
    },

    showHandoverReceipt(receipt) {
      clearTimeout(this.handoverReceiptTimer);
      this.setData({ handoverReceipt: receipt });
      this.handoverReceiptTimer = setTimeout(() => this.clearHandoverReceipt(), 2200);
    },

    clearHandoverReceipt() {
      clearTimeout(this.handoverReceiptTimer);
      if (this.data.handoverReceipt) this.setData({ handoverReceipt: null });
    },
  };
}

module.exports = { handoverView, handoverData, createHandoverPage };
