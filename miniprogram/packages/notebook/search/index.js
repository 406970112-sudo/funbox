const {
  listNotebookBooks,
  listNotebookNotes,
  notebookErrorMessage,
  isNotebookUnauthorized,
} = require("../utils/notebook-api");
const { decorateNote, collectTags, bookTheme } = require("../utils/notebook-format");
const { getAccessToken, clearSession } = require("../../../utils/auth");

const scopes = [
  { id: "all", name: "全部" },
  { id: "title", name: "标题" },
  { id: "body", name: "正文" },
  { id: "tag", name: "标签" },
];

Page({
  data: {
    isLoggedIn: false,
    loading: false,
    error: "",
    query: "",
    activeScope: "all",
    scopes,
    books: [],
    activeBookId: "all",
    activeBookName: "",
    filterCount: 0,
    filterOpen: false,
    draftBookId: "all",
    draftTag: "",
    draftFavoriteOnly: false,
    searchFocused: false,
    activeTag: "",
    favoriteOnly: false,
    tags: [],
    results: [],
    resultCount: 0,
    hasSearched: false,
    referenceNotes: [],
    hasEncryptedNotes: false,
  },

  onLoad() {
    this._active = true;
    this._searchTimer = null;
    this.setData({ isLoggedIn: Boolean(getAccessToken()) });
  },

  onShow() {
    this._active = true;
    const loggedIn = Boolean(getAccessToken());
    const changed = loggedIn !== this.data.isLoggedIn;
    this.setData({ isLoggedIn: loggedIn });
    if (loggedIn) this.loadReference(changed);
  },

  onHide() {
    this._active = false;
    clearTimeout(this._searchTimer);
    this._generation = (this._generation || 0) + 1;
  },

  onUnload() {
    this.onHide();
  },

  async onPullDownRefresh() {
    try {
      if (this.data.isLoggedIn) await this.loadReference(true);
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  async loadReference(refreshSearch = false) {
    if (!this.data.isLoggedIn) return;
    const generation = (this._generation || 0) + 1;
    this._generation = generation;
    this.setData({ loading: true, error: "" });
    try {
      const [books, allNotes] = await Promise.all([
        listNotebookBooks(),
        listNotebookNotes({ limit: 100 }),
      ]);
      if (!this._active || generation !== this._generation) return;
      const themedBooks = books.map(book => ({ ...book, ...bookTheme(book.color) }));
      const notes = (allNotes.notes || []).map((note, index) => decorateNote(note, index));
      this.setData({
        books: themedBooks,
        referenceNotes: notes,
        tags: collectTags(notes),
        hasEncryptedNotes: notes.some(note => Boolean(note.encrypted)),
        loading: false,
      });
      this.syncFilters();
      this.runSearch();
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

  onInput(event) {
    const query = event.detail.value || "";
    this.setData({ query });
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => this.runSearch(), 260);
  },

  onConfirm() {
    clearTimeout(this._searchTimer);
    return this.runSearch();
  },

  clearSearch() {
    clearTimeout(this._searchTimer);
    this.setData({ query: "" });
    return this.runSearch();
  },

  changeScope(event) {
    const id = event.currentTarget.dataset.id;
    if (!id || id === this.data.activeScope) return;
    this.setData({ activeScope: id });
    return this.runSearch();
  },

  changeBook(event) {
    const id = event.currentTarget.dataset.id || "all";
    if (id === this.data.activeBookId) return;
    this.setData({ activeBookId: id });
    this.syncFilters();
    return this.runSearch();
  },

  changeTag(event) {
    const tag = event.currentTarget.dataset.tag || "";
    this.setData({ activeTag: tag === this.data.activeTag ? "" : tag });
    this.syncFilters();
    return this.runSearch();
  },

  toggleFavoriteOnly() {
    this.setData({ favoriteOnly: !this.data.favoriteOnly });
    this.syncFilters();
    return this.runSearch();
  },

  syncFilters() {
    const book = this.data.books.find(item => item.id === this.data.activeBookId);
    this.setData({
      activeBookName: book ? book.name : "",
      filterCount: Number(this.data.activeBookId !== "all") + Number(Boolean(this.data.activeTag)) + Number(this.data.favoriteOnly),
    });
  },

  openFilters() {
    this.setData({ filterOpen: true, draftBookId: this.data.activeBookId, draftTag: this.data.activeTag, draftFavoriteOnly: this.data.favoriteOnly });
  },

  closeFilters() { this.setData({ filterOpen: false }); },
  stopPropagation() {},
  draftBook(event) { this.setData({ draftBookId: event.currentTarget.dataset.id || "all" }); },
  draftTag(event) { this.setData({ draftTag: event.currentTarget.dataset.tag || "" }); },
  draftFavorite() { this.setData({ draftFavoriteOnly: !this.data.draftFavoriteOnly }); },
  resetDraft() { this.setData({ draftBookId: "all", draftTag: "", draftFavoriteOnly: false }); },
  applyFilters() {
    this.setData({ activeBookId: this.data.draftBookId, activeTag: this.data.draftTag, favoriteOnly: this.data.draftFavoriteOnly, filterOpen: false });
    this.syncFilters();
    return this.runSearch();
  },
  clearFilters() {
    this.setData({ activeBookId: "all", activeTag: "", favoriteOnly: false });
    this.syncFilters();
    return this.runSearch();
  },
  removeBook() { this.setData({ activeBookId: "all" }); this.syncFilters(); return this.runSearch(); },
  removeTag() { this.setData({ activeTag: "" }); this.syncFilters(); return this.runSearch(); },
  editQuery() { this.setData({ searchFocused: true }); },
  onBlur() { this.setData({ searchFocused: false }); },
  cancelSearch() { wx.navigateBack(); },

  async runSearch() {
    if (!this.data.isLoggedIn) return;
    const generation = (this._generation || 0) + 1;
    this._generation = generation;
    const query = this.data.query.trim();
    this.setData({ loading: true, error: "" });
    try {
      const result = await listNotebookNotes({
        q: query,
        bookId: this.data.activeBookId === "all" ? "" : this.data.activeBookId,
        tag: this.data.activeTag,
        favorite: this.data.favoriteOnly,
        limit: 100,
      });
      if (!this._active || generation !== this._generation) return;
      let notes = (result.notes || []).map((note, index) => decorateNote(note, index));
      if (query && this.data.activeScope !== "all") {
        const needle = query.toLocaleLowerCase();
        notes = notes.filter(note => {
          if (this.data.activeScope === "title") return String(note.title || "").toLocaleLowerCase().includes(needle);
          if (this.data.activeScope === "body") return String(note.body || "").toLocaleLowerCase().includes(needle);
          if (this.data.activeScope === "tag") return (note.tags || []).some(tag => String(tag).toLocaleLowerCase().includes(needle));
          return true;
        });
      }
      this.setData({ results: notes, resultCount: notes.length, loading: false, hasSearched: true });
    } catch (error) {
      if (!this._active || generation !== this._generation) return;
      if (isNotebookUnauthorized(error)) {
        clearSession();
        this.setData({ isLoggedIn: false, loading: false, error: "" });
        return;
      }
      this.setData({ loading: false, error: notebookErrorMessage(error), results: [], resultCount: 0 });
    }
  },

  openNote(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/packages/notebook/detail/index?id=${encodeURIComponent(id)}` });
  },

  manageBooks() {
    wx.navigateTo({ url: "/packages/notebook/books/index" });
  },

  createNote() {
    if (!this.data.isLoggedIn) {
      wx.navigateTo({ url: `/pages/auth/index?mode=login&returnTo=${encodeURIComponent("/packages/notebook/index/index")}` });
      return;
    }
    const bookId = this.data.activeBookId === "all" ? "" : this.data.activeBookId;
    wx.navigateTo({ url: `/packages/notebook/editor/index${bookId ? `?bookId=${encodeURIComponent(bookId)}` : ""}` });
  },

  openLogin() {
    wx.navigateTo({ url: `/pages/auth/index?mode=login&returnTo=${encodeURIComponent("/packages/notebook/search/index")}` });
  },

  retry() {
    this.loadReference(true);
  },
});
