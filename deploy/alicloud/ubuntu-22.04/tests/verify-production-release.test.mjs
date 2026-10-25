import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(testDirectory, '../verify-production-release.mjs');
const commit = '4f6785008b343f86a61ecc0ebe618a48ac0026b8';
const builtAt = '2026-10-25T03:00:00.000Z';
const buildId = commit;
const entryChunkPath = '/_expo/static/js/web/entry-33333333333333333333333333333333.js';
const routeChunkPath = '/_expo/static/js/web/tools-11111111111111111111111111111111.js';

test('verifies that the public HTML and assets match version.json', async () => {
  await withReleaseServer(async (baseUrl) => {
    const { stdout } = await execFileAsync(process.execPath, [scriptPath, baseUrl, commit], {
      encoding: 'utf8',
    });

    assert.match(stdout, new RegExp(`Verified production release ${commit}`));
  });
});

test('rejects a public release with the wrong commit', async () => {
  await withReleaseServer(async (baseUrl) => {
    await assert.rejects(
      execFileAsync(process.execPath, [scriptPath, baseUrl, 'stale-commit']),
      /version\.json commit is .* expected stale-commit/,
    );
  });
});

test('rejects a release with a missing asynchronous route chunk', async () => {
  await withReleaseServer(
    async (baseUrl) => {
      await assert.rejects(
        execFileAsync(process.execPath, [scriptPath, baseUrl, commit]),
        /referenced asset returned HTTP 404/,
      );
    },
    { routeChunkStatus: 404 },
  );
});

async function withReleaseServer(run, { routeChunkStatus = 200 } = {}) {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

    if (url.pathname === '/version.json') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ buildId, commit, builtAt }));
      return;
    }

    if (url.pathname === '/') {
      response.setHeader('Content-Type', 'text/html');
      response.end(`<!doctype html><html><head>
        <meta name="funbox-build-id" content="${buildId}" />
        <meta name="funbox-build-commit" content="${commit}" />
        <meta name="funbox-build-time" content="${builtAt}" />
        <script src="${entryChunkPath}?v=${buildId}"></script>
      </head><body></body></html>`);
      return;
    }

    if (url.pathname === entryChunkPath) {
      response.setHeader('Content-Type', 'application/javascript');
      response.end(`console.log(${JSON.stringify(`${routeChunkPath}?v=${buildId}`)});`);
      return;
    }

    if (url.pathname === routeChunkPath) {
      if (routeChunkStatus !== 200) {
        response.statusCode = routeChunkStatus;
        response.end('route chunk unavailable');
        return;
      }
      response.setHeader('Content-Type', 'application/javascript');
      response.end('console.log("route chunk");');
      return;
    }

    response.statusCode = 404;
    response.end('not found');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Unable to determine test server address');
  }

  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
