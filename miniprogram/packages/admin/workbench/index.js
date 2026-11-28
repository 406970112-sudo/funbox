const { adminPage, hasPermission, openPage, copy } = require("../utils/admin");

const MODULES = [
  { id: "features", title: "入口管理", description: "控制功能展示、人群与维护状态", permission: "features.manage" },
  { id: "feedback", title: "反馈处理", description: "查看用户反馈、截图并回复", permission: "feedback.manage" },
  { id: "users", title: "用户管理", description: "查找账号与调整会员身份", permission: "users.read" },
  { id: "grants", title: "管理员授权", description: "按 FunBox ID 分配与审计权限", owner: true },
];

function buildModuleBadge(id, summary) {
  if (!summary) return { badge: "", badgeTone: "" };
  if (id === "feedback") {
    if (typeof summary.pendingFeedback === "number") {
      if (summary.pendingFeedback > 0) return { badge: `${summary.pendingFeedback} 条待处理`, badgeTone: "danger" };
      if (summary.processingFeedback > 0) return { badge: `${summary.processingFeedback} 条处理中`, badgeTone: "processing" };
      return { badge: "暂无待办", badgeTone: "success" };
    }
  }
  if (id === "features" && typeof summary.featuresTotal === "number") {
    const parts = [];
    if (summary.featuresMaintenance > 0) parts.push(`${summary.featuresMaintenance} 维护`);
    if (summary.featuresDisabled > 0) parts.push(`${summary.featuresDisabled} 关闭`);
    if (parts.length) return { badge: parts.join(" · "), badgeTone: "maintenance" };
    return { badge: `${summary.featuresTotal} 项正常`, badgeTone: "success" };
  }
  if (id === "users" && typeof summary.usersTotal === "number") {
    return { badge: `${summary.usersTotal} 人`, badgeTone: "muted" };
  }
  if (id === "grants" && typeof summary.grantsTotal === "number") {
    return { badge: `${summary.grantsTotal} 人`, badgeTone: "muted" };
  }
  return { badge: "", badgeTone: "" };
}

function buildQuickStats(modules, summary) {
  if (!summary) return [];
  const ids = new Set(modules.map(({ id }) => id));
  const stats = [];
  if (ids.has("feedback") && typeof summary.pendingFeedback === "number") {
    stats.push({
      id: "feedback",
      label: "待处理反馈",
      value: summary.pendingFeedback,
      accent: summary.pendingFeedback > 0 ? "danger" : "normal",
    });
  }
  if (ids.has("features") && typeof summary.featuresTotal === "number") {
    const abnormal = (summary.featuresDisabled || 0) + (summary.featuresMaintenance || 0);
    stats.push({
      id: "features",
      label: abnormal > 0 ? "维护/关闭入口" : "在线功能入口",
      value: abnormal > 0 ? abnormal : summary.featuresTotal,
      accent: abnormal > 0 ? "warn" : "normal",
    });
  }
  if (ids.has("users") && typeof summary.usersTotal === "number") {
    stats.push({
      id: "users",
      label: "注册用户",
      value: summary.usersTotal,
      accent: "normal",
    });
  }
  return stats;
}

adminPage({
  rememberView: true,
  data: { modules: [], quickStats: [], owner: false, userId: "", displayName: "" },
  async load({ api, active, session }) {
    const allowed = MODULES.filter((module) => (module.owner ? session.owner : hasPermission(session, module.permission)));
    const summaryResponse = await api("/summary").catch(error => {
      if (error.statusCode === 401 || error.statusCode === 403) throw error;
      return null;
    });
    if (!active()) return;
    const summary = summaryResponse?.summary;
    const previousModules = this.data.modules;
    const modules = allowed.map((module) => ({
      ...module,
      ...(summary ? buildModuleBadge(module.id, summary) : previousModules.find(item => item.id === module.id)),
    }));
    const view = {
      modules,
      quickStats: summary ? buildQuickStats(modules, summary)
        : this.data.quickStats.filter(({ id }) => allowed.some(module => module.id === id)),
      owner: session.owner,
      userId: session.userId || "",
      displayName: session.displayName || "",
    };
    if (Object.keys(view).some(key => JSON.stringify(this.data[key]) !== JSON.stringify(view[key]))) this.setData(view);
  },
  openModule(event) {
    if (!this.data.ready) return;
    const module = this.data.modules.find(({ id }) => id === event.currentTarget.dataset.id);
    if (module) openPage(module.id);
  },
  copyMyId() {
    if (this.data.userId) copy(this.data.userId, "已复制我的 FunBox ID");
    else this.openProfileSettings();
  },
  openProfileSettings() {
    if (this.data.ready) wx.navigateTo({ url: "/pages/profile-settings/index" });
  },
});
