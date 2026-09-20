import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  assembleWritingContext,
  createChapterCards,
  createInitialMemoryState,
  createRevisionRequest,
  createSceneCards,
  reviseNovelDraft,
  type NovelRevisionCategory,
  type NovelRevisionScope,
} from '@/lib/novel-agent-artifacts';
import { getNovelAgentLayout } from '@/lib/novel-agent-layout';
import { aggregateReviewChecks, runReviewChecks } from '@/lib/novel-agent-review';
import {
  NOVEL_STYLE_DIMENSIONS,
  runReferencePlan,
  runWritingReview,
  type NovelDraft,
  type NovelOutline,
  type NovelPlan,
  type NovelReview,
  type NovelStageId,
  type NovelStyleDimension,
  type ReferenceAnalysis,
} from '@/lib/novel-agent-workflow';
import { MobileScreen } from '@/shared/ui/mobile-screen';
import { PageHeader } from '@/shared/ui/page-header';
import { SurfaceCard } from '@/shared/ui/surface-card';

type StageStatus = 'idle' | 'running' | 'complete';
type WorkflowPhase = 'idle' | 'planning' | 'awaiting-approval' | 'writing' | 'complete';

type FormState = {
  premise: string;
  genre: string;
  tone: string;
  keywords: string;
  referenceTitle: string;
  referenceSample: string;
  styleDimensions: NovelStyleDimension[];
};

const DEFAULT_FORM: FormState = {
  premise: '在一个被遗忘的海岛上，年轻的灯塔守夜人发现了一封来自二十年前的信。',
  genre: '悬疑',
  tone: '克制·文学感',
  keywords: '海岛, 灯塔, 旧信',
  referenceTitle: '海雾样例',
  referenceSample: '潮气贴在窗上，灯光像一枚迟到的针。',
  styleDimensions: ['节奏', '环境描写'],
};

const STAGES: { id: NovelStageId; letter: string; name: string; caption: string }[] = [
  { id: 'reference', letter: 'R', name: '参考分析', caption: '提炼方法' },
  { id: 'outline', letter: 'A', name: '结构策划', caption: '用户确认' },
  { id: 'draft', letter: 'B', name: '正文写作', caption: '生成章节' },
  { id: 'review', letter: 'C', name: '复核编辑', caption: '三线复核' },
];

const EMPTY_STAGES: Record<NovelStageId, StageStatus> = {
  reference: 'idle',
  outline: 'idle',
  draft: 'idle',
  review: 'idle',
  memory: 'idle',
};

