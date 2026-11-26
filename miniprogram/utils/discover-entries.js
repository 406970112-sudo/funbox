const { getHolidayCard, watchHolidayCalendar } = require("./holiday-calendar");

const RECENT_KEY = "funbox.discover.recent.v1";

const paths = {
  all: "/pages/discover/index",
  notebook: "/packages/notebook/index/index",
  memes: "/packages/meme/library/index",
  holidays: "/packages/discover/holidays/index",
  lottery: "/packages/lottery/index/index",
};

const TOOL_CATALOG = [
  { id: "lottery", title: "开奖查询", category: "life", shortLabel: "开奖查询" },
  { id: "holidays", title: "节假日倒计时", category: "life", shortLabel: "节假日" },
  { id: "notebook", title: "笔记本", category: "notes", shortLabel: "笔记本" },
  { id: "memes", title: "表情包", category: "fun", shortLabel: "表情包" },
];

function discoverPath(entry, loggedIn = false) {
  const path = paths[entry];
  return entry === "notebook" && !loggedIn
    ? `/pages/auth/index?mode=login&returnTo=${encodeURIComponent(path)}`
    : path;
}

function recordRecentTool(id) {
  if (!TOOL_CATALOG.some(item => item.id === id)) return;
  try {
    if (typeof wx === "undefined" || typeof wx.getStorageSync !== "function") return;
    const saved = wx.getStorageSync(RECENT_KEY);
    const list = Array.isArray(saved) ? saved.filter(item => item !== id && TOOL_CATALOG.some(t => t.id === item)) : [];
    const next = [id, ...list].slice(0, 4);
    wx.setStorageSync(RECENT_KEY, next);
  } catch (error) {
    // Ignore storage errors on restricted runtimes.
  }
}

function getRecentTools() {
  try {
    if (typeof wx === "undefined" || typeof wx.getStorageSync !== "function") return [];
    const saved = wx.getStorageSync(RECENT_KEY);
    if (!Array.isArray(saved)) return [];
    return saved
      .map(id => TOOL_CATALOG.find(item => item.id === id))
      .filter(Boolean)
      .slice(0, 4);
  } catch (error) {
    return [];
  }
}

function watchHolidayCard(page) {
  return watchHolidayCalendar(({ calendar, now }) => {
    page.setData({ holidayCard: getHolidayCard(calendar, now) });
  });
}

module.exports = { discoverPath, watchHolidayCard, recordRecentTool, getRecentTools, TOOL_CATALOG };
