export const NOVEL_STYLE_DIMENSIONS = [
  { id: '节奏', label: '短段落推进，句群长短交替' },
  { id: '环境描写', label: '环境变化参与人物判断' },
  { id: '情绪表达', label: '优先通过动作和环境间接呈现' },
  { id: '对白节奏', label: '对白留有停顿，并用动作承接' },
] as const;

export type NovelStyleDimension = (typeof NOVEL_STYLE_DIMENSIONS)[number]['id'];
export type NovelStageId = 'reference' | 'outline' | 'draft' | 'review' | 'memory';

export type NovelWorkflowInput = {
  premise: string;
  genre?: string;
  tone?: string;
  keywords?: string[];
  referenceTitle?: string;
  referenceSample?: string;
  styleDimensions?: string[];
  delayMs?: number;
};

export type NovelWorkflowEvent = {
  type: 'stage-start' | 'stage-complete' | 'rework-start';
  stage: NovelStageId;
  round: number;
  nextStage?: NovelStageId;
  data?: unknown;
};

export type ReferenceAnalysis = {
  title: string;
  referenceBible: {
    structure: string;
    pacing: string;
    motifs: string[];
  };
  referenceStyleProfile: {
    enabled: NovelStyleDimension[];
    dimensions: readonly { id: NovelStyleDimension; label: string }[];
    safetyNote: string;
  };
  enabledDimensions: NovelStyleDimension[];
};

export type NovelOutline = {
  hook: string;
  logline: string;
  setting: string;
  cast: { name: string; role: string; note: string }[];
  beats: string[];
  chapters: { label: string; count: number }[];
  referenceNote: string;
  mustKeep: string[];
  mustAvoid: string[];
  approvalStatus: '待用户确认';
};

export type NovelDraft = {
  title: string;
  subtitle: string;
  paragraphs: string[];
  wordCount: number;
  revision: number;
  sourceHook: string;
  styleApplied: string;
  styleDimensions: NovelStyleDimension[];
};

export type NovelReviewCategory = {
  label: string;
  status: 'pass' | 'warn';
  detail: string;
};

export type NovelReview = {
  round: number;
  pass: boolean;
  score: number;
  summary: string;
  issues: string[];
  categories: {
    quality: NovelReviewCategory;
    style: NovelReviewCategory;
    originality: NovelReviewCategory;
  };
  checks: { label: string; status: 'pass' | 'warn' }[];
};

export type NovelPlan = {
  reference: ReferenceAnalysis;
  outline: NovelOutline;
};

export type NovelWritingResult = {
  draft: NovelDraft;
  review: NovelReview;
  memorySync: {
    status: '同步完成';
    updated: string[];
  };
  attempts: number;
};

const DEFAULT_DELAY = 420;
const DEFAULT_STYLE_DIMENSIONS: NovelStyleDimension[] = ['节奏', '环境描写'];
const DEFAULT_REFERENCE_SAMPLE = '潮气贴在窗上，灯光像一枚迟到的针。';

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function normalizeInput(input: NovelWorkflowInput) {
  const knownDimensions = new Set<string>(NOVEL_STYLE_DIMENSIONS.map((item) => item.id));
  const selectedDimensions = (input.styleDimensions ?? []).filter(
    (dimension): dimension is NovelStyleDimension => knownDimensions.has(dimension),
  );

  return {
    premise: input.premise?.trim() || '一个年轻人收到一封来自未来的信',
    genre: input.genre || '悬疑',
    tone: input.tone || '克制·文学感',
    keywords: input.keywords?.filter(Boolean) ?? [],
    referenceTitle: input.referenceTitle?.trim() || '海雾样例',
    referenceSample: input.referenceSample?.trim() || DEFAULT_REFERENCE_SAMPLE,
    styleDimensions: selectedDimensions.length ? selectedDimensions : DEFAULT_STYLE_DIMENSIONS,
    delayMs: Number.isFinite(input.delayMs) ? Math.max(0, input.delayMs ?? DEFAULT_DELAY) : DEFAULT_DELAY,
  };
}

