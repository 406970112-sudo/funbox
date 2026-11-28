const { adminPage, hasPermission, openPage } = require("../utils/admin");

const MODULES = [
  { id: "features", title: "入口管理", description: "管理功能展示与维护状态", permission: "features.manage" },
  { id: "users", title: "用户管理", description: "查找账号与调整会员身份", permission: "users.read" },
  { id: "feedback", title: "反馈处理", description: "查看反馈与回复", permission: "feedback.manage" },
  { id: "grants", title: "管理员授权", description: "按 FunBox ID 授权", owner: true },
];

adminPage({
  data: { modules: [], owner: false },
  load({ session }) {
    this.setData({
      modules: MODULES.filter((module) => module.owner ? session.owner : hasPermission(session, module.permission)),
      owner: session.owner,
    });
  },
  openModule(event) {
    if (!this.data.ready) return;
    const module = this.data.modules.find(({ id }) => id === event.currentTarget.dataset.id);
    if (module) openPage(module.id);
  },
  openProfileSettings() {
    if (this.data.ready) wx.navigateTo({ url: "/pages/profile-settings/index" });
  },
});
