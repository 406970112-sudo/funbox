const {
  listNotebookBooks,
  listNotebookNotes,
  getNotebookSecurity,
  setNotebookPassword,
  unlockNotebook,
  lockNotebook,
  resetNotebookEncryption,
  notebookErrorMessage,
  isNotebookUnauthorized,
} = require("../utils/notebook-api");
const { decorateNote, bookTheme } = require("../utils/notebook-format");
const { getAccessToken, getStoredUser, clearSession } = require("../../../utils/auth");

function filterBooks(books, activeBookId) {
  return (books || []).map(book => ({ ...book, ...bookTheme(book.color) }));
}

Page({
  data: {
    isLoggedIn: false,
    userName: "游客",
    loading: false,
    error: "",
    books: [],
    filters: [{ id: "all", name: "全部", count: 0 }],
    activeBookId: "all",
    pinnedNotes: [],
    recentNotes: [],
    noteCount: 0,
    hasNotes: false,
    hasSecurityPassword: false,
    encryptedNoteCount: 0,
    securityUnlocked: false,
    showSecuritySheet: false,
    securityMode: "summary",
    securityPassword: "",
    securityNewPassword: "",
    securityConfirmPassword: "",
    securityError: "",
    securityBusy: false,
  },

  onLoad() {
    this._active = true;
    wx.showShareMenu({ menus: ["shareAppMessage", "shareTimeline"] });
  },

  onShow() {
    this._active = true;
    const token = getAccessToken();
    const user = getStoredUser();
    if (token !== this._accountToken) {
      this._accountToken = token;
      this.resetNotes();
    }
    this.updateView({ isLoggedIn: Boolean(token), userName: user && user.displayName ? user.displayName : "游客" });
    if (token) return this.loadNotes();
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
      if (this.data.isLoggedIn) await this.loadNotes({ manual: true });
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  // Cache is scoped to this page instance and the current login session.
  resetNotes() {
    this._hasLoadedNotes = false;
    this._notes = [];
    this._generation = (this._generation || 0) + 1;
    this.updateView({
      books: [], filters: [{ id: "all", name: "全部", count: 0 }],
      activeBookId: "all", pinnedNotes: [], recentNotes: [],
      noteCount: 0, hasNotes: false, loading: false, error: "",
      hasSecurityPassword: false, encryptedNoteCount: 0, securityUnlocked: false,
      showSecuritySheet: false, securityBusy: false, securityMode: "summary",
      securityPassword: "", securityNewPassword: "", securityConfirmPassword: "", securityError: "",
    });
  },

  updateView(next) {
    const patch = {};
    Object.keys(next).forEach(key => {
      if (JSON.stringify(this.data[key]) !== JSON.stringify(next[key])) patch[key] = next[key];
    });
    if (Object.keys(patch).length) this.setData(patch);
  },

  filteredState(notes, activeBookId) {
    const filtered = activeBookId === "all" ? notes : notes.filter(note => note.bookId === activeBookId);
    return {
      pinnedNotes: filtered.filter(note => note.pinned),
      recentNotes: filtered.filter(note => !note.pinned),
      noteCount: filtered.length,
      hasNotes: filtered.length > 0,
    };
  },

  async loadNotes(options = {}) {
    if (!this.data.isLoggedIn) return;
    const generation = (this._generation || 0) + 1;
    this._generation = generation;
    this.updateView({ loading: !this._hasLoadedNotes, error: "" });
    try {
      const [books, result, security] = await Promise.all([
        listNotebookBooks(),
        listNotebookNotes({ limit: 100 }),
        getNotebookSecurity(),
      ]);
      if (!this._active || generation !== this._generation) return;
      const themedBooks = filterBooks(books, this.data.activeBookId);
      const notes = (result.notes || []).map((note, index) => decorateNote(note, index));
      this._notes = notes;
      this._hasLoadedNotes = true;
      const activeBookId = this.data.activeBookId === "all" || themedBooks.some(book => book.id === this.data.activeBookId)
        ? this.data.activeBookId : "all";
      this.updateView({
        activeBookId,
        ...this.filteredState(notes, activeBookId),
        books: themedBooks,
        hasSecurityPassword: Boolean(security.hasPassword),
        encryptedNoteCount: Number(security.encryptedNoteCount) || 0,
        securityUnlocked: Boolean(security.unlocked),
        filters: [
          { id: "all", name: "全部", count: notes.length },
          ...themedBooks.map(book => ({ id: book.id, name: book.name, count: book.noteCount, fill: book.fill, ink: book.ink })),
        ],
        loading: false,
      });
    } catch (error) {
      if (!this._active || generation !== this._generation) return;
      if (isNotebookUnauthorized(error)) {
        clearSession();
        this.resetNotes();
        this.updateView({ isLoggedIn: false });
        return;
      }
      // A failed background refresh must not replace a usable list with an error screen.
      this.updateView({ loading: false, error: this._hasLoadedNotes ? "" : notebookErrorMessage(error) });
      if (this._hasLoadedNotes && options.manual && typeof wx.showToast === "function") {
        wx.showToast({ title: notebookErrorMessage(error), icon: "none" });
      }
    }
  },

  applyFilter() {
    this.updateView(this.filteredState(this._notes || [], this.data.activeBookId));
  },

  changeFilter(event) {
    const id = event.currentTarget.dataset.id;
    if (!id || id === this.data.activeBookId) return;
    this.setData({ activeBookId: id });
    this.applyFilter();
  },

  openLogin() {
    wx.navigateTo({
      url: `/pages/auth/index?mode=login&returnTo=${encodeURIComponent("/packages/notebook/index/index")}`,
    });
  },

  manageBooks() {
    wx.navigateTo({ url: "/packages/notebook/books/index" });
  },

  openSearch() {
    wx.navigateTo({ url: "/packages/notebook/search/index" });
  },

  openSecurity() {
    if (!this.data.isLoggedIn) {
      this.openLogin();
      return;
    }
    this.setData({
      showSecuritySheet: true,
      securityMode: "summary",
      securityPassword: "",
      securityNewPassword: "",
      securityConfirmPassword: "",
      securityError: "",
    });
  },

  closeSecuritySheet() {
    if (this.data.securityBusy) return;
    this.setData({
      showSecuritySheet: false,
      securityMode: "summary",
      securityPassword: "",
      securityNewPassword: "",
      securityConfirmPassword: "",
      securityError: "",
    });
  },

  beginSecurityUnlock() {
    this.setData({ securityMode: "unlock", securityPassword: "", securityError: "" });
  },

  beginPasswordChange() {
    this.setData({
      securityMode: "change",
      securityPassword: "",
      securityNewPassword: "",
      securityConfirmPassword: "",
      securityError: "",
    });
  },

  backToSecuritySummary() {
    if (this.data.securityBusy) return;
    this.setData({ securityMode: "summary", securityPassword: "", securityNewPassword: "", securityConfirmPassword: "", securityError: "" });
  },

  onSecurityPasswordInput(event) {
    this.setData({ securityPassword: event.detail.value || "", securityError: "" });
  },

  onSecurityNewPasswordInput(event) {
    this.setData({ securityNewPassword: event.detail.value || "", securityError: "" });
  },

  onSecurityConfirmPasswordInput(event) {
    this.setData({ securityConfirmPassword: event.detail.value || "", securityError: "" });
  },

  async submitSecurityUnlock() {
    if (this.data.securityBusy) return;
    if (!this.data.securityPassword) {
      this.setData({ securityError: "请输入笔记密码" });
      return;
    }
    this.setData({ securityBusy: true, securityError: "" });
    try {
      await unlockNotebook(this.data.securityPassword);
      await this.loadNotes();
      if (this._active) this.setData({ securityBusy: false, showSecuritySheet: false, securityMode: "summary", securityPassword: "" });
    } catch (error) {
      if (isNotebookUnauthorized(error)) {
        clearSession();
        this.setData({ isLoggedIn: false, securityBusy: false, showSecuritySheet: false });
        return;
      }
      this.setData({ securityBusy: false, securityError: notebookErrorMessage(error) });
    }
  },

  async submitPasswordChange() {
    if (this.data.securityBusy) return;
    const next = this.data.securityNewPassword;
    if (!this.data.securityPassword) {
      this.setData({ securityError: "请输入当前密码" });
      return;
    }
    if (Array.from(next || "").length < 6 || Array.from(next || "").length > 32) {
      this.setData({ securityError: "新密码需为 6–32 位" });
      return;
    }
    if (next !== this.data.securityConfirmPassword) {
      this.setData({ securityError: "两次输入的新密码不一致" });
      return;
    }
    this.setData({ securityBusy: true, securityError: "" });
    try {
      await setNotebookPassword("change", this.data.securityPassword, next);
      await unlockNotebook(next);
      await this.loadNotes();
      if (this._active) {
        this.setData({
          securityBusy: false,
          showSecuritySheet: false,
          securityMode: "summary",
          securityPassword: "",
          securityNewPassword: "",
          securityConfirmPassword: "",
        });
        wx.showToast({ title: "密码已更新", icon: "success" });
      }
    } catch (error) {
      if (isNotebookUnauthorized(error)) {
        clearSession();
        this.setData({ isLoggedIn: false, securityBusy: false, showSecuritySheet: false });
        return;
      }
      this.setData({ securityBusy: false, securityError: notebookErrorMessage(error) });
    }
  },

  async lockSecurity() {
    if (this.data.securityBusy) return;
    this.setData({ securityBusy: true });
    try {
      await lockNotebook();
      if (this._active) this.setData({ securityUnlocked: false, securityBusy: false });
      wx.showToast({ title: "已上锁", icon: "none" });
    } catch (error) {
      this.setData({ securityBusy: false });
      if (isNotebookUnauthorized(error)) clearSession();
      else wx.showToast({ title: notebookErrorMessage(error), icon: "none" });
    }
  },

  resetEncryption() {
    wx.showModal({
      title: "清空所有加密笔记？",
      content: "此操作会永久删除全部加密笔记和附件，普通笔记不受影响。忘记密码时使用。",
      confirmText: "永久删除",
      confirmColor: "#c74d38",
      success: async result => {
        if (!result.confirm) return;
        this.setData({ securityBusy: true, securityError: "" });
        try {
          await resetNotebookEncryption();
          await this.loadNotes();
          if (this._active) this.setData({ securityBusy: false, showSecuritySheet: false, securityMode: "summary" });
          wx.showToast({ title: "已清空加密笔记", icon: "none" });
        } catch (error) {
          if (isNotebookUnauthorized(error)) {
            clearSession();
            this.setData({ isLoggedIn: false, securityBusy: false, showSecuritySheet: false });
            return;
          }
          this.setData({ securityBusy: false, securityError: notebookErrorMessage(error) });
        }
      },
    });
  },

  createNote() {
    if (!this.data.isLoggedIn) {
      this.openLogin();
      return;
    }
    const bookId = this.data.activeBookId === "all" ? "" : this.data.activeBookId;
    wx.navigateTo({ url: `/packages/notebook/editor/index${bookId ? `?bookId=${encodeURIComponent(bookId)}` : ""}` });
  },

  openNote(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/packages/notebook/detail/index?id=${encodeURIComponent(id)}` });
  },

  openProfile() {
    wx.switchTab({ url: "/pages/profile/index" });
  },

  retry() {
    this.loadNotes();
  },

  noop() {},

  onShareAppMessage() {
    return { title: "FunBox 笔记本", path: "/packages/notebook/index/index" };
  },

  onShareTimeline() {
    return { title: "FunBox 笔记本", query: "" };
  },
});
