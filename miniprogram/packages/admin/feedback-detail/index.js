const { adminPage, resource, openPage, hasPermission, formatDate, downloadImage, toast, STATUS_LABELS } = require("../utils/admin");

adminPage({
  required: "feedback.manage",
  data: { item: null, reply: "", replyLength: 0, showUser: false },
  async load({ api, active, session }) {
    if (!this.pageOptions.id) throw { code: "feedback_not_found" };
    const { item } = await api(resource("/feedback", this.pageOptions.id));
    if (!active()) return;
    const previous = this.data.item;
    const draft = previous && previous.id === item.id && previous.adminReply === item.adminReply
      ? this.data.reply : item.adminReply || "";
    this.applyItem(item, draft);
    this.setData({ showUser: Boolean(item.user && item.user.id && hasPermission(session, "users.read")) });
  },
  applyItem(item, draft = item.adminReply || "") {
    this.setData({
      item: {
        ...item,
        statusLabel: STATUS_LABELS[item.status] || item.status,
        timestamp: formatDate(item.createdAt),
        replyTimestamp: formatDate(item.replyUpdatedAt || item.processedAt),
      },
      reply: draft,
      replyLength: Array.from(draft).length,
    });
  },
  editReply({ detail }) {
    this.setData({ reply: detail.value, replyLength: Array.from(detail.value).length });
  },
  openImage(event) {
    const index = Number(event.currentTarget.dataset.index);
    const image = (this.data.item && this.data.item.images || [])[index];
    if (!image) return;
    return this.action(async ({ token, active }) => {
      const file = await downloadImage(image.path, token);
      if (active()) wx.previewImage({ current: file, urls: [file] });
    });
  },
  openUser() {
    if (this.data.showUser) openPage("user", this.data.item.user.id);
  },
  markProcessing() {
    const { item } = this.data;
    if (!item || item.status !== "pending") return;
    return this.updateFeedback("processing");
  },
  submitReply() {
    if (!this.data.item || this.data.busy) return;
    const reply = this.data.reply.trim();
    const length = Array.from(reply).length;
    if (length < 10 || length > 1000) {
      this.setData({ error: "回复需填写 10～1000 个字符。" });
      return;
    }
    return this.updateFeedback("resolved", reply);
  },
  updateFeedback(status, reply = "") {
    const { item } = this.data;
    return this.action(async ({ api, active }) => {
      const { item: updated } = await api(resource("/feedback", item.id) + "/resolve", { method: "POST", data: { status, reply } });
      if (!active()) return;
      this.applyItem(updated, status === "processing" ? this.data.reply : reply);
      toast(status === "processing" ? "已标记处理中" : "回复已发送");
    });
  },
});
