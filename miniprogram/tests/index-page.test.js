const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

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
