const test = require("node:test");
const assert = require("node:assert/strict");
const { API_BASE_URL } = require("../config/index");

const storage = {};
const requests = [];
const uploads = [];
const navigations = [];
const toasts = [];
let responseUser;
let requestError;
let uploadError;
let mediaResult;
let mediaError;
let confirmLogout;
let syncedAuth;

global.wx = {
  getStorageSync: (key) => storage[key],
  setStorageSync: (key, value) => { storage[key] = value; },
  removeStorageSync: (key) => { delete storage[key]; },
  request(options) {
    requests.push(options);
    options.success(requestError || { statusCode: 200, data: { user: responseUser } });
  },
  uploadFile(options) {
    uploads.push(options);
    options.success(uploadError || { statusCode: 200, data: JSON.stringify({ user: responseUser }) });
  },
  chooseMedia(options) {
    if (mediaError) options.fail(mediaError);
    else options.success(mediaResult);
  },
  showModal(options) {
    options.success({ confirm: confirmLogout });
    if (options.complete) options.complete();
  },
  showToast(options) { toasts.push(options); },
  redirectTo(options) { navigations.push(options); },
  switchTab(options) { navigations.push(options); },
};
global.getApp = () => ({ syncAuthState() { syncedAuth += 1; } });
const { getStoredUser, saveSession, updateDisplayName } = require("../utils/auth");
let definition;
global.Page = (page) => { definition = page; };
require("../pages/profile-settings/index");

function createPage() {
  return {
    ...definition,
    data: { ...definition.data },
    setData(patch) { this.data = { ...this.data, ...patch }; },
  };
}

test.beforeEach(() => {
  responseUser = { id: "u1", username: "13800138000", displayName: "牌友", avatarUrl: "/avatars/old.png" };
  saveSession({ accessToken: "account-token", user: responseUser });
  requests.length = uploads.length = navigations.length = toasts.length = 0;
  requestError = uploadError = mediaError = null;
  mediaResult = { tempFiles: [{ tempFilePath: "wxfile://avatar.png", size: 1024 }] };
  confirmLogout = true;
  syncedAuth = 0;
});

test("settings loads the current account with an absolute avatar URL", async () => {
  const page = createPage();
  await page.loadProfile();
  assert.equal(page.data.displayName, "牌友");
  assert.equal(page.data.avatarUrl, API_BASE_URL.replace(/\/api\/v1\/?$/, "") + "/avatars/old.png");
  assert.equal(requests[0].header.Authorization, "Bearer account-token");
});

test("saving a nickname trims it and updates persistent account state", async () => {
  const page = createPage();
  await page.loadProfile();
  page.handleNameInput({ detail: { value: "  新牌友  " } });
  responseUser = { ...responseUser, displayName: "新牌友" };
  await page.saveName();
  assert.equal(requests.at(-1).method, "PATCH");
  assert.equal(requests.at(-1).url, API_BASE_URL + "/users/me");
  assert.deepEqual(requests.at(-1).data, { displayName: "新牌友" });
  assert.equal(getStoredUser().displayName, "新牌友");
  assert.equal(page.data.displayName, "新牌友");
  assert.equal(page.data.saving, false);
  assert.ok(syncedAuth > 0);
});

test("invalid names do not reach the server and failed saves retain the draft", async () => {
  const page = createPage();
  for (const value of ["   ", "a".repeat(33)]) {
    page.handleNameInput({ detail: { value } });
    await page.saveName();
    assert.ok(page.data.errorMessage);
  }
  assert.equal(requests.length, 0);
  page.handleNameInput({ detail: { value: "待保存" } });
  requestError = { statusCode: 500, data: { error: "server_error" } };
  await page.saveName();
  assert.equal(page.data.displayName, "待保存");
  assert.equal(getStoredUser().displayName, "牌友");
  assert.equal(page.data.saving, false);
  assert.ok(page.data.errorMessage);
});

