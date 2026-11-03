const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function api() {
  const p = path.resolve(__dirname, '../utils/meme.js');
  return fs.existsSync(p) ? require(p) : {};
}

test('media from API responses uses the configured HTTPS gateway even with an internal origin', () => {
  const id = '000b8ab7c92d640065d7285cd68055baa3aa3635aee189020988c77d9e38c0c4';
  const normalized = api().normalizeImage({
    id,
    url: 'http://39.107.136.182/api/v1/meme-media/' + id + '/original',
    thumbnailUrl: 'http://39.107.136.182/api/v1/meme-media/' + id + '/thumbnail'
  });
  assert.equal(normalized.url, 'https://www.xwhub.cn/api/v1/meme-media/' + id + '/original');
  assert.equal(normalized.thumbnailUrl, 'https://www.xwhub.cn/api/v1/meme-media/' + id + '/thumbnail');
  assert.equal(api().mediaUrl('/api/v1/meme-media/' + id + '/original'), normalized.url);
  assert.equal(api().mediaUrl(normalized.url), normalized.url);
  assert.equal(api().mediaUrl('https://untrusted.example/other/image.jpg'), '');
  assert.equal(api().mediaUrl('file:///api/v1/meme-media/' + id + '/original'), '');
});

test('online media behind an internal HTTP origin uses the HTTPS gateway and rejects malformed IDs', () => {
  const id = 'online-000b8ab7c92d640065d7285cd68055baa3aa3635aee189020988c77d9e38c0c4';
  const internal = 'http://39.107.136.182/api/v1/meme-media/';
  const gateway = 'https://www.xwhub.cn/api/v1/meme-media/';
  const normalized = api().normalizeImage({
    id,
    url: internal + id + '/original',
    thumbnailUrl: internal + id + '/thumbnail'
  });
  assert.equal(normalized.url, gateway + id + '/original');
  assert.equal(normalized.thumbnailUrl, gateway + id + '/thumbnail');
  assert.equal(api().mediaUrl(normalized.url), gateway + id + '/original');
  for (const malicious of [
    'online-' + 'a'.repeat(63),
    'online-' + 'a'.repeat(65),
    'online-' + 'g'.repeat(64),
    'online-online-' + 'a'.repeat(64),
    id + '/..',
    id + '%2f..'
  ]) {
    assert.equal(api().mediaUrl(internal + malicious + '/original'), '', malicious);
  }
  assert.equal(api().mediaUrl(internal + id + '/original?url=https://evil.example/image.jpg'), '');
  assert.equal(api().mediaUrl('https://evil.example/images/' + id + '/thumbnail'), '');
});

