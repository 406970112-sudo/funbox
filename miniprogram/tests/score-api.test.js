const test = require("node:test");
const assert = require("node:assert/strict");

const calls = [];
global.wx = {
  getStorageSync() {
    return "";
  },
  request(options) {
    calls.push(options);
    options.success({ statusCode: 200, data: { room: { id: "room-1" } } });
  },
};

const { createScoreRoom, joinScoreRoom, listNearbyScoreRooms, settleScoreRoom } = require("../utils/score-api");

test("score API sends authentication and mahjong room settings", async () => {
  calls.length = 0;
  await createScoreRoom("access-token", {
    name: "麻将",
    gameType: "mahjong",
    password: "1234",
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/score-rooms$/);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].header.Authorization, "Bearer access-token");
  assert.deepEqual(calls[0].data, {
    name: "麻将",
    gameType: "mahjong",
    password: "1234",
  });
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
  calls.length = 0;
  await joinScoreRoom({ code: "123456", password: "2468", displayName: "游客" });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/score-rooms\/join$/);
  assert.equal(calls[0].header.Authorization, undefined);
  assert.equal(calls[0].data.password, "2468");
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
