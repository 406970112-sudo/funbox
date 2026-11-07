const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const editor = path.resolve(__dirname, '../packages/notebook/editor');
const source = fs.readFileSync(path.join(editor, 'index.js'), 'utf8');
const template = fs.readFileSync(path.join(editor, 'index.wxml'), 'utf8');

function load(api = {}, wxPatch = {}) {
  let definition;
  const timers = new Map();
  let timerId = 0;
  const calls = [];
  const wx = { showToast() {}, showModal: options => calls.push(options), navigateBack() {}, ...wxPatch };
  vm.runInNewContext(source, {
    Page: value => { definition = value; }, wx,
    require: request => ({
      '../utils/notebook-api': {
        listNotebookBooks: async () => [{ id: 'life', name: '生活' }],
        getNotebookSecurity: async () => ({ hasPassword: false }),
        notebookErrorMessage: error => error.message || error.code,
        isNotebookUnauthorized: error => error.statusCode === 401,
        isNotebookLockedError: error => error.code === 'locked',
        ...api,
      },
      '../utils/notebook-format': { bookTheme: () => ({ fill: '#e8eeff', ink: '#2455ff' }) },
      '../../../utils/auth': { getAccessToken: () => 'token', clearSession() {} },
    }[request] || {}),
    setTimeout: fn => { const id = ++timerId; timers.set(id, fn); return id; },
    clearTimeout: id => timers.delete(id),
  });
  const page = { ...definition, data: { ...definition.data, isLoggedIn: true, loading: false },
    setData(patch) { this.data = { ...this.data, ...patch }; } };
  page._active = true;
  page.noteId = '';
  page._dirty = false;
  return { page, calls, timers };
}

function loadedNote(patch = {}) {
  return { id: 'n1', bookId: 'life', title: '周末', body: '去山里走走', checklist: [], tags: [], ...patch };
}

test('editor ignores legacy media without download or destructive API calls', async () => {
  let mediaCalls = 0;
  const { page } = load({
    getNotebookNote: async () => loadedNote({ media: [{ id: 'old-image', kind: 'image' }, { id: 'old-audio', kind: 'audio' }] }),
    downloadNotebookMedia: async () => { mediaCalls++; },
    deleteNotebookMedia: async () => { mediaCalls++; },
    updateNotebookNote: async (_id, payload) => { assert.equal('media' in payload, false); return loadedNote(payload); },
  });
  page.noteId = 'n1';
  await page.loadEditor();
  assert.equal(mediaCalls, 0);
  assert.equal(page.data.body, '去山里走走');
  assert.equal('images' in page.data, false);
  assert.equal('audio' in page.data, false);
  page.onBodyInput({ detail: { value: '更新正文' } });
  await page.saveNow();
  assert.equal(mediaCalls, 0);
});

test('editor has only checklist and tag tools with no media lifecycle', () => {
  const { page } = load();
  for (const name of ['chooseImages', 'removeImage', 'setupRecorder', 'toggleRecording', 'playAudio', 'deleteAudio', 'hydrateImages', 'prepareAudio']) assert.equal(page[name], undefined);
  assert.doesNotMatch(source, /NotebookMedia|createInnerAudioContext|getRecorderManager|chooseMedia/);
  assert.doesNotMatch(template, /图片|语音|录音|chooseImages|toggleRecording|<image/);
  assert.match(template, /class="writing-sheet"/);
  assert.match(template, /name="checklist"/);
  assert.match(template, /name="tag"/);
  assert.doesNotMatch(template, /<picker/);
});

test('failed autosave preserves text, checklist, tags and retry dirty state', async () => {
  const { page } = load({ updateNotebookNote: async () => { throw new Error('网络不可用'); } });
  page.applyLoadedNote(loadedNote({ checklist: [{ id: 'c1', text: '带水', done: false }], tags: ['旅行'] }), []);
  page.onBodyInput({ detail: { value: '这些输入要保留' } });
  assert.equal(await page.saveNow({ silent: true }), false);
  assert.equal(page.data.body, '这些输入要保留');
  assert.equal(page.data.checklist[0].text, '带水');
  assert.equal(page.data.tags[0], '旅行');
  assert.equal(page._dirty, true);
  assert.equal(page.data.saveState, 'error');
});

