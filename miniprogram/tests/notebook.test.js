const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");

function loadPage(relativePath, stubs = {}, wx = {}) {
  let definition;
  const source = fs.readFileSync(path.resolve(ROOT, relativePath), "utf8");
  vm.runInNewContext(source, {
    require: (request) => stubs[request] || {},
    Page: (page) => { definition = page; },
    wx,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  }, { filename: relativePath });
  return definition;
}

function pageInstance(definition, patch = {}) {
  return {
    ...definition,
    data: { ...definition.data, ...patch },
    setData(update) { this.data = { ...this.data, ...update }; },
  };
}

test("notebook format derives titles, excerpts, themes, and tags", () => {
  const format = require("../packages/notebook/utils/notebook-format");
  const note = {
    title: "",
    body: "",
    checklist: [{ text: "先去湖边" }],
    tags: ["旅行", "旅行", "周末"],
    bookColor: "#20a97a",
    updatedAt: "2026-11-04T08:00:00Z",
  };
  assert.equal(format.noteTitle(note), "先去湖边");
  assert.equal(format.noteExcerpt(note), "先去湖边");
  assert.deepEqual(format.bookTheme("#20a97a"), { fill: "#e8f7f1", ink: "#228364" });
  assert.deepEqual(format.collectTags([note]), [{ tag: "旅行", count: 2 }, { tag: "周末", count: 1 }]);
});

test("notebook API builds filter query and surfaces stable error copy", async () => {
  const calls = [];
  const apiPath = require.resolve("../packages/notebook/utils/notebook-api");
  const requestPath = require.resolve("../utils/request");
  const authPath = require.resolve("../utils/auth");
  const configPath = require.resolve("../config/index");
  const oldRequest = require.cache[requestPath];
  const oldAuth = require.cache[authPath];
  const oldConfig = require.cache[configPath];
  const oldApi = require.cache[apiPath];
  require.cache[requestPath] = { id: requestPath, filename: requestPath, loaded: true, exports: {
    request: async input => { calls.push(input); return { notes: [{ id: "n1" }], hasMore: false }; },
    uploadFile: async input => ({ media: { id: input.name } }),
  } };
  require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: { getAccessToken: () => "token" } };
  require.cache[configPath] = { id: configPath, filename: configPath, loaded: true, exports: { API_BASE_URL: "https://example.com/api/v1" } };
  delete require.cache[apiPath];
  try {
    const api = require("../packages/notebook/utils/notebook-api");
    const result = await api.listNotebookNotes({ q: "西湖", bookId: "b1", tag: "旅行", limit: 20 });
    assert.equal(result.notes[0].id, "n1");
    assert.equal(calls[0].path, "/notebook/notes?bookId=b1&q=%E8%A5%BF%E6%B9%96&tag=%E6%97%85%E8%A1%8C&limit=20");
    assert.equal(api.notebookErrorMessage({ code: "notebook_book_not_empty" }), "笔记本里还有笔记，不能删除");
    assert.equal(api.isNotebookUnauthorized({ statusCode: 401 }), true);
    assert.equal(api.notebookMediaUrl({ url: "/api/v1/notebook/media/abc" }), "https://example.com/api/v1/notebook/media/abc");
  } finally {
    if (oldRequest) require.cache[requestPath] = oldRequest; else delete require.cache[requestPath];
    if (oldAuth) require.cache[authPath] = oldAuth; else delete require.cache[authPath];
    if (oldConfig) require.cache[configPath] = oldConfig; else delete require.cache[configPath];
    if (oldApi) require.cache[apiPath] = oldApi; else delete require.cache[apiPath];
  }
});

