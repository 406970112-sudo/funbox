const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const {
  LOTTERY_GAMES,
  getGameMeta,
  getTonightSchedule,
  formatYuanAmount,
  formatPrizeMoney,
  formatStakeCount,
  decorateDraw,
  getCheckerConfig,
  evaluateTicket,
} = require("../packages/lottery/utils/lottery-format");
const { lotteryErrorMessage } = require("../packages/lottery/utils/lottery-api");

function mountLotteryPage(relativePath, platform = {}, stubs = {}) {
  const filename = path.resolve(__dirname, "..", `${relativePath}.js`);
  let definition;
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    require(name) {
      return Object.hasOwn(stubs, name) ? stubs[name] : require(path.resolve(path.dirname(filename), name));
    },
    Page: value => { definition = value; },
    wx: platform,
    Date,
    console,
  });
  return { ...definition, data: { ...definition.data }, setData(patch) { Object.assign(this.data, patch); } };
}

test("lottery subpackage registers all three pages with complete files", () => {
  const root = path.resolve(__dirname, "..");
  const config = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8"));
  const sub = config.subPackages.find(item => item.root === "packages/lottery");
  assert.ok(sub);
  assert.deepEqual(sub.pages, ["index/index", "history/index", "detail/index"]);
  for (const page of sub.pages) {
    for (const ext of ["js", "json", "wxml", "wxss"]) {
      assert.equal(fs.existsSync(path.join(root, "packages/lottery", `${page}.${ext}`)), true, `${page}.${ext}`);
    }
  }
});

test("lottery format utilities cover all 7 games, amounts, and tonight schedule", () => {
  assert.equal(LOTTERY_GAMES.length, 7);
  assert.equal(getGameMeta("dlt").name, "超级大乐透");
  assert.equal(getGameMeta("unknown").game, "ssq");
  assert.equal(formatYuanAmount("2345000000"), "23.45 亿");
  assert.equal(formatYuanAmount("38500000"), "3,850 万");
  assert.equal(formatPrizeMoney("10000"), "10,000");
  assert.equal(formatStakeCount("12345"), "12,345 注");

  // 2026-11-26 is Thursday in Beijing -> SSQ + FC3D for CWL; PL3 + PL5 for Sporttery.
  const thursday = Date.parse("2026-11-26T10:00:00+08:00");
  const tonight = getTonightSchedule(thursday);
  assert.match(tonight.todayBadge, /11\.26 周四/);
  assert.match(tonight.cwlLine, /双色球/);
  assert.match(tonight.cwlLine, /福彩3D/);
  assert.match(tonight.sportLine, /排列3/);

  const decorated = decorateDraw({
    game: "ssq",
    issue: "2026032",
    date: "2026-03-24",
    front: ["03", "07", "12", "19", "25", "31"],
    back: ["08"],
    sales: "392100000",
    pool: "2180000000",
    prizeGrades: [{ grade: "一等奖", count: "5", money: "8420000" }],
  });
  assert.equal(decorated.balls.length, 8);
  assert.equal(decorated.poolText, "21.80 亿");
  assert.equal(decorated.prizeGrades[0].isTop, true);
});

