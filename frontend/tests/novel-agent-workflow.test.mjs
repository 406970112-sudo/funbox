import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createNovelDraft,
  createNovelOutline,
  createReferenceAnalysis,
  runReferencePlan,
  runWritingReview,
} from '../lib/novel-agent-workflow.ts';
import {
  assembleWritingContext,
  createChapterCards,
  createInitialMemoryState,
  createSceneCards,
} from '../lib/novel-agent-artifacts.ts';
import {
  aggregateReviewChecks,
  runReviewChecks,
} from '../lib/novel-agent-review.ts';

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

test('runs independent quality, style, originality, and safety checks in parallel', async () => {
  const input = {
    premise: '海边灯塔里藏着一封旧信',
    referenceTitle: '海雾样例',
    styleDimensions: ['节奏'],
  };
  const reference = createReferenceAnalysis(input);
  const outline = createNovelOutline(input, reference);
  const chapter = createChapterCards(outline)[0];
  const scene = createSceneCards(chapter)[0];
  const context = assembleWritingContext({
    outline,
    chapter,
    scene,
    memory: createInitialMemoryState(outline),
    styleDimensions: ['节奏'],
  });
  const draft = createNovelDraft(input, outline, reference, false, null, context);
  const checks = await runReviewChecks({ draft, context, reference, round: 1 });
  const report = aggregateReviewChecks(checks, 1);

  assert.deepEqual(checks.map((check) => check.id), ['quality', 'style', 'originality', 'safety']);
  assert.equal(report.route, 'B_REWRITE');
  assert.equal(report.issueDetails[0].location, `${scene.sceneId}/ending`);
  assert.equal(report.issueDetails[0].severity, 'minor');
  assert.ok(report.issueDetails[0].evidence);
});

test('routes a critical safety issue to human review without automatic rewrite', async () => {
  const input = { premise: '一个被遗忘的海岛', styleDimensions: ['节奏'] };
  const reference = createReferenceAnalysis(input);
  const outline = createNovelOutline(input, reference);
  const chapter = createChapterCards(outline)[0];
  const scene = createSceneCards(chapter)[0];
  const context = assembleWritingContext({
    outline,
    chapter,
    scene,
    memory: createInitialMemoryState(outline),
    styleDimensions: ['节奏'],
  });
  const draft = createNovelDraft(input, outline, reference, false, null, context);
  const checks = await runReviewChecks({ draft, context, reference, round: 2 });
  const unsafeChecks = checks.map((check) => check.id === 'safety'
    ? {
        ...check,
        status: 'warn',
        severity: 'critical',
        issues: [{
          type: 'copyright',
          message: '出现需要人工确认的高度相似表达',
          location: `${scene.sceneId}/p-001`,
          severity: 'critical',
          route: 'HUMAN_REVIEW',
          evidence: '检测到不可自动判断的表达重合风险',
        }],
      }
    : check);
  const report = aggregateReviewChecks(unsafeChecks, 2);

  assert.equal(report.pass, false);
  assert.equal(report.route, 'HUMAN_REVIEW');
  assert.equal(report.issueDetails[0].route, 'HUMAN_REVIEW');
});
