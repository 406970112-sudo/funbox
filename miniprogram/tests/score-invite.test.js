const test = require("node:test");
const assert = require("node:assert/strict");

const { extractInviteScene, extractInviteToken } = require("../utils/invite");

test("invite parsing keeps JWT paths and recognizes mini program scenes", () => {
  assert.equal(extractInviteToken("/pages/score/room/index?invite=a.b.c"), "a.b.c");
  assert.equal(extractInviteToken("/pages/score/room/index?scene=scene-1"), "");
  assert.equal(extractInviteScene("/pages/score/room/index?scene=scene-1"), "scene-1");
  assert.equal(extractInviteScene("/pages/score/room/index?from=share&scene=scene-3"), "scene-3");
  assert.equal(extractInviteScene("scene=scene%2D2&from=scan"), "scene-2");
  assert.equal(extractInviteScene("/pages/score/room/index?invite=a.b.c"), "");
});

const previewCalls = [];
const joinCalls = [];
const navigateCalls = [];
const imageWriteCalls = [];

const scoreAPI = require.resolve("../utils/score-api");
require.cache[scoreAPI] = {
  id: scoreAPI,
  filename: scoreAPI,
  loaded: true,
  exports: {
    createScoreRoom: async () => ({ room: { id: "room-1" } }),
    getScoreErrorMessage: (error) => error.message,
    getScoreRoom: async () => ({ room: {} }),
    issueScoreInviteCode: async () => ({ imageBase64: "jpeg", mediaType: "image/jpeg", width: 430 }),
    issueScoreInviteToken: async () => "token",
    joinScoreRoom: async (input) => {
      joinCalls.push(input);
      return {
        room: { id: "room-1" },
        guestToken: "guest-token",
        actor: { participantId: "participant-1" },
      };
    },
    listNearbyScoreRooms: async () => [],
    previewScoreInvite: async (inviteToken) => {
      previewCalls.push({ inviteToken });
      return { room: { id: "room-1", name: "牌局", code: "123456", centsPerPoint: 100, capPoints: 10, maxPlayers: 4 } };
    },
    previewScoreInviteScene: async (inviteScene) => {
      previewCalls.push({ inviteScene });
      return { room: { id: "room-1", name: "牌局", code: "123456", centsPerPoint: 100, capPoints: 10, maxPlayers: 4 } };
    },
    settleScoreRoom: async () => ({}),
    startScoreRoom: async () => ({}),
    submitScoreGifts: async () => ({}),
  },
};

const auth = require.resolve("../utils/auth");
require.cache[auth] = {
  id: auth,
  filename: auth,
  loaded: true,
  exports: {
    getAccessToken: () => "",
    getStoredUser: () => ({ displayName: "牌友" }),
  },
};
const session = require.resolve("../utils/score-session");
require.cache[session] = {
  id: session,
  filename: session,
  loaded: true,
  exports: {
    clearScoreSession: () => undefined,
    credentialForRoom: () => null,
    getScoreSession: () => null,
    saveScoreSession: () => undefined,
  },
};
const realtime = require.resolve("../utils/score-realtime");
require.cache[realtime] = {
  id: realtime,
  filename: realtime,
  loaded: true,
  exports: { connectScoreRealtime: () => () => undefined },
};
const scoreQR = require.resolve("../utils/score-qr");
require.cache[scoreQR] = {
  id: scoreQR,
  filename: scoreQR,
  loaded: true,
  exports: { drawScoreQRCode: () => undefined },
};

const pageDefinitions = [];
global.Page = (definition) => pageDefinitions.push(definition);
global.wx = {
  env: { USER_DATA_PATH: "/tmp" },
  getFileSystemManager: () => ({
    writeFile: (options) => {
      imageWriteCalls.push(options);
      options.success();
    },
    unlink: () => undefined,
  }),
  getWindowInfo: () => ({ windowWidth: 375, windowHeight: 667 }),
  navigateTo: ({ url }) => navigateCalls.push(url),
  scanCode: () => undefined,
  setClipboardData: () => undefined,
  getStorageSync: () => "",
};

require("../pages/score/room/index");
const roomPage = pageDefinitions[0];
require("../pages/score/mahjong/index");
const mahjongPage = pageDefinitions[1];

function createPage(definition, data) {
  return {
    ...definition,
    data: { ...definition.data, ...data },
    setData(patch, callback) {
      this.data = { ...this.data, ...patch };
      if (callback) callback();
    },
  };
}

test("external scene preview and join use inviteScene", async () => {
  previewCalls.length = 0;
  joinCalls.length = 0;
  const page = createPage(roomPage, { loading: true });
  page.credential = null;
  page.loadRoom = async () => undefined;

  await page.prepareInviteScene("scene-1");
  assert.deepEqual(previewCalls, [{ inviteScene: "scene-1" }]);
  assert.equal(page.data.inviteScene, "scene-1");
  assert.equal(page.data.joinNeeded, true);

  page.data.joinNickname = "受邀牌友";
  await page.joinFromInvite();
  assert.deepEqual(joinCalls, [{ inviteScene: "scene-1", displayName: "受邀牌友" }]);
});

test("QR image toggles between compact and expanded states", () => {
  const page = createPage(roomPage, { inviteToken: "token", qrImageSrc: "/tmp/qr.png", qrExpanded: false });
  page.toggleQrExpanded();
  assert.equal(page.data.qrExpanded, true);
  assert.ok(page.data.qrLargeSize > page.data.qrSize);
  page.toggleQrExpanded();
  assert.equal(page.data.qrExpanded, false);
});

test("WeChat invite image is stored with its JPEG media extension", async () => {
  imageWriteCalls.length = 0;
  const page = createPage(roomPage, {
    inviteToken: "token",
    isHost: true,
    room: { id: "room-1", status: "waiting" },
  });
  page.credential = { token: "host-token" };
  await page.ensureInviteCode();
  assert.equal(page.data.qrCodeLoading, false);
  assert.match(page.data.qrImageSrc, /\.jpg$/);
  assert.equal(imageWriteCalls[0].encoding, "base64");
});

test("internal scanner routes mini program code paths by scene", () => {
  navigateCalls.length = 0;
  const page = createPage(mahjongPage, {});
  let scanOptions;
  global.wx.scanCode = (options) => {
    scanOptions = options;
    options.success({ scanType: "WX_CODE", path: "pages/score/room/index?scene=scene-2" });
  };
  page.scanToJoin();
  assert.deepEqual(scanOptions.scanType, ["qrCode", "wxCode"]);
  assert.deepEqual(navigateCalls, ["/pages/score/room/index?scene=scene-2"]);
});
