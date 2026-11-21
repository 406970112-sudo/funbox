const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SCENE = "h_abcdefghijklmnopqrstuv";
const OTHER_SCENE = "h_vutsrqponmlkjihgfedcba";

function loadPage(filename, context) {
  let definition;
  vm.runInNewContext(readFileSync(path.join(__dirname, "../pages/score", filename), "utf8"), {
    Page: (page) => { definition = page; },
    ...context,
  });
  return {
    ...definition,
    setData(patch) { Object.assign(this.data, patch); },
  };
}

function projection(overrides = {}) {
  return {
    roomId: "room/mahjong",
    roomCode: "810213",
    roomName: "老友局",
    fromName: "A",
    seat: 1,
    points: -30,
    expiresAt: new Date(Date.now() + 300000).toISOString(),
    status: "open",
    claimToken: "private-claim",
    guestToken: "",
    participantId: "",
    ...overrides,
  };
}

function harness({ preview, accept, session, storage = new Map(), now = Date.now() }) {
  const redirects = [];
  const timers = new Map();
  let timerCount = 0;
  const wx = {
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key),
    redirectTo(request) {
      redirects.push(request.url);
      if (request.success) request.success();
    },
  };
  const sessionPath = require.resolve("../utils/score-session");
  const oldWx = global.wx;
  function withWx(fn) {
    global.wx = wx;
    try { return fn(); } finally { global.wx = oldWx; }
  }
  const scoreSession = require(sessionPath);
  if (session) withWx(() => scoreSession.saveScoreSession(session));
  const modules = {
    "score-api": {
      previewMahjongHandover: preview,
      acceptMahjongHandover: accept,
      getScoreErrorMessage: (error) => error.message,
    },
    "score-session": {
      getScoreSession: () => withWx(scoreSession.getScoreSession),
      saveScoreSession: (value) => withWx(() => scoreSession.saveScoreSession(value)),
    },
    auth: { getStoredUser: () => null },
    invite: require("../utils/invite"),
    "score-format": require("../utils/score-format"),
  };
  const page = loadPage("mahjong-handover/index.js", {
    require: (id) => modules[path.basename(id)],
    wx,
    Date: class extends Date { static now() { return now; } },
    setTimeout(callback, delay) {
      const id = ++timerCount;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  });
  return {
    page,
    redirects,
    storage,
    get session() { return withWx(scoreSession.getScoreSession); },
    timers,
    async poll() {
      const [id, { callback }] = timers.entries().next().value;
      timers.delete(id);
      await callback();
    },
  };
}

async function open(page, scene = SCENE) {
  page.onLoad({ scene });
  await page.onShow();
}

function name(page, value = " E ") {
  page.handleNameInput({ detail: { value } });
}

test("room entry routes handover scenes and delegates ordinary invites with the same prefix", () => {
  const redirects = [];
  const loaded = [];
  const page = loadPage("room/index.js", {
    require: (id) => id.endsWith("/invite") ? require("../utils/invite") : {
      onLoad(options) { loaded.push(options); },
      onShow() {},
      onHide() {},
      onUnload() {},
    },
    wx: { redirectTo: ({ url }) => redirects.push(url) },
  });
  const ordinary = [{ scene: "scene%2Bone" }, { scene: "h_abcdefghijklmnopqrst" }, { invite: "a.b.c" }, { roomId: "mahjong", joined: "1" }];
  for (const options of ordinary) {
    page.onLoad(options);
  }
  page.onLoad({ scene: "h%5Fabcdefghijklmnopqrstuv" });
  assert.deepEqual(loaded, ordinary);
  assert.deepEqual(redirects, ["/pages/score/mahjong-handover/index?scene=h_abcdefghijklmnopqrstuv"]);
  assert.equal(require("../app.json").pages.includes("pages/score/mahjong-handover/index"), true);
});

test("explicit confirmation uses the displayed points and waits for verified completion before saving the guest", async () => {
  let previewCount = 0;
  const requests = [];
  const ui = harness({
    session: { roomId: "room/mahjong", guestToken: "existing-guest", participantId: "existing-member" },
    preview: async (scene, claimToken) => {
      assert.equal(scene, SCENE);
      if (previewCount++ === 0) {
        assert.equal(claimToken, "");
        return projection();
      }
      assert.equal(claimToken, "private-claim");
      return projection({ status: "completed", guestToken: "verified-guest", participantId: "new-member" });
    },
    accept: async (request) => {
      requests.push({ ...request });
      return projection({ status: "accepted" });
    },
  });
  await open(ui.page);
  assert.equal(ui.page.data.invite.scoreText, "-30");
  assert.equal(JSON.stringify(ui.page.data).includes("private-claim"), false);
  await ui.page.acceptInvitation();
  assert.equal(requests.length, 0);
  name(ui.page);
  await ui.page.acceptInvitation();
  assert.deepEqual(requests, [{
    scene: SCENE, claimToken: "private-claim", displayName: "E", points: -30, participantToken: "existing-guest",
  }]);
  assert.equal(ui.page.data.status, "accepted");
  assert.equal(ui.session.guestToken, "existing-guest");
  assert.deepEqual(ui.redirects, []);
  await ui.poll();
  assert.equal(requests.length, 1);
  assert.equal(ui.session.guestToken, "verified-guest");
  assert.equal(ui.session.participantId, "new-member");
  assert.equal(ui.session.roomId, "room/mahjong");
  assert.deepEqual(ui.redirects, ["/pages/score/room/index?roomId=room%2Fmahjong&joined=1"]);
});

