import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import {
  ActivityIndicator,
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
import { useAppTheme } from '@/hooks/use-app-theme';
import { useAuth } from '@/features/auth/auth-provider';
import {
  addFocusHabitRecord,
  completeFocusTask,
  createFocusGoal,
  createFocusHabit,
  createFocusList,
  createFocusTask,
  deleteFocusList,
  deleteFocusTask,
  fetchFocusCalendar,
  fetchFocusHabits,
  fetchFocusLists,
  fetchFocusStats,
  fetchFocusTasks,
  fetchFocusToday,
  getFocusErrorMessage,
  removeFocusHabitRecordByDate,
  updateFocusGoal,
  updateFocusList,
  updateFocusTask,
} from '@/lib/focus-api';
import {
  currentMonthKey,
  formatFocusDate,
  formatPercent,
  formatTaskDue,
  habitFrequencyLabel,
  isOverdueTask,
  normalizeSubtaskLines,
  priorityLabel,
  repeatLabel,
  todayDateString,
  weekdayLabel,
} from '@/lib/focus';
import type {
  FocusGoal,
  FocusHabit,
  FocusList,
  FocusPriority,
  FocusRepeatRule,
  FocusStats,
  FocusTask,
  FocusToday,
} from '@/types/focus';

type FocusTab = 'today' | 'lists' | 'habits' | 'stats';
type TaskStatusFilter = 'open' | 'all';
type StatsRange = 'week' | 'month';

const PRIORITIES: FocusPriority[] = ['high', 'medium', 'low'];
const REPEAT_RULES: FocusRepeatRule[] = ['none', 'daily', 'weekly', 'monthly'];
const LIST_COLORS = ['#7e5bef', '#4b6bff', '#1db991', '#f1a33b', '#ff6b8f'];
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

export function FocusScreen() {
  const router = useRouter();
  const { accessToken, status: authStatus, user } = useAuth();
  const { colors, colorScheme } = useAppTheme();
  const dark = colorScheme === 'dark';
  const [activeTab, setActiveTab] = useState<FocusTab>('today');
  const [today, setToday] = useState<FocusToday | null>(null);
  const [lists, setLists] = useState<FocusList[]>([]);
  const [tasks, setTasks] = useState<FocusTask[]>([]);
  const [habits, setHabits] = useState<FocusHabit[]>([]);
  const [stats, setStats] = useState<FocusStats | null>(null);
  const [calendar, setCalendar] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [listFilter, setListFilter] = useState<string>('all');
  const [taskStatusFilter, setTaskStatusFilter] = useState<TaskStatusFilter>('open');
  const [statsRange, setStatsRange] = useState<StatsRange>('week');
  const [taskModal, setTaskModal] = useState<{ open: boolean; task?: FocusTask }>({ open: false });
  const [goalModalOpen, setGoalModalOpen] = useState(false);
  const [habitModalOpen, setHabitModalOpen] = useState(false);
  const [listModalOpen, setListModalOpen] = useState(false);
  const todayRef = useRef(todayDateString());
  const requestRef = useRef(0);
  const hasLoadedRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!accessToken) return;
    const requestID = ++requestRef.current;
    setLoading(!hasLoadedRef.current);
    setError(null);
    try {
      const date = todayRef.current;
      const month = currentMonthKey();
      const [todaySnapshot, listItems, habitItems, statItems, calendarItems] = await Promise.all([
        fetchFocusToday(accessToken, date),
        fetchFocusLists(accessToken),
        fetchFocusHabits(accessToken, date),
        fetchFocusStats(accessToken, statsRange),
        fetchFocusCalendar(accessToken, month),
      ]);
      if (requestID !== requestRef.current) return;
      setToday(todaySnapshot);
      setLists(listItems);
      setHabits(habitItems);
      setStats(statItems);
      setCalendar(
        Object.fromEntries(calendarItems.days.map((day) => [day.date, day.count])),
      );
      const taskItems = await fetchFocusTasks(accessToken, {
        listId: listFilter === 'all' ? undefined : listFilter,
        status: taskStatusFilter === 'open' ? 'open' : undefined,
        date,
      });
      if (requestID !== requestRef.current) return;
      setTasks(taskItems);
      setLoading(false);
      hasLoadedRef.current = true;
    } catch (nextError) {
      if (requestID !== requestRef.current) return;
      setError(getFocusErrorMessage(nextError));
      setLoading(false);
    } finally {
      if (requestID === requestRef.current) setRefreshing(false);
    }
  }, [accessToken, listFilter, statsRange, taskStatusFilter]);

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
      setError(getFocusErrorMessage(nextError));
    } finally {
      setBusy(false);
    }
  }

  async function toggleTask(task: FocusTask) {
    if (!accessToken) return;
    const completed = task.status !== 'done';
    await runMutation(
      () => completeFocusTask(accessToken, task.id, completed, todayRef.current),
      completed ? '任务已完成' : '任务已恢复',
    );
  }

  async function toggleGoal(goal: FocusGoal) {
    if (!accessToken) return;
    await runMutation(
      () => updateFocusGoal(accessToken, goal.id, { completed: !goal.completed }),
      goal.completed ? '目标已恢复' : '目标已完成',
    );
  }

  async function toggleHabit(habit: FocusHabit) {
    if (!accessToken) return;
    if (habit.todayChecked) {
      await runMutation(
        () => removeFocusHabitRecordByDate(accessToken, habit.id, todayRef.current),
        '已取消打卡',
      );
      return;
    }
    await runMutation(
      () => addFocusHabitRecord(accessToken, habit.id, todayRef.current),
      '打卡成功',
    );
  }

  async function handleDeleteTask(task: FocusTask) {
    if (!accessToken) return;
    await runMutation(() => deleteFocusTask(accessToken, task.id), '任务已删除');
  }

  async function handleDeleteList(list: FocusList) {
    if (!accessToken) return;
    await runMutation(
      async () => {
        await deleteFocusList(accessToken, list.id);
        setListFilter((current) => (current === list.id ? 'all' : current));
      },
      '清单已删除',
    );
  }

  if (authStatus === 'loading') {
    return <CenterState icon="clipboard-check-outline" title="正在打开效率清单" loading />;
  }

  if (!accessToken || !user) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
        <View style={styles.loginState}>
          <View style={[styles.stateIcon, { backgroundColor: colors.primarySoft }]}>
            <MaterialCommunityIcons name="clipboard-check-outline" size={34} color={colors.primary} />
          </View>
          <ThemedText style={styles.stateTitle}>登录后使用效率清单</ThemedText>
          <ThemedText style={[styles.stateText, { color: colors.mutedText }]}>
            任务、目标和打卡记录会保存在你的 FunBox 账号里。
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/auth', params: { returnTo: '/tools/focus-plan' } })}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
            <MaterialCommunityIcons name="login" size={18} color="#ffffff" />
            <ThemedText style={styles.primaryButtonText}>登录</ThemedText>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (loading || !today) {
    return <CenterState icon="clipboard-check-outline" title="正在整理今日清单" loading />;
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
            <ThemedText style={styles.headerTitle}>效率清单</ThemedText>
            <ThemedText style={[styles.headerMeta, { color: colors.mutedText }]}>
              {formatFocusDate(today.date)}
            </ThemedText>
          </View>
          <Pressable
            accessibilityLabel="刷新"
            accessibilityRole="button"
            hitSlop={10}
            onPress={() => {
              setRefreshing(true);
              void refresh();
            }}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
            <MaterialCommunityIcons
              name={refreshing ? 'loading' : 'refresh'}
              size={22}
              color={colors.primary}
            />
          </Pressable>
        </View>

        <View style={[styles.tabs, { backgroundColor: dark ? colors.surfaceMuted : '#e9eef8' }]}>
          <TabButton
            active={activeTab === 'today'}
            icon="sun"
            label="今日"
            onPress={() => setActiveTab('today')}
          />
          <TabButton
            active={activeTab === 'lists'}
            icon="list-status"
            label="清单"
            onPress={() => setActiveTab('lists')}
          />
          <TabButton
            active={activeTab === 'habits'}
            icon="fire"
            label="习惯"
            onPress={() => setActiveTab('habits')}
          />
          <TabButton
            active={activeTab === 'stats'}
            icon="chart-bar"
            label="统计"
            onPress={() => setActiveTab('stats')}
          />
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              onRefresh={() => {
                setRefreshing(true);
                void refresh();
              }}
              refreshing={refreshing}
              tintColor={colors.primary}
            />
          }
          showsVerticalScrollIndicator={false}>
          {error ? <Notice tone="error" text={error} /> : null}
          {message ? <Notice tone="success" text={message} /> : null}

          {activeTab === 'today' ? (
            <TodayView
              busy={busy}
              dark={dark}
              onAddGoal={() => setGoalModalOpen(true)}
              onAddTask={() => setTaskModal({ open: true })}
              onToggleGoal={(goal) => void toggleGoal(goal)}
              onToggleHabit={(habit) => void toggleHabit(habit)}
              onToggleTask={(task) => void toggleTask(task)}
              today={today}
            />
          ) : null}

          {activeTab === 'lists' ? (
            <ListsView
              busy={busy}
              dark={dark}
              lists={lists}
              listFilter={listFilter}
              onAddList={() => setListModalOpen(true)}
              onAddTask={() => setTaskModal({ open: true })}
              onDeleteList={(list) => void handleDeleteList(list)}
              onManageLists={() => setListModalOpen(true)}
              onSelectList={setListFilter}
              onStatusChange={setTaskStatusFilter}
              onToggleTask={(task) => void toggleTask(task)}
              onEditTask={(task) => setTaskModal({ open: true, task })}
              onDeleteTask={(task) => void handleDeleteTask(task)}
              statusFilter={taskStatusFilter}
              tasks={tasks}
            />
          ) : null}

          {activeTab === 'habits' ? (
            <HabitsView
              busy={busy}
              calendar={calendar}
              dark={dark}
              habits={habits}
              month={currentMonthKey()}
              onAddHabit={() => setHabitModalOpen(true)}
              onToggleHabit={(habit) => void toggleHabit(habit)}
            />
          ) : null}

          {activeTab === 'stats' ? (
            <StatsView
              onRangeChange={setStatsRange}
              range={statsRange}
              stats={stats}
            />
          ) : null}
        </ScrollView>
      </View>

      <TaskModal
        busy={busy}
        lists={lists}
        onClose={() => setTaskModal({ open: false })}
        onSave={async (input) => {
          if (!accessToken) return;
          await runMutation(
            async () => {
              if (taskModal.task) {
                await updateFocusTask(accessToken, taskModal.task.id, input);
              } else {
                await createFocusTask(accessToken, input);
              }
            },
            taskModal.task ? '任务已更新' : '任务已创建',
          );
        }}
        open={taskModal.open}
        task={taskModal.task}
      />
      <GoalModal
        busy={busy}
        onClose={() => setGoalModalOpen(false)}
        onSave={async (input) => {
          if (!accessToken) return;
          await runMutation(
            () => createFocusGoal(accessToken, { ...input, date: todayRef.current }),
            '目标已设置',
          );
        }}
        open={goalModalOpen}
        tasks={today.tasks}
      />
      <HabitModal
        busy={busy}
        onClose={() => setHabitModalOpen(false)}
        onSave={async (input) => {
          if (!accessToken) return;
          await runMutation(() => createFocusHabit(accessToken, input), '习惯已创建');
        }}
        open={habitModalOpen}
      />
      <ListModal
        busy={busy}
        lists={lists}
        onArchive={async (list) => {
          if (!accessToken) return;
          await runMutation(
            () => updateFocusList(accessToken, list.id, { archived: !list.archived }),
            list.archived ? '清单已恢复' : '清单已归档',
          );
        }}
        onClose={() => setListModalOpen(false)}
        onDelete={(list) => void handleDeleteList(list)}
        onSave={async (name, color) => {
          if (!accessToken) return;
          await runMutation(() => createFocusList(accessToken, { name, color }), '清单已创建');
        }}
        open={listModalOpen}
      />
    </SafeAreaView>
  );
}

