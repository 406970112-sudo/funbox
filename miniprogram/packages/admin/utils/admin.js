const { API_BASE_URL } = require("../../../config/index");
const { getAccessToken } = require("../../../utils/auth");
const { request } = require("../../../utils/request");

const PREFIX = "/mini-admin";
const API_ORIGIN = API_BASE_URL.replace(/\/api\/v1\/?$/, "");
const PERMISSIONS = [
  { id: "users.read", label: "查看用户" },
  { id: "users.role", label: "调整会员" },
  { id: "feedback.manage", label: "处理反馈" },
  { id: "features.manage", label: "管理功能入口" },
];
const PAGE_SIZE = 20;
const ROLE_LABELS = { normal: "普通用户", vip: "VIP", svip: "SVIP", admin: "网页管理员" };
const STATUS_LABELS = { pending: "待处理", processing: "处理中", resolved: "已处理" };
const PLACEMENT_LABELS = { home: "首页", discover: "发现", profile: "我的", recent: "最近使用", score: "记分页" };
const AUDIENCES = [
  { id: "all", label: "所有人" },
  { id: "signed_in", label: "已登录用户" },
  { id: "vip", label: "VIP 与 SVIP" },
  { id: "svip", label: "仅 SVIP" },
];
const ERRORS = {
  unauthorized: "登录状态已失效，请返回「我的」重新登录。",
  mini_admin_required: "当前账号没有此项管理权限。",
  admin_required: "当前账号没有此项管理权限。",
  user_not_found: "未找到这个账号，请核对完整的 FunBox ID。",
  feedback_not_found: "这条反馈已不存在。",
  feature_not_found: "这个功能入口已不存在。",
  revision_conflict: "入口设置已变更，请刷新后重新编辑。",
  feature_revision_conflict: "入口设置已变更，请刷新后重新编辑。",
  feature_changed: "入口设置已变更，请刷新后重新编辑。",
  role_changed: "该用户的身份已更新，请刷新后重试。",
  protected_admin_role: "该角色由网页后台管理。",
  owner_grant_protected: "负责人权限由服务器维护。",
  feedback_reply_invalid: "回复需填写 10～1000 个字符。",
  feedback_status_invalid: "反馈状态已变化，请刷新后重试。",
};

function query(path, fields) {
  const parts = Object.entries(fields)
    .filter(([, value]) => value !== "" && value != null)
    .map(([key, value]) => encodeURIComponent(key) + "=" + encodeURIComponent(value));
  return parts.length ? path + "?" + parts.join("&") : path;
}

function resource(path, id) {
  return path + "/" + encodeURIComponent(id);
}

function hasPermission(session, permission) {
  return Boolean(session && (session.owner || session.permissions.includes(permission)));
}

function openPage(name, id) {
  const url = "/packages/admin/" + name + "/index";
  wx.navigateTo({ url: id ? query(url, { id }) : url });
}

function confirm(title, content, confirmText = "确认") {
  return new Promise((resolve) => {
    wx.showModal({ title, content, confirmText, confirmColor: "#2d5bff",
      success: ({ confirm: accepted }) => resolve(accepted),
      fail: () => resolve(false),
    });
  });
}

function toast(title) {
  wx.showToast({ title, icon: "none" });
}

function copy(text) {
  if (text) wx.setClipboardData({ data: text });
}

function formatDate(input) {
  const date = new Date(input || "");
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part) => String(part).padStart(2, "0");
  return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate())
    + " " + pad(date.getHours()) + ":" + pad(date.getMinutes());
}

function userSummary(user) {
  const name = user.displayName || "未命名用户";
  return {
    ...user,
    displayName: name,
    avatar: user.avatarUrl && (user.avatarUrl.startsWith("/") && !user.avatarUrl.startsWith("//")
      ? API_ORIGIN + user.avatarUrl : user.avatarUrl),
    avatarMark: Array.from(name)[0],
    accountLabel: user.accountType === "wechat" ? "微信注册" : user.wechatBound ? "已绑定微信" : "手机号注册",
    roleLabel: ROLE_LABELS[user.role] || user.role || "",
    registration: formatDate(user.createdAt),
  };
}

