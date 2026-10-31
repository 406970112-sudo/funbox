const {
  request
} = require('./request');
const {
  getAccessToken,
  getStoredUser
} = require('./auth');
const {
  API_BASE_URL
} = require('../config/index');
const PREFIX = 'funbox.meme.';

function mediaUrl(url) {
  if (!url) return '';
  const origin = API_BASE_URL.replace(/\/api\/v1\/?$/, '');
  if (url.startsWith('/api/v1/meme-media/')) return origin + url;
  if (url.startsWith('/meme-media/')) return API_BASE_URL + url;
  return url.startsWith(API_BASE_URL + '/meme-media/') ? url : '';
}

function normalizeImage(item) {
  return {
    ...item,
    url: mediaUrl(item.url),
    thumbnailUrl: mediaUrl(item.thumbnailUrl)
  };
}

function query(input) {
  return Object.keys(input).filter(k => input[k] !== '' && input[k] !== undefined && input[k] !== null).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(input[k])).join('&');
}

function createMemeClient(options = {}) {
  const storage = options.storage || {
    get: key => wx.getStorageSync(key),
    set: (key, value) => wx.setStorageSync(key, value)
  };
  const send = options.request || request;
  const token = options.getToken || getAccessToken;
  const read = key => storage.get(PREFIX + key) || [];
  const write = (key, value) => storage.set(PREFIX + key, value);
  const getUser = options.getUser || getStoredUser;
  const merging = new Map();

  function accountScope() {
    if (!token()) return 'guest';
    const user = getUser();
    return user && user.id !== undefined && user.id !== null && String(user.id) !== '' ?
      'account.' + encodeURIComponent(String(user.id)) : null;
  }

  function scopedKey(kind, scope = accountScope()) {
    return scope ? scope + '.' + kind : null;
  }

  function entries(scope = accountScope()) {
    const key = scopedKey('pending', scope);
    return key ? read(key) : [];
  }

  function writeEntries(scope, value) {
    write(scopedKey('pending', scope), value);
  }

  function setLocalFavorite(image, desired) {
    const scope = accountScope();
    if (!scope) throw new Error('账号信息不可用，请重新登录后重试');
    const current = entries(scope);
    const prior = current.find(x => x.image.id === image.id);
    writeEntries(scope, [{
        image,
        desired,
        revision: (prior ? prior.revision : 0) + 1
      },
      ...current.filter(x => x.image.id !== image.id)
    ]);
  }
  // Bind guest intentions before any network await. Once bound they remain owned
  // by that stable account ID even when its token rotates or a different user logs in.
  function claimGuest(scope) {
    const guest = entries('guest');
    if (!guest.length) return;
    const owned = entries(scope);
    const ids = new Set(owned.map(x => x.image.id));
    writeEntries(scope, [...owned, ...guest.filter(x => !ids.has(x.image.id))]);
    writeEntries('guest', []);
  }
  async function reconcile(id, scope) {
    for (;;) {
      const current = entries(scope).find(x => x.image.id === id);
      const bearer = token();
      if (!current || !bearer || accountScope() !== scope) return;
      try {
        await send({
          path: '/memes/' + encodeURIComponent(id) + '/favorite',
          method: current.desired ? 'PUT' : 'DELETE',
          bearerToken: bearer
        });
      } catch (error) {
        // A rotated token can expire while its request is in flight. Retry only
        // for the same stable account, after that older request has settled.
        if (accountScope() === scope && token() && token() !== bearer) continue;
        throw error;
      }
      if (accountScope() !== scope) return;
      const latest = entries(scope).find(x => x.image.id === id);
      if (latest && latest.revision === current.revision) {
        writeEntries(scope, entries(scope).filter(x => x.image.id !== id));
        return;
      }
    }
  }

  function mergeFavorites() {
    const bearer = token();
    const scope = accountScope();
    if (!bearer || !scope) return Promise.resolve({
      failed: 0
    });
    claimGuest(scope);
    // One worker per stable account, including across token refreshes. Newer
    // intentions must not overtake an older request for the same image.
    const key = scope;
    if (merging.has(key)) return merging.get(key);
    const pending = (async () => {
      const failedIds = new Set();
      // Re-read after every batch so new images added by another caller are
      // uploaded before the shared worker resolves. Failed IDs wait for an
      // explicit later retry rather than spinning in this worker.
      while (accountScope() === scope) {
        const batch = entries(scope).filter(entry => !failedIds.has(entry.image.id));
        if (!batch.length) break;
        await Promise.all(batch.map(async entry => {
          try {
            await reconcile(entry.image.id, scope);
          } catch (_) {
            failedIds.add(entry.image.id);
          }
        }));
      }
      return {
        failed: failedIds.size
      };
    })().finally(() => {
      merging.delete(key);
    });
    merging.set(key, pending);
    return pending;
  }

  function anonymousId() {
    let id = storage.get(PREFIX + 'installation');
    if (!id) {
      id = 'wx-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
      storage.set(PREFIX + 'installation', id);
    }
    return id;
  }

  function event(imageId, type) {
    return send({
      path: '/memes/events',
      method: 'POST',
      bearerToken: token(),
      data: {
        imageId,
        type,
        eventId: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2),
        anonymousId: anonymousId()
      }
    });
  }
  return {
    localFavorites: () => entries().filter(x => x.desired).map(x => x.image),
    pendingFavorite: id => entries().find(x => x.image.id === id),
    setLocalFavorite,
    mergeFavorites,
    async favorite(image, desired) {
      setLocalFavorite(image, desired);
      if (token()) {
        const result = await mergeFavorites();
        if (result.failed) throw new Error('云端同步失败，操作已保留，稍后重试');
      }
      return desired;
    },
    recent: () => scopedKey('recent') ? read(scopedKey('recent')) : [],
    remember(image) {
      const key = scopedKey('recent');
      if (key) write(key, [image, ...read(key).filter(x => x.id !== image.id)].slice(0, 60));
    },
    searches: () => read('searches'),
    rememberSearch(q) {
      if (q) write('searches', [q, ...read('searches').filter(x => x !== q)].slice(0, 12));
    },
    clearSearches() {
      write('searches', []);
    },
    list: input => send({
      path: '/memes?' + query(input)
    }),
    categories: input => send({
      path: '/memes/categories?' + query(input)
    }),
    rankings: input => send({
      path: '/memes/rankings?' + query(input)
    }),
    dates: cursor => send({
      path: '/memes/ranking-dates?' + query({
        cursor
      })
    }),
    detail: id => send({
      path: '/memes/' + encodeURIComponent(id),
      bearerToken: token()
    }),
    favorites: input => send({
      path: '/memes/favorites?' + query({
        cursor: input.cursor,
        limit: input.limit
      }),
      bearerToken: token()
    }),
    event,
    async media(image, action, platform = wx, onProgress = () => {}, isActive = () => true) {
      if (image.unavailable) throw new Error('内容已下架，无法下载或分享');
      const url = mediaUrl(image.url);
      if (!url) throw new Error('图片地址不可用');
      const file = await new Promise((resolve, reject) => {
        const task = platform.downloadFile({
          url,
          timeout: 60000,
          success: r => r.statusCode === 200 && r.tempFilePath ? resolve(r.tempFilePath) : reject(new Error('下载失败，请重试')),
          fail: e => reject(new Error(e.errMsg || '下载失败，请重试'))
        });
        if (task && task.onProgressUpdate) task.onProgressUpdate(r => onProgress(r.progress));
      });
      if (!isActive()) throw new Error('已离开页面，请返回后重试');
      const method = action === 'save' ? 'saveImageToPhotosAlbum' : 'showShareImageMenu';
      if (typeof platform[method] !== 'function') throw new Error('当前微信版本不支持，请预览原图或分享页面');
      await new Promise((resolve, reject) => platform[method]({
        filePath: file,
        path: file,
        success: resolve,
        fail: e => reject(new Error(e.errMsg || '操作失败，请重试'))
      }));
      if (action === 'save') await event(image.id, 'save').catch(() => {});
      return {
        saved: action === 'save'
      };
    },
  };
}

