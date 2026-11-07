const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const format = require('../packages/notebook/utils/notebook-format');
function page(kind, api = {}, wx = {}) {
  let definition;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, `../packages/notebook/${kind}/index.js`), 'utf8'), {
    Page(value) { definition = value; },
    require(name) {
      if (name.includes('notebook-api')) return { notebookErrorMessage: error => error.message, isNotebookUnauthorized: () => false, listNotebookBooks: async () => [], ...api };
      if (name.includes('notebook-format')) return format;
      return { getAccessToken: () => 'token', clearSession() {} };
    }, wx: { showToast() {}, ...wx }, setTimeout, clearTimeout,
  });
  const result = { ...definition, data: { ...definition.data, isLoggedIn: true }, setData(update) { Object.assign(this.data, update); } };
  result._active = true;
  return result;
}
const event = dataset => ({ currentTarget: { dataset } });

test('search applies book, tag and favorite together only after confirming draft', async () => {
  const calls = [];
  const p = page('search', { listNotebookNotes: async input => { calls.push(input); return { notes: [{ id: 'one', title: '周末' }] }; } });
  p.data.books = [{ id: 'life', name: '生活' }];
  p.data.query = ' 周末 ';
  p.openFilters(); p.draftBook(event({ id: 'life' })); p.draftTag(event({ tag: '周末计划' })); p.draftFavorite();
  assert.equal(p.data.activeBookId, 'all'); assert.equal(calls.length, 0);
  await p.applyFilters();
  assert.equal(calls[0].q, '周末'); assert.equal(calls[0].bookId, 'life'); assert.equal(calls[0].tag, '周末计划'); assert.equal(calls[0].favorite, true);
  assert.equal(p.data.activeBookName, '生活'); assert.equal(p.data.filterCount, 3); assert.equal(p.data.filterOpen, false); assert.equal(p.data.resultCount, 1);
});

test('closing draft discards changes and reset remains draft until applied', async () => {
  const p = page('search', { listNotebookNotes: async () => ({ notes: [] }) });
  p.data.activeTag = '旅行'; p.data.favoriteOnly = true;
  p.openFilters(); p.resetDraft(); p.closeFilters();
  assert.equal(p.data.activeTag, '旅行'); assert.equal(p.data.favoriteOnly, true);
  p.openFilters(); assert.equal(p.data.draftTag, '旅行');
  p.resetDraft(); await p.applyFilters(); assert.equal(p.data.filterCount, 0); assert.equal(p.data.activeTag, '');
});

test('empty-result filter reset retains keyword and scope', async () => {
  let input;
  const p = page('search', { listNotebookNotes: async value => { input = value; return { notes: [] }; } });
  Object.assign(p.data, { query: '海边露营', activeScope: 'title', activeBookId: 'life', activeTag: '周末', favoriteOnly: true });
  await p.clearFilters();
  assert.equal(p.data.query, '海边露营'); assert.equal(p.data.activeScope, 'title'); assert.equal(input.q, '海边露营'); assert.equal(input.bookId, ''); assert.equal(input.favorite, false); assert.equal(p.data.resultCount, 0);
});

test('search ignores stale responses and keeps scope matching local', async () => {
  let resolveFirst;
  const p = page('search', { listNotebookNotes: input => input.q === 'old' ? new Promise(resolve => { resolveFirst = resolve; }) : Promise.resolve({ notes: [{ id: 'a', title: 'new result' }, { id: 'b', title: 'elsewhere', body: 'new' }] }) });
  p.data.query = 'old'; const first = p.runSearch();
  p.data.query = 'new'; p.data.activeScope = 'title'; await p.runSearch();
  resolveFirst({ notes: [{ id: 'old', title: 'old' }] }); await first;
  assert.equal(p.data.results.length, 1); assert.equal(p.data.results[0].id, 'a');
});

test('book creation validates trimmed name, selected color and limit', async () => {
  const created = [];
  const p = page('books', { createNotebookBook: async (...args) => created.push(args) });
  p.openCreate(); p.onNameInput({ detail: { value: '   ' } }); await p.createBook(); assert.equal(created.length, 0); assert.equal(p.data.nameValid, false);
  p.onNameInput({ detail: { value: '  旅行  ' } }); p.selectColor(event({ color: '#ff765e' })); await p.createBook();
  assert.deepEqual(created[0], ['旅行', '#ff765e']); assert.equal(p.data.createOpen, false);
  p.data.books = Array.from({ length: 20 }, (_, id) => ({ id })); p.openCreate(); assert.equal(p.data.createOpen, false);
  p.data.newBookName = 'extra'; await p.createBook(); assert.equal(created.length, 1);
});

test('overflow rename saves trimmed name and closes after success', async () => {
  const updated = [];
  const p = page('books', { updateNotebookBook: async (...args) => updated.push(args) });
  p.data.books = [{ id: 'life', name: '生活', noteCount: 3 }];
  p.openBookMenu(event({ id: 'life' })); p.renameBook();
  assert.equal(p.data.renameOpen, true); assert.equal(p.data.renameName, '生活');
  p.onRenameInput({ detail: { value: ' 日常生活 ' } }); await p.saveRename();
  assert.equal(updated[0][0], 'life'); assert.equal(updated[0][1].name, '日常生活'); assert.equal(p.data.renameOpen, false); assert.equal(p.data.selectedBook, null);
});

test('only empty books can enter deletion and confirmation is required', async () => {
  const deleted = [];
  const p = page('books', { deleteNotebookBook: async id => deleted.push(id) });
  p.data.books = [{ id: 'full', name: '工作', noteCount: 8 }, { id: 'empty', name: '旅行', noteCount: 0 }];
  p.openBookMenu(event({ id: 'full' })); p.deleteBook(); assert.equal(p.data.deleteOpen, false); await p.confirmDelete(); assert.equal(deleted.length, 0);
  p.openBookMenu(event({ id: 'empty' })); p.deleteBook(); assert.equal(p.data.deleteOpen, true); assert.equal(deleted.length, 0);
  p.closeDelete(); assert.equal(deleted.length, 0); p.deleteBook(); await p.confirmDelete();
  assert.deepEqual(deleted, ['empty']); assert.equal(p.data.selectedBook, null);
});

test('failed book mutation keeps draft available and releases busy state', async () => {
  const p = page('books', { createNotebookBook: async () => { throw new Error('网络错误'); } });
  p.openCreate(); p.onNameInput({ detail: { value: '旅行' } }); await p.createBook();
  assert.equal(p.data.busy, false); assert.equal(p.data.createOpen, true); assert.equal(p.data.newBookName, '旅行');
});

test('create sheet reserves visible actions while keyboard reduces scrollable body', () => {
  let hides = 0;
  const p = page('books', {}, { getWindowInfo: () => ({ windowHeight: 480, windowWidth: 320, screenHeight: 568, safeArea: { bottom: 548 } }), hideKeyboard() { hides++; } });
  p.openCreate();
  const before = p.data.createBodyHeight;
  assert.ok(before > 200 && before < 480);
  p.onCreateKeyboardChange({ detail: { height: 230 } });
  assert.equal(p.data.keyboardHeight, 230);
  assert.ok(p.data.createBodyHeight >= 72 && p.data.createBodyHeight < before);
  // 268rpx reserves the drag handle, title, fixed action row and panel padding.
  assert.ok(p.data.createBodyHeight + 268 * 320 / 750 <= 480 - 230);
  p.closeCreate();
  assert.equal(p.data.keyboardHeight, 0);
  assert.equal(p.data.createBodyHeight, before);
  assert.equal(hides, 1);
});
