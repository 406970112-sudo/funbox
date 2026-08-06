import * as Clipboard from 'expo-clipboard';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
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
import { useSocial } from '@/features/social/social-provider';
import {
  fetchBorrowLedgerState,
  getBorrowLedgerErrorMessage,
  saveBorrowLedgerState,
} from '@/lib/borrow-ledger-api';
import {
  addBorrowRecord,
  borrowStats,
  buildReminderText,
  clearBorrowLedgerState,
  completeBorrowRecord,
  kindLabel,
  newBorrowLedgerID,
  normalizeBorrowLedgerState,
  recordStatus,
  recordStatusLabel,
  recordSubjectLabel,
  reminderCandidates,
  removeBorrowRecord,
  reopenBorrowRecord,
  remindRuleLabel,
  searchBorrowRecords,
  subjectTypeLabel,
  todayKey,
  validateBorrowRecord,
} from '@/lib/borrow-ledger';
import {
  getBorrowLedgerState,
  setBorrowLedgerState,
} from '@/lib/borrow-ledger-storage';
import {
  createEmptyBorrowLedgerState,
  BORROW_LEDGER_MAX_ACCOUNT_NAME,
  BORROW_LEDGER_MAX_COUNTERPARTY_NAME,
  BORROW_LEDGER_MAX_NOTE,
  BORROW_LEDGER_MAX_PLATFORM,
  BORROW_LEDGER_MAX_TITLE,
} from '@/types/borrow-ledger';
import type {
  BorrowKind,
  BorrowLedgerState,
  BorrowRecord,
  BorrowRemindRule,
  BorrowSubjectType,
} from '@/types/borrow-ledger';
import type { Friend } from '@/types/social';

type BorrowTab = 'home' | 'add' | 'reminders' | 'history';
type BorrowHistoryFilter = 'all' | 'active' | 'overdue' | 'done';
type ReminderTone = 'casual' | 'short' | 'formal';

type Draft = {
  kind: BorrowKind;
  subjectType: BorrowSubjectType;
  title: string;
  amount: string;
  currency: string;
  platform: string;
  accountName: string;
  counterpartyName: string;
  friendId: string;
  friendAvatar: string;
  lentAt: string;
  dueAt: string;
  remindRule: BorrowRemindRule;
  note: string;
};

type Color = ReturnType<typeof useAppTheme>['colors'];

const REMIND_RULES: BorrowRemindRule[] = [
  'none',
  'before_1d',
  'before_3d',
  'before_7d',
  'on_due',
  'daily_overdue',
];

function emptyDraft(): Draft {
  return {
    kind: 'lend_out',
    subjectType: 'item',
    title: '',
    amount: '',
    currency: 'CNY',
    platform: '',
    accountName: '',
    counterpartyName: '',
    friendId: '',
    friendAvatar: '',
    lentAt: todayKey(),
    dueAt: '',
    remindRule: 'none',
    note: '',
  };
}

