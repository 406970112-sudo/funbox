const test = require("node:test");
const assert = require("node:assert/strict");

const joinCalls = [];
const scoreAPI = require.resolve("../utils/score-api");
require.cache[scoreAPI] = {
  id: scoreAPI,
  filename: scoreAPI,
  loaded: true,
  exports: {
    joinScoreRoom: async (input) => {
      joinCalls.push(input);
      return {
        room: { id: "room-1" },
        guestToken: "guest-token",
        actor: { participantId: "participant-1" },
      };
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

test("giving above the cap stays submittable and keeps the hint", () => {
  const page = createPage({
    room: { capPoints: 10, centsPerPoint: 100 },
    recipients: [{ id: "participant-2", pointsInput: "" }],
  });

  page.handleGiftInput({
    currentTarget: { dataset: { id: "participant-2" } },
    detail: { value: "13" },
  });

  assert.equal(page.data.giftTotal, 13);
  assert.equal(page.data.overCap, true);
  assert.equal(page.data.canSubmitGifts, true);
  assert.equal(page.data.capRemainingText, "已超过封顶 3 分，仍可继续提交");
});