export function NovelAgentScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { width } = useWindowDimensions();
  const layout = getNovelAgentLayout(width);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [stages, setStages] = useState(EMPTY_STAGES);
  const [phase, setPhase] = useState<WorkflowPhase>('idle');
  const [reference, setReference] = useState<ReferenceAnalysis | null>(null);
  const [outline, setOutline] = useState<NovelOutline | null>(null);
  const [draft, setDraft] = useState<NovelDraft | null>(null);
  const [review, setReview] = useState<NovelReview | null>(null);
  const [memorySync, setMemorySync] = useState<{ status: string; updated: string[] } | null>(null);
  const [revisionFeedback, setRevisionFeedback] = useState('');
  const [revisionCategory, setRevisionCategory] = useState<NovelRevisionCategory>('环境');
  const [revisionScope, setRevisionScope] = useState<NovelRevisionScope>('scene_only');
  const [error, setError] = useState('');

  const isBusy = phase === 'planning' || phase === 'writing';
  const plan: NovelPlan | null = reference && outline ? (() => {
    const chapterCards = createChapterCards(outline);
    return {
      reference,
      outline,
      chapterCards,
      sceneCards: chapterCards.flatMap((chapter) => createSceneCards(chapter)),
      memory: createInitialMemoryState(outline),
    };
  })() : null;
  const completedStages = STAGES.filter((stage) => stages[stage.id] === 'complete').length;
  const progress = Math.round((completedStages / STAGES.length) * 100);

  function updateForm<Key extends keyof FormState>(key: Key, value: FormState[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function handleEvent(event: { type: string; stage: NovelStageId; data?: unknown }) {
    if (event.type === 'stage-start' && event.stage !== 'memory') {
      setStages((current) => ({ ...current, [event.stage]: 'running' }));
      return;
    }

    if (event.type === 'rework-start') {
      setStages((current) => ({ ...current, draft: 'running', review: 'idle' }));
      return;
    }

    if (event.type !== 'stage-complete') return;

    if (event.stage !== 'memory') {
      setStages((current) => ({ ...current, [event.stage]: 'complete' }));
    }

    if (event.stage === 'reference') setReference(event.data as ReferenceAnalysis);
    if (event.stage === 'outline') setOutline(event.data as NovelOutline);
    if (event.stage === 'draft') setDraft(event.data as NovelDraft);
    if (event.stage === 'review') setReview(event.data as NovelReview);
    if (event.stage === 'memory') setMemorySync(event.data as { status: string; updated: string[] });
  }

  async function handleAnalyze() {
    if (isBusy) return;

    setError('');
    setPhase('planning');
    setStages(EMPTY_STAGES);
    setReference(null);
    setOutline(null);
    setDraft(null);
    setReview(null);
    setMemorySync(null);

    try {
      await runReferencePlan(toWorkflowInput(form), handleEvent);
      setPhase('awaiting-approval');
    } catch (workflowError) {
      setPhase('idle');
      setError(workflowError instanceof Error ? workflowError.message : '参考分析失败，请重试。');
    }
  }

  async function handleApprove() {
    if (isBusy || !plan) return;

    setError('');
    setPhase('writing');

    try {
      const result = await runWritingReview(toWorkflowInput(form), plan, handleEvent);
      setDraft(result.draft);
      setReview(result.review);
      setMemorySync(result.memorySync);
      setPhase('complete');
    } catch (workflowError) {
      setPhase('awaiting-approval');
      setError(workflowError instanceof Error ? workflowError.message : '写作流程失败，请重试。');
    }
  }

  async function handleRevision() {
    if (isBusy || !draft || !plan) return;

    const chapter = plan.chapterCards.find((candidate) => candidate.chapterId === draft.sceneId.split('-scene-')[0]) ?? plan.chapterCards[0];
    const scene = plan.sceneCards.find((candidate) => candidate.sceneId === draft.sceneId) ?? plan.sceneCards[0];
    const context = assembleWritingContext({
      outline: plan.outline,
      chapter,
      scene,
      memory: plan.memory,
      styleDimensions: toWorkflowInput(form).styleDimensions,
      priorReviewIssue: review?.issueDetails[0]?.message,
    });
    const request = createRevisionRequest({
      feedback: revisionFeedback,
      chapterId: chapter.chapterId,
      sceneId: scene.sceneId,
      category: revisionCategory,
      scope: revisionScope,
    });

    if (!request) {
      setError('请先写下具体修改意见，再让 B 返工。');
      return;
    }

    setError('');
    setPhase('writing');
    const revisedDraft = reviseNovelDraft(draft, request, context);
    const checks = await runReviewChecks({ draft: revisedDraft, context, reference: plan.reference, round: 2 });
    setDraft(revisedDraft);
    setReview(aggregateReviewChecks(checks, 2));
    setRevisionFeedback('');
    setPhase('complete');
  }

  function handleReset() {
    setForm(DEFAULT_FORM);
    setStages(EMPTY_STAGES);
    setPhase('idle');
    setReference(null);
    setOutline(null);
    setDraft(null);
    setReview(null);
    setMemorySync(null);
    setRevisionFeedback('');
    setRevisionCategory('环境');
    setRevisionScope('scene_only');
    setError('');
  }

  function toggleDimension(dimension: NovelStyleDimension) {
    const selected = form.styleDimensions.includes(dimension);
    updateForm(
      'styleDimensions',
      selected
        ? form.styleDimensions.filter((item) => item !== dimension)
        : [...form.styleDimensions, dimension],
    );
  }

  const phaseCopy = {
    idle: '先分析参考样例，再和 A 确认架构。',
    planning: 'R 正在提炼参考结构与描述方法……',
    'awaiting-approval': 'A 已形成架构，确认后才会交给 B。',
    writing: 'B 正在写作，C 会继续复核并在必要时让 B 返工。',
    complete: '本章已通过复核，故事记忆也已同步。',
  }[phase];

  return (
    <MobileScreen
      contentContainerStyle={[
        styles.pageContent,
        layout.isDesktop && [
          styles.desktopPageContent,
          {
            maxWidth: layout.contentMaxWidth,
            paddingHorizontal: layout.pagePadding,
          },
        ],
      ]}>
      <PageHeader
        eyebrow="Multi-agent novel workflow"
        title="小说工坊"
        subtitle="参考方法，确认架构，再交给笔手完成正文。"
        rightSlot={
          <Pressable accessibilityLabel="返回工具" onPress={() => router.back()} style={styles.iconButton}>
            <MaterialCommunityIcons name="arrow-left" size={20} color={colors.text} />
          </Pressable>
        }
      />

      <View style={[styles.hero, { backgroundColor: colors.hero }]}>
        <View style={styles.heroHeader}>
          <View style={[styles.heroIcon, { backgroundColor: colors.accent }]}>
            <MaterialCommunityIcons name="book-open-page-variant-outline" size={22} color={colors.hero} />
          </View>
          <View style={styles.heroCopy}>
            <ThemedText style={styles.heroEyebrow}>R → A → B → C</ThemedText>
            <ThemedText style={styles.heroTitle}>让笔风成为可维护的资产</ThemedText>
          </View>
        </View>
        <ThemedText style={styles.heroBody}>
          R 只提炼参考作品的高层方法，A 和你锁定原创架构，B 才开始写，C 负责质量、风格与原创性复核。
        </ThemedText>
        <View style={styles.heroTags}>
          {['参考抽象', '用户确认', '定向返工'].map((tag) => (
            <View key={tag} style={styles.heroTag}>
              <ThemedText style={styles.heroTagText}>{tag}</ThemedText>
            </View>
          ))}
        </View>
      </View>

      <View style={[styles.workspace, layout.isDesktop && styles.desktopWorkspace, { columnGap: layout.columnGap }]}>
        <View style={[styles.column, layout.isDesktop && styles.primaryColumn]}>
          <SurfaceCard style={styles.briefCard}>
        <SectionHeader icon="text-box-edit-outline" title="故事与参考" meta="输入少量样例，R 不会把原文直接交给 B" />
        <FieldLabel label="故事主题 / 概梗" />
        <TextInput
          multiline
          onChangeText={(value) => updateForm('premise', value)}
          placeholder="描述你的故事起点"
          placeholderTextColor={colors.mutedText}
          style={[styles.textArea, { backgroundColor: colors.surfaceMuted, borderColor: colors.line, color: colors.text }]}
          value={form.premise}
        />
        <View style={styles.twoColumnFields}>
          <View style={styles.flexField}>
            <FieldLabel label="参考样例名称" />
            <TextInput
              onChangeText={(value) => updateForm('referenceTitle', value)}
              placeholder="例如：海雾样例"
              placeholderTextColor={colors.mutedText}
              style={[styles.input, { backgroundColor: colors.surfaceMuted, borderColor: colors.line, color: colors.text }]}
              value={form.referenceTitle}
            />
          </View>
          <View style={styles.flexField}>
            <FieldLabel label="题材" />
            <TextInput
              onChangeText={(value) => updateForm('genre', value)}
              placeholder="悬疑"
              placeholderTextColor={colors.mutedText}
              style={[styles.input, { backgroundColor: colors.surfaceMuted, borderColor: colors.line, color: colors.text }]}
              value={form.genre}
            />
          </View>
        </View>
        <FieldLabel label="样例片段" />
        <TextInput
          multiline
          onChangeText={(value) => updateForm('referenceSample', value)}
          placeholder="粘贴少量样例，R 只提炼抽象笔法"
          placeholderTextColor={colors.mutedText}
          style={[styles.sampleArea, { backgroundColor: colors.surfaceMuted, borderColor: colors.line, color: colors.text }]}
          value={form.referenceSample}
        />
        <FieldLabel label="允许借鉴的笔法维度" />
        <View style={styles.dimensionRow}>
          {NOVEL_STYLE_DIMENSIONS.map((dimension) => {
            const selected = form.styleDimensions.includes(dimension.id);
            return (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
                key={dimension.id}
                onPress={() => toggleDimension(dimension.id)}
                style={[
                  styles.dimensionChip,
                  { backgroundColor: selected ? colors.primarySoft : colors.surfaceMuted, borderColor: selected ? colors.primary : colors.line },
                ]}>
                <ThemedText style={[styles.dimensionText, { color: selected ? colors.primary : colors.mutedText }]}>
                  {dimension.id}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
        <Pressable
          accessibilityRole="button"
          disabled={isBusy}
          onPress={handleAnalyze}
          style={({ pressed }) => [styles.primaryButton, { backgroundColor: colors.primary, opacity: pressed || isBusy ? 0.72 : 1 }]}>
          {phase === 'planning' ? <ActivityIndicator color="#ffffff" size="small" /> : <MaterialCommunityIcons name="radar" size={18} color="#ffffff" />}
          <ThemedText style={styles.primaryButtonText}>{phase === 'planning' ? '正在分析参考样例' : '分析参考并生成架构'}</ThemedText>
        </Pressable>
        {phase !== 'idle' ? (
          <Pressable disabled={isBusy} onPress={handleReset} style={styles.resetButton}>
            <ThemedText style={[styles.resetButtonText, { color: colors.mutedText }]}>重置这次体验</ThemedText>
          </Pressable>
        ) : null}
          </SurfaceCard>
          {layout.isDesktop && reference ? <ReferenceCard reference={reference} colors={colors} /> : null}
          {layout.isDesktop && outline ? <OutlineCard outline={outline} colors={colors} canApprove={phase === 'awaiting-approval'} onApprove={handleApprove} /> : null}
          {layout.isDesktop && plan ? <StoryCardsCard plan={plan} colors={colors} /> : null}
        </View>

        <View style={[styles.column, layout.isDesktop && styles.secondaryColumn]}>
          <SurfaceCard style={styles.pipelineCard}>
        <SectionHeader icon="source-branch" title="自动编排" meta={phaseCopy} />
        <View style={styles.progressHeader}>
          <ThemedText style={[styles.progressLabel, { color: colors.mutedText }]}>当前进度</ThemedText>
          <ThemedText style={[styles.progressValue, { color: colors.primary }]}>{progress}%</ThemedText>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { backgroundColor: colors.primary, width: `${progress}%` }]} />
        </View>
        <View style={styles.stageRow}>
          {STAGES.map((stage, index) => (
            <View key={stage.id} style={styles.stageSlot}>
              <StageItem stage={stage} status={stages[stage.id]} colors={colors} />
              {index < STAGES.length - 1 ? (
                <View style={[styles.connector, { backgroundColor: stages[stage.id] === 'complete' ? colors.success : colors.line }]} />
              ) : null}
            </View>
          ))}
        </View>
        {stages.draft === 'running' ? <ThemedText style={[styles.loopNote, { color: colors.accent }]}>C → B · 正在执行定向返工</ThemedText> : null}
        {reference?.referenceStyleProfile ? (
          <View style={[styles.flowSummary, { backgroundColor: colors.surfaceMuted }]}>
            <MaterialCommunityIcons name="check-decagram-outline" size={16} color={colors.success} />
            <ThemedText style={[styles.flowSummaryText, { color: colors.mutedText }]}>
              已启用：{reference.referenceStyleProfile.enabled.join(' · ')} · 作者风格优先
            </ThemedText>
          </View>
        ) : null}
      </SurfaceCard>
          {layout.isDesktop && draft ? <DraftCard draft={draft} colors={colors} /> : null}
          {layout.isDesktop && draft && plan ? <RevisionCard draft={draft} plan={plan} feedback={revisionFeedback} category={revisionCategory} scope={revisionScope} onFeedbackChange={setRevisionFeedback} onCategoryChange={setRevisionCategory} onScopeChange={setRevisionScope} onSubmit={handleRevision} disabled={isBusy} colors={colors} /> : null}
          {layout.isDesktop && review ? <ReviewCard review={review} memorySync={memorySync} colors={colors} /> : null}
        </View>
      </View>

      {!layout.isDesktop ? (
        <>
          {reference ? <ReferenceCard reference={reference} colors={colors} /> : null}
          {outline ? <OutlineCard outline={outline} colors={colors} canApprove={phase === 'awaiting-approval'} onApprove={handleApprove} /> : null}
          {plan ? <StoryCardsCard plan={plan} colors={colors} /> : null}
          {draft ? <DraftCard draft={draft} colors={colors} /> : null}
          {draft && plan ? <RevisionCard draft={draft} plan={plan} feedback={revisionFeedback} category={revisionCategory} scope={revisionScope} onFeedbackChange={setRevisionFeedback} onCategoryChange={setRevisionCategory} onScopeChange={setRevisionScope} onSubmit={handleRevision} disabled={isBusy} colors={colors} /> : null}
          {review ? <ReviewCard review={review} memorySync={memorySync} colors={colors} /> : null}
        </>
      ) : null}

      {error ? (
        <View style={[styles.errorCard, { backgroundColor: `${colors.accent}18`, borderColor: `${colors.accent}50` }]}>
          <MaterialCommunityIcons name="alert-circle-outline" size={18} color={colors.accent} />
          <ThemedText style={[styles.errorText, { color: colors.text }]}>{error}</ThemedText>
        </View>
      ) : null}

      <ThemedText style={[styles.demoNote, { color: colors.mutedText }]}>当前为本地演示工作流，不消耗 API；后续可接入真实模型 Provider。</ThemedText>
    </MobileScreen>
  );
}

function toWorkflowInput(form: FormState) {
  return {
    ...form,
    keywords: form.keywords.split(/[,，]/).map((item) => item.trim()).filter(Boolean),
    delayMs: 420,
  };
}

function SectionHeader({ icon, title, meta }: { icon: string; title: string; meta: string }) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.sectionHeader}>
      <View style={[styles.sectionIcon, { backgroundColor: colors.primarySoft }]}>
        <MaterialCommunityIcons name={icon as never} size={18} color={colors.primary} />
      </View>
      <View style={styles.sectionHeaderCopy}>
        <ThemedText style={styles.sectionTitle}>{title}</ThemedText>
        <ThemedText style={[styles.sectionMeta, { color: colors.mutedText }]}>{meta}</ThemedText>
      </View>
    </View>
  );
}

