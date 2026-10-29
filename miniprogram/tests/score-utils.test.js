const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { capSummary, formatCNY, formatDistance, formatScore, giftCapHint, parsePoints, parseYuanToCents } = require("../utils/score-format");
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

test("score and cap formatting reflects room rules", () => {
  assert.equal(formatScore(5), "+5");
  assert.equal(formatScore(-3), "-3");
  assert.equal(parsePoints("10"), 10);
  assert.equal(parsePoints("0"), null);
  assert.equal(capSummary(10, 100), "10 分 / ¥10.00");
  assert.equal(capSummary(0, 100), "不封顶");
  assert.equal(giftCapHint(10, 100, 6), "封顶提示：10 分 / ¥10.00");
  assert.equal(giftCapHint(10, 100, 13), "已超过封顶 3 分，仍可继续提交");
  assert.equal(giftCapHint(0, 100, 13), "本房间未设置封顶提示");
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

test("mini program registers scoring pages and location privacy declaration", () => {
  const root = path.resolve(__dirname, "..");
  const config = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8"));
  for (const page of ["pages/index/index", "pages/auth/index", "pages/score/mahjong/index", "pages/score/room/index"]) {
    assert.ok(config.pages.includes(page));
    for (const extension of ["js", "json", "wxml", "wxss"]) {
      assert.equal(fs.existsSync(path.join(root, `${page}.${extension}`)), true, `${page}.${extension}`);
    }
  }
  assert.ok(config.requiredPrivateInfos.includes("getLocation"));
});
