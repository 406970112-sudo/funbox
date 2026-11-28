const { getAccessToken } = require("../../../utils/auth");
const { getFeedbackErrorMessage, listMyFeedback } = require("../../../utils/feedback-api");
const { buildRecord, redirectToFeedbackLogin } = require("../records");

const PAGE_SIZE = 20;
const HISTORY_PATH = "/pages/feedback/history/index";
const EMPTY_PAGE = { items: [], unreadCount: 0, page: 1, totalPages: 1 };

Page({
  data: { ...EMPTY_PAGE, loading: false, errorMessage: "" },

  onShow() {
    return this.loadPage(this.data.page);
  },

  onPullDownRefresh() {
    return this.loadPage(this.data.page).finally(() => wx.stopPullDownRefresh());
  },

  onUnload() {
    this.requestID = (this.requestID || 0) + 1;
  },

  redirectToLogin() {
    this.setData(EMPTY_PAGE);
    redirectToFeedbackLogin(this, HISTORY_PATH);
  },

  async loadPage(page) {
    const token = getAccessToken();
    if (!token) {
      this.redirectToLogin();
      return;
    }
    if (token !== this.sessionToken) {
      this.sessionToken = token;
      page = 1;
      this.setData(EMPTY_PAGE);
    }
    this.requestedPage = page;
    const requestID = (this.requestID || 0) + 1;
    this.requestID = requestID;
    const isCurrent = () => this.requestID === requestID && getAccessToken() === token;
    this.setData({ loading: true, errorMessage: "" });
    try {
      const result = await listMyFeedback({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE, token });
      if (!isCurrent()) return;
      const totalPages = Math.max(1, Math.ceil((Number(result.total) || 0) / PAGE_SIZE));
      if (page > totalPages) {
        await this.loadPage(totalPages);
        return;
      }
      this.setData({
        items: (Array.isArray(result.items) ? result.items : []).map(buildRecord).filter(Boolean),
        unreadCount: Number(result.unreadCount) || 0,
        page,
        totalPages,
      });
    } catch (error) {
      if (!isCurrent()) return;
      if (error.statusCode === 401) {
        this.redirectToLogin();
        return;
      }
      this.setData({ errorMessage: getFeedbackErrorMessage(error) });
    } finally {
      if (this.requestID === requestID) this.setData({ loading: false });
    }
  },

  retryLoad() {
    return this.loadPage(this.requestedPage || this.data.page);
  },

  previousPage() {
    if (!this.data.loading && this.data.page > 1) return this.loadPage(this.data.page - 1);
  },

  nextPage() {
    if (!this.data.loading && this.data.page < this.data.totalPages) return this.loadPage(this.data.page + 1);
  },

  openFeedback(event) {
    const id = event.currentTarget.dataset.id;
    if (!id || this.sessionToken !== getAccessToken()) return;
    wx.navigateTo({ url: `/pages/feedback/detail/index?id=${encodeURIComponent(id)}` });
  },
});
