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
const lottery = (changes = {}) => ({ ...notebook({ id: "lottery", visiblePlacements: ["home", "discover", "recent"] }), ...changes });

test("home and discover render the lottery tile only when it has a visible status", () => {
  for (const page of ["pages/index", "pages/discover", "packages/discover/index"]) {
    const template = fs.readFileSync(path.resolve(__dirname, "..", page, "index.wxml"), "utf8");
    assert.match(template, /wx:if="\{\{\(?featureEntries\.lottery && featureEntries\.lottery !== 'hidden'\)?\}\}"/);
    assert.match(template, /<template is="discover-lottery"\s*\/>/);
  }
});

test("guests do not see a cached lottery entry before the public settings confirm it", async t => {
  const { watchFeatureEntries, requests, storage } = setup(t);
  storage["funbox.feature-entries.v1"] = [lottery()];
  const placements = ["home", "discover", "recent"];
  const current = {};
  for (const place of placements) watchFeatureEntries(place, entries => { current[place] = entries.lottery; });
  assert.deepEqual(current, { home: "hidden", discover: "hidden", recent: "hidden" });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].header.Authorization, undefined);
  respond(requests[0], [lottery({ enabled: false })]);
  await nextTick();
  assert.deepEqual(current, { home: "hidden", discover: "hidden", recent: "hidden" });
});

test("a guest can see a public entry from a text JSON response, but a failed refresh hides it", async t => {
  const { watchFeatureEntries, requests } = setup(t);
  const updates = [];
  watchFeatureEntries("home", entries => updates.push(entries.lottery));
  requests[0].success({ statusCode: 200, data: JSON.stringify({ features: [lottery()], viewerRole: "" }) });
  await nextTick();
  assert.deepEqual(updates, ["hidden", "visible"]);

  watchFeatureEntries("home", entries => updates.push(entries.lottery));
  requests[1].fail({ errMsg: "network down" });
  await nextTick();
  assert.equal(updates.at(-1), "hidden");
});

test("a login-only entry appears after login and disappears again after logout", async t => {
  const { watchFeatureEntries, watchFeatureAccess, requests, storage } = setup(t);
  const settings = [lottery({ audience: "signed_in" })];
  const entries = [];
  const access = [];
  const watch = () => {
    watchFeatureEntries("discover", result => entries.push(result.lottery));
    watchFeatureAccess("lottery", result => access.push(result));
  };
  watch();
  respond(requests.at(-1), settings);
  await nextTick();
  assert.equal(entries.at(-1), "hidden");
  assert.equal(access.at(-1), "restricted");

  storage[ACCESS_TOKEN_STORAGE_KEY] = "account-token";
  watch();
  respond(requests.at(-1), settings, "normal");
  await nextTick();
  assert.equal(entries.at(-1), "visible");
  assert.equal(access.at(-1), "available");

  delete storage[ACCESS_TOKEN_STORAGE_KEY];
  watch();
  assert.equal(entries.at(-1), "hidden");
  respond(requests.at(-1), settings);
  await nextTick();
  assert.equal(entries.at(-1), "hidden");
  assert.equal(access.at(-1), "restricted");
});

test("master and placement visibility are independent of access through an existing link", async t => {
  const { watchFeatureEntries, watchFeatureAccess, requests } = setup(t);
  const home = [];
  const recent = [];
  const access = [];
  watchFeatureEntries("home", entries => home.push(entries));
  watchFeatureEntries("recent", entries => recent.push(entries));
  watchFeatureAccess("notebook", status => access.push(status));
  assert.equal(home.at(-1).notebook, "hidden");
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
