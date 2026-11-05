const { request, uploadFile } = require("../../../utils/request");
const { API_BASE_URL } = require("../../../config/index");
const { getAccessToken } = require("../../../utils/auth");
const {
  clearUnlockSession,
  setUnlockSession,
  getUnlockToken,
} = require("./notebook-lock-session");

function notebookErrorMessage(error) {
  const code = error && error.code;
  const messages = {
    notebook_book_not_found: "没有找到这个笔记本",
    notebook_note_not_found: "这条笔记不存在或已删除",
    notebook_invalid_input: "内容不完整，请检查后再试",
    notebook_book_name_exists: "这个笔记本名称已经存在",
    notebook_book_not_empty: "笔记本里还有笔记，不能删除",
    notebook_book_limit_reached: "笔记本数量已达上限",
    notebook_media_limit_reached: "附件数量已达上限",
    notebook_media_too_large: "附件太大，请重新选择",
    notebook_media_type_invalid: "暂不支持这种文件格式",
    notebook_note_locked: "请先解锁这条加密笔记",
    notebook_note_password_mismatch: "笔记密码不正确",
    notebook_note_password_invalid: "笔记密码需为 6–32 位",
    notebook_note_password_not_set: "请先设置笔记密码",
    notebook_note_password_already_set: "笔记密码已经设置",
    notebook_reset_confirmation_invalid: "请确认后再清空加密笔记",
    rate_limited: "尝试次数过多，请稍后再试",
    unauthorized: "登录状态已失效，请重新登录",
  };
  return messages[code] || (error && error.message) || "操作失败，请稍后重试";
}

function isNotebookUnauthorized(error) {
  return Boolean(error && (error.statusCode === 401 || error.code === "unauthorized"));
}

function isNotebookLockedError(error) {
  return Boolean(error && (
    error.code === "notebook_note_locked" ||
    error.code === "notebook_note_password_mismatch" ||
    error.code === "notebook_note_unlock_expired"
  ));
}

function unlockHeader() {
  const token = getUnlockToken();
  return token ? { "X-Notebook-Unlock-Token": token } : {};
}

function notebookDownloadError(response) {
  let body = response && response.data;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (error) {
      body = null;
    }
  }
  const error = new Error((body && (body.detail || body.error || body.message)) || "附件加载失败，请重试");
  error.statusCode = response && response.statusCode;
  error.code = body && body.error ? body.error : "";
  error.response = response;
  return error;
}

async function getNotebookSecurity() {
  const result = await request({
    path: "/notebook/security",
    auth: true,
    header: unlockHeader(),
  });
  return result.security || {};
}

async function setNotebookPassword(action, current, newPassword) {
  const result = await request({
    path: "/notebook/security/password",
    method: "POST",
    auth: true,
    data: { action, current, new: newPassword },
  });
  return result.security || {};
}

async function unlockNotebook(password) {
  const result = await request({
    path: "/notebook/security/unlock",
    method: "POST",
    auth: true,
    data: { password },
  });
  setUnlockSession(result.unlockToken, result.expiresInSeconds);
  return result;
}

async function lockNotebook() {
  try {
    await request({
      path: "/notebook/security/lock",
      method: "POST",
      auth: true,
      header: unlockHeader(),
    });
  } finally {
    clearUnlockSession();
  }
}

async function resetNotebookEncryption() {
  try {
    await request({
      path: "/notebook/security/reset",
      method: "POST",
      auth: true,
      data: { confirm: "DELETE" },
    });
  } finally {
    clearUnlockSession();
  }
}

async function listNotebookBooks() {
  const result = await request({ path: "/notebook/books", auth: true });
  return Array.isArray(result.books) ? result.books : [];
}

async function createNotebookBook(name, color) {
  const result = await request({ path: "/notebook/books", method: "POST", auth: true, data: { name, color } });
  return result.book;
}

async function updateNotebookBook(id, data) {
  const result = await request({ path: `/notebook/books/${encodeURIComponent(id)}`, method: "PATCH", auth: true, data });
  return result.book;
}

async function deleteNotebookBook(id) {
  return request({ path: `/notebook/books/${encodeURIComponent(id)}`, method: "DELETE", auth: true });
}

