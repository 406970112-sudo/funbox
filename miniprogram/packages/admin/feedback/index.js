const { adminPage, query, openPage, formatDate, PAGE_SIZE, STATUS_LABELS } = require("../utils/admin");

const filters = [
  { id: "pending", label: "待处理" },
  { id: "processing", label: "处理中" },
  { id: "resolved", label: "已处理" },
  { id: "", label: "全部" },
];

function feedbackView(item) {
  const headline = item.title || item.description || "用户反馈";
  const desc = String(item.description || "").replace(/\s+/g, " ").trim();
  const excerpt = desc && desc !== headline ? desc : "";
  return {
    ...item,
    statusLabel: STATUS_LABELS[item.status] || item.status,
    headline,
    excerpt,
    imageCount: Array.isArray(item.images) ? item.images.length : 0,
    author: item.user && item.user.displayName ? item.user.displayName : "用户",
    timestamp: formatDate(item.createdAt),
  };
}

adminPage({
  required: "feedback.manage",
  data: { items: [], offset: 0, total: 0, status: "pending", search: "", submitted: "", filters },
  load(context) {
    return this.loadItems(context, true);
  },
  async loadItems({ api, active }, reset) {
    const offset = reset ? 0 : this.data.offset;
    const { items, total } = await api(query("/feedback", {
      status: this.data.status,
      q: this.data.submitted,
      limit: PAGE_SIZE,
      offset,
    }));
    if (!active()) return;
    const current = reset ? [] : this.data.items;
    const existing = new Set(current.map(({ id }) => id));
    this.setData({
      items: current.concat(items.filter(({ id }) => !existing.has(id)).map(feedbackView)),
      total,
      offset: offset + items.length,
    });
  },
  editSearch({ detail }) {
    this.setData({ search: detail.value });
  },
  searchFeedback() {
    this.setData({ submitted: this.data.search.trim() });
    return this.reload();
  },
  clearSearch() {
    this.setData({ search: "", submitted: "" });
    return this.reload();
  },
  chooseStatus(event) {
    const status = event.currentTarget.dataset.status || "";
    if (this.data.status === status) return;
    this.setData({ status });
    return this.reload();
  },
  handleReachBottom() {
    this.loadMore();
  },
  loadMore() {
    if (this.data.offset < this.data.total) return this.action((context) => this.loadItems(context, false));
  },
  openFeedback(event) {
    openPage("feedback-detail", event.currentTarget.dataset.id);
  },
});
