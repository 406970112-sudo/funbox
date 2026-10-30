const test = require("node:test");
const assert = require("node:assert/strict");

const joinCalls = [];
const bindCalls = [];
const settleCalls = [];
let realtimeOptions = null;
const scoreAPI = require.resolve("../utils/score-api");
require.cache[scoreAPI] = {
  id: scoreAPI,
  filename: scoreAPI,
  loaded: true,
  exports: {
    bindScoreParticipantAccount: async (roomId, participantToken) => {
      bindCalls.push({ roomId, participantToken });
      return {
        id: roomId,
        version: 4,
        status: "active",
        participants: [{
          id: "participant-guest",
          userId: "account-user",
          role: "guest",
          status: "active",
          displayName: "游客牌友",
          totalPoints: 0,
          joinedAt: "2026-10-29T00:00:00Z",
        }],
        selfParticipantId: "participant-guest",
        giftBatches: [],
      };
    },
    getScoreErrorMessage: (error) => error.message,
    joinScoreRoom: async (input) => {
      joinCalls.push(input);
      return {
        room: {
          id: "room-1", version: 2, status: "waiting", maxPlayers: 4,
          selfParticipantId: "participant-1",
          participants: [{ id: "participant-1", role: "guest", status: "active", displayName: input.displayName, totalPoints: 0 }],
        },
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
  page.startRealtime = () => undefined;
  page.startPolling = () => undefined;

  await page.joinFromInvite();

  assert.deepEqual(joinCalls, [{ inviteToken: "invite-token", displayName: "受邀牌友" }]);
  assert.equal(page.data.joinNeeded, false);
});

test("successful invitation join opens the returned snapshot without another room request", async () => {
  const page = createPage({
    loading: false,
    inviteToken: "invite-token",
    joinNeeded: true,
    joinNickname: "Guest",
    previewRoom: { id: "room-1" },
    errorMessage: "previous timeout",
  });
  let reads = 0;
  page.loadRoom = async () => {
    reads += 1;
    throw new Error("request:fail timeout");
  };
  page.startRealtime = () => undefined;
  page.startPolling = () => undefined;

  await page.joinFromInvite();

  assert.equal(reads, 0);
  assert.equal(page.data.room.id, "room-1");
  assert.equal(page.data.self.id, "participant-1");
  assert.equal(page.data.joinNeeded, false);
  assert.equal(page.data.loading, false);
  assert.equal(page.data.errorMessage, "");
  assert.equal(storage.funboxScoreSessionV1.guestToken, "guest-token");
});

test("scanned scene joins with a nickname and does not submit room code or password", async () => {
  joinCalls.length = 0;
  const page = createPage({
    inviteScene: "scene-123", inviteToken: "", joinNeeded: true,
    joinNickname: " 小林 ", previewRoom: { id: "room-1", requiresPassword: true },
  });
  page.startRealtime = () => undefined;
  page.startPolling = () => undefined;

  await page.joinFromInvite();

  assert.deepEqual(joinCalls, [{ inviteScene: "scene-123", displayName: "小林" }]);
  assert.equal(page.data.joinNeeded, false);
  assert.equal(page.data.self.displayName, "小林");
});

test("invitation confirmation rejects a blank nickname and ignores repeated pending submission", async () => {
  joinCalls.length = 0;
  const page = createPage({ inviteToken: "invite-token", joinNickname: "  ", joinNeeded: true, previewRoom: { id: "room-1" } });
  await page.joinFromInvite();
  assert.equal(joinCalls.length, 0);
  assert.equal(page.data.joinNeeded, true);
  assert.match(page.data.errorMessage, /昵称/);

  page.data.joinNickname = "小林";
  page.data.joining = true;
  await page.joinFromInvite();
  assert.equal(joinCalls.length, 0);
});

test("retrying a failed invitation keeps its original credential and prevents overlapping loads", async () => {
  for (const data of [{ inviteToken: "invite-token" }, { inviteScene: "scene-1" }]) {
    const page = createPage({ ...data, loading: false, errorMessage: "timeout" });
    const attempts = [];
    page.prepareInvite = async (token) => { attempts.push({ inviteToken: token }); };
    page.prepareInviteScene = async (scene) => { attempts.push({ inviteScene: scene }); };

    await page.retryOpenRoom();
    assert.deepEqual(attempts, [data]);
    page.data.loading = true;
    await page.retryOpenRoom();
    assert.equal(attempts.length, 1);
    page.data.loading = false;
    page.data.joining = true;
    await page.retryOpenRoom();
    assert.equal(attempts.length, 1);
  }
});

test("retrying an entered room reloads its saved identity instead of joining again", async () => {
  const page = createPage({ loading: false, roomId: "room-1", inviteToken: "invite-token" });
  page.credential = { kind: "guest", token: "guest-token" };
  let loads = 0;
  page.loadRoom = async () => { loads += 1; };
  const previousJoins = joinCalls.length;

  await page.retryOpenRoom();

  assert.equal(loads, 1);
  assert.equal(joinCalls.length, previousJoins);
  assert.equal(page.credential.token, "guest-token");
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

test("a logged-in guest participant can bind the current room identity", async () => {
  bindCalls.length = 0;
  storage.accessToken = "account-token";
  const page = createPage({
    room: { id: "room-1" },
    showAccountBinding: true,
    accountBound: false,
    bindingAccount: false,
  });
  page.credential = { kind: "guest", token: "participant-token" };
  page.applyRoom = async () => undefined;

  await page.bindParticipantAccount();

  assert.deepEqual(bindCalls, [{ roomId: "room-1", participantToken: "participant-token" }]);
  assert.equal(page.data.bindingAccount, false);
  assert.match(page.data.feedback, /已绑定账号/);
  delete storage.accessToken;
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

test("room data keeps the room-scoped host nickname", async () => {
  const page = createPage({});
  page.startRealtime = () => undefined;
  page.startPolling = () => undefined;

  await page.applyRoom({
    id: "room-room-nickname",
    version: 2,
    status: "waiting",
    maxPlayers: 4,
    selfParticipantId: "participant-host",
    participants: [{
      id: "participant-host",
      role: "host",
      status: "active",
      displayName: "本局房主",
      totalPoints: 0,
      joinedAt: "2026-10-29T00:00:00Z",
    }],
    giftBatches: [],
  });

  assert.equal(page.data.self.displayName, "本局房主");
  assert.equal(page.data.participants[0].displayName, "本局房主");
  assert.equal(page.data.settlementRows[0].name, "本局房主");
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

test("background snapshots preserve validation errors and clear recovered network errors", async () => {
  for (const scenario of [
    { canRetryLoad: false, errorMessage: "Enter a positive integer", expected: "Enter a positive integer" },
    { canRetryLoad: true, errorMessage: "Network timed out", expected: "" },
  ]) {
    const page = createPage(scenario);
    page.startRealtime = () => undefined;
    page.startPolling = () => undefined;

    await page.applyRoom({ id: "room-1", version: 4, status: "waiting", maxPlayers: 4, participants: [] });

    assert.equal(page.data.errorMessage, scenario.expected);
    assert.equal(page.data.canRetryLoad, false);
  }
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