async function listNotebookNotes(options = {}) {
  const params = [];
  if (options.bookId) params.push(`bookId=${encodeURIComponent(options.bookId)}`);
  if (options.q) params.push(`q=${encodeURIComponent(options.q)}`);
  if (options.tag) params.push(`tag=${encodeURIComponent(options.tag)}`);
  if (options.favorite) params.push("favorite=1");
  if (options.limit) params.push(`limit=${encodeURIComponent(options.limit)}`);
  if (options.offset) params.push(`offset=${encodeURIComponent(options.offset)}`);
  const suffix = params.length ? `?${params.join("&")}` : "";
  const result = await request({ path: `/notebook/notes${suffix}`, auth: true });
  return { notes: Array.isArray(result.notes) ? result.notes : [], hasMore: Boolean(result.hasMore) };
}

async function getNotebookNote(id) {
  const result = await request({
    path: `/notebook/notes/${encodeURIComponent(id)}`,
    auth: true,
    header: unlockHeader(),
  });
  return result.note;
}

async function createNotebookNote(data) {
  const result = await request({
    path: "/notebook/notes",
    method: "POST",
    auth: true,
    data,
    header: unlockHeader(),
  });
  return result.note;
}

async function updateNotebookNote(id, data) {
  const result = await request({
    path: `/notebook/notes/${encodeURIComponent(id)}`,
    method: "PATCH",
    auth: true,
    data,
    header: unlockHeader(),
  });
  return result.note;
}

async function deleteNotebookNote(id) {
  return request({ path: `/notebook/notes/${encodeURIComponent(id)}`, method: "DELETE", auth: true });
}

async function uploadNotebookMedia(noteId, kind, filePath) {
  const result = await uploadFile({
    path: `/notebook/notes/${encodeURIComponent(noteId)}/media`,
    filePath,
    name: "file",
    formData: { kind },
    auth: true,
    header: unlockHeader(),
  });
  return result.media;
}

async function deleteNotebookMedia(mediaId) {
  return request({
    path: `/notebook/media/${encodeURIComponent(mediaId)}`,
    method: "DELETE",
    auth: true,
    header: unlockHeader(),
  });
}

function notebookMediaUrl(media) {
  if (!media || !media.url) return "";
  if (/^https?:\/\//i.test(media.url)) return media.url;
  const origin = API_BASE_URL.replace(/\/api\/v1\/?$/, "");
  return origin + (media.url.startsWith("/") ? media.url : `/${media.url}`);
}

function downloadNotebookMedia(media, platform = wx) {
  return new Promise((resolve, reject) => {
    const token = getAccessToken();
    if (!token) {
      reject(Object.assign(new Error("登录状态已失效，请重新登录"), { statusCode: 401, code: "unauthorized" }));
      return;
    }
    const url = notebookMediaUrl(media);
    if (!url) {
      reject(new Error("附件地址无效"));
      return;
    }
    platform.downloadFile({
      url,
      header: { Authorization: `Bearer ${token}`, ...unlockHeader() },
      timeout: 15000,
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) resolve(response.tempFilePath);
        else reject(notebookDownloadError(response));
      },
      fail(error) {
        reject(new Error(error && error.errMsg ? error.errMsg : "附件加载失败，请重试"));
      },
    });
  });
}

function noteInput(note) {
  return {
    bookId: note.bookId,
    title: note.title || "",
    body: note.body || "",
    checklist: (note.checklist || []).map(item => ({ id: item.id || "", text: item.text || "", done: Boolean(item.done) })),
    tags: (note.tags || []).slice(0, 8),
    pinned: Boolean(note.pinned),
    favorite: Boolean(note.favorite),
    encrypted: Boolean(note.encrypted),
  };
}

module.exports = {
  notebookErrorMessage,
  isNotebookUnauthorized,
  isNotebookLockedError,
  getNotebookSecurity,
  setNotebookPassword,
  unlockNotebook,
  lockNotebook,
  resetNotebookEncryption,
  listNotebookBooks,
  createNotebookBook,
  updateNotebookBook,
  deleteNotebookBook,
  listNotebookNotes,
  getNotebookNote,
  createNotebookNote,
  updateNotebookNote,
  deleteNotebookNote,
  uploadNotebookMedia,
  deleteNotebookMedia,
  notebookMediaUrl,
  downloadNotebookMedia,
  noteInput,
};
