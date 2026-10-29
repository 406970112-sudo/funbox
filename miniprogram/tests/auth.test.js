const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const storage = {};
const calls = [];
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
  request(options) {
    calls.push(options);
    options.success({
      statusCode: 201,
      data: {
        accessToken: "token-1",
        user: { id: "user-1", displayName: "牌友" },
      },
    });
  },
};

const {
  getAccessToken,
  getAuthErrorMessage,
  getCurrentUser,
  getStoredUser,
  login,
  register,
} = require("../utils/auth");

let authPageDefinition;
global.Page = (definition) => {
  authPageDefinition = definition;
};
require("../pages/auth/index");

function createAuthPage(data) {
  return {
    ...authPageDefinition,
    data: { ...authPageDefinition.data, ...data },
    setData(patch, callback) {
      this.data = { ...this.data, ...patch };
      if (callback) callback();
    },
  };
}

test("mini program registration stores account session", async () => {
  calls.length = 0;
  const session = await register({
    username: "13800138000",
    password: "1",
    displayName: "牌友",
    securityQuestion: "1",
    securityAnswer: "1",
  });
  assert.equal(session.accessToken, "token-1");
  assert.equal(calls[0].url.endsWith("/auth/register"), true);
  assert.equal(calls[0].data.username, "13800138000");
  assert.equal(calls[0].data.password, "1");
  assert.equal(calls[0].data.securityQuestion, "1");
  assert.equal(getAccessToken(), "token-1");
  assert.equal(getStoredUser().displayName, "牌友");
});

test("mini program login and auth errors use existing account API", async () => {
  calls.length = 0;
  await login("13800138000", "password-123");
  assert.equal(calls[0].url.endsWith("/auth/login"), true);
  assert.equal(getAuthErrorMessage({ code: "password_invalid" }), "密码不能为空，且不能超过 72 个字节。");
});

test("mini program refreshes the current account and preserves the requested auth mode", async () => {
  storage.accessToken = "token-1";
  calls.length = 0;
  global.wx.request = (options) => {
    calls.push(options);
    options.success({
      statusCode: 200,
      data: {
        user: {
          id: "user-1",
          username: "13800138000",
          displayName: "最新昵称",
          avatarUrl: "/avatars/latest.png",
        },
      },
    });
  };

  const user = await getCurrentUser();
  assert.equal(calls[0].url.endsWith("/auth/me"), true);
  assert.equal(calls[0].header.Authorization, "Bearer token-1");
  assert.equal(user.displayName, "最新昵称");
  assert.equal(getStoredUser().displayName, "最新昵称");

  const page = createAuthPage({ mode: "login" });
  page.onLoad({ mode: "register", returnTo: encodeURIComponent("/pages/feedback/index") });
  assert.equal(page.data.mode, "register");
  assert.equal(page.data.returnTo, "/pages/feedback/index");
});

test("mini program login password visibility toggles without changing the value", () => {
  const page = createAuthPage({ mode: "login", password: "1", passwordVisible: false });

  page.togglePasswordVisibility();
  assert.equal(page.data.passwordVisible, true);
  assert.equal(page.data.password, "1");

  page.togglePasswordVisibility();
  assert.equal(page.data.passwordVisible, false);
  assert.equal(page.data.password, "1");

  page.data.passwordVisible = true;
  page.switchMode({ currentTarget: { dataset: { mode: "register" } } });
  assert.equal(page.data.mode, "register");
  assert.equal(page.data.passwordVisible, false);
  assert.equal(page.data.password, "1");
});

test("mini program password template binds the visibility state and drops strength copy", () => {
  const template = fs.readFileSync(path.resolve(__dirname, "../pages/auth/index.wxml"), "utf8");

  assert.match(template, /password="\{\{!passwordVisible\}\}"/);
  assert.match(template, /bindtap="togglePasswordVisibility"/);
  assert.match(template, /wx:if="\{\{mode === 'login'\}\}"/);
  assert.doesNotMatch(template, /至少 8 位|包含字母和数字/);
});