function env() {
  const values = new Map();
  let token = '';
  let userId = 'A';
  const calls = [];
  return {
    values,
    calls,
    user(v) {
      userId = v;
    },
    token(v) {
      token = v;
    },
    options: {
      storage: {
        get: k => values.get(k),
        set: (k, v) => values.set(k, v)
      },
      getToken: () => token,
      getUser: () => userId ? {
        id: userId
      } : null,
      request: async input => {
        calls.push(input);
        return {
          favorite: input.method === 'PUT'
        };
      }
    }
  };
}
const image = id => ({
  id,
  title: id,
  label: id,
  url: '/api/v1/meme-media/' + id + '/original',
  thumbnailUrl: '/api/v1/meme-media/' + id + '/thumbnail',
  categories: [],
  animated: false,
  bytes: 100,
  width: 100,
  height: 100,
  format: 'png'
});
test('guest favorites deduplicate and survive restart; recent views are ordered and bounded', () => {
  assert.equal(typeof api().createMemeClient, 'function');
  const e = env();
  const c = api().createMemeClient(e.options);
  c.setLocalFavorite(image('a'), true);
  c.setLocalFavorite(image('a'), true);
  c.setLocalFavorite(image('b'), true);
  assert.deepEqual(api().createMemeClient(e.options).localFavorites().map(x => x.id), ['b', 'a']);
  for (let i = 0; i < 100; i++) c.remember(image(String(i)));
  c.remember(image('90'));
  assert.equal(c.recent()[0].id, '90');
  assert.equal(c.recent().length, 60);
});
test('login merge keeps failures and concurrent unfavorites are reconciled instead of resurrected', async () => {
  assert.equal(typeof api().createMemeClient, 'function');
  const e = env();
  let finish;
  e.options.request = input => {
    e.calls.push(input);
    if (input.path.includes('/bad/')) return Promise.reject(new Error('offline'));
    if (input.method === 'DELETE') return Promise.resolve({
      favorite: false
    });
    return new Promise(r => {
      finish = r;
    });
  };
  const c = api().createMemeClient(e.options);
  c.setLocalFavorite(image('bad'), true);
  c.setLocalFavorite(image('a'), true);
  e.token('jwt');
  const pending = c.mergeFavorites();
  await Promise.resolve();
  c.setLocalFavorite(image('a'), false);
  finish({
    favorite: true
  });
  const result = await pending;
  assert.equal(result.failed, 1);
  assert.deepEqual(c.localFavorites().map(x => x.id), ['bad']);
  assert.ok(e.calls.some(x => x.method === 'DELETE' && x.path === '/memes/a/favorite'));
});
test('old searches never overwrite new results, and page navigation replaces nodes with 36-item requests', async () => {
  assert.equal(typeof api().createPager, 'function');
  const queue = [];
  const pager = api().createPager(input => new Promise(resolve => queue.push({
    input,
    resolve
  })));
  const old = pager.load({
    q: 'cat',
    category: 'pets',
    animated: 'true'
  });
  const fresh = pager.load({
    q: 'dog'
  });
  queue[1].resolve({
    items: [image('dog')],
    nextCursor: 'next',
    total: 50
  });
  await fresh;
  queue[0].resolve({
    items: [image('cat')],
    nextCursor: '',
    total: 1
  });
  await old;
  assert.equal(pager.state.items[0].id, 'dog');
  const next = pager.next();
  assert.equal(queue[2].input.limit, 36);
  assert.equal(queue[2].input.cursor, 'next');
  queue[2].resolve({
    items: [image('page2')],
    nextCursor: '',
    total: 50
  });
  await next;
  assert.deepEqual(pager.state.items.map(x => x.id), ['page2']);
  assert.equal(pager.state.page, 2);
  const back = pager.previous();
  queue[3].resolve({
    items: [image('dog')],
    nextCursor: 'next',
    total: 50
  });
  await back;
  assert.equal(pager.state.page, 1);
});
test('snapshot conflicts reload page one and failed requests retain current page for retry', async () => {
  assert.equal(typeof api().createPager, 'function');
  let count = 0;
  const pager = api().createPager(async input => {
    count++;
    if (count === 1) return {
      items: [image('a')],
      nextCursor: 'old',
      total: 2
    };
    if (count === 2) throw Object.assign(new Error('snapshot'), {
      statusCode: 409
    });
    if (count === 3) {
      assert.equal(input.cursor, '');
      return {
        items: [image('b')],
        nextCursor: 'next',
        total: 2
      };
    }
    throw new Error('offline');
  });
  await pager.load({});
  await pager.next();
  assert.equal(pager.state.page, 1);
  assert.equal(pager.state.items[0].id, 'b');
  await pager.next();
  assert.equal(pager.state.items[0].id, 'b');
  assert.match(pager.state.error, /offline/);
});
test('save only records success, cancel sharing never emits send/save events, download errors reject', async () => {
  assert.equal(typeof api().createMemeClient, 'function');
  const e = env();
  const c = api().createMemeClient(e.options);
  let saved;
  const platform = {
    downloadFile: o => o.success({
      statusCode: 200,
      tempFilePath: '/tmp/a.png'
    }),
    saveImageToPhotosAlbum: o => {
      saved = o;
    },
    showShareImageMenu: o => o.fail({
      errMsg: 'cancel'
    })
  };
  const pending = c.media(image('a'), 'save', platform);
  await Promise.resolve();
  saved.fail({
    errMsg: 'auth deny'
  });
  await assert.rejects(pending, /auth deny/);
  assert.equal(e.calls.length, 0);
  const success = c.media(image('a'), 'save', platform);
  await Promise.resolve();
  saved.success({});
  await success;
  assert.equal(e.calls[0].data.type, 'save');
  await assert.rejects(c.media(image('a'), 'share', platform), /cancel/);
  assert.equal(e.calls.length, 1);
  await assert.rejects(c.media(image('a'), 'save', {
    downloadFile: o => o.success({
      statusCode: 404
    })
  }), /下载/);
});
test('home entry navigates to meme subpackage while score routes stay functional', () => {
  let definition;
  const routes = [];
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../pages/index/index.js'), 'utf8'), {
    require: () => ({}),
    Page: p => {
      definition = p;
    },
    wx: {
      navigateTo: o => routes.push(o.url)
    }
  });
  assert.equal(typeof definition.openMemes, 'function');
  definition.openMemes();
  definition.openMahjong();
  definition.openPoker();
  definition.openGeneral();
  assert.deepEqual(routes, ['/packages/meme/library/index', '/pages/score/mahjong/index', '/pages/score/poker/index', '/pages/score/general/index']);
});

