const test = require("node:test");
const assert = require("node:assert/strict");

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

const { getAccessToken, getAuthErrorMessage, getStoredUser, login, register } = require("../utils/auth");

test("mini program registration stores account session", async () => {
  calls.length = 0;
  const session = await register({
    username: "13800138000",
    password: "password-123",
    displayName: "牌友",
    securityQuestion: "第一所学校？",
    securityAnswer: "答案",
  });
  assert.equal(session.accessToken, "token-1");
  assert.equal(calls[0].url.endsWith("/auth/register"), true);
  assert.equal(calls[0].data.username, "13800138000");
  assert.equal(getAccessToken(), "token-1");
  assert.equal(getStoredUser().displayName, "牌友");
});

test("mini program login and auth errors use existing account API", async () => {
  calls.length = 0;
  await login("13800138000", "password-123");
  assert.equal(calls[0].url.endsWith("/auth/login"), true);
  assert.equal(getAuthErrorMessage({ code: "password_invalid" }), "密码至少 8 位，且同时包含字母和数字。");
});
