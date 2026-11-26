const { recordRecentTool } = require("../../../utils/discover-entries");
const {
  LOTTERY_GAMES,
  getTonightSchedule,
  decorateDraw,
  getPinnedGames,
  togglePinnedGame,
} = require("../utils/lottery-format");
const { getCachedLatest, fetchLatestDraws, lotteryErrorMessage } = require("../utils/lottery-api");

const ORG_TABS = [
  { key: "all", label: "全部" },
  { key: "cwl", label: "福利彩票" },
  { key: "sport", label: "体育彩票" },
];

function buildGameCards(rawGames, pinnedList, activeOrg) {
  const map = new Map();
  (rawGames || []).forEach(item => {
    if (item && item.game) map.set(item.game, item);
  });

  const pinnedSet = new Set(pinnedList || []);
  const cards = LOTTERY_GAMES.map(meta => {
    const remote = map.get(meta.game) || {};
    const latest = remote.latest ? decorateDraw({ ...remote.latest, game: meta.game, org: meta.org, orgName: meta.orgName, name: meta.name }) : null;
    const pinned = pinnedSet.has(meta.game);
    let metricText = meta.schedule;
    if (latest) {
      if (latest.poolText) metricText = `奖池 ${latest.poolText}`;
      else if (latest.sumText) metricText = latest.sumText;
      else if (latest.salesText) metricText = `销量 ${latest.salesText}`;
    }
    return {
      game: meta.game,
      org: meta.org,
      orgName: meta.orgName,
      name: meta.name,
      shortSchedule: meta.shortSchedule,
      schedule: meta.schedule,
      pinned,
      available: Boolean(remote.available && latest),
      stale: Boolean(remote.stale),
      latest,
      metricText,
    };
  });

  const filtered = activeOrg === "all" ? cards : cards.filter(item => item.org === activeOrg);
  filtered.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return 0;
  });
  return filtered;
}

Page({
  data: {
    orgTabs: ORG_TABS,
    activeOrg: "all",
    tonight: getTonightSchedule(),
    loading: true,
    errorMessage: "",
    staleNotice: "",
    cards: [],
    pinnedGames: [],
    rawGames: [],
    skeletonList: [1, 2, 3],
  },

  onLoad() {
    recordRecentTool("lottery");
    const pinnedGames = getPinnedGames();
    const cached = getCachedLatest();
    if (cached && Array.isArray(cached.games) && cached.games.length) {
      this.setData({
        pinnedGames,
        rawGames: cached.games,
        cards: buildGameCards(cached.games, pinnedGames, "all"),
        loading: false,
      });
    } else {
      this.setData({ pinnedGames });
    }
    this.loadLatest(false);
  },

  onPullDownRefresh() {
    this.loadLatest(true);
  },

  async loadLatest(fromPullDown) {
    const hasExisting = this.data.cards.length > 0;
    if (!hasExisting) {
      this.setData({ loading: true, errorMessage: "" });
    } else {
      this.setData({ errorMessage: "" });
    }
    try {
      const data = await fetchLatestDraws();
      const rawGames = Array.isArray(data.games) ? data.games : [];
      const pinnedGames = this.data.pinnedGames.length ? this.data.pinnedGames : getPinnedGames();
      const staleNotice = data.fromCache
        ? "当前网络不可用，已展示上次缓存的开奖公告，下拉可重新同步。"
        : data.stale
          ? "部分官方彩种数据源响应较慢，当前已优先展示最近同步数据。"
          : "";
      this.setData({
        rawGames,
        pinnedGames,
        cards: buildGameCards(rawGames, pinnedGames, this.data.activeOrg),
        tonight: getTonightSchedule(),
        loading: false,
        errorMessage: "",
        staleNotice,
      });
    } catch (error) {
      this.setData({
        loading: false,
        errorMessage: this.data.cards.length ? "" : lotteryErrorMessage(error),
        staleNotice: this.data.cards.length ? "刷新失败，当前展示本地缓存数据，可稍后下拉重试。" : "",
      });
    } finally {
      if (fromPullDown && typeof wx.stopPullDownRefresh === "function") {
        wx.stopPullDownRefresh();
      }
    }
  },

  selectOrg(e) {
    const org = e.currentTarget.dataset.org || "all";
    if (org === this.data.activeOrg) return;
    this.setData({
      activeOrg: org,
      cards: buildGameCards(this.data.rawGames, this.data.pinnedGames, org),
    });
  },

  togglePin(e) {
    const game = e.currentTarget.dataset.game;
    if (!game) return;
    const pinnedGames = togglePinnedGame(game);
    const pinned = pinnedGames.includes(game);
    this.setData({
      pinnedGames,
      cards: buildGameCards(this.data.rawGames, pinnedGames, this.data.activeOrg),
    });
    wx.showToast({ title: pinned ? "已置顶该彩种" : "已取消置顶", icon: "none", duration: 1200 });
  },

  openHistory(e) {
    const game = e.currentTarget.dataset.game || "ssq";
    wx.navigateTo({ url: `/packages/lottery/history/index?game=${encodeURIComponent(game)}` });
  },

  openDetail(e) {
    const { game, issue } = e.currentTarget.dataset;
    if (!game) return;
    const targetIssue = issue || "latest";
    wx.navigateTo({
      url: `/packages/lottery/detail/index?game=${encodeURIComponent(game)}&issue=${encodeURIComponent(targetIssue)}`,
    });
  },

  retryLoad() {
    this.loadLatest(false);
  },

  onShareAppMessage() {
    return {
      title: "福彩 · 体彩最新官方开奖公告与历史查询",
      path: "/packages/lottery/index/index",
    };
  },
});