test("home notebook entry gates guests and opens the notebook for signed-in users", () => {
  let token = "";
  const navigations = [];
  const definition = loadPage("pages/index/index.js", {
    "../../utils/request": { request: async () => ({}) },
    "../../utils/auth": { getAccessToken: () => token, getStoredUser: () => null },
    "../../utils/score-session": { getRecentScoreRoom: () => null, saveRecentScoreRoom() {}, clearRecentScoreRoom() {}, getScoreSession: () => null },
    "../../utils/score-api": { getScoreRoom: async () => ({}), getScoreErrorMessage: error => error.message },
  }, { navigateTo: options => navigations.push(options.url), switchTab() {} });
  const page = pageInstance(definition);
  page.openNotebook();
  assert.match(navigations[0], /^\/pages\/auth\/index\?mode=login&returnTo=/);
  assert.match(decodeURIComponent(navigations[0]), /\/packages\/notebook\/index\/index/);
  token = "token";
  page.openNotebook();
  assert.equal(navigations[1], "/packages/notebook/index/index");
});

test("notebook home filter splits pinned and recent notes", () => {
  const stubs = {
    "../utils/notebook-api": {
      listNotebookBooks: async () => [{ id: "work", name: "工作", color: "#2d5bff", noteCount: 2 }],
      listNotebookNotes: async () => ({ notes: [] }),
      notebookErrorMessage: error => error.message,
      isNotebookUnauthorized: () => false,
    },
    "../utils/notebook-format": {
      decorateNote: note => ({ ...note, displayTitle: note.title, excerpt: note.body || "", timeLabel: "", bookFill: "", bookInk: "" }),
      bookTheme: () => ({ fill: "#eaf2ff", ink: "#2d5bff" }),
    },
    "../../utils/auth": { getAccessToken: () => "token", getStoredUser: () => ({ displayName: "阿青" }), clearSession() {} },
  };
  const definition = loadPage("packages/notebook/index/index.js", stubs, { showShareMenu() {}, stopPullDownRefresh() {} });
  const page = pageInstance(definition, { activeBookId: "all" });
  page._notes = [
    { id: "a", bookId: "work", pinned: true, title: "置顶" },
    { id: "b", bookId: "work", pinned: false, title: "最近" },
  ];
  page.applyFilter();
  assert.equal(page.data.pinnedNotes.length, 1);
  assert.equal(page.data.recentNotes.length, 1);
  page.data.activeBookId = "other";
  page.applyFilter();
  assert.equal(page.data.hasNotes, false);
});

test("editor creates once and updates subsequent autosaves", async () => {
  const created = [];
  const updated = [];
  const stubs = {
    "../utils/notebook-api": {
      listNotebookBooks: async () => [],
      getNotebookNote: async () => ({}),
      createNotebookNote: async input => { created.push(input); return { id: "note-1", pinned: false, favorite: false }; },
      updateNotebookNote: async (id, input) => { updated.push({ id, input }); return { id, pinned: false, favorite: false }; },
      uploadNotebookMedia: async () => ({}),
      deleteNotebookMedia: async () => ({}),
      downloadNotebookMedia: async () => "",
      notebookErrorMessage: error => error.message,
      isNotebookUnauthorized: () => false,
    },
    "../utils/notebook-format": { bookTheme: () => ({ fill: "#eaf2ff", ink: "#2d5bff" }) },
    "../../utils/auth": { getAccessToken: () => "token", clearSession() {} },
  };
  const definition = loadPage("packages/notebook/editor/index.js", stubs, { showToast() {} });
  const page = pageInstance(definition, {
    isLoggedIn: true,
    selectedBookId: "work",
    title: "第一页",
    body: "内容",
    checklist: [{ id: "local-1", text: "一项", done: false }],
    tags: ["旅行"],
  });
  page._active = true;
  page._saveAgain = false;
  page.noteId = "";
  page._dirty = true;
  await page.saveNow();
  assert.equal(created.length, 1);
  assert.equal(page.noteId, "note-1");
  assert.equal(page.data.saveLabel, "已自动保存");
  page.data.body = "更新内容";
  page._dirty = true;
  await page.saveNow();
  assert.equal(updated.length, 1);
  assert.equal(updated[0].id, "note-1");
  assert.equal(updated[0].input.body, "更新内容");
});

