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
const createCalls = [];
const passwordSaves = [];
const scoreSessionSaves = [];
let scoreSessionClears = 0;
const navigateCalls = [];
const imageWriteCalls = [];
let accessToken = "";

const scoreAPI = require.resolve("../utils/score-api");
require.cache[scoreAPI] = {
  id: scoreAPI,
  filename: scoreAPI,
  loaded: true,
  exports: {
    createScoreRoom: async (token, input) => {
      createCalls.push({ token, input });
      return {
        room: { id: "room-1" },
        actor: { participantId: "participant-host" },
        ...(input.displayName ? { guestToken: "host-guest-token" } : {}),
      };
    },
    getScoreErrorMessage: (error) => error.message,
    getScoreRoom: async () => ({ room: {} }),
    issueScoreInviteCode: async () => ({ imageBase64: "jpeg", mediaType: "image/jpeg", width: 430 }),
    issueScoreInviteToken: async () => "token",
    joinScoreRoom: async (input) => {
      joinCalls.push(input);
      return {
        room: {
          id: "room-1", version: 2, status: "waiting", maxPlayers: 4,
          selfParticipantId: "participant-1",
          participants: [{ id: "participant-1", role: "guest", status: "active", displayName: input.displayName, totalPoints: 0 }],
        },
        guestToken: "guest-token",
        actor: { participantId: "participant-1" },
      };
    },
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
    getAccessToken: () => accessToken,
    getStoredUser: () => ({ displayName: "牌友" }),
  },
};
const session = require.resolve("../utils/score-session");
require.cache[session] = {
  id: session,
  filename: session,
  loaded: true,
  exports: {
    clearHostRoomPassword: () => undefined,
    clearScoreSession: () => { scoreSessionClears += 1; },
    credentialForRoom: () => null,
    getHostRoomPassword: () => "",
    getScoreSession: () => null,
    saveHostRoomPassword: (roomId, password) => passwordSaves.push({ roomId, password }),
    saveScoreSession: (value) => scoreSessionSaves.push(value),
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

test("room creation omits settlement pricing and saves the host password locally", async () => {
  accessToken = "host-token";
  createCalls.length = 0;
  passwordSaves.length = 0;
  scoreSessionClears = 0;
  const page = createPage(mahjongPage, {
    isLoggedIn: true,
    creating: false,
    roomName: "周五牌局",
    roomPassword: "2468",
    confirmPassword: "2468",
    errorMessage: "",
  });

  await page.createRoom();

  assert.deepEqual(createCalls, [{
    token: "host-token",
    input: {
      name: "周五牌局",
      maxPlayers: 4,
      password: "2468",
      scene: "generic",
      gameType: "mahjong",
    },
  }]);
  assert.deepEqual(passwordSaves, [{ roomId: "room-1", password: "2468" }]);
  assert.equal(scoreSessionClears, 1);
  accessToken = "";
});

test("anonymous room creation submits the guest host nickname and stores the participant session", async () => {
  accessToken = "";
  createCalls.length = 0;
  passwordSaves.length = 0;
  scoreSessionSaves.length = 0;
  scoreSessionClears = 0;
  navigateCalls.length = 0;
  const page = createPage(mahjongPage, {
    isLoggedIn: false,
    creating: false,
    roomName: "游客牌局",
    hostNickname: "游客房主",
    roomPassword: "2468",
    confirmPassword: "2468",
    errorMessage: "",
  });

  await page.createRoom();

  assert.deepEqual(createCalls, [{
    token: "",
    input: {
      name: "游客牌局",
      maxPlayers: 4,
      password: "2468",
      scene: "generic",
      gameType: "mahjong",
      displayName: "游客房主",
    },
  }]);
  assert.deepEqual(scoreSessionSaves, [{
    roomId: "room-1",
    guestToken: "host-guest-token",
    participantId: "participant-host",
  }]);
  assert.equal(scoreSessionClears, 0);
  assert.deepEqual(navigateCalls, ["/pages/score/room/index?roomId=room-1&created=1"]);
});

test("external scene preview and join use inviteScene", async () => {
  previewCalls.length = 0;
  joinCalls.length = 0;
  const page = createPage(roomPage, { loading: true });
  page.credential = null;
  page.startRealtime = () => undefined;
  page.startPolling = () => undefined;

  await page.prepareInviteScene("scene-1");
  assert.deepEqual(previewCalls, [{ inviteScene: "scene-1" }]);
  assert.equal(page.data.inviteScene, "scene-1");
  assert.equal(page.data.joinNeeded, true);

  page.data.joinNickname = "受邀牌友";
  await page.joinFromInvite();
  assert.deepEqual(joinCalls, [{ inviteScene: "scene-1", displayName: "受邀牌友" }]);
  assert.equal(page.data.room.id, "room-1");
  assert.equal(page.data.errorMessage, "");
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