function TodayView({
  busy,
  dark,
  onAddGoal,
  onAddTask,
  onToggleGoal,
  onToggleHabit,
  onToggleTask,
  today,
}: {
  busy: boolean;
  dark: boolean;
  onAddGoal: () => void;
  onAddTask: () => void;
  onToggleGoal: (goal: FocusGoal) => void;
  onToggleHabit: (habit: FocusHabit) => void;
  onToggleTask: (task: FocusTask) => void;
  today: FocusToday;
}) {
  const progress = today.progress;
  const taskRate = progress.taskTotal > 0 ? progress.taskCompleted / progress.taskTotal : 0;
  const completedTasks = today.tasks.filter((task) => task.status === 'done');
  const pendingTasks = today.tasks.filter((task) => task.status === 'open');
  const openHabits = today.habits.filter((habit) => !habit.archived);

  return (
    <>
      <View style={[styles.heroCard, dark && styles.heroCardDark]}>
        <View style={styles.heroTop}>
          <View>
            <ThemedText style={styles.heroEyebrow}>今日进度</ThemedText>
            <ThemedText style={styles.heroTitle}>
              完成 {progress.taskCompleted}/{progress.taskTotal}
            </ThemedText>
          </View>
          <View style={styles.heroBadge}>
            <MaterialCommunityIcons name="check-decagram" size={16} color="#151b3b" />
            <ThemedText style={styles.heroBadgeText}>{formatPercent(taskRate)}</ThemedText>
          </View>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.min(100, Math.round(taskRate * 100))}%` }]} />
        </View>
        <View style={styles.heroStats}>
          <HeroStat label="每日目标" value={`${progress.goalCompleted}/${progress.goalTotal}`} />
          <HeroStat label="今日打卡" value={`${progress.habitCompleted}/${progress.habitTotal}`} />
        </View>
      </View>

      <SectionHeader actionLabel="添加" onAction={onAddGoal} title="每日目标" />
      {today.goals.length === 0 ? (
        <EmptyRow icon="target" text="把今天最重要的 1-3 件事立为目标" />
      ) : (
        today.goals.map((goal) => (
          <Row
            busy={busy}
            key={goal.id}
            onPress={() => onToggleGoal(goal)}
            title={goal.title}
            titleDone={goal.completed}
            trailing={
              <CheckCircle checked={goal.completed} onPress={() => onToggleGoal(goal)} />
            }
          />
        ))
      )}

      <SectionHeader actionLabel="添加" onAction={onAddTask} title="今日清单" />
      {pendingTasks.length === 0 && completedTasks.length === 0 ? (
        <EmptyRow icon="clipboard-text-outline" text="今天暂时没有任务，随手记一件" />
      ) : (
        <>
          {pendingTasks.map((task) => (
            <TaskRow
              busy={busy}
              key={task.id}
              onPress={() => onToggleTask(task)}
              task={task}
              today={today.date}
            />
          ))}
          {completedTasks.map((task) => (
            <TaskRow
              busy={busy}
              key={task.id}
              onPress={() => onToggleTask(task)}
              task={task}
              today={today.date}
            />
          ))}
        </>
      )}

      <SectionHeader actionLabel={`${progress.habitCompleted}/${progress.habitTotal}`} title="今日打卡" />
      {openHabits.length === 0 ? (
        <EmptyRow icon="fire" text="还没有习惯，先建一个想坚持的小习惯" />
      ) : (
        openHabits.map((habit) => (
          <HabitRow
            busy={busy}
            key={habit.id}
            habit={habit}
            onPress={() => onToggleHabit(habit)}
          />
        ))
      )}
    </>
  );
}

function ListsView({
  busy,
  dark,
  lists,
  listFilter,
  onAddList,
  onAddTask,
  onDeleteList,
  onManageLists,
  onSelectList,
  onStatusChange,
  onToggleTask,
  onEditTask,
  onDeleteTask,
  statusFilter,
  tasks,
}: {
  busy: boolean;
  dark: boolean;
  lists: FocusList[];
  listFilter: string;
  onAddList: () => void;
  onAddTask: () => void;
  onDeleteList: (list: FocusList) => void;
  onManageLists: () => void;
  onSelectList: (listId: string) => void;
  onStatusChange: (status: TaskStatusFilter) => void;
  onToggleTask: (task: FocusTask) => void;
  onEditTask: (task: FocusTask) => void;
  onDeleteTask: (task: FocusTask) => void;
  statusFilter: TaskStatusFilter;
  tasks: FocusTask[];
}) {
  const { colors } = useAppTheme();
  const visibleLists = lists.filter((list) => !list.archived);

  return (
    <>
      <View style={styles.chipRow}>
        <FilterChip active={listFilter === 'all'} label="全部" onPress={() => onSelectList('all')} />
        {visibleLists.map((list) => (
          <FilterChip
            active={listFilter === list.id}
            color={list.color}
            key={list.id}
            label={list.name}
            onPress={() => onSelectList(list.id)}
          />
        ))}
        <Pressable
          accessibilityRole="button"
          onPress={onManageLists}
          style={({ pressed }) => [styles.manageChip, pressed && styles.pressed]}>
          <MaterialCommunityIcons name="cog-outline" size={14} color={colors.primary} />
          <ThemedText style={[styles.manageChipText, { color: colors.primary }]}>管理</ThemedText>
        </Pressable>
      </View>

      <View style={[styles.segmented, { backgroundColor: dark ? colors.surfaceMuted : '#e9eef8' }]}>
        <SegmentButton
          active={statusFilter === 'open'}
          label="进行中"
          onPress={() => onStatusChange('open')}
        />
        <SegmentButton
          active={statusFilter === 'all'}
          label="全部"
          onPress={() => onStatusChange('all')}
        />
      </View>

      <SectionHeader actionLabel="新建" onAction={onAddTask} title={`任务 ${tasks.length}`} />
      {tasks.length === 0 ? (
        <EmptyRow icon="clipboard-text-outline" text="这个视图下还没有任务" />
      ) : (
        tasks.map((task) => (
          <View key={task.id}>
            <TaskRow
              busy={busy}
              editable
              onDelete={() => onDeleteTask(task)}
              onEdit={() => onEditTask(task)}
              onPress={() => onToggleTask(task)}
              task={task}
            />
            {task.subtasks.length > 0 ? (
              <View style={[styles.subtaskWrap, { borderColor: colors.line }]}>
                {task.subtasks.map((subtask) => (
                  <View key={subtask.id} style={styles.subtaskRow}>
                    <MaterialCommunityIcons
                      name={subtask.status === 'done' ? 'check-circle' : 'circle-outline'}
                      size={14}
                      color={subtask.status === 'done' ? colors.success : colors.mutedText}
                    />
                    <ThemedText
                      numberOfLines={1}
                      style={[
                        styles.subtaskText,
                        { color: subtask.status === 'done' ? colors.mutedText : colors.text },
                        subtask.status === 'done' && styles.doneText,
                      ]}>
                      {subtask.title}
                    </ThemedText>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ))
      )}
    </>
  );
}

function HabitsView({
  busy,
  calendar,
  dark,
  habits,
  month,
  onAddHabit,
  onToggleHabit,
}: {
  busy: boolean;
  calendar: Record<string, number>;
  dark: boolean;
  habits: FocusHabit[];
  month: string;
  onAddHabit: () => void;
  onToggleHabit: (habit: FocusHabit) => void;
}) {
  const { colors } = useAppTheme();
  const activeHabits = habits.filter((habit) => !habit.archived);
  const maxStreak = activeHabits.reduce((max, habit) => Math.max(max, habit.streakDays), 0);
  const totalRecords = activeHabits.reduce((sum, habit) => sum + habit.totalRecords, 0);
  const grid = useMemo(() => buildMonthGrid(month), [month]);
  const doneCount = activeHabits.filter((habit) => habit.todayChecked).length;

  return (
    <>
      <View style={styles.summaryStrip}>
        <SummaryCell label="今日打卡" value={`${doneCount}/${activeHabits.length}`} />
        <SummaryCell label="最长连续" value={`${maxStreak} 天`} />
        <SummaryCell label="累计打卡" value={`${totalRecords} 次`} />
      </View>

      <SectionHeader actionLabel="新建" onAction={onAddHabit} title="我的习惯" />
      {activeHabits.length === 0 ? (
        <EmptyRow icon="fire" text="还没有习惯，先建一个想坚持的小习惯" />
      ) : (
        activeHabits.map((habit) => (
          <HabitRow
            busy={busy}
            key={habit.id}
            habit={habit}
            onPress={() => onToggleHabit(habit)}
          />
        ))
      )}

      <SectionHeader actionLabel={month} title="打卡热力图" />
      <View style={[styles.heatmapCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <View style={styles.heatGrid}>
          {grid.map((day, index) => (
            <View
              key={`${day.date}-${index}`}
              style={[
                styles.heatCell,
                {
                  backgroundColor: day.count === 0
                    ? (dark ? colors.surfaceMuted : '#e9eef8')
                    : heatColor(day.count),
                },
              ]}
            />
          ))}
        </View>
        <View style={styles.weekdayRow}>
          {['一', '二', '三', '四', '五', '六', '日'].map((name) => (
            <ThemedText key={name} style={[styles.weekdayText, { color: colors.mutedText }]}>
              {name}
            </ThemedText>
          ))}
        </View>
      </View>
    </>
  );
}

function StatsView({
  onRangeChange,
  range,
  stats,
}: {
  onRangeChange: (range: StatsRange) => void;
  range: StatsRange;
  stats: FocusStats | null;
}) {
  const { colors } = useAppTheme();
  if (!stats) {
    return <EmptyRow icon="chart-bar" text="统计正在生成中" />;
  }
  const maxCount = Math.max(1, ...stats.last7Days.map((day) => day.count));

  return (
    <>
      <View style={[styles.segmented, { backgroundColor: colors.surfaceMuted }]}>
        <SegmentButton
          active={range === 'week'}
          label="本周"
          onPress={() => onRangeChange('week')}
        />
        <SegmentButton
          active={range === 'month'}
          label="本月"
          onPress={() => onRangeChange('month')}
        />
      </View>

      <View style={styles.statGrid}>
        <StatCard
          icon="list-checks"
          label="任务完成率"
          tone="purple"
          value={formatPercent(stats.taskRate)}
        />
        <StatCard
          icon="target"
          label="目标达成"
          tone="green"
          value={`${stats.goalCompleted}/${stats.goalTotal}`}
        />
        <StatCard
          icon="fire"
          label="最长连续"
          tone="amber"
          value={`${stats.habitStreakMax} 天`}
        />
        <StatCard
          icon="calendar-check"
          label="累计打卡"
          tone="blue"
          value={`${stats.habitTotalRecords} 次`}
        />
      </View>

      <SectionHeader title="近 7 天完成任务" />
      <View style={[styles.chartCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <View style={styles.barChart}>
          {stats.last7Days.map((day, index) => (
            <View key={day.date} style={styles.barCol}>
              <View
                style={[
                  styles.bar,
                  {
                    backgroundColor: index === 5 || index === 6 ? '#1db991' : '#9b83ff',
                    height: `${Math.max(8, Math.round((day.count / maxCount) * 100))}%`,
                  },
                ]}
              />
              <ThemedText style={[styles.barLabel, { color: colors.mutedText }]}>
                {day.date.slice(5).replace('-', '/')}
              </ThemedText>
            </View>
          ))}
        </View>
      </View>

      <SectionHeader title="完成分布" />
      <View style={[styles.distCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        {stats.byList.length === 0 ? (
          <ThemedText style={[styles.emptyText, { color: colors.mutedText }]}>暂无完成记录</ThemedText>
        ) : (
          stats.byList.map((item) => {
            const max = Math.max(1, ...stats.byList.map((list) => list.count));
            return (
              <View key={item.listId} style={styles.distRow}>
                <View style={[styles.distDot, { backgroundColor: item.color }]} />
                <ThemedText style={styles.distName}>{item.name}</ThemedText>
                <View style={[styles.distTrack, { backgroundColor: colors.surfaceMuted }]}>
                  <View
                    style={[styles.distFill, { backgroundColor: item.color, width: `${(item.count / max) * 100}%` }]}
                  />
                </View>
                <ThemedText style={[styles.distValue, { color: colors.mutedText }]}>{item.count} 项</ThemedText>
              </View>
            );
          })
        )}
      </View>
    </>
  );
}

function TaskModal({
  busy,
  lists,
  onClose,
  onSave,
  open,
  task,
}: {
  busy: boolean;
  lists: FocusList[];
  onClose: () => void;
  onSave: (input: {
    title: string;
    listId?: string;
    priority: FocusPriority;
    dueDate: string;
    dueTime: string;
    repeatRule: FocusRepeatRule;
    note: string;
    subtasks: { title: string; priority?: FocusPriority }[];
  }) => Promise<void>;
  open: boolean;
  task?: FocusTask;
}) {
  const { colors } = useAppTheme();
  const [title, setTitle] = useState(task?.title ?? '');
  const [listId, setListId] = useState(task?.listId ?? lists[0]?.id ?? '');
  const [priority, setPriority] = useState<FocusPriority>(task?.priority ?? 'medium');
  const [dueDate, setDueDate] = useState(task?.dueDate ?? '');
  const [dueTime, setDueTime] = useState(task?.dueTime ?? '');
  const [repeatRule, setRepeatRule] = useState<FocusRepeatRule>(task?.repeatRule ?? 'none');
  const [note, setNote] = useState(task?.note ?? '');
  const [subtasks, setSubtasks] = useState(
    task?.subtasks.map((subtask) => subtask.title).join('\n') ?? '',
  );

  useEffect(() => {
    if (!open) return;
    setTitle(task?.title ?? '');
    setListId(task?.listId ?? lists[0]?.id ?? '');
    setPriority(task?.priority ?? 'medium');
    setDueDate(task?.dueDate ?? '');
    setDueTime(task?.dueTime ?? '');
    setRepeatRule(task?.repeatRule ?? 'none');
    setNote(task?.note ?? '');
    setSubtasks(task?.subtasks.map((subtask) => subtask.title).join('\n') ?? '');
  }, [lists, open, task]);

  async function handleSave() {
    if (!title.trim()) return;
    await onSave({
      title: title.trim(),
      listId: listId || undefined,
      priority,
      dueDate: dueDate.trim(),
      dueTime: dueTime.trim(),
      repeatRule,
      note: note.trim(),
      subtasks: normalizeSubtaskLines(subtasks).map((subtaskTitle) => ({ title: subtaskTitle })),
    });
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} title={task ? '编辑任务' : '新建任务'}>
      <Field label="标题" required>
        <TextInput
          accessibilityLabel="任务标题"
          autoFocus
          onChangeText={setTitle}
          placeholder="例如：评审效率清单设计稿"
          placeholderTextColor={colors.mutedText}
          style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.line, color: colors.text }]}
          value={title}
        />
      </Field>

      <Field label="清单">
        <View style={styles.chipRow}>
          {lists.filter((list) => !list.archived).map((list) => (
            <FilterChip
              active={listId === list.id}
              color={list.color}
              key={list.id}
              label={list.name}
              onPress={() => setListId(list.id)}
            />
          ))}
        </View>
      </Field>

      <Field label="优先级">
        <View style={[styles.segmented, { backgroundColor: colors.surfaceMuted }]}>
          {PRIORITIES.map((item) => (
            <SegmentButton
              active={priority === item}
              key={item}
              label={priorityLabel(item)}
              onPress={() => setPriority(item)}
            />
          ))}
        </View>
      </Field>

      <View style={styles.twoColumn}>
        <Field label="日期 YYYY-MM-DD">
          <TextInput
            accessibilityLabel="任务日期"
            onChangeText={setDueDate}
            placeholder="2026-08-01"
            placeholderTextColor={colors.mutedText}
            style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.line, color: colors.text }]}
            value={dueDate}
          />
        </Field>
        <Field label="时间 HH:MM">
          <TextInput
            accessibilityLabel="任务时间"
            onChangeText={setDueTime}
            placeholder="09:30"
            placeholderTextColor={colors.mutedText}
            style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.line, color: colors.text }]}
            value={dueTime}
          />
        </Field>
      </View>

      <Field label="重复">
        <View style={[styles.segmented, { backgroundColor: colors.surfaceMuted }]}>
          {REPEAT_RULES.map((item) => (
            <SegmentButton
              active={repeatRule === item}
              key={item}
              label={repeatLabel(item)}
              onPress={() => setRepeatRule(item)}
            />
          ))}
        </View>
      </Field>

      <Field label="子任务（每行一条）">
        <TextInput
          accessibilityLabel="子任务"
          multiline
          onChangeText={setSubtasks}
          placeholder={'写大纲\n校对成稿'}
          placeholderTextColor={colors.mutedText}
          style={[styles.input, styles.multilineInput, { backgroundColor: colors.surface, borderColor: colors.line, color: colors.text }]}
          value={subtasks}
        />
      </Field>

      <Field label="备注">
        <TextInput
          accessibilityLabel="任务备注"
          multiline
          onChangeText={setNote}
          placeholder="补充说明（可选）"
          placeholderTextColor={colors.mutedText}
          style={[styles.input, styles.multilineInput, { backgroundColor: colors.surface, borderColor: colors.line, color: colors.text }]}
          value={note}
        />
      </Field>

      <PrimaryButton
        busy={busy}
        icon="check"
        label={task ? '保存修改' : '创建任务'}
        onPress={() => void handleSave()}
      />
    </Sheet>
  );
}

function GoalModal({
  busy,
  onClose,
  onSave,
  open,
  tasks,
}: {
  busy: boolean;
  onClose: () => void;
  onSave: (input: { title: string; sourceTaskId?: string }) => Promise<void>;
  open: boolean;
  tasks: FocusTask[];
}) {
  const { colors } = useAppTheme();
  const [mode, setMode] = useState<'custom' | 'task'>('custom');
  const [title, setTitle] = useState('');
  const [sourceTaskId, setSourceTaskId] = useState('');

  useEffect(() => {
    if (!open) return;
    setMode('custom');
    setTitle('');
    setSourceTaskId('');
  }, [open]);

  async function handleSave() {
    if (mode === 'task' && sourceTaskId) {
      const task = tasks.find((item) => item.id === sourceTaskId);
      if (task) {
        await onSave({ title: task.title, sourceTaskId: task.id });
        onClose();
      }
      return;
    }
    if (!title.trim()) return;
    await onSave({ title: title.trim() });
    onClose();
  }

  return (
    <Sheet onClose={onClose} open={open} title="设置每日目标">
      <View style={[styles.segmented, { backgroundColor: colors.surfaceMuted }]}>
        <SegmentButton active={mode === 'custom'} label="自定义" onPress={() => setMode('custom')} />
        <SegmentButton active={mode === 'task'} label="引用任务" onPress={() => setMode('task')} />
      </View>
      {mode === 'custom' ? (
        <Field label="目标内容">
          <TextInput
            accessibilityLabel="每日目标"
            autoFocus
            onChangeText={setTitle}
            placeholder="例如：完成市场雷达 2.0 文档"
            placeholderTextColor={colors.mutedText}
            style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.line, color: colors.text }]}
            value={title}
          />
        </Field>
      ) : (
        <Field label="选择今日任务">
          <View style={styles.goalTaskList}>
            {tasks.filter((task) => task.status === 'open').map((task) => (
              <Pressable
                key={task.id}
                onPress={() => setSourceTaskId(task.id)}
                style={[
                  styles.goalTaskRow,
                  { backgroundColor: colors.surface, borderColor: sourceTaskId === task.id ? colors.primary : colors.line },
                ]}>
                <MaterialCommunityIcons
                  name={sourceTaskId === task.id ? 'radiobox-marked' : 'radiobox-blank'}
                  size={18}
                  color={sourceTaskId === task.id ? colors.primary : colors.mutedText}
                />
                <ThemedText numberOfLines={1} style={styles.goalTaskText}>{task.title}</ThemedText>
              </Pressable>
            ))}
            {tasks.filter((task) => task.status === 'open').length === 0 ? (
              <ThemedText style={[styles.emptyText, { color: colors.mutedText }]}>
                今天还没有可引用的任务，请先创建任务。
              </ThemedText>
            ) : null}
          </View>
        </Field>
      )}
      <PrimaryButton
        busy={busy}
        icon="target"
        label="设置目标"
        onPress={() => void handleSave()}
      />
    </Sheet>
  );
}

function HabitModal({
  busy,
  onClose,
  onSave,
  open,
}: {
  busy: boolean;
  onClose: () => void;
  onSave: (input: {
    name: string;
    frequency: 'daily' | 'weekly';
    weekdays: number[];
    reminderTime: string;
    color: string;
  }) => Promise<void>;
  open: boolean;
}) {
  const { colors } = useAppTheme();
  const [name, setName] = useState('');
  const [frequency, setFrequency] = useState<'daily' | 'weekly'>('daily');
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [reminderTime, setReminderTime] = useState('');
  const [color, setColor] = useState('#7e5bef');

  useEffect(() => {
    if (!open) return;
    setName('');
    setFrequency('daily');
    setWeekdays([1, 2, 3, 4, 5]);
    setReminderTime('');
    setColor('#7e5bef');
  }, [open]);

  async function handleSave() {
    if (!name.trim()) return;
    await onSave({
      name: name.trim(),
      frequency,
      weekdays: frequency === 'daily' ? [] : weekdays,
      reminderTime: reminderTime.trim(),
      color,
    });
    onClose();
  }

  return (
    <Sheet onClose={onClose} open={open} title="新建习惯">
      <Field label="习惯名称" required>
        <TextInput
          accessibilityLabel="习惯名称"
          autoFocus
          onChangeText={setName}
          placeholder="例如：喝水 8 杯"
          placeholderTextColor={colors.mutedText}
          style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.line, color: colors.text }]}
          value={name}
        />
      </Field>
      <Field label="频率">
        <View style={[styles.segmented, { backgroundColor: colors.surfaceMuted }]}>
          <SegmentButton active={frequency === 'daily'} label="每天" onPress={() => setFrequency('daily')} />
          <SegmentButton active={frequency === 'weekly'} label="每周" onPress={() => setFrequency('weekly')} />
        </View>
      </Field>
      {frequency === 'weekly' ? (
        <Field label="重复星期">
          <View style={styles.chipRow}>
            {WEEKDAYS.map((weekday) => (
              <FilterChip
                active={weekdays.includes(weekday)}
                key={weekday}
                label={weekdayLabel(weekday)}
                onPress={() => setWeekdays((current) => (
                  current.includes(weekday)
                    ? current.filter((item) => item !== weekday)
                    : [...current, weekday].sort()
                ))}
              />
            ))}
          </View>
        </Field>
      ) : null}
      <View style={styles.twoColumn}>
        <Field label="提醒时间 HH:MM">
          <TextInput
            accessibilityLabel="提醒时间"
            onChangeText={setReminderTime}
            placeholder="20:00"
            placeholderTextColor={colors.mutedText}
            style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.line, color: colors.text }]}
            value={reminderTime}
          />
        </Field>
        <Field label="颜色">
          <View style={styles.colorRow}>
            {LIST_COLORS.map((item) => (
              <Pressable
                accessibilityLabel={`颜色 ${item}`}
                key={item}
                onPress={() => setColor(item)}
                style={[
                  styles.colorSwatch,
                  { backgroundColor: item, borderColor: color === item ? colors.text : 'transparent' },
                ]}
              />
            ))}
          </View>
        </Field>
      </View>
      <PrimaryButton
        busy={busy}
        icon="fire"
        label="创建习惯"
        onPress={() => void handleSave()}
      />
    </Sheet>
  );
}

function ListModal({
  busy,
  lists,
  onArchive,
  onClose,
  onDelete,
  onSave,
  open,
}: {
  busy: boolean;
  lists: FocusList[];
  onArchive: (list: FocusList) => void;
  onClose: () => void;
  onDelete: (list: FocusList) => void;
  onSave: (name: string, color: string) => Promise<void>;
  open: boolean;
}) {
  const { colors } = useAppTheme();
  const [name, setName] = useState('');
  const [color, setColor] = useState('#7e5bef');

  useEffect(() => {
    if (!open) return;
    setName('');
    setColor('#7e5bef');
  }, [open]);

  async function handleSave() {
    if (!name.trim()) return;
    await onSave(name.trim(), color);
    setName('');
  }

  return (
    <Sheet onClose={onClose} open={open} title="管理清单">
      <Field label="新建清单名称" required>
        <TextInput
          accessibilityLabel="清单名称"
          autoFocus
          onChangeText={setName}
          placeholder="例如：工作"
          placeholderTextColor={colors.mutedText}
          style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.line, color: colors.text }]}
          value={name}
        />
      </Field>
      <Field label="颜色">
        <View style={styles.colorRow}>
          {LIST_COLORS.map((item) => (
            <Pressable
              accessibilityLabel={`颜色 ${item}`}
              key={item}
              onPress={() => setColor(item)}
              style={[
                styles.colorSwatch,
                { backgroundColor: item, borderColor: color === item ? colors.text : 'transparent' },
              ]}
            />
          ))}
        </View>
      </Field>
      <PrimaryButton
        busy={busy}
        icon="plus"
        label="创建清单"
        onPress={() => void handleSave()}
      />

      <SectionHeader title="已有清单" />
      {lists.map((list) => (
        <View key={list.id} style={[styles.manageRow, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <View style={[styles.distDot, { backgroundColor: list.color }]} />
          <ThemedText style={styles.manageName}>{list.name}{list.archived ? '（已归档）' : ''}</ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={() => onArchive(list)}
            style={({ pressed }) => [styles.smallIconButton, pressed && styles.pressed]}>
            <MaterialCommunityIcons
              name={list.archived ? 'archive-arrow-up-outline' : 'archive-arrow-down-outline'}
              size={17}
              color={colors.primary}
            />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => onDelete(list)}
            style={({ pressed }) => [styles.smallIconButton, pressed && styles.pressed]}>
            <MaterialCommunityIcons name="trash-can-outline" size={17} color="#e2576f" />
          </Pressable>
        </View>
      ))}
    </Sheet>
  );
}

function Sheet({
  children,
  onClose,
  open,
  title,
}: {
  children: ReactNode;
  onClose: () => void;
  open: boolean;
  title: string;
}) {
  const { colors } = useAppTheme();
  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      transparent
      visible={open}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.sheetRoot}>
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.sheetBackdrop} />
        <View style={[styles.sheet, { backgroundColor: colors.background, borderColor: colors.line }]}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <ThemedText style={styles.sheetTitle}>{title}</ThemedText>
            <Pressable
              accessibilityLabel="关闭"
              accessibilityRole="button"
              hitSlop={10}
              onPress={onClose}
              style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
              <MaterialCommunityIcons name="close" size={20} color={colors.text} />
            </Pressable>
          </View>
          <ScrollView
            contentContainerStyle={styles.sheetContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Field({ children, label, required }: { children: ReactNode; label: string; required?: boolean }) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.field}>
      <ThemedText style={[styles.fieldLabel, { color: colors.mutedText }]}>
        {label}{required ? ' *' : ''}
      </ThemedText>
      {children}
    </View>
  );
}

function PrimaryButton({
  busy,
  icon,
  label,
  onPress,
}: {
  busy: boolean;
  icon: string;
  label: string;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [styles.primaryButton, { backgroundColor: colors.primary }, pressed && styles.pressed]}>
      {busy ? (
        <ActivityIndicator color="#ffffff" size="small" />
      ) : (
        <MaterialCommunityIcons name={icon as never} size={18} color="#ffffff" />
      )}
      <ThemedText style={styles.primaryButtonText}>{busy ? '处理中' : label}</ThemedText>
    </Pressable>
  );
}

function SectionHeader({ actionLabel, onAction, title }: { actionLabel?: string; onAction?: () => void; title: string }) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.sectionHeader}>
      <ThemedText style={styles.sectionTitle}>{title}</ThemedText>
      {actionLabel && onAction ? (
        <Pressable accessibilityRole="button" onPress={onAction} style={({ pressed }) => pressed && styles.pressed}>
          <ThemedText style={[styles.sectionAction, { color: colors.primary }]}>{actionLabel}</ThemedText>
        </Pressable>
      ) : actionLabel ? (
        <ThemedText style={[styles.sectionAction, { color: colors.mutedText }]}>{actionLabel}</ThemedText>
      ) : null}
    </View>
  );
}

function TabButton({ active, icon, label, onPress }: { active: boolean; icon: string; label: string; onPress: () => void }) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.tabButton, active && { backgroundColor: colors.surface }, pressed && styles.pressed]}>
      <MaterialCommunityIcons name={icon as never} size={16} color={active ? '#7e5bef' : colors.mutedText} />
      <ThemedText style={[styles.tabText, { color: active ? '#7e5bef' : colors.mutedText }]}>{label}</ThemedText>
    </Pressable>
  );
}

function SegmentButton({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.segmentButton, active && { backgroundColor: colors.surface }, pressed && styles.pressed]}>
      <ThemedText style={[styles.segmentText, { color: active ? '#7e5bef' : colors.mutedText }]}>{label}</ThemedText>
    </Pressable>
  );
}

function FilterChip({ active, color, label, onPress }: { active: boolean; color?: string; label: string; onPress: () => void }) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.filterChip,
        { borderColor: active ? (color ?? '#7e5bef') : colors.line, backgroundColor: active ? (color ?? '#7e5bef') : colors.surface },
        pressed && styles.pressed,
      ]}>
      {color && !active ? <View style={[styles.chipDot, { backgroundColor: color }]} /> : null}
      <ThemedText style={[styles.filterChipText, { color: active ? '#ffffff' : colors.text }]}>{label}</ThemedText>
    </Pressable>
  );
}

function CheckCircle({ checked, onPress }: { checked: boolean; onPress: () => void }) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityLabel={checked ? '取消完成' : '标记完成'}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      hitSlop={8}
      onPress={onPress}
      style={[
        styles.checkCircle,
        { borderColor: checked ? '#7e5bef' : colors.line, backgroundColor: checked ? '#7e5bef' : colors.surface },
      ]}>
      {checked ? <MaterialCommunityIcons name="check" size={14} color="#ffffff" /> : null}
    </Pressable>
  );
}

function Row({
  busy,
  onPress,
  title,
  titleDone,
  trailing,
}: {
  busy: boolean;
  onPress: () => void;
  title: string;
  titleDone?: boolean;
  trailing: ReactNode;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { backgroundColor: colors.surface, borderColor: colors.line }, pressed && styles.pressed]}>
      <ThemedText
        numberOfLines={2}
        style={[styles.rowTitle, { color: titleDone ? colors.mutedText : colors.text }, titleDone && styles.doneText]}>
        {title}
      </ThemedText>
      {trailing}
    </Pressable>
  );
}

function TaskRow({
  busy,
  editable,
  onDelete,
  onEdit,
  onPress,
  task,
  today,
}: {
  busy: boolean;
  editable?: boolean;
  onDelete?: () => void;
  onEdit?: () => void;
  onPress: () => void;
  task: FocusTask;
  today?: string;
}) {
  const { colors } = useAppTheme();
  const done = task.status === 'done';
  const overdue = isOverdueTask(task, today);
  return (
    <View style={[styles.taskRow, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <CheckCircle checked={done} onPress={onPress} />
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={onPress}
        style={styles.taskBody}>
        <ThemedText
          numberOfLines={2}
          style={[styles.rowTitle, { color: done ? colors.mutedText : colors.text }, done && styles.doneText]}>
          {task.title}
        </ThemedText>
        <View style={styles.taskMetaRow}>
          <ThemedText style={[styles.taskMeta, { color: colors.mutedText }]}>
            {formatTaskDue(task, today)}
          </ThemedText>
          <View style={[styles.priorityPill, { backgroundColor: priorityTone(task.priority).bg, }]}>
            <ThemedText style={[styles.priorityText, { color: priorityTone(task.priority).fg }]}>
              {priorityLabel(task.priority)}
            </ThemedText>
          </View>
          {overdue ? (
            <View style={[styles.priorityPill, { backgroundColor: '#fdf1e1' }]}>
              <ThemedText style={[styles.priorityText, { color: '#d79600' }]}>逾期</ThemedText>
            </View>
          ) : null}
          {task.repeatRule !== 'none' ? (
            <MaterialCommunityIcons name="repeat" size={13} color={colors.mutedText} />
          ) : null}
        </View>
      </Pressable>
      {editable ? (
        <View style={styles.taskActions}>
          <Pressable
            accessibilityLabel="编辑任务"
            accessibilityRole="button"
            hitSlop={6}
            onPress={onEdit}
            style={({ pressed }) => [styles.smallIconButton, pressed && styles.pressed]}>
            <MaterialCommunityIcons name="pencil-outline" size={17} color={colors.primary} />
          </Pressable>
          <Pressable
            accessibilityLabel="删除任务"
            accessibilityRole="button"
            hitSlop={6}
            onPress={onDelete}
            style={({ pressed }) => [styles.smallIconButton, pressed && styles.pressed]}>
            <MaterialCommunityIcons name="trash-can-outline" size={17} color="#e2576f" />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function HabitRow({ busy, habit, onPress }: { busy: boolean; habit: FocusHabit; onPress: () => void }) {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.habitRow, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <View style={[styles.habitIcon, { backgroundColor: habitTone(habit.color).bg }]}>
        <MaterialCommunityIcons name={habitIconName(habit.icon)} size={17} color={habit.color} />
      </View>
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={onPress}
        style={styles.taskBody}>
        <ThemedText style={[styles.rowTitle, { color: colors.text }]}>{habit.name}</ThemedText>
        <ThemedText style={[styles.taskMeta, { color: colors.mutedText }]}>
          {habitFrequencyLabel(habit)}{habit.reminderTime ? ` · ${habit.reminderTime}` : ''}
        </ThemedText>
      </Pressable>
      <View style={styles.habitTrailing}>
        <View style={styles.streakRow}>
          <MaterialCommunityIcons name="fire" size={13} color="#ff8b6b" />
          <ThemedText style={[styles.streakText, { color: colors.mutedText }]}>{habit.streakDays} 天</ThemedText>
        </View>
        <CheckCircle checked={habit.todayChecked} onPress={onPress} />
      </View>
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

function SummaryCell({ label, value }: { label: string; value: string }) {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.summaryCell, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <ThemedText style={[styles.summaryValue, { color: colors.text }]}>{value}</ThemedText>
      <ThemedText style={[styles.summaryLabel, { color: colors.mutedText }]}>{label}</ThemedText>
    </View>
  );
}

function StatCard({ icon, label, tone, value }: { icon: string; label: string; tone: 'purple' | 'green' | 'amber' | 'blue'; value: string }) {
  const { colors } = useAppTheme();
  const toneStyle = statTone(tone);
  return (
    <View style={[styles.statCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <View style={[styles.statIcon, { backgroundColor: toneStyle.bg }]}>
        <MaterialCommunityIcons name={icon as never} size={16} color={toneStyle.fg} />
      </View>
      <ThemedText style={[styles.statValue, { color: colors.text }]}>{value}</ThemedText>
      <ThemedText style={[styles.statLabel, { color: colors.mutedText }]}>{label}</ThemedText>
    </View>
  );
}

function EmptyRow({ icon, text }: { icon: string; text: string }) {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.emptyRow, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <MaterialCommunityIcons name={icon as never} size={20} color={colors.mutedText} />
      <ThemedText style={[styles.emptyText, { color: colors.mutedText }]}>{text}</ThemedText>
    </View>
  );
}

function Notice({ text, tone }: { text: string; tone: 'error' | 'success' }) {
  const color = tone === 'error' ? '#d6455d' : '#1d9d78';
  return (
    <View style={[styles.notice, { backgroundColor: tone === 'error' ? '#fff0f2' : '#eaf8f2' }]}>
      <MaterialCommunityIcons
        name={tone === 'error' ? 'alert-circle-outline' : 'check-circle-outline'}
        size={16}
        color={color}
      />
      <ThemedText style={[styles.noticeText, { color }]}>{text}</ThemedText>
    </View>
  );
}

function CenterState({ icon, loading, title }: { icon: string; loading?: boolean; title: string }) {
  const { colors } = useAppTheme();
  return (
    <SafeAreaView style={[styles.safeArea, styles.centerState, { backgroundColor: colors.background }]}>
      {loading ? (
        <ActivityIndicator color={colors.primary} size="large" />
      ) : (
        <View style={[styles.stateIcon, { backgroundColor: colors.primarySoft }]}>
          <MaterialCommunityIcons name={icon as never} size={34} color={colors.primary} />
        </View>
      )}
      <ThemedText style={styles.stateTitle}>{title}</ThemedText>
    </SafeAreaView>
  );
}

function buildMonthGrid(month: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  const firstDay = new Date(year, monthNumber - 1, 1);
  const offset = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;
  const daysInMonth = new Date(year, monthNumber, 0).getDate();
  const cells: { date: string; count: number }[] = [];
  for (let i = 0; i < offset; i++) {
    cells.push({ date: '', count: 0 });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${month}-${String(day).padStart(2, '0')}`;
    cells.push({ date, count: 0 });
  }
  while (cells.length % 7 !== 0) {
    cells.push({ date: '', count: 0 });
  }
  return cells;
}

