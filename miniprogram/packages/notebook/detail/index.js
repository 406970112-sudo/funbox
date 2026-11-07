const {
  getNotebookNote,
  updateNotebookNote,
  deleteNotebookNote,
  unlockNotebook,
  notebookErrorMessage,
  isNotebookUnauthorized,
  isNotebookLockedError,
} = require("../utils/notebook-api");
const { decorateNote, formatNoteTime, bookTheme } = require("../utils/notebook-format");
const { getAccessToken, clearSession } = require("../../../utils/auth");

function noteSummary(body, checklist) {
  const characterCount = Array.from(String(body || "").replace(/\s+/g, "")).length;
  const doneCount = checklist.filter(item => item.done).length;
  const parts = [];
  if (characterCount) parts.push(`${characterCount} 字`);
  if (checklist.length) parts.push(`清单 ${doneCount}/${checklist.length}`);
  return parts.join(" · ");
}

Page({
  data: {
    isLoggedIn: false,
    loading: true,
    error: "",
    note: null,
    title: "",
    body: "",
    checklist: [],
    tags: [],


    bookName: "",
    bookFill: "#eaf2ff",
    bookInk: "#2d5bff",
    updatedLabel: "",
    summaryLabel: "",
    checklistDone: 0,
    favorite: false,
    pinned: false,
    favoriteBusy: false,

    encrypted: false,
    locked: false,
    showUnlockSheet: false,
    unlockPassword: "",
    unlockError: "",
    unlockBusy: false,
    showMoreSheet: false,
    passwordVisible: false,
  },

  onLoad(options = {}) {
    this._active = true;
    this.noteId = options.id ? decodeURIComponent(options.id) : "";
    this.setData({ isLoggedIn: Boolean(getAccessToken()) });
    if (typeof wx.showShareMenu === "function") wx.showShareMenu({ menus: ["shareAppMessage"] });
  },

  onShow() {
    this._active = true;
    const loggedIn = Boolean(getAccessToken());
    this.setData({ isLoggedIn: loggedIn });
    if (!this.noteId) {
      this.setData({ loading: false, error: "没有找到这条笔记" });
      return;
    }
    if (loggedIn) this.loadNote();
  },

  onHide() {
    this._active = false;
    this._generation = (this._generation || 0) + 1;
  },

  onUnload() {
    this.onHide();
  },

  async onPullDownRefresh() {
    try {
      if (this.data.isLoggedIn) await this.loadNote();
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  async loadNote() {
    if (!this.noteId) return;
    const generation = (this._generation || 0) + 1;
    this._generation = generation;
    this.setData({ loading: true, error: "" });
    try {
      const note = await getNotebookNote(this.noteId);
      if (!this._active || generation !== this._generation) return;
      const theme = bookTheme(note.bookColor);
      const encrypted = Boolean(note.encrypted);
      const locked = Boolean(note.locked);
      this._note = note;
      if (encrypted && typeof wx.hideShareMenu === "function") wx.hideShareMenu();
      else if (!encrypted && typeof wx.showShareMenu === "function") wx.showShareMenu({ menus: ["shareAppMessage"] });
      if (locked) {
        this.setData({
          loading: false,
          note,
          title: "",
          body: "",
          checklist: [],
          checklistDone: 0,
          summaryLabel: "",
          tags: [],


          bookName: note.bookName,
          bookFill: theme.fill,
          bookInk: theme.ink,
          updatedLabel: formatNoteTime(note.updatedAt),
          favorite: Boolean(note.favorite),
          pinned: Boolean(note.pinned),
          encrypted: true,
          locked: true,
          unlockError: "",
        });
        return;
      }
      const decorated = decorateNote(note);
      const checklist = (note.checklist || []).map(item => ({ ...item, done: Boolean(item.done) }));
      const checklistDone = checklist.filter(item => item.done).length;
      this.setData({
        loading: false,
        note: decorated,
        title: decorated.displayTitle,
        body: note.body || "",
        checklist,
        checklistDone,
        summaryLabel: noteSummary(note.body, checklist),
        tags: note.tags || [],
        bookName: note.bookName,
        bookFill: theme.fill,
        bookInk: theme.ink,
        updatedLabel: formatNoteTime(note.updatedAt),
        favorite: Boolean(note.favorite),
        pinned: Boolean(note.pinned),
        encrypted,
        locked: false,
        unlockError: "",
      });
    } catch (error) {
      if (!this._active || generation !== this._generation) return;
      if (isNotebookUnauthorized(error)) {
        clearSession();
        this.setData({ isLoggedIn: false, loading: false, error: "" });
        return;
      }
      this.setData({ loading: false, error: notebookErrorMessage(error) });
    }
  },

  async toggleFavorite() {
    if (this.data.locked) {
      this.openUnlockSheet();
      return;
    }
    if (this.data.favoriteBusy || !this._note) return;
    const next = !this.data.favorite;
    this.setData({ favoriteBusy: true, favorite: next });
    try {
      const note = await updateNotebookNote(this.noteId, { favorite: next });
      if (!this._active) { this.setData({ favoriteBusy: false }); return; }
      this._note = note;
      this.setData({ favoriteBusy: false, favorite: Boolean(note.favorite), pinned: Boolean(note.pinned) });
      wx.showToast({ title: next ? "已收藏" : "已取消收藏", icon: "none" });
    } catch (error) {
      if (!this._active) { this.setData({ favoriteBusy: false }); return; }
      this.setData({ favoriteBusy: false, favorite: !next });
      this.handleError(error);
    }
  },

  openMore() {
    if (this._note) this.setData({ showMoreSheet: true });
  },

  closeMore() { this.setData({ showMoreSheet: false }); },

  editEncryption() {
    this.closeMore();
    this.editNote();
  },

  deleteFromSheet() {
    this.closeMore();
    this.confirmDelete();
  },

  async togglePinned() {
    if (this.data.locked) {
      this.openUnlockSheet();
      return;
    }
    this.closeMore();
    const next = !this.data.pinned;
    try {
      const note = await updateNotebookNote(this.noteId, { pinned: next });
      if (!this._active) return;
      this._note = note;
      this.setData({ pinned: Boolean(note.pinned), favorite: Boolean(note.favorite) });
      wx.showToast({ title: next ? "已置顶" : "已取消置顶", icon: "none" });
    } catch (error) {
      if (this._active) this.handleError(error);
    }
  },

  confirmDelete() {
    wx.showModal({
      title: this.data.encrypted ? "删除这条加密笔记？" : "删除这条笔记？",
      content: "删除后将无法在列表中找到它。",
      confirmText: "删除",
      confirmColor: "#c74d38",
      success: async result => {
        if (!result.confirm) return;
        try {
          await deleteNotebookNote(this.noteId);
          wx.showToast({ title: "已删除", icon: "success" });
          setTimeout(() => wx.navigateBack(), 300);
        } catch (error) {
          this.handleError(error);
        }
      },
    });
  },

  editNote() {
    if (!this._note) return;
    if (this.data.locked) {
      this.openUnlockSheet();
      return;
    }
    wx.navigateTo({ url: `/packages/notebook/editor/index?id=${encodeURIComponent(this.noteId)}` });
  },

  handleError(error) {
    if (isNotebookUnauthorized(error)) {
      clearSession();
      this.setData({ isLoggedIn: false });
      return;
    }
    if (isNotebookLockedError(error)) {
      this.setData({
        locked: true,
        title: "",
        body: "",
        checklist: [],
        checklistDone: 0,
        summaryLabel: "",
        tags: [],


        showUnlockSheet: true,
        unlockError: notebookErrorMessage(error),
      });
      return;
    }
    wx.showToast({ title: notebookErrorMessage(error), icon: "none" });
  },

  openUnlockSheet() {
    this.setData({ showUnlockSheet: true, unlockPassword: "", unlockError: "", passwordVisible: false });
  },

  closeUnlockSheet() {
    if (this.data.unlockBusy) return;
    this.setData({ showUnlockSheet: false, unlockPassword: "", unlockError: "" });
  },

  togglePasswordVisible() { this.setData({ passwordVisible: !this.data.passwordVisible }); },

  onUnlockInput(event) {
    this.setData({ unlockPassword: event.detail.value || "", unlockError: "" });
  },

  async submitUnlock() {
    if (this.data.unlockBusy) return;
    const password = String(this.data.unlockPassword || "");
    if (!password) {
      this.setData({ unlockError: "请输入笔记密码" });
      return;
    }
    this.setData({ unlockBusy: true, unlockError: "" });
    try {
      await unlockNotebook(password);
      this.setData({ unlockBusy: false, showUnlockSheet: false, unlockPassword: "" });
      await this.loadNote();
    } catch (error) {
      if (isNotebookUnauthorized(error)) {
        clearSession();
        this.setData({ isLoggedIn: false, unlockBusy: false, showUnlockSheet: false });
        return;
      }
      this.setData({ unlockBusy: false, unlockError: notebookErrorMessage(error) });
    }
  },

  forgotPassword() {
    wx.showModal({
      title: "无法找回密码",
      content: "密码不会以明文保存，无法找回。可删除这条笔记；如果还有其它加密笔记，请回首页使用「清空加密笔记」。",
      confirmText: "删除笔记",
      confirmColor: "#c74d38",
      success: result => {
        if (result.confirm) this.confirmDelete();
      },
    });
  },

  openLogin() {
    wx.navigateTo({
      url: `/pages/auth/index?mode=login&returnTo=${encodeURIComponent(`/packages/notebook/detail/index?id=${this.noteId}`)}`,
    });
  },

  retry() {
    if (this.data.isLoggedIn) this.loadNote();
  },

  noop() {},

  onShareAppMessage() {
    if (this.data.encrypted) {
      return { title: "FunBox 加密笔记", path: "/packages/notebook/index/index" };
    }
    return {
      title: this.data.title || "FunBox 笔记",
      path: `/packages/notebook/detail/index?id=${encodeURIComponent(this.noteId || "")}`,
    };
  },
});
