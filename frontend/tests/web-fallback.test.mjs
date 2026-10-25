import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = path.join(frontendRoot, 'scripts/inject-web-fallback.mjs');

test('injects an idempotent boot fallback into the exported index', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'funbox-web-fallback-'));
  const distDirectory = path.join(workspace, 'dist');
  fs.mkdirSync(distDirectory);
  const indexPath = path.join(distDirectory, 'index.html');
  const scriptDirectory = path.join(distDirectory, '_expo/static/js/web');
  const entryName = 'entry-11111111111111111111111111111111.js';
  const chunkPath = '/_expo/static/js/web/tools-22222222222222222222222222222222.js';
  fs.mkdirSync(scriptDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(scriptDirectory, entryName),
    `const routeChunk = ${JSON.stringify(chunkPath)};\n`,
  );
  fs.writeFileSync(path.join(scriptDirectory, path.basename(chunkPath)), 'export {};\n');
  fs.writeFileSync(
    indexPath,
    `<!doctype html><html><head><title>FunBox</title></head><body><div id="root"></div><script src="/_expo/static/js/web/${entryName}"></script></body></html>`,
  );

  try {
    const buildEnvironment = {
      ...process.env,
      DEPLOY_COMMIT: '4f6785008b343f86a61ecc0ebe618a48ac0026b8',
      WEB_BUILD_TIME: '2026-10-25T03:00:00.000Z',
    };

    execFileSync(process.execPath, [scriptPath, distDirectory], { env: buildEnvironment });
    const firstPass = fs.readFileSync(indexPath, 'utf8');
    execFileSync(process.execPath, [scriptPath, distDirectory], { env: buildEnvironment });
    const secondPass = fs.readFileSync(indexPath, 'utf8');
    const buildInfo = JSON.parse(fs.readFileSync(path.join(distDirectory, 'version.json'), 'utf8'));
    const entrySource = fs.readFileSync(path.join(scriptDirectory, entryName), 'utf8');

    assert.equal(secondPass, firstPass);
    assert.match(firstPass, /data-funbox-boot-fallback/);
    assert.match(firstPass, /<div id="root"><\/div>\s*<div[\s\S]*id="funbox-boot-fallback"/);
    assert.match(firstPass, /window\.__funboxMarkBootReady/);
    assert.match(firstPass, /页面资源加载失败/);
    assert.match(firstPass, new RegExp(`${entryName}\\?v=4f6785`));
    assert.match(entrySource, /tools-2222[^"]+\?v=4f6785/);
    assert.match(firstPass, /name="funbox-build-commit" content="4f6785008b343f86a61ecc0ebe618a48ac0026b8"/);
    assert.deepEqual(buildInfo, {
      buildId: '4f6785008b343f86a61ecc0ebe618a48ac0026b8',
      commit: '4f6785008b343f86a61ecc0ebe618a48ac0026b8',
      builtAt: '2026-10-25T03:00:00.000Z',
    });
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('keeps the fallback hidden after boot and preserves real failure handling', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'funbox-web-fallback-runtime-'));
  const distDirectory = path.join(workspace, 'dist');
  fs.mkdirSync(distDirectory);
  const indexPath = path.join(distDirectory, 'index.html');
  fs.writeFileSync(
    indexPath,
    '<!doctype html><html><head><title>FunBox</title></head><body><div id="root"></div></body></html>',
  );

  try {
    execFileSync(process.execPath, [scriptPath, distDirectory], { env: process.env });
    const harness = createFallbackHarness(fs.readFileSync(indexPath, 'utf8'));

    harness.markReady();
    assert.equal(harness.pendingTimers(), 0);
    harness.advance(12_000);
    assert.equal(harness.fallback.style.display, 'none');
    assert.equal(harness.message.textContent, '正在加载工具与游戏…');
    assert.equal(harness.retry.hidden, true);

    const timeoutHarness = createFallbackHarness(fs.readFileSync(indexPath, 'utf8'));
    timeoutHarness.advance(12_000);
    assert.equal(timeoutHarness.fallback.style.display, 'flex');
    assert.equal(timeoutHarness.message.textContent, '页面资源加载失败，请检查网络后刷新重试。');
    assert.equal(timeoutHarness.retry.hidden, false);

    const resourceErrorHarness = createFallbackHarness(fs.readFileSync(indexPath, 'utf8'));
    resourceErrorHarness.dispatchError({ target: { tagName: 'SCRIPT' }, error: null });
    assert.equal(resourceErrorHarness.fallback.style.display, 'flex');
    assert.equal(resourceErrorHarness.retry.hidden, false);

    const postBootErrorHarness = createFallbackHarness(fs.readFileSync(indexPath, 'utf8'));
    postBootErrorHarness.markReady();
    postBootErrorHarness.dispatchError({ target: null, error: new Error('runtime failure') });
    assert.equal(postBootErrorHarness.fallback.style.display, 'flex');
    assert.equal(postBootErrorHarness.retry.hidden, false);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

function createFallbackHarness(indexHtml) {
  const match = indexHtml.match(/<script>\s*([\s\S]*?window\.__funboxMarkBootReady[\s\S]*?)<\/script>/);
  assert.ok(match, 'fallback inline script was not injected');

  const fallback = { style: { display: 'flex' } };
  const message = { textContent: '正在加载工具与游戏…' };
  const retry = { hidden: true };
  const elements = new Map([
    ['funbox-boot-fallback', fallback],
    ['funbox-boot-message', message],
    ['funbox-boot-retry', retry],
  ]);
  const timers = new Map();
  let nextTimerId = 1;
  let now = 0;
  let errorHandler = null;

  const window = {
    addEventListener(type, handler) {
      if (type === 'error') errorHandler = handler;
    },
    setTimeout(callback, delay) {
      const timerId = nextTimerId++;
      timers.set(timerId, { callback, dueAt: now + delay });
      return timerId;
    },
    clearTimeout(timerId) {
      timers.delete(timerId);
    },
  };
  const document = {
    body: { contains: () => true },
    getElementById(id) {
      return elements.get(id) ?? null;
    },
  };

  vm.runInContext(match[1], vm.createContext({ window, document }));

  return {
    fallback,
    message,
    retry,
    markReady() {
      window.__funboxMarkBootReady();
    },
    dispatchError(event) {
      assert.ok(errorHandler, 'fallback error handler was not registered');
      errorHandler(event);
    },
    advance(milliseconds) {
      now += milliseconds;
      const dueTimers = [...timers.entries()]
        .filter(([, timer]) => timer.dueAt <= now)
        .sort((left, right) => left[1].dueAt - right[1].dueAt);
      for (const [timerId, timer] of dueTimers) {
        timers.delete(timerId);
        timer.callback();
      }
    },
    pendingTimers() {
      return timers.size;
    },
  };
}
