import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, G, Path, Text as SvgText } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { appLayout } from '@/constants/app-theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useAuth } from '@/features/auth/auth-provider';
import {
  fetchWhoDoesItState,
  getWhoDoesItErrorMessage,
  saveWhoDoesItState,
} from '@/lib/who-does-it-api';
import {
  addParticipants,
  appendRecord,
  buildRecentTasks,
  buildWheelSectors,
  clearParticipants,
  clearRecords,
  formatRecordTime,
  groupRecordsByDay,
  recordStats,
  removeParticipant,
  removeRecord,
  resolveRecordTaskText,
  runSpin,
  taskModeLabel,
  updateParticipantName,
  updateSettings,
} from '@/lib/who-does-it';
import {
  getWhoDoesItState,
  setWhoDoesItState,
} from '@/lib/who-does-it-storage';
import {
  createEmptyWhoDoesItState,
  WHO_DOES_IT_MAX_PARTICIPANTS,
  WHO_DOES_IT_MIN_PARTICIPANTS,
} from '@/types/who-does-it';
import type {
  WhoDoesItParticipant,
  WhoDoesItRecord,
  WhoDoesItSettings,
  WhoDoesItSpinResult,
  WhoDoesItState,
  WhoDoesItTaskMode,
  WhoDoesItWheelSector,
} from '@/types/who-does-it';

type WhoDoesItTab = 'wheel' | 'people' | 'history';

const WHEEL_SIZE = 292;

function normalizeWhoDoesItState(value: WhoDoesItState): WhoDoesItState {
  const defaults = createEmptyWhoDoesItState();
  return {
    ...value,
    settings: {
      ...defaults.settings,
      ...value.settings,
    },
  };
}

