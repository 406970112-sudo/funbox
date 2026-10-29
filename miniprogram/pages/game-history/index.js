const { clearSession, getAccessToken } = require("../../utils/auth");
const { getScoreErrorMessage, listScoreHistory } = require("../../utils/score-api");
const { buildHistoryItems } = require("../../utils/score-format");

const PAGE_SIZE = 5;
const TIME_RANGES = [
  { key: "all", label: "全部", days: 0 },
  { key: "7d", label: "近 7 天", days: 7 },
  { key: "30d", label: "近 30 天", days: 30 },
  { key: "90d", label: "近 90 天", days: 90 },
];

Page({
  data: {
    filters: TIME_RANGES,
    activeRange: "all",
    rooms: [],
    loading: false,
    errorMessage: "",
    page: 1,
    pageSize: PAGE_SIZE,
    total: 0,
    totalPages: 1,
    hasPrev: false,
    hasNext: false,
  },

  onShow() {
    if (!getAccessToken()) {
      this.redirectToAuth();
      return;
    }
    this.loadPage(this.data.page || 1);
  },

  onPullDownRefresh() {
    this.loadPage(this.data.page || 1).finally(() => wx.stopPullDownRefresh());
  },

  redirectToAuth() {
    if (this.redirecting) return;
    this.redirecting = true;
    clearSession();
    wx.redirectTo({
      url: `/pages/auth/index?mode=login&returnTo=${encodeURIComponent("/pages/game-history/index")}`,
    });
  },

  currentFrom() {
    const range = TIME_RANGES.find((item) => item.key === this.data.activeRange);
    if (!range || !range.days) return "";
    return new Date(Date.now() - range.days * 24 * 60 * 60 * 1000).toISOString();
  },

  async loadPage(page) {
    const safePage = Math.max(1, Math.trunc(Number(page) || 1));
    const requestID = (this.requestID || 0) + 1;
    this.requestID = requestID;
    this.setData({ loading: true, errorMessage: "" });
    try {
      const response = await listScoreHistory({
        limit: PAGE_SIZE,
        offset: (safePage - 1) * PAGE_SIZE,
        from: this.currentFrom(),
      });
      if (requestID !== this.requestID) return;
      const rooms = buildHistoryItems(response && response.rooms);
      const total = Math.max(0, Number(response && response.total) || 0);
      const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      this.setData({
        rooms,
        total,
        totalPages,
        page: safePage,
        hasPrev: safePage > 1,
        hasNext: safePage < totalPages,
      });
    } catch (error) {
      if (requestID !== this.requestID) return;
      if (error && error.statusCode === 401) {
        this.redirectToAuth();
        return;
      }
      this.setData({ rooms: [], errorMessage: getScoreErrorMessage(error) });
    } finally {
      if (requestID === this.requestID) this.setData({ loading: false });
    }
  },

  changeRange(event) {
    const activeRange = event.currentTarget.dataset.range;
    if (!activeRange || activeRange === this.data.activeRange) return Promise.resolve();
    this.setData({ activeRange, page: 1 });
    return this.loadPage(1);
  },

  previousPage() {
    if (!this.data.hasPrev || this.data.loading) return Promise.resolve();
    return this.loadPage(this.data.page - 1);
  },

  nextPage() {
    if (!this.data.hasNext || this.data.loading) return Promise.resolve();
    return this.loadPage(this.data.page + 1);
  },

  retryLoad() {
    this.loadPage(this.data.page || 1);
  },
});
