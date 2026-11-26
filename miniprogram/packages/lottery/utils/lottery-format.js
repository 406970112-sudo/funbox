const DAY = 24 * 60 * 60 * 1000;
const BEIJING_OFFSET = 8 * 60 * 60 * 1000;
const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const PINS_KEY = "funbox.lottery.pins.v1";

const LOTTERY_GAMES = [
  {
    game: "ssq",
    org: "cwl",
    orgName: "福彩",
    name: "双色球",
    shortName: "双色球",
    schedule: "每周二、四、日 21:15",
    shortSchedule: "二·四·日",
    drawTime: "21:15",
    weekdays: [0, 2, 4],
    mode: "pool",
    frontLabel: "红球",
    backLabel: "蓝球",
    frontCount: 6,
    backCount: 1,
    frontMax: 33,
    backMax: 16,
    frontKind: "red",
    backKind: "blue",
  },
  {
    game: "dlt",
    org: "sport",
    orgName: "体彩",
    name: "超级大乐透",
    shortName: "大乐透",
    schedule: "每周一、三、六 21:25",
    shortSchedule: "一·三·六",
    drawTime: "21:25",
    weekdays: [1, 3, 6],
    mode: "pool",
    frontLabel: "前区",
    backLabel: "后区",
    frontCount: 5,
    backCount: 2,
    frontMax: 35,
    backMax: 12,
    frontKind: "blue",
    backKind: "amber",
  },
  {
    game: "fc3d",
    org: "cwl",
    orgName: "福彩",
    name: "福彩 3D",
    shortName: "福彩3D",
    schedule: "每日 21:15",
    shortSchedule: "每日开奖",
    drawTime: "21:15",
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    mode: "positional",
    positions: ["百位", "十位", "个位"],
    frontKind: "digit",
  },
  {
    game: "pl3",
    org: "sport",
    orgName: "体彩",
    name: "排列 3",
    shortName: "排列3",
    schedule: "每日 21:25",
    shortSchedule: "每日开奖",
    drawTime: "21:25",
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    mode: "positional",
    positions: ["百位", "十位", "个位"],
    frontKind: "digit",
  },
  {
    game: "pl5",
    org: "sport",
    orgName: "体彩",
    name: "排列 5",
    shortName: "排列5",
    schedule: "每日 21:25",
    shortSchedule: "每日开奖",
    drawTime: "21:25",
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    mode: "positional",
    positions: ["万位", "千位", "百位", "十位", "个位"],
    frontKind: "digit",
  },
  {
    game: "qxc",
    org: "sport",
    orgName: "体彩",
    name: "七星彩",
    shortName: "七星彩",
    schedule: "每周二、五、日 21:25",
    shortSchedule: "二·五·日",
    drawTime: "21:25",
    weekdays: [0, 2, 5],
    mode: "qxc",
    positions: ["第1位", "第2位", "第3位", "第4位", "第5位", "第6位"],
    backLabel: "后区(0–14)",
    backMax: 14,
    frontKind: "digit",
    backKind: "amber",
  },
  {
    game: "qlc",
    org: "cwl",
    orgName: "福彩",
    name: "七乐彩",
    shortName: "七乐彩",
    schedule: "每周一、三、五 21:15",
    shortSchedule: "一·三·五",
    drawTime: "21:15",
    weekdays: [1, 3, 5],
    mode: "pool",
    frontLabel: "选号(7个)",
    backLabel: "",
    frontCount: 7,
    backCount: 0,
    frontMax: 30,
    backMax: 0,
    frontKind: "red",
    backKind: "blue",
  },
];

function getGameMeta(game) {
  const key = String(game || "").toLowerCase();
  return LOTTERY_GAMES.find(item => item.game === key) || LOTTERY_GAMES[0];
}

function beijingDateParts(now = Date.now()) {
  const d = new Date(now + BEIJING_OFFSET);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    weekday: d.getUTCDay(),
  };
}

