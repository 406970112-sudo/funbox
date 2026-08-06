import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { appLayout } from '@/constants/app-theme';
import { useAuth } from '@/features/auth/auth-provider';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  addProcrastinationStep,
  archiveProcrastinationGoal,
  completeProcrastinationStep,
  createProcrastinationGoal,
  deleteProcrastinationStep,
  fetchProcrastinationGoal,
  fetchProcrastinationHome,
  fetchProcrastinationLedger,
  fetchProcrastinationStats,
  getProcrastinationErrorMessage,
  startProcrastinationStep,
  suggestProcrastinationSteps,
  undoProcrastinationStep,
  updateProcrastinationStep,
} from '@/lib/procrastination-crusher-api';
import {
  eventTypeLabel,
  formatActualSeconds,
  formatMinutes,
  goalExpectedXP,
  levelFromXP,
  stepDisplayXP,
  todayDateString,
} from '@/lib/procrastination-crusher';
import type {
  ProcrastinationEvent,
  ProcrastinationGoal,
  ProcrastinationHome,
  ProcrastinationLedger,
  ProcrastinationStats,
  ProcrastinationStep,
} from '@/types/procrastination-crusher';

type CrusherTab = 'push' | 'ledger';
type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];
type DraftStep = { title: string; estimatedMinutes: string };

export function ProcrastinationCrusherScreen() {
  const router = useRouter();
  const { accessToken, status: authStatus, user } = useAuth();
  const { colors, colorScheme } = useAppTheme();
  const dark = colorScheme === 'dark';
  const [activeTab, setActiveTab] = useState<CrusherTab>('push');
  const [home, setHome] = useState<ProcrastinationHome | null>(null);
  const [stats, setStats] = useState<ProcrastinationStats | null>(null);
  const [ledger, setLedger] = useState<ProcrastinationLedger | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailGoalId, setDetailGoalId] = useState<string | null>(null);
  const [detailGoal, setDetailGoal] = useState<ProcrastinationGoal | null>(null);
  const requestRef = useRef(0);
  const hasLoadedRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!accessToken) return;
    const requestID = ++requestRef.current;
    setLoading(!hasLoadedRef.current);
    setError(null);
    try {
      const [homeData, statData, ledgerData] = await Promise.all([
        fetchProcrastinationHome(accessToken, todayDateString()),
        fetchProcrastinationStats(accessToken, 'week'),
        fetchProcrastinationLedger(accessToken, { limit: 20 }),
      ]);
      if (requestID !== requestRef.current) return;
      setHome(homeData);
      setStats(statData);
      setLedger(ledgerData);
      setLoading(false);
      hasLoadedRef.current = true;
    } catch (nextError) {
      if (requestID !== requestRef.current) return;
      setError(getProcrastinationErrorMessage(nextError));
      setLoading(false);
    } finally {
      if (requestID === requestRef.current) setRefreshing(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function runMutation(action: () => Promise<unknown>, success?: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      if (success) setMessage(success);
      await refresh();
    } catch (nextError) {
      setError(getProcrastinationErrorMessage(nextError));
    } finally {
      setBusy(false);
    }
  }

  async function handleStepStart(stepId: string) {
    await runMutation(() => startProcrastinationStep(accessToken!, stepId), '已开始计时');
    if (detailGoalId) await refreshDetail(detailGoalId);
  }

  async function handleStepComplete(stepId: string) {
    await runMutation(
      () => completeProcrastinationStep(accessToken!, stepId, todayDateString()),
      '步骤完成，经验值已入账',
    );
    if (detailGoalId) await refreshDetail(detailGoalId);
  }

  async function handleStepUndo(stepId: string) {
    await runMutation(
      () => undoProcrastinationStep(accessToken!, stepId, todayDateString()),
      '已撤销步骤并冲正经验值',
    );
    if (detailGoalId) await refreshDetail(detailGoalId);
  }

  async function refreshDetail(goalId: string) {
    if (!accessToken) return;
    try {
      const goal = await fetchProcrastinationGoal(accessToken, goalId);
      setDetailGoal(goal);
    } catch (nextError) {
      setError(getProcrastinationErrorMessage(nextError));
    }
  }

  if (authStatus === 'loading') {
    return <CenterState icon="bomb" title="正在打开拖延任务粉碎机" loading />;
  }

  if (!accessToken || !user) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
        <View style={styles.loginState}>
          <View style={[styles.stateIcon, { backgroundColor: colors.primarySoft }]}>
            <MaterialCommunityIcons name="bomb" size={34} color={colors.primary} />
          </View>
          <ThemedText style={styles.stateTitle}>登录后使用拖延任务粉碎机</ThemedText>
          <ThemedText style={[styles.stateText, { color: colors.mutedText }]}>
            目标、微步骤和真实经验值会保存在你的 FunBox 账号里。
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              router.push({
                pathname: '/auth',
                params: { returnTo: '/tools/procrastination-crusher' },
              })
            }
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
            <MaterialCommunityIcons name="login" size={18} color="#ffffff" />
            <ThemedText style={styles.primaryButtonText}>登录</ThemedText>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (loading || !home || !stats || !ledger) {
    return <CenterState icon="bomb" title="正在整理目标" loading />;
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={[styles.screen, { maxWidth: appLayout.screenMaxWidth, alignSelf: 'center' }]}>
        <View style={styles.header}>
          <Pressable
            accessibilityLabel="返回"
            accessibilityRole="button"
            hitSlop={10}
            onPress={() => router.back()}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
            <MaterialCommunityIcons name="chevron-left" size={29} color={colors.text} />
          </Pressable>
          <View style={styles.headerTitleWrap}>
            <ThemedText style={styles.headerTitle}>拖延任务粉碎机</ThemedText>
            <ThemedText style={[styles.headerMeta, { color: colors.mutedText }]}>
              Lv.{home.level} · {home.totalXP} XP
            </ThemedText>
          </View>
          <Pressable
            accessibilityLabel="拆解大任务"
            accessibilityRole="button"
            onPress={() => setCreateOpen(true)}
            style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}>
            <MaterialCommunityIcons name="plus" size={18} color="#ffffff" />
            <ThemedText style={styles.addButtonText}>拆解</ThemedText>
          </Pressable>
        </View>

        <View style={[styles.tabs, { backgroundColor: colors.surfaceMuted, borderColor: colors.line }]}>
          <TabButton
            active={activeTab === 'push'}
            icon="bomb"
            label="继续推进"
            onPress={() => setActiveTab('push')}
          />
          <TabButton
            active={activeTab === 'ledger'}
            icon="receipt-text-outline"
            label="经验账本"
            onPress={() => setActiveTab('ledger')}
          />
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              onRefresh={() => {
                setRefreshing(true);
                void refresh();
              }}
              refreshing={refreshing}
              tintColor={colors.primary}
            />
          }>
          {error ? <Notice tone="error" text={error} /> : null}
          {message ? <Notice tone="success" text={message} /> : null}

          {activeTab === 'push' ? (
            <PushTab
              busy={busy}
              dark={dark}
              home={home}
              onAdd={() => setCreateOpen(true)}
              onArchive={(goal) => {
                void runMutation(
                  () => archiveProcrastinationGoal(accessToken, goal.id),
                  '目标已归档',
                );
              }}
              onComplete={handleStepComplete}
              onOpen={async (goalId) => {
                setDetailGoalId(goalId);
                setDetailGoal(null);
                await refreshDetail(goalId);
              }}
              onStart={handleStepStart}
              onUndo={handleStepUndo}
            />
          ) : null}

          {activeTab === 'ledger' ? (
            <LedgerTab
              home={home}
              ledger={ledger}
              onAdd={() => setCreateOpen(true)}
              stats={stats}
            />
          ) : null}
        </ScrollView>
      </View>

      <CreateGoalModal
        accessToken={accessToken}
        busy={busy}
        colors={colors}
        dark={dark}
        onClose={() => setCreateOpen(false)}
        onSaved={async () => {
          setCreateOpen(false);
          await refresh();
        }}
        open={createOpen}
      />
      <GoalDetailModal
        accessToken={accessToken}
        busy={busy}
        colors={colors}
        dark={dark}
        goal={detailGoal}
        onArchive={async (goal) => {
          await runMutation(
            () => archiveProcrastinationGoal(accessToken, goal.id),
            '目标已归档',
          );
          setDetailGoalId(null);
          setDetailGoal(null);
        }}
        onClose={() => {
          setDetailGoalId(null);
          setDetailGoal(null);
        }}
        onDeleteStep={async (goalId, stepId) => {
          const ok = Platform.OS === 'web' ? window.confirm('确认删除这一步？') : await confirmNative();
          if (!ok) return;
          await runMutation(() => deleteProcrastinationStep(accessToken, goalId, stepId), '步骤已删除');
          await refreshDetail(goalId);
        }}
        onRefresh={refreshDetail}
        onSavedStep={async () => {
          if (detailGoalId) await refreshDetail(detailGoalId);
        }}
        onStepAction={async (action, stepId) => {
          if (action === 'start') await handleStepStart(stepId);
          if (action === 'complete') await handleStepComplete(stepId);
          if (action === 'undo') await handleStepUndo(stepId);
        }}
        open={Boolean(detailGoalId)}
      />
    </SafeAreaView>
  );
}

