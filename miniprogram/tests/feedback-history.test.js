const test = require("node:test");
const assert = require("node:assert/strict");

const unreadFeedback = {
  id: "reply-1",
  kind: "problem",
  status: "resolved",
  description: "牌局结算始终显示加载中",
  adminReply: "已经修复牌局结算，请更新后重试。",
  read: false,
  createdAt: "2026-11-27T05:26:00Z",
  replyUpdatedAt: "2026-11-28T03:10:00Z",
  images: [{ id: "picture-1" }],
};
const pendingFeedback = {
  id: "pending-2",
  kind: "problem",
  status: "pending",
  description: "笔记列表未刷新，请帮忙看看",
  read: false,
  images: [],
};

function createPage(path) {
  let definition;
  global.Page = (page) => { definition = page; };
  const modulePath = require.resolve(path);
  delete require.cache[modulePath];
  require(modulePath);
  return {
    ...definition,
    data: { ...definition.data },
    setData(patch) { Object.assign(this.data, patch); },
  };
}

function mockWeChat(request) {
  const state = { token: "feedback-token", navigations: [], redirects: [], previews: [] };
  global.wx = {
    getStorageSync: (key) => key === "accessToken" ? state.token : "",
    removeStorageSync(key) { if (key === "accessToken") state.token = ""; },
    request,
    downloadFile: (options) => state.download(options),
    navigateTo: (options) => state.navigations.push(options.url),
    redirectTo: (options) => state.redirects.push(options.url),
    previewImage: (options) => state.previews.push(options),
    stopPullDownRefresh() {},
  };
  return state;
}

test("the feedback form opens the user's feedback history", () => {
  const state = mockWeChat();
  const page = createPage("../pages/feedback/index");
  page.openHistory();
  assert.deepEqual(state.navigations, ["/pages/feedback/history/index"]);
});

test("feedback history uses authenticated pages and exposes only unread replies", async () => {
  const seenOffsets = [];
  const state = mockWeChat(({ url, header, success }) => {
    const route = new URL(url);
    assert.equal(route.pathname, "/api/v1/feedback/mine");
    assert.equal(header.Authorization, "Bearer feedback-token");
    const offset = Number(route.searchParams.get("offset"));
    const limit = Number(route.searchParams.get("limit"));
    seenOffsets.push(offset);
    success({
      statusCode: 200,
      data: { items: offset ? [pendingFeedback] : [unreadFeedback], limit, offset, total: limit + 1, unreadCount: 1 },
    });
  });

  const page = createPage("../pages/feedback/history/index");
  await page.onShow();
  assert.equal(page.data.unreadCount, 1);
  assert.equal(page.data.items[0].unread, true);
  assert.equal(page.data.items[0].statusLabel, "已处理");
  page.openFeedback({ currentTarget: { dataset: { id: page.data.items[0].id } } });
  assert.deepEqual(state.navigations, ["/pages/feedback/detail/index?id=reply-1"]);
  await page.nextPage();
  assert.equal(page.data.page, 2);
  assert.equal(page.data.items[0].unread, false);
  assert.equal(page.data.items[0].statusLabel, "待处理");
  assert.ok(seenOffsets[1] > seenOffsets[0]);
});

test("opening an unread reply acknowledges only that submission", async () => {
  const marked = [];
  mockWeChat(({ method, url, header, data, success }) => {
    assert.equal(header.Authorization, "Bearer feedback-token");
    if (method === "GET") {
      assert.ok(url.endsWith("/feedback/reply-1"));
      success({ statusCode: 200, data: { item: unreadFeedback } });
    } else {
      assert.equal(method, "POST");
      assert.ok(url.endsWith("/feedback/notifications/read"));
      marked.push(data);
      success({ statusCode: 200, data: { success: true, unreadCount: 0 } });
    }
  });

  const page = createPage("../pages/feedback/detail/index");
  page.onLoad({ id: "reply-1" });
  await page.onShow();
  assert.equal(page.data.item.adminReply, unreadFeedback.adminReply);
  assert.equal(page.data.item.unread, false);
  assert.deepEqual(marked, [{ feedbackIds: ["reply-1"] }]);
});

test("opening pending feedback leaves notifications intact", async () => {
  let requestCount = 0;
  mockWeChat(({ method, success }) => {
    requestCount += 1;
    assert.equal(method, "GET");
    success({ statusCode: 200, data: { item: pendingFeedback } });
  });
  const page = createPage("../pages/feedback/detail/index");
  page.onLoad({ id: "pending-2" });
  await page.onShow();
  assert.equal(page.data.item.statusLabel, "待处理");
  assert.equal(requestCount, 1);
});

test("a private attachment is downloaded with the current account before preview", async () => {
  const state = mockWeChat(({ method, success }) => {
    assert.equal(method, "GET");
    success({ statusCode: 200, data: { item: { ...unreadFeedback, read: true } } });
  });
  state.download = ({ url, header, success }) => {
    assert.equal(url, "https://www.xwhub.cn/api/v1/feedback/reply-1/images/picture-1");
    assert.equal(header.Authorization, "Bearer feedback-token");
    success({ statusCode: 200, tempFilePath: "wxfile://downloaded.png" });
  };
  const page = createPage("../pages/feedback/detail/index");
  page.onLoad({ id: "reply-1" });
  await page.onShow();
  await page.previewImage({ currentTarget: { dataset: { id: "picture-1" } } });
  assert.deepEqual(state.previews, [{ current: "wxfile://downloaded.png", urls: ["wxfile://downloaded.png"] }]);
});

test("an expired session clears private history and redirects to its sign-in path", async () => {
  let expired = false;
  const state = mockWeChat(({ success }) => {
    if (expired) {
      success({ statusCode: 401, data: { error: "unauthorized" } });
      return;
    }
    success({ statusCode: 200, data: { items: [unreadFeedback], total: 1, unreadCount: 1 } });
  });
  const page = createPage("../pages/feedback/history/index");
  await page.onShow();
  assert.equal(page.data.items.length, 1);
  expired = true;
  await page.onShow();
  assert.equal(state.token, "");
  assert.deepEqual(page.data.items, []);
  assert.equal(page.data.unreadCount, 0);
  assert.equal(state.redirects.length, 1);
  assert.match(decodeURIComponent(state.redirects[0]), /returnTo=\/pages\/feedback\/history\/index$/);
});

test("a response from the prior login does not expose or acknowledge its feedback", async () => {
  const pending = [];
  const state = mockWeChat((options) => pending.push(options));
  const page = createPage("../pages/feedback/detail/index");
  page.onLoad({ id: "reply-1" });
  const oldLoad = page.onShow();
  state.token = "new-account-token";
  pending[0].success({ statusCode: 200, data: { item: unreadFeedback } });
  await oldLoad;
  assert.equal(page.data.item, null);
  assert.equal(pending.length, 1);
});
