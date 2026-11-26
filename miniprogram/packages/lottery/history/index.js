const { LOTTERY_GAMES, getGameMeta, decorateDraw } = require("../utils/lottery-format");
const { getCachedHistory, fetchGameHistory, lotteryErrorMessage } = require("../utils/lottery-api");

const PAGE_SIZE = 20;

function buildRangeChips(years = []) {
  const chips = [
    { key: "recent20", label: "近 20 期", year: "", pageLimit: 20 },
    { key: "recent50", label: "近 50 期", year: "", pageLimit: 50 },
  ];
  (years || []).forEach(y => {
    const label = `${y}年`;
    chips.push({ key: `year:${y}`, label, year: String(y), pageLimit: PAGE_SIZE });
  });
  return chips;
}

Page({
  data: {
    games: LOTTERY_GAMES,
    game: "ssq",
    gameMeta: getGameMeta("ssq"),
    issueInput: "",
    appliedIssue: "",
    activeRange: "recent20",
    selectedYear: "",
    pageLimit: PAGE_SIZE,
    rangeChips: buildRangeChips([]),
    draws: [],
    total: 0,
    hasMore: false,
    nextOffset: 0,
    loading: true,
    loadingMore: false,
    errorMessage: "",
    staleNotice: "",
    skeletonList: [1, 2, 3, 4],
  },

  onLoad(options = {}) {
    const meta = getGameMeta(options.game || "ssq");
    this.setData({
      game: meta.game,
      gameMeta: meta,
    });
    this.updateTitle(meta);
    this.hydrateFromCache(meta.game);
    this.fetchHistory({ reset: true, fromPullDown: false });
  },

  onPullDownRefresh() {
    this.fetchHistory({ reset: true, fromPullDown: true });
  },

  updateTitle(meta) {
    if (typeof wx.setNavigationBarTitle === "function") {
      wx.setNavigationBarTitle({ title: `${meta.shortName}历史开奖` });
    }
  },

  hydrateFromCache(game) {
    const cached = getCachedHistory(game);
    if (cached && Array.isArray(cached.draws) && cached.draws.length) {
      this.setData({
        draws: cached.draws.map(decorateDraw).filter(Boolean),
        total: cached.total || cached.draws.length,
        hasMore: Boolean(cached.hasMore),
        nextOffset: cached.nextOffset || cached.draws.length,
        rangeChips: buildRangeChips(cached.years || []),
        loading: false,
      });
    }
  },

  async fetchHistory({ reset = true, fromPullDown = false } = {}) {
    const { game, selectedYear, appliedIssue, pageLimit, nextOffset, draws } = this.data;
    const offset = reset ? 0 : nextOffset;
    const requestToken = (this._requestSeq || 0) + 1;
    this._requestSeq = requestToken;

    if (reset) {
      this.setData({
        loading: draws.length === 0,
        errorMessage: "",
      });
    } else {
      if (this.data.loadingMore || !this.data.hasMore) return;
      this.setData({ loadingMore: true });
    }

    try {
      const res = await fetchGameHistory(game, {
        limit: pageLimit,
        offset,
        year: selectedYear,
        issue: appliedIssue,
      });
      if (this._requestSeq !== requestToken) return;
      const incoming = (res.draws || []).map(decorateDraw).filter(Boolean);
      const merged = reset ? incoming : [...this.data.draws, ...incoming];
      const years = Array.isArray(res.years) ? res.years : [];
      const rangeChips = years.length ? buildRangeChips(years) : this.data.rangeChips;
      const staleNotice = res.fromCache
        ? "当前网络不可用，已展示上次缓存的历史记录。"
        : res.stale
          ? "官方数据源响应较慢，当前已优先展示缓存记录。"
          : "";
      this.setData({
        draws: merged,
        total: typeof res.total === "number" ? res.total : merged.length,
        hasMore: Boolean(res.hasMore),
        nextOffset: typeof res.nextOffset === "number" ? res.nextOffset : merged.length,
        rangeChips,
        loading: false,
        loadingMore: false,
        errorMessage: "",
        staleNotice,
      });
    } catch (error) {
      if (this._requestSeq !== requestToken) return;
      const msg = lotteryErrorMessage(error);
      if (reset && !this.data.draws.length) {
        this.setData({ loading: false, loadingMore: false, errorMessage: msg });
      } else {
        this.setData({ loading: false, loadingMore: false });
        wx.showToast({ title: msg, icon: "none" });
      }
    } finally {
      if (fromPullDown && typeof wx.stopPullDownRefresh === "function") {
        wx.stopPullDownRefresh();
      }
    }
  },

  selectGame(e) {
    const game = e.currentTarget.dataset.game;
    if (!game || game === this.data.game) return;
    const meta = getGameMeta(game);
    this.updateTitle(meta);
    this.setData({
      game: meta.game,
      gameMeta: meta,
      issueInput: "",
      appliedIssue: "",
      activeRange: "recent20",
      selectedYear: "",
      pageLimit: PAGE_SIZE,
      rangeChips: buildRangeChips([]),
      draws: [],
      total: 0,
      hasMore: false,
      nextOffset: 0,
      loading: true,
      errorMessage: "",
      staleNotice: "",
    });
    this.hydrateFromCache(meta.game);
    this.fetchHistory({ reset: true, fromPullDown: false });
  },

  onIssueInput(e) {
    this.setData({ issueInput: (e.detail && e.detail.value) || "" });
  },

  submitSearch() {
    const cleaned = String(this.data.issueInput || "").trim();
    this.setData({
      appliedIssue: cleaned,
      draws: [],
      hasMore: false,
      nextOffset: 0,
      loading: true,
    });
    this.fetchHistory({ reset: true, fromPullDown: false });
  },

  clearIssue() {
    if (!this.data.issueInput && !this.data.appliedIssue) return;
    this.setData({
      issueInput: "",
      appliedIssue: "",
      draws: [],
      hasMore: false,
      nextOffset: 0,
      loading: true,
    });
    this.fetchHistory({ reset: true, fromPullDown: false });
  },

  selectRange(e) {
    const key = e.currentTarget.dataset.key;
    const chip = this.data.rangeChips.find(item => item.key === key);
    if (!chip || key === this.data.activeRange) return;
    this.setData({
      activeRange: chip.key,
      selectedYear: chip.year,
      pageLimit: chip.pageLimit,
      draws: [],
      hasMore: false,
      nextOffset: 0,
      loading: true,
    });
    this.fetchHistory({ reset: true, fromPullDown: false });
  },

  resetFilters() {
    this.setData({
      issueInput: "",
      appliedIssue: "",
      activeRange: "recent20",
      selectedYear: "",
      pageLimit: PAGE_SIZE,
      draws: [],
      hasMore: false,
      nextOffset: 0,
      loading: true,
    });
    this.fetchHistory({ reset: true, fromPullDown: false });
  },

  loadMore() {
    this.fetchHistory({ reset: false, fromPullDown: false });
  },

  retryLoad() {
    this.fetchHistory({ reset: true, fromPullDown: false });
  },

  openDetail(e) {
    const issue = e.currentTarget.dataset.issue;
    if (!issue) return;
    wx.navigateTo({
      url: `/packages/lottery/detail/index?game=${encodeURIComponent(this.data.game)}&issue=${encodeURIComponent(issue)}`,
    });
  },

  onShareAppMessage() {
    return {
      title: `${this.data.gameMeta.name}历史开奖记录查询`,
      path: `/packages/lottery/history/index?game=${encodeURIComponent(this.data.game)}`,
    };
  },
});
