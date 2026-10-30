const test = require("node:test");
const assert = require("node:assert/strict");
const { ACCESS_TOKEN_STORAGE_KEY } = require("../config/index");

const storage = {};
const navigations = [];
const requests = [];
let submitCreate;
const apiPath = require.resolve("../utils/score-api");
require.cache[apiPath] = {
  id: apiPath, filename: apiPath, loaded: true,
  exports: {
    getScoreErrorMessage: (error) => error.message,
    createScoreRoom: (token, input) => {
      requests.push({ token, input });
      return submitCreate();
    },
  },
};
global.wx = {
  getStorageSync: (key) => storage[key] || "",
  setStorageSync: (key, value) => { storage[key] = value; },
  removeStorageSync: (key) => { delete storage[key]; },
  navigateTo: ({ url }) => navigations.push(url),
  hideKeyboard: () => undefined,
};
let definition;
global.Page = (page) => { definition = page; };
require("../pages/score/mahjong/index");

function createPage(data) {
  return { ...definition, data: { ...definition.data, ...data },
    setData(patch) { Object.assign(this.data, patch); } };
}
const event = (field, value) => ({ currentTarget: { dataset: { field } }, detail: { value } });
const result = () => ({ room: { id: "created-room" }, guestToken: "guest-token", actor: { participantId: "host-1" } });

test.beforeEach(() => {
  for (const key of Object.keys(storage)) delete storage[key];
  navigations.length = 0;
  requests.length = 0;
  submitCreate = async () => result();
});

test("moving between inline fields ignores an old blur and preserves edits", () => {
  const page = createPage();
  page.beginInlineEdit(event("roomName"));
  page.handleField(event("roomName", "周末老友局"));
  page.beginInlineEdit(event("roomPassword"));
  page.endInlineEdit(event("roomName"));
  assert.equal(page.data.editingField, "roomPassword");
  page.handleField(event("roomPassword", "2468"));
  page.endInlineEdit(event("roomPassword"));
  assert.equal(page.data.editingField, "");
  assert.equal(page.data.roomName, "周末老友局");
  assert.equal(page.data.roomPassword, "2468");
});

test("switching tabs finishes inline editing without discarding the values", () => {
  const page = createPage({ editingField: "roomName", roomName: "周末老友局" });
  page.switchMode({ currentTarget: { dataset: { mode: "join" } } });
  assert.equal(page.data.editingField, "");
  assert.equal(page.data.roomName, "周末老友局");
});

test("guest can create by filling only a nickname with the prepared name and password", async () => {
  const page = createPage();
  page.handleField(event("hostNickname", " 小林 "));
  await page.createRoom();
  assert.deepEqual(requests[0], { token: "", input: {
    name: "老友局", maxPlayers: 4, password: "666666", scene: "generic", gameType: "mahjong", displayName: "小林",
  } });
  assert.equal(navigations[0], "/pages/score/room/index?roomId=created-room&created=1");
  assert.equal(storage.funboxScoreSessionV1.participantId, "host-1");
});

test("creation while editing uses current values and saves the edited host password", async () => {
  const page = createPage({ hostNickname: "小林" });
  page.beginInlineEdit(event("roomName"));
  page.handleField(event("roomName", " 周末老友局 "));
  page.beginInlineEdit(event("roomPassword"));
  page.handleField(event("roomPassword", "024680"));
  await page.createRoom();
  assert.equal(requests[0].input.name, "周末老友局");
  assert.equal(requests[0].input.password, "024680");
  assert.equal(storage.funboxHostScoreRoomPasswordsV1["created-room"].password, "024680");
  assert.equal(page.data.editingField, "");
});

test("invalid inline values or missing nickname never submit a request", async () => {
  for (const data of [{ roomName: "  " }, { roomPassword: "" }, { roomPassword: "123" }, { roomPassword: "1234567" }, { roomPassword: "12ab" }, { hostNickname: "  " }]) {
    const page = createPage({ hostNickname: "小林", ...data });
    await page.createRoom();
    assert.ok(page.data.errorMessage);
  }
  assert.equal(requests.length, 0);
});

test("pending creation blocks repeated submission and changes to inline values", async () => {
  let finish;
  submitCreate = () => new Promise((resolve) => { finish = resolve; });
  const page = createPage({ hostNickname: "小林" });
  const pending = page.createRoom();
  page.beginInlineEdit(event("roomPassword"));
  page.handleField(event("roomPassword", "1234"));
  await page.createRoom();
  assert.equal(page.data.editingField, "");
  assert.equal(page.data.roomPassword, "666666");
  assert.equal(requests.length, 1);
  finish(result());
  await pending;
  assert.equal(page.data.creating, false);
});

test("authenticated nickname prefills, stays editable and can retry after creation fails", async () => {
  storage[ACCESS_TOKEN_STORAGE_KEY] = "account-token";
  storage.funboxUser = { displayName: "账号昵称" };
  const page = createPage();
  page.syncAuth();
  assert.equal(page.data.hostNickname, "账号昵称");
  page.handleField(event("hostNickname", "本局昵称"));
  page.syncAuth();
  assert.equal(page.data.hostNickname, "本局昵称");
  submitCreate = async () => { throw new Error("网络异常"); };
  await page.createRoom();
  assert.equal(page.data.creating, false);
  assert.equal(page.data.errorMessage, "网络异常");
  assert.equal(navigations.length, 0);
  submitCreate = async () => result();
  await page.createRoom();
  assert.equal(requests.at(-1).input.displayName, "本局昵称");
  assert.equal(requests.at(-1).token, "account-token");
  assert.equal(navigations.length, 1);
});
