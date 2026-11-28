const test = require("node:test");
const assert = require("node:assert/strict");

const accountId = "a4c012f2-a751-4f6c-9c35-0025fab53b16";

function harness(routes) {
  let token = "mini-admin-token";
  let modal;
  const requests = [];
  const downloads = [];
  const previews = [];
  const navigation = [];
  global.wx = {
    getStorageSync: () => token,
    request(options) {
      const url = new URL(options.url);
      const path = url.pathname.replace(/^\/api\/v1/, "");
      const route = `${options.method} ${path}`;
      requests.push({ ...options, route });
      const handler = routes[route];
      if (!handler) throw new Error(`Unexpected request ${route}`);
      options.success({ statusCode: 200, data: typeof handler === "function" ? handler(options) : handler });
    },
    downloadFile(options) {
      downloads.push(options);
      options.success({ statusCode: 200, tempFilePath: "wxfile://feedback.png" });
    },
    previewImage(options) { previews.push(options); },
    showModal(options) { modal = options; },
    showToast() {},
    navigateTo(options) { navigation.push(options.url); },
    setClipboardData() {},
  };
  return { requests, downloads, previews, navigation, setToken(value) { token = value; }, confirm() { modal.success({ confirm: true }); } };
}

function createPage(name, options = {}) {
  let definition;
  global.Page = (input) => { definition = input; };
  const file = require.resolve(`../packages/admin/${name}/index.js`);
  delete require.cache[file];
  require(file);
  const page = { ...definition, data: { ...definition.data }, setData(patch) { Object.assign(this.data, patch); } };
  Object.defineProperty(page, "route", { value: "packages/admin/" + name + "/index" });
  page.onLoad(options);
  return page;
}

function event(dataset = {}, detail = {}) {
  return { currentTarget: { dataset }, detail };
}

test("workbench shows only modules granted to the mini-program session", async () => {
  const env = harness({ "GET /mini-admin/session": { owner: false, permissions: ["feedback.manage"] } });
  const page = createPage("workbench");
  await page.onShow();
  assert.deepEqual(page.data.modules.map((module) => module.id), ["feedback"]);
  page.openModule(event({ id: "features" }));
  page.openModule(event({ id: "feedback" }));
  assert.deepEqual(env.navigation, ["/packages/admin/feedback/index"]);
  assert.equal(env.requests[0].header.Authorization, "Bearer mini-admin-token");
});

test("feature publish retains locations when switched off and includes the editor revision", async () => {
  const feature = { id: "notebook", name: "笔记本", placements: ["home", "discover", "profile"], visiblePlacements: ["home", "profile"], enabled: true, audience: "signed_in", maintenance: false, revision: 4 };
  const env = harness({
    "GET /mini-admin/session": { owner: false, permissions: ["features.manage"] },
    "GET /mini-admin/features": { features: [feature] },
    "PUT /mini-admin/features/notebook": (options) => ({ feature: { ...feature, ...options.data, revision: 5 } }),
  });
  const page = createPage("feature", { id: "notebook" });
  assert.equal(page.route, "packages/admin/feature/index");
  await page.onShow();
  page.changeEnabled(event({}, { value: false }));
  const pending = page.publish();
  env.confirm();
  await pending;
  assert.deepEqual(env.requests.at(-1).data, { enabled: false, visiblePlacements: ["home", "profile"], audience: "signed_in", maintenance: false, revision: 4 });
  assert.equal(page.data.feature.revision, 5);
});

test("feedback screenshots use the authorized API and reply completes the feedback", async () => {
  const attachment = `/api/v1/mini-admin/feedback/${accountId}/images/public-image`;
  const item = { id: accountId, description: "点击保存后页面仍然显示正在保存", status: "pending", images: [{ id: "1", path: attachment }, { id: "2", path: "https://other.invalid/info" }] };
  const env = harness({
    "GET /mini-admin/session": { owner: false, permissions: ["feedback.manage"] },
    [`GET /mini-admin/feedback/${accountId}`]: { item },
    [`POST /mini-admin/feedback/${accountId}/resolve`]: (options) => ({ item: { ...item, status: options.data.status, adminReply: options.data.reply } }),
  });
  const page = createPage("feedback-detail", { id: accountId });
  await page.onShow();
  await page.openImage(event({ index: 1 }));
  assert.equal(env.downloads.length, 0);
  await page.openImage(event({ index: 0 }));
  assert.equal(env.downloads[0].header.Authorization, "Bearer mini-admin-token");
  assert.deepEqual(env.previews[0].urls, ["wxfile://feedback.png"]);
  await page.markProcessing();
  assert.equal(page.data.item.status, "processing");
  page.editReply(event({}, { value: "太短" }));
  await page.submitReply();
  const reply = "保存时的卡顿问题已修复，可以重新打开页面使用。";
  page.editReply(event({}, { value: reply }));
  await page.submitReply();
  assert.deepEqual(env.requests.at(-1).data, { status: "resolved", reply });
  assert.equal(page.data.item.status, "resolved");
  assert.equal(env.requests.filter((request) => request.method === "POST").length, 2);
});

test("authorization confirmation cannot be submitted after switching accounts", async () => {
  const env = harness({
    "GET /mini-admin/session": { owner: true, permissions: [] },
    "GET /mini-admin/grants": { grants: [] },
    "GET /mini-admin/grant-changes": { changes: [], total: 0 },
    [`GET /mini-admin/users/${accountId}`]: { user: { id: accountId, displayName: "牌友", accountType: "wechat" } },
    [`GET /mini-admin/grants/${accountId}`]: { grant: { permissions: [] } },
  });
  const page = createPage("grants");
  await page.onShow();
  page.editUserId(event({}, { value: accountId }));
  await page.findUser();
  page.changePermissions(event({}, { value: ["feedback.manage"] }));
  const pending = page.saveGrant();
  env.setToken("different-account");
  env.confirm();
  await pending;
  assert.ok(env.requests.every((request) => request.method === "GET"));
});

test("grant lookup preserves the current permissions even outside the first page", async () => {
  const user = { id: accountId, displayName: "牌友", accountType: "wechat" };
  harness({
    "GET /mini-admin/session": { owner: true, permissions: [] },
    "GET /mini-admin/grants": (options) => ({
      grants: new URL(options.url).searchParams.get("offset") === "1"
        ? [{ user, permissions: ["features.manage"] }]
        : [{ user: { id: "other", displayName: "另一个用户" }, permissions: ["users.read"] }],
      total: 2,
    }),
    "GET /mini-admin/grant-changes": { changes: [], total: 0 },
    [`GET /mini-admin/users/${accountId}`]: { user },
    [`GET /mini-admin/grants/${accountId}`]: { grant: { permissions: ["features.manage"] } },
  });
  const page = createPage("grants");
  await page.onShow();
  page.editUserId(event({}, { value: accountId }));
  await page.findUser();
  assert.deepEqual(page.data.selected, ["features.manage"]);
  await page.loadMoreGrants();
  assert.deepEqual(page.data.grants.map((grant) => grant.id), ["other", accountId]);
});
