const test = require("node:test");
const assert = require("node:assert/strict");

let accessToken = "account-token";
let historyCalls = [];
let historyResponse = { rooms: [], total: 0, limit: 5, offset: 0 };
const redirects = [];

const authPath = require.resolve("../utils/auth");
require.cache[authPath] = {
  id: authPath,
  filename: authPath,
  loaded: true,
  exports: {
    clearSession() {
      accessToken = "";
    },
    getAccessToken: () => accessToken,
  },
};

const scoreAPIPath = require.resolve("../utils/score-api");
require.cache[scoreAPIPath] = {
  id: scoreAPIPath,
  filename: scoreAPIPath,
  loaded: true,
  exports: {
    getScoreErrorMessage: (error) => error.message,
    listScoreHistory: async (options) => {
      historyCalls.push(options);
      return historyResponse;
    },
  },
};

global.wx = {
  redirectTo(options) {
    redirects.push(options);
  },
  stopPullDownRefresh() {},
};

let pageDefinition;
global.Page = (definition) => {
  pageDefinition = definition;
};
require("../pages/game-history/index");

function createPage(data) {
  return {
    ...pageDefinition,
    data: { ...pageDefinition.data, ...data },
    setData(patch, callback) {
      this.data = { ...this.data, ...patch };
      if (callback) callback();
    },
  };
}

function room(index) {
  return {
    id: `room-${index}`,
    name: `牌局 ${index}`,
    gameType: "mahjong",
    settledAt: `2026-10-${String(20 + index).padStart(2, "0")}T08:30:00Z`,
    selfParticipantId: "participant-self",
    participants: [
      { id: "participant-self", displayName: "小李", totalPoints: index, amountCents: index * 100 },
    ],
  };
}

test("game history loads five records and exposes the next page", async () => {
  accessToken = "account-token";
  historyCalls = [];
  historyResponse = { rooms: [1, 2, 3, 4, 5].map(room), total: 12, limit: 5, offset: 0 };
  const page = createPage();
  await page.loadPage(1);

  assert.deepEqual(historyCalls[0], { limit: 5, offset: 0, from: "" });
  assert.equal(page.data.rooms.length, 5);
  assert.equal(page.data.total, 12);
  assert.equal(page.data.totalPages, 3);
  assert.equal(page.data.hasPrev, false);
  assert.equal(page.data.hasNext, true);

  historyResponse = { rooms: [6, 7, 8, 9, 10].map(room), total: 12, limit: 5, offset: 5 };
  await page.nextPage();
  assert.deepEqual(historyCalls[1], { limit: 5, offset: 5, from: "" });
  assert.equal(page.data.page, 2);
  assert.equal(page.data.hasPrev, true);
});

test("changing the time range resets to page one and sends an RFC3339 lower bound", async () => {
  accessToken = "account-token";
  historyCalls = [];
  historyResponse = { rooms: [], total: 0, limit: 5, offset: 0 };
  const page = createPage({ activeRange: "all", page: 2 });
  await page.changeRange({ currentTarget: { dataset: { range: "7d" } } });

  assert.equal(historyCalls.length, 1);
  assert.equal(historyCalls[0].limit, 5);
  assert.equal(historyCalls[0].offset, 0);
  assert.match(historyCalls[0].from, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(page.data.activeRange, "7d");
  assert.equal(page.data.page, 1);
});

test("game history redirects an expired session to login", () => {
  accessToken = "";
  redirects.length = 0;
  const page = createPage();
  page.onShow();
  assert.equal(redirects.length, 1);
  assert.match(redirects[0].url, /mode=login/);
  assert.match(redirects[0].url, /returnTo=/);
});
