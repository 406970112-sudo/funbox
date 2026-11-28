const { adminPage, query, openPage, formatDate, PAGE_SIZE, STATUS_LABELS } = require("../utils/admin");

const filters = [{ id: "", label: "全部" }, ...Object.entries(STATUS_LABELS).map(([id, label]) => ({ id, label }))];

function feedbackView(item) {
  return {
    ...item,
    statusLabel: STATUS_LABELS[item.status] || item.status,
    headline: item.title || item.description || "反馈",
    author: item.user && item.user.displayName ? item.user.displayName : "用户",
    timestamp: formatDate(item.createdAt),
  };
}

adminPage({
  required: "feedback.manage",
  data: { items: [], offset: 0, total: 0, status: "", filters },
  load(context) {
    return this.loadItems(context, true);
  },
  async loadItems({ api, active }, reset) {
    const offset = reset ? 0 : this.data.offset;
    const { items, total } = await api(query("/feedback", { status: this.data.status, limit: PAGE_SIZE, offset }));
    if (!active()) return;
    const current = reset ? [] : this.data.items;
    const existing = new Set(current.map(({ id }) => id));
    this.setData({ items: current.concat(items.filter(({ id }) => !existing.has(id)).map(feedbackView)), total, offset: offset + items.length });
  },
  chooseStatus(event) {
    const status = event.currentTarget.dataset.status || "";
    if (this.data.status === status) return;
    this.setData({ status });
    return this.refresh();
  },
  loadMore() {
    if (this.data.offset < this.data.total) return this.action((context) => this.loadItems(context, false));
  },
  openFeedback(event) {
    openPage("feedback-detail", event.currentTarget.dataset.id);
  },
});
