const test = require("node:test");
const assert = require("node:assert/strict");
const base = require("../utils/score-room-base");

global.wx = {
  getStorageSync: () => null,
  setStorageSync() {},
};

const a = { id: "a", status: "active", role: "guest", displayName: "A", joinedAt: "1", totalPoints: -30, mahjongSeat: 1 };
const b = { id: "b", status: "active", role: "host", displayName: "B", joinedAt: "2", totalPoints: 18, mahjongSeat: 2 };
const c = { id: "c", status: "active", role: "guest", displayName: "C", joinedAt: "3", totalPoints: 8, mahjongSeat: 3 };
const d = { id: "d", status: "active", role: "guest", displayName: "D", joinedAt: "4", totalPoints: 4, mahjongSeat: 4 };
const e = { id: "e", status: "active", role: "guest", displayName: "E", joinedAt: "5", totalPoints: -30, mahjongSeat: 1 };
const handover = { id: "exchange", fromParticipantId: "a", fromName: "A", toParticipantId: "e", toName: "E", seat: 1, points: -30, createdAt: "2026-11-21T12:31:00Z" };
const active = {
  id: "table", name: "老友局", code: "810213", gameType: "mahjong", maxPlayers: 4, status: "active", version: 7,
  selfParticipantId: "b", participants: [a, b, c, d],
  giftBatches: [{ id: "gift", number: 1, gifts: [{ fromParticipantId: "a", toParticipantId: "b", points: 18 }] }],
};
const replaced = {
  ...active, version: 8, participants: [{ ...a, status: "left", leftAtPoints: -30 }, b, c, d, e],
  mahjongHandovers: [handover],
};

function page() {
  return {
    ...base,
    data: { ...base.data },
    setData(patch, callback) {
      Object.assign(this.data, patch);
      if (callback) callback();
    },
    startRealtime() {},
    startPolling() {},
  };
}

function input(participantId, points) {
  return { currentTarget: { dataset: { id: participantId } }, detail: { value: points } };
}

test("moving a seat to a new identity drops its old draft and requires reviewing surviving drafts", async () => {
  const view = page();
  await view.applyRoom(active);
  view.handleGiftInput(input("a", "9"));
  view.handleGiftInput(input("c", "3"));
  await view.applyRoom(replaced);

  assert.deepEqual(view.data.recipients.map(({ id, seatMark, pointsInput }) => [id, seatMark, pointsInput]), [
    ["e", "東", ""], ["c", "西", "3"], ["d", "北", ""],
  ]);
  assert.equal(view.data.giftTotal, 3);
  assert.equal(view.data.canSubmitGifts, false);
  assert.match(view.data.giftRosterReview, /A/);

  await view.applyRoom(replaced);
  assert.equal(view.data.canSubmitGifts, false);
  view.reviewGiftRecipients();
  assert.equal(view.data.canSubmitGifts, true);
  assert.match(view.data.giftHistory[0].items[0].text, /^A 给 B/);
  view.clearHandoverReceipt();
});

test("departed players see exit points and ledger with no active write controls", async () => {
  const view = page();
  await view.applyRoom({ ...replaced, selfParticipantId: "a" });

  assert.equal(view.data.departedSeat.scoreText, "-30");
  assert.deepEqual(view.data.recipients, []);
  assert.equal(view.data.canSubmitGifts, false);
  assert.equal(view.data.canManageMahjongHandover, false);
  assert.equal(view.data.handoverReceipt, null);
  assert.deepEqual(view.data.settlementRows.map(({ participantId }) => participantId), ["b", "c", "d", "e"]);
  assert.equal(view.data.handoverHistory[0].fromName, "A");
  assert.equal(view.data.handoverHistory[0].toName, "E");
});

test("a tap on an earlier accepted amount cannot confirm a newer amount", async (t) => {
  const view = page();
  view.credential = { kind: "guest", token: "fixture" };
  t.after(() => view.onUnload());
  const pending = {
    id: "exchange", fromParticipantId: "a", fromName: "A", seat: 1,
    points: -30, expiresAt: new Date(Date.now() + 60000).toISOString(), status: "accepted", candidateName: "E",
  };
  const confirmFromRenderedVersion = version => view.confirmMahjongHandover({ currentTarget: { dataset: { id: "exchange", version } } });
  await view.applyRoom({ ...active, mahjongHandover: pending });
  view.openMahjongHandover();
  await view.applyRoom({ ...active, version: 9, mahjongHandover: { ...pending, points: -26 } });

  const requests = [];
  wx.request = options => {
    requests.push(options.data);
    const participants = replaced.participants.map(person => person.id === "e" ? { ...person, totalPoints: -26 } : person);
    options.success({ statusCode: 200, data: { room: { ...replaced, version: 10, participants, mahjongHandovers: [{ ...handover, points: -26 }] } } });
  };
  t.after(() => { delete wx.request; });

  await confirmFromRenderedVersion(7);
  assert.equal(requests.length, 0);
  assert.equal(view.data.handoverPending.points, -26);

  await confirmFromRenderedVersion(9);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].expectedRoomVersion, 9);
  assert.equal(view.data.handoverReceipt.toName, "E");
  assert.equal(view.data.handoverReceipt.points, -26);
});
