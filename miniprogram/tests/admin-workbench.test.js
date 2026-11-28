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

test("the login-only switch publishes the supported audience without changing visibility settings", async () => {
  let feature = { id: "lottery", name: "开奖查询", placements: ["home", "discover", "recent"], visiblePlacements: ["discover"], enabled: true, audience: "all", maintenance: false, revision: 3 };
  const env = harness({
    "GET /mini-admin/session": { owner: false, permissions: ["features.manage"] },
    "GET /mini-admin/features": { features: [feature] },
    "PUT /mini-admin/features/lottery": ({ data }) => {
      feature = { ...feature, ...data, revision: feature.revision + 1 };
      return { feature };
    },
  });
  const page = createPage("feature", { id: "lottery" });
  await page.onShow();
  page.changeRequireLogin(event({}, { value: true }));
  let pending = page.publish();
  env.confirm();
  await pending;
  assert.deepEqual(env.requests.at(-1).data, { enabled: true, visiblePlacements: ["discover"], audience: "signed_in", maintenance: false, revision: 3 });

  page.changeAudience(event({}, { value: "1" }));
  assert.equal(page.data.draft.audience, "vip");
  page.changeRequireLogin(event({}, { value: false }));
  pending = page.publish();
  env.confirm();
  await pending;
  assert.equal(env.requests.at(-1).data.audience, "all");
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

test("workbench surfaces summary KPIs and badges and preserves view on silent refresh", async () => {
  const env = harness({
    "GET /mini-admin/session": { owner: true, permissions: [], userId: accountId, displayName: "负责人" },
    "GET /mini-admin/summary": {
      summary: { pendingFeedback: 3, processingFeedback: 1, featuresTotal: 10, featuresDisabled: 1, featuresMaintenance: 1, usersTotal: 42, grantsTotal: 2 },
    },
  });
  const page = createPage("workbench");
  await page.onShow();
  assert.equal(page.data.userId, accountId);
  assert.equal(page.data.quickStats.length, 3);
  const feedbackMod = page.data.modules.find((m) => m.id === "feedback");
  assert.equal(feedbackMod.badge, "3 条待处理");
  // Second onShow performs silent refresh without clearing ready state.
  let clearedReady = false;
  const origSetData = page.setData.bind(page);
  page.setData = (patch) => {
    if (patch.ready === false) clearedReady = true;
    origSetData(patch);
  };
  await page.onShow();
  assert.equal(clearedReady, false);
  assert.equal(env.requests.filter((r) => r.route === "GET /mini-admin/summary").length, 2);
});

test("feedback list defaults to pending and switches filters without re-fetching session", async () => {
  const env = harness({
    "GET /mini-admin/session": { owner: false, permissions: ["feedback.manage"] },
    "GET /mini-admin/feedback": { items: [{ id: "f1", title: "卡顿", description: "点击后无响应", status: "pending", images: [{ id: "i1" }] }], total: 1 },
  });
  const page = createPage("feedback");
  await page.onShow();
  assert.equal(page.data.status, "pending");
  assert.equal(page.data.items[0].imageCount, 1);
  await page.chooseStatus(event({ status: "resolved" }));
  assert.equal(page.data.status, "resolved");
  assert.equal(env.requests.filter((r) => r.route === "GET /mini-admin/session").length, 1);
});

test("feature editor supports pill toggles, resetDraft, and multi-image feedback preview", async () => {
  const feature = { id: "lottery", name: "开奖查询", placements: ["home", "discover", "recent"], visiblePlacements: ["discover"], enabled: true, audience: "all", maintenance: false, revision: 2 };
  harness({
    "GET /mini-admin/session": { owner: false, permissions: ["features.manage"] },
    "GET /mini-admin/features": { features: [feature] },
  });
  const page = createPage("feature", { id: "lottery" });
  await page.onShow();
  page.togglePlacement(event({ id: "home" }));
  assert.deepEqual(page.data.draft.visiblePlacements, ["home", "discover"]);
  assert.equal(page.data.changed, true);
  page.resetDraft();
  assert.deepEqual(page.data.draft.visiblePlacements, ["discover"]);
  assert.equal(page.data.changed, false);

  const img1 = `/api/v1/mini-admin/feedback/${accountId}/images/a`;
  const img2 = `/api/v1/mini-admin/feedback/${accountId}/images/b`;
  const env2 = harness({
    "GET /mini-admin/session": { owner: false, permissions: ["feedback.manage"] },
    [`GET /mini-admin/feedback/${accountId}`]: { item: { id: accountId, description: "双图反馈", status: "pending", images: [{ id: "1", path: img1 }, { id: "2", path: img2 }] } },
  });
  const detail = createPage("feedback-detail", { id: accountId });
  await detail.onShow();
  await detail.openImage(event({ index: 0 }));
  assert.equal(env2.downloads.length, 2);
  assert.equal(env2.previews[0].urls.length, 2);
  detail.useQuickReply(event({ text: detail.data.quickReplies[0].text }));
  assert.ok(detail.data.replyTrimLength >= 10);
});