function FieldLabel({ label }: { label: string }) {
  const { colors } = useAppTheme();
  return <ThemedText style={[styles.fieldLabel, { color: colors.mutedText }]}>{label}</ThemedText>;
}

function StageItem({
  stage,
  status,
  colors,
}: {
  stage: (typeof STAGES)[number];
  status: StageStatus;
  colors: ReturnType<typeof useAppTheme>['colors'];
}) {
  const statusText = status === 'complete' ? '完成' : status === 'running' ? '处理中' : stage.caption;
  return (
    <View style={styles.stageItem}>
      <View style={[styles.stageCircle, { backgroundColor: status === 'complete' ? colors.success : status === 'running' ? colors.primary : colors.surfaceMuted, borderColor: status === 'idle' ? colors.line : status === 'complete' ? colors.success : colors.primary }]}>
        {status === 'running' ? <ActivityIndicator color="#ffffff" size="small" /> : <ThemedText style={[styles.stageLetter, { color: status === 'idle' ? colors.mutedText : '#ffffff' }]}>{stage.letter}</ThemedText>}
      </View>
      <ThemedText style={styles.stageName}>{stage.name}</ThemedText>
      <ThemedText style={[styles.stageCaption, { color: status === 'complete' ? colors.success : colors.mutedText }]}>{statusText}</ThemedText>
    </View>
  );
}