async function runStage<T>(
  stage: NovelStageId,
  round: number,
  delayMs: number,
  produce: () => T,
  emit: (event: NovelWorkflowEvent) => void,
) {
  emit({ type: 'stage-start', stage, round });
  await sleep(delayMs);
  const data = produce();
  emit({ type: 'stage-complete', stage, round, data });
  return data;
}

export function createReferenceAnalysis(input: NovelWorkflowInput): ReferenceAnalysis {
  const normalized = normalizeInput(input);

  return {
    title: normalized.referenceTitle,
    referenceBible: {
      structure: '以异常线索切入，通过环境变化逐步释放旧案。',
      pacing: '短段落推进，在章节结尾保留下一步行动。',
      motifs: ['潮气', '灯光', '迟到的消息'],
    },
    referenceStyleProfile: {
      enabled: normalized.styleDimensions,
      dimensions: NOVEL_STYLE_DIMENSIONS,
      safetyNote: '只使用抽象特征，不复制原文句子或独特比喻。',
    },
    enabledDimensions: normalized.styleDimensions,
  };
}

export function createNovelOutline(
  input: NovelWorkflowInput,
  reference: ReferenceAnalysis = createReferenceAnalysis(input),
): NovelOutline {
  const normalized = normalizeInput(input);
  const keywordText = normalized.keywords.length ? normalized.keywords.join('、') : '旧信、灯塔、选择';
  const premise = normalized.premise.replace(/^在/, '');

  return {
    hook: `当${premise}发生时，主角发现这并不是一场偶然，而是一场被人等待了很久的相遇。`,
    logline: `一段关于${normalized.premise}的${normalized.genre}故事，在${keywordText}之间展开。`,
    setting: '沿海小城与一座常年亮灯的旧灯塔，时间线在当下与记忆之间来回切换。',
    cast: [
      { name: '林砚', role: '主角', note: '习惯先观察再行动，害怕面对被隐瞒的真相。' },
      { name: '沈遥', role: '关键人物', note: '留下线索的人，始终比主角早一步看见危险。' },
      { name: '灯塔守夜人', role: '悬念角色', note: '知道旧信的来处，却拒绝解释最后一句话。' },
    ],
    beats: [
      '第一章：异常来信打破主角原本平静的生活',
      '第二章：线索指向被尘封的灯塔与一段旧案',
      '第三章：主角发现自己也是信中故事的一部分',
      '第四章：真相与代价同时抵达，必须做出选择',
    ],
    referenceNote: `已吸收参考样例的${reference.enabledDimensions.join('、')}特征，未使用原文表达。`,
    approvalStatus: '待用户确认',
    chapters: [
      { label: '第一卷  海雾之下', count: 4 },
      { label: '第二卷  深海回声', count: 5 },
      { label: '尾声  新的航向', count: 1 },
    ],
    mustKeep: ['主角先观察再行动的行为逻辑', '灯塔与旧信共同推动主线'],
    mustAvoid: ['未经确认改变人物关系', '直接复制参考样例的独特表达'],
  };
}

export function createNovelDraft(
  input: NovelWorkflowInput,
  outline: NovelOutline,
  reference: ReferenceAnalysis,
  rewrite = false,
  review: NovelReview | null = null,
): NovelDraft {
  const normalized = normalizeInput(input);
  const title = rewrite ? '灯塔的来信·回声' : '灯塔的来信';
  const repairLine = rewrite
    ? '他终于明白，真正需要回答的并不是信上的问题，而是自己为何一直假装没有看见那道光。'
    : '他把信折回口袋，告诉自己明天再去灯塔，却没有注意到窗外的雾正在向屋里漫。';
  const feedbackLine = review ? `复核意见已吸收：${review.issues[0]}` : '';
  const paragraphs = [
    `海风从街的尽头吹来，带着盐和潮湿的铁锈味。${normalized.premise}，原本只该是一句无法证实的传闻，却在今天清晨变成了林砚手里那张薄薄的纸。`,
    '信纸没有署名，只有一行像被海水泡过的字：如果你看见灯亮起，请不要回头。林砚读了三遍，仍然觉得那句话像是写给另一个人。',
    `远处的灯塔在白昼里沉默着，塔顶的玻璃被雾擦成一团模糊的银。${normalized.tone}的空气里，旧案留下的名字一个个浮上来，像水面下正在换气的鱼。`,
    repairLine,
    feedbackLine,
  ].filter(Boolean);

  return {
    title,
    subtitle: '第一章  灯塔的来信',
    paragraphs,
    wordCount: paragraphs.join('').length,
    revision: rewrite ? 2 : 1,
    sourceHook: outline.hook,
    styleApplied: `作者风格优先，按需借鉴${reference.referenceStyleProfile.enabled.join('、')}。`,
    styleDimensions: reference.referenceStyleProfile.enabled,
  };
}