function loadPage(file, client, token = '', platformOverrides = {}) {
  let definition;
  const platform = {
    showShareMenu() {},
    navigateTo() {},
    pageScrollTo() {},
    showToast() {},
    previewImage() {},
    ...platformOverrides
  };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../packages/meme/' + file + '/index.js'), 'utf8'), {
    require: name => name.includes('auth') ? {
      getAccessToken: () => typeof token === 'function' ? token() : token
    } : {
      ...api(),
      getMemeClient: () => client
    },
    Page: p => {
      definition = p;
    },
    wx: platform,
    console
  });
  return {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) {
      Object.assign(this.data, patch);
    }
  };
}
test('library routes category selection into combined query and hides rank numbers for curated responses', async () => {
  const p = path.resolve(__dirname, '../packages/meme/library/index.js');
  assert.equal(fs.existsSync(p), true);
  const queries = [];
  const client = {
    searches: () => [],
    localFavorites: () => [],
    recent: () => [],
    categories: async () => ({
      items: [],
      total: 115
    }),
    list: async q => {
      queries.push(q);
      return {
        items: [],
        total: 0
      };
    },
    rankings: async () => ({
      items: [{
        ...image('a'),
        rank: 1
      }],
      mode: 'curated',
      notice: '积累中'
    }),
    rememberSearch() {}
  };
  const page = loadPage('library', client);
  await page.onLoad({});
  page.data.q = '猫';
  page.data.type = 'true';
  await page.chooseCategory({
    currentTarget: {
      dataset: {
        id: 'cats',
        title: '猫咪'
      }
    }
  });
  assert.equal(queries.at(-1).q, '猫');
  assert.equal(queries.at(-1).category, 'cats');
  assert.equal(queries.at(-1).animated, 'true');
  await page.changeTab({
    currentTarget: {
      dataset: {
        tab: 'ranking'
      }
    }
  });
  assert.equal(page.data.rankMode, 'curated');
  assert.equal(page.data.items[0].rank, undefined);
});
test('detail page shares the canonical image route and records view only after loading an image', async () => {
  const p = path.resolve(__dirname, '../packages/meme/detail/index.js');
  assert.equal(fs.existsSync(p), true);
  const events = [];
  const client = {
    detail: async () => ({
      image: image('a'),
      related: []
    }),
    pendingFavorite: () => null,
    remember() {},
    event: async (id, type) => events.push([id, type])
  };
  const page = loadPage('detail', client);
  await page.onLoad({
    id: 'a'
  });
  assert.deepEqual(events, [
    ['a', 'view']
  ]);
  assert.equal(page.onShareAppMessage().path, '/packages/meme/detail/index?id=a');
});
test('failed next page retries its cursor rather than reloading the previous page', async () => {
  let calls = 0;
  const seen = [];
  const pager = api().createPager(async input => {
    seen.push(input.cursor);
    calls++;
    if (calls === 1) return {
      items: [image('a')],
      nextCursor: 'second',
      total: 2
    };
    if (calls === 2) throw new Error('offline');
    return {
      items: [image('b')],
      nextCursor: '',
      total: 2
    };
  });
  await pager.load({});
  await pager.next();
  await pager.retry();
  assert.deepEqual(seen, ['', 'second', 'second']);
  assert.equal(pager.state.items[0].id, 'b');
});
test('backgrounding during download never opens a share menu', async () => {
  const e = env();
  const c = api().createMemeClient(e.options);
  let finish;
  let opened = false;
  let active = true;
  const platform = {
    downloadFile: o => {
      finish = o.success;
    },
    showShareImageMenu: o => {
      opened = true;
      o.success({});
    }
  };
  const p = c.media(image('a'), 'share', platform, () => {}, () => active);
  active = false;
  finish({
    statusCode: 200,
    tempFilePath: '/tmp/a'
  });
  await assert.rejects(p, /已离开/);
  assert.equal(opened, false);
});
test('two concurrent merges perform only one request and account switch keeps unsynced guest data', async () => {
  const e = env();
  let finish;
  e.options.request = () => new Promise(resolve => {
    finish = resolve;
  });
  const c = api().createMemeClient(e.options);
  c.setLocalFavorite(image('a'), true);
  e.token('one');
  const first = c.mergeFavorites();
  assert.equal(c.mergeFavorites(), first);
  e.user('B');
  e.token('two');
  finish({
    favorite: true
  });
  await first;
  assert.equal(c.localFavorites().length, 0);
  e.user('A');
  e.token('three');
  assert.equal(c.localFavorites()[0].id, 'a');
});
test('cloud favorites show pending local entries and never send unsupported search filters', async () => {
  const input = [];
  const client = {
    searches: () => [],
    localFavorites: () => [image('pending')],
    recent: () => [],
    favorites: async q => {
      input.push(q);
      return {
        items: [image('cloud')],
        total: 1,
        nextCursor: ''
      };
    }
  };
  const page = loadPage('library', client, 'jwt');
  await page.onLoad({
    tab: 'favorites'
  });
  assert.equal(page.data.pendingItems[0].id, 'pending');
  assert.equal(input[0].q, undefined);
  assert.equal(input[0].limit, 36);
});
test('returning to detail after hiding during initial fetch restarts loading instead of stranding it', async () => {
  let finish;
  let requests = 0;
  const client = {
    detail: () => {
      requests++;
      return new Promise(r => {
        finish = r;
      });
    },
    pendingFavorite: () => null,
    remember() {},
    event: async () => {}
  };
  const page = loadPage('detail', client);
  const first = page.onLoad({
    id: 'a'
  });
  page.onHide();
  finish({
    image: image('a'),
    related: []
  });
  await first;
  page.onShow();
  assert.equal(requests, 2);
  finish({
    image: image('a'),
    related: []
  });
  await Promise.resolve();
});
test('favorite controls unlock when a response arrives while detail is hidden', async () => {
  let finish;
  const client = {
    detail: async () => ({
      image: image('a'),
      related: []
    }),
    pendingFavorite: () => null,
    remember() {},
    event: async () => {},
    favorite: () => new Promise(r => {
      finish = r;
    })
  };
  const page = loadPage('detail', client);
  await page.onLoad({
    id: 'a'
  });
  const pending = page.favorite();
  page.onHide();
  finish();
  await pending;
  page.onShow();
  assert.equal(page.data.favoriteBusy, false);
});
test('library resumes interrupted page loads after returning without resetting the search', async () => {
  let finish;
  const inputs = [];
  const client = {
    searches: () => [],
    list: q => {
      inputs.push(q);
      return new Promise(r => {
        finish = r;
      });
    }
  };
  const page = loadPage('library', client);
  const first = page.onLoad({
    q: '猫'
  });
  page.onHide();
  finish({
    items: [image('old')],
    total: 1,
    nextCursor: ''
  });
  await first;
  page.onShow();
  assert.equal(inputs.length, 2);
  assert.equal(inputs[1].q, '猫');
  finish({
    items: [image('new')],
    total: 1,
    nextCursor: ''
  });
  await Promise.resolve();
  assert.equal(page.data.items[0].id, 'new');
});
test('failed account PUT and DELETE never replay for another account or become guest data', async () => {
  const e = env();
  const c = api().createMemeClient(e.options);
  e.token('A1');
  e.user('A');
  e.options.request = undefined;
  // A is offline: both positive and negative intentions must keep A ownership.
  const offline = api().createMemeClient({
    ...e.options,
    request: async () => {
      throw new Error('offline');
    }
  });
  await assert.rejects(offline.favorite(image('add-A'), true), /同步失败/);
  await assert.rejects(offline.favorite(image('remove-A'), false), /同步失败/);
  e.user('B');
  e.token('B1');
  const sent = [];
  const restarted = api().createMemeClient({
    ...e.options,
    request: async input => {
      sent.push(input);
      return {
        favorite: true
      };
    }
  });
  await restarted.mergeFavorites();
  assert.equal(sent.length, 0);
  assert.equal(restarted.localFavorites().length, 0);
  e.token('');
  e.user(null);
  assert.equal(restarted.localFavorites().length, 0);
  assert.equal(restarted.pendingFavorite('remove-A'), undefined);
  e.user('A');
  e.token('A2');
  await restarted.mergeFavorites();
  assert.deepEqual(sent.map(x => [x.path, x.method, x.bearerToken]).sort(), [
    ['/memes/add-A/favorite', 'PUT', 'A2'],
    ['/memes/remove-A/favorite', 'DELETE', 'A2']
  ]);
});
test('failed guest merge binds records to first account, and recent browsing is isolated on account changes', async () => {
  const e = env();
  const sent = [];
  let offline = true;
  const c = api().createMemeClient({
    ...e.options,
    request: async input => {
      sent.push(input);
      if (offline) throw new Error('offline');
      return {
        favorite: true
      };
    }
  });
  c.setLocalFavorite(image('guest'), true);
  c.remember(image('guest-history'));
  e.user('A');
  e.token('A1');
  await c.mergeFavorites();
  c.remember(image('A-history'));
  assert.deepEqual(c.recent().map(x => x.id), ['A-history']);
  e.user('B');
  e.token('B1');
  offline = false;
  await c.mergeFavorites();
  assert.equal(sent.length, 1);
  assert.equal(c.localFavorites().length, 0);
  assert.equal(c.recent().length, 0);
  e.user('A');
  e.token('A2');
  assert.equal(c.localFavorites()[0].id, 'guest');
  assert.equal(c.recent()[0].id, 'A-history');
  await c.mergeFavorites();
  assert.equal(sent[1].bearerToken, 'A2');
});
test('ownerless legacy mutations are retained but never automatically imported into an account', async () => {
  const e = env();
  e.values.set('funbox.meme.pending', [{
    image: image('unknown-owner'),
    desired: false,
    revision: 1
  }]);
  e.token('B');
  e.user('B');
  const c = api().createMemeClient(e.options);
  await c.mergeFavorites();
  assert.equal(e.calls.length, 0);
  assert.equal(e.values.get('funbox.meme.pending').length, 1);
});
test('unavailable favorites are normalized without media and removal waits for DELETE before refreshing', async () => {
  const missing = {
    ...image('hidden'),
    unavailable: true,
    url: '',
    thumbnailUrl: ''
  };
  assert.equal(api().normalizeImage(missing).url, '');
  let finish;
  let refreshes = 0;
  const client = {
    searches: () => [],
    localFavorites: () => [],
    favorites: async () => {
      refreshes++;
      return {
        items: [missing],
        total: 1
      };
    },
    favorite: () => new Promise(r => {
      finish = r;
    })
  };
  const page = loadPage('library', client, 'A');
  await page.onLoad({
    tab: 'favorites'
  });
  const remove = page.removeUnavailable({
    currentTarget: {
      dataset: {
        id: 'hidden'
      }
    }
  });
  assert.equal(refreshes, 1);
  finish(false);
  await remove;
  assert.equal(refreshes, 2);
});
test('unavailable saved entries never download and DELETE targets their canonical ID', async () => {
  const e = env();
  e.token('A1');
  const c = api().createMemeClient(e.options);
  const unavailable = {
    ...image('hidden'),
    unavailable: true,
    url: ''
  };
  let downloaded = false;
  await assert.rejects(c.media(unavailable, 'save', {
    downloadFile() {
      downloaded = true;
    }
  }), /已下架/);
  assert.equal(downloaded, false);
  await c.favorite(unavailable, false);
  assert.equal(e.calls[0].path, '/memes/hidden/favorite');
  assert.equal(e.calls[0].method, 'DELETE');
});
test('switching accounts refreshes detail favorite status rather than displaying prior account state', async () => {
  let token = 'A';
  let calls = 0;
  const client = {
    detail: async () => {
      calls++;
      return {
        image: {
          ...image('a'),
          favorite: token === 'A'
        },
        related: []
      };
    },
    pendingFavorite: () => null,
    remember() {},
    event: async () => {}
  };
  const page = loadPage('detail', client, () => token);
  await page.onLoad({
    id: 'a'
  });
  assert.equal(page.data.favorite, true);
  page.onHide();
  token = 'B';
  page.onShow();
  await Promise.resolve();
  assert.equal(calls, 2);
  assert.equal(page.data.favorite, false);
});
test('same-account token rotation serializes a newer DELETE behind the in-flight old-token PUT', async () => {
  const e = env();
  let cloud = false;
  let finishOld;
  const calls = [];
  const client = api().createMemeClient({
    ...e.options,
    request(input) {
      calls.push([input.bearerToken, input.method]);
      if (input.bearerToken === 'old' && input.method === 'PUT') {
        return new Promise(resolve => {
          finishOld = () => {
            cloud = true;
            resolve({
              favorite: true
            });
          };
        });
      }
      cloud = input.method === 'PUT';
      return Promise.resolve({
        favorite: cloud
      });
    }
  });
  client.setLocalFavorite(image('x'), true);
  e.token('old');
  const first = client.mergeFavorites();
  e.token('new');
  const removed = client.favorite(image('x'), false);
  await Promise.resolve();
  const earlyCalls = calls.map(x => [...x]);
  finishOld();
  await Promise.all([first, removed]);
  assert.deepEqual(earlyCalls, [
    ['old', 'PUT']
  ]);
  assert.deepEqual(calls, [
    ['old', 'PUT'],
    ['new', 'DELETE']
  ]);
  assert.equal(cloud, false);
  assert.equal(client.pendingFavorite('x'), undefined);
});
test('a favorite for another image added during an active merge is drained before both callers finish', async () => {
  const e = env();
  const cloud = new Set();
  let finishX;
  const c = api().createMemeClient({
    ...e.options,
    request(input) {
      const id = input.path.split('/')[2];
      if (id === 'x') return new Promise(resolve => {
        finishX = () => {
          cloud.add(id);
          resolve({
            favorite: true
          });
        };
      });
      cloud.add(id);
      return Promise.resolve({
        favorite: true
      });
    }
  });
  e.token('A');
  const x = c.favorite(image('x'), true);
  const y = c.favorite(image('y'), true);
  finishX();
  await Promise.all([x, y]);
  assert.deepEqual([...cloud].sort(), ['x', 'y']);
  assert.equal(c.pendingFavorite('y'), undefined);
});

