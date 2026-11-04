const {
  listNotebookBooks,
  getNotebookNote,
  createNotebookNote,
  updateNotebookNote,
  uploadNotebookMedia,
  deleteNotebookMedia,
  downloadNotebookMedia,
  notebookErrorMessage,
  isNotebookUnauthorized,
} = require("../utils/notebook-api");
const { bookTheme } = require("../utils/notebook-format");
const { getAccessToken, clearSession } = require("../../../utils/auth");

function localID() {
  return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatSeconds(value) {
  const total = Math.max(0, Number(value) || 0);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
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
    images: [],
    audio: null,
    pinned: false,
    favorite: false,
    saveState: "saved",
    saveLabel: "开始输入后自动保存",
    showTagModal: false,
    tagDraft: "",
    tagError: "",
    uploadingMedia: false,
    recording: false,
    recordSeconds: 0,
    recordLabel: "00:00",
    audioPlaying: false,
  },

  onLoad(options = {}) {
    this._active = true;
    this._unloaded = false;
    this._dirty = false;
    this._saveTimer = null;
    this._savePromise = null;
    this._saveAgain = false;
    this.noteId = options.id ? decodeURIComponent(options.id) : "";
    this.initialBookId = options.bookId ? decodeURIComponent(options.bookId) : "";
    const loggedIn = Boolean(getAccessToken());
    this.setData({ isLoggedIn: loggedIn, noteId: this.noteId, loading: loggedIn });
    this.setupRecorder();
    if (loggedIn) this.loadEditor();
  },

  onHide() {
    this._active = false;
    if (this.data.recording) this.discardRecording();
    if (this._audioContext && this.data.audioPlaying) {
      this._audioContext.pause();
      this.setData({ audioPlaying: false });
    }
    this.saveNow({ silent: true });
  },

  onUnload() {
    this._unloaded = true;
    clearTimeout(this._saveTimer);
    if (this.data.recording) this.discardRecording();
    this.saveNow({ silent: true });
    if (this._audioContext) {
      this._audioContext.destroy();
      this._audioContext = null;
    }
  },

  async loadEditor() {
    this.setData({ loading: true, error: "" });
    try {
      const books = await listNotebookBooks();
      if (!this._active) return;
      const themed = (books || []).map(book => ({ ...book, ...bookTheme(book.color), initial: String(book.name || "").trim().slice(0, 1) }));
      this._books = themed;
      if (this.noteId) {
        const note = await getNotebookNote(this.noteId);
        if (!this._active) return;
        this.applyLoadedNote(note, themed);
      } else {
        const selected = themed.find(book => book.id === this.initialBookId) || themed[0];
        const selectedIndex = selected ? Math.max(0, themed.findIndex(book => book.id === selected.id)) : 0;
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
      if (!this._active) return;
      if (isNotebookUnauthorized(error)) {
        this.handleUnauthorized();
        return;
      }
      this.setData({ loading: false, error: notebookErrorMessage(error) });
    }
  },

  applyLoadedNote(note, books) {
    const book = (books || []).find(item => item.id === note.bookId) || {
      id: note.bookId,
      name: note.bookName,
      color: note.bookColor,
      ...bookTheme(note.bookColor),
    };
    const media = note.media || [];
    const images = media.filter(item => item.kind === "image").map(item => ({ ...item, localPath: "" }));
    const audio = media.find(item => item.kind === "audio") || null;
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
      images,
      audio,
      pinned: Boolean(note.pinned),
      favorite: Boolean(note.favorite),
      saveLabel: "已自动保存",
      saveState: "saved",
    });
    this._hydrating = false;
    this.hydrateImages(images);
    if (audio) this.prepareAudio(audio);
  },

  async hydrateImages(images) {
    for (const image of images) {
      try {
        const localPath = await downloadNotebookMedia(image);
        if (!this._active) return;
        this.setData({ images: this.data.images.map(item => item.id === image.id ? { ...item, localPath } : item) });
      } catch (error) {
        if (this._active) wx.showToast({ title: "图片加载失败", icon: "none" });
      }
    }
  },

  updateSaveIndicator(state, label) {
    this.setData({ saveState: state, saveLabel: label });
  },

  onTitleInput(event) {
    this.setData({ title: event.detail.value || "" });
    this.scheduleSave();
  },

  onBodyInput(event) {
    this.setData({ body: event.detail.value || "" });
    this.scheduleSave();
  },

  addChecklistItem() {
    this.setData({ checklist: [...this.data.checklist, { id: localID(), text: "", done: false }] });
    this.scheduleSave();
  },

  onChecklistInput(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index) || index < 0) return;
    const checklist = this.data.checklist.map((item, i) => i === index ? { ...item, text: event.detail.value || "" } : item);
    this.setData({ checklist });
    this.scheduleSave();
  },

  toggleChecklist(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index) || index < 0) return;
    const checklist = this.data.checklist.map((item, i) => i === index ? { ...item, done: !item.done } : item);
    this.setData({ checklist });
    this.scheduleSave();
  },

  removeChecklist(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index) || index < 0) return;
    this.setData({ checklist: this.data.checklist.filter((_, i) => i !== index) });
    this.scheduleSave();
  },

  openTagModal() {
    this.setData({ showTagModal: true, tagDraft: "", tagError: "" });
  },

  closeTagModal() {
    this.setData({ showTagModal: false, tagDraft: "", tagError: "" });
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

  onBookChange(event) {
    const index = Number(event.detail.value);
    const book = this._books && this._books[index];
    if (!book || book.id === this.data.selectedBookId) return;
    this.setData({
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
          if (options.unloading !== true && this._active) {
            this.setData({
              noteId: note.id,
              pinned: Boolean(note.pinned),
              favorite: Boolean(note.favorite),
            });
          }
          this._dirty = JSON.stringify(this.buildPayload()) !== snapshot;
        } catch (error) {
          saved = false;
          this._dirty = true;
          if (isNotebookUnauthorized(error)) {
            this.handleUnauthorized();
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
        if (options.unloading !== true && this._active) this.updateSaveIndicator("saved", "已自动保存");
      }
      return saved;
    })();
    try {
      return await this._savePromise;
    } finally {
      this._savePromise = null;
    }
  },

  async saveAndClose() {
    if (this.data.recording) {
      wx.showToast({ title: "请先结束录音", icon: "none" });
      return;
    }
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

  async ensureNote() {
    if (this.noteId) return true;
    if (!this.hasContent()) {
      wx.showToast({ title: "先写一句话再添加附件", icon: "none" });
      return false;
    }
    const saved = await this.saveNow();
    return saved && Boolean(this.noteId);
  },

  async chooseImages() {
    if (this.data.uploadingMedia) return;
    const remaining = 4 - this.data.images.length;
    if (remaining <= 0) {
      wx.showToast({ title: "最多添加 4 张图片", icon: "none" });
      return;
    }
    if (!(await this.ensureNote())) return;
    wx.chooseMedia({
      count: remaining,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      sizeType: ["compressed"],
      success: async result => {
        const files = (result.tempFiles || []).slice(0, remaining);
        if (!files.length) return;
        this.setData({ uploadingMedia: true });
        for (const file of files) {
          try {
            const media = await uploadNotebookMedia(this.noteId, "image", file.tempFilePath);
            this.setData({ images: [...this.data.images, { ...media, localPath: file.tempFilePath }] });
          } catch (error) {
            wx.showToast({ title: notebookErrorMessage(error), icon: "none" });
            break;
          }
        }
        this.setData({ uploadingMedia: false });
      },
    });
  },

  async removeImage(event) {
    const index = Number(event.currentTarget.dataset.index);
    const image = this.data.images[index];
    if (!image || this.data.uploadingMedia) return;
    wx.showModal({
      title: "移除图片？",
      content: "图片会从这条笔记中删除。",
      confirmText: "移除",
      success: async result => {
        if (!result.confirm) return;
        try {
          await deleteNotebookMedia(image.id);
          this.setData({ images: this.data.images.filter((_, i) => i !== index) });
        } catch (error) {
          wx.showToast({ title: notebookErrorMessage(error), icon: "none" });
        }
      },
    });
  },

  setupRecorder() {
    if (typeof wx.getRecorderManager !== "function") return;
    this.recorder = wx.getRecorderManager();
    this.recorder.onStart(() => {
      this.setData({ recording: true, recordSeconds: 0, recordLabel: "00:00" });
      clearInterval(this._recordTimer);
      this._recordTimer = setInterval(() => {
        const next = this.data.recordSeconds + 1;
        this.setData({ recordSeconds: next, recordLabel: formatSeconds(next) });
      }, 1000);
    });
    this.recorder.onStop(result => {
      clearInterval(this._recordTimer);
      this._recordTimer = null;
      this.setData({ recording: false });
      if (this._discardRecording || this._unloaded) {
        this._discardRecording = false;
        return;
      }
      this.uploadRecordedAudio(result);
    });
    this.recorder.onError(() => {
      clearInterval(this._recordTimer);
      this._recordTimer = null;
      this.setData({ recording: false });
      wx.showToast({ title: "录音失败，请重试", icon: "none" });
    });
  },

  discardRecording() {
    this._discardRecording = true;
    if (this.recorder) this.recorder.stop();
    clearInterval(this._recordTimer);
    this._recordTimer = null;
    this.setData({ recording: false, recordSeconds: 0, recordLabel: "00:00" });
  },

  async toggleRecording() {
    if (this.data.recording) {
      if (this.recorder) this.recorder.stop();
      return;
    }
    if (this.data.audio) {
      wx.showToast({ title: "请先删除已有语音", icon: "none" });
      return;
    }
    if (!this.recorder) {
      wx.showToast({ title: "当前环境不支持录音", icon: "none" });
      return;
    }
    if (!(await this.ensureNote())) return;
    this._discardRecording = false;
    this.recorder.start({
      duration: 60000,
      format: "mp3",
      sampleRate: 16000,
      encodeBitRate: 48000,
      numberOfChannels: 1,
    });
  },

  async uploadRecordedAudio(result) {
    const tempFilePath = result && result.tempFilePath;
    if (!tempFilePath) return;
    this.setData({ uploadingMedia: true });
    try {
      const media = await uploadNotebookMedia(this.noteId, "audio", tempFilePath);
      this.setData({
        audio: { ...media, localPath: tempFilePath, durationLabel: formatSeconds(Math.round((result.duration || 0) / 1000)) },
        uploadingMedia: false,
      });
    } catch (error) {
      this.setData({ uploadingMedia: false });
      wx.showToast({ title: notebookErrorMessage(error), icon: "none" });
    }
  },

  async playAudio() {
    if (!this.data.audio) return;
    if (this.data.audioPlaying) {
      if (this._audioContext) this._audioContext.stop();
      this.setData({ audioPlaying: false });
      return;
    }
    try {
      let localPath = this.data.audio.localPath;
      if (!localPath) {
        localPath = await downloadNotebookMedia(this.data.audio);
        this.setData({ audio: { ...this.data.audio, localPath } });
      }
      if (this._audioContext) this._audioContext.destroy();
      this._audioContext = wx.createInnerAudioContext();
      this._audioContext.src = localPath;
      this._audioContext.onPlay(() => this.setData({ audioPlaying: true }));
      this._audioContext.onEnded(() => this.setData({ audioPlaying: false }));
      this._audioContext.onStop(() => this.setData({ audioPlaying: false }));
      this._audioContext.onError(() => {
        this.setData({ audioPlaying: false });
        wx.showToast({ title: "语音播放失败", icon: "none" });
      });
      this._audioContext.play();
    } catch (error) {
      wx.showToast({ title: notebookErrorMessage(error), icon: "none" });
    }
  },

  async deleteAudio() {
    const audio = this.data.audio;
    if (!audio || this.data.uploadingMedia) return;
    wx.showModal({
      title: "删除语音？",
      content: "语音会从这条笔记中删除。",
      confirmText: "删除",
      success: async result => {
        if (!result.confirm) return;
        try {
          if (this._audioContext) {
            this._audioContext.destroy();
            this._audioContext = null;
          }
          await deleteNotebookMedia(audio.id);
          this.setData({ audio: null, audioPlaying: false });
        } catch (error) {
          wx.showToast({ title: notebookErrorMessage(error), icon: "none" });
        }
      },
    });
  },

  prepareAudio(audio) {
    this.setData({ audio: { ...audio, localPath: "", durationLabel: "点击播放" } });
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
