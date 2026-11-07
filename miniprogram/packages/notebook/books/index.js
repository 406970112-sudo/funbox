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
    nameValid: false,
    renameValid: false,
    selectedColor: palette[0],
    colors: palette,
    createOpen: false,
    keyboardHeight: 0,
    createBodyHeight: 360,
    selectedBook: null,
    renameOpen: false,
    renameName: "",
    deleteOpen: false,
  },

  onLoad() {
    this._active = true;
    this.setData({ isLoggedIn: Boolean(getAccessToken()) });
    this.measureSheetViewport();
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
    this.setData({ newBookName: event.detail.value || "", nameValid: Boolean((event.detail.value || "").trim()) });
  },

  selectColor(event) {
    const color = event.currentTarget.dataset.color;
    if (color) this.setData({ selectedColor: color });
  },

  async createBook() {
    if (this.data.busy) return;
    if (this.data.books.length >= 20) { wx.showToast({ title: "最多创建 20 本笔记本", icon: "none" }); return; }
    const name = this.data.newBookName.trim();
    if (!name) {
      wx.showToast({ title: "请输入笔记本名称", icon: "none" });
      return;
    }
    this.setData({ busy: true });
    try {
      await createNotebookBook(name, this.data.selectedColor);
      this.dismissCreateKeyboard();
      this.setData({ newBookName: "", busy: false, createOpen: false });
      wx.showToast({ title: "已创建", icon: "success" });
      await this.loadBooks();
    } catch (error) {
      this.setData({ busy: false });
      this.handleActionError(error);
    }
  },

  measureSheetViewport() {
    const info = typeof wx.getWindowInfo === "function" ? wx.getWindowInfo()
      : (typeof wx.getSystemInfoSync === "function" ? wx.getSystemInfoSync() : {});
    this._windowHeight = Number(info.windowHeight) || 640;
    this._windowWidth = Number(info.windowWidth) || 375;
    this._safeBottom = info.safeArea ? Math.max(0, (Number(info.screenHeight) || this._windowHeight) - info.safeArea.bottom) : 0;
    this.resizeCreateBody(this.data.keyboardHeight);
  },
  resizeCreateBody(height) {
    const keyboardHeight = Math.max(0, Number(height) || 0);
    const available = Math.max(180, (this._windowHeight || 640) - keyboardHeight);
    // The header and action row stay visible while the preview and fields scroll.
    const reserved = 268 * (this._windowWidth || 375) / 750 + (keyboardHeight ? 0 : this._safeBottom || 0);
    this.setData({ keyboardHeight, createBodyHeight: Math.max(72, Math.min(390, Math.floor(available * .94 - reserved))) });
  },
  onCreateKeyboardChange(event) { this.resizeCreateBody(event.detail && event.detail.height); },
  dismissCreateKeyboard() {
    this.resizeCreateBody(0);
    if (typeof wx.hideKeyboard === "function") wx.hideKeyboard();
  },

  openCreate() {
    if (this.data.books.length >= 20) { wx.showToast({ title: "最多创建 20 本笔记本", icon: "none" }); return; }
    this.measureSheetViewport();
    this.setData({ createOpen: true, newBookName: "", nameValid: false, selectedColor: palette[0] });
  },
  closeCreate() {
    if (this.data.busy) return;
    this.dismissCreateKeyboard();
    this.setData({ createOpen: false });
  },
  stopPropagation() {},
  openBookMenu(event) {
    const book = this.data.books.find(item => item.id === event.currentTarget.dataset.id);
    if (book && !this.data.busy) this.setData({ selectedBook: book });
  },
  closeBookMenu() { if (!this.data.busy) this.setData({ selectedBook: null }); },
  renameBook(event) {
    if (this.data.busy) return;
    const id = event && event.currentTarget.dataset.id;
    const book = id ? this.data.books.find(item => item.id === id) : this.data.selectedBook;
    if (book) this.setData({ selectedBook: book, renameOpen: true, renameName: book.name, renameValid: true });
  },
  onRenameInput(event) { this.setData({ renameName: event.detail.value || "", renameValid: Boolean((event.detail.value || "").trim()) }); },
  closeRename() { if (!this.data.busy) this.setData({ renameOpen: false }); },
  async saveRename() {
    const book = this.data.selectedBook;
    const name = this.data.renameName.trim();
    if (this.data.busy || !book || !name) return;
    if (name === book.name) { this.setData({ renameOpen: false, selectedBook: null }); return; }
    this.setData({ busy: true });
    try {
      await updateNotebookBook(book.id, { name });
      this.setData({ busy: false, renameOpen: false, selectedBook: null });
      wx.showToast({ title: "名称已更新", icon: "success" });
      await this.loadBooks();
    } catch (error) { this.setData({ busy: false }); this.handleActionError(error); }
  },
  deleteBook(event) {
    if (this.data.busy) return;
    const id = event && event.currentTarget.dataset.id;
    const book = id ? this.data.books.find(item => item.id === id) : this.data.selectedBook;
    if (!book) return;
    if (book.noteCount > 0) { wx.showToast({ title: "请先清空笔记再删除", icon: "none" }); return; }
    this.setData({ selectedBook: book, deleteOpen: true });
  },
  closeDelete() { if (!this.data.busy) this.setData({ deleteOpen: false }); },
  async confirmDelete() {
    const book = this.data.selectedBook;
    if (this.data.busy || !book || book.noteCount > 0) return;
    this.setData({ busy: true });
    try {
      await deleteNotebookBook(book.id);
      this.setData({ busy: false, deleteOpen: false, selectedBook: null });
      wx.showToast({ title: "已删除", icon: "success" });
      await this.loadBooks();
    } catch (error) { this.setData({ busy: false }); this.handleActionError(error); }
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
