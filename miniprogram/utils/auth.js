const { request, uploadFile } = require("./request");
const { ACCESS_TOKEN_STORAGE_KEY } = require("../config/index");

const USER_STORAGE_KEY = "funboxUser";
let sessionRevision = 0;
const AUTH_ERROR_MESSAGES = {
  wechat_code_invalid: "微信登录凭证已失效，请点击重试。",
  wechat_unavailable: "微信登录暂不可用，请稍后重试或使用手机号密码登录。",
  wechat_login_failed: "未能获取微信登录凭证，请重试。",
  wechat_already_bound: "当前微信或账号已有绑定，请使用原账号登录；如需处理，请通过功能反馈联系维护者。",
  session_changed: "登录状态已变化，请重新操作。",
  avatar_required: "请选择一张头像图片。",
  avatar_too_large: "头像不能超过 3 MB。",
  avatar_type_invalid: "头像仅支持 JPG 或 PNG 格式。",
  birthday_invalid: "生日格式不正确。",
  display_name_invalid: "昵称需为 1～32 个字符。",
  invalid_credentials: "账号或密码不正确。",
  password_invalid: "密码不能为空，且不能超过 72 个字节。",
  rate_limited: "操作太频繁，请稍后再试。",
  security_answer_invalid: "请输入密保答案。",
  security_question_invalid: "请输入密保问题，且不能超过 64 个字符。",
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
  sessionRevision += 1;
  wx.setStorageSync(ACCESS_TOKEN_STORAGE_KEY, session.accessToken);
  wx.setStorageSync(USER_STORAGE_KEY, session.user || null);
}

function clearSession() {
  sessionRevision += 1;
  wx.removeStorageSync(ACCESS_TOKEN_STORAGE_KEY);
  wx.removeStorageSync(USER_STORAGE_KEY);
}

async function login(username, password, { isActive } = {}) {
  const commit = sessionAttempt(isActive);
  const session = await request({
    path: "/auth/login",
    method: "POST",
    data: { username, password },
  });
  commit(session);
  return session;
}

async function register(input, { isActive } = {}) {
  const commit = sessionAttempt(isActive);
  const session = await request({
    path: "/auth/register",
    method: "POST",
    data: input,
  });
  commit(session);
  return session;
}

function authError(code, message) {
  const error = new Error(message || AUTH_ERROR_MESSAGES[code]);
  error.code = code;
  return error;
}

function sessionAttempt(isActive = () => true) {
  const revision = sessionRevision;
  const token = getAccessToken();
  const check = () => {
    if (revision !== sessionRevision || token !== getAccessToken() || !isActive()) {
      throw authError("session_changed");
    }
  };
  const commit = (session) => { check(); saveSession(session); };
  commit.check = check;
  return commit;
}

function getWeChatCode() {
  return new Promise((resolve, reject) => {
    wx.login({
      timeout: 10000,
      success(result) {
        if (result && result.code) resolve(result.code);
        else reject(authError("wechat_login_failed"));
      },
      fail() { reject(authError("wechat_login_failed")); },
    });
  });
}

async function loginWithWeChat({ isActive } = {}) {
  const commit = sessionAttempt(isActive);
  const code = await getWeChatCode();
  commit.check();
  const session = await request({ path: "/auth/wechat/login", method: "POST", data: { code } });
  commit(session);
  return session;
}

async function bindWeChat({ isActive } = {}) {
  const token = getAccessToken();
  if (!token) throw authError("unauthorized", "请先登录原账号，再绑定微信。");
  const attempt = sessionAttempt(isActive);
  const code = await getWeChatCode();
  attempt.check();
  const response = await request({ path: "/users/me/wechat", method: "POST", data: { code }, bearerToken: token });
  attempt.check();
  return storeUpdatedUser(response, token);
}

async function getCurrentUser() {
  const token = getAccessToken();
  if (!token) return null;
  const response = await request({ path: "/auth/me", bearerToken: token });
  const user = response && response.user ? response.user : null;
  if (user && getAccessToken() === token) {
    wx.setStorageSync(USER_STORAGE_KEY, user);
  }
  return user;
}

async function updateDisplayName(displayName) {
  const token = getAccessToken();
  const response = await request({
    path: "/users/me",
    method: "PATCH",
    bearerToken: token,
    data: { displayName },
  });
  return storeUpdatedUser(response, token);
}

async function uploadAvatar(filePath) {
  const token = getAccessToken();
  const response = await uploadFile({
    path: "/users/me/avatar",
    filePath,
    name: "avatar",
    bearerToken: token,
  });
  return storeUpdatedUser(response, token);
}

function storeUpdatedUser(response, token) {
  if (!response || !response.user) throw new Error("未获取到更新后的个人信息，请重试。");
  // A late response must not restore an account after logout or account switching.
  if (token && getAccessToken() === token) wx.setStorageSync(USER_STORAGE_KEY, response.user);
  return response.user;
}

function getAuthErrorMessage(error) {
  return (error && AUTH_ERROR_MESSAGES[error.code]) || (error && error.message) || "登录失败，请稍后重试。";
}

module.exports = {
  bindWeChat,
  loginWithWeChat,
  clearSession,
  getAccessToken,
  getAuthErrorMessage,
  getCurrentUser,
  getStoredUser,
  login,
  register,
  saveSession,
  updateDisplayName,
  uploadAvatar,
};
