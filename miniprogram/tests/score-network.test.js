const test = require("node:test");
const assert = require("node:assert/strict");

const storage = {};
global.wx = {
  getStorageSync: (key) => storage[key] || "",
  removeStorageSync: (key) => { delete storage[key]; },
};

const {
  getScoreErrorMessage,
  getScoreRoom,
  joinScoreRoom,
  previewScoreInvite,
  previewScoreInviteScene,
} = require("../utils/score-api");

let roomPage;
global.Page = (definition) => { roomPage = definition; };
require("../pages/score/room/index");

function createRoomPage(data = {}) {
  return {
    ...roomPage,
    data: { ...roomPage.data, ...data },
    setData(patch) { Object.assign(this.data, patch); },
    startRealtime() {},
    startPolling() {},
  };
}

test("invitation previews and room reads recover from a transient timeout", async () => {
  for (const load of [
    () => previewScoreInvite("invite-token"),
    () => previewScoreInviteScene("scene-1"),
    () => getScoreRoom({ token: "guest-token" }, "room-1"),
  ]) {
    const calls = [];
    global.wx.request = (options) => {
      calls.push(options);
      if (calls.length === 1) options.fail({ errMsg: "request:fail fail:time out" });
      else options.success({ statusCode: 200, data: { room: { id: "room-1" } } });
    };
    const result = await load();
    assert.equal((result.room || result).id, "room-1");
    assert.equal(calls.length, 2);
    assert.equal(calls[1].url, calls[0].url);
    assert.deepEqual(calls[1].data, calls[0].data);
    assert.deepEqual(calls[1].header, calls[0].header);
  }
});

test("persistent transport failures stop retrying and expose an actionable message", async () => {
  for (const errMsg of ["request:fail timeout", "request:fail fail:time out", "request:fail err_connection_reset"]) {
    let calls = 0;
    global.wx.request = (options) => {
      calls += 1;
      options.fail({ errMsg });
    };
    await assert.rejects(previewScoreInviteScene("scene-1"), (error) => {
      assert.equal(error.isNetworkError, true);
      assert.match(getScoreErrorMessage(error), /网络|超时/);
      assert.doesNotMatch(getScoreErrorMessage(error), /request:fail/);
      return true;
    });
    assert.equal(calls, 2);
  }
});

test("business failures are returned immediately without transport retries", async () => {
  let calls = 0;
  global.wx.request = (options) => {
    calls += 1;
    options.success({ statusCode: 409, data: { error: "score_room_full" } });
  };
  await assert.rejects(previewScoreInvite("invite-token"), (error) => error.scoreCode === "score_room_full");
  assert.equal(calls, 1);
});

test("a timed-out join is never automatically submitted a second time", async () => {
  let calls = 0;
  global.wx.request = (options) => {
    calls += 1;
    options.fail({ errMsg: "request:fail timeout" });
  };
  await assert.rejects(joinScoreRoom({ inviteToken: "invite-token", displayName: "Guest" }));
  assert.equal(calls, 1);
});

test("an expired account still falls back to guest after preview timeout recovery", async () => {
  storage.accessToken = "expired-token";
  const calls = [];
  global.wx.request = (options) => {
    calls.push(options);
    if (calls.length === 1) options.fail({ errMsg: "request:fail timeout" });
    else if (options.header.Authorization) options.success({ statusCode: 401, data: { error: "unauthorized" } });
    else options.success({ statusCode: 200, data: { room: { id: "room-1" } } });
  };
  const result = await previewScoreInvite("invite-token");
  assert.equal(result.room.id, "room-1");
  assert.equal(calls.length, 3);
  assert.equal(calls[0].header.Authorization, "Bearer expired-token");
  assert.equal(calls[1].header.Authorization, "Bearer expired-token");
  assert.equal(calls[2].header.Authorization, undefined);
  assert.equal(storage.accessToken, undefined);
});

test("a failed invitation can reload in place and keeps the original scene", async () => {
  const calls = [];
  global.wx.request = (options) => {
    calls.push(options);
    if (calls.length <= 2) options.fail({ errMsg: "request:fail fail:time out" });
    else options.success({ statusCode: 200, data: { room: { id: "room-1", name: "Game", maxPlayers: 4 } } });
  };
  const page = createRoomPage();
  await page.prepareInviteScene("scene-1");
  assert.equal(page.data.loading, false);
  assert.equal(page.data.canRetryLoad, true);
  assert.match(page.data.errorMessage, /超时/);

  const retry = page.retryOpenRoom();
  await page.retryOpenRoom();
  await retry;

  assert.equal(calls.length, 3);
  assert.deepEqual(calls[2].data, { inviteScene: "scene-1" });
  assert.equal(page.data.previewRoom.id, "room-1");
  assert.equal(page.data.joinNeeded, true);
  assert.equal(page.data.loading, false);
  assert.equal(page.data.errorMessage, "");
  assert.equal(page.data.canRetryLoad, false);
});

test("failed room loading preserves guest identity and reloads the existing seat", async () => {
  const snapshot = {
    id: "room-1", version: 3, status: "waiting", maxPlayers: 4,
    selfParticipantId: "guest-1",
    participants: [{ id: "guest-1", role: "guest", status: "active", totalPoints: 0 }],
  };
  const calls = [];
  global.wx.request = (options) => {
    calls.push(options);
    if (calls.length <= 2) options.fail({ errMsg: "request:fail timeout" });
    else options.success({ statusCode: 200, data: { room: snapshot } });
  };
  const page = createRoomPage({ roomId: "room-1" });
  page.credential = { kind: "guest", token: "guest-token" };

  await page.loadRoom();
  assert.equal(page.data.canRetryLoad, true);
  assert.equal(page.data.loading, false);
  assert.equal(page.credential.token, "guest-token");

  await page.retryOpenRoom();

  assert.equal(page.data.room.id, "room-1");
  assert.equal(page.data.self.id, "guest-1");
  assert.equal(page.data.errorMessage, "");
  assert.equal(page.data.canRetryLoad, false);
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.method === "GET" && call.header.Authorization === "Bearer guest-token"));
});