function ReferenceCard({ reference, colors }: { reference: ReferenceAnalysis; colors: ReturnType<typeof useAppTheme>['colors'] }) {
  return (
    <SurfaceCard style={styles.resultCard}>
      <ResultHeader icon="R" title="参考风格卡" status="已抽象" colors={colors} />
      <View style={styles.referenceHeading}>
        <ThemedText style={styles.resultTitle}>{reference.title}</ThemedText>
        <View style={[styles.statusChip, { backgroundColor: colors.primarySoft }]}><ThemedText style={[styles.statusChipText, { color: colors.primary }]}>referenceStyleProfile</ThemedText></View>
      </View>
      <ThemedText style={[styles.resultBody, { color: colors.mutedText }]}>{reference.referenceBible.structure}</ThemedText>
      <ThemedText style={[styles.resultBody, { color: colors.mutedText }]}>{reference.referenceBible.pacing}</ThemedText>
      <View style={styles.chipRow}>
        {reference.referenceStyleProfile.enabled.map((dimension) => <View key={dimension} style={[styles.styleChip, { backgroundColor: colors.primarySoft }]}><ThemedText style={[styles.styleChipText, { color: colors.primary }]}>{dimension}</ThemedText></View>)}
      </View>
      <ThemedText style={[styles.safetyNote, { color: colors.mutedText }]}>{reference.referenceStyleProfile.safetyNote}</ThemedText>
    </SurfaceCard>
  );
}

