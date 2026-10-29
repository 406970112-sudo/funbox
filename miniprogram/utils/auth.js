const { request } = require("./request");
const { ACCESS_TOKEN_STORAGE_KEY } = require("../config/index");

const USER_STORAGE_KEY = "funboxUser";
const AUTH_ERROR_MESSAGES = {
  birthday_invalid: "生日格式不正确。",
  display_name_invalid: "昵称需为 1～32 个字符。",
  invalid_credentials: "账号或密码不正确。",
  password_invalid: "密码至少 8 位，且同时包含字母和数字。",
  rate_limited: "操作太频繁，请稍后再试。",
  security_answer_invalid: "请输入密保答案。",
  security_question_invalid: "密保问题需为 4～64 个字符。",
  username_invalid: "请输入有效的 11 位手机号。",
  username_taken: "该手机号已注册，请直接登录。",
};

function getStoredUser() {
  return wx.getStorageSync(USER_STORAGE_KEY) || null;
}

function getAccessToken() {
  return wx.getStorageSync(ACCESS_TOKEN_STORAGE_KEY) || "";
}

function saveSession(session) {
  if (!session || !session.accessToken) {
    throw new Error("登录响应缺少访问令牌。");
  }
  wx.setStorageSync(ACCESS_TOKEN_STORAGE_KEY, session.accessToken);
  wx.setStorageSync(USER_STORAGE_KEY, session.user || null);
}

function clearSession() {
  wx.removeStorageSync(ACCESS_TOKEN_STORAGE_KEY);
  wx.removeStorageSync(USER_STORAGE_KEY);
}

async function login(username, password) {
  const session = await request({
    path: "/auth/login",
    method: "POST",
    data: { username, password },
  });
  saveSession(session);
  return session;
}

async function register(input) {
  const session = await request({
    path: "/auth/register",
    method: "POST",
    data: input,
  });
  saveSession(session);
  return session;
}

function getAuthErrorMessage(error) {
  return (error && AUTH_ERROR_MESSAGES[error.code]) || (error && error.message) || "登录失败，请稍后重试。";
}

module.exports = {
  clearSession,
  getAccessToken,
  getAuthErrorMessage,
  getStoredUser,
  login,
  register,
  saveSession,
};
