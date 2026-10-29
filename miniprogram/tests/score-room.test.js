const test = require("node:test");
const assert = require("node:assert/strict");

const joinCalls = [];
const settleCalls = [];
let realtimeOptions = null;
const scoreAPI = require.resolve("../utils/score-api");
require.cache[scoreAPI] = {
  id: scoreAPI,
  filename: scoreAPI,
  loaded: true,
  exports: {
    getScoreErrorMessage: (error) => error.message,
    joinScoreRoom: async (input) => {
      joinCalls.push(input);
      return {
        room: { id: "room-1" },
        guestToken: "guest-token",
        actor: { participantId: "participant-1" },
      };
    },
    settleScoreRoom: async (...args) => {
      settleCalls.push(args);
      return { id: "room-1", version: 9, status: "settled", participants: [] };
    },
  },
};

const realtime = require.resolve("../utils/score-realtime");
require.cache[realtime] = {
  id: realtime,
  filename: realtime,
  loaded: true,
  exports: {
    connectScoreRealtime: (options) => {
      realtimeOptions = options;
      return () => undefined;
    },
  },
};

const storage = {};
global.wx = {
  getStorageSync(key) {
    return storage[key] || "";
  },
  setStorageSync(key, value) {
    storage[key] = value;
  },
  removeStorageSync(key) {
    delete storage[key];
  },
  showModal(options) {
    options.success({ confirm: true });
  },
};

let pageDefinition;
global.Page = (definition) => {
  pageDefinition = definition;
};

require("../pages/score/room/index");

function createPage(data) {
  return {
    ...pageDefinition,
    data: { ...pageDefinition.data, ...data },
    setData(patch, callback) {
      this.data = { ...this.data, ...patch };
      if (callback) callback();
    },
  };
}

test("invite join only submits the invited name", async () => {
  joinCalls.length = 0;
  const page = createPage({
    inviteToken: "invite-token",
    joinNickname: "受邀牌友",
    joining: false,
    previewRoom: { requiresPassword: true },
  });
  page.credential = null;
  page.loadRoom = async () => undefined;

  await page.joinFromInvite();

  assert.deepEqual(joinCalls, [{ inviteToken: "invite-token", displayName: "受邀牌友" }]);
  assert.equal(page.data.joinNeeded, false);
});

test("gift totals no longer depend on a cap setting", () => {
  const page = createPage({
    room: {},
    recipients: [{ id: "participant-2", pointsInput: "" }],
  });

  page.handleGiftInput({
    currentTarget: { dataset: { id: "participant-2" } },
    detail: { value: "13" },
  });

  assert.equal(page.data.giftTotal, 13);
  assert.equal(page.data.canSubmitGifts, true);
});

test("host settlement defaults to one yuan and submits the edited rate", async () => {
  settleCalls.length = 0;
  const page = createPage({
    isHost: true,
    room: { id: "room-1", version: 8, status: "active" },
    settlementRows: [{ participantId: "participant-1", totalPoints: -8 }],
  });
  page.credential = { kind: "account", token: "host-token" };
  page.applyRoom = async () => undefined;

  page.openSettlement();
  assert.equal(page.data.settlementRateInput, "1");
  assert.equal(page.data.settlementRows[0].amountText, "-¥8.00");

  page.handleSettlementRateInput({ detail: { value: "2.5" } });
  assert.equal(page.data.settlementRateValid, true);
  assert.equal(page.data.settlementRows[0].amountText, "-¥20.00");

  await page.confirmSettlement();
  assert.equal(settleCalls.length, 1);
  assert.equal(settleCalls[0][0].token, "host-token");
  assert.equal(settleCalls[0][1].id, "room-1");
  assert.equal(settleCalls[0][2], 250);
});

test("invalid settlement rates stay blocked", () => {
  const page = createPage({
    isHost: true,
    room: { id: "room-1", version: 8, status: "active" },
    settlementRows: [{ participantId: "participant-1", totalPoints: 2 }],
  });

  page.openSettlement();
  page.handleSettlementRateInput({ detail: { value: "0" } });

  assert.equal(page.data.settlementRateValid, false);
  assert.match(page.data.settlementRateError, /每分金额/);
  assert.equal(page.data.settlementRows[0].amountText, "—");
});