function OutlineCard({
  outline,
  colors,
  canApprove,
  onApprove,
}: {
  outline: NovelOutline;
  colors: ReturnType<typeof useAppTheme>['colors'];
  canApprove: boolean;
  onApprove: () => void;
}) {
  return (
    <SurfaceCard style={styles.resultCard}>
      <ResultHeader icon="A" title="A 的结构方案" status={canApprove ? '待你确认' : '已交接'} colors={colors} warning={canApprove} />
      <ThemedText style={styles.resultTitle}>{outline.hook}</ThemedText>
      <ThemedText style={[styles.resultBody, { color: colors.mutedText }]}>{outline.setting}</ThemedText>
      <View style={styles.castRow}>
        {outline.cast.map((person) => <View key={person.name} style={[styles.castChip, { backgroundColor: colors.surfaceMuted }]}><ThemedText style={[styles.castChipName, { color: colors.text }]}>{person.name}</ThemedText><ThemedText style={[styles.castChipRole, { color: colors.mutedText }]}>{person.role}</ThemedText></View>)}
      </View>
      <View style={[styles.beatBox, { borderColor: colors.line }]}>
        <ThemedText style={[styles.miniLabel, { color: colors.mutedText }]}>章节节拍</ThemedText>
        {outline.beats.slice(0, 3).map((beat) => <ThemedText key={beat} style={[styles.beatText, { color: colors.text }]}>• {beat}</ThemedText>)}
      </View>
      <ThemedText style={[styles.resultHint, { color: colors.mutedText }]}>{outline.referenceNote}</ThemedText>
      {canApprove ? (
        <Pressable onPress={onApprove} style={({ pressed }) => [styles.primaryButton, { backgroundColor: colors.primary, opacity: pressed ? 0.72 : 1 }]}>
          <MaterialCommunityIcons name="lock-open-outline" size={18} color="#ffffff" />
          <ThemedText style={styles.primaryButtonText}>确认架构，交给 B</ThemedText>
        </Pressable>
      ) : (
        <View style={[styles.approvedBar, { backgroundColor: colors.primarySoft }]}><MaterialCommunityIcons name="check" size={16} color={colors.primary} /><ThemedText style={[styles.approvedText, { color: colors.primary }]}>架构已锁定，B 已开始写作</ThemedText></View>
      )}
    </SurfaceCard>
  );
}

function StoryCardsCard({ plan, colors }: { plan: NovelPlan; colors: ReturnType<typeof useAppTheme>['colors'] }) {
  return (
    <SurfaceCard style={styles.resultCard}>
      <ResultHeader icon="▦" title="章节卡与场景卡" status={`${plan.sceneCards.length} 个场景`} colors={colors} />
      <ThemedText style={[styles.resultHint, { color: colors.mutedText }]}>B 只读取当前场景卡、已确认事实和必要记忆，不读取整本参考原文。</ThemedText>
      <View style={styles.storyCardList}>
        {plan.chapterCards.map((chapter) => (
          <View key={chapter.chapterId} style={[styles.storyChapter, { backgroundColor: colors.surfaceMuted, borderColor: colors.line }]}>
            <View style={styles.storyChapterHeader}>
              <ThemedText style={styles.storyChapterTitle}>{chapter.label}</ThemedText>
              <ThemedText style={[styles.storyChapterMeta, { color: colors.primary }]}>{chapter.sceneIds.length} 场景</ThemedText>
            </View>
            <ThemedText style={[styles.storyChapterGoal, { color: colors.text }]}>{chapter.goal}</ThemedText>
            <ThemedText style={[styles.storyChapterEnding, { color: colors.mutedText }]}>结尾牵引：{chapter.targetEnding}</ThemedText>
          </View>
        ))}
      </View>
      <View style={styles.sceneChipRow}>
        {plan.sceneCards.slice(0, 5).map((scene) => (
          <View key={scene.sceneId} style={[styles.sceneChip, { borderColor: colors.line }]}>
            <ThemedText style={[styles.sceneChipText, { color: colors.mutedText }]}>{scene.label}</ThemedText>
          </View>
        ))}
      </View>
    </SurfaceCard>
  );
}

function DraftCard({ draft, colors }: { draft: NovelDraft; colors: ReturnType<typeof useAppTheme>['colors'] }) {
  return (
    <SurfaceCard style={styles.resultCard}>
      <ResultHeader icon="B" title="B 的正文" status={`第 ${draft.revision} 版`} colors={colors} />
      <View style={styles.draftMeta}><ThemedText style={styles.resultTitle}>{draft.title}</ThemedText><ThemedText style={[styles.wordCount, { color: colors.mutedText }]}>{draft.wordCount} 字</ThemedText></View>
      <View style={[styles.styleApplied, { backgroundColor: colors.surfaceMuted }]}><MaterialCommunityIcons name="palette-outline" size={16} color={colors.primary} /><ThemedText style={[styles.styleAppliedText, { color: colors.mutedText }]}>{draft.styleApplied}</ThemedText></View>
      <View style={styles.draftCopy}>
        {draft.paragraphs.map((paragraph, index) => <ThemedText key={`${draft.revision}-${index}`} style={[styles.paragraph, { color: colors.text }]}>{paragraph}</ThemedText>)}
      </View>
    </SurfaceCard>
  );
}

