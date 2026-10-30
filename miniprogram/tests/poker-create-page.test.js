const test = require("node:test");
const assert = require("node:assert/strict");

let definition;
global.Page = (page) => { definition = page; };
require("../pages/score/poker/index");

test("poker create page uses the agreed defaults and has no player cap field", () => {
  assert.equal(definition.data.maxPlayers, undefined);
  assert.equal(definition.data.rate, "1.00");
  assert.equal(definition.data.antePoints, "1");
  assert.equal(definition.data.maxBetPoints, "10");
  assert.equal(definition.data.compareThreshold, "3");
  assert.equal(definition.data.baoziBonusPoints, "10");
  assert.equal(definition.data.shunjinBonusPoints, "5");
});

test("poker create page submits an unlimited-player V2 room", () => {
  const page = { data: { ...definition.data, roomName: "老友局", hostNickname: "甲" } };
  const input = definition.buildCreateInput.call(page);
  assert.equal(input.maxPlayers, 0);
  assert.equal(input.centsPerPoint, 100);
  assert.deepEqual(input.zhaJinHuaSettings, {
    rulesVersion: 2,
    antePoints: 1,
    maxBetPoints: 10,
    compareThreshold: 3,
    baoziBonusPoints: 10,
    shunjinBonusPoints: 5,
  });
});
