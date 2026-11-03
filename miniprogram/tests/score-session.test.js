const test = require("node:test");
const assert = require("node:assert/strict");

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
};

const {
  clearHostRoomPassword,
  getHostRoomPassword,
  saveHostRoomPassword,
} = require("../utils/score-session");

test("host room passwords are scoped to one room and can be cleared", () => {
  saveHostRoomPassword("room-1", "2468");
  saveHostRoomPassword("room-2", "1357");

  assert.equal(getHostRoomPassword("room-1"), "2468");
  assert.equal(getHostRoomPassword("room-2"), "1357");

  clearHostRoomPassword("room-1");

  assert.equal(getHostRoomPassword("room-1"), "");
  assert.equal(getHostRoomPassword("room-2"), "1357");
});

const { saveRecentScoreRoom, getRecentScoreRoom, clearRecentScoreRoom, saveScoreSession, clearScoreSession } = require("../utils/score-session");
function resetStorage() { for (const key of Object.keys(storage)) delete storage[key]; }
const recentRoom = { id: "room-1", name: "Friday", gameType: "mahjong", status: "active", participants: [{ id: "private" }] };

test("recent account room survives token refresh and is isolated across logout and account switching", () => {
  resetStorage();
  storage.accessToken = "token-1";
  storage.funboxUser = { id: "user-1" };
  saveRecentScoreRoom(recentRoom, { kind: "account", token: "token-1" });
  assert.deepEqual(getRecentScoreRoom(), { roomId: "room-1", name: "Friday", gameType: "mahjong", status: "active", credentialKind: "account", userId: "user-1" });
  storage.accessToken = "refreshed";
  assert.equal(getRecentScoreRoom().roomId, "room-1");
  delete storage.accessToken;
  assert.equal(getRecentScoreRoom(), null);
  storage.accessToken = "token-2";
  storage.funboxUser = { id: "user-2" };
  assert.equal(getRecentScoreRoom(), null);
  storage.funboxUser = { id: "user-1" };
  assert.equal(getRecentScoreRoom().roomId, "room-1");
  saveRecentScoreRoom({ ...recentRoom, id: "stale-room" }, { kind: "account", token: "token-1" });
  assert.equal(getRecentScoreRoom().roomId, "room-1");
});

test("recent guest room recovers only with the matching cached session and never stores its token", () => {
  resetStorage();
  saveScoreSession({ roomId: "room-1", guestToken: "guest-secret", participantId: "p1" });
  saveRecentScoreRoom(recentRoom, { kind: "guest", token: "guest-secret" });
  assert.equal(getRecentScoreRoom().credentialKind, "guest");
  const recentEntry = Object.entries(storage).find(([key]) => key !== "funboxScoreSessionV1")[1];
  assert.equal(JSON.stringify(recentEntry).includes("guest-secret"), false);
  saveRecentScoreRoom({ ...recentRoom, id: "wrong" }, { kind: "guest", token: "other" });
  assert.equal(getRecentScoreRoom().roomId, "room-1");
  saveScoreSession({ roomId: "room-1", guestToken: "replacement", participantId: "p2" });
  assert.equal(getRecentScoreRoom(), null);
  saveScoreSession({ roomId: "room-2", guestToken: "another-room" });
  assert.equal(getRecentScoreRoom(), null);
  clearScoreSession();
  assert.equal(getRecentScoreRoom(), null);
});

test("recent room clearing respects room identity and terminal snapshots", () => {
  resetStorage();
  storage.accessToken = "token"; storage.funboxUser = { id: "user" };
  const credential = { kind: "account", token: "token" };
  saveRecentScoreRoom(recentRoom, credential);
  clearRecentScoreRoom("older");
  assert.equal(getRecentScoreRoom().roomId, "room-1");
  saveRecentScoreRoom({ ...recentRoom, id: "older", status: "settled" }, credential);
  assert.equal(getRecentScoreRoom().roomId, "room-1");
  for (const status of ["settled", "cancelled"]) {
    saveRecentScoreRoom(recentRoom, credential);
    saveRecentScoreRoom({ ...recentRoom, status }, credential);
    assert.equal(getRecentScoreRoom(), null);
  }
  saveRecentScoreRoom({ ...recentRoom, status: "waiting" }, credential);
  assert.equal(getRecentScoreRoom().status, "waiting");
  clearRecentScoreRoom("room-1");
  assert.equal(getRecentScoreRoom(), null);
});