test("avatar uploads persist remotely while preserving an unsaved nickname", async () => {
  const page = createPage();
  await page.loadProfile();
  page.handleNameInput({ detail: { value: "未保存的昵称" } });
  responseUser = { ...responseUser, avatarUrl: "/avatars/new.png" };
  await page.chooseAvatar();
  assert.equal(uploads[0].url, API_BASE_URL + "/users/me/avatar");
  assert.equal(uploads[0].name, "avatar");
  assert.equal(uploads[0].filePath, "wxfile://avatar.png");
  assert.equal(uploads[0].header.Authorization, "Bearer account-token");
  assert.equal(getStoredUser().avatarUrl, "/avatars/new.png");
  assert.equal(page.data.displayName, "未保存的昵称");
  assert.equal(page.data.uploading, false);
});

test("oversized and failed avatars keep the previous avatar", async () => {
  const page = createPage();
  await page.loadProfile();
  const previousAvatar = page.data.avatarUrl;
  mediaResult.tempFiles[0].size = 3 * 1024 * 1024 + 1;
  await page.chooseAvatar();
  assert.equal(uploads.length, 0);
  assert.ok(page.data.errorMessage);
  mediaResult.tempFiles[0].size = 1024;
  uploadError = { statusCode: 415, data: JSON.stringify({ error: "avatar_type_invalid" }) };
  await page.chooseAvatar();
  assert.equal(page.data.avatarUrl, previousAvatar);
  assert.match(page.data.errorMessage, /JPG|PNG/);
  assert.equal(page.data.uploading, false);
});

test("canceling avatar selection leaves the form unchanged", async () => {
  const page = createPage();
  mediaError = { errMsg: "chooseMedia:fail cancel" };
  await page.chooseAvatar();
  assert.equal(uploads.length, 0);
  assert.equal(page.data.errorMessage, "");
  assert.equal(page.data.uploading, false);
});

test("expired sessions clear credentials and route back through login", async () => {
  const page = createPage();
  requestError = { statusCode: 401, data: { error: "unauthorized" } };
  await page.loadProfile();
  assert.equal(storage.accessToken, undefined);
  assert.equal(storage.funboxUser, undefined);
  assert.equal(navigations[0].url, "/pages/auth/index?mode=login&returnTo=%2Fpages%2Fprofile-settings%2Findex");
});

test("logout cancellation preserves the account; confirmation clears and returns to mine", () => {
  const page = createPage();
  confirmLogout = false;
  page.logout();
  assert.equal(storage.accessToken, "account-token");
  assert.equal(navigations.length, 0);
  confirmLogout = true;
  page.logout();
  assert.equal(storage.accessToken, undefined);
  assert.equal(storage.funboxUser, undefined);
  assert.equal(navigations[0].url, "/pages/profile/index");
  assert.ok(syncedAuth > 0);
});

test("late profile writes cannot restore a logged-out account", async () => {
  let finish;
  const originalRequest = wx.request;
  wx.request = (options) => { finish = options.success; };
  try {
    const pending = updateDisplayName("晚到的昵称");
    createPage().logout();
    finish({ statusCode: 200, data: { user: { ...responseUser, displayName: "晚到的昵称" } } });
    await pending;
    assert.equal(storage.funboxUser, undefined);
    assert.equal(storage.accessToken, undefined);
  } finally {
    wx.request = originalRequest;
  }
});

test("an expired response from an old session cannot log out a newer account", async () => {
  const originalRequest = wx.request;
  let finish;
  wx.request = (options) => { finish = options.success; };
  try {
    const page = createPage();
    const loading = page.loadProfile();
    saveSession({ accessToken: "new-account-token", user: { id: "u2", displayName: "新账号" } });
    finish({ statusCode: 401, data: { error: "unauthorized" } });
    await loading;
    assert.equal(storage.accessToken, "new-account-token");
    assert.equal(getStoredUser().id, "u2");
    assert.equal(navigations.length, 0);
  } finally {
    wx.request = originalRequest;
  }
});

test("leaving settings ignores late authentication errors and navigation", async () => {
  const originalRequest = wx.request;
  let finish;
  wx.request = (options) => { finish = options.success; };
  try {
    const page = createPage();
    const loading = page.loadProfile();
    page.onUnload();
    finish({ statusCode: 401, data: { error: "unauthorized" } });
    await loading;
    assert.equal(navigations.length, 0);
    assert.equal(storage.accessToken, "account-token");
  } finally {
    wx.request = originalRequest;
  }
});