function RevisionCard({
  draft,
  plan,
  feedback,
  category,
  scope,
  onFeedbackChange,
  onCategoryChange,
  onScopeChange,
  onSubmit,
  disabled,
  colors,
}: {
  draft: NovelDraft;
  plan: NovelPlan;
  feedback: string;
  category: NovelRevisionCategory;
  scope: NovelRevisionScope;
  onFeedbackChange: (value: string) => void;
  onCategoryChange: (value: NovelRevisionCategory) => void;
  onScopeChange: (value: NovelRevisionScope) => void;
  onSubmit: () => void;
  disabled: boolean;
  colors: ReturnType<typeof useAppTheme>['colors'];
}) {
  const scene = plan.sceneCards.find((candidate) => candidate.sceneId === draft.sceneId) ?? plan.sceneCards[0];
  const categories: NovelRevisionCategory[] = ['人物', '动作', '环境', '对白', '节奏', '文风'];
  const scopes: { id: NovelRevisionScope; label: string }[] = [
    { id: 'sentence', label: '局部句段' },
    { id: 'scene_only', label: '当前场景' },
    { id: 'chapter_preserve_structure', label: '整章保结构' },
  ];

  return (
    <SurfaceCard style={styles.resultCard}>
      <ResultHeader icon="✎" title="让 B 定向返工" status={`当前：${scene.label}`} colors={colors} />
      <ThemedText style={[styles.resultHint, { color: colors.mutedText }]}>只修改选中场景，保留剧情结果和已确认事实。每次返工都会生成新版本。</ThemedText>
      <TextInput
        multiline
        onChangeText={onFeedbackChange}
        placeholder="例如：增加人物在空间中的具体动作，让环境变化影响人物判断"
        placeholderTextColor={colors.mutedText}
        style={[styles.revisionArea, { backgroundColor: colors.surfaceMuted, borderColor: colors.line, color: colors.text }]}
        value={feedback}
      />
      <FieldLabel label="问题类型" />
      <View style={styles.dimensionRow}>
        {categories.map((item) => (
          <Pressable key={item} onPress={() => onCategoryChange(item)} style={[styles.dimensionChip, { backgroundColor: category === item ? colors.primarySoft : colors.surfaceMuted, borderColor: category === item ? colors.primary : colors.line }]}>
            <ThemedText style={[styles.dimensionText, { color: category === item ? colors.primary : colors.mutedText }]}>{item}</ThemedText>
          </Pressable>
        ))}
      </View>
      <FieldLabel label="修改范围" />
      <View style={styles.dimensionRow}>
        {scopes.map((item) => (
          <Pressable key={item.id} onPress={() => onScopeChange(item.id)} style={[styles.dimensionChip, { backgroundColor: scope === item.id ? colors.primarySoft : colors.surfaceMuted, borderColor: scope === item.id ? colors.primary : colors.line }]}>
            <ThemedText style={[styles.dimensionText, { color: scope === item.id ? colors.primary : colors.mutedText }]}>{item.label}</ThemedText>
          </Pressable>
        ))}
      </View>
      <Pressable disabled={disabled || !feedback.trim()} onPress={onSubmit} style={({ pressed }) => [styles.primaryButton, { backgroundColor: colors.primary, opacity: disabled || !feedback.trim() || pressed ? 0.48 : 1 }]}>
        {disabled ? <ActivityIndicator color="#ffffff" size="small" /> : <MaterialCommunityIcons name="pencil-box-outline" size={18} color="#ffffff" />}
        <ThemedText style={styles.primaryButtonText}>让 B 修改当前场景</ThemedText>
      </Pressable>
      {draft.revisionHistory.length ? (
        <View style={styles.revisionHistory}>
          <ThemedText style={[styles.miniLabel, { color: colors.mutedText }]}>版本记录</ThemedText>
          {draft.revisionHistory.map((version) => <ThemedText key={version.revisionId} style={[styles.historyText, { color: colors.mutedText }]}>v{version.revision} 已保留 · {version.request?.problem ?? '初稿'}</ThemedText>)}
        </View>
      ) : null}
    </SurfaceCard>
  );
}

function ReviewCard({ review, memorySync, colors }: { review: NovelReview; memorySync: { status: string; updated: string[] } | null; colors: ReturnType<typeof useAppTheme>['colors'] }) {
  return (
    <SurfaceCard style={styles.resultCard}>
      <ResultHeader icon="C" title="C 的复核报告" status={review.pass ? '复核通过' : review.route === 'HUMAN_REVIEW' ? '人工确认' : '需要处理'} colors={colors} warning={!review.pass} />
      <View style={styles.reviewScoreRow}>
        <View style={styles.reviewScoreCopy}><ThemedText style={[styles.resultTitle, { color: review.pass ? colors.success : colors.accent }]}>{review.pass ? '可以继续连载' : '需要返工'}</ThemedText><ThemedText style={[styles.resultBody, { color: colors.mutedText }]}>{review.summary}</ThemedText></View>
        <ThemedText style={[styles.reviewScore, { color: review.pass ? colors.success : colors.accent }]}>{review.score}<ThemedText style={[styles.reviewScoreSmall, { color: colors.mutedText }]}>/100</ThemedText></ThemedText>
      </View>
      <View style={styles.categoryList}>
        {Object.values(review.categories).map((category) => <View key={category.label} style={[styles.categoryRow, { borderBottomColor: colors.line }]}><ThemedText style={[styles.categoryLabel, { color: colors.text }]}>{category.label}</ThemedText><ThemedText style={[styles.categoryStatus, { color: category.status === 'pass' ? colors.success : colors.accent }]}>{category.status === 'pass' ? '通过' : '待优化'}</ThemedText></View>)}
      </View>
      {review.issueDetails.length ? (
        <View style={[styles.issueBox, { backgroundColor: colors.surfaceMuted, borderLeftColor: colors.accent }]}>
          <ThemedText style={[styles.miniLabel, { color: colors.mutedText }]}>编辑证据</ThemedText>
          <ThemedText style={[styles.issueText, { color: colors.text }]}>{review.issueDetails[0].message}</ThemedText>
          <ThemedText style={[styles.issueMeta, { color: colors.mutedText }]}>{review.issueDetails[0].location} · {review.issueDetails[0].evidence}</ThemedText>
        </View>
      ) : (
        <View style={[styles.passBox, { backgroundColor: `${colors.success}12` }]}><MaterialCommunityIcons name="check-decagram-outline" size={16} color={colors.success} /><ThemedText style={[styles.passText, { color: colors.success }]}>四类检查均已通过，没有阻断问题。</ThemedText></View>
      )}
      <View style={styles.reviewEvidenceList}>
        {review.checkResults.map((check) => <View key={check.id} style={[styles.reviewEvidenceRow, { borderBottomColor: colors.line }]}><View style={styles.reviewEvidenceCopy}><ThemedText style={[styles.categoryLabel, { color: colors.text }]}>{check.label}</ThemedText><ThemedText style={[styles.issueMeta, { color: colors.mutedText }]}>{check.evidence}</ThemedText></View><ThemedText style={[styles.categoryStatus, { color: check.status === 'pass' ? colors.success : colors.accent }]}>{check.status === 'pass' ? '通过' : '警告'}</ThemedText></View>)}
      </View>
      {memorySync ? <View style={styles.memoryRow}><MaterialCommunityIcons name="database-check-outline" size={17} color={colors.success} /><ThemedText style={[styles.memoryText, { color: colors.mutedText }]}>{memorySync.status} · {memorySync.updated.join('、')}</ThemedText></View> : null}
    </SurfaceCard>
  );
}

