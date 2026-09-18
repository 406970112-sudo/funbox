import assert from 'node:assert/strict';
import test from 'node:test';

import {
  runReferencePlan,
  runWritingReview,
} from '../lib/novel-agent-workflow.ts';

test('reference analysis stops at A approval before B can write', async () => {
  const events = [];
  const plan = await runReferencePlan(
    {
      premise: '海边灯塔里藏着一封旧信',
      referenceTitle: '海雾样例',
      referenceSample: '潮气贴在窗上，灯光像一枚迟到的针。',
      styleDimensions: ['节奏', '环境描写'],
      delayMs: 0,
    },
    (event) => events.push(event),
  );

  assert.deepEqual(
    events.filter((event) => event.type === 'stage-complete').map((event) => event.stage),
    ['reference', 'outline'],
  );
  assert.equal(plan.outline.approvalStatus, '待用户确认');
  assert.deepEqual(plan.reference.referenceStyleProfile.enabled, ['节奏', '环境描写']);
});

test('approved plan lets B write and C route a local revision before memory sync', async () => {
  const events = [];
  const input = {
    premise: '海边灯塔里藏着一封旧信',
    referenceTitle: '海雾样例',
    styleDimensions: ['节奏'],
    delayMs: 0,
  };
  const plan = await runReferencePlan(input, () => {});
  const result = await runWritingReview(input, plan, (event) => events.push(event));

  assert.equal(result.review.pass, true);
  assert.equal(result.draft.revision, 2);
  assert.deepEqual(result.draft.styleDimensions, ['节奏']);
  assert.equal(result.memorySync.status, '同步完成');
  assert.deepEqual(
    events.filter((event) => event.type === 'stage-complete').map((event) => event.stage),
    ['draft', 'review', 'draft', 'review', 'memory'],
  );
  assert.equal(result.review.categories.style.status, 'pass');
  assert.equal(result.review.categories.originality.status, 'pass');
});
