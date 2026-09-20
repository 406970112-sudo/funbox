import assert from 'node:assert/strict';
import test from 'node:test';

import { restoreNovelWorkflow, serializeNovelWorkflow } from '../lib/novel-agent-snapshot.ts';

const snapshot = {
  version: 1,
  phase: 'complete',
  form: {
    premise: '海边灯塔里藏着一封旧信',
    genre: '悬疑',
    tone: '克制·文学感',
    keywords: '海岛, 灯塔',
    referenceTitle: '海雾样例',
    referenceSample: '潮气贴在窗上，灯光像一枚迟到的针。',
    styleDimensions: ['节奏'],
  },
  stages: { reference: 'complete', outline: 'complete', draft: 'complete', review: 'complete' },
  reference: null,
  outline: null,
  draft: {
    title: '灯塔的来信',
    subtitle: '第一章',
    paragraphs: ['旧信在桌上展开。'],
    wordCount: 9,
    revision: 2,
    sceneId: 'ch-001-scene-001',
    activeRevisionId: 'rev-002',
    revisionHistory: [{ revision: 1, revisionId: 'rev-001', title: '灯塔的来信', subtitle: '第一章', paragraphs: ['旧信。'], wordCount: 3, request: null }],
    lastRevisionRequest: null,
    sourceHook: '旧信引出灯塔真相',
    styleApplied: '作者风格优先',
    styleDimensions: ['节奏'],
  },
  review: null,
  memorySync: null,
};

test('round-trips a versioned workflow snapshot without losing revisions', () => {
  const restored = restoreNovelWorkflow(serializeNovelWorkflow(snapshot));

  assert.deepEqual(restored, snapshot);
  assert.equal(restored?.draft.revisionHistory[0].revisionId, 'rev-001');
  assert.equal(JSON.parse(serializeNovelWorkflow(snapshot)).draft.referenceSample, undefined);
});

test('rejects malformed and unsupported workflow snapshots safely', () => {
  assert.equal(restoreNovelWorkflow(null), null);
  assert.equal(restoreNovelWorkflow('{bad json'), null);
  assert.equal(restoreNovelWorkflow(JSON.stringify({ ...snapshot, version: 99 })), null);
  assert.equal(restoreNovelWorkflow(JSON.stringify({ ...snapshot, form: null })), null);
});