function ResultHeader({ icon, title, status, colors, warning = false }: { icon: string; title: string; status: string; colors: ReturnType<typeof useAppTheme>['colors']; warning?: boolean }) {
  return (
    <View style={styles.resultHeader}>
      <View style={styles.resultHeaderLeft}><View style={[styles.resultIcon, { backgroundColor: warning ? `${colors.accent}18` : colors.primarySoft }]}><ThemedText style={[styles.resultIconText, { color: warning ? colors.accent : colors.primary }]}>{icon}</ThemedText></View><ThemedText style={styles.resultHeaderTitle}>{title}</ThemedText></View>
      <View style={[styles.statusChip, { backgroundColor: warning ? `${colors.accent}18` : colors.surfaceMuted }]}><ThemedText style={[styles.statusChipText, { color: warning ? colors.accent : colors.mutedText }]}>{status}</ThemedText></View>
    </View>
  );
}

const styles = StyleSheet.create({
  pageContent: { gap: 14, paddingTop: 8 },
  desktopPageContent: { alignSelf: 'center', width: '100%' },
  workspace: { gap: 14 },
  desktopWorkspace: { alignItems: 'flex-start', flexDirection: 'row' },
  column: { gap: 14, minWidth: 0 },
  primaryColumn: { flex: 1.1 },
  secondaryColumn: { flex: 0.9 },
  iconButton: { alignItems: 'center', borderRadius: 999, height: 38, justifyContent: 'center', width: 38 },
  hero: { borderRadius: 24, gap: 14, overflow: 'hidden', padding: 18 },
  heroHeader: { alignItems: 'center', flexDirection: 'row', gap: 11 },
  heroIcon: { alignItems: 'center', borderRadius: 14, height: 44, justifyContent: 'center', width: 44 },
  heroCopy: { flex: 1, gap: 2 },
  heroEyebrow: { color: '#c9f36a', fontSize: 10, fontWeight: '900', letterSpacing: 1.1 },
  heroTitle: { color: '#ffffff', fontSize: 20, fontWeight: '900', lineHeight: 25 },
  heroBody: { color: '#d4dbea', fontSize: 12, lineHeight: 19 },
  heroTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  heroTag: { backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 6 },
  heroTagText: { color: '#edf1ff', fontSize: 10, fontWeight: '800' },
  briefCard: { gap: 10, padding: 15 },
  pipelineCard: { gap: 12, padding: 15 },
  sectionHeader: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  sectionIcon: { alignItems: 'center', borderRadius: 11, height: 34, justifyContent: 'center', width: 34 },
  sectionHeaderCopy: { flex: 1, gap: 2 },
  sectionTitle: { fontSize: 17, fontWeight: '900' },
  sectionMeta: { fontSize: 11, lineHeight: 16 },
  fieldLabel: { fontSize: 11, fontWeight: '800', marginTop: 3 },
  textArea: { borderRadius: 13, borderWidth: 1, fontSize: 13, lineHeight: 20, minHeight: 82, padding: 11, textAlignVertical: 'top' },
  sampleArea: { borderRadius: 13, borderWidth: 1, fontSize: 12, lineHeight: 18, minHeight: 68, padding: 11, textAlignVertical: 'top' },
  twoColumnFields: { flexDirection: 'row', gap: 9 },
  flexField: { flex: 1, gap: 2 },
  input: { borderRadius: 11, borderWidth: 1, fontSize: 12, height: 42, paddingHorizontal: 11 },
  dimensionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  dimensionChip: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7 },
  dimensionText: { fontSize: 10, fontWeight: '800' },
  primaryButton: { alignItems: 'center', borderRadius: 13, flexDirection: 'row', gap: 7, justifyContent: 'center', minHeight: 46, paddingHorizontal: 16 },
  primaryButtonText: { color: '#ffffff', fontSize: 13, fontWeight: '900' },
  resetButton: { alignItems: 'center', minHeight: 28, justifyContent: 'center' },
  resetButtonText: { fontSize: 11, fontWeight: '700' },
  progressHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  progressLabel: { fontSize: 10, fontWeight: '700' },
  progressValue: { fontSize: 13, fontWeight: '900' },
  progressTrack: { backgroundColor: '#e9edf8', borderRadius: 999, height: 5, overflow: 'hidden' },
  progressFill: { borderRadius: 999, height: '100%' },
  stageRow: { alignItems: 'flex-start', flexDirection: 'row', marginTop: 4 },
  stageSlot: { alignItems: 'center', flex: 1, flexDirection: 'row', minWidth: 0 },
  stageItem: { alignItems: 'center', gap: 4, minWidth: 47 },
  stageCircle: { alignItems: 'center', borderRadius: 999, borderWidth: 2, height: 38, justifyContent: 'center', width: 38 },
  stageLetter: { fontSize: 16, fontWeight: '900' },
  stageName: { fontSize: 10, fontWeight: '900', textAlign: 'center' },
  stageCaption: { fontSize: 9, textAlign: 'center' },
  connector: { flex: 1, height: 2, marginHorizontal: 2, marginTop: 18 },
  loopNote: { fontSize: 10, fontWeight: '800', textAlign: 'center' },
  flowSummary: { alignItems: 'center', borderRadius: 10, flexDirection: 'row', gap: 7, paddingHorizontal: 10, paddingVertical: 8 },
  flowSummaryText: { flex: 1, fontSize: 10, lineHeight: 15 },
  resultCard: { gap: 11, padding: 15 },
  resultHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  resultHeaderLeft: { alignItems: 'center', flexDirection: 'row', gap: 9 },
  resultIcon: { alignItems: 'center', borderRadius: 9, height: 30, justifyContent: 'center', width: 30 },
  resultIconText: { fontSize: 13, fontWeight: '900' },
  resultHeaderTitle: { fontSize: 15, fontWeight: '900' },
  statusChip: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5 },
  statusChipText: { fontSize: 9, fontWeight: '900' },
  storyCardList: { gap: 8 },
  storyChapter: { borderRadius: 11, borderWidth: 1, gap: 4, padding: 10 },
  storyChapterHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  storyChapterTitle: { fontSize: 11, fontWeight: '900' },
  storyChapterMeta: { fontSize: 9, fontWeight: '900' },
  storyChapterGoal: { fontSize: 11, lineHeight: 17 },
  storyChapterEnding: { fontSize: 10, lineHeight: 16 },
  sceneChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  sceneChip: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 5 },
  sceneChipText: { fontSize: 9, fontWeight: '700' },
  referenceHeading: { alignItems: 'center', flexDirection: 'row', gap: 8, justifyContent: 'space-between' },
  resultTitle: { flex: 1, fontSize: 15, fontWeight: '900', lineHeight: 21 },
  resultBody: { fontSize: 12, lineHeight: 19 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  styleChip: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  styleChipText: { fontSize: 10, fontWeight: '800' },
  safetyNote: { fontSize: 10, lineHeight: 16 },
  castRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  castChip: { borderRadius: 10, gap: 2, paddingHorizontal: 9, paddingVertical: 7 },
  castChipName: { fontSize: 11, fontWeight: '900' },
  castChipRole: { fontSize: 9 },
  beatBox: { borderRadius: 11, borderWidth: 1, gap: 5, padding: 10 },
  miniLabel: { fontSize: 9, fontWeight: '900', letterSpacing: 0.6 },
  beatText: { fontSize: 10, lineHeight: 16 },
  resultHint: { fontSize: 10, lineHeight: 16 },
  approvedBar: { alignItems: 'center', borderRadius: 11, flexDirection: 'row', gap: 6, paddingHorizontal: 11, paddingVertical: 10 },
  approvedText: { fontSize: 11, fontWeight: '800' },
  draftMeta: { alignItems: 'flex-end', flexDirection: 'row', gap: 8 },
  wordCount: { fontSize: 10, marginBottom: 2 },
  styleApplied: { alignItems: 'center', borderRadius: 10, flexDirection: 'row', gap: 7, paddingHorizontal: 10, paddingVertical: 8 },
  styleAppliedText: { flex: 1, fontSize: 10, lineHeight: 15 },
  revisionArea: { borderRadius: 13, borderWidth: 1, fontSize: 12, lineHeight: 18, minHeight: 76, padding: 11, textAlignVertical: 'top' },
  revisionHistory: { gap: 4 },
  historyText: { fontSize: 10, lineHeight: 16 },
  draftCopy: { gap: 10 },
  paragraph: { fontFamily: 'serif', fontSize: 13, lineHeight: 22 },
  reviewScoreRow: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  reviewScoreCopy: { flex: 1, gap: 4 },
  reviewScore: { fontSize: 30, fontWeight: '900' },
  reviewScoreSmall: { fontSize: 11, fontWeight: '700' },
  categoryList: { borderTopWidth: 1, borderTopColor: '#edf0f7' },
  categoryRow: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 9 },
  categoryLabel: { fontSize: 11, fontWeight: '700' },
  categoryStatus: { fontSize: 10, fontWeight: '900' },
  issueBox: { borderLeftWidth: 3, gap: 5, padding: 10 },
  issueText: { fontSize: 11, lineHeight: 17 },
  issueMeta: { fontSize: 10, lineHeight: 16 },
  passBox: { alignItems: 'center', borderRadius: 10, flexDirection: 'row', gap: 7, paddingHorizontal: 10, paddingVertical: 9 },
  passText: { flex: 1, fontSize: 10, fontWeight: '800', lineHeight: 15 },
  reviewEvidenceList: { borderTopWidth: 1, borderTopColor: '#edf0f7' },
  reviewEvidenceRow: { alignItems: 'flex-start', borderBottomWidth: 1, flexDirection: 'row', gap: 8, justifyContent: 'space-between', paddingVertical: 8 },
  reviewEvidenceCopy: { flex: 1, gap: 2 },
  memoryRow: { alignItems: 'flex-start', flexDirection: 'row', gap: 7 },
  memoryText: { flex: 1, fontSize: 10, lineHeight: 16 },
  errorCard: { alignItems: 'flex-start', borderRadius: 13, borderWidth: 1, flexDirection: 'row', gap: 8, padding: 12 },
  errorText: { flex: 1, fontSize: 11, lineHeight: 17 },
  demoNote: { fontSize: 10, lineHeight: 16, textAlign: 'center' },
});