export function WhoDoesItScreen() {
  const router = useRouter();
  const { accessToken: token, status: authStatus } = useAuth();
  const { colors } = useAppTheme();
  const [state, setState] = useState<WhoDoesItState>(createEmptyWhoDoesItState);
  const [activeTab, setActiveTab] = useState<WhoDoesItTab>('wheel');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [editingID, setEditingID] = useState<string | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [spinResult, setSpinResult] = useState<WhoDoesItSpinResult | null>(null);
  const [expandedRecordID, setExpandedRecordID] = useState<string | null>(null);
  const rotation = useRef(new Animated.Value(0)).current;
  const rotationBase = useRef(0);
  const stateRef = useRef(state);
  const syncQueueRef = useRef<Promise<void>>(Promise.resolve());

  stateRef.current = state;

  const recentTasks = useMemo(() => buildRecentTasks(state.records), [state.records]);
  const stats = useMemo(() => recordStats(state.records), [state.records]);
  const groups = useMemo(() => groupRecordsByDay(state.records), [state.records]);
  const wheelSectors = useMemo(
    () => buildWheelSectors(state.participants),
    [state.participants],
  );
  const canSpin = state.participants.length >= WHO_DOES_IT_MIN_PARTICIPANTS;

  const persistAndSync = useCallback(
    (nextState: WhoDoesItState, notice?: string, sync = true) => {
      setState(nextState);
      if (notice) setMessage(notice);
      void setWhoDoesItState(nextState);
      if (!token || !sync) return;
      syncQueueRef.current = syncQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          try {
            const saved = await saveWhoDoesItState(token, nextState);
            setSyncMessage(null);
            const normalized = normalizeWhoDoesItState(saved);
            setState((current) =>
              current.updatedAt >= normalized.updatedAt ? current : normalized,
            );
          } catch (error) {
            setSyncMessage(getWhoDoesItErrorMessage(error));
          }
        });
    },
    [token],
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      const local = await getWhoDoesItState();
      let nextState = local;
      if (token) {
        try {
          const remote = await fetchWhoDoesItState(token);
          if (remote.updatedAt > 0 && (nextState.updatedAt === 0 || remote.updatedAt > nextState.updatedAt)) {
            nextState = normalizeWhoDoesItState(remote);
          } else if (nextState.updatedAt > 0 && (remote.updatedAt === 0 || nextState.updatedAt > remote.updatedAt)) {
            const saved = await saveWhoDoesItState(token, nextState);
            nextState = normalizeWhoDoesItState(saved);
          }
        } catch (error) {
          if (active) setSyncMessage(getWhoDoesItErrorMessage(error));
        }
      }
      if (!active) return;
      setState(nextState);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [token]);

  function handleAddNames() {
    const current = stateRef.current;
    if (editingID) {
      const updated = updateParticipantName(current, editingID, nameInput);
      if (updated.error) {
        setMessage(updated.error);
        return;
      }
      setEditingID(null);
      setNameInput('');
      persistAndSync(updated.state, '姓名已更新');
      return;
    }
    const next = addParticipants(current, nameInput);
    setNameInput('');
    if (next.added.length > 0) {
      persistAndSync(next.state, next.errors.length > 0 ? next.errors.join('；') : `已添加 ${next.added.length} 人`);
    } else {
      setMessage(next.errors.join('；') || '没有可添加的真实姓名');
    }
  }

  function handleEdit(participant: WhoDoesItParticipant) {
    setEditingID(participant.id);
    setNameInput(participant.name);
    setActiveTab('people');
    setMessage(null);
  }

  function handleRemove(participantID: string) {
    persistAndSync(removeParticipant(stateRef.current, participantID));
  }

  function handleClearPeople() {
    Alert.alert('清空名单', '将移除全部真实姓名，历史记录不会被删除。', [
      { text: '取消', style: 'cancel' },
      {
        text: '清空',
        style: 'destructive',
        onPress: () => persistAndSync(clearParticipants(stateRef.current)),
      },
    ]);
  }

  function handleSettingsChange(patch: Partial<WhoDoesItSettings>) {
    const nextState = updateSettings(stateRef.current, patch);
    const customMissingTask = nextState.settings.taskMode === 'custom' && !nextState.settings.customTask.trim();
    persistAndSync(nextState, undefined, !customMissingTask);
  }

  function handleSpin() {
    if (!canSpin || spinning) return;
    const result = runSpin(stateRef.current, Math.random);
    const target = rotationBase.current + result.targetRotation;
    rotationBase.current = target;
    setSpinning(true);
    setSpinResult(null);
    Animated.timing(rotation, {
      toValue: target,
      duration: 3200,
      useNativeDriver: false,
    }).start(() => {
      setSpinning(false);
      setSpinResult(result);
      persistAndSync(appendRecord(stateRef.current, result.record));
    });
  }

  function handleResultDone() {
    setSpinResult(null);
  }

  function handleDeleteRecord(recordID: string) {
    persistAndSync(removeRecord(stateRef.current, recordID));
  }

  function handleClearHistory() {
    Alert.alert('清空历史', '将删除全部真实抽签记录，该操作不可恢复。', [
      { text: '取消', style: 'cancel' },
      {
        text: '清空',
        style: 'destructive',
        onPress: () => persistAndSync(clearRecords(stateRef.current)),
      },
    ]);
  }

  if (authStatus === 'loading' || loading) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.primary} size="large" />
          <ThemedText style={[styles.stateTitle, { color: colors.text }]}>正在打开谁来干</ThemedText>
          <ThemedText style={[styles.stateText, { color: colors.mutedText }]}>
            正在读取真实名单与抽签记录
          </ThemedText>
        </View>
      </SafeAreaView>
    );
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
            <ThemedText style={styles.headerTitle}>谁来干</ThemedText>
            <ThemedText style={[styles.headerMeta, { color: colors.mutedText }]}>
              {state.participants.length > 0
                ? `${state.participants.length} 人 · ${state.records.length} 次真实记录`
                : '真实名单 · 真实结果'}
            </ThemedText>
          </View>
          <Pressable
            accessibilityLabel="查看历史"
            accessibilityRole="button"
            onPress={() => setActiveTab('history')}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
            <MaterialCommunityIcons name="history" size={22} color={colors.text} />
          </Pressable>
        </View>

        <View style={[styles.tabs, { backgroundColor: colors.surfaceMuted }]}>
          {(
            [
              ['wheel', '转盘'],
              ['people', `人员 ${state.participants.length}`],
              ['history', `历史 ${stats.total}`],
            ] as const
          ).map(([tab, label]) => (
            <Pressable
              key={tab}
              accessibilityRole="button"
              onPress={() => {
                setActiveTab(tab);
                setMessage(null);
              }}
              style={[
                styles.tab,
                activeTab === tab && { backgroundColor: colors.surface },
              ]}>
              <ThemedText
                style={[
                  styles.tabText,
                  { color: activeTab === tab ? colors.text : colors.mutedText },
                ]}>
                {label}
              </ThemedText>
            </Pressable>
          ))}
        </View>

        {(message || syncMessage) ? (
          <View style={[styles.messageBanner, { backgroundColor: colors.primarySoft }]}>
            <MaterialCommunityIcons
              name={syncMessage ? 'cloud-alert-outline' : 'check-circle-outline'}
              size={16}
              color={syncMessage ? '#a76a00' : colors.success}
            />
            <ThemedText
              style={[
                styles.messageText,
                { color: syncMessage ? '#8a5a10' : colors.primary },
              ]}>
              {syncMessage ?? message}
            </ThemedText>
          </View>
        ) : null}

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}>
          {activeTab === 'wheel' ? (
            <WheelTab
              canSpin={canSpin}
              colors={colors}
              onGoPeople={() => {
                setActiveTab('people');
                setMessage(null);
              }}
              onSettingsChange={handleSettingsChange}
              onSpin={handleSpin}
              recentTasks={recentTasks}
              rotation={rotation}
              sectors={wheelSectors}
              settings={state.settings}
              spinning={spinning}
              state={state}
            />
          ) : null}
          {activeTab === 'people' ? (
            <PeopleTab
              colors={colors}
              editingID={editingID}
              nameInput={nameInput}
              onAdd={handleAddNames}
              onClear={handleClearPeople}
              onEdit={handleEdit}
              onInputChange={setNameInput}
              onRemove={handleRemove}
              participants={state.participants}
            />
          ) : null}
          {activeTab === 'history' ? (
            <HistoryTab
              colors={colors}
              expandedRecordID={expandedRecordID}
              groups={groups}
              onClear={handleClearHistory}
              onDelete={handleDeleteRecord}
              onToggleExpand={setExpandedRecordID}
              stats={stats}
            />
          ) : null}
        </ScrollView>

        {spinResult ? (
          <ResultOverlay
            colors={colors}
            onDone={handleResultDone}
            onSpinAgain={() => {
              setSpinResult(null);
              handleSpin();
            }}
            result={spinResult}
            taskText={spinResult.record.taskText}
          />
        ) : null}
      </View>
    </SafeAreaView>
  );
}