test('edits during an in-flight save are saved without replacing newer input', async () => {
  let release;
  const payloads = [];
  const { page } = load({ updateNotebookNote: async (_id, payload) => {
    payloads.push(payload);
    if (payloads.length === 1) await new Promise(resolve => { release = resolve; });
    return loadedNote(payload);
  } });
  page.applyLoadedNote(loadedNote(), []);
  page.onBodyInput({ detail: { value: '第一版' } });
  const saved = page.saveNow();
  page.onBodyInput({ detail: { value: '第二版' } });
  release();
  assert.equal(await saved, true);
  assert.equal(payloads.length, 2);
  assert.equal(payloads[1].body, '第二版');
  assert.equal(page.data.body, '第二版');
});

test('failed encryption retains encryption intent for all subsequent retries', async () => {
  const payloads = [];
  const { page } = load({ updateNotebookNote: async (_id, payload) => { payloads.push(payload); throw new Error('网络不可用'); } });
  page.applyLoadedNote(loadedNote(), []);
  await page.applyEncryption();
  assert.equal(page.data.encrypted, true);
  assert.equal(page._dirty, true);
  page.onBodyInput({ detail: { value: '私密草稿' } });
  await page.retrySave();
  assert.equal(payloads.length, 2);
  assert.equal(payloads.every(payload => payload.encrypted), true);
});

test('password setup requires valid matching password and explicit acknowledgment', async () => {
  let setups = 0;
  let unlocks = 0;
  const { page, calls } = load({ setNotebookPassword: async () => { setups++; }, unlockNotebook: async () => { unlocks++; } });
  page.openPasswordModal('setup');
  page.setData({ passwordValue: 'abc123', passwordConfirm: 'abc123' });
  await page.submitPasswordModal();
  assert.equal(setups, 0);
  assert.match(page.data.passwordError, /确认/);
  page.togglePasswordAcknowledged();
  page.setData({ passwordConfirm: 'wrong' });
  await page.submitPasswordModal();
  assert.equal(setups, 0);
  page.setData({ passwordConfirm: 'abc123' });
  await page.submitPasswordModal();
  assert.equal(setups, 1);
  assert.equal(unlocks, 1);
  assert.equal(page.data.passwordValue, '');
  assert.equal(calls.length, 1);
  assert.equal(page.data.encrypted, false);
});

test('expired encryption session opens password panel and keeps draft', async () => {
  const { page } = load({ updateNotebookNote: async () => { throw { code: 'locked' }; } });
  page.applyLoadedNote(loadedNote({ encrypted: true }), []);
  page.onBodyInput({ detail: { value: '未丢失的私密输入' } });
  assert.equal(await page.saveNow(), false);
  assert.equal(page.data.showPasswordModal, true);
  assert.equal(page.data.passwordMode, 'unlock');
  assert.equal(page.data.body, '未丢失的私密输入');
  page.closePasswordModal();
  assert.equal(page.data.encrypted, true);
  assert.equal(page._dirty, true);
});

test('keyboard height reduces writing viewport, reveals focus, and removes listener on unload', () => {
  let listener;
  let removed;
  const { page } = load({}, { getWindowInfo: () => ({ windowHeight: 700 }), onKeyboardHeightChange: fn => { listener = fn; }, offKeyboardHeightChange: fn => { removed = fn; } });
  page.setupViewport();
  listener({ height: 310 });
  assert.equal(page.data.keyboardHeight, 310);
  assert.equal(page.data.viewportHeight, 390);
  listener({ height: 0 });
  assert.equal(page.data.viewportHeight, 700);
  page.onUnload();
  assert.equal(removed, listener);
  assert.match(template, /bindkeyboardheightchange="onKeyboardHeightChange"/);
  assert.match(template, /adjust-position="\{\{false\}\}"/);
});

test('custom book selection persists selected book and preserves editor text', async () => {
  const { page } = load();
  page._books = [{ id: 'work', name: '工作', fill: '#eee', ink: '#333' }];
  page.setData({ title: '已有标题', body: '已有正文' });
  page.openBookSheet();
  assert.equal(page.data.showBookSheet, true);
  page.onBookChange({ currentTarget: { dataset: { index: '0' } } });
  assert.equal(page.data.selectedBookId, 'work');
  assert.equal(page.data.title, '已有标题');
  assert.equal(page.data.body, '已有正文');
  assert.equal(page._dirty, true);
});