test('online client emits explicit multi-source search contract without changing gateway media handling', async () => {
  const calls = [];
  const client = api().createMemeClient({ request: async input => { calls.push(input); return {items: []}; } });
  assert.equal(typeof client.onlineSources, 'function');
  await client.onlineSources();
  await client.onlineSearch({q: '猫', sources: ['doutula', 'pdan'], page: 2});
  assert.equal(calls[0].path, '/memes/online/sources');
  assert.equal(calls[1].path, '/memes/online/search?q=%E7%8C%AB&sources=doutula%2Cpdan&page=2&limit=36');
});

function onlineClient(overrides = {}) {
  return {
    searches: () => [], rememberSearch() {}, localFavorites: () => [],
    list: async () => ({items: [], total: 0}),
    onlineSources: async () => ({items: [
      {id: 'doutula', title: '斗图啦', enabled: true},
      {id: 'pdan', title: '皮蛋', enabled: true},
      {id: 'douyin', title: '抖音', enabled: false, reason: '未配置 Cookie'}
    ], attribution: {name: 'meme', url: 'https://github.com/o98k-ok/meme'}}),
    onlineSearch: async () => ({items: [], page: 1, hasMore: false, sources: [], cached: false}),
    ...overrides
  };
}
const eventMode = mode => ({currentTarget: {dataset: {mode}}});

