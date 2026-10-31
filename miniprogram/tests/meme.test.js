const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function api() {
  const p = path.resolve(__dirname, '../utils/meme.js');
  return fs.existsSync(p) ? require(p) : {};
}

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

function loadPage(file, client, token = '') {
  let definition;
  const platform = {
    showShareMenu() {},
    navigateTo() {},
    pageScrollTo() {},
    showToast() {},
    previewImage() {}
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