test('cancelling unlock after a failed encryption attempt cannot allow a plaintext autosave', async () => {
  const payloads = [];
  const { page } = load({ updateNotebookNote: async (_id, payload) => { payloads.push(payload); throw { code: 'locked' }; } });
  page.applyLoadedNote(loadedNote(), []);
  await page.applyEncryption();
  assert.equal(page.data.showPasswordModal, true);
  page.closePasswordModal();
  assert.equal(page.data.encrypted, true);
  page.onBodyInput({ detail: { value: '继续输入的隐私内容' } });
  await page.saveNow();
  assert.equal(payloads.every(payload => payload.encrypted), true);
});

test('returning from book management refreshes choices without reloading or overwriting the draft', async () => {
  let bookReads = 0;
  let noteReads = 0;
  const { page } = load({
    listNotebookBooks: async () => { bookReads++; return [{ id: 'life', name: '生活改名' }, { id: 'new', name: '新主题' }]; },
    getNotebookNote: async () => { noteReads++; return loadedNote(); },
    updateNotebookNote: async () => { throw new Error('offline'); },
  }, { navigateTo() {} });
  page.applyLoadedNote(loadedNote({ tags: ['旅行'], checklist: [{ id: 'c', text: '带水', done: false }] }), [{ id: 'life', name: '生活' }]);
  page.setData({ body: '未保存的正文', title: '未保存标题' });
  page._dirty = true;
  page.manageBooks();
  page.onHide();
  await page._savePromise;
  await page.onShow();
  assert.equal(page._dirty, true);
  assert.equal(bookReads, 1);
  assert.equal(noteReads, 0);
  assert.equal(page.data.books.length, 2);
  assert.equal(page.data.selectedBookId, 'life');
  assert.equal(page.data.selectedBookName, '生活改名');
  assert.equal(page.data.body, '未保存的正文');
  assert.equal(page.data.title, '未保存标题');
  assert.equal(page.data.tags[0], '旅行');
  assert.equal(page.data.checklist[0].text, '带水');
});

test('hidden initial load retries on return and rejects its stale response after a newer load', async () => {
  let firstResolve;
  let bookReads = 0;
  const { page } = load({ listNotebookBooks: async () => {
    bookReads++;
    if (bookReads === 1) return new Promise(resolve => { firstResolve = resolve; });
    return [{ id: 'fresh', name: '新数据' }];
  } });
  const initial = page.loadEditor();
  page.onHide();
  await page.onShow();
  firstResolve([{ id: 'stale', name: '过期数据' }]);
  await initial;
  assert.equal(bookReads, 2);
  assert.equal(page.data.loading, false);
  assert.equal(page.data.selectedBookId, 'fresh');
  assert.equal(page.data.books[0].name, '新数据');
});


test('initial data arriving while hidden is retried after returning', async () => {
  let resolveHidden;
  let calls = 0;
  const { page } = load({ listNotebookBooks: async () => {
    calls++;
    if (calls === 1) return new Promise(resolve => { resolveHidden = resolve; });
    return [{ id: 'life', name: '生活' }];
  } });
  const loading = page.loadEditor();
  page.onHide();
  resolveHidden([{ id: 'discarded', name: '隐藏时的数据' }]);
  await loading;
  assert.equal(page.data.loading, true);
  await page.onShow();
  assert.equal(calls, 2);
  assert.equal(page.data.loading, false);
  assert.equal(page.data.selectedBookId, 'life');
});


test('body flows to its content and growing paragraphs stay visible above the dock', () => {
  const { page } = load();
  assert.match(template, /id="note-body"[^>]*auto-height/);
  assert.doesNotMatch(template, /bodyHeight/);
  const styles = fs.readFileSync(path.join(editor, 'index.wxss'), 'utf8');
  assert.match(styles, /\.body-input\s*\{[^}]*min-height:\s*120rpx/);
  let reveals = 0;
  page.revealFocusedField = () => { reveals++; };
  page._focusedField = 'note-body';
  page.setData({ keyboardHeight: 300 });
  page.onBodyLineChange();
  assert.equal(reveals, 1);
});