test('online mode does not query blank words or disabled sources and submits only on search', async () => {
  const calls = [];
  const page = loadPage('library', onlineClient({onlineSearch: async input => {
    calls.push(input); return {items: [{...image('abc'), sourceName: '斗图啦'}], page: input.page, hasMore: input.page === 1,
      sources: [{id: 'doutula', title: '斗图啦', status: 'ok'}, {id: 'pdan', title: '皮蛋', status: 'error', message: '暂不可用'}], cached: false};
  }}));
  await page.onLoad({});
  assert.equal(typeof page.changeMode, 'function');
  await page.changeMode(eventMode('online'));
  await page.search();
  assert.equal(calls.length, 0);
  page.toggleOnlineSource({currentTarget: {dataset: {id: 'douyin'}}});
  assert.deepEqual(Array.from(page.data.onlineSelected), ['doutula', 'pdan']);
  page.onInput({detail: {value: ' 猫 '}});
  assert.equal(calls.length, 0);
  await page.search();
  assert.equal(calls[0].q, '猫');
  assert.equal(calls[0].page, 1);
  assert.equal(calls[0].limit, 36);
  assert.equal(page.data.items[0].sourceName, '斗图啦');
  assert.equal(page.data.onlineStatuses[1].status, 'error');
  assert.equal(page.data.onlineHasMore, true);
  page.onInput({detail: {value: '未提交'}});
  await page.next();
  assert.equal(calls[1].q, '猫');
  assert.equal(calls[1].page, 2);
  assert.equal(page.data.onlineHasMore, false);
  await page.next();
  assert.equal(calls.length, 2);
  assert.equal(page.data.items.length, 1); // repeated provider ID is deduplicated across appended pages
  assert.equal(page.data.page, 2);
  await page.changeMode(eventMode('library'));
  assert.equal(page.data.tab, 'all');
  assert.equal(page.data.q, '');
});