export function createNovelReview(
  draft: NovelDraft,
  round: 1 | 2,
  reference: ReferenceAnalysis,
): NovelReview {
  const categories = {
    quality: {
      label: '质量',
      status: round === 1 ? 'warn' : 'pass',
      detail: round === 1 ? '结尾需要更明确的行动牵引' : '逻辑、人物和章节牵引已达标',
    } as NovelReviewCategory,
    style: {
      label: '风格漂移',
      status: 'pass',
      detail: `作者风格优先，已执行${reference.referenceStyleProfile.enabled.join('、')}参考特征`,
    } as NovelReviewCategory,
    originality: {
      label: '原创性',
      status: 'pass',
      detail: '未发现对参考样例的具体句子或事件序列复用',
    } as NovelReviewCategory,
  };

  if (round === 1) {
    return {
      round,
      pass: false,
      score: 76,
      summary: '基础氛围成立，但结尾还缺少能推动读者继续阅读的明确牵引。',
      issues: ['结尾悬念不足，主角的下一步行动还不够具体'],
      categories,
      checks: [
        { label: '情节逻辑', status: 'pass' },
        { label: '人物设定', status: 'pass' },
        { label: '风格漂移', status: 'pass' },
        { label: '原创性', status: 'pass' },
        { label: '章节牵引', status: 'warn' },
      ],
    };
  }

  return {
    round,
    pass: true,
    score: 92,
    summary: '复核通过。结尾已经补上行动动机，第一章具备继续连载的牵引力。',
    issues: ['已补强结尾悬念，并明确主角下一章将前往灯塔'],
    categories,
    checks: [
      { label: '情节逻辑', status: 'pass' },
      { label: '人物设定', status: 'pass' },
      { label: '风格漂移', status: 'pass' },
      { label: '原创性', status: 'pass' },
      { label: '章节牵引', status: 'pass' },
    ],
  };
}

export async function runReferencePlan(
  input: NovelWorkflowInput,
  emit: (event: NovelWorkflowEvent) => void = () => {},
): Promise<NovelPlan> {
  const normalized = normalizeInput(input);
  const reference = await runStage('reference', 1, normalized.delayMs, () => createReferenceAnalysis(normalized), emit);
  const outline = await runStage('outline', 1, normalized.delayMs, () => createNovelOutline(normalized, reference), emit);
  return { reference, outline };
}

export async function runWritingReview(
  input: NovelWorkflowInput,
  plan: NovelPlan,
  emit: (event: NovelWorkflowEvent) => void = () => {},
): Promise<NovelWritingResult> {
  const normalized = normalizeInput(input);
  let draft = await runStage(
    'draft',
    1,
    normalized.delayMs,
    () => createNovelDraft(normalized, plan.outline, plan.reference),
    emit,
  );
  let review = await runStage(
    'review',
    1,
    normalized.delayMs,
    () => createNovelReview(draft, 1, plan.reference),
    emit,
  );

  if (!review.pass) {
    emit({ type: 'rework-start', stage: 'review', nextStage: 'draft', round: 2, data: review });
    draft = await runStage(
      'draft',
      2,
      normalized.delayMs,
      () => createNovelDraft(normalized, plan.outline, plan.reference, true, review),
      emit,
    );
    review = await runStage(
      'review',
      2,
      normalized.delayMs,
      () => createNovelReview(draft, 2, plan.reference),
      emit,
    );
  }

  const memorySync = await runStage(
    'memory',
    1,
    normalized.delayMs,
    () => ({
      status: '同步完成' as const,
      updated: ['章节摘要', '人物状态', '风格检查记录'],
    }),
    emit,
  );

  return { draft, review, memorySync, attempts: review.round };
}
