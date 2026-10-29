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