function PushTab({
  busy,
  dark,
  home,
  onAdd,
  onArchive,
  onComplete,
  onOpen,
  onStart,
  onUndo,
}: {
  busy: boolean;
  dark: boolean;
  home: ProcrastinationHome;
  onAdd: () => void;
  onArchive: (goal: ProcrastinationGoal) => void;
  onComplete: (stepId: string) => void;
  onOpen: (goalId: string) => void;
  onStart: (stepId: string) => void;
  onUndo: (stepId: string) => void;
}) {
  const { colors } = useAppTheme();
  const currentGoal = home.currentGoal;
  const currentStep = home.currentStep;
  const visibleGoals = home.goals.slice(0, 5);

  return (
    <>
      <View style={[styles.heroCard, dark && styles.heroCardDark]}>
        <View style={styles.heroTop}>
          <ThemedText style={styles.heroEyebrow}>当前目标</ThemedText>
          <View style={styles.heroTag}>
            <MaterialCommunityIcons name="lightning-bolt" size={13} color="#c9f36a" />
            <ThemedText style={styles.heroTagText}>今日 +{home.todayXP} XP</ThemedText>
          </View>
        </View>
        <ThemedText style={styles.heroTitle}>
          {currentGoal ? currentGoal.title : '还没有待推进目标'}
        </ThemedText>
        <ThemedText style={[styles.heroMeta, { color: colors.mutedText }]}>
          {currentGoal
            ? `${currentGoal.completedSteps}/${currentGoal.totalSteps} 步 · 预计剩余 ${currentGoal.remainingMinutes} 分钟`
            : '先拆解一个大任务，从只做第一步开始。'}
        </ThemedText>
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              {
                width: `${currentGoal && currentGoal.totalSteps > 0
                  ? Math.min(100, Math.round((currentGoal.completedSteps / currentGoal.totalSteps) * 100))
                  : 0}%`,
              },
            ]}
          />
        </View>
        <View style={styles.heroStats}>
          <HeroStat
            label="还剩步骤"
            value={currentGoal ? `${currentGoal.totalSteps - currentGoal.completedSteps}` : '0'}
          />
          <HeroStat
            label="预计经验"
            value={currentGoal ? `+${currentGoal.expectedXP - currentGoal.xpEarned} XP` : '+0 XP'}
          />
        </View>
      </View>

      <SectionHeading title="现在只做这一步" meta={currentStep ? `完成 +${stepDisplayXP(currentStep)} XP` : ''} />
      {currentStep && currentGoal ? (
        <CurrentStepCard
          busy={busy}
          goal={currentGoal}
          onComplete={() => onComplete(currentStep.id)}
          onStart={() => onStart(currentStep.id)}
          step={currentStep}
        />
      ) : (
        <EmptyState
          icon="bomb"
          onPress={onAdd}
          text="拆解一个大任务"
        />
      )}

      <SectionHeading title="进行中目标" meta={`${visibleGoals.length} 个`} />
      {visibleGoals.length === 0 ? (
        <EmptyState icon="target" onPress={onAdd} text="还没有目标" />
      ) : (
        visibleGoals.map((goal) => (
          <GoalRow
            key={goal.id}
            goal={goal}
            onArchive={() => onArchive(goal)}
            onPress={() => onOpen(goal.id)}
          />
        ))
      )}

      <SectionHeading title="最近经验" meta="真实账本" />
      {home.events.length === 0 ? (
        <EmptyState icon="receipt-text-outline" onPress={onAdd} text="完成一步后出现在这里" />
      ) : (
        home.events.slice(0, 5).map((event) => <EventRow key={event.id} event={event} />)
      )}
    </>
  );
}

