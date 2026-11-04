const {
  listNotebookBooks,
  listNotebookNotes,
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
  },

  onLoad() {
    this._active = true;
    wx.showShareMenu({ menus: ["shareAppMessage", "shareTimeline"] });
  },

  onShow() {
    this._active = true;
    const token = getAccessToken();
    const user = getStoredUser();
    this.setData({ isLoggedIn: Boolean(token), userName: user && user.displayName ? user.displayName : "游客" });
    if (token) this.loadNotes();
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
      if (this.data.isLoggedIn) await this.loadNotes();
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  async loadNotes() {
    if (!this.data.isLoggedIn) return;
    const generation = (this._generation || 0) + 1;
    this._generation = generation;
    this.setData({ loading: true, error: "" });
    try {
      const [books, result] = await Promise.all([
        listNotebookBooks(),
        listNotebookNotes({ limit: 100 }),
      ]);
      if (!this._active || generation !== this._generation) return;
      const themedBooks = filterBooks(books, this.data.activeBookId);
      const notes = (result.notes || []).map((note, index) => decorateNote(note, index));
      this._notes = notes;
      this.setData({
        books: themedBooks,
        filters: [
          { id: "all", name: "全部", count: notes.length },
          ...themedBooks.map(book => ({ id: book.id, name: book.name, count: book.noteCount, fill: book.fill, ink: book.ink })),
        ],
        loading: false,
      });
      this.applyFilter();
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

  applyFilter() {
    const active = this.data.activeBookId;
    const all = this._notes || [];
    const filtered = active === "all" ? all : all.filter(note => note.bookId === active);
    const pinnedNotes = filtered.filter(note => note.pinned);
    const recentNotes = filtered.filter(note => !note.pinned);
    this.setData({
      pinnedNotes,
      recentNotes,
      noteCount: filtered.length,
      hasNotes: filtered.length > 0,
    });
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

  openSearch() {
    wx.navigateTo({ url: "/packages/notebook/search/index" });
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

  onShareAppMessage() {
    return { title: "FunBox 笔记本", path: "/packages/notebook/index/index" };
  },

  onShareTimeline() {
    return { title: "FunBox 笔记本", query: "" };
  },
});