function heatColor(count: number) {
  if (count >= 4) return '#7e5bef';
  if (count === 3) return '#9b83ff';
  if (count === 2) return '#c3b7ff';
  return '#e0dcff';
}

function priorityTone(priority: FocusPriority) {
  if (priority === 'high') return { bg: '#ffe9ee', fg: '#e2576f' };
  if (priority === 'low') return { bg: '#eef5ef', fg: '#1d9d78' };
  return { bg: '#e7ecff', fg: '#4b6bff' };
}

function habitTone(color: string) {
  if (color.toLowerCase() === '#1db991') return { bg: '#e8f6f0' };
  if (color.toLowerCase() === '#4b6bff') return { bg: '#e7ecff' };
  if (color.toLowerCase() === '#f1a33b') return { bg: '#fff2e0' };
  return { bg: '#f0edff' };
}

function habitIconName(icon: string): ComponentProps<typeof MaterialCommunityIcons>['name'] {
  const known: Record<string, ComponentProps<typeof MaterialCommunityIcons>['name']> = {
    'book-open-variant': 'book-open-variant',
    droplets: 'water-outline',
    dumbbell: 'dumbbell',
    moon: 'weather-night',
  };
  return known[icon] ?? 'check-circle-outline';
}

function statTone(tone: 'purple' | 'green' | 'amber' | 'blue') {
  switch (tone) {
    case 'green':
      return { bg: '#e8f6f0', fg: '#1d9d78' };
    case 'amber':
      return { bg: '#fff2e0', fg: '#d79600' };
    case 'blue':
      return { bg: '#e7ecff', fg: '#4b6bff' };
    default:
      return { bg: '#f0edff', fg: '#7e5bef' };
  }
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
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 8,
  },
  headerTitleWrap: {
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '900',
  },
  headerMeta: {
    fontSize: 10,
    marginTop: 2,
  },
  iconButton: {
    alignItems: 'center',
    borderColor: '#dde6fb',
    borderRadius: 12,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  pressed: {
    opacity: 0.72,
  },
  tabs: {
    borderRadius: 13,
    flexDirection: 'row',
    gap: 4,
    marginHorizontal: 14,
    marginTop: 12,
    padding: 4,
  },
  tabButton: {
    alignItems: 'center',
    borderRadius: 10,
    flex: 1,
    flexDirection: 'row',
    gap: 5,
    justifyContent: 'center',
    minHeight: 40,
  },
  tabText: {
    fontSize: 11,
    fontWeight: '800',
  },
  scrollContent: {
    gap: 10,
    paddingBottom: 30,
    paddingHorizontal: 14,
    paddingTop: 12,
  },
  heroCard: {
    backgroundColor: '#151b3b',
    borderRadius: 16,
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
    fontSize: 10,
    fontWeight: '700',
  },
  heroTitle: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '900',
    marginTop: 3,
  },
  heroBadge: {
    alignItems: 'center',
    backgroundColor: '#c9f36a',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  heroBadgeText: {
    color: '#151b3b',
    fontSize: 11,
    fontWeight: '900',
  },
  progressTrack: {
    backgroundColor: '#30395f',
    borderRadius: 999,
    height: 8,
    marginTop: 13,
    overflow: 'hidden',
  },
  progressFill: {
    backgroundColor: '#c9f36a',
    borderRadius: 999,
    height: '100%',
  },
  heroStats: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 13,
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
    fontSize: 16,
    fontWeight: '900',
  },
  heroStatLabel: {
    color: '#aab6d6',
    fontSize: 9,
    marginTop: 2,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
    paddingHorizontal: 2,
    paddingVertical: 6,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '900',
  },
  sectionAction: {
    fontSize: 11,
    fontWeight: '800',
  },
  row: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
    minHeight: 46,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  rowTitle: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
  },
  doneText: {
    textDecorationLine: 'line-through',
  },
  checkCircle: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1.6,
    height: 23,
    justifyContent: 'center',
    width: 23,
  },
  taskRow: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 9,
    minHeight: 52,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  taskBody: {
    flex: 1,
  },
  taskMetaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 3,
  },
  taskMeta: {
    fontSize: 9,
    fontWeight: '600',
  },
  priorityPill: {
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  priorityText: {
    fontSize: 8,
    fontWeight: '800',
  },
  taskActions: {
    gap: 2,
  },
  smallIconButton: {
    alignItems: 'center',
    borderRadius: 9,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  habitRow: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 9,
    minHeight: 54,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  habitIcon: {
    alignItems: 'center',
    borderRadius: 10,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  habitTrailing: {
    alignItems: 'flex-end',
    gap: 5,
  },
  streakRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 3,
  },
  streakText: {
    fontSize: 9,
    fontWeight: '800',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  filterChip: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  filterChipText: {
    fontSize: 10,
    fontWeight: '800',
  },
  chipDot: {
    borderRadius: 999,
    height: 7,
    width: 7,
  },
  manageChip: {
    alignItems: 'center',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  manageChipText: {
    fontSize: 10,
    fontWeight: '800',
  },
  segmented: {
    borderRadius: 11,
    flexDirection: 'row',
    gap: 3,
    padding: 3,
  },
  segmentButton: {
    alignItems: 'center',
    borderRadius: 8,
    flex: 1,
    justifyContent: 'center',
    minHeight: 32,
  },
  segmentText: {
    fontSize: 10,
    fontWeight: '800',
  },
  summaryStrip: {
    flexDirection: 'row',
    gap: 8,
  },
  summaryCell: {
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    padding: 10,
  },
  summaryValue: {
    fontSize: 16,
    fontWeight: '900',
  },
  summaryLabel: {
    fontSize: 9,
    fontWeight: '700',
    marginTop: 2,
  },
  heatmapCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 11,
  },
  heatGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 3,
  },
  heatCell: {
    aspectRatio: 1,
    borderRadius: 4,
    width: '13.1%',
  },
  weekdayRow: {
    flexDirection: 'row',
    gap: 3,
    marginTop: 6,
  },
  weekdayText: {
    fontSize: 8,
    fontWeight: '700',
    textAlign: 'center',
    width: '13.1%',
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  statCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 11,
    width: '48.5%',
  },
  statIcon: {
    alignItems: 'center',
    borderRadius: 9,
    height: 28,
    justifyContent: 'center',
    marginBottom: 7,
    width: 28,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '900',
  },
  statLabel: {
    fontSize: 9,
    fontWeight: '700',
    marginTop: 3,
  },
  chartCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  barChart: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: 7,
    height: 120,
  },
  barCol: {
    alignItems: 'center',
    flex: 1,
    gap: 6,
    height: '100%',
    justifyContent: 'flex-end',
  },
  bar: {
    borderRadius: 5,
    minHeight: 6,
    width: '100%',
  },
  barLabel: {
    fontSize: 8,
    fontWeight: '700',
  },
  distCard: {
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
    padding: 12,
  },
  distRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  distDot: {
    borderRadius: 999,
    height: 9,
    width: 9,
  },
  distName: {
    fontSize: 10,
    fontWeight: '800',
    width: 56,
  },
  distTrack: {
    borderRadius: 999,
    flex: 1,
    height: 6,
    overflow: 'hidden',
  },
  distFill: {
    borderRadius: 999,
    height: '100%',
  },
  distValue: {
    fontSize: 9,
    fontWeight: '800',
    width: 40,
    textAlign: 'right',
  },
  emptyRow: {
    alignItems: 'center',
    borderRadius: 12,
    borderStyle: 'dashed',
    borderWidth: 1,
    flexDirection: 'row',
    gap: 9,
    padding: 13,
  },
  emptyText: {
    flex: 1,
    fontSize: 10,
    lineHeight: 15,
  },
  notice: {
    alignItems: 'center',
    borderRadius: 11,
    flexDirection: 'row',
    gap: 8,
    padding: 10,
  },
  noticeText: {
    flex: 1,
    fontSize: 10,
    fontWeight: '700',
  },
  loginState: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 30,
  },
  centerState: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  stateIcon: {
    alignItems: 'center',
    borderRadius: 18,
    height: 62,
    justifyContent: 'center',
    marginBottom: 14,
    width: 62,
  },
  stateTitle: {
    fontSize: 17,
    fontWeight: '900',
    marginTop: 14,
    textAlign: 'center',
  },
  stateText: {
    fontSize: 12,
    lineHeight: 19,
    marginTop: 7,
    textAlign: 'center',
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 13,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    marginTop: 16,
    minHeight: 44,
    paddingHorizontal: 18,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '900',
  },
  sheetRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetBackdrop: {
    backgroundColor: 'rgba(10,14,28,0.45)',
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  sheet: {
    alignSelf: 'center',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    maxHeight: '86%',
    maxWidth: 430,
    paddingBottom: 18,
    width: '100%',
  },
  sheetHandle: {
    alignSelf: 'center',
    backgroundColor: '#c6cede',
    borderRadius: 999,
    height: 4,
    marginTop: 8,
    width: 42,
  },
  sheetHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: '900',
  },
  sheetContent: {
    gap: 10,
    paddingHorizontal: 16,
  },
  field: {
    gap: 6,
  },
  fieldLabel: {
    fontSize: 10,
    fontWeight: '800',
  },
  input: {
    borderRadius: 11,
    borderWidth: 1,
    fontSize: 13,
    minHeight: 42,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  multilineInput: {
    minHeight: 70,
    textAlignVertical: 'top',
  },
  twoColumn: {
    flexDirection: 'row',
    gap: 10,
  },
  colorRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingTop: 8,
  },
  colorSwatch: {
    borderRadius: 999,
    borderWidth: 2,
    height: 24,
    width: 24,
  },
  goalTaskList: {
    gap: 6,
  },
  goalTaskRow: {
    alignItems: 'center',
    borderRadius: 11,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 9,
    minHeight: 42,
    paddingHorizontal: 10,
  },
  goalTaskText: {
    flex: 1,
    fontSize: 11,
    fontWeight: '700',
  },
  manageRow: {
    alignItems: 'center',
    borderRadius: 11,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 9,
    minHeight: 44,
    paddingHorizontal: 10,
  },
  manageName: {
    flex: 1,
    fontSize: 11,
    fontWeight: '800',
  },
  subtaskWrap: {
    borderRadius: 10,
    borderWidth: 1,
    gap: 5,
    marginHorizontal: 8,
    marginTop: 3,
    padding: 8,
  },
  subtaskRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
  },
  subtaskText: {
    flex: 1,
    fontSize: 10,
  },
});