function createPager(fetchPage, onChange = () => {}) {
  let generation = 0;
  let filters = {};
  let cursors = [''];
  let requestedPage = 1;
  const state = {
    items: [],
    page: 1,
    nextCursor: '',
    total: 0,
    loading: false,
    error: '',
    source: null
  };
  const update = patch => {
    Object.assign(state, patch);
    onChange({
      ...state
    });
  };
  async function loadPage(page, resetConflict = true) {
    requestedPage = page;
    const current = ++generation;
    const cursor = cursors[page - 1] || '';
    update({
      loading: true,
      error: ''
    });
    try {
      const data = await fetchPage({
        ...filters,
        cursor,
        limit: 36
      });
      if (current !== generation) return;
      cursors[page] = data.nextCursor || '';
      update({
        items: (data.items || []).map(normalizeImage),
        page,
        nextCursor: data.nextCursor || '',
        total: data.total || 0,
        source: data.source || null,
        loading: false
      });
    } catch (error) {
      if (current !== generation) return;
      if (error.statusCode === 409 && resetConflict) {
        cursors = [''];
        return loadPage(1, false);
      }
      update({
        loading: false,
        error: error.message || '加载失败，请重试'
      });
    }
  }
  return {
    state,
    load(input) {
      filters = {
        ...input
      };
      cursors = [''];
      return loadPage(1);
    },
    next() {
      if (!state.loading && state.nextCursor) return loadPage(state.page + 1);
    },
    previous() {
      if (!state.loading && state.page > 1) return loadPage(state.page - 1);
    },
    retry() {
      return loadPage(requestedPage);
    },
    cancel() {
      generation++;
      state.loading = false;
    }
  };
}
let shared;

function getMemeClient() {
  if (!shared) shared = createMemeClient();
  return shared;
}
module.exports = {
  createMemeClient,
  createPager,
  getMemeClient,
  normalizeImage,
  mediaUrl,
  query
};