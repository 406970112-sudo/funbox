const test = require("node:test");
const assert = require("node:assert/strict");

let accessToken = "";
let currentUser = null;
let currentUserError = null;
let clearedSessions = 0;
let syncedAuth = 0;
const navigations = [];

const authPath = require.resolve("../utils/auth");
require.cache[authPath] = {
  id: authPath,
  filename: authPath,
  loaded: true,
  exports: {
    clearSession() {
      clearedSessions += 1;
      accessToken = "";
    },
    getAccessToken() {
      return accessToken;
    },
    getCurrentUser: async () => {
      if (currentUserError) throw currentUserError;
      return currentUser;
    },
    getStoredUser: () => currentUser,
  },
};

global.getApp = () => ({
  syncAuthState() {
    syncedAuth += 1;
  },
});
global.wx = {
  navigateTo(options) {
    navigations.push(options);
  },
  stopPullDownRefresh() {},
  switchTab() {},
};

let pageDefinition;
global.Page = (definition) => {
  pageDefinition = definition;
};
require("../pages/profile/index");

function createPage() {
  return {
    ...pageDefinition,
    data: { ...pageDefinition.data },
    setData(patch, callback) {
      this.data = { ...this.data, ...patch };
      if (callback) callback();
    },
  };
}

test("profile page shows login and register entries for a guest", async () => {
  accessToken = "";
  const page = createPage();
  await page.loadProfile();
  assert.equal(page.data.isLoggedIn, false);
  assert.equal(page.data.displayName, "游客");
});

test("profile page loads current user details and opens the history entrance", async () => {
  accessToken = "account-token";
  currentUserError = null;
  currentUser = {
    id: "user-1",
    username: "13800138000",
    displayName: "小李",
    avatarUrl: "/avatars/user.png",
    createdAt: "2026-10-01T00:00:00Z",
  };
  navigations.length = 0;
  const page = createPage();
  await page.loadProfile();

  assert.equal(page.data.isLoggedIn, true);
  assert.equal(page.data.displayName, "小李");
  assert.equal(page.data.maskedUsername, "138****8000");
  assert.ok(syncedAuth >= 1);

  page.openHistory();
  assert.equal(navigations.length, 1);
  assert.equal(navigations[0].url, "/pages/game-history/index");
});

test("expired profile sessions clear local state", async () => {
  accessToken = "expired-token";
  currentUserError = Object.assign(new Error("unauthorized"), { statusCode: 401 });
  clearedSessions = 0;
  const page = createPage();
  await page.loadProfile();

  assert.equal(clearedSessions, 1);
  assert.equal(page.data.isLoggedIn, false);
  assert.equal(page.data.displayName, "游客");
});

test("identity card opens account settings only for signed-in users", () => {
  const page = createPage();
  navigations.length = 0;
  accessToken = "account-token";
  page.openSettings();
  assert.equal(navigations[0].url, "/pages/profile-settings/index");

  accessToken = "";
  page.openSettings();
  assert.equal(navigations[1].url, "/pages/auth/index?mode=login");
});