test("score-changed and timeout responses refetch before another explicit confirmation", async () => {
  let status = "open";
  let points = 0;
  const requests = [];
  const ui = harness({
    session: { roomId: "unrelated-room", guestToken: "unrelated-guest" },
    preview: async () => projection({ status, points }),
    accept: async (request) => {
      requests.push({ ...request });
      if (request.points === 0) {
        points = 5;
        throw Object.assign(new Error("分数变动"), { scoreCode: "score_handover_score_changed" });
      }
      status = "accepted";
      throw Object.assign(new Error("超时"), { isNetworkError: true, scoreCode: "request_timeout" });
    },
  });
  await open(ui.page);
  name(ui.page);
  await ui.page.acceptInvitation();
  assert.equal(ui.page.data.invite.scoreText, "+5");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].points, 0);
  assert.equal("participantToken" in requests[0], false);
  assert.equal(ui.timers.size, 0);
  await ui.page.acceptInvitation();
  assert.deepEqual(requests.map((request) => request.points), [0, 5]);
  assert.equal(ui.page.data.status, "accepted");
  assert.equal(ui.session.guestToken, "unrelated-guest");
  assert.equal(ui.timers.size, 1);
});

test("pending claims survive reload without being reused for another scene", async () => {
  const first = harness({
    preview: async () => projection(),
    accept: async () => projection({ status: "accepted" }),
  });
  await open(first.page);
  name(first.page);
  await first.page.acceptInvitation();
  first.page.onHide();
  assert.equal(first.timers.size, 0);
  const other = harness({
    storage: first.storage,
    preview: async (scene, claimToken) => {
      assert.equal(scene, OTHER_SCENE);
      assert.equal(claimToken, "");
      return projection({ claimToken: "other-claim" });
    },
  });
  await open(other.page, OTHER_SCENE);
  const reloaded = harness({
    storage: first.storage,
    preview: async (scene, claimToken) => {
      assert.equal(scene, SCENE);
      assert.equal(claimToken, "private-claim");
      return projection({ status: "reconfirm", points: -22 });
    },
  });
  await open(reloaded.page);
  assert.equal(reloaded.page.data.status, "reconfirm");
  assert.equal(reloaded.page.data.invite.scoreText, "-22");
  assert.equal(reloaded.timers.size, 0);
  assert.deepEqual(reloaded.redirects, []);
});

test("a confirmed claimant can recover their seat after the public invite expires", async () => {
  const now = Date.now();
  const waiting = projection({
    status: "accepted",
    expiresAt: new Date(now + 5 * 60 * 1000).toISOString(),
    credentialExpiresAt: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
  });
  const first = harness({ now, preview: async () => waiting });
  await open(first.page);
  first.page.onUnload();
  const resumed = harness({
    storage: first.storage,
    now: now + 30 * 60 * 1000,
    preview: async (_scene, claimToken) => {
      if (claimToken !== waiting.claimToken) return projection({ status: "expired" });
      return projection({ status: "completed", guestToken: "verified-guest", participantId: "member" });
    },
  });
  await open(resumed.page);
  assert.equal(resumed.session?.guestToken, "verified-guest");
});

test("a poll that finishes after hiding cannot save credentials or redirect", async () => {
  let release;
  let previewCount = 0;
  const completion = projection({ status: "completed", guestToken: "verified-guest", participantId: "member" });
  const ui = harness({
    preview: async () => {
      previewCount += 1;
      if (previewCount === 1) return projection({ status: "accepted" });
      if (previewCount === 2) return new Promise((resolve) => { release = resolve; });
      return completion;
    },
  });
  await open(ui.page);
  const poll = ui.poll();
  ui.page.onHide();
  release(completion);
  await poll;
  assert.equal(ui.session, null);
  assert.deepEqual(ui.redirects, []);
  assert.equal(ui.timers.size, 0);
  await ui.page.onShow();
  assert.equal(ui.session.guestToken, "verified-guest");
});

test("losing a race to claim moves the confirmation page to its terminal status", async () => {
  let previewCount = 0;
  let attempts = 0;
  const ui = harness({
    preview: async () => previewCount++ === 0 ? projection() : projection({ status: "claimed", claimToken: "" }),
    accept: async () => {
      attempts += 1;
      throw Object.assign(new Error("已有其他牌友确认"), { scoreCode: "score_handover_claimed" });
    },
  });
  await open(ui.page);
  name(ui.page);
  await ui.page.acceptInvitation();
  assert.equal(ui.page.data.status, "claimed");
  await ui.page.acceptInvitation();
  assert.equal(attempts, 1);
  assert.equal(ui.session, null);
  assert.deepEqual(ui.redirects, []);
});

test("waiting honors server retry-after without re-submitting the confirmation", async () => {
  let previewCount = 0;
  const ui = harness({
    preview: async () => {
      if (previewCount++ === 0) return projection({ status: "accepted" });
      throw Object.assign(new Error("操作太频繁"), {
        scoreCode: "rate_limited",
        response: { data: { retryAfterSeconds: 12 } },
      });
    },
    accept: async () => assert.fail("polling must only read the invitation"),
  });
  await open(ui.page);
  await ui.poll();
  assert.equal(ui.page.data.status, "accepted");
  assert.equal(ui.timers.values().next().value.delay, 12000);
});
