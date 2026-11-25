const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function setup() {
  let definition, token = 'account-a', response = { notes: [{ id: 'n1', bookId: 'life', title: '原笔记', pinned: false }] };
  let defer, fail;
  const format = require('../packages/notebook/utils/notebook-format');
  const api = {
    listNotebookBooks: async () => [{ id: 'life', name: '生活', noteCount: response.notes.length, color: '#2d5bff' }],
    listNotebookNotes: async () => { if (defer) await defer; if (fail) throw fail; return response; },
    getNotebookSecurity: async () => ({}),
    notebookErrorMessage: e => e.message,
    isNotebookUnauthorized: e => e.statusCode === 401,
  };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../packages/notebook/index/index.js'), 'utf8'), {
    require: id => id === '../utils/notebook-api' ? api : id === '../utils/notebook-format' ? format : { getAccessToken: () => token, getStoredUser: () => null, clearSession() {} },
    Page: value => { definition = value; }, wx: { showShareMenu() {}, stopPullDownRefresh() {} },
  });
  const patches = [];
  const page = { ...definition, data: { ...definition.data, isLoggedIn: true }, setData(patch) { patches.push(patch); Object.assign(this.data, patch); } };
  page.onLoad();
  return { page, patches, response: value => { response = value; }, token: value => { token = value; }, fail: value => { fail = value; }, defer() { let resolve; defer = new Promise(done => { resolve = done; }); return resolve; } };
}

test('first load shows loading but return keeps current rows while refreshing', async () => {
  const s=setup(); await s.page.loadNotes();
  assert.equal(s.patches[0].loading, true);
  s.page.onHide(); s.page._active=true;
  const rows=s.page.data.recentNotes, resolve=s.defer();
  s.patches.length=0;
  const pending=s.page.loadNotes();
  assert.equal(s.page.data.loading, false);
  assert.equal(s.page.data.recentNotes, rows);
  resolve(); await pending;
  assert.ok(s.patches.every(p=>p.loading!==true));
});

test('unchanged background response never replaces list arrays', async () => {
  const s=setup(); await s.page.loadNotes(); s.patches.length=0;
  await s.page.loadNotes();
  assert.ok(s.patches.every(p=>!Object.hasOwn(p,'recentNotes') && !Object.hasOwn(p,'pinnedNotes')));
});

test('background refresh applies edits, pin and deletion without full loading', async () => {
  const s=setup(); await s.page.loadNotes();
  s.response({notes:[{id:'n1',bookId:'life',title:'修改后',pinned:true}]});
  await s.page.loadNotes(); assert.equal(s.page.data.pinnedNotes[0].displayTitle,'修改后'); assert.equal(s.page.data.recentNotes.length,0);
  s.response({notes:[]}); await s.page.loadNotes();
  assert.equal(s.page.data.pinnedNotes.length,0); assert.equal(s.page.data.hasNotes,false);
  assert.equal(s.patches.filter(p=>p.loading===true).length,1);
});

test('empty loaded list also refreshes silently, transient failure keeps content', async () => {
  const s=setup(); s.response({notes:[]}); await s.page.loadNotes(); s.patches.length=0;
  s.fail(new Error('网络不可用')); await s.page.loadNotes();
  assert.equal(s.page.data.error,''); assert.equal(s.page.data.loading,false);
  assert.ok(s.patches.every(p=>p.loading!==true));
});

test('initial failure remains visible and stale hidden responses are ignored', async () => {
  const s=setup(); s.fail(new Error('网络不可用')); await s.page.loadNotes(); assert.equal(s.page.data.error,'网络不可用');
  s.fail(null); const resolve=s.defer(); const pending=s.page.loadNotes(); s.page.onHide(); resolve(); await pending;
  assert.equal(s.page.data.recentNotes.length,0);
});

test('account change clears previous account rows before first fetch', async () => {
  const s=setup(); s.page.onShow(); await new Promise(resolve=>setImmediate(resolve));
  assert.equal(s.page.data.recentNotes.length,1);
  s.page.onHide(); s.token('account-b'); const resolve=s.defer();
  s.page.onShow(); assert.equal(s.page.data.recentNotes.length,0); assert.equal(s.page.data.loading,true);
  resolve(); await new Promise(done=>setImmediate(done));
});

test('return through onShow keeps the selected notebook and unchanged rows', async () => {
  const s=setup(); await s.page.onShow();
  s.page.changeFilter({currentTarget:{dataset:{id:'life'}}});
  const rows=s.page.data.recentNotes;
  s.page.onHide(); const resolve=s.defer(); s.patches.length=0;
  const pending=s.page.onShow();
  assert.equal(s.page.data.activeBookId,'life');
  assert.equal(s.page.data.recentNotes,rows);
  assert.equal(s.page.data.loading,false);
  resolve(); await pending;
  assert.equal(s.page.data.recentNotes,rows);
  assert.ok(s.patches.every(p=>p.loading!==true));
});

test('background network failure retains existing notes; unauthorized clears them', async () => {
  const s=setup(); await s.page.loadNotes();
  const rows=s.page.data.recentNotes;
  s.fail(new Error('网络不可用')); await s.page.loadNotes();
  assert.equal(s.page.data.recentNotes,rows); assert.equal(s.page.data.error,'');
  s.fail(Object.assign(new Error('登录失效'),{statusCode:401})); await s.page.loadNotes();
  assert.equal(s.page.data.isLoggedIn,false); assert.equal(s.page.data.recentNotes.length,0);
});
