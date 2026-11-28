const { adminPage, query, resource, confirm, toast, formatDate, userSummary, PERMISSIONS, PAGE_SIZE } = require("../utils/admin");

function permissionLabels(permissions) {
  const enabled = new Set(permissions || []);
  return PERMISSIONS.filter(({ id }) => enabled.has(id)).map(({ label }) => label).join("、");
}

function grantView(grant) {
  return {
    ...grant,
    id: grant.user.id,
    user: userSummary(grant.user),
    labels: grant.owner ? "拥有小程序工作台的全部权限" : permissionLabels(grant.permissions),
  };
}

function changeView(change, index) {
  return {
    ...change,
    key: change.id || change.userId + "-" + change.createdAt + "-" + index,
    date: formatDate(change.createdAt),
    labels: permissionLabels(change.permissions),
    targetName: change.userDisplayName || change.userId,
    operatorName: change.operatorDisplayName || change.operatorId || "服务器",
  };
}

adminPage({
  ownerOnly: true,
  data: {
    activeTab: "grants",
    userId: "",
    target: null,
    permissions: [],
    selected: [],
    grants: [],
    grantsTotal: 0,
    grantsOffset: 0,
    changes: [],
    auditTotal: 0,
    auditOffset: 0,
  },
  async load(context) {
    await this.loadGrants(context);
    const prefill = this.pageOptions && this.pageOptions.userId ? String(this.pageOptions.userId).trim() : "";
    if (prefill && !this._prefilled) {
      this._prefilled = true;
      this.setData({ userId: prefill, activeTab: "grants" });
      try {
        const [{ user }, { grant }] = await Promise.all([
          context.api(resource("/users", prefill)),
          context.api(resource("/grants", prefill)),
        ]);
        if (context.active() && this.data.userId.trim() === prefill) this.applyTarget(user, grant);
      } catch (error) {
        // Ignore prefill lookup errors so the main list still loads cleanly.
      }
    }
  },
  async loadGrants({ api, active }) {
    const [list, history] = await Promise.all([
      api(query("/grants", { offset: 0, limit: PAGE_SIZE })),
      api(query("/grant-changes", { offset: 0, limit: PAGE_SIZE })),
    ]);
    if (!active()) return;
    this.applyGrants(list, [], 0);
    this.applyHistory(history, [], 0);
  },
  switchTab(event) {
    const tab = event.currentTarget.dataset.tab;
    if (tab && tab !== this.data.activeTab) this.setData({ activeTab: tab });
  },
  applyGrants(list, current, offset) {
    const existing = new Set(current.map(({ id }) => id));
    this.setData({
      grants: current.concat(list.grants.map(grantView).filter(({ id }) => !existing.has(id))),
      grantsTotal: list.total || 0,
      grantsOffset: offset + list.grants.length,
    });
  },
  handleReachBottom() {
    if (this.data.activeTab === "history") this.loadMoreHistory();
    else this.loadMoreGrants();
  },
  loadMoreGrants() {
    const { grants, grantsOffset, grantsTotal } = this.data;
    if (grantsOffset >= grantsTotal) return;
    return this.action(async ({ api, active }) => {
      const list = await api(query("/grants", { offset: grantsOffset, limit: PAGE_SIZE }));
      if (active()) this.applyGrants(list, grants, grantsOffset);
    });
  },
  applyHistory(history, current, offset) {
    this.setData({
      changes: current.concat(history.changes.map((change, index) => changeView(change, offset + index))),
      auditTotal: history.total || 0,
      auditOffset: offset + history.changes.length,
    });
  },
  loadMoreHistory() {
    const { auditOffset, auditTotal, changes } = this.data;
    if (auditOffset >= auditTotal) return;
    return this.action(async ({ api, active }) => {
      const history = await api(query("/grant-changes", { offset: auditOffset, limit: PAGE_SIZE }));
      if (active()) this.applyHistory(history, changes, auditOffset);
    });
  },
  editUserId({ detail }) {
    this.setData({ userId: detail.value, target: null, permissions: [], selected: [], error: "" });
  },
  clearUserId() {
    this.setData({ userId: "", target: null, permissions: [], selected: [], error: "" });
  },
  pasteUserId() {
    if (this.data.busy || typeof wx.getClipboardData !== "function") return;
    wx.getClipboardData({
      success: ({ data }) => {
        const pasted = String(data || "").trim();
        if (!pasted) {
          toast("剪贴板为空");
          return;
        }
        this.setData({ userId: pasted, target: null, permissions: [], selected: [], error: "" });
        this.findUser();
      },
      fail: () => toast("无法读取剪贴板"),
    });
  },
  applyTarget(user, grant) {
    const selected = grant && grant.permissions || [];
    this.setData({
      target: { ...userSummary(user), owner: Boolean(grant && grant.owner) },
      selected,
      permissions: PERMISSIONS.map((permission) => ({
        ...permission,
        checked: selected.includes(permission.id),
        lockedByDep: permission.id === "users.read" && selected.includes("users.role"),
      })),
    });
  },
  findUser() {
    const id = this.data.userId.trim();
    if (!id) {
      const msg = "请输入完整的 FunBox ID。";
      this.setData({ error: msg });
      toast(msg);
      return;
    }
    return this.action(async ({ api, active }) => {
      const [{ user }, { grant }] = await Promise.all([api(resource("/users", id)), api(resource("/grants", id))]);
      if (active() && this.data.userId.trim() === id) this.applyTarget(user, grant);
    });
  },
  editGrant(event) {
    const grant = this.data.grants.find(({ user }) => user.id === event.currentTarget.dataset.id);
    if (!grant || grant.owner || this.data.busy) return;
    this.setData({ activeTab: "grants", userId: grant.user.id, target: null, selected: [], permissions: [], error: "" });
    if (typeof wx.pageScrollTo === "function") wx.pageScrollTo({ scrollTop: 0, duration: 180 });
    return this.findUser();
  },
  togglePermission(event) {
    const id = event.currentTarget.dataset.id;
    if (!id || !this.data.target || this.data.target.owner || this.data.busy) return;
    const choices = new Set(this.data.selected || []);
    if (choices.has(id)) {
      if (id === "users.read" && choices.has("users.role")) {
        toast("「调整会员」依赖「查看用户」权限");
        return;
      }
      choices.delete(id);
    } else {
      choices.add(id);
    }
    this.changePermissions({ detail: { value: Array.from(choices) } });
  },
  changePermissions({ detail }) {
    if (!this.data.target || this.data.target.owner || this.data.busy) return;
    const choices = new Set(detail.value);
    if (choices.has("users.role")) choices.add("users.read");
    this.setData({
      selected: PERMISSIONS.filter(({ id }) => choices.has(id)).map(({ id }) => id),
      permissions: PERMISSIONS.map((permission) => ({
        ...permission,
        checked: choices.has(permission.id),
        lockedByDep: permission.id === "users.read" && choices.has("users.role"),
      })),
    });
  },
  saveGrant() {
    const { target, selected } = this.data;
    if (!target || target.owner || !selected.length) return;
    return this.updateGrant(target, selected);
  },
  revokeGrant(event) {
    const grant = this.data.grants.find(({ user }) => user.id === event.currentTarget.dataset.id);
    if (!grant || grant.owner) return;
    return this.updateGrant(grant.user, []);
  },
  updateGrant(user, permissions) {
    return this.action(async (context) => {
      const { api, active } = context;
      const granted = Boolean(permissions.length);
      const action = granted ? "保存授权" : "撤销授权";
      const content = granted ? "将「" + user.displayName + "」的小程序权限设为：" + permissionLabels(permissions) + "。"
        : "将撤销「" + user.displayName + "」的全部小程序管理权限。";
      if (!await confirm(action, content, granted ? "授权" : "撤销") || !active()) return;
      await api(resource("/grants", user.id), { method: "PUT", data: { permissions } });
      if (!active()) return;
      this.setData({ userId: "", target: null, selected: [], permissions: [] });
      toast(granted ? "授权已保存" : "授权已撤销");
      await this.loadGrants(context);
    });
  },
});
