const {
  adminPage,
  resource,
  query,
  openPage,
  confirm,
  toast,
  copy,
  formatDate,
  userSummary,
  hasPermission,
  PAGE_SIZE,
  ROLE_LABELS,
} = require("../utils/admin");

const roles = ["normal", "vip", "svip"].map((id) => ({ id, label: ROLE_LABELS[id] }));
const QUICK_REASONS = ["活动赠送", "内测体验", "客诉补偿", "到期调整"];

function changeView(change) {
  return {
    ...change,
    transition: (ROLE_LABELS[change.fromRole] || change.fromRole) + " → " + (ROLE_LABELS[change.toRole] || change.toRole),
    date: formatDate(change.createdAt),
  };
}

adminPage({
  required: "users.read",
  data: {
    user: null,
    canEdit: false,
    canManageGrants: false,
    roles,
    quickReasons: QUICK_REASONS,
    selectedRole: "",
    reason: "",
    reasonLength: 0,
    reasonError: "",
    changes: [],
    offset: 0,
    total: 0,
  },
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
    this.setData({
      user: userSummary(user),
      canEdit: user.role !== "admin" && hasPermission(session, "users.role"),
      canManageGrants: Boolean(session && session.owner),
      selectedRole: user.role,
      reason: "",
      reasonLength: 0,
      reasonError: "",
    });
  },
  applyChanges(response, current, offset = 0) {
    const existing = new Set(current.map(({ id }) => id));
    this.setData({
      changes: current.concat(response.changes.filter(({ id }) => !existing.has(id)).map(changeView)),
      total: response.total,
      offset: offset + response.changes.length,
    });
  },
  handleReachBottom() {
    this.loadMore();
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
    copy(this.data.user && this.data.user.id, "已复制 FunBox ID");
  },
  openGrants() {
    if (this.data.canManageGrants && this.data.user) {
      openPage("grants", { userId: this.data.user.id });
    }
  },
  chooseRole(event) {
    const { role } = event.currentTarget.dataset;
    if (this.data.canEdit && !this.data.busy && ROLE_LABELS[role] && role !== "admin") {
      this.setData({ selectedRole: role, reasonError: "" });
    }
  },
  editReason({ detail }) {
    const value = detail.value || "";
    this.setData({ reason: value, reasonLength: Array.from(value.trim()).length, reasonError: "" });
  },
  useQuickReason(event) {
    const text = event.currentTarget.dataset.text || "";
    if (!text || this.data.busy) return;
    this.setData({ reason: text, reasonLength: Array.from(text).length, reasonError: "" });
  },
  saveRole() {
    const { user, canEdit, selectedRole, reason } = this.data;
    if (!canEdit || !user || user.role === selectedRole) return;
    if (Array.from(reason.trim()).length > 100) {
      const msg = "调整原因最多 100 个字符。";
      this.setData({ error: msg, reasonError: msg });
      toast(msg);
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