test("host-only room data includes the locally saved room password", async () => {
  const { saveHostRoomPassword } = require("../utils/score-session");
  saveHostRoomPassword("room-password", "2468");
  const page = createPage({});
  page.startRealtime = () => undefined;
  page.startPolling = () => undefined;

  await page.applyRoom({
    id: "room-password",
    version: 2,
    status: "active",
    maxPlayers: 4,
    selfParticipantId: "participant-host",
    participants: [{
      id: "participant-host",
      role: "host",
      status: "active",
      displayName: "房主",
      totalPoints: 0,
      joinedAt: "2026-10-29T00:00:00Z",
    }],
    giftBatches: [],
  });

  assert.equal(page.data.isHost, true);
  assert.equal(page.data.hostRoomPassword, "2468");
});

test("guest room data never exposes the host room password", async () => {
  const { saveHostRoomPassword } = require("../utils/score-session");
  saveHostRoomPassword("room-guest", "2468");
  const page = createPage({});
  page.startRealtime = () => undefined;
  page.startPolling = () => undefined;

  await page.applyRoom({
    id: "room-guest",
    version: 2,
    status: "active",
    maxPlayers: 4,
    selfParticipantId: "participant-guest",
    participants: [{
      id: "participant-guest",
      role: "guest",
      status: "active",
      displayName: "牌友",
      totalPoints: 0,
      joinedAt: "2026-10-29T00:00:00Z",
    }],
    giftBatches: [],
  });

  assert.equal(page.data.isHost, false);
  assert.equal(page.data.hostRoomPassword, "");
});

test("share title never includes the room password", () => {
  const page = createPage({
    inviteToken: "invite-token",
    hostRoomPassword: "2468",
    room: { name: "周五牌局", status: "waiting" },
  });

  const share = page.onShareAppMessage();

  assert.equal(share.title, "邀请你加入「周五牌局」");
  assert.doesNotMatch(share.title, /2468/);
  assert.doesNotMatch(share.path, /2468|password/);
});

test("realtime online state catches up the room snapshot", () => {
  realtimeOptions = null;
  const page = createPage({
    room: { id: "room-1", version: 3 },
    realtimeStatus: "connecting",
  });
  page.credential = { kind: "guest", token: "guest-token" };
  let refreshCalls = 0;
  page.refreshRoom = async () => {
    refreshCalls += 1;
  };

  page.startRealtime();
  realtimeOptions.onStatus("online");

  assert.equal(page.data.realtimeStatus, "online");
  assert.equal(refreshCalls, 1);
});

test("stale room snapshots never replace a newer room version", async () => {
  const page = createPage({
    room: { id: "room-1", version: 5 },
    recipients: [],
  });
  page.startRealtime = () => undefined;
  page.startPolling = () => undefined;

  const applied = await page.applyRoom({ id: "room-1", version: 4, participants: [] });

  assert.equal(applied, false);
  assert.equal(page.data.room.version, 5);
});

test("realtime invalidations are not dropped while a mutation is busy", () => {
  realtimeOptions = null;
  const page = createPage({
    room: { id: "room-1", version: 3 },
    busy: true,
  });
  page.credential = { kind: "guest", token: "guest-token" };
  let refreshCalls = 0;
  page.refreshRoom = async () => {
    refreshCalls += 1;
  };

  page.startRealtime();
  realtimeOptions.onInvalidate(4, 7);

  assert.equal(refreshCalls, 1);
});

test("overlapping refreshes are coalesced into one follow-up fetch", async () => {
  const page = createPage({ roomId: "room-1" });
  page.credential = { kind: "guest", token: "guest-token" };
  let loadCalls = 0;
  page.loadRoom = async () => {
    loadCalls += 1;
  };

  const first = page.refreshRoom();
  const second = page.refreshRoom();
  assert.equal(loadCalls, 1);

  await Promise.all([first, second]);
  await Promise.resolve();

  assert.equal(loadCalls, 2);
});
