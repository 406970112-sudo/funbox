const test = require("node:test");
const assert = require("node:assert/strict");

let definition;
global.Page = (page) => { definition = page; };
global.wx = { getStorageSync: () => "" };
require("../pages/score/room/index");

function createPage() {
  return {
    ...definition,
    pageActive: true,
    credential: { kind: "account", token: "host-token" },
    data: { ...definition.data, roomId: "room-1", room: { id: "room-1" }, realtimeStatus: "online" },
    setData(patch) { Object.assign(this.data, patch); },
  };
}

test("hiding a room releases realtime and polling, and showing it reconnects", (t) => {
  const page = createPage();
  let closed = 0;
  let refreshed = 0;
  let started = 0;
  let polled = 0;
  const cleared = [];
  page.realtimeClose = () => { closed += 1; };
  page.pollTimer = 123;
  t.mock.method(global, "clearInterval", (timer) => cleared.push(timer));
  assert.equal(typeof page.onHide, "function");
  page.onHide();
  assert.equal(closed, 1);
  assert.deepEqual(cleared, [123]);
  assert.equal(page.pollTimer, null);
  assert.equal(page.realtimeClose, null);

  page.startRealtime = () => { started += 1; };
  page.startPolling = () => { polled += 1; };
  page.refreshRoom = () => { refreshed += 1; };
  page.onShow();
  assert.equal(started, 1);
  assert.equal(polled, 1);
  assert.equal(refreshed, 1);
});

test("late room responses cannot start connections or polling while hidden", (t) => {
  const page = createPage();
  t.after(() => page.onUnload());
  page.pageVisible = false;
  let timers = 0;
  t.mock.method(global, "setInterval", () => { timers += 1; });
  page.startRealtime();
  page.startPolling();
  assert.equal(page.realtimeClose, undefined);
  assert.equal(timers, 0);
});

test("the offline badge explains the failure and can restart synchronization", async (t) => {
  const page = createPage();
  page.data.realtimeStatus = "offline";
  page.data.realtimeError = "connection rejected";
  const actions = [];
  page.stopRealtime = () => actions.push("stop");
  page.startRealtime = () => actions.push("start");
  page.refreshRoom = () => actions.push("refresh");
  global.wx.showModal = (options) => {
    assert.match(options.content, /connection rejected/);
    options.success({ confirm: true });
  };
  assert.equal(typeof page.retryRealtime, "function");
  await page.retryRealtime();
  assert.deepEqual(actions, ["stop", "start", "refresh"]);
});
