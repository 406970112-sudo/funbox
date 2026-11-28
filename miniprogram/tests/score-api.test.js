const test = require("node:test");
const assert = require("node:assert/strict");

const calls = [];
let accessToken = "";
global.wx = {
  getStorageSync(key) {
    return key === "accessToken" ? accessToken : "";
  },
  removeStorageSync(key) {
    if (key === "accessToken") accessToken = "";
  },
  request(options) {
    calls.push(options);
    options.success({ statusCode: 200, data: { room: { id: "room-1" } } });
  },
};

const {
  acceptMahjongHandover,
  bindScoreParticipantAccount,
  createScoreRoom,
  issueMahjongHandoverCode,
  joinScoreRoom,
  manageMahjongHandover,
  listNearbyScoreRooms,
  listScoreHistory,
  previewMahjongHandover,
  settleScoreRoom,
} = require("../utils/score-api");

test("Mahjong handover scopes host writes and keeps claimant proof out of request URLs", async (t) => {
  const requests = [];
  const handover = { status: "open", points: 0 };
  accessToken = "account-token";
  t.after(() => { accessToken = ""; });
  t.mock.method(wx, "request", options => {
    requests.push(options);
    options.success({ statusCode: 200, data: { handover, room: { id: "room-1" }, inviteScene: "h_demo" } });
  });
  const host = { token: "host-token" };
  await manageMahjongHandover(host, { id: "room-1", version: 7 }, { action: "invite", participantId: "player-a" });
  await issueMahjongHandoverCode(host, "room-1", "handover-1");
  assert.deepEqual(await previewMahjongHandover("h_demo", "private-claim"), handover);
  assert.deepEqual(await acceptMahjongHandover({
    scene: "h_demo", claimToken: "private-claim", displayName: "E", points: 0, participantToken: "old-seat-token",
  }), handover);
  const [manage, code, preview, accept] = requests;
  assert.match(manage.url, /\/score-rooms\/room-1\/mahjong-handover$/);
  assert.equal(manage.header.Authorization, "Bearer host-token");
  assert.equal(manage.data.expectedRoomVersion, 7);
  assert.equal(manage.data.participantId, "player-a");
  assert.match(code.url, /\/mahjong-handover\/handover-1\/code$/);
  assert.equal(code.header.Authorization, "Bearer host-token");
  assert.match(preview.url, /\/mahjong-handover\/preview$/);
  assert.equal(preview.header.Authorization, undefined);
  assert.deepEqual(preview.data, { scene: "h_demo", claimToken: "private-claim" });
  assert.match(accept.url, /\/mahjong-handover\/accept$/);
  assert.equal(accept.header.Authorization, "Bearer account-token");
  assert.equal(accept.data.points, 0);
  assert.equal(accept.data.participantToken, "old-seat-token");
});

test("an expired account may accept a handover as a guest but invalid seat proof is never bypassed", async (t) => {
  accessToken = "expired-account";
  t.after(() => { accessToken = ""; });
  const calls = [];
  t.mock.method(wx, "request", options => {
    calls.push(options);
    const error = options.header.Authorization ? "score_handover_login_expired" : "unauthorized";
    options.success({ statusCode: 401, data: { error } });
  });
  const input = { scene: "h_demo", claimToken: "claim", displayName: "E", points: -30, participantToken: "old-seat" };
  await assert.rejects(acceptMahjongHandover(input), { scoreCode: "unauthorized" });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].header.Authorization, "Bearer expired-account");
  assert.equal(calls[1].header.Authorization, undefined);
  assert.deepEqual(calls[1].data, input);
});

test("score API sends authentication and mahjong room settings", async () => {
  calls.length = 0;
  await createScoreRoom("access-token", {
    name: "麻将",
    gameType: "mahjong",
    password: "1234",
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/miniprogram\/score-rooms$/);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].header.Authorization, "Bearer access-token");
  assert.deepEqual(calls[0].data, {
    name: "麻将",
    gameType: "mahjong",
    password: "1234",
  });
});

test("anonymous room creation can send a guest host nickname without authentication", async () => {
  accessToken = "";
  calls.length = 0;
  global.wx.request = (options) => {
    calls.push(options);
    options.success({ statusCode: 201, data: { room: { id: "room-1" }, guestToken: "host-token" } });
  };
  await createScoreRoom("", {
    name: "游客牌局",
    displayName: "游客房主",
    gameType: "mahjong",
    password: "1234",
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].header.Authorization, undefined);
  assert.equal(calls[0].data.displayName, "游客房主");
});

test("participant account binding sends both the account token and guest token", async () => {
  accessToken = "account-token";
  calls.length = 0;
  global.wx.request = (options) => {
    calls.push(options);
    options.success({ statusCode: 200, data: { room: { id: "room-1", hostUserId: "user-1" } } });
  };
  const room = await bindScoreParticipantAccount("room-1", "participant-token");
  assert.equal(room.hostUserId, "user-1");
  assert.match(calls[0].url, /\/score-rooms\/room-1\/bind-account$/);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].header.Authorization, "Bearer account-token");
  assert.deepEqual(calls[0].data, { participantToken: "participant-token" });
});

