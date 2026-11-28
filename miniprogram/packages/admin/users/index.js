const { adminPage, query, openPage, userSummary, PAGE_SIZE, ROLE_LABELS } = require("../utils/admin");

const filters = [{ id: "", label: "全部" }, ...Object.entries(ROLE_LABELS).map(([id, label]) => ({ id, label }))];

adminPage({
  required: "users.read",
  data: { search: "", submitted: "", role: "", filters, items: [], offset: 0, total: 0 },
  load(context) {
    return this.loadItems(context, true);
  },
  async loadItems({ api, active }, reset) {
    const offset = reset ? 0 : this.data.offset;
    const response = await api(query("/users", { q: this.data.submitted, role: this.data.role, limit: PAGE_SIZE, offset }));
    if (!active()) return;
    const current = reset ? [] : this.data.items;
    const existing = new Set(current.map(({ id }) => id));
    this.setData({
      items: current.concat(response.users.filter(({ id }) => !existing.has(id)).map(userSummary)),
      total: response.total,
      offset: offset + response.users.length,
    });
  },
  editSearch({ detail }) {
    this.setData({ search: detail.value });
  },
  searchUsers() {
    this.setData({ submitted: this.data.search.trim() });
    return this.reload();
  },
  clearSearch() {
    this.setData({ search: "", submitted: "" });
    return this.reload();
  },
  chooseRole(event) {
    const role = event.currentTarget.dataset.role || "";
    if (this.data.role === role) return;
    this.setData({ role });
    return this.reload();
  },
  handleReachBottom() {
    this.loadMore();
  },
  loadMore() {
    if (this.data.offset < this.data.total) return this.action((context) => this.loadItems(context, false));
  },
  openUser(event) {
    openPage("user", event.currentTarget.dataset.id);
  },
});
