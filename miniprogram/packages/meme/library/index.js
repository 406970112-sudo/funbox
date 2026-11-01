const {
  getMemeClient,
  createPager,
  normalizeImage,
  mediaUrl
} = require('../../../utils/meme');
const {
  getAccessToken
} = require('../../../utils/auth');
Page({
  data: {
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
        broken: {}
      });
    });
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
    this._lastToken = token;
    if (changed && this.data.mode !== 'online' && this.data.tab === 'favorites') {
      this.pager.cancel();
      this.setData({
        items: [],
        pendingItems: [],
        pendingCount: 0,
        total: 0,
        syncMessage: ''
      });
    }
    this.setData({
      loggedIn: !!token
    });
    if (token) this.syncFavorites(changed);
    else if (changed) this.refresh();
    if (this._resumeRequest) {
      this._resumeRequest = false;
      if (this.data.mode === 'online') {
        if (!this.data.onlineSources.length) this.loadOnlineSources();
        else this.loadOnline(this._onlineRequestedPage || 1);
      } else if (this.data.tab === 'categories') this.loadCategories();
      else if (this.data.tab === 'ranking') this.loadRanking();
      else this.pager.retry();
    } else if (this.data.mode === 'online' && !this.data.onlineSources.length && !this.data.sourcesLoading) this.loadOnlineSources();
    else if (!changed && this.data.mode !== 'online' && this.data.tab === 'favorites') this.refreshFavorites();
    if (this._scrollTop) wx.pageScrollTo({
      scrollTop: this._scrollTop,
      duration: 0
    });
  },
  onHide() {
    this._resumeRequest = this.data.loading;
    this._active = false;
    this._generation++;
    this._sourcesGeneration = (this._sourcesGeneration || 0) + 1;
    this.setData({
      datesLoading: false,
      sourcesLoading: false,
      loading: false
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
    try {
      const result = await this.client.mergeFavorites();
      if (!this._active) return;
      this.setData({
        syncMessage: result.failed ? '部分收藏同步失败，已保留在本机，可重试' : ''
      });
      this.setData({
        pendingItems: this.client.localFavorites().slice(0, 6).map(normalizeImage),
        pendingCount: this.client.localFavorites().length
      });
      if (this.data.mode !== 'online' && (refresh || this.data.favoriteMode === 'pending') && this.data.tab === 'favorites') await this.refresh();
    } catch (error) {
      if (this._active) this.setData({
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
    if (!this._onlineQuery || !this.data.onlineSelected.length || this.data.mode !== 'online') return;
    const generation = ++this._generation;
    this._onlineRequestedPage = page;
    this.setData({loading: true, error: '', onlineSearched: true});
    try {
      const r = await this.client.onlineSearch({q: this._onlineQuery, sources: this._onlineSelected, page, limit: 36});
      if (!this._active || generation !== this._generation || this.data.mode !== 'online') return;
      this.setData({items: (r.items || []).map(normalizeImage), page: r.page || page,
        onlineHasMore: !!r.hasMore, onlineStatuses: r.sources || [], onlineNotice: r.notice || '',
        loading: false, broken: {}});
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
      items: all.slice((safe - 1) * 36, safe * 36).map(normalizeImage),
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
    if (this._localItems && this.data.tab === 'favorites' && (this.data.favoriteMode !== 'favorites' || !getAccessToken())) this.localPage(this.data.page + 1);
    else this.pager.next();
    wx.pageScrollTo({
      scrollTop: 0,
      duration: 0
    });
  },
  previous() {
    if (this.data.loading) return;
    if (this.data.mode === 'online') return this.data.page > 1 ? this.loadOnline(this.data.page - 1) : undefined;
    if (this.data.tab === 'favorites' && (this.data.favoriteMode !== 'favorites' || !getAccessToken())) this.localPage(this.data.page - 1);
    else this.pager.previous();
    wx.pageScrollTo({
      scrollTop: 0,
      duration: 0
    });
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
    const item = this.data.items.find(x => x.id === e.currentTarget.dataset.id);
    if (item && item.unavailable) return;
    wx.navigateTo({
      url: '/packages/meme/detail/index?id=' + encodeURIComponent(e.currentTarget.dataset.id)
    });
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
