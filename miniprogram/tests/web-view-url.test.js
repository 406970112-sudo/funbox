const assert = require("node:assert/strict");
const test = require("node:test");

const { SITE_URL, createWebViewUrl } = require("../utils/web-view-url");

test("creates an HTTPS URL for the production site", () => {
  const url = new URL(createWebViewUrl(1722758400000));

  assert.equal(url.origin + url.pathname, SITE_URL);
  assert.equal(url.searchParams.get("source"), "wechat-miniprogram");
});

test("adds the provided timestamp as a cache buster", () => {
  const url = new URL(createWebViewUrl(1722758400000));

  assert.equal(url.searchParams.get("_wv_t"), "1722758400000");
});
