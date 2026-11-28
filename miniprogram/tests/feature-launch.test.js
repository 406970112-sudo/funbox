const test = require("node:test");
const assert = require("node:assert/strict");

let watched;
let app;
let stopped = false;
let currentPath;
const redirects = [];
const featurePath = require.resolve("../utils/feature-entries");
require.cache[featurePath] = {
  exports: {
    watchFeatureAccess(feature, update) {
      watched = { feature, update };
      return () => { stopped = true; };
    },
  },
};
global.App = (definition) => { app = definition; };
global.getCurrentPages = () => currentPath ? [{ route: currentPath }] : [];
global.wx = {
  switchTab({ url, success }) { redirects.push(url); success(); },
  showToast() {},
};
require("../app");

test("shared feature pages honor maintenance on launch while a hidden shortcut does not block them", () => {
  currentPath = "packages/lottery/detail/index";
  app.onShow({ path: currentPath });
  assert.equal(watched.feature, "lottery");
  watched.update("available", "live");
  assert.deepEqual(redirects, []);
  watched.update("maintenance", "live");
  assert.deepEqual(redirects, ["/pages/index/index"]);
  app.onHide();
  assert.equal(stopped, true);
});

test("a late access response cannot redirect a user who has left the feature", () => {
  redirects.length = 0;
  currentPath = "packages/meme/detail/index";
  app.onShow({ path: currentPath });
  currentPath = "pages/profile/index";
  watched.update("restricted", "live");
  assert.deepEqual(redirects, []);
});
