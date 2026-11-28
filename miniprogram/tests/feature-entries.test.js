const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ACCESS_TOKEN_STORAGE_KEY } = require("../config/index");

function setup(t) {
  const storage = {};
  const requests = [];
  global.wx = {
    getStorageSync: key => storage[key],
    setStorageSync: (key, value) => { storage[key] = value; },
    request: options => requests.push(options),
  };
  t.after(() => { delete global.wx; });
  const modulePath = require.resolve("../utils/feature-entries");
  const freshUtility = () => {
    delete require.cache[modulePath];
    return require(modulePath);
  };
  return { ...freshUtility(), freshUtility, requests, storage };
}

const nextTick = () => new Promise(resolve => setImmediate(resolve));
const respond = (request, features, viewerRole = "") => {
  request.success({ statusCode: 200, data: { features, viewerRole } });
};
const notebook = (changes = {}) => ({
  id: "notebook", enabled: true, visiblePlacements: ["home", "discover", "profile", "recent"],
  audience: "all", maintenance: false, ...changes,
});

test("homepage registers the lottery tile as a controlled entry", () => {
  const template = fs.readFileSync(path.resolve(__dirname, "../pages/index/index.wxml"), "utf8");
  assert.match(template, /wx:if="\{\{featureEntries\.lottery !== 'hidden'\}\}" class="discover-pair discover-pair-single"/);
  assert.match(template, /<template is="discover-lottery"\s*\/>/);
});

test("master and placement visibility are independent of access through an existing link", async t => {
  const { watchFeatureEntries, watchFeatureAccess, requests } = setup(t);
  const home = [];
  const recent = [];
  const access = [];
  watchFeatureEntries("home", entries => home.push(entries));
  watchFeatureEntries("recent", entries => recent.push(entries));
  watchFeatureAccess("notebook", status => access.push(status));
  assert.equal(home.at(-1).notebook, "visible");
  assert.equal(home.at(-1).website, "hidden");
  assert.equal(requests.length, 1);
  respond(requests[0], [notebook({ visiblePlacements: ["recent"] })]);
  await nextTick();
  assert.equal(home.at(-1).notebook, "hidden");
  assert.equal(recent.at(-1).notebook, "visible");
  assert.equal(access.at(-1), "available");

  watchFeatureEntries("recent", entries => recent.push(entries));
  respond(requests.at(-1), [notebook({ enabled: false, visiblePlacements: ["recent"] })]);
  await nextTick();
  assert.equal(recent.at(-1).notebook, "hidden");
});

test("failed refreshes use the last good public configuration and maintenance has its own state", async t => {
  const { watchFeatureEntries, watchFeatureAccess, freshUtility, requests } = setup(t);
  const updates = [];
  watchFeatureEntries("profile", entries => updates.push(entries));
  respond(requests[0], [notebook({ maintenance: true })]);
  await nextTick();
  assert.equal(updates.at(-1).notebook, "maintenance");

  const reloaded = freshUtility();
  const status = [];
  reloaded.watchFeatureAccess("notebook", (value, source) => status.push([value, source]));
  assert.deepEqual(status.at(-1), ["maintenance", "cached"]);
  requests.at(-1).fail({ errMsg: "network down" });
  await nextTick();
  assert.deepEqual(status.at(-1), ["maintenance", "failed"]);
  assert.equal(typeof watchFeatureAccess, "function");
});

test("an old account response cannot overwrite a new account audience", async t => {
  const { watchFeatureEntries, requests, storage } = setup(t);
  const first = [];
  const second = [];
  storage[ACCESS_TOKEN_STORAGE_KEY] = "first-token";
  storage.funboxUser = { id: "first", role: "svip" };
  watchFeatureEntries("discover", entries => first.push(entries));
  assert.equal(requests[0].header.Authorization, "Bearer first-token");

  storage[ACCESS_TOKEN_STORAGE_KEY] = "second-token";
  storage.funboxUser = { id: "second", role: "normal" };
  watchFeatureEntries("discover", entries => second.push(entries));
  respond(requests[1], [notebook({ audience: "vip" })], "normal");
  await nextTick();
  assert.equal(second.at(-1).notebook, "hidden");

  respond(requests[0], [notebook({ audience: "all" })], "svip");
  await nextTick();
  assert.equal(first.length, 1);

  watchFeatureEntries("discover", entries => second.push(entries));
  assert.equal(second.at(-1).notebook, "hidden");
  respond(requests[2], [notebook({ audience: "vip" })], "admin");
  await nextTick();
  assert.equal(second.at(-1).notebook, "hidden", "the web admin role does not grant member-only feature access");

  watchFeatureEntries("discover", entries => second.push(entries));
  respond(requests[3], [notebook({ audience: "vip" })], "svip");
  await nextTick();
  assert.equal(second.at(-1).notebook, "visible");
});
