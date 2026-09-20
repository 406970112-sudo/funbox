import assert from 'node:assert/strict';
import test from 'node:test';

import {
  approveNovelAgentA,
  createNovelAgentWorkflow,
  getNovelAgentConfig,
  messageNovelAgentA,
  NovelAgentAPIError,
  reviewNovelAgentC,
  writeNovelAgentB,
} from '../lib/novel-agent-api.ts';

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('real mode API sends auth, strips demo delay, and maps persisted workflow', async () => {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({
      workflow: {
        workflowId: 'wf-1',
        status: 'A_DISCUSSION',
        version: 1,
        input: { premise: '旧信' },
        aMessages: [],
        draftPlan: null,
        approvedPlan: null,
        draft: null,
        review: null,
      },
    }), { status: 201, headers: { 'Content-Type': 'application/json' } });
  };

  const result = await createNovelAgentWorkflow('token-1', {
    premise: '旧信',
    styleDimensions: ['节奏'],
    delayMs: 420,
  });

  assert.equal(result.workflowId, 'wf-1');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer token-1');
  assert.equal(JSON.parse(calls[0].options.body).delayMs, undefined);
  assert.equal(JSON.parse(calls[0].options.body).premise, '旧信');
});

test('real mode API uses versioned stage endpoints and maps draft/review defaults', async () => {
  const calls = [];
  const responses = [
    { status: 'A_READY', version: 2, draftPlan: { outline: { logline: '寻找旧信' }, reference: { title: '样例' } } },
    { status: 'A_APPROVED', version: 3, approvedPlan: { outline: { logline: '寻找旧信' }, reference: { title: '样例' } } },
    { status: 'REVIEWING', version: 5, draft: { title: '第一章', paragraphs: ['正文'] } },
    { status: 'COMPLETED', version: 6, draft: { title: '第一章', paragraphs: ['正文'] }, review: { route: 'PASS', pass: true, score: 90 } },
  ];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    const response = responses.shift();
    return new Response(JSON.stringify({ workflow: { workflowId: 'wf-1', version: response.version, input: { premise: 'x' }, aMessages: [], ...response } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const token = 'token-1';
  await messageNovelAgentA(token, 'wf-1', '形成方案', 1);
  await approveNovelAgentA(token, 'wf-1', 2);
  await writeNovelAgentB(token, 'wf-1', 3, { sceneId: 'scene-1' });
  const reviewed = await reviewNovelAgentC(token, 'wf-1', 5);

  assert.equal(reviewed.draft?.wordCount, 2);
  assert.deepEqual(reviewed.review?.categories, {});
  assert.equal(reviewed.review?.pass, true);
  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), [
    '/api/v1/novel-agent/workflows/wf-1/a/messages',
    '/api/v1/novel-agent/workflows/wf-1/a/approve',
    '/api/v1/novel-agent/workflows/wf-1/b/write',
    '/api/v1/novel-agent/workflows/wf-1/c/review',
  ]);
  assert.equal(JSON.parse(calls[1].options.body).expectedVersion, 2);
});

test('config and provider errors keep stable error codes', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ demo: true, real: false, enabled: false, provider: 'deepseek', models: { planner: 'a', writer: 'b', reviewer: 'c' } }), { status: 200 });
  assert.equal((await getNovelAgentConfig()).real, false);

  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'conflict' }), { status: 409 });
  await assert.rejects(
    () => approveNovelAgentA('token-1', 'wf-1', 3),
    (error) => error instanceof NovelAgentAPIError && error.code === 'conflict' && error.status === 409,
  );
});