test("notebook route config and shared remove controls are present", () => {
  const app = JSON.parse(fs.readFileSync(path.resolve(ROOT, "app.json"), "utf8"));
  const notebook = app.subPackages.find(item => item.root === "packages/notebook");
  assert.ok(notebook);
  assert.deepEqual(notebook.pages, ["index/index", "editor/index", "detail/index", "search/index", "books/index"]);
  const homeWxml = fs.readFileSync(path.resolve(ROOT, "pages/index/index.wxml"), "utf8");
  const homeWxss = fs.readFileSync(path.resolve(ROOT, "pages/index/index.wxss"), "utf8");
  assert.match(homeWxml, /class="discover-grid"/);
  assert.match(homeWxml, /class="discover-card notebook-entry"/);
  assert.match(homeWxml, /class="discover-card meme-entry"/);
  assert.match(homeWxss, /\.discover-card\s*\{[^}]*height:\s*230rpx;/s);
  assert.doesNotMatch(homeWxml, /<br\s*\/>/);
  const editorWxml = fs.readFileSync(path.resolve(ROOT, "packages/notebook/editor/index.wxml"), "utf8");
  const editorWxss = fs.readFileSync(path.resolve(ROOT, "packages/notebook/editor/index.wxss"), "utf8");
  assert.doesNotMatch(editorWxml, /book-pill-arrow">⌄/);
  assert.match(editorWxml, /<view class="book-pill-arrow"/);
  assert.match(editorWxss, /\.book-picker\s*\{[^}]*align-items:\s*center;/s);
  assert.match(editorWxss, /\.book-pill-arrow\s*\{[^}]*border-top:\s*8rpx solid currentColor;/s);
  assert.match(editorWxml, /class="tool-icon tool-list"/);
  assert.match(editorWxml, /class="tool-icon tool-image"/);
  assert.match(editorWxml, /class="tool-icon tool-tag"/);
  assert.match(editorWxml, /class="tool-icon tool-mic/);
  assert.doesNotMatch(editorWxml, /tool-hash/);
  assert.match(editorWxss, /\.tool-tag-shape\s*\{/);
  assert.match(editorWxss, /\.tool-photo-frame\s*\{/);
});

test("auth accepts notebook subpackage return destinations", () => {
  const definition = loadPage("pages/auth/index.js", {
    "../../utils/auth": {},
  }, {});
  const page = pageInstance(definition);
  page.onLoad({ mode: "login", returnTo: encodeURIComponent("/packages/notebook/editor/index?id=n1") });
  assert.equal(page.data.returnTo, "/packages/notebook/editor/index?id=n1");
});

test("search page sends the favorite filter to the notebook API", async () => {
  const calls = [];
  const stubs = {
    "../utils/notebook-api": {
      listNotebookBooks: async () => [],
      listNotebookNotes: async options => { calls.push(options); return { notes: [], hasMore: false }; },
      notebookErrorMessage: error => error.message,
      isNotebookUnauthorized: () => false,
    },
    "../utils/notebook-format": {
      decorateNote: note => note,
      collectTags: () => [],
      bookTheme: () => ({ fill: "#eaf2ff", ink: "#2d5bff" }),
    },
    "../../../utils/auth": { getAccessToken: () => "token", clearSession() {} },
  };
  const definition = loadPage("packages/notebook/search/index.js", stubs, {});
  const page = pageInstance(definition, { isLoggedIn: true });
  page._active = true;
  page._generation = 0;
  page.setData = patch => { page.data = { ...page.data, ...patch }; };
  await page.toggleFavoriteOnly();
  assert.equal(page.data.favoriteOnly, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].favorite, true);
});

test("detail favorite toggles only after the server confirms it", async () => {
  const updates = [];
  const stubs = {
    "../utils/notebook-api": {
      getNotebookNote: async () => ({}),
      updateNotebookNote: async (id, patch) => { updates.push({ id, patch }); return { id, favorite: patch.favorite, pinned: false }; },
      deleteNotebookNote: async () => ({}),
      downloadNotebookMedia: async () => "",
      notebookErrorMessage: error => error.message,
      isNotebookUnauthorized: () => false,
    },
    "../utils/notebook-format": {
      decorateNote: note => note,
      formatFullDate: () => "",
      bookTheme: () => ({ fill: "#eaf2ff", ink: "#2d5bff" }),
    },
    "../../../utils/auth": { getAccessToken: () => "token", clearSession() {} },
  };
  const definition = loadPage("packages/notebook/detail/index.js", stubs, { showToast() {} });
  const page = pageInstance(definition, { favorite: false });
  page._active = true;
  page.noteId = "note-1";
  page._note = { id: "note-1" };
  await page.toggleFavorite();
  assert.equal(updates[0].id, "note-1");
  assert.equal(updates[0].patch.favorite, true);
  assert.equal(page.data.favorite, true);
});

test("editor uploads a recorded voice memo and exposes playback metadata", async () => {
  const uploads = [];
  const stubs = {
    "../utils/notebook-api": {
      listNotebookBooks: async () => [],
      getNotebookNote: async () => ({}),
      createNotebookNote: async () => ({ id: "note-1" }),
      updateNotebookNote: async (id, input) => ({ id, ...input }),
      uploadNotebookMedia: async (id, kind, path) => { uploads.push({ id, kind, path }); return { id: "audio-1", kind: "audio", url: "/api/v1/notebook/media/audio-1" }; },
      deleteNotebookMedia: async () => ({}),
      downloadNotebookMedia: async () => "",
      notebookErrorMessage: error => error.message,
      isNotebookUnauthorized: () => false,
    },
    "../utils/notebook-format": { bookTheme: () => ({ fill: "#eaf2ff", ink: "#2d5bff" }) },
    "../../../utils/auth": { getAccessToken: () => "token", clearSession() {} },
  };
  const definition = loadPage("packages/notebook/editor/index.js", stubs, { showToast() {} });
  const page = pageInstance(definition);
  page._active = true;
  page.noteId = "note-1";
  await page.uploadRecordedAudio({ tempFilePath: "/tmp/voice.mp3", duration: 3500 });
  assert.equal(uploads[0].id, "note-1");
  assert.equal(uploads[0].kind, "audio");
  assert.equal(uploads[0].path, "/tmp/voice.mp3");
  assert.equal(page.data.audio.id, "audio-1");
  assert.equal(page.data.audio.durationLabel, "00:04");
  assert.equal(page.data.uploadingMedia, false);
});

test("editor book changes mark the note dirty for autosave", () => {
  const stubs = {
    "../utils/notebook-api": {
      listNotebookBooks: async () => [],
      getNotebookNote: async () => ({}),
      createNotebookNote: async () => ({ id: "note-1" }),
      updateNotebookNote: async (id, input) => ({ id, ...input }),
      uploadNotebookMedia: async () => ({}),
      deleteNotebookMedia: async () => ({}),
      downloadNotebookMedia: async () => "",
      notebookErrorMessage: error => error.message,
      isNotebookUnauthorized: () => false,
    },
    "../utils/notebook-format": { bookTheme: () => ({ fill: "#eaf2ff", ink: "#2d5bff" }) },
    "../../../utils/auth": { getAccessToken: () => "token", clearSession() {} },
  };
  const definition = loadPage("packages/notebook/editor/index.js", stubs, {});
  const page = pageInstance(definition, { isLoggedIn: true, selectedBookId: "work" });
  page._books = [
    { id: "work", name: "工作", fill: "#eaf2ff", ink: "#2d5bff" },
    { id: "life", name: "生活", fill: "#e8f7f1", ink: "#228364" },
  ];
  page._saveTimer = null;
  page.scheduleSave = function() { this._dirty = true; };
  page.onBookChange({ detail: { value: "1" } });
  assert.equal(page.data.selectedBookId, "life");
  assert.equal(page.data.selectedBookName, "生活");
  assert.equal(page._dirty, true);
});
