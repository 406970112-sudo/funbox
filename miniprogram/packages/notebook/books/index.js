const {
  listNotebookBooks,
  createNotebookBook,
  updateNotebookBook,
  deleteNotebookBook,
  notebookErrorMessage,
  isNotebookUnauthorized,
} = require("../utils/notebook-api");
const { bookTheme } = require("../utils/notebook-format");
const { getAccessToken, clearSession } = require("../../../utils/auth");

const palette = ["#2d5bff", "#20a97a", "#ff765e", "#7b61ff", "#e8a33d"];

Page({
  data: {
    isLoggedIn: false,
    loading: false,
    busy: false,
    error: "",
    books: [],
    newBookName: "",
    selectedColor: palette[0],
    colors: palette,
  },

  onLoad() {
    this._active = true;
    this.setData({ isLoggedIn: Boolean(getAccessToken()) });
  },

  onShow() {
    this._active = true;
    const loggedIn = Boolean(getAccessToken());
    this.setData({ isLoggedIn: loggedIn });
    if (loggedIn) this.loadBooks();
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
      if (this.data.isLoggedIn) await this.loadBooks();
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  async loadBooks() {
    const generation = (this._generation || 0) + 1;
    this._generation = generation;
    this.setData({ loading: true, error: "" });
    try {
      const books = await listNotebookBooks();
      if (!this._active || generation !== this._generation) return;
      this.setData({
        loading: false,
        books: books.map(book => ({ ...book, ...bookTheme(book.color), initial: String(book.name || "").trim().slice(0, 1) })),
      });
    } catch (error) {
      if (!this._active || generation !== this._generation) return;
      if (isNotebookUnauthorized(error)) {
        clearSession();
        this.setData({ isLoggedIn: false, loading: false });
        return;
      }
      this.setData({ loading: false, error: notebookErrorMessage(error) });
    }
  },

  onNameInput(event) {
    this.setData({ newBookName: event.detail.value || "" });
  },

  selectColor(event) {
    const color = event.currentTarget.dataset.color;
    if (color) this.setData({ selectedColor: color });
  },

  async createBook() {
    if (this.data.busy) return;
    const name = this.data.newBookName.trim();
    if (!name) {
      wx.showToast({ title: "请输入笔记本名称", icon: "none" });
      return;
    }
    this.setData({ busy: true });
    try {
      await createNotebookBook(name, this.data.selectedColor);
      this.setData({ newBookName: "", busy: false });
      wx.showToast({ title: "已创建", icon: "success" });
      await this.loadBooks();
    } catch (error) {
      this.setData({ busy: false });
      this.handleActionError(error);
    }
  },

  async renameBook(event) {
    if (this.data.busy) return;
    const id = event.currentTarget.dataset.id;
    const current = this.data.books.find(book => book.id === id);
    if (!current) return;
    wx.showModal({
      title: "重命名笔记本",
      editable: true,
      placeholderText: "请输入名称",
      content: current.name,
      success: async result => {
        if (!result.confirm || this.data.busy) return;
        const name = String(result.content || "").trim();
        if (!name || name === current.name) return;
        this.setData({ busy: true });
        try {
          await updateNotebookBook(id, { name });
          this.setData({ busy: false });
          await this.loadBooks();
        } catch (error) {
          this.setData({ busy: false });
          this.handleActionError(error);
        }
      },
    });
  },

  deleteBook(event) {
    if (this.data.busy) return;
    const id = event.currentTarget.dataset.id;
    const current = this.data.books.find(book => book.id === id);
    if (!current) return;
    if (current.noteCount > 0) {
      wx.showToast({ title: "先清空笔记再删除", icon: "none" });
      return;
    }
    wx.showModal({
      title: `删除「${current.name}」？`,
      content: "删除后无法恢复。",
      confirmText: "删除",
      confirmColor: "#c74d38",
      success: async result => {
        if (!result.confirm || this.data.busy) return;
        this.setData({ busy: true });
        try {
          await deleteNotebookBook(id);
          this.setData({ busy: false });
          wx.showToast({ title: "已删除", icon: "success" });
          await this.loadBooks();
        } catch (error) {
          this.setData({ busy: false });
          this.handleActionError(error);
        }
      },
    });
  },

  handleActionError(error) {
    if (isNotebookUnauthorized(error)) {
      clearSession();
      this.setData({ isLoggedIn: false });
      wx.navigateTo({ url: `/pages/auth/index?mode=login&returnTo=${encodeURIComponent("/packages/notebook/books/index")}` });
      return;
    }
    wx.showToast({ title: notebookErrorMessage(error), icon: "none" });
  },

  openLogin() {
    wx.navigateTo({ url: `/pages/auth/index?mode=login&returnTo=${encodeURIComponent("/packages/notebook/books/index")}` });
  },

  retry() {
    this.loadBooks();
  },
});
