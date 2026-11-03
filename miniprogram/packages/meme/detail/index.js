const {
  getAccessToken
} = require('../../../utils/auth');
const {
  getMemeClient,
  runImageMedia,
  normalizeImage
} = require('../../../utils/meme');
Page({
  data: {
    image: null,
    related: [],
    loading: true,
    error: '',
    favorite: false,
    favoriteBusy: false,
    busy: false,
    progress: 0,
    actionError: '',
    permissionDenied: false,
    imageFailed: false,
    sizeLabel: '',
    broken: {}
  },
  async onLoad(options = {}) {
    this.client = getMemeClient();
    this.id = options.id || '';
    this._active = true;
    this._lastToken = getAccessToken();
    wx.showShareMenu({
      menus: ['shareAppMessage']
    });
    return this.load();
  },
  onShow() {
    this._active = true;
    const token = getAccessToken();
    if (token !== this._lastToken) {
      this._lastToken = token;
      this._wasHidden = false;
      this.setData({
        favorite: false,
        favoriteBusy: false,
        actionError: ''
      });
      this.load();
      return;
    }
    if (this._wasHidden && !this.data.image && this.data.loading) {
      this._wasHidden = false;
      this.load();
    }
  },
  onHide() {
    this._active = false;
    this._wasHidden = true;
    this.setData({busy: false});
    this._operationGeneration = (this._operationGeneration || 0) + 1;
    this._generation = (this._generation || 0) + 1;
  },
  onUnload() {
    this._active = false;
    this._operationGeneration = (this._operationGeneration || 0) + 1;
    this._generation = (this._generation || 0) + 1;
  },
  async load() {
    const generation = this._generation = (this._generation || 0) + 1;
    this.setData({
      loading: true,
      error: ''
    });
    try {
      if (!this.id) throw new Error('缺少图片编号');
      const r = await this.client.detail(this.id);
      if (!this._active || generation !== this._generation) return;
      const image = normalizeImage(r.image);
      const pending = this.client.pendingFavorite(image.id);
      this.setData({
        image,
        related: (r.related || []).slice(0, 12).map(normalizeImage),
        favorite: pending ? pending.desired : !!image.favorite,
        loading: false,
        imageFailed: false,
        sizeLabel: image.bytes > 1024 * 1024 ? (image.bytes / 1024 / 1024).toFixed(1) + ' MB' : Math.ceil(image.bytes / 1024) + ' KB'
      });
      this.client.remember(image);
      if (!this._viewRecorded) {
        this._viewRecorded = true;
        this.client.event(image.id, 'view').catch(() => {});
      }
    } catch (e) {
      if (this._active && generation === this._generation) this.setData({
        loading: false,
        error: e.message
      });
    }
  },
  async favorite() {
    if (this.data.favoriteBusy || !this.data.image) return;
    const previous = this.data.favorite;
    const token = getAccessToken();
    const desired = !previous;
    this.setData({
      favorite: desired,
      favoriteBusy: true,
      actionError: ''
    });
    try {
      await this.client.favorite(this.data.image, desired);
    } catch (e) {
      if (this._active && token === getAccessToken()) {
        const pending = this.client.pendingFavorite(this.data.image.id);
        this.setData({favorite: pending ? pending.desired : previous, actionError: e.message});
      }
    } finally {
      if (token === getAccessToken()) this.setData({
        favoriteBusy: false
      });
    }
  },
  preview() {
    if (!this.data.image) return;
    wx.previewImage({
      urls: [this.data.image.url],
      current: this.data.image.url,
      fail: () => {
        if (this._active) this.setData({
          actionError: '预览失败，请重试或分享页面'
        });
      }
    });
  },
  imageError() {
    this.setData({
      imageFailed: true
    });
  },
  retryImage() {
    this.setData({
      imageFailed: false
    });
  },
  relatedError(e) {
    this.setData({
      ['broken.' + e.currentTarget.dataset.id]: true
    });
  },
  async save() {
    return this.runMedia('save');
  },
  async shareImage() {
    return this.runMedia('share');
  },
  async runMedia(action) {
    return runImageMedia(this, this.data.image, action, wx);
  },
  openSettings() {
    wx.openSetting({
      fail: () => this.setData({
        actionError: '无法打开设置，请在微信中检查相册权限'
      })
    });
  },
  openRelated(e) {
    wx.redirectTo({
      url: '/packages/meme/detail/index?id=' + encodeURIComponent(e.currentTarget.dataset.id)
    });
  },
  openCategory(e) {
    wx.navigateTo({
      url: '/packages/meme/library/index?category=' + encodeURIComponent(e.currentTarget.dataset.id) + '&title=' + encodeURIComponent(e.currentTarget.dataset.title)
    });
  },
  copySource() {
    const image = this.data.image;
    const online = image && (image.sourceId || image.sourceName);
    const url = online ? image.sourcePageUrl : 'https://zhaoolee.com/ChineseBQB/';
    if (url && /^https:\/\//i.test(url)) wx.setClipboardData({data: url});
  },
  report() {
    wx.navigateTo({
      url: '/pages/feedback/index'
    });
  },
  onShareAppMessage() {
    const image = this.data.image;
    return {
      title: image ? image.title : 'FunBox 表情包',
      path: '/packages/meme/detail/index?id=' + encodeURIComponent(this.id),
      imageUrl: image ? image.thumbnailUrl : undefined
    };
  },
});