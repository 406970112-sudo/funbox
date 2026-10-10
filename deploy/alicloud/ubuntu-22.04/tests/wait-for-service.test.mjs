import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import http from 'node:http';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const bash = process.env.BASH_BIN ?? (process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash');
const script = fileURLToPath(new URL('../wait-for-service.sh', import.meta.url)).replaceAll('\\', '/');
const env = { ...process.env, NO_PROXY: '127.0.0.1', no_proxy: '127.0.0.1' };

test('waits for a service whose HTTP listener starts after the process', async (t) => {
  assert.ok(existsSync(script), 'service readiness checker is missing');
  const server = http.createServer((_req, res) => res.end('healthy'));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  const timer = setTimeout(() => server.listen(port, '127.0.0.1'), 4000);
  t.after(() => {
    clearTimeout(timer);
    server.close();
  });

  const result = await run(bash, [script, 'fixture-backend', `http://127.0.0.1:${port}/healthz`, '30', '0.2'], { env });
  assert.match(result.stdout, /Waiting for fixture-backend/);
  assert.match(result.stdout, /fixture-backend is ready/);
});

test('fails after bounded retries when the service keeps returning HTTP errors', async (t) => {
  assert.ok(existsSync(script), 'service readiness checker is missing');
  let requests = 0;
  const server = http.createServer((_req, res) => {
    requests += 1;
    res.writeHead(503).end('unavailable');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/healthz`;

  await assert.rejects(run(bash, [script, 'fixture-backend', url, '3', '0'], { env }), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stdout, /fixture-backend did not become ready/);
    assert.match(error.stdout, new RegExp(url.replaceAll('.', '\\.')));
    return true;
  });
  assert.equal(requests, 3);
});