test('online failures use safe retry and stale requests cannot overwrite gallery after switching', async () => {
  let resolve;
  let fail = true;
  const page = loadPage('library', onlineClient({onlineSearch: async () => {
    if (fail) throw new Error('Cookie=secret upstream body');
    return new Promise(r => {resolve = r;});
  }}));
  await page.onLoad({});
  await page.changeMode(eventMode('online'));
  page.onInput({detail: {value: '猫'}});
  await page.search();
  assert.ok(page.data.error);
  assert.equal(page.data.error.includes('secret'), false);
  fail = false;
  const pending = page.retry();
  await page.changeMode(eventMode('library'));
  resolve({items: [image('stale')], page: 1, hasMore: true, sources: [], cached: false});
  await pending;
  assert.equal(page.data.items.length, 0);
  assert.equal(page.data.mode, 'library');
});


test('online detail copies actual provider page and keeps original library attribution fallback', () => {
  const urls = [];
  const page = loadPage('detail', {}, '', {setClipboardData: o => urls.push(o.data)});
  page.data.image = {...image('a'), sourceId: 'doutula', sourceName: '斗图啦', sourcePageUrl: 'https://www.doutula.com/photo/123'};
  page.copySource();
  assert.equal(urls[0], 'https://www.doutula.com/photo/123');
  page.data.image.sourcePageUrl = '';
  page.copySource();
  assert.equal(urls.length, 1);
  page.data.image = image('library');
  page.copySource();
  assert.equal(urls[1], 'https://zhaoolee.com/ChineseBQB/');
});

test('unavailable source list retries independently without running a keyword search', async () => {
  let failed = true;
  let searches = 0;
  const client = onlineClient({onlineSources: async () => {
    if (failed) throw new Error('private upstream detail');
    return {items: [{id: 'doutula', title: '斗图啦', enabled: true}], attribution: null};
  }, onlineSearch: async () => {searches++;}});
  const page = loadPage('library', client);
  await page.onLoad({});
  await page.changeMode(eventMode('online'));
  assert.ok(page.data.sourcesError);
  assert.equal(page.data.sourcesError.includes('private'), false);
  failed = false;
  await page.loadOnlineSources();
  assert.equal(page.data.sourcesError, '');
  assert.deepEqual(Array.from(page.data.onlineSelected), ['doutula']);
  assert.equal(searches, 0);
});

test('shared online entry keeps the keyword draft and waits for explicit submit', async () => {
  let galleryLoads = 0;
  let onlineLoads = 0;
  const page = loadPage('library', onlineClient({
    list: async () => {galleryLoads++; return {items: [], total: 0};},
    onlineSearch: async () => {onlineLoads++; return {items: [], page: 1, hasMore: false, sources: [], cached: false};}
  }));
  await page.onLoad({mode: 'online', q: '猫'});
  assert.equal(page.data.mode, 'online');
  assert.equal(page.data.q, '猫');
  assert.equal(galleryLoads, 0);
  assert.equal(onlineLoads, 0);
  assert.match(page.onShareAppMessage().path, /mode=online/);
});

test('submitting while sources load does not strand the source selector', async () => {
  let complete;
  const page = loadPage('library', onlineClient({onlineSources: () => new Promise(r => {complete = r;})}));
  await page.onLoad({});
  const pending = page.changeMode(eventMode('online'));
  page.onInput({detail: {value: '猫'}});
  await page.search();
  complete({items: [{id: 'doutula', title: '斗图啦', enabled: true}], attribution: null});
  await pending;
  assert.equal(page.data.sourcesLoading, false);
  assert.deepEqual(Array.from(page.data.onlineSelected), ['doutula']);
});

test('continuous pager appends unique IDs, blocks duplicate loads and retains failed cursor', async () => {
  const queue = [];
  const pager = api().createPager(input => new Promise((resolve, reject) => queue.push({input, resolve, reject})), () => {}, {append: true});
  const first = pager.load({q: '猫'});
  queue[0].resolve({items: [image('a'), image('a')], nextCursor: 'two'});
  await first;
  assert.deepEqual(pager.state.items.map(x => x.id), ['a']);
  const next = pager.next();
  await pager.next();
  assert.equal(queue.length, 2);
  queue[1].reject(new Error('offline'));
  await next;
  assert.deepEqual(pager.state.items.map(x => x.id), ['a']);
  assert.equal(pager.state.nextCursor, 'two');
  const retry = pager.retry();
  assert.equal(queue[2].input.cursor, 'two');
  queue[2].resolve({items: [image('a'), image('b')], nextCursor: ''});
  await retry;
  assert.deepEqual(pager.state.items.map(x => x.id), ['a', 'b']);
  const old = pager.load({q: 'old'});
  assert.equal(pager.state.items.length, 0);
  const fresh = pager.load({q: 'new'});
  queue[4].resolve({items: [image('new')]}); await fresh;
  queue[3].resolve({items: [image('old')]}); await old;
  assert.deepEqual(pager.state.items.map(x => x.id), ['new']);
});

test('empty library hands its query to online sources and searches in one action', async () => {
  const calls = [];
  const page = loadPage('library', onlineClient({onlineSearch: async input => {calls.push(input); return {items: [], page: 1};}}));
  await page.onLoad({q: '猫猫'});
  await page.searchOnline();
  assert.equal(page.data.q, '猫猫');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].q, '猫猫');
  assert.ok(calls[0].sources.length);
});