function WheelTab({
  canSpin,
  colors,
  onGoPeople,
  onSettingsChange,
  onSpin,
  recentTasks,
  rotation,
  sectors,
  settings,
  spinning,
  state,
}: {
  canSpin: boolean;
  colors: ReturnType<typeof useAppTheme>['colors'];
  onGoPeople: () => void;
  onSettingsChange: (patch: Partial<WhoDoesItSettings>) => void;
  onSpin: () => void;
  recentTasks: ReturnType<typeof buildRecentTasks>;
  rotation: Animated.Value;
  sectors: WhoDoesItWheelSector[];
  settings: WhoDoesItSettings;
  spinning: boolean;
  state: WhoDoesItState;
}) {
  return (
    <>
      <View style={[styles.wheelCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        {state.participants.length < WHO_DOES_IT_MIN_PARTICIPANTS ? (
          <View style={styles.emptyWheel}>
            <View style={[styles.emptyWheelRing, { borderColor: colors.line }]}>
              <MaterialCommunityIcons name="account-group-outline" size={42} color={colors.mutedText} />
            </View>
            <ThemedText style={styles.emptyWheelTitle}>还没有人</ThemedText>
            <ThemedText style={[styles.emptyWheelText, { color: colors.mutedText }]}>
              添加 {WHO_DOES_IT_MIN_PARTICIPANTS} 位以上真实姓名后即可开转
            </ThemedText>
            <Pressable
              accessibilityRole="button"
              onPress={onGoPeople}
              style={({ pressed }) => [
                styles.primaryButton,
                { backgroundColor: colors.primary },
                pressed && styles.pressed,
              ]}>
              <MaterialCommunityIcons name="account-plus-outline" size={17} color="#ffffff" />
              <ThemedText style={styles.primaryButtonText}>去添加人员</ThemedText>
            </Pressable>
          </View>
        ) : (
          <View style={styles.wheelStage}>
            <View style={styles.wheelFrame}>
              <View style={[styles.pointer, { backgroundColor: colors.accent }]} />
              <Animated.View
                style={{
                  width: WHEEL_SIZE,
                  height: WHEEL_SIZE,
                  transform: [
                    {
                      rotate: rotation.interpolate({
                        inputRange: [0, 1],
                        outputRange: ['0deg', '360deg'],
                      }),
                    },
                  ],
                }}>
                <WheelSvg sectors={sectors} />
              </Animated.View>
            </View>
            <ThemedText style={[styles.wheelCount, { color: colors.mutedText }]}>
              <ThemedText style={styles.wheelCountStrong}>{state.participants.length}</ThemedText> 人参与 · 每人 1 个扇区
            </ThemedText>
          </View>
        )}
      </View>

      <View style={[styles.taskPanel, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <View style={styles.sectionHead}>
          <ThemedText style={styles.sectionTitle}>本次任务</ThemedText>
          <ThemedText style={[styles.sectionMeta, { color: colors.mutedText }]}>
            常用任务来自真实记录
          </ThemedText>
        </View>
        <View style={[styles.segmented, { backgroundColor: colors.surfaceMuted }]}>
          {(['person-only', 'custom', 'recent'] as WhoDoesItTaskMode[]).map((mode) => (
            <Pressable
              key={mode}
              accessibilityRole="button"
              onPress={() => onSettingsChange({ taskMode: mode })}
              style={[
                styles.segment,
                settings.taskMode === mode && { backgroundColor: colors.surface },
              ]}>
              <ThemedText
                style={[
                  styles.segmentText,
                  { color: settings.taskMode === mode ? colors.text : colors.mutedText },
                ]}>
                {taskModeLabel(mode)}
              </ThemedText>
            </Pressable>
          ))}
        </View>
        {settings.taskMode === 'custom' ? (
          <View style={[styles.taskInputRow, { borderColor: colors.line, backgroundColor: colors.surface }]}>
            <MaterialCommunityIcons name="clipboard-text-outline" size={17} color={colors.accent} />
            <TextInput
              value={settings.customTask}
              onChangeText={(text) => onSettingsChange({ customTask: text })}
              placeholder="例如：去洗碗、大冒险、喝一杯"
              placeholderTextColor={colors.mutedText}
              style={[styles.taskInput, { color: colors.text }]}
              maxLength={20}
            />
          </View>
        ) : null}
        {settings.taskMode === 'recent' ? (
          <View style={styles.recentTaskList}>
            {recentTasks.length === 0 ? (
              <ThemedText style={[styles.recentEmpty, { color: colors.mutedText }]}>
                还没有真实任务，先使用自定义任务抽一次
              </ThemedText>
            ) : (
              recentTasks.map((task) => (
                <Pressable
                  key={task.id}
                  accessibilityRole="button"
                  onPress={() => onSettingsChange({ selectedRecentTaskId: task.id })}
                  style={[
                    styles.recentTask,
                    {
                      backgroundColor:
                        settings.selectedRecentTaskId === task.id ? colors.primarySoft : colors.surfaceMuted,
                      borderColor:
                        settings.selectedRecentTaskId === task.id ? colors.primary : colors.line,
                    },
                  ]}>
                  <MaterialCommunityIcons name="history" size={13} color={colors.primary} />
                  <ThemedText style={[styles.recentTaskText, { color: colors.text }]}>{task.text}</ThemedText>
                </Pressable>
              ))
            )}
          </View>
        ) : null}
        <Pressable
          accessibilityRole="button"
          disabled={!canSpin || spinning}
          onPress={onSpin}
          style={({ pressed }) => [
            styles.spinButton,
            {
              backgroundColor: canSpin && !spinning ? colors.hero : colors.mutedText,
              opacity: pressed ? 0.85 : 1,
            },
          ]}>
          <MaterialCommunityIcons
            name={spinning ? 'progress-clock' : 'auto-fix'}
            size={18}
            color="#c9f36a"
          />
          <ThemedText style={styles.spinButtonText}>
            {spinning
              ? '转动中…'
              : canSpin
                ? resolveRecordTaskText(settings, state.records)
                  ? '开始抽'
                  : '开始抽'
                : `至少需要 ${WHO_DOES_IT_MIN_PARTICIPANTS} 人`}
          </ThemedText>
        </Pressable>
      </View>
    </>
  );
}

function WheelSvg({ sectors }: { sectors: WhoDoesItWheelSector[] }) {
  const center = WHEEL_SIZE / 2;
  const radius = WHEEL_SIZE / 2 - 14;
  const fontSize = Math.max(10, Math.min(16, Math.floor(150 / Math.max(1, sectors.length))));
  return (
    <Svg width={WHEEL_SIZE} height={WHEEL_SIZE} viewBox={`0 0 ${WHEEL_SIZE} ${WHEEL_SIZE}`}>
      <Circle cx={center} cy={center} r={radius} fill="#ffffff" stroke="#dce5f6" strokeWidth={2} />
      {sectors.map((sector) => {
        const start = toRadians(sector.startAngle);
        const end = toRadians(sector.endAngle);
        const x1 = center + radius * Math.cos(start);
        const y1 = center + radius * Math.sin(start);
        const x2 = center + radius * Math.cos(end);
        const y2 = center + radius * Math.sin(end);
        const largeArc = sector.endAngle - sector.startAngle > 180 ? 1 : 0;
        const labelRadius = radius * 0.62;
        const labelAngle = toRadians(sector.midAngle);
        return (
          <G key={sector.id}>
            <Path
              d={`M ${center} ${center} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`}
              fill={sector.color}
            />
            <SvgText
              x={center + labelRadius * Math.cos(labelAngle)}
              y={center + labelRadius * Math.sin(labelAngle) + fontSize * 0.35}
              fill="#ffffff"
              fontSize={fontSize}
              fontWeight="800"
              textAnchor="middle">
              {sector.name}
            </SvgText>
          </G>
        );
      })}
      <Circle cx={center} cy={center} r={54} fill="#151b3b" />
      <SvgText
        x={center}
        y={center + 5}
        fill="#c9f36a"
        fontSize={15}
        fontWeight="900"
        textAnchor="middle">
        开抽
      </SvgText>
    </Svg>
  );
}

function PeopleTab({
  colors,
  editingID,
  nameInput,
  onAdd,
  onClear,
  onEdit,
  onInputChange,
  onRemove,
  participants,
}: {
  colors: ReturnType<typeof useAppTheme>['colors'];
  editingID: string | null;
  nameInput: string;
  onAdd: () => void;
  onClear: () => void;
  onEdit: (participant: WhoDoesItParticipant) => void;
  onInputChange: (text: string) => void;
  onRemove: (participantID: string) => void;
  participants: WhoDoesItParticipant[];
}) {
  return (
    <>
      <View style={[styles.addCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <View style={[styles.addRow, { borderColor: colors.line, backgroundColor: colors.surface }]}>
          <MaterialCommunityIcons name="account-plus-outline" size={19} color={colors.primary} />
          <TextInput
            value={nameInput}
            onChangeText={onInputChange}
            placeholder="输入真实姓名，可批量粘贴"
            placeholderTextColor={colors.mutedText}
            style={[styles.addInput, { color: colors.text }]}
            onSubmitEditing={onAdd}
          />
          <Pressable
            accessibilityRole="button"
            onPress={onAdd}
            style={({ pressed }) => [
              styles.addButton,
              { backgroundColor: colors.hero },
              pressed && styles.pressed,
            ]}>
            <MaterialCommunityIcons name={editingID ? 'check' : 'plus'} size={15} color="#c9f36a" />
            <ThemedText style={styles.addButtonText}>{editingID ? '保存' : '添加'}</ThemedText>
          </Pressable>
        </View>
        <ThemedText style={[styles.addHint, { color: colors.mutedText }]}>
          支持换行、逗号、顿号、空格分隔；重复姓名会自动拦截，最多 {WHO_DOES_IT_MAX_PARTICIPANTS} 人
        </ThemedText>
      </View>

      <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <View style={styles.sectionHead}>
          <ThemedText style={styles.sectionTitle}>真实名单</ThemedText>
          <Pressable accessibilityRole="button" onPress={onClear} style={styles.clearButton}>
            <MaterialCommunityIcons name="trash-can-outline" size={15} color={colors.accent} />
            <ThemedText style={[styles.clearButtonText, { color: colors.accent }]}>清空</ThemedText>
          </Pressable>
        </View>
        {participants.length === 0 ? (
          <View style={styles.emptyList}>
            <MaterialCommunityIcons name="account-outline" size={30} color={colors.mutedText} />
            <ThemedText style={[styles.emptyListText, { color: colors.mutedText }]}>
              还没有真实姓名，先添加上面的人
            </ThemedText>
          </View>
        ) : (
          participants.map((participant, index) => (
            <View key={participant.id} style={[styles.personRow, { borderColor: colors.line }]}>
              <View
                style={[
                  styles.personAvatar,
                  {
                    backgroundColor: avatarColor(index, colors),
                  },
                ]}>
                <ThemedText style={styles.personAvatarText}>{participant.name.slice(0, 1)}</ThemedText>
              </View>
              <View style={styles.personCopy}>
                <ThemedText style={styles.personName}>{participant.name}</ThemedText>
                <ThemedText style={[styles.personMeta, { color: colors.mutedText }]}>
                  真实姓名 · {new Date(participant.createdAt).toLocaleString()}
                </ThemedText>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={() => onEdit(participant)}
                style={({ pressed }) => [styles.rowIconButton, pressed && styles.pressed]}>
                <MaterialCommunityIcons name="pencil-outline" size={17} color={colors.primary} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => onRemove(participant.id)}
                style={({ pressed }) => [styles.rowIconButton, pressed && styles.pressed]}>
                <MaterialCommunityIcons name="close" size={18} color={colors.accent} />
              </Pressable>
            </View>
          ))
        )}
      </View>
    </>
  );
}

function HistoryTab({
  colors,
  expandedRecordID,
  groups,
  onClear,
  onDelete,
  onToggleExpand,
  stats,
}: {
  colors: ReturnType<typeof useAppTheme>['colors'];
  expandedRecordID: string | null;
  groups: ReturnType<typeof groupRecordsByDay>;
  onClear: () => void;
  onDelete: (recordID: string) => void;
  onToggleExpand: (recordID: string | null) => void;
  stats: ReturnType<typeof recordStats>;
}) {
  return (
    <>
      <View style={styles.statsRow}>
        <View style={[styles.statCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <ThemedText style={[styles.statValue, { color: colors.primary }]}>{stats.today}</ThemedText>
          <ThemedText style={[styles.statLabel, { color: colors.mutedText }]}>今日真实抽签</ThemedText>
        </View>
        <View style={[styles.statCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <ThemedText style={[styles.statValue, { color: colors.accent }]}>{stats.total}</ThemedText>
          <ThemedText style={[styles.statLabel, { color: colors.mutedText }]}>累计真实抽签</ThemedText>
        </View>
      </View>

      <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <View style={styles.sectionHead}>
          <ThemedText style={styles.sectionTitle}>抽签记录</ThemedText>
          <Pressable accessibilityRole="button" onPress={onClear} style={styles.clearButton}>
            <MaterialCommunityIcons name="trash-can-outline" size={15} color={colors.accent} />
            <ThemedText style={[styles.clearButtonText, { color: colors.accent }]}>清空历史</ThemedText>
          </Pressable>
        </View>
        {groups.length === 0 ? (
          <View style={styles.emptyList}>
            <MaterialCommunityIcons name="history" size={30} color={colors.mutedText} />
            <ThemedText style={[styles.emptyListText, { color: colors.mutedText }]}>
              还没有真实抽签记录
            </ThemedText>
          </View>
        ) : (
          groups.map((group) => (
            <View key={group.key} style={styles.dayGroup}>
              <ThemedText style={[styles.dayLabel, { color: colors.mutedText }]}>{group.label}</ThemedText>
              {group.records.map((record) => (
                <HistoryRecordCard
                  colors={colors}
                  expanded={expandedRecordID === record.id}
                  key={record.id}
                  onDelete={() => onDelete(record.id)}
                  onToggle={() => onToggleExpand(expandedRecordID === record.id ? null : record.id)}
                  record={record}
                />
              ))}
            </View>
          ))
        )}
      </View>
    </>
  );
}

function HistoryRecordCard({
  colors,
  expanded,
  onDelete,
  onToggle,
  record,
}: {
  colors: ReturnType<typeof useAppTheme>['colors'];
  expanded: boolean;
  onDelete: () => void;
  onToggle: () => void;
  record: WhoDoesItRecord;
}) {
  return (
    <View
      style={[
        styles.historyCard,
        {
          backgroundColor: colors.surfaceMuted,
          borderLeftColor: record.taskText ? colors.accent : colors.primary,
        },
      ]}>
      <View style={styles.historyHead}>
        <MaterialCommunityIcons name="clock-outline" size={13} color={colors.mutedText} />
        <ThemedText style={[styles.historyTime, { color: colors.mutedText }]}>
          {formatRecordTime(record.createdAt)}
        </ThemedText>
        <ThemedText style={[styles.historyPeople, { color: colors.mutedText }]}>
          {record.participantCount} 人参与
        </ThemedText>
        <Pressable accessibilityRole="button" onPress={onDelete} style={styles.rowIconButton}>
          <MaterialCommunityIcons name="trash-can-outline" size={15} color={colors.accent} />
        </Pressable>
      </View>
      <View style={styles.historyResultRow}>
        <View style={[styles.miniAvatar, { backgroundColor: colors.primarySoft }]}>
          <ThemedText style={[styles.miniAvatarText, { color: colors.primary }]}>
            {record.winnerName.slice(0, 1)}
          </ThemedText>
        </View>
        <ThemedText style={styles.historyWinner}>{record.winnerName}</ThemedText>
        <View style={[styles.taskChip, { backgroundColor: colors.surface }]}>
          <MaterialCommunityIcons
            name={record.taskText ? 'clipboard-text-outline' : 'account-check-outline'}
            size={12}
            color={record.taskText ? colors.accent : colors.mutedText}
          />
          <ThemedText style={[styles.taskChipText, { color: record.taskText ? colors.text : colors.mutedText }]}>
            {record.taskText || '只抽人'}
          </ThemedText>
        </View>
      </View>
      <Pressable accessibilityRole="button" onPress={onToggle} style={styles.expandRow}>
        <MaterialCommunityIcons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={14}
          color={colors.primary}
        />
        <ThemedText style={[styles.expandText, { color: colors.primary }]}>
          {expanded ? '收起参与人快照' : '查看参与人快照'}
        </ThemedText>
      </Pressable>
      {expanded ? (
        <View style={[styles.snapshotWrap, { borderTopColor: colors.line }]}>
          {record.participantNames.map((name) => (
            <View key={`${record.id}-${name}`} style={[styles.snapshotChip, { backgroundColor: colors.surface }]}>
              <MaterialCommunityIcons name="account" size={12} color={colors.mutedText} />
              <ThemedText style={[styles.snapshotChipText, { color: colors.text }]}>{name}</ThemedText>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function ResultOverlay({
  colors,
  onDone,
  onSpinAgain,
  result,
  taskText,
}: {
  colors: ReturnType<typeof useAppTheme>['colors'];
  onDone: () => void;
  onSpinAgain: () => void;
  result: WhoDoesItSpinResult;
  taskText: string;
}) {
  return (
    <View style={styles.overlay}>
      <View style={[styles.resultCard, { backgroundColor: colors.surface }]}>
        <View style={styles.resultKicker}>
          <MaterialCommunityIcons name="trophy-outline" size={15} color={colors.accent} />
          <ThemedText style={[styles.resultKickerText, { color: colors.accent }]}>本次结果</ThemedText>
        </View>
        <View style={[styles.winnerAvatar, { backgroundColor: colors.accent }]}>
          <ThemedText style={styles.winnerAvatarText}>{result.winner.name.slice(0, 1)}</ThemedText>
        </View>
        <ThemedText style={styles.winnerName}>{result.winner.name}</ThemedText>
        {taskText ? (
          <View style={[styles.resultTask, { backgroundColor: colors.primarySoft }]}>
            <MaterialCommunityIcons name="clipboard-text-outline" size={15} color={colors.primary} />
            <ThemedText style={[styles.resultTaskText, { color: colors.primary }]}>{taskText}</ThemedText>
          </View>
        ) : (
          <ThemedText style={[styles.resultNoTask, { color: colors.mutedText }]}>
            本次只抽人，没有绑定任务
          </ThemedText>
        )}
        <View style={styles.resultActions}>
          <Pressable
            accessibilityRole="button"
            onPress={onSpinAgain}
            style={({ pressed }) => [
              styles.resultButton,
              { backgroundColor: colors.hero },
              pressed && styles.pressed,
            ]}>
            <MaterialCommunityIcons name="rotate-right" size={17} color="#c9f36a" />
            <ThemedText style={styles.resultButtonText}>再抽一次</ThemedText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={onDone}
            style={({ pressed }) => [
              styles.resultButton,
              { backgroundColor: colors.primarySoft },
              pressed && styles.pressed,
            ]}>
            <MaterialCommunityIcons name="check" size={17} color={colors.primary} />
            <ThemedText style={[styles.resultButtonText, { color: colors.primary }]}>完成</ThemedText>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function toRadians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

function avatarColor(index: number, colors: ReturnType<typeof useAppTheme>['colors']) {
  const palette = [colors.primarySoft, '#ffe9ef', colors.primarySoft, '#fff2df'];
  return palette[index % palette.length];
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
    gap: 10,
    height: 58,
    paddingHorizontal: 14,
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: 999,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  headerTitleWrap: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 19,
    fontWeight: '900',
  },
  headerMeta: {
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
  },
  tabs: {
    borderRadius: 14,
    flexDirection: 'row',
    gap: 4,
    marginHorizontal: 14,
    padding: 4,
  },
  tab: {
    alignItems: 'center',
    borderRadius: 11,
    flex: 1,
    height: 34,
    justifyContent: 'center',
  },
  tabText: {
    fontSize: 11,
    fontWeight: '900',
  },
  messageBanner: {
    alignItems: 'center',
    borderRadius: 11,
    flexDirection: 'row',
    gap: 7,
    marginHorizontal: 14,
    marginTop: 10,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  messageText: {
    flex: 1,
    fontSize: 10,
    fontWeight: '800',
  },
  scrollContent: {
    paddingBottom: 40,
    paddingHorizontal: 14,
    paddingTop: 12,
  },
  wheelCard: {
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 20,
    padding: 14,
  },
  wheelStage: {
    alignItems: 'center',
  },
  wheelFrame: {
    alignItems: 'center',
    height: WHEEL_SIZE + 22,
    justifyContent: 'center',
    position: 'relative',
  },
  pointer: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 6,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
    height: 18,
    position: 'absolute',
    top: 0,
    width: 26,
    zIndex: 3,
  },
  wheelCount: {
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
  },
  wheelCountStrong: {
    color: '#4b6bff',
    fontSize: 14,
    fontWeight: '900',
  },
  emptyWheel: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  emptyWheelRing: {
    alignItems: 'center',
    borderStyle: 'dashed',
    borderWidth: 2,
    borderRadius: 999,
    height: 190,
    justifyContent: 'center',
    marginBottom: 14,
    width: 190,
  },
  emptyWheelTitle: {
    fontSize: 16,
    fontWeight: '900',
  },
  emptyWheelText: {
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 14,
    marginTop: 5,
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 6,
    height: 40,
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '900',
  },
  taskPanel: {
    borderWidth: 1,
    borderRadius: 20,
    marginTop: 12,
    padding: 14,
  },
  sectionHead: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '900',
  },
  sectionMeta: {
    fontSize: 8.5,
    fontWeight: '700',
  },
  segmented: {
    borderRadius: 12,
    flexDirection: 'row',
    gap: 4,
    padding: 4,
  },
  segment: {
    alignItems: 'center',
    borderRadius: 9,
    flex: 1,
    height: 32,
    justifyContent: 'center',
  },
  segmentText: {
    fontSize: 10,
    fontWeight: '900',
  },
  taskInputRow: {
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    flexDirection: 'row',
    gap: 8,
    height: 42,
    marginTop: 9,
    paddingHorizontal: 11,
  },
  taskInput: {
    flex: 1,
    fontSize: 11,
    fontWeight: '700',
    paddingVertical: 0,
  },
  recentTaskList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: 9,
  },
  recentTask: {
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 999,
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  recentTaskText: {
    fontSize: 9.5,
    fontWeight: '800',
  },
  recentEmpty: {
    fontSize: 9.5,
    fontWeight: '700',
    paddingVertical: 4,
  },
  spinButton: {
    alignItems: 'center',
    borderRadius: 14,
    flexDirection: 'row',
    gap: 7,
    height: 46,
    justifyContent: 'center',
    marginTop: 12,
  },
  spinButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '900',
  },
  addCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 13,
  },
  addRow: {
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 13,
    flexDirection: 'row',
    gap: 8,
    height: 48,
    paddingHorizontal: 11,
  },
  addInput: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    minWidth: 0,
    paddingVertical: 0,
  },
  addButton: {
    alignItems: 'center',
    borderRadius: 10,
    flexDirection: 'row',
    gap: 4,
    height: 34,
    justifyContent: 'center',
    paddingHorizontal: 11,
  },
  addButtonText: {
    color: '#c9f36a',
    fontSize: 10,
    fontWeight: '900',
  },
  addHint: {
    fontSize: 9,
    fontWeight: '700',
    marginTop: 8,
  },
  sectionCard: {
    borderWidth: 1,
    borderRadius: 18,
    marginTop: 12,
    padding: 13,
  },
  clearButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  clearButtonText: {
    fontSize: 9.5,
    fontWeight: '900',
  },
  emptyList: {
    alignItems: 'center',
    paddingVertical: 30,
  },
  emptyListText: {
    fontSize: 10,
    fontWeight: '700',
    marginTop: 8,
  },
  personRow: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 60,
    paddingVertical: 8,
  },
  personAvatar: {
    alignItems: 'center',
    borderRadius: 10,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  personAvatarText: {
    fontSize: 14,
    fontWeight: '900',
  },
  personCopy: {
    flex: 1,
  },
  personName: {
    fontSize: 12,
    fontWeight: '900',
  },
  personMeta: {
    fontSize: 8.5,
    fontWeight: '700',
    marginTop: 2,
  },
  rowIconButton: {
    alignItems: 'center',
    borderRadius: 9,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  statCard: {
    borderWidth: 1,
    borderRadius: 15,
    flex: 1,
    padding: 13,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '900',
  },
  statLabel: {
    fontSize: 9,
    fontWeight: '700',
    marginTop: 4,
  },
  dayGroup: {
    gap: 8,
    marginTop: 8,
  },
  dayLabel: {
    fontSize: 10,
    fontWeight: '900',
  },
  historyCard: {
    borderLeftWidth: 3,
    borderRadius: 13,
    padding: 11,
  },
  historyHead: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 5,
  },
  historyTime: {
    fontSize: 8.5,
    fontWeight: '800',
  },
  historyPeople: {
    fontSize: 8,
    fontWeight: '700',
    marginLeft: 'auto',
  },
  historyResultRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  miniAvatar: {
    alignItems: 'center',
    borderRadius: 9,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  miniAvatarText: {
    fontSize: 11,
    fontWeight: '900',
  },
  historyWinner: {
    fontSize: 12,
    fontWeight: '900',
  },
  taskChip: {
    alignItems: 'center',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 4,
    marginLeft: 'auto',
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  taskChipText: {
    fontSize: 8.5,
    fontWeight: '800',
  },
  expandRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    marginTop: 9,
  },
  expandText: {
    fontSize: 8.5,
    fontWeight: '800',
  },
  snapshotWrap: {
    borderTopWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 9,
    paddingTop: 9,
  },
  snapshotChip: {
    alignItems: 'center',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  snapshotChipText: {
    fontSize: 8.5,
    fontWeight: '800',
  },
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(9, 17, 38, 0.62)',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    padding: 24,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 20,
  },
  resultCard: {
    alignItems: 'center',
    borderRadius: 24,
    paddingHorizontal: 22,
    paddingVertical: 24,
    width: '100%',
  },
  resultKicker: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  resultKickerText: {
    fontSize: 10,
    fontWeight: '900',
  },
  winnerAvatar: {
    alignItems: 'center',
    borderRadius: 999,
    height: 82,
    justifyContent: 'center',
    marginBottom: 10,
    marginTop: 16,
    width: 82,
  },
  winnerAvatarText: {
    color: '#ffffff',
    fontSize: 26,
    fontWeight: '900',
  },
  winnerName: {
    fontSize: 24,
    fontWeight: '900',
  },
  resultTask: {
    alignItems: 'center',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 6,
    marginTop: 10,
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  resultTaskText: {
    fontSize: 11,
    fontWeight: '900',
  },
  resultNoTask: {
    fontSize: 10,
    fontWeight: '700',
    marginTop: 10,
  },
  resultActions: {
    flexDirection: 'row',
    gap: 9,
    marginTop: 18,
    width: '100%',
  },
  resultButton: {
    alignItems: 'center',
    borderRadius: 13,
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    height: 42,
    justifyContent: 'center',
  },
  resultButtonText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '900',
  },
  centerState: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 30,
  },
  stateTitle: {
    fontSize: 16,
    fontWeight: '900',
    marginTop: 12,
  },
  stateText: {
    fontSize: 11,
    fontWeight: '700',
    marginTop: 6,
  },
  pressed: {
    opacity: 0.72,
  },
});