test("mahjong settlement explicitly enables the settlement rate", async () => {
  calls.length = 0;
  await settleScoreRoom(
    { token: "host-token" },
    { id: "room-1", version: 7 },
    250,
  );
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/score-rooms\/room-1\/settle$/);
  assert.equal(calls[0].data.centsPerPoint, 250);
  assert.equal(calls[0].data.useSettlementRate, true);
  assert.equal(calls[0].data.expectedRoomVersion, 7);
});

test("guest join sends room password without an account token", async () => {
  accessToken = "";
  calls.length = 0;
  await joinScoreRoom({ code: "123456", password: "2468", displayName: "游客" });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/score-rooms\/join$/);
  assert.equal(calls[0].header.Authorization, undefined);
  assert.equal(calls[0].data.password, "2468");
});

test("logged-in join links the account and retries as a guest after an expired token", async () => {
  accessToken = "account-token";
  calls.length = 0;
  global.wx.request = (options) => {
    calls.push(options);
    options.success({ statusCode: 201, data: { room: { id: "room-1" } } });
  };
  await joinScoreRoom({ code: "123456", displayName: "登录牌友" });
  assert.equal(calls[0].header.Authorization, "Bearer account-token");

  accessToken = "expired-token";
  calls.length = 0;
  global.wx.request = (options) => {
    calls.push(options);
    if (options.header.Authorization) {
      options.success({ statusCode: 401, data: { error: "unauthorized" } });
      return;
    }
    options.success({ statusCode: 201, data: { room: { id: "room-1" } } });
  };
  await joinScoreRoom({ code: "123456", displayName: "登录牌友" });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].header.Authorization, "Bearer expired-token");
  assert.equal(calls[1].header.Authorization, undefined);
  assert.equal(accessToken, "");
});

test("recent score history requests settled rooms participated in by the account", async () => {
  accessToken = "account-token";
  calls.length = 0;
  global.wx.request = (options) => {
    calls.push(options);
    options.success({ statusCode: 200, data: { rooms: [{ id: "room-1" }], total: 1, limit: 5, offset: 0 } });
  };
  const page = await listScoreHistory({ limit: 5, offset: 0, from: "2026-10-22T00:00:00.000Z" });
  assert.deepEqual(page.rooms, [{ id: "room-1" }]);
  assert.equal(page.total, 1);
  assert.match(calls[0].url, /\/score-rooms\/history\?scope=participated&status=settled&limit=5&offset=0&from=2026-10-22T00%3A00%3A00.000Z$/);
  assert.equal(calls[0].header.Authorization, "Bearer account-token");
});

test("nearby rooms request includes location radius and mahjong type", async () => {
  calls.length = 0;
  global.wx.request = (options) => {
    calls.push(options);
    options.success({ statusCode: 200, data: { rooms: [] } });
  };
  const rooms = await listNearbyScoreRooms({ latitude: 30.5, longitude: 104.0, radiusMeters: 3000 });
  assert.deepEqual(rooms, []);
  assert.match(calls[0].url, /nearby\?latitude=30.5&longitude=104&radiusMeters=3000&gameType=mahjong$/);
});

test("score API preserves backend error codes and snapshots", async () => {
  accessToken = "";
  global.wx.request = (options) => {
    calls.push(options);
    options.success({
      statusCode: 409,
      data: { error: "score_version_conflict", room: { id: "room-1", version: 9 } },
    });
  };
  await assert.rejects(
    joinScoreRoom({ code: "123456", password: "2468", displayName: "游客" }),
    (error) => error.statusCode === 409 && error.scoreCode === "score_version_conflict" && error.snapshot.version === 9,
  );
});

test("gift reversal and room cancellation send server version and independent action IDs", async () => {
  const { reverseScoreGiftBatch, cancelScoreRoom } = require("../utils/score-api");
  const snapshot = { id: "room/a", version: 8, status: "active" };
  calls.length = 0;
  global.wx.request = (options) => {
    calls.push(options);
    options.success({ statusCode: 200, data: { room: snapshot } });
  };
  assert.deepEqual(await reverseScoreGiftBatch({ kind: "guest", token: "guest-token" }, snapshot, "batch/a"), snapshot);
  assert.deepEqual(await cancelScoreRoom({ kind: "account", token: "account-token" }, snapshot), snapshot);
  assert.match(calls[0].url, /\/score-rooms\/room%2Fa\/gifts\/batch%2Fa\/reverse$/);
  assert.match(calls[1].url, /\/score-rooms\/room%2Fa\/cancel$/);
  assert.equal(calls[0].header.Authorization, "Bearer guest-token");
  assert.equal(calls[1].header.Authorization, "Bearer account-token");
  for (const call of calls) {
    assert.equal(call.method, "POST");
    assert.equal(call.data.expectedRoomVersion, 8);
    assert.match(call.data.clientActionId, /^score-.+/);
  }
  assert.notEqual(calls[0].data.clientActionId, calls[1].data.clientActionId);
});
