const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const calendar = require("../../backend/internal/httpapi/holiday_calendar.json");

function mount(relativePath, platform, stubs = {}, now = Date.now()) {
  const filename = path.resolve(__dirname, "..", `${relativePath}.js`);
  let definition;
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    require(name) {
      return Object.hasOwn(stubs, name) ? stubs[name] : require(path.resolve(path.dirname(filename), name));
    },
    Page: value => { definition = value; },
    wx: platform,
    Date: class extends Date { static now() { return now; } },
  });
  return { ...definition, data: { ...definition.data }, setData(patch) { Object.assign(this.data, patch); } };
}

test("home switches to the discover tab and opens guest utilities directly", () => {
  const routes = [];
  const tabs = [];
  const page = mount("pages/index/index", {
    navigateTo: ({ url }) => routes.push(url),
    switchTab: ({ url }) => tabs.push(url),
  });
  page.openDiscover();
  page.openHolidays();
  page.openLottery();
  assert.deepEqual(tabs, ["/pages/discover/index"]);
  assert.deepEqual(routes, ["/packages/discover/holidays/index", "/packages/lottery/index/index"]);
  const app = require("../app.json");
  const registeredPages = app.pages.map(pagePath => `/${pagePath}`);
  const registeredSubs = app.subPackages.flatMap(({ root, pages }) => pages.map(pagePath => `/${root}/${pagePath}`));
  assert.ok(tabs.every(route => registeredPages.includes(route)));
  assert.ok(routes.every(route => registeredSubs.includes(route)));
});

test("discover tab filters categories and routes to all tools including lottery", () => {
  let token = "";
  const routes = [];
  const page = mount("pages/discover/index", { navigateTo: ({ url }) => routes.push(url) }, {
    "../../utils/auth": { getAccessToken: () => token },
  });
  page.selectCategory({ currentTarget: { dataset: { category: "life" } } });
  assert.equal(page.data.activeCategory, "life");
  page.openLottery();
  page.openHolidays();
  page.openNotebook();
  token = "account-token";
  page.openNotebook();
  page.openMemes();
  assert.deepEqual(routes.map(decodeURIComponent), [
    "/packages/lottery/index/index",
    "/packages/discover/holidays/index",
    "/pages/auth/index?mode=login&returnTo=/packages/notebook/index/index",
    "/packages/notebook/index/index",
    "/packages/meme/library/index",
  ]);
});

test("home pagination stays on the two visible carousel positions", () => {
  const page = mount("pages/index/index", {});
  assert.equal(page.data.discoverSlide, 0);
  page.selectDiscoverSlide({ currentTarget: { dataset: { index: "1" } } });
  assert.equal(page.data.discoverSlide, 1);
  page.onDiscoverSlideChange({ detail: { current: 0 } });
  assert.equal(page.data.discoverSlide, 0);
  page.selectDiscoverSlide({ currentTarget: { dataset: { index: "2" } } });
  assert.equal(page.data.discoverSlide, 0);
});

test("all discover entries preserve notebook login and both public destinations", () => {
  let token = "";
  const routes = [];
  const page = mount("packages/discover/index/index", { navigateTo: ({ url }) => routes.push(url) }, {
    "../../../utils/auth": { getAccessToken: () => token },
  });
  page.openNotebook();
  token = "account-token";
  page.openNotebook();
  page.openMemes();
  page.openHolidays();
  assert.deepEqual(routes.map(decodeURIComponent), [
    "/pages/auth/index?mode=login&returnTo=/packages/notebook/index/index",
    "/packages/notebook/index/index",
    "/packages/meme/library/index",
    "/packages/discover/holidays/index",
  ]);
});

test("calendar starts on the upcoming year, lets guests browse history and copies the selected notice", () => {
  const copy = [];
  let stopped = false;
  const now = Date.parse("2026-11-25T12:00:00+08:00");
  const page = mount("packages/discover/holidays/index", { setClipboardData: ({ data }) => copy.push(data) }, {
    "../../../utils/holiday-calendar": {
      ...require("../utils/holiday-calendar"),
      watchHolidayCalendar(update) {
        update({ calendar, status: "ready", now });
        return () => { stopped = true; };
      },
    },
  }, now);
  page.onShow();
  assert.equal(page.data.selectedYear, 2027);
  assert.equal(page.data.highlight.daysUntil, 37);
  assert.equal(page.data.holidays.length, 7);
  page.onYearChange({ detail: { value: "1" } });
  assert.equal(page.data.selectedYear, 2026);
  assert.equal(page.data.highlight, null);
  assert.equal(page.data.holidays[0].past, true);
  page.copySource();
  assert.deepEqual(copy, ["https://www.beijing.gov.cn/zhengce/zhengcefagui/202511/t20251104_4258873.html"]);
  page.onHide();
  assert.equal(stopped, true);
});
