import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fetchLatestWebBuildInfo,
  isNewerWebBuild,
  parseWebBuildInfo,
  readLoadedWebBuildInfo,
  shouldAllowWebBuildReload,
  WEB_BUILD_RELOAD_GUARD_MS,
} from '../lib/web-build-version.ts';

const build = (buildId, builtAt) => ({
  buildId,
  commit: '4f67850',
  builtAt,
});

test('parses a complete web build identity', () => {
  assert.deepEqual(
    parseWebBuildInfo(build('build-a', '2026-10-25T03:00:00.000Z')),
    build('build-a', '2026-10-25T03:00:00.000Z'),
  );
});

test('rejects incomplete build identities', () => {
  assert.equal(parseWebBuildInfo(null), null);
  assert.equal(parseWebBuildInfo({ buildId: 'build-a' }), null);
  assert.equal(parseWebBuildInfo({ ...build('build-a', 'not-a-date') }), null);
});

test('reads the loaded build identity from document metadata', () => {
  const metadata = {
    'funbox-build-id': 'build-a',
    'funbox-build-commit': '4f67850',
    'funbox-build-time': '2026-10-25T03:00:00.000Z',
  };
  const documentValue = {
    querySelector(selector) {
      const name = /meta\[name="([^"]+)"\]/.exec(selector)?.[1];
      return name && metadata[name] ? { content: metadata[name] } : null;
    },
  };

  assert.deepEqual(
    readLoadedWebBuildInfo(documentValue),
    build('build-a', '2026-10-25T03:00:00.000Z'),
  );
});

test('fetches the latest build identity without HTTP caching', async () => {
  let requestedUrl = '';
  let requestedOptions;
  const latest = await fetchLatestWebBuildInfo(async (url, options) => {
    requestedUrl = String(url);
    requestedOptions = options;
    return new Response(JSON.stringify(build('build-b', '2026-10-25T03:01:00.000Z')), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  assert.deepEqual(latest, build('build-b', '2026-10-25T03:01:00.000Z'));
  assert.match(requestedUrl, /^\/version\.json\?__funbox_version_check=/);
  assert.equal(requestedOptions.cache, 'no-store');
});

test('detects only a newer server build', () => {
  const current = build('build-a', '2026-10-25T03:00:00.000Z');
  const newer = build('build-b', '2026-10-25T03:01:00.000Z');
  const older = build('build-c', '2026-10-25T02:59:00.000Z');

  assert.equal(isNewerWebBuild(current, newer), true);
  assert.equal(isNewerWebBuild(current, older), false);
  assert.equal(isNewerWebBuild(current, current), false);
});

test('guards repeated reloads for the same build', () => {
  const latest = build('build-b', '2026-10-25T03:01:00.000Z');
  const now = Date.parse('2026-10-25T03:02:00.000Z');

  assert.equal(shouldAllowWebBuildReload(null, latest, now), true);
  assert.equal(
    shouldAllowWebBuildReload({ buildId: latest.buildId, requestedAt: now - 1_000 }, latest, now),
    false,
  );
  assert.equal(
    shouldAllowWebBuildReload(
      { buildId: latest.buildId, requestedAt: now - WEB_BUILD_RELOAD_GUARD_MS },
      latest,
      now,
    ),
    true,
  );
});
