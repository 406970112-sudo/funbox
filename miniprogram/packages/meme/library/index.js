const {
  getMemeClient,
  createPager,
  normalizeImage,
  uniqueImages,
  runImageMedia,
  mediaUrl
} = require('../../../utils/meme');
const {
  getAccessToken
} = require('../../../utils/auth');
Page({
  data: {
    favoriteBusy: {},
    busy: false,
    progress: 0,
    canRetryImageAction: false,
    actionError: '',
    permissionDenied: false,
    mode: 'library',
    onlineDetailsExpanded: false,
    onlineSources: [],
    onlineSelected: [],
    onlineStatuses: [],
    onlineHasMore: false,
    onlineSearched: false,
    onlineNotice: '',
    sourcesLoading: false,
    sourcesError: '',
    onlineAttribution: null,
    tabs: [{
      id: 'all',
      title: '全部'
    }, {
      id: 'categories',
      title: '分类'
    }, {
      id: 'ranking',
      title: '榜单'
    }, {
      id: 'favorites',
      title: '藏图'
    }],
    tab: 'all',
    q: '',
    type: '',
    category: '',
    categoryTitle: '',
    sort: 'default',
    sortIndex: 0,
    sortOptions: ['默认排序', '最近入库'],
    items: [],
    categories: [],
    categoryTotal: 0,
    groups: ['全部', '原生分类'],
    group: '全部',
    searches: [],
    loading: false,
    error: '',
    total: 0,
    page: 1,
    nextCursor: '',
    period: 'day',
    date: '',
    dates: [],
    dateIndex: 0,
    datesCursor: '',
    datesLoading: false,
    rankMode: 'curated',
    rankNotice: '',
    rankingMeta: '',
    favoriteMode: 'favorites',
    loggedIn: false,
    syncMessage: '',
    sourceText: '来源 ChineseBQB · 分类及标签匹配',
    broken: {},
    scrollTop: 0,
    pendingItems: [],
    pendingCount: 0
  },
  async onLoad(options = {}) {
    this.client = getMemeClient();
    this._generation = 0;
    this._active = true;
    this._lastToken = getAccessToken();
    this.setData({
      mode: options.mode === 'online' ? 'online' : 'library',
      tab: ['all', 'categories', 'ranking', 'favorites'].includes(options.tab) ? options.tab : 'all',
      q: options.q || '',
      category: options.category || '',
      categoryTitle: options.title || '',
      searches: this.client.searches(),
      loggedIn: !!this._lastToken
    });
    this.pager = createPager(input => this.data.tab === 'favorites' ? this.client.favorites({
      cursor: input.cursor,
      limit: input.limit
    }) : this.client.list(input), patch => {
      if (this._active) this.setData({
        ...patch,
        items: this.decorateFavorites(patch.items),
        broken: patch.page > 1 ? this.data.broken : {}
      });
    }, {append: true});
    wx.showShareMenu({
      menus: ['shareAppMessage']
    });
    if (this.data.mode === 'online') await this.loadOnlineSources();
    else await this.refresh();
  },
  onShow() {
    this._active = true;
    if (!this.client) return;
    const token = getAccessToken();
    const changed = token !== this._lastToken;
    const privateCollection = this.data.mode !== 'online' && this.data.tab === 'favorites';
    this._lastToken = token;
    if (changed) {
      this._favoriteGeneration = (this._favoriteGeneration || 0) + 1;
      this.setData({favoriteBusy: {}, items: privateCollection ? [] : this.decorateFavorites(this.data.items.map(x => ({...x, favorite: false})))});
    } else this.setData({items: this.decorateFavorites(this.data.items)});
    if (changed && privateCollection) {
      // The pager owns retained results as well as the visible array. Invalidate
      // both before B can resume or page using any of A's private cursors.
      this._resumeRequest = false;
      this._localItems = null;
      this._scrollTop = 0;
      this.pager.reset();
      this.setData({pendingItems: [], pendingCount: 0, syncMessage: ''});
    }
    this.setData({loggedIn: !!token});
    if (changed && privateCollection) this.refreshFavorites(true);
    else if (!changed && privateCollection && (this.data.favoriteMode !== 'favorites' || !token)) this.refreshFavorites();
    // New-account page one is independent of a potentially slow merge. A late
    // merge must not reset the new account's already loaded browsing depth.
    if (token) this.syncFavorites();
    else if (changed && !privateCollection) this.refresh();
    if (this._resumeRequest) {
      this._resumeRequest = false;
      if (this.data.mode === 'online') {
        if (!this.data.onlineSources.length) this.loadOnlineSources();
        else this.loadOnline(this._onlineRequestedPage || 1);
      } else if (this.data.tab === 'categories') this.loadCategories();
      else if (this.data.tab === 'ranking') this.loadRanking();
      else this.pager.retry();
    } else if (this.data.mode === 'online' && !this.data.onlineSources.length && !this.data.sourcesLoading) this.loadOnlineSources();

    if (this._scrollTop) wx.pageScrollTo({
      scrollTop: this._scrollTop,
      duration: 0
    });
  },
  onHide() {
    this._resumeRequest = this.data.loading;
    this._active = false;
    this._operationGeneration = (this._operationGeneration || 0) + 1;
    this._favoriteGeneration = (this._favoriteGeneration || 0) + 1;
    this._generation++;
    this._sourcesGeneration = (this._sourcesGeneration || 0) + 1;
    this.setData({
      datesLoading: false,
      sourcesLoading: false,
      loading: false, busy: false, favoriteBusy: {}
    });
    if (this.pager) this.pager.cancel();
  },
  onUnload() {
    this.onHide();
  },
  onPageScroll(e) {
    this._scrollTop = e.scrollTop;
  },
  async syncFavorites(refresh = false) {
    const token = getAccessToken();
    try {
      const result = await this.client.mergeFavorites();
      if (!this._active || token !== getAccessToken()) return;
      this.setData({
        syncMessage: result.failed ? '部分收藏同步失败，已保留在本机，可重试' : ''
      });
      this.setData({
        pendingItems: this.client.localFavorites().slice(0, 6).map(normalizeImage),
        pendingCount: this.client.localFavorites().length
      });
      this.setData({items: this.decorateFavorites(this.data.items)});
      if (this.data.mode !== 'online' && this.data.tab === 'favorites') {
        if (refresh === true) await this.refresh();
        else if (this.data.favoriteMode === 'pending') this.refreshFavorites();
      }
    } catch (error) {
      if (this._active && token === getAccessToken()) this.setData({
        syncMessage: error.message
      });
    }
  },
  onInput(e) {
    this.setData({
      q: e.detail.value
    });
  },
  async changeMode(e) {
    const mode = e.currentTarget.dataset.mode;
    if (!['library', 'online'].includes(mode) || mode === this.data.mode) return;
    this._generation++;
    this.pager.cancel();
    if (mode === 'online') this._libraryQuery = this.data.q;
    else this._onlineDraft = this.data.q;
    this.setData({mode, q: mode === 'online' ? (this._onlineDraft || '') : (this._libraryQuery || ''),
      items: [], loading: false, error: '', page: 1, nextCursor: '', total: 0,
      onlineSearched: false, onlineHasMore: false, onlineStatuses: [], onlineNotice: ''});
    if (mode === 'online') return this.loadOnlineSources();
    return this.refresh();
  },
  async searchOnline() {
    const q = this.data.q.trim();
    this._onlineDraft = q;
    await this.changeMode({currentTarget: {dataset: {mode: 'online'}}});
    if (this._active && this.data.mode === 'online') return this.search();
  },
  toggleOnlineDetails() {
    this.setData({onlineDetailsExpanded: !this.data.onlineDetailsExpanded});
  },
  async loadOnlineSources() {
    const generation = this._sourcesGeneration = (this._sourcesGeneration || 0) + 1;
    this.setData({sourcesLoading: true, sourcesError: ''});
    try {
      const r = await this.client.onlineSources();
      if (!this._active || generation !== this._sourcesGeneration || this.data.mode !== 'online') return;
      const items = (r.items || []).map(x => ({...x, selected: x.enabled && (!this._sourcesLoaded || this.data.onlineSelected.includes(x.id))}));
      this._sourcesLoaded = true;
      this.setData({onlineSources: items, onlineSelected: items.filter(x => x.selected).map(x => x.id),
        onlineAttribution: r.attribution || null, sourcesLoading: false});
    } catch (_) {
      if (this._active && generation === this._sourcesGeneration) this.setData({sourcesLoading: false, sourcesError: '来源加载失败，请重试'});
    }
  },
  toggleOnlineSource(e) {
    const id = e.currentTarget.dataset.id;
    const source = this.data.onlineSources.find(x => x.id === id);
    if (!source || !source.enabled || this.data.loading) return;
    const selected = this.data.onlineSelected.includes(id) ? this.data.onlineSelected.filter(x => x !== id) : [...this.data.onlineSelected, id];
    this._generation++;
    this.setData({onlineSelected: selected, onlineSources: this.data.onlineSources.map(x => ({...x, selected: selected.includes(x.id)})),
      onlineSearched: false, items: [], error: '', page: 1, onlineHasMore: false, onlineStatuses: [], onlineNotice: ''});
  },
  async loadOnline(page = 1) {
    if (this.data.loading) return;
    if (!this._onlineQuery || !this.data.onlineSelected.length || this.data.mode !== 'online') return;
    const generation = ++this._generation;
    this._onlineRequestedPage = page;
    this.setData({loading: true, error: '', onlineSearched: true});
    try {
      const r = await this.client.onlineSearch({q: this._onlineQuery, sources: this._onlineSelected, page, limit: 36});
      if (!this._active || generation !== this._generation || this.data.mode !== 'online') return;
      this.setData({items: this.decorateFavorites(uniqueImages([...(page > 1 ? this.data.items : []), ...(r.items || []).map(normalizeImage)])), page: r.page || page,
        onlineHasMore: !!r.hasMore, onlineStatuses: r.sources || [], onlineNotice: r.notice || '',
        loading: false, broken: page > 1 ? this.data.broken : {}});
    } catch (_) {
      if (this._active && generation === this._generation) this.setData({loading: false, error: '联网搜索失败，请稍后重试'});
    }
  },
  copyOnlineAttribution() {
    const url = this.data.onlineAttribution && this.data.onlineAttribution.url;
    if (url) wx.setClipboardData({data: url});
  },
  search() {
    if (this.data.mode === 'online') {
      const q = this.data.q.trim();
      this._generation++;
      this.setData({q, items: [], loading: false, error: '', onlineStatuses: [], onlineNotice: '', onlineHasMore: false, onlineSearched: false, page: 1});
      if (!q) return;
      if (!this.data.onlineSelected.length) {this.setData({error: '请先选择至少一个可用来源'}); return;}
      this._onlineQuery = q;
      this._onlineSelected = [...this.data.onlineSelected];
      return this.loadOnline(1);
    }
    this.client.rememberSearch(this.data.q.trim());
    this.setData({
      q: this.data.q.trim(),
      searches: this.client.searches()
    });
    return this.refresh();
  },
  historySearch(e) {
    this.setData({
      q: e.currentTarget.dataset.q
    });
    return this.search();
  },
  clearHistory() {
    this.client.clearSearches();
    this.setData({
      searches: []
    });
  },
  changeTab(e) {
    this._generation++;
    this.pager.cancel();
    this.setData({
      tab: e.currentTarget.dataset.tab,
      error: '',
      items: [],
      category: '',
      categoryTitle: '',
      page: 1,
      q: '',
      type: ''
    });
    return this.refresh();
  },
  changeType(e) {
    this.setData({
      type: e.currentTarget.dataset.type
    });
    return this.refresh();
  },
  changeSort(e) {
    const index = Number(e.detail.value);
    this.setData({
      sort: index ? 'newest' : 'default',
      sortIndex: index
    });
    return this.refresh();
  },
  chooseCategory(e) {
    this.setData({
      category: e.currentTarget.dataset.id,
      categoryTitle: e.currentTarget.dataset.title,
      tab: 'all'
    });
    return this.refresh();
  },
  clearCategory() {
    this.setData({
      category: '',
      categoryTitle: ''
    });
    return this.refresh();
  },
  chooseGroup(e) {
    this.setData({
      group: e.currentTarget.dataset.group
    });
    return this.loadCategories();
  },
  changePeriod(e) {
    this.setData({
      period: e.currentTarget.dataset.period,
      date: ''
    });
    return this.loadRanking();
  },
  async chooseDate(e) {
    const index = Number(e.detail.value);
    this.setData({
      dateIndex: index,
      date: this.data.dates[index],
      period: 'day'
    });
    return this.loadRanking();
  },
  async loadDates() {
    if (this.data.datesLoading) return;
    this.setData({
      datesLoading: true
    });
    try {
      const r = await this.client.dates(this.data.datesCursor);
      if (!this._active) return;
      const dates = Array.from(new Set([...this.data.dates, ...r.dates]));
      this.setData({
        dates,
        datesCursor: r.nextCursor || ''
      });
      if (!dates.length) wx.showToast({
        title: '还没有历史日榜',
        icon: 'none'
      });
    } catch (e) {
      if (this._active) this.setData({
        error: e.message
      });
    } finally {
      if (this._active) this.setData({
        datesLoading: false
      });
    }
  },
  changeFavoriteMode(e) {
    this.setData({
      favoriteMode: e.currentTarget.dataset.mode,
      q: '',
      type: ''
    });
    return this.refresh();
  },
  filters() {
    return {
      q: this.data.q,
      category: this.data.category,
      animated: this.data.type,
      sort: this.data.sort
    };
  },
  refresh() {
    if (this.data.mode === 'online') return;
    this._generation++;
    this.pager.cancel();
    if (this.data.tab === 'categories') return this.loadCategories();
    if (this.data.tab === 'ranking') return this.loadRanking();
    if (this.data.tab === 'favorites') return this.refreshFavorites(true);
    return this.pager.load(this.filters());
  },
  async loadCategories() {
    const generation = ++this._generation;
    this.setData({
      loading: true,
      error: ''
    });
    try {
      const r = await this.client.categories({
        q: this.data.q
      });
      if (generation !== this._generation || !this._active) return;
      const items = r.items || [];
      const groups = ['全部', '原生分类', ...Array.from(new Set(items.map(x => x.group).filter(x => x && x !== '原生分类')))];
      const selected = this.data.group;
      this.setData({
        categories: items.filter(x => selected === '全部' || (selected === '原生分类' ? !x.group || x.group === '原生分类' : x.group === selected)).map(x => ({
          ...x,
          coverUrl: mediaUrl(x.coverUrl)
        })),
        categoryTotal: r.total,
        groups,
        loading: false
      });
    } catch (e) {
      if (generation === this._generation && this._active) this.setData({
        error: e.message,
        loading: false
      });
    }
  },
  async loadRanking() {
    const generation = ++this._generation;
    this.setData({
      loading: true,
      error: '',
      items: []
    });
    try {
      const r = await this.client.rankings({
        period: this.data.period,
        date: this.data.date
      });
      if (generation !== this._generation || !this._active) return;
      this.setData({
        items: (r.items || []).map(x => normalizeImage({
          ...x,
          rank: r.mode === 'ranking' ? x.rank : undefined
        })),
        rankMode: r.mode,
        rankNotice: r.notice || (r.mode === 'curated' ? '精选推荐，热度积累中' : ''),
        rankingMeta: [r.isFinal ? '已封榜' : '动态更新', r.date, '更新 ' + (r.updatedAt || ''), '统计始于 ' + (r.dataSince || ''), '算法 ' + (r.algorithmVersion || '')].join(' · '),
        loading: false
      });
    } catch (e) {
      if (generation === this._generation && this._active) this.setData({
        loading: false,
        error: e.message
      });
    }
  },
  refreshFavorites(reset = false) {
    this.setData({
      pendingItems: this.client.localFavorites().slice(0, 6).map(normalizeImage),
      pendingCount: this.client.localFavorites().length
    });
    if (this.data.favoriteMode !== 'favorites' || !getAccessToken()) {
      this._localItems = (this.data.favoriteMode === 'recent' ? this.client.recent() : this.client.localFavorites()).filter(x => !this.data.q || (x.title + ' ' + x.label + ' ' + (x.categories || []).map(c => c.title).join(' ')).includes(this.data.q)).filter(x => this.data.type === '' || String(x.animated) === this.data.type);
      return this.localPage(reset ? 1 : this.data.page);
    }
    return reset ? this.pager.load(this.filters()) : this.pager.retry();
  },
  localPage(page) {
    const all = this._localItems || [];
    const safe = Math.max(1, Math.min(page, Math.ceil(all.length / 36) || 1));
    this.setData({
      items: this.decorateFavorites(all.slice(0, safe * 36).map(normalizeImage)),
      page: safe,
      total: all.length,
      nextCursor: safe * 36 < all.length ? 'local' : '',
      loading: false,
      error: '',
      broken: {}
    });
  },
  next() {
    if (this.data.loading) return;
    if (this.data.mode === 'online') return this.data.onlineHasMore ? this.loadOnline(this.data.page + 1) : undefined;
    if (!this.data.nextCursor && this.data.mode !== 'online') return;
    if (this._localItems && this.data.tab === 'favorites' && (this.data.favoriteMode !== 'favorites' || !getAccessToken())) return this.localPage(this.data.page + 1);
    return this.pager.next();
  },
  onReachBottom() {
    if (this.data.mode === 'online' || ['all', 'favorites'].includes(this.data.tab)) return this.next();
  },
  retry() {
    if (this.data.mode === 'online') return this._onlineQuery && this.data.onlineSelected.length ? this.loadOnline(this._onlineRequestedPage || 1) : this.search();
    if (this.data.tab === 'all' || (this.data.tab === 'favorites' && this.data.favoriteMode === 'favorites' && getAccessToken())) return this.pager.retry();
    return this.refresh();
  },
  imageError(e) {
    this.setData({
      ['broken.' + e.currentTarget.dataset.id]: true
    });
  },
  openImage(e) {
    if (this._suppressTap && this._suppressTap.id === e.currentTarget.dataset.id && Date.now() < this._suppressTap.until) {this._suppressTap = null; return;}
    const item = this.data.items.find(x => x.id === e.currentTarget.dataset.id);
    if (item && item.unavailable) return;
    wx.navigateTo({
      url: '/packages/meme/detail/index?id=' + encodeURIComponent(e.currentTarget.dataset.id)
    });
  },
  decorateFavorites(items) {
    return (items || []).map(item => {
      const pending = this.client.pendingFavorite && this.client.pendingFavorite(item.id);
      const favorite = pending ? pending.desired : this.client.favoriteState ? this.client.favoriteState(item.id, !!item.favorite || (this.data.tab === 'favorites' && this.data.favoriteMode === 'favorites')) : !!item.favorite;
      return {...item, favorite};
    });
  },
  async toggleFavorite(e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.items.find(x => x.id === id);
    if (!item || item.unavailable || this.data.favoriteBusy[id]) return;
    const desired = !item.favorite;
    const token = getAccessToken(), generation = this._favoriteGeneration || 0;
    const active = () => this._active && token === getAccessToken() && generation === (this._favoriteGeneration || 0);
    this.setData({favoriteBusy: {...this.data.favoriteBusy, [id]: true}, actionError: '', items: this.data.items.map(x => x.id === id ? {...x, favorite: desired} : x)});
    try {await this.client.favorite(item, desired);}
    catch (error) {
      if (active()) {
        const pending = this.client.pendingFavorite && this.client.pendingFavorite(id);
        this.setData({items: this.data.items.map(x => x.id === id ? {...x, favorite: pending ? pending.desired : item.favorite} : x),
          syncMessage: pending ? '收藏操作已保留在本机，云端同步失败，可重试同步' : '', actionError: pending ? '' : error.message});
      }
    } finally {
      if (active()) {const busy = {...this.data.favoriteBusy}; delete busy[id]; this.setData({favoriteBusy: busy});}
    }
  },
  longPressImage(e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.items.find(x => x.id === id);
    this._suppressTap = {id, until: Date.now() + 1000};
    if (!item || item.unavailable || this.data.busy) return;
    wx.showActionSheet({itemList: ['预览原图', item.favorite ? '取消收藏' : '收藏', '分享图片'],
      success: async result => {
        if (!this._active) return;
        this._suppressTap = {id, until: Date.now() + 1000};
        if (result.tapIndex === 1) return this.toggleFavorite(e);
        if (result.tapIndex === 0 || result.tapIndex === 2) return this.imageAction(id, result.tapIndex === 0 ? 'preview' : 'share');
      }});
  },
  async imageAction(id, action) {
    if (this.data.busy) return;
    const generation = this._operationGeneration || 0;
    this.setData({busy: true, actionError: '', canRetryImageAction: true});
    this._lastImageAction = {id, action};
    try {
      const result = await this.client.detail(id);
      if (!this._active || generation !== (this._operationGeneration || 0)) return;
      const image = normalizeImage(result.image);
      if (image.unavailable || !image.url) throw new Error('原图暂不可用，请稍后重试');
      if (action === 'preview') wx.previewImage({urls: [image.url], current: image.url,
        fail: () => {if (this._active) this.setData({actionError: '预览失败，请重试'});}});
      else {this.setData({busy: false}); await runImageMedia(this, image, action, wx);}
    } catch (error) {
      if (this._active && generation === (this._operationGeneration || 0)) this.setData({actionError: error.message});
    } finally {
      if (this._active && generation === (this._operationGeneration || 0)) this.setData({busy: false});
    }
  },
  retryImageAction() {
    if (this._lastImageAction) return this.imageAction(this._lastImageAction.id, this._lastImageAction.action);
  },
  openSettings() {
    wx.openSetting({fail: () => this.setData({actionError: '无法打开设置，请在微信中检查相册权限'})});
  },
  async removeUnavailable(e) {
    const item = [...this.data.items, ...this.data.pendingItems].find(x => x.id === e.currentTarget.dataset.id);
    if (item) {
      await this.client.favorite(item, false).catch(() => {
        if (this._active) this.setData({
          syncMessage: '移除操作已留存，待同步'
        });
      });
      this.refreshFavorites();
    }
  },
  login() {
    wx.navigateTo({
      url: '/pages/auth/index'
    });
  },
  copySource() {
    wx.setClipboardData({
      data: 'https://zhaoolee.com/ChineseBQB/'
    });
  },
  explainRanking() {
    wx.showModal({
      title: 'FunBox 站内热门',
      content: '有效详情浏览 × 1 + 新增收藏 × 3 + 保存成功 × 5。按北京时间统计、同一主体按图和行为每日去重。每图至少 3 个主体、达标不足 10 图时仅显示精选，不代表全网或微信聊天热度。',
      showCancel: false
    });
  },
  onShareAppMessage() {
    if (this.data.mode === 'online') return {
      title: 'FunBox 联网搜图',
      path: '/packages/meme/library/index?mode=online&q=' + encodeURIComponent(this.data.q)
    };
    return {
      title: this.data.categoryTitle ? this.data.categoryTitle + ' · 表情包' : 'FunBox 表情包',
      path: '/packages/meme/library/index?category=' + encodeURIComponent(this.data.category) + '&title=' + encodeURIComponent(this.data.categoryTitle) + '&q=' + encodeURIComponent(this.data.q)
    };
  },
});