function getTonightSchedule(now = Date.now()) {
  const { month, day, weekday } = beijingDateParts(now);
  const cwlNames = LOTTERY_GAMES.filter(g => g.org === "cwl" && g.weekdays.includes(weekday)).map(g => g.shortName);
  const sportNames = LOTTERY_GAMES.filter(g => g.org === "sport" && g.weekdays.includes(weekday)).map(g => g.shortName);
  return {
    todayBadge: `${month}.${day} ${WEEKDAYS[weekday]}`,
    cwlLine: cwlNames.length ? `今晚 21:15 福彩 · ${cwlNames.join(" / ")}` : "今晚福彩无开奖",
    sportLine: sportNames.length ? `今晚 21:25 体彩 · ${sportNames.join(" / ")}` : "今晚体彩无开奖",
  };
}

function weekdayOfDate(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ""))) return "";
  const ts = Date.parse(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(ts)) return "";
  return WEEKDAYS[new Date(ts).getUTCDay()];
}

function formatDrawDate(dateStr, compact = false) {
  const text = String(dateStr || "").trim();
  const week = weekdayOfDate(text);
  if (!text) return "";
  if (compact && text.length >= 10) {
    return `${text.slice(5)}${week ? ` (${week})` : ""}`;
  }
  return `${text}${week ? `（${week}）` : ""}`;
}

function addCommas(numStr) {
  const parts = String(numStr).split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return parts.join(".");
}

function formatYuanAmount(raw) {
  const cleaned = String(raw || "").replace(/,/g, "").trim();
  if (!cleaned || cleaned === "-" || cleaned === "--") return "";
  const val = Number(cleaned);
  if (!Number.isFinite(val) || val <= 0) return "";
  if (val >= 1e8) return `${(val / 1e8).toFixed(2)} 亿`;
  if (val >= 1e4) return `${addCommas(Math.round(val / 1e4))} 万`;
  return addCommas(Math.round(val));
}

function formatPrizeMoney(raw) {
  const cleaned = String(raw || "").replace(/,/g, "").trim();
  if (!cleaned || cleaned === "-" || cleaned === "--") return "—";
  const val = Number(cleaned);
  if (!Number.isFinite(val)) return cleaned;
  return addCommas(Math.round(val));
}

function formatStakeCount(raw) {
  const cleaned = String(raw || "").replace(/,/g, "").trim();
  if (!cleaned || cleaned === "-" || cleaned === "--") return "—";
  const val = Number(cleaned);
  if (!Number.isFinite(val)) return cleaned;
  return `${addCommas(Math.round(val))} 注`;
}

function buildDisplayBalls(game, front = [], back = []) {
  const meta = getGameMeta(game);
  const balls = (front || []).map((n, index) => ({
    key: `f-${index}`,
    n: String(n),
    kind: meta.frontKind || "red",
  }));
  if (Array.isArray(back) && back.length > 0) {
    balls.push({ key: "sep", sep: true });
    back.forEach((n, index) => {
      balls.push({
        key: `b-${index}`,
        n: String(n),
        kind: meta.backKind || "blue",
      });
    });
  }
  return balls;
}

function computeDigitSum(game, front = []) {
  if (!["fc3d", "pl3", "pl5"].includes(game) || !front.length) return "";
  const sum = front.reduce((acc, item) => acc + (Number(item) || 0), 0);
  return `和值 ${sum}`;
}

function decorateDraw(draw) {
  if (!draw) return null;
  const meta = getGameMeta(draw.game);
  const balls = buildDisplayBalls(meta.game, draw.front, draw.back);
  const salesText = formatYuanAmount(draw.sales);
  const poolText = formatYuanAmount(draw.pool);
  const sumText = computeDigitSum(meta.game, draw.front);
  const prizeGrades = (draw.prizeGrades || []).map((item, idx) => ({
    key: `${idx}-${item.grade}`,
    grade: item.grade,
    countText: formatStakeCount(item.count),
    moneyText: formatPrizeMoney(item.money),
    isTop: idx === 0,
  }));
  return {
    ...draw,
    org: draw.org || meta.org,
    orgName: draw.orgName || meta.orgName,
    name: draw.name || meta.name,
    schedule: draw.schedule || meta.schedule,
    shortSchedule: meta.shortSchedule,
    dateWithWeek: formatDrawDate(draw.date, false),
    compactDate: formatDrawDate(draw.date, true),
    salesText,
    poolText,
    sumText,
    balls,
    compactBalls: balls.length >= 8,
    prizeGrades,
  };
}