test("local ticket checker accurately evaluates all 7 national games", () => {
  // 1. SSQ
  const ssqDraw = { front: ["03", "07", "12", "19", "25", "31"], back: ["08"] };
  assert.equal(evaluateTicket("ssq", ssqDraw, { front: ["03"], back: [] }).ready, false);
  assert.match(evaluateTicket("ssq", ssqDraw, { front: ["03", "07", "12", "19", "25", "31"], back: ["08"] }).badge, /一等奖/);
  assert.match(evaluateTicket("ssq", ssqDraw, { front: ["01", "02", "04", "05", "06", "09"], back: ["08"] }).badge, /六等奖/);
  assert.equal(evaluateTicket("ssq", ssqDraw, { front: ["01", "02", "04", "05", "06", "09"], back: ["01"] }).won, false);

  // 2. DLT
  const dltDraw = { front: ["05", "11", "18", "24", "33"], back: ["02", "09"] };
  assert.match(evaluateTicket("dlt", dltDraw, { front: ["05", "11", "18", "24", "33"], back: ["02", "09"] }).badge, /一等奖/);
  assert.match(evaluateTicket("dlt", dltDraw, { front: ["01", "02", "03", "04", "06"], back: ["02", "09"] }).badge, /九等奖/);

  // 3. FC3D & PL3 (direct + group3 + group6)
  assert.match(evaluateTicket("fc3d", { front: ["3", "5", "8"] }, { positions: ["3", "5", "8"] }).badge, /直选/);
  assert.match(evaluateTicket("fc3d", { front: ["3", "5", "8"] }, { positions: ["8", "3", "5"] }).badge, /组选六/);
  assert.match(evaluateTicket("pl3", { front: ["3", "3", "8"] }, { positions: ["8", "3", "3"] }).badge, /组选三/);

  // 4. PL5
  assert.match(evaluateTicket("pl5", { front: ["1", "2", "3", "4", "5"] }, { positions: ["1", "2", "3", "4", "5"] }).badge, /100,000/);
  assert.equal(evaluateTicket("pl5", { front: ["1", "2", "3", "4", "5"] }, { positions: ["1", "2", "3", "4", "9"] }).won, false);

  // 5. QXC
  assert.match(evaluateTicket("qxc", { front: ["1", "2", "3", "4", "5", "6"], back: ["12"] }, { positions: ["1", "2", "3", "4", "5", "6"], back: ["12"] }).badge, /一等奖/);
  assert.match(evaluateTicket("qxc", { front: ["1", "2", "3", "4", "5", "6"], back: ["12"] }, { positions: ["9", "9", "9", "9", "9", "9"], back: ["12"] }).badge, /六等奖/);

  // 6. QLC
  const qlcDraw = { front: ["01", "05", "09", "14", "18", "22", "29"], back: ["30"] };
  assert.match(evaluateTicket("qlc", qlcDraw, { front: ["01", "05", "09", "14", "18", "22", "30"] }).badge, /二等奖/);
  assert.equal(getCheckerConfig("qlc").frontCount, 7);
});

test("lottery error messages map backend codes cleanly", () => {
  assert.match(lotteryErrorMessage({ data: { error: "lottery_game_not_found" } }), /不支持/);
  assert.match(lotteryErrorMessage({ data: { error: "lottery_issue_not_found" } }), /未找到/);
  assert.match(lotteryErrorMessage({ data: { error: "lottery_source_unavailable" } }), /繁忙/);
});

test("lottery detail page toggles local checker balls and computes hits", async () => {
  const sampleRes = {
    game: "ssq",
    org: "cwl",
    orgName: "福彩",
    name: "双色球",
    sourceName: "中国福彩网",
    sourceUrl: "https://www.cwl.gov.cn",
    prevIssue: "2026031",
    nextIssue: "",
    draw: {
      game: "ssq",
      issue: "2026032",
      date: "2026-03-24",
      front: ["03", "07", "12", "19", "25", "31"],
      back: ["08"],
      sales: "392100000",
      pool: "2180000000",
      prizeGrades: [],
    },
  };
  const page = mountLotteryPage(
    "packages/lottery/detail/index",
    { setNavigationBarTitle() {}, showToast() {} },
    {
      "../utils/lottery-api": {
        fetchIssueDetail: async () => sampleRes,
        lotteryErrorMessage,
      },
    }
  );
  await page.onLoad({ game: "ssq", issue: "2026032" });
  assert.equal(page.data.draw.issue, "2026032");
  for (const num of ["03", "07", "12", "19", "25", "31"]) {
    page.togglePoolBall({ currentTarget: { dataset: { area: "front", num } } });
  }
  page.togglePoolBall({ currentTarget: { dataset: { area: "back", num: "08" } } });
  assert.equal(page.data.checker.evalResult.won, true);
  assert.match(page.data.checker.evalResult.badge, /一等奖/);
  page.clearChecker();
  assert.equal(page.data.checker.hasAnySelection, false);
});