function CurrentStepCard({
  busy,
  goal,
  onComplete,
  onStart,
  step,
}: {
  busy: boolean;
  goal: ProcrastinationGoal;
  onComplete: () => void;
  onStart: () => void;
  step: ProcrastinationStep;
}) {
  const { colors } = useAppTheme();
  const started = step.status === 'started';
  return (
    <View style={[styles.currentStep, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <View style={styles.currentStepHead}>
        <View style={[styles.stepNumber, { backgroundColor: colors.primarySoft }]}>
          <ThemedText style={[styles.stepNumberText, { color: colors.primary }]}>
            {String(step.sortOrder).padStart(2, '0')}
          </ThemedText>
        </View>
        <View style={styles.stepMain}>
          <ThemedText numberOfLines={2} style={styles.currentStepTitle}>
            {step.title}
          </ThemedText>
          <ThemedText style={[styles.currentStepMeta, { color: colors.mutedText }]}>
            {formatMinutes(step.estimatedMinutes)}
            {started && step.startedAt ? ` · ${formatActualSeconds(Math.max(0, Math.round((Date.now() - new Date(step.startedAt).getTime()) / 1000)))}` : ''}
          </ThemedText>
        </View>
        <View style={styles.xpPill}>
          <ThemedText style={styles.xpPillText}>+{stepDisplayXP(step)} XP</ThemedText>
        </View>
      </View>
      <View style={styles.currentStepActions}>
        {!started ? (
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={onStart}
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
            <MaterialCommunityIcons name="play" size={15} color={colors.primary} />
            <ThemedText style={[styles.secondaryButtonText, { color: colors.primary }]}>开始</ThemedText>
          </Pressable>
        ) : (
          <View style={[styles.secondaryButton, { backgroundColor: colors.surfaceMuted }]}>
            <MaterialCommunityIcons name="timer-outline" size={15} color={colors.primary} />
            <ThemedText style={[styles.secondaryButtonText, { color: colors.primary }]}>计时中</ThemedText>
          </View>
        )}
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={onComplete}
          style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
          <MaterialCommunityIcons name="check" size={16} color="#ffffff" />
          <ThemedText style={styles.primaryButtonText}>完成这一步</ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

function GoalRow({
  goal,
  onArchive,
  onPress,
}: {
  goal: ProcrastinationGoal;
  onArchive: () => void;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.goalRow, { backgroundColor: colors.surface, borderColor: colors.line }, pressed && styles.pressed]}>
      <View style={[styles.goalIcon, { backgroundColor: colors.primarySoft }]}>
        <MaterialCommunityIcons name="target" size={16} color={colors.primary} />
      </View>
      <View style={styles.rowMain}>
        <ThemedText numberOfLines={1} style={styles.rowTitle}>{goal.title}</ThemedText>
        <ThemedText style={[styles.rowMeta, { color: colors.mutedText }]}>
          {goal.completedSteps}/{goal.totalSteps} 步 · 预计剩余 {goal.remainingMinutes} 分钟
        </ThemedText>
      </View>
      <Pressable accessibilityLabel="归档目标" hitSlop={8} onPress={onArchive} style={styles.rowArchive}>
        <MaterialCommunityIcons name="archive-outline" size={17} color={colors.mutedText} />
      </Pressable>
      <ThemedText style={[styles.rowXP, { color: '#d79600' }]}>
        +{Math.max(0, goal.expectedXP - goal.xpEarned)} XP
      </ThemedText>
    </Pressable>
  );
}

function EventRow({ event }: { event: ProcrastinationEvent }) {
  const { colors } = useAppTheme();
  const positive = event.xpDelta > 0;
  return (
    <View style={[styles.eventRow, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <View style={[styles.eventIcon, { backgroundColor: positive ? '#e8f6f0' : colors.primarySoft }]}>
        <MaterialCommunityIcons
          name={positive ? 'check' : 'undo'}
          size={14}
          color={positive ? '#1db991' : colors.primary}
        />
      </View>
      <View style={styles.rowMain}>
        <ThemedText numberOfLines={1} style={styles.rowTitle}>
          {event.stepTitle || event.goalTitle}
        </ThemedText>
        <ThemedText style={[styles.rowMeta, { color: colors.mutedText }]}>
          {event.goalTitle} · {eventTypeLabel(event.eventType)}
        </ThemedText>
      </View>
      <ThemedText style={[styles.eventXP, { color: positive ? '#1db991' : '#e2576f' }]}>
        {positive ? '+' : ''}{event.xpDelta} XP
      </ThemedText>
    </View>
  );
}

function LedgerTab({
  home,
  ledger,
  onAdd,
  stats,
}: {
  home: ProcrastinationHome;
  ledger: ProcrastinationLedger;
  onAdd: () => void;
  stats: ProcrastinationStats;
}) {
  const { colors } = useAppTheme();
  const level = levelFromXP(home.totalXP);
  const maxCount = Math.max(1, ...stats.last7Days.map((day) => day.count));
  const dayLabels = stats.last7Days.map((day) => `${Number(day.date.slice(-2))}`);
  return (
    <>
      <View style={[styles.levelCard, { backgroundColor: colors.hero }]}>
        <View style={styles.levelBadge}>
          <ThemedText style={styles.levelBadgeValue}>Lv.{level.level}</ThemedText>
          <ThemedText style={styles.levelBadgeLabel}>{home.totalXP} XP</ThemedText>
        </View>
        <View style={styles.levelMain}>
          <ThemedText style={styles.levelTitle}>距离 Lv.{level.level + 1} 还差 {level.next} XP</ThemedText>
          <ThemedText style={[styles.levelMeta, { color: colors.mutedText }]}>
            来自真实完成记录
          </ThemedText>
          <View style={styles.levelTrack}>
            <View style={[styles.levelFill, { width: `${Math.min(100, level.progress / 50 * 100)}%` }]} />
          </View>
        </View>
      </View>

      <View style={styles.statGrid}>
        <StatCard icon="check-circle-outline" label="已完成步骤" value={String(stats.stepsCompleted)} />
        <StatCard icon="lightning-bolt" label="本周 XP" value={String(stats.rangeXP)} tone="amber" />
        <StatCard icon="fire" label="当前连续" value={`${stats.streakDays} 天`} tone="blue" />
        <StatCard icon="trophy-outline" label="粉碎目标" value={String(stats.goalsCompleted)} tone="green" />
      </View>

      <SectionHeading title="最近 7 天" meta={`${stats.stepsCompleted} 步完成`} />
      <View style={[styles.chartCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <View style={styles.barChart}>
          {stats.last7Days.map((day, index) => (
            <View key={day.date} style={styles.barCol}>
              <View
                style={[
                  styles.bar,
                  {
                    backgroundColor: day.count > 0 ? colors.primary : colors.surfaceMuted,
                    height: `${Math.max(4, Math.round((day.count / maxCount) * 100))}%`,
                  },
                ]}
              />
              <ThemedText style={[styles.barLabel, { color: colors.mutedText }]}>{dayLabels[index]}</ThemedText>
            </View>
          ))}
        </View>
      </View>

      <SectionHeading title="经验账本" meta={`${ledger.events.length} 条`} />
      {ledger.events.length === 0 ? (
        <EmptyState icon="receipt-text-outline" onPress={onAdd} text="还没有经验记录" />
      ) : (
        ledger.events.map((event) => <EventRow key={event.id} event={event} />)
      )}
    </>
  );
}

function CreateGoalModal({
  accessToken,
  busy,
  colors,
  dark,
  onClose,
  onSaved,
  open,
}: {
  accessToken: string;
  busy: boolean;
  colors: ReturnType<typeof useAppTheme>['colors'];
  dark: boolean;
  onClose: () => void;
  onSaved: () => void;
  open: boolean;
}) {
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [deadline, setDeadline] = useState('');
  const [steps, setSteps] = useState<DraftStep[]>([]);
  const [saving, setSaving] = useState(false);
  const [aiLoading, setAILoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [localMessage, setLocalMessage] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle('');
      setNote('');
      setDeadline('');
      setSteps([
        { title: '', estimatedMinutes: '3' },
        { title: '', estimatedMinutes: '5' },
      ]);
      setLocalError(null);
      setLocalMessage(null);
    }
  }, [open]);

  async function runAI() {
    if (!title.trim()) {
      setLocalError('先填写目标标题，再生成建议。');
      return;
    }
    setAILoading(true);
    setLocalError(null);
    try {
      const result = await suggestProcrastinationSteps(accessToken, { title, note });
      setSteps(
        result.steps.map((step) => ({
          title: step.title,
          estimatedMinutes: String(step.estimatedMinutes),
        })),
      );
      setLocalMessage(result.summary);
    } catch (nextError) {
      setLocalError(getProcrastinationErrorMessage(nextError));
    } finally {
      setAILoading(false);
    }
  }

  async function save() {
    if (!title.trim()) {
      setLocalError('请填写目标标题。');
      return;
    }
    const cleaned = steps
      .filter((step) => step.title.trim())
      .map((step) => ({
        title: step.title.trim(),
        estimatedMinutes: Math.max(1, Math.min(120, Number(step.estimatedMinutes) || 1)),
      }));
    if (cleaned.length < 2) {
      setLocalError('至少需要 2 个微步骤。');
      return;
    }
    setSaving(true);
    setLocalError(null);
    try {
      await createProcrastinationGoal(accessToken, {
        title: title.trim(),
        note: note.trim(),
        deadline: deadline.trim(),
        steps: cleaned,
      });
      await onSaved();
    } catch (nextError) {
      setLocalError(getProcrastinationErrorMessage(nextError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal animationType="slide" transparent visible={open} onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalRoot}>
        <Pressable onPress={onClose} style={styles.modalBackdrop} />
        <View style={[styles.modalSheet, { backgroundColor: colors.background, borderColor: colors.line }]}>
          <View style={styles.modalHeader}>
            <ThemedText style={styles.modalTitle}>拆解大任务</ThemedText>
            <Pressable onPress={onClose} style={styles.modalClose}>
              <MaterialCommunityIcons name="close" size={22} color={colors.mutedText} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
            <Field label="目标标题">
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder="例如：整理房间"
                placeholderTextColor={colors.mutedText}
                style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.line, color: colors.text }]}
              />
            </Field>
            <Field label="备注">
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="补充真实背景"
                placeholderTextColor={colors.mutedText}
                style={[styles.input, styles.textArea, { backgroundColor: colors.surface, borderColor: colors.line, color: colors.text }]}
                multiline
              />
            </Field>
            <Field label="截止日期">
              <View style={styles.deadlineRow}>
                <TextInput
                  value={deadline}
                  onChangeText={setDeadline}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={colors.mutedText}
                  style={[styles.input, styles.flexInput, { backgroundColor: colors.surface, borderColor: colors.line, color: colors.text }]}
                />
                <Pressable
                  onPress={() => setDeadline(todayDateString())}
                  style={[styles.smallActionButton, { backgroundColor: colors.primarySoft }]}>
                  <ThemedText style={[styles.smallActionText, { color: colors.primary }]}>今天</ThemedText>
                </Pressable>
              </View>
            </Field>

            <View style={styles.sectionHeadRow}>
              <ThemedText style={styles.sectionTitle}>微步骤</ThemedText>
              <Pressable
                disabled={aiLoading || busy}
                onPress={() => void runAI()}
                style={[styles.smallActionButton, { backgroundColor: colors.primarySoft }]}>
                <MaterialCommunityIcons
                  name={aiLoading ? 'loading' : 'auto-fix'}
                  size={14}
                  color={colors.primary}
                />
                <ThemedText style={[styles.smallActionText, { color: colors.primary }]}>AI 建议</ThemedText>
              </Pressable>
            </View>
            {steps.map((step, index) => (
              <DraftStepRow
                colors={colors}
                index={index}
                key={index}
                onRemove={() => setSteps((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                onChange={(patch) =>
                  setSteps((current) =>
                    current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
                  )
                }
                step={step}
              />
            ))}
            {steps.length < 20 ? (
              <Pressable
                onPress={() => setSteps((current) => [...current, { title: '', estimatedMinutes: '3' }])}
                style={[styles.addStepButton, { borderColor: colors.line }]}>
                <MaterialCommunityIcons name="plus" size={16} color={colors.primary} />
                <ThemedText style={[styles.addStepText, { color: colors.primary }]}>添加步骤</ThemedText>
              </Pressable>
            ) : null}
            <View style={[styles.summaryStrip, { backgroundColor: colors.surface, borderColor: colors.line }]}>
              <View style={styles.summaryCell}>
                <ThemedText style={styles.summaryValue}>
                  {steps.reduce((sum, step) => sum + Math.max(1, Math.min(120, Number(step.estimatedMinutes) || 0)), 0)} 分钟
                </ThemedText>
                <ThemedText style={[styles.summaryLabel, { color: colors.mutedText }]}>预计总时长</ThemedText>
              </View>
              <View style={styles.summaryCell}>
                <ThemedText style={styles.summaryValue}>
                  {goalExpectedXP(steps.map((step) => ({ title: step.title, estimatedMinutes: Math.max(1, Math.min(120, Number(step.estimatedMinutes) || 0)) })))} XP
                </ThemedText>
                <ThemedText style={[styles.summaryLabel, { color: colors.mutedText }]}>预计获得经验</ThemedText>
              </View>
            </View>
            {localError ? <Notice tone="error" text={localError} /> : null}
            {localMessage ? <Notice tone="success" text={localMessage} /> : null}
            <Pressable
              disabled={saving || busy}
              onPress={() => void save()}
              style={({ pressed }) => [styles.saveButton, pressed && styles.pressed]}>
              {saving ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <MaterialCommunityIcons name="bomb" size={18} color="#ffffff" />
              )}
              <ThemedText style={styles.saveButtonText}>开始粉碎</ThemedText>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function DraftStepRow({
  colors,
  index,
  onChange,
  onRemove,
  step,
}: {
  colors: ReturnType<typeof useAppTheme>['colors'];
  index: number;
  onChange: (patch: Partial<DraftStep>) => void;
  onRemove: () => void;
  step: DraftStep;
}) {
  return (
    <View style={[styles.draftStep, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <ThemedText style={[styles.draftIndex, { color: colors.primary }]}>{index + 1}</ThemedText>
      <TextInput
        value={step.title}
        onChangeText={(title) => onChange({ title })}
        placeholder="只做一个小动作"
        placeholderTextColor={colors.mutedText}
        style={[styles.draftTitleInput, { color: colors.text }]}
      />
      <TextInput
        value={step.estimatedMinutes}
        onChangeText={(estimatedMinutes) => onChange({ estimatedMinutes })}
        keyboardType="number-pad"
        placeholder="分钟"
        placeholderTextColor={colors.mutedText}
        style={[styles.draftMinutesInput, { color: colors.text }]}
      />
      <Pressable onPress={onRemove} style={styles.draftRemove}>
        <MaterialCommunityIcons name="close" size={16} color={colors.mutedText} />
      </Pressable>
    </View>
  );
}

function GoalDetailModal({
  accessToken,
  busy,
  colors,
  dark,
  goal,
  onArchive,
  onClose,
  onDeleteStep,
  onRefresh,
  onSavedStep,
  onStepAction,
  open,
}: {
  accessToken: string;
  busy: boolean;
  colors: ReturnType<typeof useAppTheme>['colors'];
  dark: boolean;
  goal: ProcrastinationGoal | null;
  onArchive: (goal: ProcrastinationGoal) => void;
  onClose: () => void;
  onDeleteStep: (goalId: string, stepId: string) => void;
  onRefresh: (goalId: string) => void;
  onSavedStep: () => void;
  onStepAction: (action: 'start' | 'complete' | 'undo', stepId: string) => void;
  open: boolean;
}) {
  const [addingStep, setAddingStep] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newMinutes, setNewMinutes] = useState('3');
  const [editStepId, setEditStepId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editMinutes, setEditMinutes] = useState('3');
  const [localError, setLocalError] = useState<string | null>(null);
  const [localBusy, setLocalBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setAddingStep(false);
      setEditStepId(null);
      setLocalError(null);
    }
  }, [open]);

  async function saveNewStep(goalId: string) {
    if (!newTitle.trim()) {
      setLocalError('请填写步骤标题。');
      return;
    }
    setLocalBusy(true);
    try {
      await addProcrastinationStep(accessToken, goalId, {
        title: newTitle.trim(),
        estimatedMinutes: Math.max(1, Math.min(120, Number(newMinutes) || 1)),
      });
      setNewTitle('');
      setNewMinutes('3');
      setAddingStep(false);
      await onSavedStep();
      await onRefresh(goalId);
    } catch (nextError) {
      setLocalError(getProcrastinationErrorMessage(nextError));
    } finally {
      setLocalBusy(false);
    }
  }

  async function saveEditStep(goalId: string, step: ProcrastinationStep) {
    if (!editTitle.trim()) {
      setLocalError('请填写步骤标题。');
      return;
    }
    setLocalBusy(true);
    try {
      await updateProcrastinationStep(accessToken, goalId, step.id, {
        title: editTitle.trim(),
        estimatedMinutes: Math.max(1, Math.min(120, Number(editMinutes) || 1)),
      });
      setEditStepId(null);
      await onSavedStep();
      await onRefresh(goalId);
    } catch (nextError) {
      setLocalError(getProcrastinationErrorMessage(nextError));
    } finally {
      setLocalBusy(false);
    }
  }

  if (!goal) return null;
  const steps = goal.steps ?? [];
  return (
    <Modal animationType="slide" transparent visible={open} onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable onPress={onClose} style={styles.modalBackdrop} />
        <View style={[styles.modalSheet, { backgroundColor: colors.background, borderColor: colors.line }]}>
          <View style={styles.modalHeader}>
            <ThemedText style={styles.modalTitle} numberOfLines={1}>{goal.title}</ThemedText>
            <Pressable onPress={onClose} style={styles.modalClose}>
              <MaterialCommunityIcons name="close" size={22} color={colors.mutedText} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.modalContent}>
            <View style={[styles.heroCard, dark && styles.heroCardDark]}>
              <ThemedText style={styles.heroEyebrow}>目标进度</ThemedText>
              <ThemedText style={styles.heroTitle}>
                {goal.completedSteps}/{goal.totalSteps} 步
              </ThemedText>
              <ThemedText style={[styles.heroMeta, { color: colors.mutedText }]}>
                预计剩余 {goal.remainingMinutes} 分钟 · 已获 {goal.xpEarned} XP
              </ThemedText>
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${goal.totalSteps > 0 ? Math.min(100, Math.round((goal.completedSteps / goal.totalSteps) * 100)) : 0}%` },
                  ]}
                />
              </View>
            </View>

            <View style={styles.sectionHeadRow}>
              <ThemedText style={styles.sectionTitle}>步骤列表</ThemedText>
              <Pressable
                disabled={busy || localBusy}
                onPress={() => {
                  setAddingStep((current) => !current);
                  setLocalError(null);
                }}
                style={[styles.smallActionButton, { backgroundColor: colors.primarySoft }]}>
                <MaterialCommunityIcons name="plus" size={14} color={colors.primary} />
                <ThemedText style={[styles.smallActionText, { color: colors.primary }]}>添加</ThemedText>
              </Pressable>
            </View>
            {addingStep ? (
              <View style={[styles.addStepForm, { backgroundColor: colors.surface, borderColor: colors.line }]}>
                <TextInput
                  value={newTitle}
                  onChangeText={setNewTitle}
                  placeholder="新步骤标题"
                  placeholderTextColor={colors.mutedText}
                  style={[styles.input, styles.flexInput, { color: colors.text }]}
                />
                <TextInput
                  value={newMinutes}
                  onChangeText={setNewMinutes}
                  keyboardType="number-pad"
                  placeholder="分钟"
                  placeholderTextColor={colors.mutedText}
                  style={[styles.minutesInput, { color: colors.text }]}
                />
                <Pressable
                  disabled={localBusy}
                  onPress={() => void saveNewStep(goal.id)}
                  style={[styles.smallActionButton, { backgroundColor: colors.hero }]}>
                  <ThemedText style={styles.smallActionDarkText}>保存</ThemedText>
                </Pressable>
              </View>
            ) : null}

            {steps.map((step) => (
              <DetailStepRow
                busy={busy || localBusy}
                colors={colors}
                editMinutes={editMinutes}
                editStepId={editStepId}
                editTitle={editTitle}
                key={step.id}
                onCancelEdit={() => setEditStepId(null)}
                onComplete={() => onStepAction('complete', step.id)}
                onDelete={() => onDeleteStep(goal.id, step.id)}
                onEdit={() => {
                  setEditStepId(step.id);
                  setEditTitle(step.title);
                  setEditMinutes(String(step.estimatedMinutes));
                  setLocalError(null);
                }}
                onSaveEdit={() => void saveEditStep(goal.id, step)}
                onStart={() => onStepAction('start', step.id)}
                onUndo={() => onStepAction('undo', step.id)}
                setEditMinutes={setEditMinutes}
                setEditTitle={setEditTitle}
                step={step}
              />
            ))}
            {localError ? <Notice tone="error" text={localError} /> : null}
            <Pressable
              disabled={busy}
              onPress={() => {
                void onArchive(goal);
              }}
              style={styles.archiveButton}>
              <MaterialCommunityIcons name="archive-outline" size={16} color={colors.mutedText} />
              <ThemedText style={[styles.archiveText, { color: colors.mutedText }]}>归档目标</ThemedText>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function DetailStepRow({
  busy,
  colors,
  editMinutes,
  editStepId,
  editTitle,
  onCancelEdit,
  onComplete,
  onDelete,
  onEdit,
  onSaveEdit,
  onStart,
  onUndo,
  setEditMinutes,
  setEditTitle,
  step,
}: {
  busy: boolean;
  colors: ReturnType<typeof useAppTheme>['colors'];
  editMinutes: string;
  editStepId: string | null;
  editTitle: string;
  onCancelEdit: () => void;
  onComplete: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onSaveEdit: () => void;
  onStart: () => void;
  onUndo: () => void;
  setEditMinutes: (value: string) => void;
  setEditTitle: (value: string) => void;
  step: ProcrastinationStep;
}) {
  const editing = editStepId === step.id;
  const done = step.status === 'completed';
  return (
    <View
      style={[
        styles.detailStep,
        { backgroundColor: colors.surface, borderColor: done ? colors.line : colors.primary },
        !done && { borderWidth: 1.5 },
      ]}>
      <View style={[styles.stepNumber, { backgroundColor: done ? '#e8f6f0' : colors.primarySoft }]}>
        <MaterialCommunityIcons
          name={done ? 'check' : 'bomb'}
          size={14}
          color={done ? '#1db991' : colors.primary}
        />
      </View>
      {editing ? (
        <View style={styles.editStepBody}>
          <TextInput
            value={editTitle}
            onChangeText={setEditTitle}
            placeholder="步骤标题"
            placeholderTextColor={colors.mutedText}
            style={[styles.editInput, { color: colors.text }]}
          />
          <View style={styles.editActions}>
            <TextInput
              value={editMinutes}
              onChangeText={setEditMinutes}
              keyboardType="number-pad"
              placeholder="分钟"
              placeholderTextColor={colors.mutedText}
              style={[styles.minutesInput, { color: colors.text }]}
            />
            <Pressable onPress={onSaveEdit} style={[styles.smallActionButton, { backgroundColor: colors.hero }]}>
              <ThemedText style={styles.smallActionDarkText}>保存</ThemedText>
            </Pressable>
            <Pressable onPress={onCancelEdit} style={styles.smallGhost}>
              <ThemedText style={[styles.smallGhostText, { color: colors.mutedText }]}>取消</ThemedText>
            </Pressable>
          </View>
        </View>
      ) : (
        <>
          <View style={styles.rowMain}>
            <ThemedText
              numberOfLines={2}
              style={[styles.rowTitle, done && styles.doneTitle]}>
              {step.title}
            </ThemedText>
            <ThemedText style={[styles.rowMeta, { color: colors.mutedText }]}>
              {formatMinutes(step.estimatedMinutes)} · +{stepDisplayXP(step)} XP
              {step.actualSeconds > 0 ? ` · 实际 ${formatActualSeconds(step.actualSeconds)}` : ''}
            </ThemedText>
          </View>
          <View style={styles.detailStepActions}>
            {done ? (
              <Pressable disabled={busy} onPress={onUndo} style={[styles.miniButton, { backgroundColor: colors.primarySoft }]}>
                <MaterialCommunityIcons name="undo" size={13} color={colors.primary} />
                <ThemedText style={[styles.miniButtonText, { color: colors.primary }]}>撤销</ThemedText>
              </Pressable>
            ) : step.status === 'started' ? (
              <Pressable disabled={busy} onPress={onComplete} style={[styles.miniButton, { backgroundColor: colors.hero }]}>
                <MaterialCommunityIcons name="check" size={13} color="#c9f36a" />
                <ThemedText style={styles.miniButtonDarkText}>完成</ThemedText>
              </Pressable>
            ) : (
              <Pressable disabled={busy} onPress={onStart} style={[styles.miniButton, { backgroundColor: colors.primarySoft }]}>
                <MaterialCommunityIcons name="play" size={13} color={colors.primary} />
                <ThemedText style={[styles.miniButtonText, { color: colors.primary }]}>开始</ThemedText>
              </Pressable>
            )}
            <Pressable onPress={onEdit} hitSlop={6} style={styles.iconMiniButton}>
              <MaterialCommunityIcons name="pencil-outline" size={15} color={colors.mutedText} />
            </Pressable>
            <Pressable onPress={onDelete} hitSlop={6} style={styles.iconMiniButton}>
              <MaterialCommunityIcons name="trash-can-outline" size={15} color="#e2576f" />
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

function TabButton({
  active,
  icon,
  label,
  onPress,
}: {
  active: boolean;
  icon: IconName;
  label: string;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.tabButton, active && { backgroundColor: colors.surface }]}>
      <MaterialCommunityIcons
        name={icon}
        size={15}
        color={active ? colors.primary : colors.mutedText}
      />
      <ThemedText style={[styles.tabText, { color: active ? colors.primary : colors.mutedText }]}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

function SectionHeading({ meta, title }: { meta: string; title: string }) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.sectionHead}>
      <ThemedText style={styles.sectionTitle}>{title}</ThemedText>
      <ThemedText style={[styles.sectionMeta, { color: colors.primary }]}>{meta}</ThemedText>
    </View>
  );
}

function Field({ children, label }: { children: ReactNode; label: string }) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.field}>
      <ThemedText style={[styles.fieldLabel, { color: colors.mutedText }]}>{label}</ThemedText>
      {children}
    </View>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.heroStat}>
      <ThemedText style={styles.heroStatValue}>{value}</ThemedText>
      <ThemedText style={styles.heroStatLabel}>{label}</ThemedText>
    </View>
  );
}

function StatCard({
  icon,
  label,
  tone,
  value,
}: {
  icon: IconName;
  label: string;
  tone?: 'amber' | 'blue' | 'green';
  value: string;
}) {
  const { colors } = useAppTheme();
  const bg = tone === 'green' ? '#e8f6f0' : tone === 'amber' ? '#fff2e0' : tone === 'blue' ? colors.primarySoft : colors.primarySoft;
  const fg = tone === 'green' ? '#1db991' : tone === 'amber' ? '#d79600' : tone === 'blue' ? colors.primary : colors.primary;
  return (
    <View style={[styles.statCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <View style={[styles.statIcon, { backgroundColor: bg }]}>
        <MaterialCommunityIcons name={icon} size={15} color={fg} />
      </View>
      <ThemedText style={styles.statValue}>{value}</ThemedText>
      <ThemedText style={[styles.statLabel, { color: colors.mutedText }]}>{label}</ThemedText>
    </View>
  );
}

function EmptyState({ icon, onPress, text }: { icon: IconName; onPress: () => void; text: string }) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.emptyState, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <MaterialCommunityIcons name={icon} size={19} color={colors.mutedText} />
      <ThemedText style={[styles.emptyText, { color: colors.mutedText }]}>{text}</ThemedText>
      <MaterialCommunityIcons name="chevron-right" size={17} color={colors.mutedText} />
    </Pressable>
  );
}

function Notice({ text, tone }: { text: string; tone: 'error' | 'success' }) {
  const color = tone === 'error' ? '#d6455d' : '#1d9d78';
  return (
    <View style={[styles.notice, { backgroundColor: tone === 'error' ? '#fff0f2' : '#eaf8f2' }]}>
      <MaterialCommunityIcons
        name={tone === 'error' ? 'alert-circle-outline' : 'check-circle-outline'}
        size={15}
        color={color}
      />
      <ThemedText style={[styles.noticeText, { color }]}>{text}</ThemedText>
    </View>
  );
}

function CenterState({ icon, loading, title }: { icon: IconName; loading?: boolean; title: string }) {
  const { colors } = useAppTheme();
  return (
    <SafeAreaView style={[styles.safeArea, styles.centerState, { backgroundColor: colors.background }]}>
      {loading ? (
        <ActivityIndicator color={colors.primary} size="large" />
      ) : (
        <View style={[styles.stateIcon, { backgroundColor: colors.primarySoft }]}>
          <MaterialCommunityIcons name={icon} size={34} color={colors.primary} />
        </View>
      )}
      <ThemedText style={styles.stateTitle}>{title}</ThemedText>
    </SafeAreaView>
  );
}

function confirmNative() {
  return new Promise<boolean>((resolve) => {
    Alert.alert('确认操作', '确认继续？', [
      { text: '取消', style: 'cancel', onPress: () => resolve(false) },
      { text: '确认', onPress: () => resolve(true) },
    ]);
  });
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  screen: {
    flex: 1,
    width: '100%',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    height: 54,
    justifyContent: 'space-between',
    paddingHorizontal: 14,
  },
  headerTitleWrap: {
    flex: 1,
    paddingHorizontal: 6,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '900',
  },
  headerMeta: {
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: 999,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  addButton: {
    alignItems: 'center',
    backgroundColor: '#151b3b',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 5,
    minHeight: 34,
    paddingHorizontal: 11,
  },
  addButtonText: {
    color: '#c9f36a',
    fontSize: 11,
    fontWeight: '900',
  },
  pressed: {
    opacity: 0.78,
  },
  tabs: {
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    marginHorizontal: 14,
    padding: 3,
  },
  tabButton: {
    alignItems: 'center',
    borderRadius: 11,
    flex: 1,
    flexDirection: 'row',
    gap: 5,
    justifyContent: 'center',
    minHeight: 36,
  },
  tabText: {
    fontSize: 11,
    fontWeight: '800',
  },
  content: {
    paddingBottom: 40,
    paddingHorizontal: 14,
    paddingTop: 12,
  },
  heroCard: {
    backgroundColor: '#151b3b',
    borderRadius: 18,
    marginBottom: 12,
    padding: 15,
  },
  heroCardDark: {
    backgroundColor: '#0f1823',
  },
  heroTop: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  heroEyebrow: {
    color: '#aab6d6',
    fontSize: 9,
    fontWeight: '800',
  },
  heroTag: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  heroTagText: {
    color: '#c9f36a',
    fontSize: 9,
    fontWeight: '900',
  },
  heroTitle: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '900',
    marginTop: 9,
  },
  heroMeta: {
    fontSize: 10,
    fontWeight: '700',
    marginTop: 4,
  },
  progressTrack: {
    backgroundColor: '#30395f',
    borderRadius: 999,
    height: 7,
    marginTop: 12,
    overflow: 'hidden',
  },
  progressFill: {
    backgroundColor: '#c9f36a',
    borderRadius: 999,
    height: '100%',
  },
  heroStats: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 11,
  },
  heroStat: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    padding: 9,
  },
  heroStatValue: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '900',
  },
  heroStatLabel: {
    color: '#aab6d6',
    fontSize: 9,
    fontWeight: '700',
    marginTop: 2,
  },
  sectionHead: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
    marginTop: 6,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '900',
  },
  sectionMeta: {
    fontSize: 9,
    fontWeight: '800',
  },
  currentStep: {
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 12,
    padding: 11,
  },
  currentStepHead: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 9,
  },
  stepNumber: {
    alignItems: 'center',
    borderRadius: 10,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  stepNumberText: {
    fontSize: 11,
    fontWeight: '900',
  },
  stepMain: {
    flex: 1,
  },
  currentStepTitle: {
    fontSize: 12,
    fontWeight: '900',
    lineHeight: 16,
  },
  currentStepMeta: {
    fontSize: 9,
    fontWeight: '700',
    marginTop: 3,
  },
  xpPill: {
    backgroundColor: '#fff2e0',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  xpPillText: {
    color: '#a96700',
    fontSize: 9,
    fontWeight: '900',
  },
  currentStepActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  secondaryButton: {
    alignItems: 'center',
    borderRadius: 11,
    borderWidth: 1,
    flex: 0.45,
    flexDirection: 'row',
    gap: 5,
    justifyContent: 'center',
    minHeight: 38,
  },
  secondaryButtonText: {
    fontSize: 10,
    fontWeight: '900',
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#ff6b8f',
    borderRadius: 11,
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minHeight: 38,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '900',
  },
  goalRow: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 9,
    marginBottom: 8,
    minHeight: 56,
    padding: 9,
  },
  goalIcon: {
    alignItems: 'center',
    borderRadius: 10,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  rowMain: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    fontSize: 11,
    fontWeight: '900',
    lineHeight: 15,
  },
  rowMeta: {
    fontSize: 8.5,
    fontWeight: '600',
    marginTop: 3,
  },
  rowArchive: {
    padding: 5,
  },
  rowXP: {
    fontSize: 9,
    fontWeight: '900',
  },
  eventRow: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 9,
    marginBottom: 6,
    minHeight: 50,
    padding: 8,
  },
  eventIcon: {
    alignItems: 'center',
    borderRadius: 9,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  eventXP: {
    fontSize: 10,
    fontWeight: '900',
  },
  emptyState: {
    alignItems: 'center',
    borderRadius: 13,
    borderStyle: 'dashed',
    borderWidth: 1,
    flexDirection: 'row',
    gap: 9,
    marginBottom: 8,
    minHeight: 48,
    padding: 11,
  },
  emptyText: {
    flex: 1,
    fontSize: 10,
    fontWeight: '700',
  },
  notice: {
    alignItems: 'center',
    borderRadius: 11,
    flexDirection: 'row',
    gap: 8,
    marginBottom: 9,
    padding: 9,
  },
  noticeText: {
    flex: 1,
    fontSize: 10,
    fontWeight: '700',
  },
  levelCard: {
    alignItems: 'center',
    borderRadius: 18,
    flexDirection: 'row',
    gap: 12,
    marginBottom: 10,
    padding: 13,
  },
  levelBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderColor: 'rgba(255,255,255,0.14)',
    borderRadius: 14,
    borderWidth: 1,
    height: 62,
    justifyContent: 'center',
    width: 62,
  },
  levelBadgeValue: {
    color: '#ffffff',
    fontSize: 19,
    fontWeight: '900',
  },
  levelBadgeLabel: {
    color: '#aab6d6',
    fontSize: 8,
    fontWeight: '700',
    marginTop: 2,
  },
  levelMain: {
    flex: 1,
  },
  levelTitle: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '900',
  },
  levelMeta: {
    fontSize: 8,
    fontWeight: '700',
    marginTop: 3,
  },
  levelTrack: {
    backgroundColor: '#30395f',
    borderRadius: 999,
    height: 6,
    marginTop: 8,
    overflow: 'hidden',
  },
  levelFill: {
    backgroundColor: '#c9f36a',
    borderRadius: 999,
    height: '100%',
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  statCard: {
    borderRadius: 13,
    borderWidth: 1,
    padding: 10,
    width: '48.4%',
  },
  statIcon: {
    alignItems: 'center',
    borderRadius: 9,
    height: 27,
    justifyContent: 'center',
    marginBottom: 7,
    width: 27,
  },
  statValue: {
    fontSize: 19,
    fontWeight: '900',
  },
  statLabel: {
    fontSize: 8.5,
    fontWeight: '700',
    marginTop: 3,
  },
  chartCard: {
    borderRadius: 13,
    borderWidth: 1,
    marginBottom: 10,
    padding: 11,
  },
  barChart: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: 6,
    height: 86,
  },
  barCol: {
    alignItems: 'center',
    flex: 1,
    gap: 5,
    height: '100%',
    justifyContent: 'flex-end',
  },
  bar: {
    borderRadius: 4,
    minHeight: 4,
    width: '100%',
  },
  barLabel: {
    fontSize: 7,
    fontWeight: '700',
  },
  loginState: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 28,
  },
  stateIcon: {
    alignItems: 'center',
    borderRadius: 18,
    height: 58,
    justifyContent: 'center',
    marginBottom: 14,
    width: 58,
  },
  stateTitle: {
    fontSize: 17,
    fontWeight: '900',
    marginTop: 6,
  },
  stateText: {
    fontSize: 12,
    lineHeight: 19,
    marginTop: 7,
    textAlign: 'center',
  },
  centerState: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(9,17,38,0.42)',
  },
  modalSheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    maxHeight: '92%',
  },
  modalHeader: {
    alignItems: 'center',
    borderBottomColor: '#dce5f6',
    borderBottomWidth: 1,
    flexDirection: 'row',
    height: 50,
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  modalTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '900',
  },
  modalClose: {
    alignItems: 'center',
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  modalContent: {
    padding: 16,
    paddingBottom: 40,
  },
  field: {
    marginBottom: 10,
  },
  fieldLabel: {
    fontSize: 9,
    fontWeight: '900',
    marginBottom: 5,
  },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    fontSize: 11,
    minHeight: 42,
    paddingHorizontal: 11,
  },
  textArea: {
    minHeight: 68,
    paddingTop: 10,
    textAlignVertical: 'top',
  },
  flexInput: {
    flex: 1,
  },
  deadlineRow: {
    flexDirection: 'row',
    gap: 8,
  },
  smallActionButton: {
    alignItems: 'center',
    borderRadius: 10,
    flexDirection: 'row',
    gap: 4,
    justifyContent: 'center',
    minHeight: 32,
    paddingHorizontal: 10,
  },
  smallActionText: {
    fontSize: 9,
    fontWeight: '900',
  },
  smallActionDarkText: {
    color: '#c9f36a',
    fontSize: 9,
    fontWeight: '900',
  },
  sectionHeadRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
    marginTop: 4,
  },
  draftStep: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 7,
    marginBottom: 6,
    minHeight: 48,
    padding: 6,
  },
  draftIndex: {
    fontSize: 11,
    fontWeight: '900',
    width: 20,
  },
  draftTitleInput: {
    flex: 1,
    fontSize: 10,
    fontWeight: '700',
    minWidth: 0,
  },
  draftMinutesInput: {
    fontSize: 10,
    fontWeight: '800',
    textAlign: 'center',
    width: 46,
  },
  draftRemove: {
    alignItems: 'center',
    height: 26,
    justifyContent: 'center',
    width: 26,
  },
  addStepButton: {
    alignItems: 'center',
    borderRadius: 12,
    borderStyle: 'dashed',
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minHeight: 40,
  },
  addStepText: {
    fontSize: 10,
    fontWeight: '900',
  },
  summaryStrip: {
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
    padding: 10,
  },
  summaryCell: {
    flex: 1,
  },
  summaryValue: {
    fontSize: 15,
    fontWeight: '900',
  },
  summaryLabel: {
    fontSize: 8,
    fontWeight: '700',
    marginTop: 2,
  },
  saveButton: {
    alignItems: 'center',
    backgroundColor: '#151b3b',
    borderRadius: 14,
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    minHeight: 46,
    marginTop: 12,
  },
  saveButtonText: {
    color: '#c9f36a',
    fontSize: 13,
    fontWeight: '900',
  },
  addStepForm: {
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 7,
    marginBottom: 8,
    padding: 8,
  },
  minutesInput: {
    borderRadius: 10,
    borderWidth: 1,
    fontSize: 10,
    minHeight: 36,
    paddingHorizontal: 8,
    textAlign: 'center',
    width: 54,
  },
  detailStep: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 9,
    marginBottom: 7,
    minHeight: 54,
    padding: 8,
  },
  detailStepActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 5,
  },
  miniButton: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 4,
    minHeight: 30,
    paddingHorizontal: 8,
  },
  miniButtonText: {
    fontSize: 8.5,
    fontWeight: '900',
  },
  miniButtonDarkText: {
    color: '#c9f36a',
    fontSize: 8.5,
    fontWeight: '900',
  },
  iconMiniButton: {
    alignItems: 'center',
    height: 28,
    justifyContent: 'center',
    width: 24,
  },
  doneTitle: {
    color: '#9aa5bb',
    textDecorationLine: 'line-through',
  },
  editStepBody: {
    flex: 1,
    gap: 7,
  },
  editInput: {
    fontSize: 11,
    fontWeight: '800',
    minHeight: 34,
  },
  editActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
  },
  smallGhost: {
    paddingHorizontal: 6,
    paddingVertical: 5,
  },
  smallGhostText: {
    fontSize: 9,
    fontWeight: '800',
  },
  archiveButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 5,
    justifyContent: 'center',
    paddingVertical: 12,
  },
  archiveText: {
    fontSize: 10,
    fontWeight: '900',
  },
});
