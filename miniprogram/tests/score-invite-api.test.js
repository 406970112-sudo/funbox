const test = require("node:test");
const assert = require("node:assert/strict");

const calls = [];
global.wx = {
  getStorageSync() {
    return "";
  },
  request(options) {
    calls.push(options);
    options.success({ statusCode: 200, data: { room: { id: "room-1" }, imageBase64: "png", width: 430 } });
  },
};

const { issueScoreInviteCode, previewScoreInviteScene } = require("../utils/score-api");

test("mini program invite APIs send scene credentials and host authentication", async () => {
  calls.length = 0;
  await previewScoreInviteScene("scene-1");
  assert.equal(calls[0].url.endsWith("/score-rooms/invite-preview"), true);
  assert.deepEqual(calls[0].data, { inviteScene: "scene-1" });

  await issueScoreInviteCode({ token: "host-token" }, "room-1");
  assert.equal(calls[1].url.endsWith("/score-rooms/room-1/invite-code"), true);
  assert.equal(calls[1].header.Authorization, "Bearer host-token");
});
