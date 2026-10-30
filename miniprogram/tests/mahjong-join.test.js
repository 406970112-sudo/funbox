const test = require("node:test");
const assert = require("node:assert/strict");

const storage = {};
const navigations = [];
let scanOptions;
let joinRequest;
let submitJoin;
const apiPath = require.resolve("../utils/score-api");
require.cache[apiPath] = {
  id: apiPath, filename: apiPath, loaded: true,
  exports: {
    getScoreErrorMessage: (error) => error.message,
    joinScoreRoom: (input) => { joinRequest = input; return submitJoin(input); },
  },
};
global.wx = {
  getStorageSync: (key) => storage[key] || "",
  setStorageSync: (key, value) => { storage[key] = value; },
  removeStorageSync: (key) => { delete storage[key]; },
  navigateTo: (options) => { navigations.push(options.url); },
  scanCode: (options) => { scanOptions = options; },
  hideKeyboard: () => undefined,
};
let definition;
global.Page = (page) => { definition = page; };
require("../pages/score/mahjong/index");
function createPage(data) {
  return {
    ...definition,
    data: { ...definition.data, mode: "join", ...data },
    setData(patch) { Object.assign(this.data, patch); },
  };
}
function field(page, name, value) {
  page.handleField({ currentTarget: { dataset: { field: name } }, detail: { value } });
}

test("manual joining starts collapsed and dismissing/reopening preserves credentials without stale feedback", () => {
  const page = createPage();
  assert.equal(page.data.manualJoinOpen, false);
  page.openManualJoin();
  field(page, "roomCode", "123456");
  field(page, "joinPassword", "2468");
  page.handleManualKeyboard({ detail: { height: 280 } });
  assert.equal(page.data.manualKeyboardHeight, 280);
  page.data.errorMessage = "密码不正确";
  page.closeManualJoin();
  assert.equal(page.data.manualJoinOpen, false);
  assert.equal(page.data.manualKeyboardHeight, 0);
  page.openManualJoin();
  assert.equal(page.data.manualJoinOpen, true);
  assert.equal(page.data.errorMessage, "");
  assert.equal(page.data.roomCode, "123456");
  assert.equal(page.data.joinPassword, "2468");
});

test("switching create/join closes the manual sheet and clears its keyboard offset", () => {
  const page = createPage({ manualJoinOpen: true, manualKeyboardHeight: 280 });
  page.switchMode({ currentTarget: { dataset: { mode: "create" } } });
  assert.equal(page.data.mode, "create");
  assert.equal(page.data.manualJoinOpen, false);
  assert.equal(page.data.manualKeyboardHeight, 0);
});

test("manual submission keeps the sheet open on failure and can retry with edited credentials", async () => {
  const page = createPage({ manualJoinOpen: true, roomCode: "123456", joinPassword: "2468", nickname: " 小林 " });
  submitJoin = async () => { throw new Error("房间密码不正确"); };
  await page.joinByCode();
  assert.equal(page.data.manualJoinOpen, true);
  assert.equal(page.data.joining, false);
  assert.equal(page.data.errorMessage, "房间密码不正确");
  field(page, "joinPassword", "666666");
  submitJoin = async () => ({ room: { id: "room-1" }, guestToken: "guest-1", actor: { participantId: "player-1" } });
  await page.joinByCode();
  assert.deepEqual(joinRequest, { code: "123456", password: "666666", displayName: "小林" });
  assert.equal(storage.funboxScoreSessionV1.guestToken, "guest-1");
  assert.equal(page.data.manualJoinOpen, false);
  assert.equal(navigations.at(-1), "/pages/score/room/index?roomId=room-1");
});

test("pending join cannot be dismissed or submitted twice", async () => {
  let finish;
  let requests = 0;
  submitJoin = () => { requests += 1; return new Promise((resolve) => { finish = resolve; }); };
  const page = createPage({ manualJoinOpen: true, roomCode: "123456", joinPassword: "2468", nickname: "小林" });
  const pending = page.joinByCode();
  page.closeManualJoin();
  await page.joinByCode();
  assert.equal(page.data.manualJoinOpen, true);
  assert.equal(requests, 1);
  finish({ room: { id: "room-2" }, guestToken: "guest-2", actor: { participantId: "player-2" } });
  await pending;
  assert.equal(page.data.joining, false);
});

test("invalid manual credentials never send a join request", async () => {
  let requests = 0;
  submitJoin = async () => { requests += 1; };
  for (const data of [{ roomCode: "123" }, { joinPassword: "abc" }, { nickname: "  " }]) {
    const page = createPage({ manualJoinOpen: true, roomCode: "123456", joinPassword: "2468", nickname: "小林", ...data });
    await page.joinByCode();
    assert.ok(page.data.errorMessage);
    assert.equal(page.data.manualJoinOpen, true);
  }
  assert.equal(requests, 0);
});

test("scan accepts share tokens and mini-program scenes without requesting manual credentials", () => {
  for (const [result, expected] of [
    [{ result: "/pages/score/room/index?invite=abc.def.ghi" }, "/pages/score/room/index?invite=abc.def.ghi"],
    [{ path: "pages/score/room/index?scene=scene%2B123" }, "/pages/score/room/index?scene=scene%2B123"],
  ]) {
    const page = createPage();
    page.scanToJoin();
    assert.equal(page.data.scanning, true);
    scanOptions.success(result);
    scanOptions.complete();
    assert.equal(navigations.at(-1), expected);
    assert.equal(page.data.manualJoinOpen, false);
    assert.equal(page.data.scanning, false);
  }
});

test("scanner cancellation is quiet but unreadable invitations and camera failures have visible feedback", () => {
  const page = createPage({ errorMessage: "previous error" });
  page.scanToJoin();
  scanOptions.fail({ errMsg: "scanCode:fail cancel" });
  scanOptions.complete();
  assert.equal(page.data.errorMessage, "");
  page.scanToJoin();
  scanOptions.success({ result: "https://example.com/" });
  scanOptions.complete();
  assert.match(page.data.errorMessage, /邀请/);
  page.scanToJoin();
  scanOptions.fail({ errMsg: "scanCode:fail camera unavailable" });
  scanOptions.complete();
  assert.ok(page.data.errorMessage);
  assert.equal(page.data.manualJoinOpen, false);
});
