const {
  adminPage,
  resource,
  openPage,
  hasPermission,
  formatDate,
  downloadImage,
  isFeedbackImagePath,
  toast,
  STATUS_LABELS,
} = require("../utils/admin");

const QUICK_REPLIES = [
  { label: "已定位修复", text: "感谢反馈！该问题我们已定位并修复，请重新打开小程序体验。" },
  { label: "正在排查中", text: "收到你的反馈，我们正在加紧排查定位，修复后会第一时间更新通知你。" },
  { label: "建议已收录", text: "感谢你的宝贵建议！我们已经记录进产品优化清单，后续版本会安排评估上线。" },
  { label: "请补充复现", text: "已收到反馈，为了更快定位问题，方便时可补充具体操作步骤或页面截图。" },
];

adminPage({
  required: "feedback.manage",
  data: {
    item: null,
    reply: "",
    replyLength: 0,
    replyTrimLength: 0,
    replyError: "",
    quickReplies: QUICK_REPLIES,
    showUser: false,
  },
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
      replyTrimLength: Array.from(draft.trim()).length,
      replyError: "",
    });
  },
  editReply({ detail }) {
    const value = detail.value || "";
    this.setData({
      reply: value,
      replyLength: Array.from(value).length,
      replyTrimLength: Array.from(value.trim()).length,
      replyError: "",
    });
  },
  useQuickReply(event) {
    const text = event.currentTarget.dataset.text || "";
    if (!text || this.data.busy) return;
    this.setData({
      reply: text,
      replyLength: Array.from(text).length,
      replyTrimLength: Array.from(text.trim()).length,
      replyError: "",
    });
  },
  openImage(event) {
    const index = Number(event.currentTarget.dataset.index);
    const images = (this.data.item && this.data.item.images) || [];
    const tapped = images[index];
    if (!tapped) return;
    return this.action(async ({ token, active }) => {
      if (!isFeedbackImagePath(tapped.path)) {
        throw { displayMessage: "截图地址无效。" };
      }
      if (!this._imageCache) this._imageCache = {};
      const fetchOne = async (path) => {
        if (this._imageCache[path]) return this._imageCache[path];
        const file = await downloadImage(path, token);
        this._imageCache[path] = file;
        return file;
      };
      const tappedFile = await fetchOne(tapped.path);
      const validPaths = images.map((img) => img && img.path).filter(isFeedbackImagePath);
      const urls = [];
      for (const path of validPaths) {
        if (!active()) return;
        try {
          urls.push(path === tapped.path ? tappedFile : await fetchOne(path));
        } catch (error) {
          // Skip other screenshots if an individual download fails.
        }
      }
      if (active()) wx.previewImage({ current: tappedFile, urls: urls.length ? urls : [tappedFile] });
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
      const msg = "回复需填写 10～1000 个字符。";
      this.setData({ error: msg, replyError: msg });
      toast(msg);
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