function getPinnedGames() {
  try {
    if (typeof wx === "undefined" || typeof wx.getStorageSync !== "function") return ["ssq", "dlt"];
    const saved = wx.getStorageSync(PINS_KEY);
    if (Array.isArray(saved)) return saved.filter(id => LOTTERY_GAMES.some(g => g.game === id));
  } catch (error) {
    // Fallback to defaults.
  }
  return ["ssq", "dlt"];
}

function togglePinnedGame(game) {
  const current = getPinnedGames();
  const next = current.includes(game)
    ? current.filter(item => item !== game)
    : [game, ...current];
  try {
    if (typeof wx !== "undefined" && typeof wx.setStorageSync === "function") {
      wx.setStorageSync(PINS_KEY, next);
    }
  } catch (error) {
    // Keep memory state.
  }
  return next;
}

// --- Complete Local Ticket Checker (100% client-side, zero predictions) ---

function makeNumberRange(start, end, padTwo) {
  const out = [];
  for (let i = start; i <= end; i += 1) {
    out.push(padTwo ? String(i).padStart(2, "0") : String(i));
  }
  return out;
}

function getCheckerConfig(game) {
  const meta = getGameMeta(game);
  if (meta.mode === "pool") {
    return {
      mode: "pool",
      frontLabel: meta.frontLabel,
      backLabel: meta.backLabel,
      frontCount: meta.frontCount,
      backCount: meta.backCount,
      frontNumbers: makeNumberRange(1, meta.frontMax, true),
      backNumbers: meta.backMax > 0 ? makeNumberRange(1, meta.backMax, true) : [],
      frontKind: meta.frontKind,
      backKind: meta.backKind,
    };
  }
  if (meta.mode === "qxc") {
    return {
      mode: "qxc",
      positions: meta.positions,
      digitNumbers: makeNumberRange(0, 9, false),
      backLabel: meta.backLabel,
      backNumbers: makeNumberRange(0, 14, false),
    };
  }
  return {
    mode: "positional",
    positions: meta.positions,
    digitNumbers: makeNumberRange(0, 9, false),
  };
}

function normalizeBallStr(val, padTwo) {
  const n = Number(String(val || "").trim());
  if (!Number.isFinite(n)) return String(val || "").trim();
  return padTwo ? String(n).padStart(2, "0") : String(n);
}

