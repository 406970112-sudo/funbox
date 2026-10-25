import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = path.join(frontendRoot, 'scripts/inject-web-fallback.mjs');

test('injects an idempotent boot fallback into the exported index', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'funbox-web-fallback-'));
  const distDirectory = path.join(workspace, 'dist');
  fs.mkdirSync(distDirectory);
  const indexPath = path.join(distDirectory, 'index.html');
  fs.writeFileSync(
    indexPath,
    '<!doctype html><html><head><title>FunBox</title></head><body><div id="root"></div><script src="/entry.js"></script></body></html>',
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

    assert.equal(secondPass, firstPass);
    assert.match(firstPass, /data-funbox-boot-fallback/);
    assert.match(firstPass, /<div id="root">\s*<div[\s\S]*id="funbox-boot-fallback"/);
    assert.match(firstPass, /页面资源加载失败/);
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