export function BorrowLedgerScreen() {
  const router = useRouter();
  const { accessToken: token, status: authStatus } = useAuth();
  const { friends } = useSocial();
  const { colors } = useAppTheme();
  const [state, setState] = useState<BorrowLedgerState>(createEmptyBorrowLedgerState);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<BorrowTab>('home');
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [friendPickerOpen, setFriendPickerOpen] = useState(false);
  const [friendQuery, setFriendQuery] = useState('');
  const [reminderTone, setReminderTone] = useState<ReminderTone>('casual');
  const [historyQuery, setHistoryQuery] = useState('');
  const [historyFilter, setHistoryFilter] = useState<BorrowHistoryFilter>('all');
  const stateRef = useRef(state);
  const syncQueueRef = useRef<Promise<void>>(Promise.resolve());

  stateRef.current = state;

  const stats = useMemo(() => borrowStats(state), [state]);
  const reminders = useMemo(() => reminderCandidates(state), [state]);
  const visibleHistory = useMemo(() => {
    const queryMatches = searchBorrowRecords(state.records, historyQuery);
    return queryMatches.filter((record) => {
      if (historyFilter === 'all') return true;
      return recordStatus(record) === historyFilter;
    });
  }, [historyFilter, historyQuery, state.records]);

  const persistAndSync = useCallback(
    (nextState: BorrowLedgerState, notice?: string, sync = true) => {
      setState(nextState);
      if (notice) setMessage(notice);
      void setBorrowLedgerState(nextState);
      if (!token || !sync) return;
      syncQueueRef.current = syncQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          try {
            const saved = await saveBorrowLedgerState(token, nextState);
            setSyncMessage(null);
            const normalized = normalizeBorrowLedgerState(saved);
            setState((current) =>
              current.updatedAt >= normalized.updatedAt ? current : normalized,
            );
          } catch (error) {
            setSyncMessage(getBorrowLedgerErrorMessage(error));
          }
        });
    },
    [token],
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      const local = await getBorrowLedgerState();
      let nextState = local;
      if (token) {
        try {
          const remote = await fetchBorrowLedgerState(token);
          if (
            remote.updatedAt > 0 &&
            (nextState.updatedAt === 0 || remote.updatedAt > nextState.updatedAt)
          ) {
            nextState = normalizeBorrowLedgerState(remote);
          } else if (
            nextState.updatedAt > 0 &&
            (remote.updatedAt === 0 || nextState.updatedAt > remote.updatedAt)
          ) {
            const saved = await saveBorrowLedgerState(token, nextState);
            nextState = normalizeBorrowLedgerState(saved);
          }
        } catch (error) {
          if (active) setSyncMessage(getBorrowLedgerErrorMessage(error));
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

  function handleSaveDraft() {
    const record = draftToRecord(draft);
    const validationError = validateBorrowRecord(record);
    if (validationError) {
      setMessage(validationError);
      return;
    }
    const result = addBorrowRecord(stateRef.current, record);
    if (result.error) {
      setMessage(result.error);
      return;
    }
    persistAndSync(result.state, '已保存真实借还记录');
    setDraft(emptyDraft());
    setFriendPickerOpen(false);
    setActiveTab('home');
  }

  function handleComplete(recordId: string) {
    const record = stateRef.current.records.find((item) => item.id === recordId);
    if (!record) return;
    const label = record.kind === 'paid_for' ? '标记已结清' : '标记已归还';
    const verb = record.kind === 'paid_for' ? '已结清' : '已归还';
    Alert.alert(label, `确认「${recordSubjectLabel(record)}」已${verb}？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '确认',
        onPress: () => {
          const next = completeBorrowRecord(stateRef.current, recordId);
          persistAndSync(next, `已标记${verb}`);
        },
      },
    ]);
  }

  function handleReopen(recordId: string) {
    persistAndSync(reopenBorrowRecord(stateRef.current, recordId), '已重新打开记录');
  }

  function handleDelete(recordId: string) {
    const record = stateRef.current.records.find((item) => item.id === recordId);
    if (!record) return;
    Alert.alert('删除记录', `将删除「${recordSubjectLabel(record)}」的真实记录，该操作不可恢复。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          persistAndSync(removeBorrowRecord(stateRef.current, recordId), '记录已删除');
        },
      },
    ]);
  }

  function handleClearAll() {
    Alert.alert('清空借还记录', '将删除全部真实借还记录，该操作不可恢复。', [
      { text: '取消', style: 'cancel' },
      {
        text: '清空',
        style: 'destructive',
        onPress: () => {
          persistAndSync(clearBorrowLedgerState(), '借还记录已清空');
        },
      },
    ]);
  }

  async function handleCopyReminder(record: BorrowRecord) {
    const text = buildReminderText(record, reminderTone);
    try {
      await Clipboard.setStringAsync(text);
      setMessage('已复制真实提醒卡');
    } catch {
      setMessage('复制失败，请手动选择提醒文本');
    }
  }

  function handleSelectFriend(friend: Friend) {
    setDraft((current) => ({
      ...current,
      counterpartyName: friend.user.displayName,
      friendId: friend.user.id,
      friendAvatar: friend.user.avatarUrl,
    }));
    setFriendPickerOpen(false);
    setFriendQuery('');
  }

  function updateDraft(patch: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  if (authStatus === 'loading' || loading) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.primary} size="large" />
          <ThemedText style={[styles.stateTitle, { color: colors.text }]}>
            正在打开借还记录
          </ThemedText>
          <ThemedText style={[styles.stateText, { color: colors.mutedText }]}>
            正在读取真实借还数据
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
            <MaterialCommunityIcons name="chevron-left" size={28} color={colors.text} />
          </Pressable>
          <View style={styles.headerTitleWrap}>
            <ThemedText style={styles.headerTitle}>借还记录</ThemedText>
            <ThemedText style={[styles.headerMeta, { color: colors.mutedText }]}>
              {state.records.length > 0
                ? `${stats.active + stats.overdue} 笔进行中 · ${stats.done} 笔已完成`
                : '谁借了我什么 · 真实记录'}
            </ThemedText>
          </View>
          <Pressable
            accessibilityLabel="查看历史"
            accessibilityRole="button"
            hitSlop={10}
            onPress={() => setActiveTab('history')}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
            <MaterialCommunityIcons name="history" size={22} color={colors.text} />
          </Pressable>
        </View>

        <View style={[styles.tabs, { backgroundColor: colors.surfaceMuted }]}>
          {(
            [
              ['home', '主页'],
              ['add', '记一笔'],
              ['reminders', `提醒 ${reminders.length}`],
              ['history', `历史 ${state.records.length}`],
            ] as const
          ).map(([tab, label]) => (
            <Pressable
              key={tab}
              accessibilityRole="button"
              onPress={() => {
                setActiveTab(tab);
                setMessage(null);
                setSyncMessage(null);
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
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}>
          {activeTab === 'home' ? (
            <HomeView
              colors={colors}
              onAdd={() => setActiveTab('add')}
              onOpenHistory={() => setActiveTab('history')}
              onOpenReminders={() => setActiveTab('reminders')}
              state={state}
              stats={stats}
            />
          ) : null}
          {activeTab === 'add' ? (
            <AddView
              colors={colors}
              draft={draft}
              friendPickerOpen={friendPickerOpen}
              friendQuery={friendQuery}
              friends={friends}
              onCloseFriendPicker={() => setFriendPickerOpen(false)}
              onFriendQuery={setFriendQuery}
              onOpenFriendPicker={() => setFriendPickerOpen(true)}
              onSave={handleSaveDraft}
              onSelectFriend={handleSelectFriend}
              onUpdateDraft={updateDraft}
            />
          ) : null}
          {activeTab === 'reminders' ? (
            <RemindersView
              colors={colors}
              onComplete={handleComplete}
              onCopy={(record) => {
                void handleCopyReminder(record);
              }}
              onTone={setReminderTone}
              records={reminders}
              tone={reminderTone}
            />
          ) : null}
          {activeTab === 'history' ? (
            <HistoryView
              colors={colors}
              filter={historyFilter}
              onClearAll={handleClearAll}
              onComplete={handleComplete}
              onDelete={handleDelete}
              onFilter={setHistoryFilter}
              onQuery={setHistoryQuery}
              onReopen={handleReopen}
              query={historyQuery}
              records={visibleHistory}
              total={state.records.length}
            />
          ) : null}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function draftToRecord(draft: Draft): BorrowRecord {
  const amount =
    draft.subjectType === 'money' && draft.amount.trim()
      ? Number(draft.amount.replace(/,/g, ''))
      : undefined;
  const title =
    draft.title.trim() ||
    (draft.subjectType === 'money'
      ? draft.kind === 'paid_for'
        ? '垫付费用'
        : '借款'
      : draft.platform.trim());
  return {
    id: newBorrowLedgerID('borrow'),
    kind: draft.kind,
    subjectType: draft.subjectType,
    title,
    amount,
    currency: draft.currency || 'CNY',
    platform: draft.subjectType === 'account' ? draft.platform : undefined,
    accountName: draft.subjectType === 'account' ? draft.accountName : undefined,
    counterparty: {
      friendId: draft.friendId || undefined,
      name: draft.counterpartyName,
      avatarUrl: draft.friendAvatar || undefined,
    },
    lentAt: draft.lentAt,
    dueAt: draft.dueAt || undefined,
    remindRule: draft.remindRule,
    note: draft.note,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function HomeView({
  colors,
  onAdd,
  onOpenHistory,
  onOpenReminders,
  state,
  stats,
}: {
  colors: Color;
  onAdd: () => void;
  onOpenHistory: () => void;
  onOpenReminders: () => void;
  state: BorrowLedgerState;
  stats: ReturnType<typeof borrowStats>;
}) {
  const activeRecords = state.records
    .filter((record) => recordStatus(record) !== 'done')
    .slice(0, 5);

  return (
    <View>
      <View style={[styles.hero, { backgroundColor: colors.hero }]}>
        <View style={styles.heroIcon}>
          <MaterialCommunityIcons name="repeat" size={22} color="#c9f36a" />
        </View>
        <ThemedText style={styles.heroTitle}>
          {state.records.length > 0
            ? `${stats.active + stats.overdue} 笔进行中 · ${stats.done} 笔已完成`
            : '谁借了我什么，一记就懂'}
        </ThemedText>
        <ThemedText style={styles.heroSub}>
          {state.records.length > 0
            ? '记录来自你真实录入，逾期由真实日期计算。'
            : '所有人员、物品、金额、日期和提醒都由你录入，不预置任何假数据。'}
        </ThemedText>
        <View style={styles.heroMeta}>
          <View style={styles.heroMetaItem}>
            <ThemedText style={styles.heroMetaValue}>{stats.lendOut}</ThemedText>
            <ThemedText style={styles.heroMetaLabel}>我借出</ThemedText>
          </View>
          <View style={styles.heroMetaItem}>
            <ThemedText style={styles.heroMetaValue}>{stats.borrowIn}</ThemedText>
            <ThemedText style={styles.heroMetaLabel}>我借入</ThemedText>
          </View>
          <View style={styles.heroMetaItem}>
            <ThemedText style={styles.heroMetaValue}>{stats.paidFor}</ThemedText>
            <ThemedText style={styles.heroMetaLabel}>垫付</ThemedText>
          </View>
        </View>
      </View>

      <View style={styles.quickGrid}>
        <QuickAction
          backgroundColor={colors.primarySoft}
          color={colors.primary}
          icon="plus"
          label="记一笔"
          onPress={onAdd}
        />
        <QuickAction
          backgroundColor="#fff1e4"
          color="#d9822b"
          icon="bell"
          label={`提醒 ${stats.overdue}`}
          onPress={onOpenReminders}
        />
        <QuickAction
          backgroundColor={colors.surfaceMuted}
          color={colors.mutedText}
          icon="history"
          label="历史"
          onPress={onOpenHistory}
        />
      </View>

      {state.records.length === 0 ? (
        <View style={[styles.emptyCard, { borderColor: colors.line }]}>
          <View style={[styles.emptyIcon, { backgroundColor: colors.primarySoft }]}>
            <MaterialCommunityIcons name="repeat" size={30} color={colors.primary} />
          </View>
          <ThemedText style={styles.emptyTitle}>还没有真实借还记录</ThemedText>
          <ThemedText style={[styles.emptySub, { color: colors.mutedText }]}>
            先记下一笔借出、借入或垫付，所有内容只来自你的真实录入。
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={onAdd}
            style={[styles.primaryButton, { backgroundColor: colors.primary }]}>
            <MaterialCommunityIcons name="plus" size={16} color="#ffffff" />
            <ThemedText style={styles.primaryButtonText}>记一笔</ThemedText>
          </Pressable>
        </View>
      ) : (
        <View style={[styles.panel, { borderColor: colors.line }]}>
          <View style={styles.panelTitleRow}>
            <ThemedText style={styles.panelTitle}>进行中</ThemedText>
            <ThemedText style={[styles.panelCount, { color: colors.mutedText }]}>
              {stats.active + stats.overdue} 笔
            </ThemedText>
          </View>
          {activeRecords.map((record) => (
            <RecordRow colors={colors} key={record.id} record={record} />
          ))}
          {activeRecords.length === 0 ? (
            <ThemedText style={[styles.emptyInline, { color: colors.mutedText }]}>
              当前没有进行中的真实记录
            </ThemedText>
          ) : null}
        </View>
      )}

      <View style={[styles.realNote, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <MaterialCommunityIcons name="database" size={14} color={colors.success} />
        <ThemedText style={[styles.realNoteText, { color: colors.mutedText }]}>
          所有统计、天数和状态都来自用户真实记录。
        </ThemedText>
      </View>
    </View>
  );
}

function QuickAction({
  backgroundColor,
  color,
  icon,
  label,
  onPress,
}: {
  backgroundColor: string;
  color: string;
  icon: 'plus' | 'bell' | 'history';
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.quickItem, { backgroundColor }, pressed && styles.pressed]}>
      <View style={[styles.quickIcon, { backgroundColor: 'rgba(255,255,255,0.72)' }]}>
        <MaterialCommunityIcons name={icon} size={17} color={color} />
      </View>
      <ThemedText style={[styles.quickLabel, { color }]}>{label}</ThemedText>
    </Pressable>
  );
}

function RecordRow({ colors, record }: { colors: Color; record: BorrowRecord }) {
  const status = recordStatus(record);
  return (
    <View style={[styles.recordRow, { borderTopColor: colors.line }]}>
      <View style={[styles.miniAvatar, { backgroundColor: recordStatusColor(status) }]}>
        <ThemedText style={styles.miniAvatarText}>
          {record.counterparty.name.slice(0, 1) || '借'}
        </ThemedText>
      </View>
      <View style={styles.recordCopy}>
        <ThemedText style={styles.recordName}>
          {record.counterparty.name} · {kindLabel(record.kind)}
        </ThemedText>
        <ThemedText style={[styles.recordDesc, { color: colors.mutedText }]}>
          {recordSubjectLabel(record)} · {recordStatusLabel(status)}
        </ThemedText>
      </View>
      <StatusChip colors={colors} status={status} />
    </View>
  );
}

function StatusChip({
  colors,
  status,
}: {
  colors: Color;
  status: 'active' | 'overdue' | 'done';
}) {
  const background =
    status === 'overdue'
      ? '#fff1e4'
      : status === 'done'
        ? colors.primarySoft
        : colors.surfaceMuted;
  const textColor =
    status === 'overdue' ? '#c46a12' : status === 'done' ? colors.primary : colors.mutedText;
  return (
    <View style={[styles.statusChip, { backgroundColor: background }]}>
      <ThemedText style={[styles.statusChipText, { color: textColor }]}>
        {recordStatusLabel(status)}
      </ThemedText>
    </View>
  );
}

function AddView({
  colors,
  draft,
  friendPickerOpen,
  friendQuery,
  friends,
  onCloseFriendPicker,
  onFriendQuery,
  onOpenFriendPicker,
  onSave,
  onSelectFriend,
  onUpdateDraft,
}: {
  colors: Color;
  draft: Draft;
  friendPickerOpen: boolean;
  friendQuery: string;
  friends: Friend[];
  onCloseFriendPicker: () => void;
  onFriendQuery: (value: string) => void;
  onOpenFriendPicker: () => void;
  onSave: () => void;
  onSelectFriend: (friend: Friend) => void;
  onUpdateDraft: (patch: Partial<Draft>) => void;
}) {
  const filteredFriends = friends.filter((friend) =>
    [friend.user.displayName, friend.user.username].some((value) =>
      value.toLocaleLowerCase().includes(friendQuery.trim().toLocaleLowerCase()),
    ),
  );

  return (
    <View>
      <View style={[styles.segmented, { backgroundColor: colors.surfaceMuted }]}>
        {(
          [
            ['lend_out', '我借出', 'arrow-up-right'],
            ['borrow_in', '我借入', 'arrow-down-left'],
            ['paid_for', '垫付费用', 'cash'],
          ] as const
        ).map(([kind, label, icon]) => (
          <Pressable
            key={kind}
            accessibilityRole="button"
            onPress={() => onUpdateDraft({ kind })}
            style={[
              styles.segButton,
              draft.kind === kind && { backgroundColor: colors.surface },
            ]}>
            <MaterialCommunityIcons
              name={icon}
              size={14}
              color={draft.kind === kind ? colors.text : colors.mutedText}
            />
            <ThemedText
              style={[
                styles.segText,
                { color: draft.kind === kind ? colors.text : colors.mutedText },
              ]}>
              {label}
            </ThemedText>
          </Pressable>
        ))}
      </View>

      <View style={[styles.panel, { borderColor: colors.line }]}>
        <FormLabel>谁</FormLabel>
        <View style={styles.inputRow}>
          <TextInput
            accessibilityLabel="人员姓名或称呼"
            autoCapitalize="none"
            maxLength={BORROW_LEDGER_MAX_COUNTERPARTY_NAME}
            onChangeText={(value) => onUpdateDraft({ counterpartyName: value })}
            placeholder="输入真实姓名或称呼"
            placeholderTextColor={colors.mutedText}
            style={[styles.input, { backgroundColor: colors.surfaceMuted, color: colors.text }]}
            value={draft.counterpartyName}
          />
          <Pressable
            accessibilityRole="button"
            onPress={friendPickerOpen ? onCloseFriendPicker : onOpenFriendPicker}
            style={[styles.smallButton, { backgroundColor: colors.primarySoft }]}>
            <MaterialCommunityIcons name="account" size={15} color={colors.primary} />
            <ThemedText style={[styles.smallButtonText, { color: colors.primary }]}>
              {friendPickerOpen ? '收起' : '选好友'}
            </ThemedText>
          </Pressable>
        </View>

        {friendPickerOpen ? (
          <View style={[styles.friendPicker, { backgroundColor: colors.surfaceMuted }]}>
            <View style={styles.friendSearch}>
              <MaterialCommunityIcons name="magnify" size={16} color={colors.mutedText} />
              <TextInput
                accessibilityLabel="搜索好友"
                autoCapitalize="none"
                onChangeText={onFriendQuery}
                placeholder="搜索好友昵称或账号"
                placeholderTextColor={colors.mutedText}
                style={[styles.friendSearchInput, { color: colors.text }]}
                value={friendQuery}
              />
            </View>
            {friends.length === 0 ? (
              <ThemedText style={[styles.friendEmpty, { color: colors.mutedText }]}>
                登录后可选择真实好友，也可以手动输入真实称呼。
              </ThemedText>
            ) : filteredFriends.length === 0 ? (
              <ThemedText style={[styles.friendEmpty, { color: colors.mutedText }]}>
                没有匹配的真实好友
              </ThemedText>
            ) : (
              filteredFriends.map((friend) => (
                <Pressable
                  key={friend.user.id}
                  accessibilityRole="button"
                  onPress={() => onSelectFriend(friend)}
                  style={[styles.friendRow, { borderTopColor: colors.line }]}>
                  <View style={[styles.friendAvatar, { backgroundColor: colors.primary }]}>
                    <ThemedText style={styles.friendAvatarText}>
                      {friend.user.displayName.slice(0, 1)}
                    </ThemedText>
                  </View>
                  <View style={styles.recordCopy}>
                    <ThemedText style={styles.recordName}>{friend.user.displayName}</ThemedText>
                    <ThemedText style={[styles.recordDesc, { color: colors.mutedText }]}>
                      {friend.user.online ? '在线 · 真实好友' : '离线 · 真实好友'}
                    </ThemedText>
                  </View>
                  <MaterialCommunityIcons name="chevron-right" size={18} color={colors.mutedText} />
                </Pressable>
              ))
            )}
          </View>
        ) : null}
      </View>

      <View style={[styles.panel, { borderColor: colors.line }]}>
        <FormLabel>标的物类型</FormLabel>
        <View style={styles.chipRow}>
          {(['item', 'money', 'account'] as const).map((subjectType) => (
            <Pressable
              key={subjectType}
              accessibilityRole="button"
              onPress={() => onUpdateDraft({ subjectType })}
              style={[
                styles.chip,
                draft.subjectType === subjectType && {
                  backgroundColor: colors.primarySoft,
                  borderColor: colors.primary,
                },
              ]}>
              <ThemedText
                style={[
                  styles.chipText,
                  { color: draft.subjectType === subjectType ? colors.primary : colors.mutedText },
                ]}>
                {subjectTypeLabel(subjectType)}
              </ThemedText>
            </Pressable>
          ))}
        </View>

        {draft.subjectType === 'item' ? (
          <View style={styles.field}>
            <FormLabel>物品名称</FormLabel>
            <TextInput
              accessibilityLabel="物品名称"
              maxLength={BORROW_LEDGER_MAX_TITLE}
              onChangeText={(value) => onUpdateDraft({ title: value })}
              placeholder="充电器 / 书 / 设备"
              placeholderTextColor={colors.mutedText}
              style={[styles.input, { backgroundColor: colors.surfaceMuted, color: colors.text }]}
              value={draft.title}
            />
          </View>
        ) : null}

        {draft.subjectType === 'money' ? (
          <View style={styles.field}>
            <FormLabel>金额</FormLabel>
            <View style={styles.inputRow}>
              <TextInput
                accessibilityLabel="金额"
                keyboardType="decimal-pad"
                onChangeText={(value) => onUpdateDraft({ amount: value })}
                placeholder="0.00"
                placeholderTextColor={colors.mutedText}
                style={[styles.input, { backgroundColor: colors.surfaceMuted, color: colors.text }]}
                value={draft.amount}
              />
              <View style={[styles.currencyBadge, { backgroundColor: colors.surfaceMuted }]}>
                <ThemedText style={[styles.currencyText, { color: colors.text }]}>
                  {draft.currency}
                </ThemedText>
              </View>
            </View>
          </View>
        ) : null}

        {draft.subjectType === 'account' ? (
          <>
            <View style={styles.field}>
              <FormLabel>会员平台</FormLabel>
              <TextInput
                accessibilityLabel="会员平台"
                maxLength={BORROW_LEDGER_MAX_PLATFORM}
                onChangeText={(value) => onUpdateDraft({ platform: value })}
                placeholder="视频 / 网盘 / 音乐平台"
                placeholderTextColor={colors.mutedText}
                style={[styles.input, { backgroundColor: colors.surfaceMuted, color: colors.text }]}
                value={draft.platform}
              />
            </View>
            <View style={styles.field}>
              <FormLabel>账号名 / 昵称</FormLabel>
              <TextInput
                accessibilityLabel="账号名"
                maxLength={BORROW_LEDGER_MAX_ACCOUNT_NAME}
                onChangeText={(value) => onUpdateDraft({ accountName: value })}
                placeholder="不填写密码或验证码"
                placeholderTextColor={colors.mutedText}
                style={[styles.input, { backgroundColor: colors.surfaceMuted, color: colors.text }]}
                value={draft.accountName}
              />
              <FormHint>只记录账号名用于识别，不保存密码、验证码或登录态。</FormHint>
            </View>
          </>
        ) : null}

        <View style={styles.field}>
          <FormLabel>{draft.kind === 'paid_for' ? '垫付时间' : '借出/借入时间'}</FormLabel>
          <TextInput
            accessibilityLabel="日期"
            onChangeText={(value) => onUpdateDraft({ lentAt: value })}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colors.mutedText}
            style={[styles.input, { backgroundColor: colors.surfaceMuted, color: colors.text }]}
            value={draft.lentAt}
          />
        </View>

        <View style={styles.field}>
          <FormLabel>约定归还 / 结清日期</FormLabel>
          <TextInput
            accessibilityLabel="约定日期"
            onChangeText={(value) => onUpdateDraft({ dueAt: value })}
            placeholder="选填"
            placeholderTextColor={colors.mutedText}
            style={[styles.input, { backgroundColor: colors.surfaceMuted, color: colors.text }]}
            value={draft.dueAt}
          />
        </View>

        <View style={styles.field}>
          <FormLabel>提醒</FormLabel>
          <View style={styles.ruleWrap}>
            {REMIND_RULES.map((rule) => (
              <Pressable
                key={rule}
                accessibilityRole="button"
                onPress={() => onUpdateDraft({ remindRule: rule })}
                style={[
                  styles.ruleChip,
                  draft.remindRule === rule && {
                    backgroundColor: colors.primarySoft,
                    borderColor: colors.primary,
                  },
                ]}>
                <ThemedText
                  style={[
                    styles.ruleChipText,
                    {
                      color:
                        draft.remindRule === rule ? colors.primary : colors.mutedText,
                    },
                  ]}>
                  {remindRuleLabel(rule)}
                </ThemedText>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.field}>
          <FormLabel>备注</FormLabel>
          <TextInput
            accessibilityLabel="备注"
            maxLength={BORROW_LEDGER_MAX_NOTE}
            multiline
            onChangeText={(value) => onUpdateDraft({ note: value })}
            placeholder="选填，例如颜色、版本或归还说明"
            placeholderTextColor={colors.mutedText}
            style={[
              styles.input,
              styles.textarea,
              { backgroundColor: colors.surfaceMuted, color: colors.text },
            ]}
            value={draft.note}
          />
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={onSave}
        style={[styles.primaryButton, { backgroundColor: colors.primary }]}>
        <MaterialCommunityIcons name="check" size={16} color="#ffffff" />
        <ThemedText style={styles.primaryButtonText}>保存真实记录</ThemedText>
      </Pressable>

      <View style={[styles.realNote, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <MaterialCommunityIcons name="shield-check" size={14} color={colors.success} />
        <ThemedText style={[styles.realNoteText, { color: colors.mutedText }]}>
          会员账号只记录平台和账号名，不保存密码或验证码。
        </ThemedText>
      </View>
    </View>
  );
}

function RemindersView({
  colors,
  onComplete,
  onCopy,
  onTone,
  records,
  tone,
}: {
  colors: Color;
  onComplete: (recordId: string) => void;
  onCopy: (record: BorrowRecord) => void;
  onTone: (tone: ReminderTone) => void;
  records: BorrowRecord[];
  tone: ReminderTone;
}) {
  if (records.length === 0) {
    return (
      <View style={[styles.emptyCard, { borderColor: colors.line }]}>
        <View style={[styles.emptyIcon, { backgroundColor: colors.primarySoft }]}>
          <MaterialCommunityIcons name="bell-off-outline" size={28} color={colors.primary} />
        </View>
        <ThemedText style={styles.emptyTitle}>没有待提醒的真实记录</ThemedText>
        <ThemedText style={[styles.emptySub, { color: colors.mutedText }]}>
          为真实记录设置约定日期和提醒后，提醒卡会出现在这里。
        </ThemedText>
      </View>
    );
  }

  return (
    <View>
      <View style={styles.toneRow}>
        <ThemedText style={[styles.toneLabel, { color: colors.mutedText }]}>语气</ThemedText>
        <View style={styles.toneChips}>
          {(
            [
              ['casual', '轻松'],
              ['short', '简短'],
              ['formal', '正式'],
            ] as const
          ).map(([value, label]) => (
            <Pressable
              key={value}
              accessibilityRole="button"
              onPress={() => onTone(value)}
              style={[
                styles.chip,
                tone === value && {
                  backgroundColor: colors.primarySoft,
                  borderColor: colors.primary,
                },
              ]}>
              <ThemedText
                style={[
                  styles.chipText,
                  { color: tone === value ? colors.primary : colors.mutedText },
                ]}>
                {label}
              </ThemedText>
            </Pressable>
          ))}
        </View>
      </View>

      {records.map((record) => (
        <View key={record.id} style={[styles.reminderCard, { borderColor: '#f1dcb9' }]}>
          <View style={styles.reminderHead}>
            <View style={[styles.reminderIcon, { backgroundColor: '#e8a33d' }]}>
              <MaterialCommunityIcons name="message-text-outline" size={16} color="#ffffff" />
            </View>
            <View style={styles.recordCopy}>
              <ThemedText style={styles.reminderTitle}>
                轻松提醒 · {kindLabel(record.kind)}
              </ThemedText>
              <ThemedText style={[styles.reminderSub, { color: colors.mutedText }]}>
                来自真实借还记录
              </ThemedText>
            </View>
          </View>
          <ThemedText style={styles.reminderBody}>
            {buildReminderText(record, tone)}
          </ThemedText>
          <View style={styles.reminderActions}>
            <Pressable
              accessibilityRole="button"
              onPress={() => onCopy(record)}
              style={[styles.secondaryButton, { backgroundColor: colors.primarySoft }]}>
              <MaterialCommunityIcons name="content-copy" size={14} color={colors.primary} />
              <ThemedText style={[styles.secondaryButtonText, { color: colors.primary }]}>
                复制提醒
              </ThemedText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => onComplete(record.id)}
              style={[styles.secondaryButton, { backgroundColor: colors.surfaceMuted }]}>
              <MaterialCommunityIcons name="check" size={14} color={colors.success} />
              <ThemedText style={[styles.secondaryButtonText, { color: colors.success }]}>
                {record.kind === 'paid_for' ? '标记已结清' : '标记已归还'}
              </ThemedText>
            </Pressable>
          </View>
        </View>
      ))}

      <View style={[styles.realNote, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <MaterialCommunityIcons name="database" size={14} color={colors.success} />
        <ThemedText style={[styles.realNoteText, { color: colors.mutedText }]}>
          提醒文案只由真实字段生成，不编造天数或催促语气。
        </ThemedText>
      </View>
    </View>
  );
}

function HistoryView({
  colors,
  filter,
  onClearAll,
  onComplete,
  onDelete,
  onFilter,
  onQuery,
  onReopen,
  query,
  records,
  total,
}: {
  colors: Color;
  filter: BorrowHistoryFilter;
  onClearAll: () => void;
  onComplete: (recordId: string) => void;
  onDelete: (recordId: string) => void;
  onFilter: (filter: BorrowHistoryFilter) => void;
  onQuery: (query: string) => void;
  onReopen: (recordId: string) => void;
  query: string;
  records: BorrowRecord[];
  total: number;
}) {
  return (
    <View>
      <View style={styles.searchField}>
        <MaterialCommunityIcons name="magnify" size={16} color={colors.mutedText} />
        <TextInput
          accessibilityLabel="搜索借还记录"
          autoCapitalize="none"
          onChangeText={onQuery}
          placeholder="搜索人员、物品、金额、平台或备注"
          placeholderTextColor={colors.mutedText}
          style={[styles.searchInput, { color: colors.text }]}
          value={query}
        />
      </View>

      <View style={styles.filterRow}>
        {(
          [
            ['all', '全部'],
            ['active', '进行中'],
            ['overdue', '已逾期'],
            ['done', '已完成'],
          ] as const
        ).map(([value, label]) => (
          <Pressable
            key={value}
            accessibilityRole="button"
            onPress={() => onFilter(value)}
            style={[
              styles.filterChip,
              filter === value && { backgroundColor: colors.hero },
            ]}>
            <ThemedText
              style={[
                styles.filterChipText,
                { color: filter === value ? '#ffffff' : colors.mutedText },
              ]}>
              {label}
            </ThemedText>
          </Pressable>
        ))}
      </View>

      {records.length === 0 ? (
        <View style={[styles.emptyCard, { borderColor: colors.line }]}>
          <ThemedText style={styles.emptyTitle}>没有符合条件的真实记录</ThemedText>
          <ThemedText style={[styles.emptySub, { color: colors.mutedText }]}>
            清空筛选或先记一笔。
          </ThemedText>
        </View>
      ) : (
        <View style={[styles.historyList, { borderColor: colors.line }]}>
          {records.map((record) => (
            <View key={record.id} style={[styles.historyRow, { borderTopColor: colors.line }]}>
              <View style={[styles.miniAvatar, { backgroundColor: recordStatusColor(recordStatus(record)) }]}>
                <ThemedText style={styles.miniAvatarText}>
                  {record.counterparty.name.slice(0, 1)}
                </ThemedText>
              </View>
              <View style={styles.recordCopy}>
                <ThemedText style={styles.recordName}>
                  {record.counterparty.name} · {recordSubjectLabel(record)}
                </ThemedText>
                <ThemedText style={[styles.recordDesc, { color: colors.mutedText }]}>
                  {kindLabel(record.kind)} · {record.lentAt}
                </ThemedText>
              </View>
              <StatusChip colors={colors} status={recordStatus(record)} />
              <View style={styles.historyActionsRow}>
                {recordStatus(record) === 'done' ? (
                  <Pressable
                    accessibilityLabel="重新打开记录"
                    accessibilityRole="button"
                    onPress={() => onReopen(record.id)}
                    style={[styles.iconAction, { backgroundColor: colors.surfaceMuted }]}>
                    <MaterialCommunityIcons name="backup-restore" size={15} color={colors.mutedText} />
                  </Pressable>
                ) : (
                  <Pressable
                    accessibilityLabel={record.kind === 'paid_for' ? '标记已结清' : '标记已归还'}
                    accessibilityRole="button"
                    onPress={() => onComplete(record.id)}
                    style={[styles.iconAction, { backgroundColor: colors.primarySoft }]}>
                    <MaterialCommunityIcons name="check" size={15} color={colors.primary} />
                  </Pressable>
                )}
                <Pressable
                  accessibilityLabel="删除记录"
                  accessibilityRole="button"
                  onPress={() => onDelete(record.id)}
                  style={[styles.iconAction, { backgroundColor: colors.surfaceMuted }]}>
                  <MaterialCommunityIcons name="delete-outline" size={15} color={colors.mutedText} />
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      )}

      <View style={styles.historyActions}>
        <Pressable
          accessibilityRole="button"
          onPress={onClearAll}
          style={[styles.secondaryButton, { backgroundColor: colors.surfaceMuted }]}>
          <MaterialCommunityIcons name="delete-outline" size={15} color={colors.mutedText} />
          <ThemedText style={[styles.secondaryButtonText, { color: colors.mutedText }]}>
            清空全部 {total} 条
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

function FormLabel({ children }: { children: string }) {
  return <ThemedText style={styles.fieldLabel}>{children}</ThemedText>;
}

function FormHint({ children }: { children: string }) {
  return <ThemedText style={[styles.formHint, { color: '#7483a2' }]}>{children}</ThemedText>;
}

function recordStatusColor(status: 'active' | 'overdue' | 'done') {
  if (status === 'overdue') return '#d9822b';
  if (status === 'done') return '#18a78f';
  return '#4568f2';
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  screen: {
    flex: 1,
    width: '100%',
  },
  centerState: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  stateTitle: {
    fontSize: 17,
    fontWeight: '900',
    marginTop: 16,
  },
  stateText: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 8,
    textAlign: 'center',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    minHeight: 56,
    paddingHorizontal: 16,
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: 12,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  headerTitleWrap: {
    flex: 1,
    marginLeft: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '900',
  },
  headerMeta: {
    fontSize: 10,
    fontWeight: '700',
    marginTop: 3,
  },
  pressed: {
    opacity: 0.68,
  },
  tabs: {
    borderRadius: 14,
    flexDirection: 'row',
    gap: 4,
    marginHorizontal: 16,
    padding: 4,
  },
  tab: {
    alignItems: 'center',
    borderRadius: 11,
    flex: 1,
    height: 36,
    justifyContent: 'center',
  },
  tabText: {
    fontSize: 11,
    fontWeight: '800',
  },
  messageBanner: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 7,
    marginHorizontal: 16,
    marginTop: 10,
    minHeight: 36,
    paddingHorizontal: 12,
  },
  messageText: {
    flex: 1,
    fontSize: 10,
    fontWeight: '700',
  },
  scrollContent: {
    paddingBottom: 28,
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  hero: {
    borderRadius: 18,
    padding: 18,
  },
  heroIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(201,243,106,0.14)',
    borderColor: 'rgba(201,243,106,0.28)',
    borderRadius: 12,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  heroTitle: {
    color: '#ffffff',
    fontSize: 19,
    fontWeight: '900',
    marginTop: 14,
  },
  heroSub: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 10,
    fontWeight: '600',
    lineHeight: 16,
    marginTop: 5,
  },
  heroMeta: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
  },
  heroMetaItem: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderColor: 'rgba(255,255,255,0.14)',
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    paddingVertical: 8,
  },
  heroMetaValue: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '900',
    textAlign: 'center',
  },
  heroMetaLabel: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 9,
    fontWeight: '700',
    marginTop: 2,
    textAlign: 'center',
  },
  quickGrid: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  quickItem: {
    alignItems: 'center',
    borderRadius: 12,
    flex: 1,
    minHeight: 68,
    justifyContent: 'center',
  },
  quickIcon: {
    alignItems: 'center',
    borderRadius: 9,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  quickLabel: {
    fontSize: 10,
    fontWeight: '800',
    marginTop: 7,
  },
  panel: {
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  panelTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 36,
  },
  panelTitle: {
    fontSize: 12,
    fontWeight: '900',
  },
  panelCount: {
    fontSize: 9,
    fontWeight: '700',
  },
  recordRow: {
    alignItems: 'center',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 58,
  },
  miniAvatar: {
    alignItems: 'center',
    borderRadius: 20,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  miniAvatarText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '900',
  },
  recordCopy: {
    flex: 1,
    minWidth: 0,
  },
  recordName: {
    fontSize: 11,
    fontWeight: '800',
  },
  recordDesc: {
    fontSize: 9,
    fontWeight: '600',
    marginTop: 3,
  },
  statusChip: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  statusChipText: {
    fontSize: 9,
    fontWeight: '800',
  },
  emptyCard: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 14,
    paddingHorizontal: 20,
    paddingVertical: 34,
  },
  emptyIcon: {
    alignItems: 'center',
    borderRadius: 36,
    height: 68,
    justifyContent: 'center',
    width: 68,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '900',
    marginTop: 16,
    textAlign: 'center',
  },
  emptySub: {
    fontSize: 10,
    fontWeight: '600',
    lineHeight: 17,
    marginTop: 8,
    textAlign: 'center',
  },
  emptyInline: {
    borderTopWidth: 1,
    fontSize: 10,
    fontWeight: '600',
    paddingVertical: 14,
  },
  realNote: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    marginTop: 12,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  realNoteText: {
    flex: 1,
    fontSize: 9,
    fontWeight: '700',
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 7,
    height: 46,
    justifyContent: 'center',
    marginTop: 14,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '900',
  },
  secondaryButton: {
    alignItems: 'center',
    borderRadius: 11,
    flexDirection: 'row',
    gap: 6,
    height: 40,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  secondaryButtonText: {
    fontSize: 10,
    fontWeight: '800',
  },
  segmented: {
    borderRadius: 12,
    flexDirection: 'row',
    gap: 4,
    padding: 4,
  },
  segButton: {
    alignItems: 'center',
    borderRadius: 9,
    flex: 1,
    flexDirection: 'row',
    gap: 5,
    height: 38,
    justifyContent: 'center',
  },
  segText: {
    fontSize: 10,
    fontWeight: '800',
  },
  field: {
    marginTop: 13,
  },
  fieldLabel: {
    fontSize: 10,
    fontWeight: '900',
    marginBottom: 6,
  },
  input: {
    borderRadius: 10,
    fontSize: 12,
    fontWeight: '700',
    height: 42,
    paddingHorizontal: 11,
  },
  inputRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  smallButton: {
    alignItems: 'center',
    borderRadius: 10,
    flexDirection: 'row',
    gap: 5,
    height: 42,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  smallButtonText: {
    fontSize: 10,
    fontWeight: '800',
  },
  friendPicker: {
    borderRadius: 12,
    marginTop: 10,
    padding: 10,
  },
  friendSearch: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 10,
    flexDirection: 'row',
    gap: 7,
    height: 40,
    paddingHorizontal: 10,
  },
  friendSearchInput: {
    flex: 1,
    fontSize: 11,
    fontWeight: '700',
    minWidth: 0,
  },
  friendEmpty: {
    fontSize: 10,
    fontWeight: '600',
    lineHeight: 16,
    paddingVertical: 14,
    textAlign: 'center',
  },
  friendRow: {
    alignItems: 'center',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 54,
  },
  friendAvatar: {
    alignItems: 'center',
    borderRadius: 17,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  friendAvatarText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '900',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#dce4f2',
    borderRadius: 999,
    borderWidth: 1,
    height: 32,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  chipText: {
    fontSize: 10,
    fontWeight: '800',
  },
  currencyBadge: {
    alignItems: 'center',
    borderRadius: 10,
    height: 42,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  currencyText: {
    fontSize: 11,
    fontWeight: '900',
  },
  formHint: {
    fontSize: 8,
    fontWeight: '600',
    lineHeight: 14,
    marginTop: 5,
  },
  ruleWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  ruleChip: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#dce4f2',
    borderRadius: 9,
    borderWidth: 1,
    height: 30,
    justifyContent: 'center',
    paddingHorizontal: 9,
  },
  ruleChipText: {
    fontSize: 9,
    fontWeight: '800',
  },
  textarea: {
    height: 72,
    paddingTop: 10,
    textAlignVertical: 'top',
  },
  toneRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  toneLabel: {
    fontSize: 11,
    fontWeight: '800',
  },
  toneChips: {
    flexDirection: 'row',
    gap: 7,
  },
  reminderCard: {
    backgroundColor: '#fffaf1',
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 14,
    overflow: 'hidden',
  },
  reminderHead: {
    alignItems: 'center',
    borderBottomColor: '#f2e2c5',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 9,
    padding: 12,
  },
  reminderIcon: {
    alignItems: 'center',
    borderRadius: 9,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  reminderTitle: {
    fontSize: 12,
    fontWeight: '900',
  },
  reminderSub: {
    fontSize: 8,
    fontWeight: '600',
    marginTop: 3,
  },
  reminderBody: {
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 21,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  reminderActions: {
    flexDirection: 'row',
    gap: 8,
    padding: 12,
    paddingTop: 0,
  },
  searchField: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#dce4f2',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 7,
    height: 42,
    paddingHorizontal: 11,
  },
  searchInput: {
    flex: 1,
    fontSize: 11,
    fontWeight: '700',
    minWidth: 0,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: 12,
  },
  filterChip: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#dce4f2',
    borderRadius: 999,
    borderWidth: 1,
    height: 30,
    justifyContent: 'center',
    paddingHorizontal: 11,
  },
  filterChipText: {
    fontSize: 9,
    fontWeight: '800',
  },
  historyList: {
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  historyRow: {
    alignItems: 'center',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 62,
  },
  historyActions: {
    alignItems: 'center',
    marginTop: 14,
  },
  historyActionsRow: {
    flexDirection: 'row',
    gap: 6,
  },
  iconAction: {
    alignItems: 'center',
    borderRadius: 8,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
});