test('list favorites retain pending sync intentions, restore persistence failure and ignore account switches', async () => {
  let token = 'A', pending, finish;
  const client = onlineClient({pendingFavorite: () => pending, favorite: async (img, desired) => {pending = {desired}; throw new Error('offline');}});
  const page = loadPage('library', client, () => token);
  await page.onLoad({});
  page.data.items = [image('a')];
  const event = {currentTarget: {dataset: {id: 'a'}}};
  await page.toggleFavorite(event);
  assert.equal(page.data.items[0].favorite, true);
  assert.match(page.data.syncMessage, /重试/);
  client.favorite = async () => {pending = null; throw new Error('storage full');};
  await page.toggleFavorite(event);
  assert.equal(page.data.items[0].favorite, true);
  client.favorite = () => new Promise(resolve => {finish = resolve;});
  const work = page.toggleFavorite(event);
  token = 'B'; page.onShow(); finish(); await work;
  assert.equal(page.data.favoriteBusy.a, undefined);
  assert.equal(page.data.items[0].favorite, false);
});

test('list longpress previews original, favorites, shares and suppresses following navigation', async () => {
  let sheet, previews = [], shares = [], navigated = 0, favorites = [];
  const original = {...image('a'), url: '/api/v1/meme-media/a/original'};
  const client = onlineClient({pendingFavorite: () => null, detail: async () => ({image: original}), favorite: async (img, desired) => favorites.push(desired), media: async img => shares.push(img.url)});
  const page = loadPage('library', client, '', {showActionSheet: o => {sheet = o;}, previewImage: o => previews.push(o.current), navigateTo: () => navigated++});
  await page.onLoad({}); page.data.items = [{...image('a'), url: '/api/v1/meme-media/a/thumbnail'}];
  const e = {currentTarget: {dataset: {id: 'a'}}};
  await page.longPressImage(e); assert.equal(sheet.itemList.length, 3);
  await sheet.success({tapIndex: 0});
  assert.match(previews[0], /original$/);
  page.openImage(e); assert.equal(navigated, 0);
  await page.longPressImage(e); await sheet.success({tapIndex: 1}); assert.deepEqual(favorites, [true]);
  await page.longPressImage(e); await sheet.success({tapIndex: 2}); assert.match(shares[0], /original$/);
  page.data.items[0].unavailable = true;
  sheet = null; await page.longPressImage(e); assert.equal(sheet, null);
});


test('detail favorite restores visible state only when no pending intention was persisted', async () => {
  const client = {detail: async () => ({image: image('a')}), pendingFavorite: () => null,
    favorite: async () => {throw new Error('storage full');}, remember() {}, event: async () => {}};
  const page = loadPage('detail', client);
  await page.onLoad({id: 'a'});
  await page.favorite();
  assert.equal(page.data.favorite, false);
  client.pendingFavorite = () => ({desired: true});
  await page.favorite();
  assert.equal(page.data.favorite, true);
});

test('library append failures retain browse position and retry online page; new queries fence old responses', async () => {
  let fail = false, resolve;
  const calls = [], scrolls = [];
  const page = loadPage('library', onlineClient({onlineSearch: input => {
    calls.push(input);
    if (fail) return Promise.reject(new Error('offline'));
    if (input.q === 'old') return new Promise(r => {resolve = r;});
    return Promise.resolve({items: [image(input.page === 1 ? 'a' : 'b')], page: input.page, hasMore: true});
  }}), '', {pageScrollTo: o => scrolls.push(o)});
  await page.onLoad({}); await page.changeMode(eventMode('online'));
  page.data.q = 'cat'; await page.search();
  fail = true; await page.next();
  assert.equal(page.data.items[0].id, 'a'); assert.equal(page.data.page, 1);
  fail = false; await page.retry();
  assert.equal(calls.at(-1).page, 2); assert.equal(page.data.items.length, 2);
  assert.equal(scrolls.length, 0);
  page.data.q = 'old'; const old = page.search();
  page.data.q = 'fresh'; await page.search();
  resolve({items: [image('stale')], page: 1}); await old;
  assert.equal(page.data.items[0].id, 'a');
});

test('detail return keeps appended list and reconciles favorite state without fetching page one', async () => {
  let calls = 0, favorite = false;
  const client = onlineClient({list: async () => ({items: [image(++calls === 1 ? 'a' : 'b')], nextCursor: calls === 1 ? 'next' : '', total: 2}), favoriteState: () => favorite});
  const page = loadPage('library', client);
  await page.onLoad({}); await page.next(); await Promise.resolve();
  assert.equal(page.data.items.length, 2);
  page.onHide(); favorite = true; page.onShow();
  assert.equal(page.data.items.length, 2); assert.equal(calls, 2);
  assert.equal(page.data.items[0].favorite, true);
  await page.changeType({currentTarget: {dataset: {type: 'true'}}});
  assert.equal(page.data.page, 1); assert.equal(page.data.items.length, 1);
});

test('detail media controls recover after backgrounding an in-flight operation', async () => {
  let finish;
  const client = {detail: async () => ({image: image('a')}), pendingFavorite: () => null, remember() {}, event: async () => {}, media: () => new Promise(r => {finish = r;})};
  const page = loadPage('detail', client);
  await page.onLoad({id: 'a'});
  const task = page.shareImage(); page.onHide(); finish(); await task; page.onShow();
  assert.equal(page.data.busy, false);
});

