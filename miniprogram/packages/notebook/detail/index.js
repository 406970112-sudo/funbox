const {
  getNotebookNote,
  updateNotebookNote,
  deleteNotebookNote,
  downloadNotebookMedia,
  notebookErrorMessage,
  isNotebookUnauthorized,
} = require("../utils/notebook-api");
const { decorateNote, formatNoteTime, bookTheme } = require("../utils/notebook-format");
const { getAccessToken, clearSession } = require("../../../utils/auth");

function noteSummary(body, checklist, images, audio) {
  const characterCount = Array.from(String(body || "").replace(/\s+/g, "")).length;
  const doneCount = checklist.filter(item => item.done).length;
  const parts = [];
  if (characterCount) parts.push(`${characterCount} 字`);
  if (checklist.length) parts.push(`清单 ${doneCount}/${checklist.length}`);
  if (images.length) parts.push(`图片 ${images.length} 张`);
  if (audio) parts.push("语音 1 段");
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
    images: [],
    audio: null,
    bookName: "",
    bookFill: "#eaf2ff",
    bookInk: "#2d5bff",
    updatedLabel: "",
    summaryLabel: "",
    checklistDone: 0,
    favorite: false,
    pinned: false,
    favoriteBusy: false,
    audioPlaying: false,
  },

  onLoad(options = {}) {
    this._active = true;
    this.noteId = options.id ? decodeURIComponent(options.id) : "";
    this.setData({ isLoggedIn: Boolean(getAccessToken()) });
    wx.showShareMenu({ menus: ["shareAppMessage"] });
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
    if (this._audioContext) this._audioContext.pause();
  },

  onUnload() {
    this.onHide();
    if (this._audioContext) {
      this._audioContext.destroy();
      this._audioContext = null;
    }
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
      const decorated = decorateNote(note);
      const theme = bookTheme(note.bookColor);
      const images = (note.media || []).filter(item => item.kind === "image").map(item => ({ ...item, localPath: "" }));
      const audio = (note.media || []).find(item => item.kind === "audio") || null;
      const checklist = (note.checklist || []).map(item => ({ ...item, done: Boolean(item.done) }));
      const checklistDone = checklist.filter(item => item.done).length;
      this._note = note;
      this.setData({
        loading: false,
        note: decorated,
        title: decorated.displayTitle,
        body: note.body || "",
        checklist,
        checklistDone,
        summaryLabel: noteSummary(note.body, checklist, images, audio),
        tags: note.tags || [],
        images,
        audio: audio ? { ...audio, durationLabel: "点击播放" } : null,
        bookName: note.bookName,
        bookFill: theme.fill,
        bookInk: theme.ink,
        updatedLabel: formatNoteTime(note.updatedAt),
        favorite: Boolean(note.favorite),
        pinned: Boolean(note.pinned),
      });
      this.hydrateImages(images);
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

  async toggleFavorite() {
    if (this.data.favoriteBusy || !this._note) return;
    const next = !this.data.favorite;
    this.setData({ favoriteBusy: true, favorite: next });
    try {
      const note = await updateNotebookNote(this.noteId, { favorite: next });
      if (!this._active) return;
      this._note = note;
      this.setData({ favoriteBusy: false, favorite: Boolean(note.favorite), pinned: Boolean(note.pinned) });
      wx.showToast({ title: next ? "已收藏" : "已取消收藏", icon: "none" });
    } catch (error) {
      if (!this._active) return;
      this.setData({ favoriteBusy: false, favorite: !next });
      this.handleError(error);
    }
  },

  openMore() {
    if (!this._note) return;
    const pinLabel = this.data.pinned ? "取消置顶" : "置顶笔记";
    wx.showActionSheet({
      itemList: [pinLabel, "删除笔记"],
      itemColor: "#172139",
      success: result => {
        if (result.tapIndex === 0) this.togglePinned();
        if (result.tapIndex === 1) this.confirmDelete();
      },
    });
  },

  async togglePinned() {
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
      title: "删除这条笔记？",
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
    wx.navigateTo({ url: `/packages/notebook/editor/index?id=${encodeURIComponent(this.noteId)}` });
  },

  previewImage(event) {
    const index = Number(event.currentTarget.dataset.index);
    const urls = this.data.images.map(item => item.localPath).filter(Boolean);
    if (!urls.length) return;
    const current = this.data.images[index] && this.data.images[index].localPath;
    wx.previewImage({ urls, current: current || urls[0] });
  },

  async playAudio() {
    if (!this.data.audio) return;
    if (this.data.audioPlaying) {
      if (this._audioContext) this._audioContext.pause();
      this.setData({ audioPlaying: false });
      return;
    }
    try {
      let localPath = this.data.audio.localPath;
      if (!localPath) {
        localPath = await downloadNotebookMedia(this.data.audio);
        this.setData({ audio: { ...this.data.audio, localPath } });
      }
      if (!this._audioContext) {
        this._audioContext = wx.createInnerAudioContext();
        this._audioContext.onPlay(() => this.setData({ audioPlaying: true }));
        this._audioContext.onPause(() => this.setData({ audioPlaying: false }));
        this._audioContext.onStop(() => this.setData({ audioPlaying: false }));
        this._audioContext.onEnded(() => this.setData({ audioPlaying: false }));
        this._audioContext.onError(() => {
          this.setData({ audioPlaying: false });
          wx.showToast({ title: "语音播放失败", icon: "none" });
        });
      }
      this._audioContext.src = localPath;
      this._audioContext.play();
    } catch (error) {
      this.handleError(error);
    }
  },

  handleError(error) {
    if (isNotebookUnauthorized(error)) {
      clearSession();
      this.setData({ isLoggedIn: false });
      return;
    }
    wx.showToast({ title: notebookErrorMessage(error), icon: "none" });
  },

  openLogin() {
    wx.navigateTo({
      url: `/pages/auth/index?mode=login&returnTo=${encodeURIComponent(`/packages/notebook/detail/index?id=${this.noteId}`)}`,
    });
  },

  retry() {
    if (this.data.isLoggedIn) this.loadNote();
  },

  onShareAppMessage() {
    return {
      title: this.data.title || "FunBox 笔记",
      path: `/packages/notebook/detail/index?id=${encodeURIComponent(this.noteId || "")}`,
    };
  },
});
