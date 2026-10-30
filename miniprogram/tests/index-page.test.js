const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadHome() {
  let definition;
  let clipboard;
  const toasts = [];
  const tabs = [];
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../pages/index/index.js"), "utf8"), {
    require: () => ({}),
    Page: (page) => { definition = page; },
    wx: {
      setClipboardData: (options) => { clipboard = options; },
      hideToast: () => {},
      showToast: (options) => toasts.push(options),
      hideTabBar: () => tabs.push("hide"),
      showTabBar: () => tabs.push("show"),
    },
  });
  const page = { ...definition, data: { ...definition.data }, setData(patch) { Object.assign(this.data, patch); } };
  return { page, toasts, tabs, clipboard: () => clipboard };
}

test("website guidance waits for a successful copy and closing restores tabs", () => {
  const home = loadHome();
  home.page.copyWebsite();
  assert.equal(home.clipboard().data, "https://xwhub.cn");
  assert.equal(home.page.data.showWebsiteDialog, false);
  assert.equal(home.page.data.copyingWebsite, true);
  const pending = home.clipboard();
  home.page.copyWebsite();
  assert.equal(home.clipboard(), pending);
  pending.success();
  assert.equal(home.page.data.showWebsiteDialog, true);
  assert.equal(home.page.data.copyingWebsite, false);
  assert.deepEqual(home.tabs, ["hide"]);
  home.page.closeWebsiteDialog();
  assert.equal(home.page.data.showWebsiteDialog, false);
  assert.deepEqual(home.tabs, ["hide", "show"]);
});

test("failed website copy shows a retry message and can be retried", () => {
  const home = loadHome();
  home.page.copyWebsite();
  const first = home.clipboard();
  first.fail();
  assert.equal(home.page.data.showWebsiteDialog, false);
  assert.equal(home.page.data.copyingWebsite, false);
  assert.equal(home.toasts[0].icon, "none");
  assert.match(home.toasts[0].title, /失败.*重试/);
  assert.deepEqual(home.tabs, []);
  home.page.copyWebsite();
  assert.notEqual(home.clipboard(), first);
  home.clipboard().success();
  home.page.onHide();
  assert.equal(home.page.data.showWebsiteDialog, false);
  assert.deepEqual(home.tabs, ["hide", "show"]);
});

test("home keeps three score entries without availability pills or arrow decorations", () => {
  const template = fs.readFileSync(path.resolve(__dirname, "../pages/index/index.wxml"), "utf8");
  const styles = fs.readFileSync(path.resolve(__dirname, "../pages/index/index.wxss"), "utf8");

  assert.equal((template.match(/class="scene-card /g) || []).length, 3);
  assert.match(template, /class="scene-card mahjong-card" bindtap="openMahjong"/);
  assert.match(template, /class="scene-card poker-card" bindtap="openPoker"/);
  assert.match(template, /class="scene-card general-card" bindtap="openGeneral"/);
  assert.doesNotMatch(template, /scene-arrow|scene-pill|available-pill|已开放/);
  assert.doesNotMatch(styles, /\.scene-arrow\s*\{/);
  assert.doesNotMatch(styles, /\.scene-pill\s*\{|\.available-pill\s*\{|\.poker-card\s+\.scene-pill\s*\{/);
});