test('successful favorite state survives pending cleanup and stays scoped to its account', async () => {
  const e = env(); e.token('A-token');
  const client = api().createMemeClient(e.options);
  await client.favorite(image('a'), true);
  assert.equal(client.pendingFavorite('a'), undefined);
  assert.equal(client.favoriteState('a'), true);
  e.user('B'); e.token('B-token');
  assert.equal(client.favoriteState('a'), false);
  e.user('A'); e.token('A-new-token');
  assert.equal(client.favoriteState('a'), true);
  await client.favorite(image('a'), false);
  assert.equal(client.favoriteState('a', true), false);
});

test('shared media runner confirms large originals and reports cancellation and permission failures', async () => {
  let accepted = false, calls = 0;
  const page = {data: {busy: false}, _active: true, setData(patch) {Object.assign(this.data, patch);}, client: {media: async () => {calls++; throw new Error('auth deny');}}};
  const platform = {showModal: o => o.success({confirm: accepted})};
  const large = {...image('a'), bytes: 6 * 1024 * 1024};
  await api().runImageMedia(page, large, 'share', platform);
  assert.equal(calls, 0); assert.equal(page.data.busy, false);
  accepted = true;
  await api().runImageMedia(page, large, 'share', platform);
  assert.equal(calls, 1); assert.equal(page.data.permissionDenied, true);
  page.client.media = async () => {throw new Error('cancel');};
  await api().runImageMedia(page, image('a'), 'share', platform);
  assert.match(page.data.actionError, /已取消/);
  assert.equal(page.data.permissionDenied, false);
});

test('account switch resets private appended pager before any resume, bottom reach or delayed merge', async () => {
  let token = 'A', finishA, finishB, finishMerge;
  const calls = [];
  const page = loadPage('library', onlineClient({
    favorites: input => {
      calls.push({token, cursor: input.cursor});
      if (token === 'A' && !input.cursor) return Promise.resolve({items: [image('private-A')], nextCursor: 'A-cursor', total: 2});
      if (token === 'A') return new Promise(resolve => {finishA = resolve;});
      return new Promise(resolve => {finishB = resolve;});
    },
    mergeFavorites: () => new Promise(resolve => {finishMerge = resolve;})
  }), () => token);
  await page.onLoad({tab: 'favorites'});
  const pendingA = page.next();
  assert.equal(calls[1].cursor, 'A-cursor');
  page.onHide(); token = 'B'; page.onShow();
  assert.equal(page.data.items.length, 0);
  assert.equal(page.pager.state.items.length, 0);
  assert.equal(page.data.nextCursor, '');
  assert.equal(page.data.page, 1);
  assert.equal(page._resumeRequest, false);
  assert.deepEqual(calls[2], {token: 'B', cursor: ''});
  await page.onReachBottom();
  assert.equal(calls.length, 3);
  finishB({items: [image('B')], nextCursor: 'B-cursor', total: 2});
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(Array.from(page.data.items, x => x.id), ['B']);
  finishA({items: [image('late-private-A')], nextCursor: 'A-next'}); await pendingA;
  assert.deepEqual(Array.from(page.data.items, x => x.id), ['B']);
  assert.equal(page.data.nextCursor, 'B-cursor');
  finishMerge({failed: 0}); await Promise.resolve(); await Promise.resolve();
  assert.equal(calls.length, 3); // delayed sync must not reset/re-fetch B browsing
  assert.deepEqual(Array.from(page.data.items, x => x.id), ['B']);
});

test('same-account local favorites reconcile removals and additions while keeping appended depth', async () => {
  let items = Array.from({length: 40}, (_, i) => image(String(i)));
  const page = loadPage('library', onlineClient({localFavorites: () => items}));
  await page.onLoad({tab: 'favorites'}); await page.next();
  assert.equal(page.data.items.length, 40);
  page.onHide(); items = [image('new'), ...items.slice(0, -1)]; page.onShow();
  assert.equal(page.data.items.length, 40);
  assert.equal(page.data.page, 2);
  assert.equal(page.data.items[0].id, 'new');
  assert.equal(page.data.items.some(x => x.id === '39'), false);
});

test('same-account recent browsing reads newly remembered detail when returning', async () => {
  let recent = [image('old')];
  const page = loadPage('library', onlineClient({recent: () => recent}));
  await page.onLoad({tab: 'favorites'});
  await page.changeFavoriteMode({currentTarget: {dataset: {mode: 'recent'}}});
  page.onHide(); recent = [image('new'), image('old')]; page.onShow();
  assert.deepEqual(Array.from(page.data.items, x => x.id), ['new', 'old']);
});

test('pager reset discards retained items, filters, cursor history and requested retry page', async () => {
  const calls = [];
  const pager = api().createPager(async input => {calls.push(input); return {items: [image('private')], nextCursor: 'private-cursor', total: 9};}, () => {}, {append: true});
  await pager.load({q: 'private-filter'}); await pager.next(); pager.reset();
  assert.equal(pager.state.items.length, 0); assert.equal(pager.state.nextCursor, '');
  assert.equal(pager.state.page, 1); assert.equal(pager.state.total, 0);
  await pager.next(); assert.equal(calls.length, 2);
  await pager.retry();
  assert.equal(calls[2].cursor, ''); assert.equal(calls[2].q, undefined);
  assert.equal(pager.state.page, 1);
});