function errorText(error) {
  if (error.statusCode === 403) return "当前账号没有此项管理权限。";
  if (error.statusCode === 401) return ERRORS.unauthorized;
  if (error.isNetworkError) return "网络请求失败，请稍后重试。";
  if (error.statusCode === 409) return ERRORS[error.code] || "记录已变更，请刷新后重试。";
  return ERRORS[error.code] || error.displayMessage || "操作失败，请稍后重试。";
}

function downloadImage(path, token) {
  if (!/^\/api\/v1\/mini-admin\/feedback\/[^/?#]+\/images\/[^/?#]+$/.test(path || "")) {
    return Promise.reject({ displayMessage: "截图地址无效。" });
  }
  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url: API_ORIGIN + path,
      header: { Authorization: "Bearer " + token },
      success(result) {
        if (result.statusCode === 200 && result.tempFilePath) resolve(result.tempFilePath);
        else reject({ statusCode: result.statusCode, displayMessage: "截图下载失败，请稍后重试。" });
      },
      fail: () => reject({ displayMessage: "截图下载失败，请稍后重试。" }),
    });
  });
}

function adminPage({ required, ownerOnly, load, data, ...page }) {
  const initial = { ready: false, denied: false, loading: true, busy: false, error: "", ...data };
  Page({
    ...page,
    data: initial,
    onLoad(options) {
      this.pageOptions = options || {};
    },
    onShow() {
      return this.refresh();
    },
    onPullDownRefresh() {
      return this.refresh().finally(() => wx.stopPullDownRefresh());
    },
    onUnload() {
      this.revision += 1;
    },
    context(token) {
      const revision = this.revision;
      return {
        token,
        active: () => revision === this.revision && token === getAccessToken(),
        api: (path, options = {}) => request({ ...options, path: PREFIX + path, auth: true, bearerToken: token }),
      };
    },
    block(error) {
      this.revision += 1;
      this.setData({ ...initial, denied: true, loading: false, error });
    },
    async refresh() {
      this.revision = (this.revision || 0) + 1;
      const token = getAccessToken();
      if (!token) {
        this.block(ERRORS.unauthorized);
        return;
      }
      if (this.token !== token) this.setData(initial);
      this.token = token;
      this.setData({ ready: false, denied: false, loading: true, busy: false, error: "" });
      const context = this.context(token);
      try {
        const response = await context.api("/session");
        if (!context.active()) return;
        const session = { owner: Boolean(response.owner), permissions: Array.isArray(response.permissions) ? response.permissions : [] };
        if ((!session.owner && !session.permissions.length) || (ownerOnly && !session.owner)
          || (required && !hasPermission(session, required))) {
          this.block("当前账号没有此项管理权限。");
          return;
        }
        this.session = session;
        await load.call(this, { ...context, session });
        if (context.active()) this.setData({ ready: true, loading: false });
      } catch (error) {
        if (!context.active()) return;
        if (error.statusCode === 401 || error.statusCode === 403) this.block(errorText(error));
        else this.setData({ error: errorText(error), loading: false });
      }
    },
    async action(task) {
      if (!this.data.ready || this.data.busy) return;
      if (!this.token || this.token !== getAccessToken()) {
        this.block(ERRORS.unauthorized);
        return;
      }
      const context = this.context(this.token);
      this.setData({ busy: true, error: "" });
      try {
        await task(context);
      } catch (error) {
        if (!context.active()) return;
        if (error.statusCode === 401 || error.statusCode === 403) this.block(errorText(error));
        else this.setData({ error: errorText(error) });
      } finally {
        if (context.active()) this.setData({ busy: false });
        else if (this.token === context.token && context.token !== getAccessToken()) this.block(ERRORS.unauthorized);
      }
    },
    backToProfile() {
      wx.switchTab({ url: "/pages/profile/index" });
    },
  });
}

module.exports = {
  adminPage, hasPermission, query, resource, openPage, confirm, toast, copy, formatDate,
  userSummary, downloadImage, PAGE_SIZE, PERMISSIONS, ROLE_LABELS, STATUS_LABELS, PLACEMENT_LABELS, AUDIENCES,
};
