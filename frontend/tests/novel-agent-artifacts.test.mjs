import assert from 'node:assert/strict';
import test from 'node:test';

import { createNovelOutline } from '../lib/novel-agent-workflow.ts';
import {
  assembleWritingContext,
  createChapterCards,
  createInitialMemoryState,
  createRevisionRequest,
  createSceneCards,
} from '../lib/novel-agent-artifacts.ts';

const outline = createNovelOutline({
  premise: '海边灯塔里藏着一封旧信',
  genre: '悬疑',
  tone: '克制·文学感',
  keywords: ['海岛', '灯塔'],
});

test('builds stable chapter and scene cards from an approved outline', () => {
  const chapters = createChapterCards(outline);
  const scenes = chapters.flatMap((chapter) => createSceneCards(chapter));

  assert.equal(chapters.length, outline.chapters.length);
  assert.deepEqual(chapters.map((chapter) => chapter.chapterId), ['ch-001', 'ch-002', 'ch-003']);
  assert.equal(scenes[0].sceneId, 'ch-001-scene-001');
  assert.equal(scenes.at(-1).sceneId, 'ch-003-scene-001');
  assert.equal(scenes.length, chapters.reduce((total, chapter) => total + chapter.sceneIds.length, 0));
  assert.ok(chapters.every((chapter) => chapter.mustKeep.length > 0 && chapter.mustAvoid.length > 0));
  assert.ok(scenes.every((scene) => scene.goal && scene.targetEnding && scene.chapterId));
});

test('creates canonical memory and assembles only the current scene context', () => {
  const chapters = createChapterCards(outline);
  const chapter = chapters[0];
  const scene = createSceneCards(chapter)[0];
  const memory = createInitialMemoryState(outline);
  const context = assembleWritingContext({
    outline,
    chapter,
    scene,
    memory,
    styleDimensions: ['节奏'],
    priorReviewIssue: '结尾需要明确下一步行动',
  });

  assert.equal(memory.version, 1);
  assert.ok(outline.mustKeep.length > 0);
  assert.ok(outline.mustAvoid.length > 0);
  assert.ok(memory.canonicalFacts.includes(outline.setting));
  assert.equal(context.scene.sceneId, scene.sceneId);
  assert.deepEqual(context.styleDimensions, ['节奏']);
  assert.equal(context.priorReviewIssue, '结尾需要明确下一步行动');
  assert.equal('referenceSample' in context, false);
});

test('normalizes revision requests and rejects blank feedback', () => {
  assert.equal(createRevisionRequest({ feedback: '   ' }), null);

  const request = createRevisionRequest({
    feedback: '增加人物在空间中的具体动作',
    chapterId: 'ch-001',
    sceneId: 'ch-001-scene-001',
    category: '动作',
    scope: 'scene_only',
  });

  assert.deepEqual(request, {
    target: { chapterId: 'ch-001', sceneId: 'ch-001-scene-001' },
    category: '动作',
    scope: 'scene_only',
    problem: '增加人物在空间中的具体动作',
    mustChange: ['增加人物在空间中的具体动作'],
    mustKeep: ['当前场景的剧情结果', '已确认的世界观事实'],
    doNotChange: ['下一场的悬念', '章节整体结构'],
  });
});
