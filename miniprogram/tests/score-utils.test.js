const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildHistoryItems,
  formatCNY,
  formatDistance,
  formatScore,
  parsePoints,
  parseYuanToCents,
} = require("../utils/score-format");
const { buildInviteContent, extractInviteToken } = require("../utils/invite");
const QRCode = require("../libs/qrcode");

test("money conversion uses integer cents", () => {
  assert.equal(parseYuanToCents("1"), 100);
  assert.equal(parseYuanToCents("0.01"), 1);
  assert.equal(parseYuanToCents("12.34"), 1234);
  assert.equal(parseYuanToCents("0"), null);
  assert.equal(parseYuanToCents("1.234"), null);
  assert.equal(formatCNY(1234), "¥12.34");
});

test("score formatting reflects room rules", () => {
  assert.equal(formatScore(5), "+5");
  assert.equal(formatScore(-3), "-3");
  assert.equal(parsePoints("10"), 10);
  assert.equal(parsePoints("0"), null);
  assert.equal(formatDistance(1560), "1.6 公里");
});

test("invite parsing supports share paths and raw tokens", () => {
  const token = "eyJhbGciOiJIUzI1NiJ9.payload.signature";
  assert.equal(extractInviteToken(buildInviteContent(token)), token);
  assert.equal(extractInviteToken(`https://example.test/room?invite=${encodeURIComponent(token)}`), token);
  assert.equal(extractInviteToken(token), token);
  assert.equal(extractInviteToken("not-an-invite"), "");
});

test("local QR encoder produces a scannable module matrix", () => {
  const qr = new QRCode(0, QRCode.QRErrorCorrectLevel.M);
  qr.addData(buildInviteContent("a.b.c"));
  qr.make();
  const count = qr.getModuleCount();
  assert.ok(count >= 21);
  assert.equal(qr.isDark(0, 0), true);
  assert.equal(qr.isDark(1, 1), false);
  assert.equal(qr.isDark(0, count - 1), true);
});

test("mini program registers scoring pages without requesting location access", () => {
  const root = path.resolve(__dirname, "..");
  const config = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8"));
  for (const page of [
    "pages/index/index",
    "pages/profile/index",
    "pages/profile-settings/index",
    "pages/game-history/index",
    "pages/auth/index",
    "pages/feedback/index",
    "pages/score/mahjong/index",
    "pages/score/room/index",
  ]) {
    assert.ok(config.pages.includes(page));
    for (const extension of ["js", "json", "wxml", "wxss"]) {
      assert.equal(fs.existsSync(path.join(root, `${page}.${extension}`)), true, `${page}.${extension}`);
    }
  }
  assert.deepEqual(config.tabBar.list.map((item) => [item.pagePath, item.text]), [
    ["pages/index/index", "首页"],
    ["pages/profile/index", "我的"],
  ]);
  assert.notEqual(config.tabBar.custom, true);
  for (const item of config.tabBar.list) {
    assert.equal(fs.existsSync(path.join(root, item.iconPath)), true, item.iconPath);
    assert.equal(fs.existsSync(path.join(root, item.selectedIconPath)), true, item.selectedIconPath);
  }
  assert.equal((config.requiredPrivateInfos || []).includes("getLocation"), false);
  assert.equal(Object.hasOwn(config.permission || {}, "scope.userLocation"), false);
});

test("recent game history maps the current participant, result, type and time", () => {
  const items = buildHistoryItems([{
    id: "room-1",
    name: "周五麻将",
    gameType: "mahjong",
    settledAt: "2026-10-29T08:30:00Z",
    selfParticipantId: "participant-2",
    participants: [
      { id: "participant-1", displayName: "房主", totalPoints: -8, amountCents: -800 },
      { id: "participant-2", displayName: "小李", totalPoints: 8, amountCents: 800 },
    ],
  }]);
  assert.equal(items.length, 1);
  assert.equal(items[0].gameTypeText, "麻将");
  assert.equal(items[0].participantsText, "房主、小李");
  assert.equal(items[0].scoreText, "+8 分");
  assert.equal(items[0].amountText, "¥8.00");
  assert.equal(items[0].resultClass, "result-win");
  assert.notEqual(items[0].timeText, "时间未知");
});

test("room templates remove caps and keep settlement rates out of active scoring", () => {
  const root = path.resolve(__dirname, "..");
  const createTemplate = fs.readFileSync(path.join(root, "pages/score/mahjong/index.wxml"), "utf8");
  const roomTemplate = fs.readFileSync(path.join(root, "pages/score/room/index.wxml"), "utf8");

  assert.doesNotMatch(createTemplate, /封顶|每分金额/);
  assert.doesNotMatch(roomTemplate, /封顶|rateText|capText/);
  const activeTemplate = roomTemplate.split('<block wx:elif="{{room.status === \'active\'}}">')[1].split('<block wx:elif="{{room.status === \'settled\'}}">')[0];
  assert.doesNotMatch(activeTemplate, /每分金额|settlementRateText/);
  assert.equal((roomTemplate.match(/每分金额/g) || []).length, 2);
  assert.match(roomTemplate, /hostRoomPassword/);
  assert.match(createTemplate, /房主昵称/);
  assert.match(roomTemplate, /登录并绑定/);
});

test("mahjong room creation uses friend-room defaults and has no password confirmation", () => {
  const root = path.resolve(__dirname, "..");
  const createScript = fs.readFileSync(path.join(root, "utils/score-entry-base.js"), "utf8");
  const createTemplate = fs.readFileSync(path.join(root, "pages/score/mahjong/index.wxml"), "utf8");

  assert.match(createScript, /roomName:\s*"老友局"/);
  assert.match(createScript, /roomPassword:\s*"666666"/);
  assert.doesNotMatch(createScript, /confirmPassword/);
  assert.doesNotMatch(createTemplate, /确认密码|confirmPassword/);
  assert.match(createTemplate, /data-field="hostNickname"/);
  assert.match(createTemplate, /data-field="roomPassword"/);
});
