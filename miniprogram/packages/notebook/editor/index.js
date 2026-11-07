const {
  listNotebookBooks,
  getNotebookNote,
  createNotebookNote,
  updateNotebookNote,
  getNotebookSecurity,
  setNotebookPassword,
  unlockNotebook,
  notebookErrorMessage,
  isNotebookUnauthorized,
  isNotebookLockedError,
} = require("../utils/notebook-api");
const { bookTheme } = require("../utils/notebook-format");
const { getAccessToken, clearSession } = require("../../../utils/auth");

function localID() {
  return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

Page({
  data: {
    isLoggedIn: false,
    loading: true,
    error: "",
    noteId: "",
    books: [],
    bookNames: [],
    bookIndex: 0,
    selectedBookId: "",
    selectedBookName: "选择笔记本",
    selectedBookFill: "#eaf2ff",
    selectedBookInk: "#2d5bff",
    title: "",
    body: "",
    checklist: [],
    tags: [],
    pinned: false,
    favorite: false,
    saveState: "saved",
    saveLabel: "开始输入后自动保存",
    showTagModal: false,
    tagDraft: "",
    tagError: "",
    encrypted: false,
    showPasswordModal: false,
    passwordMode: "setup",
    passwordValue: "",
    passwordConfirm: "",
    passwordError: "",
    passwordBusy: false,
    passwordAcknowledged: false,
    showBookSheet: false,
    keyboardHeight: 0,
    viewportHeight: 640,
    passwordPanelHeight: 590,
    modalFocus: "",
    scrollTop: 0,
    checklistDone: 0,
    dateLabel: "",
  },

  onLoad(options = {}) {
    this._active = true;
    this._unloaded = false;
    this._dirty = false;
    this._saveTimer = null;
    this._savePromise = null;
    this._saveAgain = false;
    this._lastPersistedEncrypted = false;
    this._editorLoaded = false;
    this.noteId = options.id ? decodeURIComponent(options.id) : "";
    this.initialBookId = options.bookId ? decodeURIComponent(options.bookId) : "";
    const loggedIn = Boolean(getAccessToken());
    this.setData({ isLoggedIn: loggedIn, noteId: this.noteId, loading: loggedIn });
    this.setupViewport();
    const now = new Date();
    this.setData({ dateLabel: `${now.getMonth() + 1}月${now.getDate()}日 · 随手记录` });
    if (loggedIn) this.loadEditor();
  },

  onHide() {
    this._active = false;
    if (this._loadInFlightGeneration) this._retryLoadOnShow = true;
    this._loadGeneration = (this._loadGeneration || 0) + 1;
    this._loadInFlightGeneration = null;
    this._bookRefreshGeneration = (this._bookRefreshGeneration || 0) + 1;
    this.saveNow({ silent: true });
  },

  onUnload() {
    this._unloaded = true;
    this._active = false;
    this._loadGeneration = (this._loadGeneration || 0) + 1;
    this._bookRefreshGeneration = (this._bookRefreshGeneration || 0) + 1;
    clearTimeout(this._saveTimer);
    this.saveNow({ silent: true, unloading: true });
    if (this._keyboardListener && typeof wx.offKeyboardHeightChange === "function") {
      wx.offKeyboardHeightChange(this._keyboardListener);
    }
  },

  async onShow() {
    this._active = true;
    if (this.data.isLoggedIn) {
      if (!this._editorLoaded && (this._retryLoadOnShow || !this._loadInFlightGeneration)) {
        this._retryLoadOnShow = false;
        await this.loadEditor();
      } else if (this._editorLoaded && this._refreshBooksOnShow) {
        await this.refreshBooks();
      }
    }
    if (this.noteId && !this._dirty && !this._savePromise) {
      this.updateSaveIndicator("saved", this.data.encrypted ? "已加密 · 已自动保存" : "已自动保存");
    }
  },

  setupViewport() {
    const info = typeof wx.getWindowInfo === "function" ? wx.getWindowInfo()
      : (typeof wx.getSystemInfoSync === "function" ? wx.getSystemInfoSync() : {});
    this._windowHeight = Number(info.windowHeight) || 640;
    this.setData({ viewportHeight: this._windowHeight, passwordPanelHeight: Math.min(590, this._windowHeight * .92) });
    this._keyboardListener = event => this.onKeyboardHeightChange({ detail: event });
    if (typeof wx.onKeyboardHeightChange === "function") wx.onKeyboardHeightChange(this._keyboardListener);
  },

  onKeyboardHeightChange(event) {
    const height = Math.max(0, Number(event.detail && event.detail.height) || 0);
    const viewportHeight = Math.max(180, (this._windowHeight || 640) - height);
    this.setData({ keyboardHeight: height, viewportHeight, passwordPanelHeight: Math.min(590, viewportHeight * .96) });
    this.revealFocusedField();
  },

  onEditorFocus(event) {
    this._focusedField = event.currentTarget.id;
    this.onKeyboardHeightChange({ detail: { height: event.detail.height || this.data.keyboardHeight } });
  },

  onModalFocus(event) {
    this.setData({ modalFocus: event.currentTarget.id });
  },

  onEditorScroll(event) {
    this._scrollTop = event.detail.scrollTop;
  },

  revealFocusedField() {
    if (!this._focusedField || typeof wx.createSelectorQuery !== "function") return;
    const reveal = () => {
      if (!this._active || !this._focusedField) return;
      wx.createSelectorQuery().in(this).select(`#${this._focusedField}`).boundingClientRect()
        .select(".editor-scroll").boundingClientRect().exec(rects => {
          const field = rects && rects[0];
          const scroll = rects && rects[1];
          if (!field || !scroll) return;
          const delta = field.bottom > scroll.bottom - 16 ? field.bottom - scroll.bottom + 16
            : (field.top < scroll.top + 12 ? field.top - scroll.top - 12 : 0);
          if (delta) this.setData({ scrollTop: Math.max(0, (this._scrollTop || 0) + delta) });
        });
    };
    if (typeof wx.nextTick === "function") wx.nextTick(reveal);
    else reveal();
  },

  async loadEditor() {
    const generation = (this._loadGeneration || 0) + 1;
    this._loadGeneration = generation;
    this._loadInFlightGeneration = generation;
    this.setData({ loading: true, error: "" });
    try {
      const [books, security] = await Promise.all([listNotebookBooks(), getNotebookSecurity()]);
      if (!this._active || generation !== this._loadGeneration) return;
      this._security = security || {};
      const themed = (books || []).map(book => ({ ...book, ...bookTheme(book.color), initial: String(book.name || "").trim().slice(0, 1) }));
      this._books = themed;
      if (this.noteId) {
        const note = await getNotebookNote(this.noteId);
        if (!this._active || generation !== this._loadGeneration) return;
        if (note.locked) {
          this.setData({ loading: false, error: "这条加密笔记需要先在详情页解锁。" });
          return;
        }
        this.applyLoadedNote(note, themed);
      } else {
        const selected = themed.find(book => book.id === this.initialBookId) || themed[0];
        const selectedIndex = selected ? Math.max(0, themed.findIndex(book => book.id === selected.id)) : 0;
        this._editorLoaded = true;
        this.setData({
          loading: false,
          books: themed,
          bookNames: themed.map(book => book.name),
          bookIndex: selectedIndex,
          selectedBookId: selected ? selected.id : "",
          selectedBookName: selected ? selected.name : "选择笔记本",
          selectedBookFill: selected ? selected.fill : "#eaf2ff",
          selectedBookInk: selected ? selected.ink : "#2d5bff",
        });
      }
    } catch (error) {
      if (!this._active || generation !== this._loadGeneration) return;
      if (isNotebookUnauthorized(error)) {
        this.handleUnauthorized();
        return;
      }
      this.setData({ loading: false, error: notebookErrorMessage(error) });
    } finally {
      if (this._loadInFlightGeneration === generation) this._loadInFlightGeneration = null;
    }
  },

  async refreshBooks() {
    const generation = (this._bookRefreshGeneration || 0) + 1;
    this._bookRefreshGeneration = generation;
    try {
      const books = await listNotebookBooks();
      if (!this._active || generation !== this._bookRefreshGeneration) return;
      const themed = (books || []).map(book => ({ ...book, ...bookTheme(book.color) }));
      const selected = themed.find(book => book.id === this.data.selectedBookId) || themed[0];
      const previousBookId = this.data.selectedBookId;
      this._books = themed;
      this._refreshBooksOnShow = false;
      this.setData({
        books: themed,
        bookNames: themed.map(book => book.name),
        bookIndex: selected ? Math.max(0, themed.findIndex(book => book.id === selected.id)) : 0,
        selectedBookId: selected ? selected.id : "",
        selectedBookName: selected ? selected.name : "选择笔记本",
        selectedBookFill: selected ? selected.fill : "#eaf2ff",
        selectedBookInk: selected ? selected.ink : "#2d5bff",
      });
      if (this.data.selectedBookId !== previousBookId) this.scheduleSave();
    } catch (error) {
      if (!this._active || generation !== this._bookRefreshGeneration) return;
      if (isNotebookUnauthorized(error)) this.handleUnauthorized();
      else wx.showToast({ title: notebookErrorMessage(error), icon: "none" });
    }
  },

  applyLoadedNote(note, books) {
    this._editorLoaded = true;
    const book = (books || []).find(item => item.id === note.bookId) || {
      id: note.bookId,
      name: note.bookName,
      color: note.bookColor,
      ...bookTheme(note.bookColor),
    };
    this.noteId = note.id;
    this._hydrating = true;
    this.setData({
      loading: false,
      books,
      bookNames: (books || []).map(item => item.name),
      bookIndex: Math.max(0, (books || []).findIndex(item => item.id === book.id)),
      noteId: note.id,
      selectedBookId: book.id,
      selectedBookName: book.name,
      selectedBookFill: book.fill || bookTheme(book.color).fill,
      selectedBookInk: book.ink || bookTheme(book.color).ink,
      title: note.title || "",
      body: note.body || "",
      checklist: (note.checklist || []).map(item => ({ ...item, id: item.id || localID() })),
      tags: note.tags || [],
      checklistDone: (note.checklist || []).filter(item => item.done).length,
      pinned: Boolean(note.pinned),
      favorite: Boolean(note.favorite),
      encrypted: Boolean(note.encrypted),
      saveLabel: note.encrypted ? "已加密 · 已自动保存" : "已自动保存",
      saveState: "saved",
    });
    this._hydrating = false;
    this._lastPersistedEncrypted = Boolean(note.encrypted);
  },

  updateSaveIndicator(state, label) {
    this.setData({ saveState: state, saveLabel: label });
  },

  onTitleInput(event) {
    this.setData({ title: event.detail.value || "" });
    this.scheduleSave();
  },

  onBodyLineChange() {
    if (this._focusedField === "note-body" && this.data.keyboardHeight) this.revealFocusedField();
  },

  onBodyInput(event) {
    this.setData({ body: event.detail.value || "" });
    this.scheduleSave();
  },

  addChecklistItem() {
    this.setData({ checklist: [...this.data.checklist, { id: localID(), text: "", done: false }] });
    this._focusedField = `check-${this.data.checklist.length - 1}`;
    this.revealFocusedField();
    this.scheduleSave();
  },

  onChecklistInput(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index) || index < 0) return;
    const checklist = this.data.checklist.map((item, i) => i === index ? { ...item, text: event.detail.value || "" } : item);
    this.setData({ checklist, checklistDone: checklist.filter(item => item.done).length });
    this.scheduleSave();
  },

  toggleChecklist(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index) || index < 0) return;
    const checklist = this.data.checklist.map((item, i) => i === index ? { ...item, done: !item.done } : item);
    this.setData({ checklist, checklistDone: checklist.filter(item => item.done).length });
    this.scheduleSave();
  },

  removeChecklist(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index) || index < 0) return;
    const checklist = this.data.checklist.filter((_, i) => i !== index);
    this.setData({ checklist, checklistDone: checklist.filter(item => item.done).length });
    this.scheduleSave();
  },

  openTagModal() {
    this.setData({ showTagModal: true, tagDraft: "", tagError: "" });
  },

  closeTagModal() {
    this.setData({ showTagModal: false, tagDraft: "", tagError: "" });
    if (typeof wx.hideKeyboard === "function") wx.hideKeyboard();
  },

  onTagInput(event) {
    this.setData({ tagDraft: event.detail.value || "", tagError: "" });
  },

  confirmTag() {
    const tag = String(this.data.tagDraft || "").trim().replace(/^#+/, "").trim();
    if (!tag) {
      this.setData({ tagError: "请输入标签" });
      return;
    }
    if (Array.from(tag).length > 20) {
      this.setData({ tagError: "标签不能超过 20 个字符" });
      return;
    }
    if (this.data.tags.length >= 8) {
      this.setData({ tagError: "最多添加 8 个标签" });
      return;
    }
    if (this.data.tags.some(item => item.toLowerCase() === tag.toLowerCase())) {
      this.setData({ tagError: "这个标签已经添加了" });
      return;
    }
    this.setData({ tags: [...this.data.tags, tag], showTagModal: false, tagDraft: "", tagError: "" });
    this.scheduleSave();
  },

  removeTag(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index) || index < 0) return;
    this.setData({ tags: this.data.tags.filter((_, i) => i !== index) });
    this.scheduleSave();
  },

  openBookSheet() {
    if (typeof wx.hideKeyboard === "function") wx.hideKeyboard();
    this.setData({ showBookSheet: true });
  },

  closeBookSheet() {
    this.setData({ showBookSheet: false });
  },

  manageBooks() {
    this._refreshBooksOnShow = true;
    this.closeBookSheet();
    wx.navigateTo({ url: "/packages/notebook/books/index" });
  },

  onBookChange(event) {
    const index = Number(event.currentTarget.dataset.index);
    const book = this._books && this._books[index];
    if (!book || book.id === this.data.selectedBookId) return;
    this.setData({
      showBookSheet: false,
      bookIndex: index,
      selectedBookId: book.id,
      selectedBookName: book.name,
      selectedBookFill: book.fill,
      selectedBookInk: book.ink,
    });
    this.scheduleSave();
  },

  hasContent() {
    return Boolean(String(this.data.title || "").trim() || String(this.data.body || "").trim()
      || this.data.checklist.some(item => String(item.text || "").trim()));
  },

  buildPayload() {
    return {
      bookId: this.data.selectedBookId,
      title: this.data.title,
      body: this.data.body,
      checklist: this.data.checklist.map(item => ({ id: item.id && !item.id.startsWith("local-") ? item.id : "", text: item.text, done: Boolean(item.done) })),
      tags: this.data.tags,
      pinned: this.data.pinned,
      favorite: this.data.favorite,
      encrypted: this.data.encrypted,
    };
  },

  scheduleSave() {
    if (this._hydrating || !this.data.isLoggedIn) return;
    this._dirty = true;
    this.updateSaveIndicator("pending", "等待保存…");
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.saveNow({ silent: true }), 650);
  },

  async saveNow(options = {}) {
    clearTimeout(this._saveTimer);
    if (!this.data.isLoggedIn) return false;
    if (this._savePromise) {
      this._saveAgain = this._saveAgain || this._dirty;
      return this._savePromise;
    }
    if (!this.hasContent()) {
      if (this.noteId) {
        this._dirty = false;
        this.updateSaveIndicator("error", "笔记不能为空");
        return false;
      }
      this._dirty = false;
      this.updateSaveIndicator("saved", "开始输入后自动保存");
      return true;
    }
    if (!this._dirty && this.noteId) return true;
    this._savePromise = (async () => {
      let saved = true;
      while (true) {
        this._saveAgain = false;
        const payload = this.buildPayload();
        const snapshot = JSON.stringify(payload);
        if (options.unloading !== true) this.updateSaveIndicator("saving", "正在保存…");
        try {
          const note = this.noteId
            ? await updateNotebookNote(this.noteId, payload)
            : await createNotebookNote(payload);
          this.noteId = note.id;
          this._lastPersistedEncrypted = Boolean(note.encrypted);
          if (options.unloading !== true && this._active) {
            this.setData({
              noteId: note.id,
              pinned: Boolean(note.pinned),
              favorite: Boolean(note.favorite),
              encrypted: Boolean(note.encrypted),
            });
          }
          this._dirty = JSON.stringify(this.buildPayload()) !== snapshot;
        } catch (error) {
          saved = false;
          this._dirty = true;
          if (isNotebookUnauthorized(error)) {
            this.handleUnauthorized();
          } else if (isNotebookLockedError(error)) {
            this.updateSaveIndicator("error", "解锁已过期，请重新输入密码");
            this._resumeSaveAfterUnlock = true;
            if (this._active) this.openPasswordModal("unlock");
          } else if (options.unloading !== true) {
            this.updateSaveIndicator("error", notebookErrorMessage(error));
            if (!options.silent) wx.showToast({ title: notebookErrorMessage(error), icon: "none" });
          }
          break;
        }
        if (!this._dirty && !this._saveAgain) break;
      }
      if (saved) {
        this._dirty = false;
        if (options.unloading !== true && this._active) {
          this.updateSaveIndicator("saved", this.data.encrypted ? "已加密 · 已自动保存" : "已自动保存");
        }
      }
      return saved;
    })();
    try {
      return await this._savePromise;
    } finally {
      this._savePromise = null;
    }
  },

  retrySave() {
    return this.saveNow({ silent: false });
  },

  async saveAndClose() {
    if (!this.hasContent()) {
      if (this.noteId) {
        wx.showToast({ title: "至少保留标题、正文或清单", icon: "none" });
        return;
      }
      wx.navigateBack();
      return;
    }
    const saved = await this.saveNow();
    if (!saved) return;
    wx.navigateBack();
  },

  async toggleEncryption() {
    if (this.data.passwordBusy || this._savePromise) {
      wx.showToast({ title: "正在保存，请稍后再试", icon: "none" });
      return;
    }
    if (this.data.encrypted) {
      this.disableEncryption();
      return;
    }
    try {
      const security = await getNotebookSecurity();
      this._security = security || {};
      if (!security.hasPassword) {
        this.openPasswordModal("setup");
        return;
      }
      if (!security.unlocked) {
        this.openPasswordModal("unlock");
        return;
      }
      wx.showModal({
        title: "开启加密笔记？",
        content: "标题、正文、清单和标签都会转为密文保存。",
        confirmText: "开启加密",
        success: result => {
          if (result.confirm) this.applyEncryption();
        },
      });
    } catch (error) {
      if (isNotebookUnauthorized(error)) this.handleUnauthorized();
      else wx.showToast({ title: notebookErrorMessage(error), icon: "none" });
    }
  },

  openPasswordModal(mode) {
    this.setData({
      showPasswordModal: true,
      passwordMode: mode,
      passwordValue: "",
      passwordConfirm: "",
      passwordError: "",
      passwordAcknowledged: false,
    });
  },

  togglePasswordAcknowledged() {
    this.setData({ passwordAcknowledged: !this.data.passwordAcknowledged, passwordError: "" });
  },

  closePasswordModal() {
    if (this.data.passwordBusy) return;
    // A cancelled decrypt attempt remains encrypted. A failed encrypt attempt
    // retains its encryption intent so a later autosave cannot persist plaintext.
    const restoreEncrypted = this._resumeSaveAfterUnlock && !this.data.encrypted && this._lastPersistedEncrypted
      ? true
      : null;
    this._resumeSaveAfterUnlock = false;
    const update = { showPasswordModal: false, passwordValue: "", passwordConfirm: "", passwordError: "" };
    if (restoreEncrypted !== null) update.encrypted = restoreEncrypted;
    this.setData(update);
    if (typeof wx.hideKeyboard === "function") wx.hideKeyboard();
  },

  onPasswordInput(event) {
    this.setData({ passwordValue: event.detail.value || "", passwordError: "" });
  },

  onPasswordConfirmInput(event) {
    this.setData({ passwordConfirm: event.detail.value || "", passwordError: "" });
  },

  async submitPasswordModal() {
    if (this.data.passwordBusy) return;
    const password = String(this.data.passwordValue || "");
    if (!password) {
      this.setData({ passwordError: "请输入笔记密码" });
      return;
    }
    if (this.data.passwordMode === "setup") {
      const length = Array.from(password).length;
      if (length < 6 || length > 32) {
        this.setData({ passwordError: "笔记密码需为 6–32 位" });
        return;
      }
      if (!this.data.passwordAcknowledged) {
        this.setData({ passwordError: "请先确认已了解并记住密码" });
        return;
      }
      if (password !== this.data.passwordConfirm) {
        this.setData({ passwordError: "两次输入的密码不一致" });
        return;
      }
    }
    this.setData({ passwordBusy: true, passwordError: "" });
    try {
      if (this.data.passwordMode === "setup") {
        await setNotebookPassword("set", "", password);
        this.setData({ passwordMode: "unlock", passwordConfirm: "" });
      }
      await unlockNotebook(password);
      this.setData({ passwordBusy: false, showPasswordModal: false, passwordValue: "", passwordConfirm: "" });
      if (this._resumeSaveAfterUnlock) {
        this._resumeSaveAfterUnlock = false;
        setTimeout(() => this.saveNow({ silent: false }), 0);
      } else if (!this.data.encrypted) {
        wx.showModal({
          title: "开启加密笔记？",
          content: "标题、正文、清单和标签都会转为密文保存。",
          confirmText: "开启加密",
          success: result => {
            if (result.confirm) this.applyEncryption();
          },
        });
      }
    } catch (error) {
      if (isNotebookUnauthorized(error)) {
        this.handleUnauthorized();
        return;
      }
      if (error && error.code === "notebook_note_password_already_set") {
        this.setData({ passwordMode: "unlock", passwordConfirm: "" });
      }
      this.setData({ passwordBusy: false, passwordError: notebookErrorMessage(error) });
    }
  },

  async applyEncryption() {
    if (this.data.passwordBusy) return;
    if (!this.hasContent()) {
      this.setData({ encrypted: true });
      wx.showToast({ title: "加密已开启", icon: "none" });
      return;
    }
    this.setData({ encrypted: true });
    this._dirty = true;
    const saved = await this.saveNow({ silent: false });
    if (!saved && this._active) {
      this.updateSaveIndicator("error", "加密保存失败，点击重试");
      return;
    }
    if (saved && this._active) wx.showToast({ title: "已加密保存", icon: "success" });
  },

  disableEncryption() {
    wx.showModal({
      title: "取消这条笔记的加密？",
      content: "取消后标题、正文、清单和标签会恢复为普通笔记，并重新参与搜索。",
      confirmText: "取消加密",
      confirmColor: "#c74d38",
      success: async result => {
        if (!result.confirm) return;
        if (!this.noteId) {
          this.setData({ encrypted: false, saveState: "saved", saveLabel: "已取消加密" });
          return;
        }
        this.setData({ encrypted: false });
        this._dirty = true;
        const saved = await this.saveNow({ silent: false });
        if (!saved && this._active) {
          if (!this._resumeSaveAfterUnlock) this.setData({ encrypted: true });
          return;
        }
        if (saved && this._active) wx.showToast({ title: "已取消加密", icon: "none" });
      },
    });
  },

  handleUnauthorized() {
    clearSession();
    this.setData({ isLoggedIn: false, loading: false, error: "" });
  },

  openLogin() {
    wx.navigateTo({ url: `/pages/auth/index?mode=login&returnTo=${encodeURIComponent("/packages/notebook/index/index")}` });
  },

  retry() {
    if (this.data.isLoggedIn) this.loadEditor();
  },

  noop() {},
});
