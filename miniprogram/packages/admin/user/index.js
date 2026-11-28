const { adminPage, resource, query, confirm, toast, copy, formatDate, userSummary, hasPermission, PAGE_SIZE, ROLE_LABELS } = require("../utils/admin");

const roles = ["normal", "vip", "svip"].map((id) => ({ id, label: ROLE_LABELS[id] }));

function changeView(change) {
  return {
    ...change,
    transition: (ROLE_LABELS[change.fromRole] || change.fromRole) + " → " + (ROLE_LABELS[change.toRole] || change.toRole),
    date: formatDate(change.createdAt),
  };
}

adminPage({
  required: "users.read",
  data: { user: null, canEdit: false, roles, selectedRole: "", reason: "", changes: [], offset: 0, total: 0 },
  async load({ api, active, session }) {
    if (!this.pageOptions.id) throw { code: "user_not_found" };
    const [account, history] = await Promise.all([
      api(resource("/users", this.pageOptions.id)),
      api(query(resource("/users", this.pageOptions.id) + "/role-changes", { offset: 0, limit: PAGE_SIZE })),
    ]);
    if (!active()) return;
    this.applyUser(account.user, session);
    this.applyChanges(history, []);
  },
  applyUser(user, session) {
    this.setData({ user: userSummary(user), canEdit: user.role !== "admin" && hasPermission(session, "users.role"), selectedRole: user.role, reason: "" });
  },
  applyChanges(response, current, offset = 0) {
    const existing = new Set(current.map(({ id }) => id));
    this.setData({
      changes: current.concat(response.changes.filter(({ id }) => !existing.has(id)).map(changeView)),
      total: response.total,
      offset: offset + response.changes.length,
    });
  },
  loadMore() {
    const { user, offset, total, changes } = this.data;
    if (!user || offset >= total) return;
    return this.action(async ({ api, active }) => {
      const response = await api(query(resource("/users", user.id) + "/role-changes", { offset, limit: PAGE_SIZE }));
      if (active()) this.applyChanges(response, changes, offset);
    });
  },
  copyId() {
    copy(this.data.user && this.data.user.id);
  },
  chooseRole(event) {
    const { role } = event.currentTarget.dataset;
    if (this.data.canEdit && !this.data.busy && ROLE_LABELS[role] && role !== "admin") this.setData({ selectedRole: role });
  },
  editReason({ detail }) {
    this.setData({ reason: detail.value });
  },
  saveRole() {
    const { user, canEdit, selectedRole, reason } = this.data;
    if (!canEdit || !user || user.role === selectedRole) return;
    if (Array.from(reason.trim()).length > 100) {
      this.setData({ error: "调整原因最多 100 个字符。" });
      return;
    }
    return this.action(async ({ api, active }) => {
      const content = "将「" + user.displayName + "」从" + user.roleLabel + "调整为" + ROLE_LABELS[selectedRole] + "。";
      if (!await confirm("调整会员身份", content, "调整") || !active()) return;
      const path = resource("/users", user.id);
      const response = await api(path + "/role", {
        method: "PUT", data: { expectedRole: user.role, role: selectedRole, reason: reason.trim() },
      });
      if (!active()) return;
      this.applyUser(response.user, this.session);
      toast("会员身份已更新");
      const history = await api(query(path + "/role-changes", { offset: 0, limit: PAGE_SIZE }));
      if (active()) this.applyChanges(history, []);
    });
  },
});
