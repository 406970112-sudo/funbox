import type {
  NovelDraft,
  NovelOutline,
  NovelStyleDimension,
} from './novel-agent-workflow.ts';

export const NOVEL_REVISION_CATEGORIES = ['人物', '动作', '环境', '对白', '节奏', '文风'] as const;
export type NovelRevisionCategory = (typeof NOVEL_REVISION_CATEGORIES)[number];

export const NOVEL_REVISION_SCOPES = ['sentence', 'scene_only', 'chapter_preserve_structure'] as const;
export type NovelRevisionScope = (typeof NOVEL_REVISION_SCOPES)[number];

export type NovelChapterCard = {
  chapterId: string;
  label: string;
  goal: string;
  beat: string;
  sceneIds: string[];
  mustKeep: string[];
  mustAvoid: string[];
  targetEnding: string;
};

export type NovelSceneCard = {
  sceneId: string;
  chapterId: string;
  label: string;
  goal: string;
  conflict: string;
  characters: string[];
  setting: string;
  mustKeep: string[];
  mustAvoid: string[];
  targetEnding: string;
};

export type NovelMemoryState = {
  version: number;
  canonicalFacts: string[];
  characterStates: { name: string; state: string }[];
  timeline: string[];
  openThreads: string[];
};

export type NovelWritingContext = {
  outline: Pick<NovelOutline, 'logline' | 'setting' | 'cast' | 'mustKeep' | 'mustAvoid'>;
  chapter: NovelChapterCard;
  scene: NovelSceneCard;
  memory: NovelMemoryState;
  styleDimensions: NovelStyleDimension[];
  priorReviewIssue?: string;
};

export type NovelRevisionRequest = {
  target: { chapterId: string; sceneId: string };
  category: NovelRevisionCategory;
  scope: NovelRevisionScope;
  problem: string;
  mustChange: string[];
  mustKeep: string[];
  doNotChange: string[];
};

export type NovelRevisionRecord = {
  revision: number;
  revisionId: string;
  title: string;
  subtitle: string;
  paragraphs: string[];
  wordCount: number;
  request: NovelRevisionRequest | null;
};

function createChapterId(index: number) {
  return `ch-${String(index + 1).padStart(3, '0')}`;
}

function createSceneId(chapterId: string, index: number) {
  return `${chapterId}-scene-${String(index + 1).padStart(3, '0')}`;
}

export function createChapterCards(outline: NovelOutline): NovelChapterCard[] {
  return outline.chapters.map((chapter, index) => {
    const chapterId = createChapterId(index);
    const beat = outline.beats[index] ?? outline.beats.at(-1) ?? outline.logline;
    const sceneCount = Math.max(1, Math.min(chapter.count, 3));

    return {
      chapterId,
      label: chapter.label,
      goal: `完成${beat}`,
      beat,
      sceneIds: Array.from({ length: sceneCount }, (_, sceneIndex) => createSceneId(chapterId, sceneIndex)),
      mustKeep: [outline.logline, '已确认的人物关系与世界观事实'],
      mustAvoid: ['改变已确认的总体架构', '复制参考作品的原文表达'],
      targetEnding: '留下一个具体的下一步行动或新问题',
    };
  });
}

export function createSceneCards(chapter: NovelChapterCard): NovelSceneCard[] {
  return chapter.sceneIds.map((sceneId, index) => {
    const sceneNumber = index + 1;
    const isFinalScene = sceneNumber === chapter.sceneIds.length;

    return {
      sceneId,
      chapterId: chapter.chapterId,
      label: `${chapter.label} · 场景 ${sceneNumber}`,
      goal: sceneNumber === 1 ? `建立${chapter.goal}的行动入口` : `推进${chapter.goal}`,
      conflict: isFinalScene ? '人物必须面对新的选择，并让下一步行动变得不可回避' : '人物的目标受到线索、环境或关系的阻碍',
      characters: ['林砚', '沈遥'],
      setting: '沿海小城与常年亮灯的旧灯塔',
      mustKeep: chapter.mustKeep,
      mustAvoid: chapter.mustAvoid,
      targetEnding: isFinalScene ? chapter.targetEnding : '让线索或人物选择推动下一场景',
    };
  });
}

export function createInitialMemoryState(outline: NovelOutline): NovelMemoryState {
  return {
    version: 1,
    canonicalFacts: [outline.setting, `主线：${outline.logline}`],
    characterStates: outline.cast.map((person) => ({ name: person.name, state: person.note })),
    timeline: [],
    openThreads: outline.beats,
  };
}

export function assembleWritingContext({
  outline,
  chapter,
  scene,
  memory,
  styleDimensions,
  priorReviewIssue,
}: {
  outline: NovelOutline;
  chapter: NovelChapterCard;
  scene: NovelSceneCard;
  memory: NovelMemoryState;
  styleDimensions: NovelStyleDimension[];
  priorReviewIssue?: string;
}): NovelWritingContext {
  return {
    outline: {
      logline: outline.logline,
      setting: outline.setting,
      cast: outline.cast,
      mustKeep: outline.mustKeep,
      mustAvoid: outline.mustAvoid,
    },
    chapter,
    scene,
    memory: {
      version: memory.version,
      canonicalFacts: memory.canonicalFacts,
      characterStates: memory.characterStates,
      timeline: memory.timeline,
      openThreads: memory.openThreads,
    },
    styleDimensions,
    ...(priorReviewIssue ? { priorReviewIssue } : {}),
  };
}

export function createRevisionRequest({
  feedback,
  chapterId,
  sceneId,
  category = '文风',
  scope = 'scene_only',
}: {
  feedback: string;
  chapterId?: string;
  sceneId?: string;
  category?: string;
  scope?: string;
}): NovelRevisionRequest | null {
  const problem = feedback.trim();
  if (!problem || !chapterId || !sceneId) return null;

  const normalizedCategory = NOVEL_REVISION_CATEGORIES.includes(category as NovelRevisionCategory)
    ? (category as NovelRevisionCategory)
    : '文风';
  const normalizedScope = NOVEL_REVISION_SCOPES.includes(scope as NovelRevisionScope)
    ? (scope as NovelRevisionScope)
    : 'scene_only';

  return {
    target: { chapterId, sceneId },
    category: normalizedCategory,
    scope: normalizedScope,
    problem,
    mustChange: [problem],
    mustKeep: ['当前场景的剧情结果', '已确认的世界观事实'],
    doNotChange: ['下一场的悬念', '章节整体结构'],
  };
}

export function reviseNovelDraft(
  draft: NovelDraft,
  request: NovelRevisionRequest | null,
  context: NovelWritingContext,
): NovelDraft {
  if (!request || request.target.sceneId !== context.scene.sceneId) return draft;

  const nextRevision = draft.revision + 1;
  const revisionId = `rev-${String(nextRevision).padStart(3, '0')}`;
  const revisedParagraphs = draft.paragraphs.map((paragraph, index) => (
    index === draft.paragraphs.length - 1
      ? `${paragraph}（${request.category}返工：${request.problem}）`
      : paragraph
  ));
  const record: NovelRevisionRecord = {
    revision: draft.revision,
    revisionId: draft.activeRevisionId,
    title: draft.title,
    subtitle: draft.subtitle,
    paragraphs: draft.paragraphs,
    wordCount: draft.wordCount,
    request: draft.lastRevisionRequest,
  };

  return {
    ...draft,
    paragraphs: revisedParagraphs,
    wordCount: revisedParagraphs.join('').length,
    revision: nextRevision,
    activeRevisionId: revisionId,
    revisionHistory: [...draft.revisionHistory, record],
    lastRevisionRequest: request,
  };
}