function evaluateTicket(game, draw, selection = {}) {
  if (!draw) return { ready: false, won: false, badge: "待选号", summary: "点选你已购彩票上的号码进行本地核对" };
  const meta = getGameMeta(game);

  if (meta.game === "ssq") {
    const pickedFront = (selection.front || []).map(v => normalizeBallStr(v, true));
    const pickedBack = (selection.back || []).map(v => normalizeBallStr(v, true));
    if (pickedFront.length < 6 || pickedBack.length < 1) {
      return {
        ready: false,
        won: false,
        badge: `还差 ${Math.max(0, 6 - pickedFront.length)} 红 ${Math.max(0, 1 - pickedBack.length)} 蓝`,
        summary: `已选 ${pickedFront.length}/6 个红球、${pickedBack.length}/1 个蓝球`,
      };
    }
    const drawReds = new Set((draw.front || []).map(v => normalizeBallStr(v, true)));
    const drawBlue = normalizeBallStr((draw.back || [])[0], true);
    const redHits = pickedFront.filter(v => drawReds.has(v)).length;
    const blueHit = pickedBack[0] === drawBlue;
    let badge = "未中奖 · 感谢公益";
    let won = true;
    if (redHits === 6 && blueHit) badge = "一等奖（浮动奖金）";
    else if (redHits === 6) badge = "二等奖（浮动奖金）";
    else if (redHits === 5 && blueHit) badge = "三等奖 ¥3,000";
    else if (redHits === 5 || (redHits === 4 && blueHit)) badge = "四等奖 ¥200";
    else if (redHits === 4 || (redHits === 3 && blueHit)) badge = "五等奖 ¥10";
    else if (blueHit) badge = "六等奖 ¥5";
    else won = false;
    return { ready: true, won, badge, summary: `命中 ${redHits} 红 + ${blueHit ? 1 : 0} 蓝（纯本地核对）` };
  }

  if (meta.game === "dlt") {
    const pickedFront = (selection.front || []).map(v => normalizeBallStr(v, true));
    const pickedBack = (selection.back || []).map(v => normalizeBallStr(v, true));
    if (pickedFront.length < 5 || pickedBack.length < 2) {
      return {
        ready: false,
        won: false,
        badge: `还差 ${Math.max(0, 5 - pickedFront.length)} 前 ${Math.max(0, 2 - pickedBack.length)} 后`,
        summary: `已选 ${pickedFront.length}/5 个前区、${pickedBack.length}/2 个后区`,
      };
    }
    const drawFront = new Set((draw.front || []).map(v => normalizeBallStr(v, true)));
    const drawBack = new Set((draw.back || []).map(v => normalizeBallStr(v, true)));
    const f = pickedFront.filter(v => drawFront.has(v)).length;
    const b = pickedBack.filter(v => drawBack.has(v)).length;
    let badge = "未中奖 · 感谢公益";
    let won = true;
    if (f === 5 && b === 2) badge = "一等奖（浮动奖金）";
    else if (f === 5 && b === 1) badge = "二等奖（浮动奖金）";
    else if (f === 5 && b === 0) badge = "三等奖 ¥10,000";
    else if (f === 4 && b === 2) badge = "四等奖 ¥3,000";
    else if (f === 4 && b === 1) badge = "五等奖 ¥300";
    else if (f === 3 && b === 2) badge = "六等奖 ¥200";
    else if (f === 4 && b === 0) badge = "七等奖 ¥100";
    else if ((f === 3 && b === 1) || (f === 2 && b === 2)) badge = "八等奖 ¥15";
    else if (f === 3 || (f === 1 && b === 2) || (f === 2 && b === 1) || b === 2) badge = "九等奖 ¥5";
    else won = false;
    return { ready: true, won, badge, summary: `命中前区 ${f} 个 + 后区 ${b} 个（纯本地核对）` };
  }

  if (meta.game === "qlc") {
    const picked = (selection.front || []).map(v => normalizeBallStr(v, true));
    if (picked.length < 7) {
      return { ready: false, won: false, badge: `还差 ${7 - picked.length} 个号码`, summary: `已选 ${picked.length}/7 个号码` };
    }
    const basics = new Set((draw.front || []).map(v => normalizeBallStr(v, true)));
    const special = normalizeBallStr((draw.back || [])[0], true);
    const basicHits = picked.filter(v => basics.has(v)).length;
    const specialHit = picked.includes(special);
    let badge = "未中奖 · 感谢公益";
    let won = true;
    if (basicHits === 7) badge = "一等奖（浮动奖金）";
    else if (basicHits === 6 && specialHit) badge = "二等奖（浮动奖金）";
    else if (basicHits === 6) badge = "三等奖（浮动奖金）";
    else if (basicHits === 5 && specialHit) badge = "四等奖 ¥200";
    else if (basicHits === 5) badge = "五等奖 ¥50";
    else if (basicHits === 4 && specialHit) badge = "六等奖 ¥10";
    else if (basicHits === 4) badge = "七等奖 ¥5";
    else won = false;
    return { ready: true, won, badge, summary: `命中基本号 ${basicHits} 个${specialHit ? " + 特别号" : ""}（纯本地核对）` };
  }

  if (meta.game === "fc3d" || meta.game === "pl3") {
    const digits = selection.positions || [];
    if (digits.length < 3 || digits.some(v => v === "" || v == null)) {
      return { ready: false, won: false, badge: "请选择 3 位数字", summary: "分别点选百位、十位、个位数字" };
    }
    const target = (draw.front || []).map(v => normalizeBallStr(v, false));
    const picked = digits.slice(0, 3).map(v => normalizeBallStr(v, false));
    if (picked.join("") === target.join("")) {
      return { ready: true, won: true, badge: "命中直选 ¥1,040", summary: "三位数字及顺序完全一致（纯本地核对）" };
    }
    const sortedPicked = [...picked].sort().join("");
    const sortedTarget = [...target].sort().join("");
    if (sortedPicked === sortedTarget) {
      const uniqueCount = new Set(target).size;
      if (uniqueCount === 2) {
        return { ready: true, won: true, badge: "命中组选三 ¥346", summary: "数字组合一致，组三玩法中奖（纯本地核对）" };
      }
      if (uniqueCount === 3) {
        return { ready: true, won: true, badge: "命中组选六 ¥173", summary: "数字组合一致，组六玩法中奖（纯本地核对）" };
      }
    }
    return { ready: true, won: false, badge: "未中奖 · 感谢公益", summary: `所选 ${picked.join(" ")} 未命中直选/组选` };
  }

  if (meta.game === "pl5") {
    const digits = selection.positions || [];
    if (digits.length < 5 || digits.some(v => v === "" || v == null)) {
      return { ready: false, won: false, badge: "请选择 5 位数字", summary: "依次点选万位至个位数字" };
    }
    const target = (draw.front || []).map(v => normalizeBallStr(v, false));
    const picked = digits.slice(0, 5).map(v => normalizeBallStr(v, false));
    const exactHits = picked.filter((v, idx) => v === target[idx]).length;
    if (exactHits === 5) {
      return { ready: true, won: true, badge: "一等奖 ¥100,000", summary: "五位数字及顺序完全一致（纯本地核对）" };
    }
    return { ready: true, won: false, badge: "未中奖 · 感谢公益", summary: `按位命中 ${exactHits}/5 位（排列 5 需 5 位全中）` };
  }

  if (meta.game === "qxc") {
    const digits = selection.positions || [];
    const back = selection.back && selection.back[0];
    if (digits.length < 6 || digits.some(v => v === "" || v == null) || back === "" || back == null) {
      return { ready: false, won: false, badge: "请选择 6+1 号码", summary: "前区选 6 位（0–9），后区选 1 位（0–14）" };
    }
    const targetFront = (draw.front || []).map(v => normalizeBallStr(v, false));
    const targetBack = normalizeBallStr((draw.back || [])[0], false);
    const f = digits.slice(0, 6).filter((v, idx) => normalizeBallStr(v, false) === targetFront[idx]).length;
    const b = normalizeBallStr(back, false) === targetBack;
    let badge = "未中奖 · 感谢公益";
    let won = true;
    if (f === 6 && b) badge = "一等奖（浮动奖金）";
    else if (f === 6) badge = "二等奖（浮动奖金）";
    else if (f === 5 && b) badge = "三等奖 ¥3,000";
    else if (f === 5 || (f === 4 && b)) badge = "四等奖 ¥500";
    else if (f === 4 || (f === 3 && b)) badge = "五等奖 ¥30";
    else if (f === 3 || (f === 2 && b) || (f === 1 && b) || b) badge = "六等奖 ¥5";
    else won = false;
    return { ready: true, won, badge, summary: `前区按位命中 ${f} 位 + 后区 ${b ? "命中" : "未中"}（纯本地核对）` };
  }

  return { ready: false, won: false, badge: "待核对", summary: "" };
}

module.exports = {
  LOTTERY_GAMES,
  getGameMeta,
  getTonightSchedule,
  formatDrawDate,
  formatYuanAmount,
  formatPrizeMoney,
  formatStakeCount,
  buildDisplayBalls,
  decorateDraw,
  getPinnedGames,
  togglePinnedGame,
  getCheckerConfig,
  evaluateTicket,
};
