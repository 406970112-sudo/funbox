import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { appLayout } from '@/constants/app-theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useAuth } from '@/features/auth/auth-provider';
import {
  createDiaryNotebook,
  deleteDiaryEntry,
  deleteDiaryMedia,
  deleteDiaryNotebook,
  exportDiary,
  fetchDiaryCalendar,
  fetchDiaryEntry,
  fetchDiaryNotebooks,
  fetchDiaryStats,
  getDiaryErrorMessage,
  lockDiaryNotebook,
  saveDiaryEntry,
  searchDiaryEntries,
  unlockDiaryNotebook,
  updateDiaryNotebook,
  updateDiaryPassword,
  uploadDiaryMedia,
} from '@/lib/diary-api';
import type {
  DiaryCalendar,
  DiaryEntry,
  DiaryMood,
  DiaryNotebook,
  DiaryStats,
  DiaryWeather,
} from '@/types/diary';

type DiaryTab = 'today' | 'history' | 'stats' | 'settings';

const COVER_COLORS = ['#4b6bff', '#18a78f', '#ff6b8f', '#e8a33d', '#8b5cf6', '#20ad78'];
const MOODS: { value: DiaryMood; label: string; icon: string }[] = [
  { value: 'happy', label: '开心', icon: 'emoticon-happy-outline' },
  { value: 'calm', label: '平静', icon: 'weather-sunny' },
  { value: 'tired', label: '疲惫', icon: 'weather-cloudy' },
  { value: 'sad', label: '难过', icon: 'weather-rainy' },
  { value: 'angry', label: '生气', icon: 'fire' },
];
const WEATHERS: { value: DiaryWeather; label: string; icon: string }[] = [
  { value: 'sunny', label: '晴', icon: 'weather-sunny' },
  { value: 'cloudy', label: '多云', icon: 'weather-partly-cloudy' },
  { value: 'rainy', label: '雨', icon: 'weather-rainy' },
  { value: 'windy', label: '风', icon: 'weather-windy' },
];

function todayDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, '0')}`;
}

function shiftMonth(month: string, delta: number) {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(year, monthNumber - 1 + delta, 1);
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}`;
}

function formatDateLabel(date: string) {
  const [, month, day] = date.split('-').map(Number);
  return `${month} 月 ${day} 日`;
}

function moodLabel(mood: DiaryMood) {
  return MOODS.find((item) => item.value === mood)?.label ?? '未记录';
}

function moodColor(mood: DiaryMood) {
  switch (mood) {
    case 'happy':
      return '#e8a33d';
    case 'calm':
      return '#18a78f';
    case 'tired':
      return '#4b6bff';
    case 'sad':
      return '#8b5cf6';
    case 'angry':
      return '#ff6b8f';
    default:
      return '#a9b4c8';
  }
}

export function DiaryScreen() {
  const router = useRouter();
  const { accessToken, status: authStatus, user } = useAuth();
  const { colors, colorScheme } = useAppTheme();
  const dark = colorScheme === 'dark';
  const [notebooks, setNotebooks] = useState<DiaryNotebook[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [unlocks, setUnlocks] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<DiaryTab>('today');
  const [date, setDate] = useState(todayDateString());
  const [month, setMonth] = useState(currentMonthKey());
  const [entry, setEntry] = useState<DiaryEntry | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [mood, setMood] = useState<DiaryMood>('');
  const [weather, setWeather] = useState<DiaryWeather>('');
  const [calendar, setCalendar] = useState<DiaryCalendar>({ month: '', days: [] });
  const [stats, setStats] = useState<DiaryStats | null>(null);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<DiaryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [unlockPassword, setUnlockPassword] = useState('');
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(COVER_COLORS[0]);
  const [newPassword, setNewPassword] = useState('');
  const requestRef = useRef(0);
  const hasLoadedRef = useRef(false);

  const active = useMemo(
    () => notebooks.find((notebook) => notebook.id === activeId) ?? null,
    [activeId, notebooks],
  );
  const unlockToken = activeId ? unlocks[activeId] : undefined;
  const locked = !!active?.hasPassword && !unlockToken;

  const loadNotebooks = useCallback(async () => {
    if (!accessToken) return;
    const requestID = ++requestRef.current;
    setLoading(!hasLoadedRef.current);
    setError('');
    try {
      const items = await fetchDiaryNotebooks(accessToken);
      if (requestID !== requestRef.current) return;
      setNotebooks(items);
      setLoading(false);
      hasLoadedRef.current = true;
    } catch (caught) {
      if (requestID !== requestRef.current) return;
      setError(getDiaryErrorMessage(caught));
      setLoading(false);
    } finally {
      if (requestID === requestRef.current) setRefreshing(false);
    }
  }, [accessToken]);

  const loadDiaryData = useCallback(async () => {
    if (!accessToken || !activeId) return;
    const token = unlocks[activeId];
    const requestID = ++requestRef.current;
    setLoading(true);
    setError('');
    try {
      const monthSnapshot = await fetchDiaryCalendar(accessToken, activeId, month);
      const statItems = await fetchDiaryStats(accessToken, activeId);
      if (requestID !== requestRef.current) return;
      setCalendar(monthSnapshot);
      setStats(statItems);
      const current = await fetchDiaryEntry(accessToken, activeId, date, token).catch(() => null);
      if (requestID !== requestRef.current) return;
      setEntry(current);
      setTitle(current?.title ?? '');
      setContent(current?.content ?? '');
      setMood(current?.mood ?? '');
      setWeather(current?.weather ?? '');
      setLoading(false);
    } catch (caught) {
      if (requestID !== requestRef.current) return;
      setError(getDiaryErrorMessage(caught));
      setLoading(false);
    } finally {
      if (requestID === requestRef.current) setRefreshing(false);
    }
  }, [accessToken, activeId, date, month, unlocks]);

  useEffect(() => {
    void loadNotebooks();
  }, [loadNotebooks]);

  useEffect(() => {
    if (activeId) void loadDiaryData();
  }, [activeId, loadDiaryData]);

  async function enterNotebook(notebookId: string) {
    setActiveId(notebookId);
    setDate(todayDateString());
    setMonth(currentMonthKey());
    setTab('today');
    setQuery('');
    setSearchResults([]);
    setEntry(null);
    setTitle('');
    setContent('');
    setMood('');
    setWeather('');
  }

  async function handleUnlock() {
    if (!accessToken || !activeId) return;
    setBusy(true);
    setError('');
    try {
      const result = await unlockDiaryNotebook(accessToken, activeId, unlockPassword);
      setUnlocks((current) => ({ ...current, [activeId]: result.unlockToken }));
      setUnlockPassword('');
      setUnlockOpen(false);
      await loadDiaryData();
    } catch (caught) {
      setError(getDiaryErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function handleLock() {
    if (!accessToken || !activeId || !unlockToken) return;
    await lockDiaryNotebook(accessToken, activeId, unlockToken).catch(() => undefined);
    setUnlocks((current) => {
      const next = { ...current };
      delete next[activeId];
      return next;
    });
    setEntry(null);
    setTitle('');
    setContent('');
  }

  async function saveCurrentEntry() {
    if (!accessToken || !activeId) return;
    if (!content.trim()) {
      setError('日记正文不能为空。');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const saved = await saveDiaryEntry(
        accessToken,
        activeId,
        date,
        { title: title.trim(), content: content.trim(), mood, weather },
        unlockToken,
      );
      setEntry(saved);
      setMessage('日记已保存。');
      await loadDiaryData();
    } catch (caught) {
      setError(getDiaryErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  function confirmDeleteEntry() {
    if (!accessToken || !activeId) return;
    Alert.alert('删除这篇日记', '删除后日历圆点也会消失，确定继续吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void deleteDiaryEntry(accessToken, activeId, date, unlockToken)
            .then(async () => {
              setEntry(null);
              setTitle('');
              setContent('');
              setMood('');
              setWeather('');
              setMessage('日记已删除。');
              await loadDiaryData();
            })
            .catch((caught) => setError(getDiaryErrorMessage(caught)));
        },
      },
    ]);
  }

  async function pickImages() {
    if (!accessToken || !activeId) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('需要相册权限才能添加日记图片。');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsMultipleSelection: true,
      mediaTypes: ['images'],
      quality: 0.9,
      selectionLimit: 9 - (entry?.media.length ?? 0),
    });
    if (result.canceled) return;
    setBusy(true);
    setError('');
    try {
      const files = result.assets.map((asset) => ({
        name: asset.fileName || `diary-${Date.now()}.jpg`,
        type: asset.mimeType || 'image/jpeg',
        uri: asset.uri,
      }));
      const updated = await uploadDiaryMedia(accessToken, activeId, date, files, unlockToken);
      setEntry(updated);
      setMessage('图片已添加。');
      await loadDiaryData();
    } catch (caught) {
      setError(getDiaryErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  function confirmDeleteMedia(mediaId: string) {
    if (!accessToken || !activeId) return;
    Alert.alert('移除图片', '确定从这篇日记中移除这张图片吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '移除',
        style: 'destructive',
        onPress: () => {
          void deleteDiaryMedia(accessToken, activeId, mediaId, unlockToken)
            .then(async () => {
              setMessage('图片已移除。');
              await loadDiaryData();
            })
            .catch((caught) => setError(getDiaryErrorMessage(caught)));
        },
      },
    ]);
  }

  async function runSearch() {
    if (!accessToken || !activeId || !query.trim()) {
      setSearchResults([]);
      return;
    }
    setBusy(true);
    setError('');
    try {
      setSearchResults(await searchDiaryEntries(accessToken, activeId, query.trim(), unlockToken));
    } catch (caught) {
      setError(getDiaryErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function runExport() {
    if (!accessToken || !activeId) return;
    setBusy(true);
    setError('');
    try {
      const markdown = await exportDiary(accessToken, activeId, unlockToken);
      if (typeof window !== 'undefined') {
        const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `diary-${active?.name ?? 'notebook'}.md`;
        link.click();
        URL.revokeObjectURL(url);
      } else {
        Alert.alert('导出成功', markdown.slice(0, 500));
      }
      setMessage('日记已导出。');
    } catch (caught) {
      setError(getDiaryErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function createNotebook() {
    if (!accessToken) return;
    if (!newName.trim()) {
      setError('请填写日记本名称。');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const created = await createDiaryNotebook(accessToken, {
        name: newName.trim(),
        coverColor: newColor,
        password: newPassword.trim() || undefined,
      });
      setCreateOpen(false);
      setNewName('');
      setNewPassword('');
      setMessage('日记本已创建。');
      await loadNotebooks();
      await enterNotebook(created.id);
    } catch (caught) {
      setError(getDiaryErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  if (authStatus === 'loading') {
    return <CenterState icon="notebook-edit-outline" loading title="正在打开日记本" />;
  }

  if (!accessToken || !user) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
        <View style={styles.loginState}>
          <View style={[styles.stateIcon, { backgroundColor: colors.primarySoft }]}>
            <MaterialCommunityIcons name="notebook-edit-outline" size={34} color={colors.primary} />
          </View>
          <ThemedText style={styles.stateTitle}>登录后使用日记本</ThemedText>
          <ThemedText style={[styles.stateText, { color: colors.mutedText }]}>
            你的日记会真实保存在 FunBox 账号里，可多本管理，也可独立设置密码。
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/auth', params: { returnTo: '/tools/diary' } })}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
            <MaterialCommunityIcons name="login" size={18} color="#ffffff" />
            <ThemedText style={styles.primaryButtonText}>登录</ThemedText>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (!activeId || !active) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
        <View style={[styles.screen, { maxWidth: appLayout.screenMaxWidth, alignSelf: 'center' }]}>
          <DiaryHeader
            onBack={() => router.back()}
            onRefresh={() => {
              setRefreshing(true);
              void loadNotebooks();
            }}
            refreshing={refreshing}
            title="日记本"
          />
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            refreshControl={
              <RefreshControl
                onRefresh={() => {
                  setRefreshing(true);
                  void loadNotebooks();
                }}
                refreshing={refreshing}
                tintColor={colors.primary}
              />
            }
            showsVerticalScrollIndicator={false}>
            {error ? <Notice text={error} tone="error" /> : null}
            {message ? <Notice text={message} tone="success" /> : null}
            {loading ? (
              <CenterState loading title="正在读取你的日记本" />
            ) : (
              <>
                <DiaryHero notebooks={notebooks} />
                <SectionHeader actionLabel="新建" onAction={() => setCreateOpen(true)} title="我的日记本" />
                {notebooks.length === 0 ? (
                  <EmptyRow
                    icon="notebook-plus-outline"
                    onAction={() => setCreateOpen(true)}
                    text="还没有日记本，创建第一个开始记录"
                  />
                ) : (
                  notebooks.map((notebook) => (
                    <NotebookCard
                      key={notebook.id}
                      notebook={notebook}
                      onPress={() => void enterNotebook(notebook.id)}
                    />
                  ))
                )}
              </>
            )}
          </ScrollView>
        </View>
        <DiaryModal
          onClose={() => setCreateOpen(false)}
          open={createOpen}
          title="新建日记本">
          <View style={styles.field}>
            <ThemedText style={styles.fieldLabel}>名称</ThemedText>
            <TextInput
              maxLength={30}
              onChangeText={setNewName}
              placeholder="例如：工作日志、旅行手记"
              placeholderTextColor={colors.mutedText}
              style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.line, color: colors.text }]}
              value={newName}
            />
          </View>
          <View style={styles.field}>
            <ThemedText style={styles.fieldLabel}>封面色</ThemedText>
            <View style={styles.colorRow}>
              {COVER_COLORS.map((color) => (
                <Pressable
                  accessibilityLabel={`封面色 ${color}`}
                  accessibilityRole="button"
                  key={color}
                  onPress={() => setNewColor(color)}
                  style={[
                    styles.colorSwatch,
                    { backgroundColor: color, borderColor: newColor === color ? colors.primary : 'transparent' },
                  ]}
                />
              ))}
            </View>
          </View>
          <View style={styles.field}>
            <ThemedText style={styles.fieldLabel}>日记本密码（可选）</ThemedText>
            <TextInput
              maxLength={32}
              onChangeText={setNewPassword}
              placeholder="6-32 位，设置后查看历史需解锁"
              placeholderTextColor={colors.mutedText}
              secureTextEntry
              style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.line, color: colors.text }]}
              value={newPassword}
            />
          </View>
          <PrimaryButton busy={busy} label="创建日记本" onPress={() => void createNotebook()} />
        </DiaryModal>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={[styles.screen, { maxWidth: appLayout.screenMaxWidth, alignSelf: 'center' }]}>
        <DiaryHeader
          onBack={() => setActiveId(null)}
          onLock={active.hasPassword ? () => void handleLock() : undefined}
          onRefresh={() => {
            setRefreshing(true);
            void loadDiaryData();
          }}
          refreshing={refreshing}
          title={active.name}
          locked={locked}
        />
        <View style={[styles.tabs, { backgroundColor: dark ? colors.surfaceMuted : '#e9eef8' }]}>
          <TabButton active={tab === 'today'} icon="notebook-edit-outline" label="今日" onPress={() => setTab('today')} />
          <TabButton active={tab === 'history'} icon="calendar-blank-multiple" label="历史" onPress={() => setTab('history')} />
          <TabButton active={tab === 'stats'} icon="chart-bar" label="统计" onPress={() => setTab('stats')} />
          <TabButton active={tab === 'settings'} icon="cog-outline" label="设置" onPress={() => setTab('settings')} />
        </View>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              onRefresh={() => {
                setRefreshing(true);
                void loadDiaryData();
              }}
              refreshing={refreshing}
              tintColor={colors.primary}
            />
          }
          showsVerticalScrollIndicator={false}>
          {error ? <Notice text={error} tone="error" /> : null}
          {message ? <Notice text={message} tone="success" /> : null}

          {tab === 'today' ? (
            <TodayView
              busy={busy}
              content={content}
              date={date}
              entry={entry}
              locked={locked}
              mood={mood}
              onChangeContent={setContent}
              onChangeDate={(next) => {
                setDate(next);
                void loadDiaryData();
              }}
              onChangeMood={setMood}
              onChangeTitle={setTitle}
              onChangeWeather={setWeather}
              onDelete={() => confirmDeleteEntry()}
              onDeleteMedia={(mediaId) => confirmDeleteMedia(mediaId)}
              onPickImages={() => void pickImages()}
              onSave={() => void saveCurrentEntry()}
              onUnlock={() => setUnlockOpen(true)}
              title={title}
              weather={weather}
            />
          ) : null}

          {tab === 'history' ? (
            <HistoryView
              calendar={calendar}
              busy={busy}
              entry={entry}
              locked={locked}
              month={month}
              onMonthChange={(next) => {
                setMonth(next);
                void loadDiaryData();
              }}
              onOpenDate={(next) => {
                setDate(next);
                void loadDiaryData();
              }}
              onQueryChange={setQuery}
              onSearch={() => void runSearch()}
              onUnlock={() => setUnlockOpen(true)}
              query={query}
              results={searchResults}
            />
          ) : null}

          {tab === 'stats' ? <StatsView stats={stats} /> : null}

          {tab === 'settings' ? (
            <SettingsView
              busy={busy}
              colors={colors}
              notebook={active}
              onDelete={() => confirmDeleteNotebook()}
              onExport={() => void runExport()}
              onSave={async (input) => {
                if (!accessToken) return;
                setBusy(true);
                setError('');
                try {
                  const updated = await updateDiaryNotebook(accessToken, active.id, input);
                  setNotebooks((items) => items.map((item) => (item.id === updated.id ? updated : item)));
                  setMessage('设置已保存。');
                } catch (caught) {
                  setError(getDiaryErrorMessage(caught));
                } finally {
                  setBusy(false);
                }
              }}
              onPassword={async (action, current, next) => {
                if (!accessToken) return;
                setBusy(true);
                setError('');
                try {
                  const updated = await updateDiaryPassword(accessToken, active.id, {
                    action,
                    current,
                    new: next,
                  });
                  setNotebooks((items) => items.map((item) => (item.id === updated.id ? updated : item)));
                  if (action === 'remove') {
                    setUnlocks((currentUnlocks) => {
                      const nextUnlocks = { ...currentUnlocks };
                      delete nextUnlocks[active.id];
                      return nextUnlocks;
                    });
                  }
                  setMessage('密码设置已更新。');
                } catch (caught) {
                  setError(getDiaryErrorMessage(caught));
                } finally {
                  setBusy(false);
                }
              }}
            />
          ) : null}
        </ScrollView>
      </View>

      <DiaryModal onClose={() => setUnlockOpen(false)} open={unlockOpen} title="解锁日记本">
        <View style={styles.unlockIconWrap}>
          <MaterialCommunityIcons name="book-lock-open-outline" size={30} color={colors.primary} />
        </View>
        <ThemedText style={[styles.unlockHint, { color: colors.mutedText }]}>
          输入 {active.name} 的密码后即可查看历史与正文，30 分钟内无需重复输入。
        </ThemedText>
        <TextInput
          autoFocus
          maxLength={32}
          onChangeText={setUnlockPassword}
          onSubmitEditing={() => void handleUnlock()}
          placeholder="请输入日记本密码"
          placeholderTextColor={colors.mutedText}
          secureTextEntry
          style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.line, color: colors.text }]}
          value={unlockPassword}
        />
        <PrimaryButton busy={busy} label="解锁" onPress={() => void handleUnlock()} />
      </DiaryModal>
    </SafeAreaView>
  );

  function confirmDeleteNotebook() {
    if (!accessToken || !activeId) return;
    if (active?.hasPassword && !unlockToken) {
      setUnlockOpen(true);
      return;
    }
    Alert.alert('删除日记本', '删除后所有日记将不再显示，确定继续吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void deleteDiaryNotebook(accessToken, activeId)
            .then(async () => {
              setActiveId(null);
              setMessage('日记本已删除。');
              await loadNotebooks();
            })
            .catch((caught) => setError(getDiaryErrorMessage(caught)));
        },
      },
    ]);
  }
}

function DiaryHeader({
  locked,
  onBack,
  onLock,
  onRefresh,
  refreshing,
  title,
}: {
  locked?: boolean;
  onBack: () => void;
  onLock?: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  title: string;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.header}>
      <Pressable
        accessibilityLabel="返回"
        accessibilityRole="button"
        hitSlop={10}
        onPress={onBack}
        style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
        <MaterialCommunityIcons name="chevron-left" size={29} color={colors.text} />
      </Pressable>
      <View style={styles.headerTitleWrap}>
        <ThemedText style={styles.headerTitle}>{title}</ThemedText>
        {locked ? (
          <ThemedText style={[styles.headerMeta, { color: colors.mutedText }]}>已加密 · 需密码</ThemedText>
        ) : null}
      </View>
      <View style={styles.headerActions}>
        {onLock ? (
          <Pressable
            accessibilityLabel="上锁"
            accessibilityRole="button"
            hitSlop={10}
            onPress={onLock}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
            <MaterialCommunityIcons name="lock" size={20} color={colors.primary} />
          </Pressable>
        ) : null}
        <Pressable
          accessibilityLabel="刷新"
          accessibilityRole="button"
          hitSlop={10}
          onPress={onRefresh}
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
          <MaterialCommunityIcons
            name={refreshing ? 'loading' : 'refresh'}
            size={22}
            color={colors.primary}
          />
        </Pressable>
      </View>
    </View>
  );
}

function DiaryHero({ notebooks }: { notebooks: DiaryNotebook[] }) {
  const totalEntries = notebooks.reduce((sum, notebook) => sum + notebook.entryCount, 0);
  const bestStreak = notebooks.reduce((best, notebook) => Math.max(best, notebook.currentStreak), 0);
  return (
    <View style={styles.heroCard}>
      <View style={styles.heroTop}>
        <View>
          <ThemedText style={styles.heroEyebrow}>真实记录</ThemedText>
          <ThemedText style={styles.heroTitle}>给每一天留一段话</ThemedText>
        </View>
        <View style={styles.heroBadge}>
          <MaterialCommunityIcons name="lock-outline" size={15} color="#151b3b" />
          <ThemedText style={styles.heroBadgeText}>可选密码</ThemedText>
        </View>
      </View>
      <View style={styles.heroStats}>
        <HeroStat label="日记本" value={`${notebooks.length}`} />
        <HeroStat label="总篇数" value={`${totalEntries}`} />
        <HeroStat label="最长连续" value={`${bestStreak} 天`} />
      </View>
    </View>
  );
}

function NotebookCard({ notebook, onPress }: { notebook: DiaryNotebook; onPress: () => void }) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.notebookCard,
        { backgroundColor: colors.surface, borderColor: colors.line },
        pressed && styles.pressed,
      ]}>
      <View style={[styles.notebookCover, { backgroundColor: notebook.coverColor }]}>
        <MaterialCommunityIcons name="notebook-edit-outline" size={21} color="#ffffff" />
      </View>
      <View style={styles.notebookCopy}>
        <View style={styles.notebookNameRow}>
          <ThemedText numberOfLines={1} style={styles.notebookName}>
            {notebook.name}
          </ThemedText>
          {notebook.hasPassword ? (
            <View style={styles.lockPill}>
              <MaterialCommunityIcons name="lock" size={11} color={colors.mutedText} />
              <ThemedText style={[styles.lockPillText, { color: colors.mutedText }]}>已加密</ThemedText>
            </View>
          ) : null}
        </View>
        <ThemedText style={[styles.notebookMeta, { color: colors.mutedText }]}>
          {notebook.entryCount} 篇 · 最近 {notebook.lastEntryDate || '暂无'} · 连续 {notebook.currentStreak} 天
        </ThemedText>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={18} color={colors.mutedText} />
    </Pressable>
  );
}

function TodayView({
  busy,
  content,
  date,
  entry,
  locked,
  mood,
  onChangeContent,
  onChangeDate,
  onChangeMood,
  onChangeTitle,
  onChangeWeather,
  onDelete,
  onDeleteMedia,
  onPickImages,
  onSave,
  onUnlock,
  title,
  weather,
}: {
  busy: boolean;
  content: string;
  date: string;
  entry: DiaryEntry | null;
  locked: boolean;
  mood: DiaryMood;
  onChangeContent: (value: string) => void;
  onChangeDate: (value: string) => void;
  onChangeMood: (value: DiaryMood) => void;
  onChangeTitle: (value: string) => void;
  onChangeWeather: (value: DiaryWeather) => void;
  onDelete: () => void;
  onDeleteMedia: (mediaId: string) => void;
  onPickImages: () => void;
  onSave: () => void;
  onUnlock: () => void;
  title: string;
  weather: DiaryWeather;
}) {
  const { colors } = useAppTheme();
  if (locked) {
    return <LockedState onUnlock={onUnlock} />;
  }
  return (
    <>
      <View style={styles.dateRow}>
        <View>
          <ThemedText style={styles.dateTitle}>{formatDateLabel(date)}</ThemedText>
          <ThemedText style={[styles.dateSub, { color: colors.mutedText }]}>{date}</ThemedText>
        </View>
        {entry ? (
          <Pressable
            accessibilityRole="button"
            onPress={onDelete}
            style={({ pressed }) => [styles.smallDangerButton, pressed && styles.pressed]}>
            <MaterialCommunityIcons name="delete-outline" size={16} color="#e33b4f" />
            <ThemedText style={styles.smallDangerText}>删除</ThemedText>
          </Pressable>
        ) : null}
      </View>
      <View style={[styles.editorCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <ThemedText style={styles.fieldLabel}>心情</ThemedText>
        <View style={styles.chipRow}>
          {MOODS.map((item) => (
            <Chip
              active={mood === item.value}
              icon={item.icon}
              key={item.value}
              label={item.label}
              onPress={() => onChangeMood(mood === item.value ? '' : item.value)}
            />
          ))}
        </View>
        <ThemedText style={styles.fieldLabel}>天气</ThemedText>
        <View style={styles.chipRow}>
          {WEATHERS.map((item) => (
            <Chip
              active={weather === item.value}
              icon={item.icon}
              key={item.value}
              label={item.label}
              onPress={() => onChangeWeather(weather === item.value ? '' : item.value)}
            />
          ))}
        </View>
        <TextInput
          maxLength={50}
          onChangeText={onChangeTitle}
          placeholder="标题（选填）"
          placeholderTextColor={colors.mutedText}
          style={[styles.titleInput, { backgroundColor: colors.surfaceMuted, color: colors.text }]}
          value={title}
        />
        <TextInput
          maxLength={10000}
          multiline
          onChangeText={onChangeContent}
          placeholder="今天发生了什么…"
          placeholderTextColor={colors.mutedText}
          style={[
            styles.bodyInput,
            { backgroundColor: colors.surfaceMuted, color: colors.text },
          ]}
          textAlignVertical="top"
          value={content}
        />
        {entry?.media.length ? (
          <View style={styles.mediaGrid}>
            {entry.media.map((media) => (
              <View key={media.id} style={styles.mediaCell}>
                <Image contentFit="cover" source={{ uri: media.url }} style={styles.mediaImage} />
                <Pressable
                  accessibilityLabel="移除图片"
                  accessibilityRole="button"
                  onPress={() => onDeleteMedia(media.id)}
                  style={styles.removeMedia}>
                  <MaterialCommunityIcons name="close" size={13} color="#ffffff" />
                </Pressable>
              </View>
            ))}
            {(entry?.media.length ?? 0) < 9 ? (
              <Pressable
                accessibilityRole="button"
                onPress={onPickImages}
                style={[styles.addMedia, { borderColor: colors.line }]}>
                <MaterialCommunityIcons name="image-plus" size={22} color={colors.primary} />
              </Pressable>
            ) : null}
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            onPress={onPickImages}
            style={[styles.addMediaSingle, { borderColor: colors.line }]}>
            <MaterialCommunityIcons name="image-plus" size={18} color={colors.primary} />
            <ThemedText style={[styles.addMediaText, { color: colors.mutedText }]}>添加图片（最多 9 张）</ThemedText>
          </Pressable>
        )}
      </View>
      <PrimaryButton busy={busy} label="保存今日" onPress={onSave} />
    </>
  );
}

function HistoryView({
  busy,
  calendar,
  entry,
  locked,
  month,
  onMonthChange,
  onOpenDate,
  onQueryChange,
  onSearch,
  onUnlock,
  query,
  results,
}: {
  busy: boolean;
  calendar: DiaryCalendar;
  entry: DiaryEntry | null;
  locked: boolean;
  month: string;
  onMonthChange: (month: string) => void;
  onOpenDate: (date: string) => void;
  onQueryChange: (value: string) => void;
  onSearch: () => void;
  onUnlock: () => void;
  query: string;
  results: DiaryEntry[];
}) {
  const { colors } = useAppTheme();
  return (
    <>
      {locked ? <LockedState onUnlock={onUnlock} /> : null}
      <View style={styles.calendarHeader}>
        <ThemedText style={styles.calendarTitle}>{month}</ThemedText>
        <View style={styles.calendarNav}>
          <Pressable
            accessibilityLabel="上个月"
            accessibilityRole="button"
            onPress={() => onMonthChange(shiftMonth(month, -1))}
            style={[styles.iconButton, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <MaterialCommunityIcons name="chevron-left" size={18} color={colors.text} />
          </Pressable>
          <Pressable
            accessibilityLabel="下个月"
            accessibilityRole="button"
            onPress={() => onMonthChange(shiftMonth(month, 1))}
            style={[styles.iconButton, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <MaterialCommunityIcons name="chevron-right" size={18} color={colors.text} />
          </Pressable>
        </View>
      </View>
      <CalendarGrid
        calendar={calendar}
        month={month}
        onSelectDate={onOpenDate}
        selectedDate={entry?.date ?? ''}
      />
      {entry ? (
        <View style={[styles.entryPreview, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <View style={styles.entryPreviewHead}>
            <ThemedText style={styles.entryPreviewTitle}>{formatDateLabel(entry.date)}</ThemedText>
            <ThemedText style={[styles.entryPreviewMood, { color: moodColor(entry.mood) }]}>
              {moodLabel(entry.mood)}
            </ThemedText>
          </View>
          {entry.title ? <ThemedText style={styles.entryPreviewTitle}>{entry.title}</ThemedText> : null}
          <ThemedText style={[styles.entryPreviewBody, { color: colors.mutedText }]}>
            {entry.content.slice(0, 160)}
          </ThemedText>
        </View>
      ) : null}
      {!locked ? (
        <View style={styles.searchRow}>
          <TextInput
            onChangeText={onQueryChange}
            onSubmitEditing={onSearch}
            placeholder="搜索已解锁日记"
            placeholderTextColor={colors.mutedText}
            style={[
              styles.searchInput,
              { backgroundColor: colors.surface, borderColor: colors.line, color: colors.text },
            ]}
            value={query}
          />
          <Pressable
            accessibilityLabel="搜索"
            accessibilityRole="button"
            disabled={busy}
            onPress={onSearch}
            style={[styles.searchButton, busy && styles.pressed]}>
            <MaterialCommunityIcons name="magnify" size={19} color="#ffffff" />
          </Pressable>
        </View>
      ) : null}
      {results.length > 0 ? (
        <View style={styles.searchResults}>
          {results.map((result) => (
            <Pressable
              accessibilityRole="button"
              key={result.id}
              onPress={() => onOpenDate(result.date)}
              style={[styles.resultRow, { backgroundColor: colors.surface, borderColor: colors.line }]}>
              <View style={styles.resultCopy}>
                <ThemedText style={styles.resultTitle}>{formatDateLabel(result.date)}</ThemedText>
                <ThemedText numberOfLines={1} style={[styles.resultBody, { color: colors.mutedText }]}>
                  {result.title || result.content}
                </ThemedText>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={17} color={colors.mutedText} />
            </Pressable>
          ))}
        </View>
      ) : null}
    </>
  );
}

function CalendarGrid({
  calendar,
  month,
  onSelectDate,
  selectedDate,
}: {
  calendar: DiaryCalendar;
  month: string;
  onSelectDate: (date: string) => void;
  selectedDate: string;
}) {
  const { colors } = useAppTheme();
  const byDate = useMemo(() => {
    const map: Record<string, DiaryMood> = {};
    for (const day of calendar.days) map[day.date] = day.mood;
    return map;
  }, [calendar]);
  const [year, monthNumber] = month.split('-').map(Number);
  const first = new Date(year, monthNumber - 1, 1);
  const daysInMonth = new Date(year, monthNumber, 0).getDate();
  const mondayOffset = (first.getDay() + 6) % 7;
  const cells: (string | null)[] = [
    ...Array.from({ length: mondayOffset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => {
      const day = `${index + 1}`.padStart(2, '0');
      return `${year}-${`${monthNumber}`.padStart(2, '0')}-${day}`;
    }),
  ];
  return (
    <View style={[styles.calendarCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <View style={styles.weekdayRow}>
        {['一', '二', '三', '四', '五', '六', '日'].map((label) => (
          <ThemedText key={label} style={[styles.weekday, { color: colors.mutedText }]}>
            {label}
          </ThemedText>
        ))}
      </View>
      <View style={styles.calendarGrid}>
        {cells.map((dateValue, index) => {
          if (!dateValue) return <View key={`blank-${index}`} style={styles.calendarCell} />;
          const dayMood = byDate[dateValue];
          const selected = dateValue === selectedDate;
          return (
            <Pressable
              accessibilityRole="button"
              key={dateValue}
              onPress={() => onSelectDate(dateValue)}
              style={[
                styles.calendarCell,
                selected && { backgroundColor: colors.primary, borderRadius: 10 },
              ]}>
              <ThemedText style={[styles.calendarDay, selected && { color: '#ffffff' }]}>
                {Number(dateValue.slice(-2))}
              </ThemedText>
              <View
                style={[
                  styles.calendarDot,
                  {
                    backgroundColor: dayMood ? moodColor(dayMood) : 'transparent',
                    borderColor: selected ? '#ffffff' : 'transparent',
                  },
                ]}
              />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function StatsView({ stats }: { stats: DiaryStats | null }) {
  const { colors } = useAppTheme();
  if (!stats) {
    return <CenterState loading title="正在计算记录统计" />;
  }
  const totalMoods = stats.moods.reduce((sum, item) => sum + item.count, 0);
  return (
    <>
      <View style={styles.statGrid}>
        <StatCard label="连续天数" value={`${stats.currentStreak}`} />
        <StatCard label="本月篇数" value={`${stats.monthCount}`} />
        <StatCard label="总篇数" value={`${stats.entryCount}`} />
      </View>
      <View style={[styles.chartCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <ThemedText style={styles.chartTitle}>心情分布</ThemedText>
        {stats.moods.length === 0 ? (
          <EmptyRow icon="chart-bar" text="还没有心情记录，写一篇日记后这里会出现真实分布" />
        ) : (
          stats.moods.map((item) => (
            <View key={item.mood} style={styles.distRow}>
              <ThemedText style={styles.distName}>{moodLabel(item.mood)}</ThemedText>
              <View style={[styles.distTrack, { backgroundColor: colors.surfaceMuted }]}>
                <View
                  style={[
                    styles.distFill,
                    {
                      backgroundColor: moodColor(item.mood),
                      width: `${totalMoods > 0 ? Math.round((item.count / totalMoods) * 100) : 0}%`,
                    },
                  ]}
                />
              </View>
              <ThemedText style={[styles.distValue, { color: colors.mutedText }]}>
                {item.count}
              </ThemedText>
            </View>
          ))
        )}
      </View>
      <View style={[styles.chartCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <ThemedText style={styles.chartTitle}>最近 7 天</ThemedText>
        <View style={styles.weekBars}>
          {stats.last7Days.map((day) => (
            <View key={day.date} style={styles.weekBarCol}>
              <View
                style={[
                  styles.weekBar,
                  {
                    backgroundColor: day.count > 0 ? colors.primary : colors.surfaceMuted,
                    height: `${Math.max(10, day.count * 34)}%`,
                  },
                ]}
              />
              <ThemedText style={[styles.weekLabel, { color: colors.mutedText }]}>
                {day.date.slice(-2)}
              </ThemedText>
            </View>
          ))}
        </View>
      </View>
    </>
  );
}

function SettingsView({
  busy,
  colors,
  notebook,
  onDelete,
  onExport,
  onPassword,
  onSave,
}: {
  busy: boolean;
  colors: ReturnType<typeof useAppTheme>['colors'];
  notebook: DiaryNotebook;
  onDelete: () => void;
  onExport: () => void;
  onPassword: (action: 'set' | 'change' | 'remove', current: string, next: string) => Promise<void>;
  onSave: (input: { name: string; coverColor: string; reminderEnabled: boolean; reminderTime: string }) => Promise<void>;
}) {
  const [name, setName] = useState(notebook.name);
  const [color, setColor] = useState(notebook.coverColor);
  const [reminderEnabled, setReminderEnabled] = useState(notebook.reminderEnabled);
  const [reminderTime, setReminderTime] = useState(notebook.reminderTime || '21:00');
  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [nextPasswordConfirm, setNextPasswordConfirm] = useState('');

  async function savePassword(action: 'set' | 'change' | 'remove') {
    if (action !== 'remove' && nextPassword !== nextPasswordConfirm) {
      Alert.alert('两次输入的密码不一致');
      return;
    }
    if (action !== 'remove' && nextPassword.length < 6) {
      Alert.alert('密码至少 6 位');
      return;
    }
    await onPassword(action, currentPassword, nextPassword);
    setCurrentPassword('');
    setNextPassword('');
    setNextPasswordConfirm('');
  }

  return (
    <>
      <View style={[styles.settingCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <ThemedText style={styles.settingTitle}>基本信息</ThemedText>
        <View style={styles.field}>
          <ThemedText style={styles.fieldLabel}>名称</ThemedText>
          <TextInput
            maxLength={30}
            onChangeText={setName}
            style={[styles.input, { backgroundColor: colors.surfaceMuted, color: colors.text }]}
            value={name}
          />
        </View>
        <View style={styles.field}>
          <ThemedText style={styles.fieldLabel}>封面色</ThemedText>
          <View style={styles.colorRow}>
            {COVER_COLORS.map((item) => (
              <Pressable
                accessibilityLabel={`封面色 ${item}`}
                accessibilityRole="button"
                key={item}
                onPress={() => setColor(item)}
                style={[
                  styles.colorSwatch,
                  { backgroundColor: item, borderColor: color === item ? colors.primary : 'transparent' },
                ]}
              />
            ))}
          </View>
        </View>
        <View style={styles.field}>
          <View style={styles.switchRow}>
            <View style={styles.switchCopy}>
              <ThemedText style={styles.fieldLabel}>每日提醒</ThemedText>
              <ThemedText style={[styles.switchHint, { color: colors.mutedText }]}>
                到点提醒写日记，不产生任何日记内容
              </ThemedText>
            </View>
            <Switch
              onValueChange={setReminderEnabled}
              thumbColor="#ffffff"
              trackColor={{ false: colors.surfaceMuted, true: colors.primary }}
              value={reminderEnabled}
            />
          </View>
          {reminderEnabled ? (
            <TextInput
              onChangeText={setReminderTime}
              placeholder="HH:mm"
              placeholderTextColor={colors.mutedText}
              style={[styles.input, { backgroundColor: colors.surfaceMuted, color: colors.text }]}
              value={reminderTime}
            />
          ) : null}
        </View>
        <PrimaryButton
          busy={busy}
          label="保存设置"
          onPress={() =>
            void onSave({ name: name.trim(), coverColor: color, reminderEnabled, reminderTime: reminderTime.trim() })
          }
        />
      </View>

      <View style={[styles.settingCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <ThemedText style={styles.settingTitle}>日记本密码</ThemedText>
        {notebook.hasPassword ? (
          <>
            <View style={styles.field}>
              <ThemedText style={styles.fieldLabel}>当前密码</ThemedText>
              <TextInput
                onChangeText={setCurrentPassword}
                placeholder="修改或移除密码需要"
                placeholderTextColor={colors.mutedText}
                secureTextEntry
                style={[styles.input, { backgroundColor: colors.surfaceMuted, color: colors.text }]}
                value={currentPassword}
              />
            </View>
            <View style={styles.field}>
              <ThemedText style={styles.fieldLabel}>新密码</ThemedText>
              <TextInput
                onChangeText={setNextPassword}
                placeholder="6-32 位"
                placeholderTextColor={colors.mutedText}
                secureTextEntry
                style={[styles.input, { backgroundColor: colors.surfaceMuted, color: colors.text }]}
                value={nextPassword}
              />
            </View>
            <View style={styles.field}>
              <ThemedText style={styles.fieldLabel}>确认新密码</ThemedText>
              <TextInput
                onChangeText={setNextPasswordConfirm}
                placeholder="再次输入新密码"
                placeholderTextColor={colors.mutedText}
                secureTextEntry
                style={[styles.input, { backgroundColor: colors.surfaceMuted, color: colors.text }]}
                value={nextPasswordConfirm}
              />
            </View>
            <RowAction icon="key-change" label="修改密码" onPress={() => void savePassword('change')} />
            <RowAction danger icon="lock-remove-outline" label="移除密码" onPress={() => void savePassword('remove')} />
          </>
        ) : (
          <>
            <View style={styles.field}>
              <ThemedText style={styles.fieldLabel}>新密码</ThemedText>
              <TextInput
                onChangeText={setNextPassword}
                placeholder="6-32 位"
                placeholderTextColor={colors.mutedText}
                secureTextEntry
                style={[styles.input, { backgroundColor: colors.surfaceMuted, color: colors.text }]}
                value={nextPassword}
              />
            </View>
            <View style={styles.field}>
              <ThemedText style={styles.fieldLabel}>确认新密码</ThemedText>
              <TextInput
                onChangeText={setNextPasswordConfirm}
                placeholder="再次输入新密码"
                placeholderTextColor={colors.mutedText}
                secureTextEntry
                style={[styles.input, { backgroundColor: colors.surfaceMuted, color: colors.text }]}
                value={nextPasswordConfirm}
              />
            </View>
            <RowAction icon="lock-plus-outline" label="设置密码" onPress={() => void savePassword('set')} />
          </>
        )}
        <ThemedText style={[styles.securityHint, { color: colors.mutedText }]}>
          密码只存哈希；忘记密码后旧内容无法找回，只能清空重建本子。
        </ThemedText>
      </View>

      <View style={[styles.settingCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <ThemedText style={styles.settingTitle}>数据</ThemedText>
        <RowAction icon="download-outline" label="导出为 Markdown" onPress={onExport} />
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={onDelete}
        style={({ pressed }) => [styles.deleteZone, pressed && styles.pressed]}>
        <MaterialCommunityIcons name="delete-outline" size={18} color="#e33b4f" />
        <ThemedText style={styles.deleteText}>删除日记本</ThemedText>
      </Pressable>
    </>
  );
}

function LockedState({ onUnlock }: { onUnlock: () => void }) {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.lockedCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <View style={[styles.lockedIcon, { backgroundColor: colors.primarySoft }]}>
        <MaterialCommunityIcons name="book-lock-open-outline" size={28} color={colors.primary} />
      </View>
      <ThemedText style={styles.lockedTitle}>这个日记本已加密</ThemedText>
      <ThemedText style={[styles.lockedText, { color: colors.mutedText }]}>
        输入密码后才能查看正文与历史，统计不会暴露日记内容。
      </ThemedText>
      <PrimaryButton label="输入密码解锁" onPress={onUnlock} />
    </View>
  );
}

function SectionHeader({
  actionLabel,
  onAction,
  title,
}: {
  actionLabel?: string;
  onAction?: () => void;
  title: string;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.sectionHeader}>
      <ThemedText style={styles.sectionTitle}>{title}</ThemedText>
      {actionLabel && onAction ? (
        <Pressable accessibilityRole="button" onPress={onAction}>
          <ThemedText style={[styles.sectionAction, { color: colors.primary }]}>{actionLabel}</ThemedText>
        </Pressable>
      ) : null}
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
  icon: string;
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
        name={icon as never}
        size={16}
        color={active ? colors.primary : colors.mutedText}
      />
      <ThemedText style={[styles.tabText, { color: active ? colors.text : colors.mutedText }]}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

function Chip({
  active,
  icon,
  label,
  onPress,
}: {
  active: boolean;
  icon: string;
  label: string;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: active ? colors.primarySoft : colors.surfaceMuted,
          borderColor: active ? colors.primary : colors.line,
        },
      ]}>
      <MaterialCommunityIcons name={icon as never} size={14} color={active ? colors.primary : colors.mutedText} />
      <ThemedText style={[styles.chipText, { color: active ? colors.primary : colors.text }]}>{label}</ThemedText>
    </Pressable>
  );
}

function PrimaryButton({
  busy,
  label,
  onPress,
}: {
  busy?: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [styles.primaryButton, busy && styles.pressed, pressed && styles.pressed]}>
      {busy ? <ActivityIndicator color="#ffffff" size="small" /> : null}
      <ThemedText style={styles.primaryButtonText}>{label}</ThemedText>
    </Pressable>
  );
}

function RowAction({
  danger,
  icon,
  label,
  onPress,
}: {
  danger?: boolean;
  icon: string;
  label: string;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.rowAction, { borderColor: colors.line }]}>
      <MaterialCommunityIcons
        name={icon as never}
        size={17}
        color={danger ? '#e33b4f' : colors.primary}
      />
      <ThemedText style={[styles.rowActionText, danger && { color: '#e33b4f' }]}>{label}</ThemedText>
    </Pressable>
  );
}

function EmptyRow({
  icon,
  onAction,
  text,
}: {
  icon: string;
  onAction?: () => void;
  text: string;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={!onAction}
      onPress={onAction}
      style={[styles.emptyRow, { borderColor: colors.line }]}>
      <MaterialCommunityIcons name={icon as never} size={20} color={colors.mutedText} />
      <ThemedText style={[styles.emptyText, { color: colors.mutedText }]}>{text}</ThemedText>
    </Pressable>
  );
}

function Notice({ text, tone }: { text: string; tone: 'error' | 'success' }) {
  const backgroundColor = tone === 'error' ? '#fff1f4' : '#e8f8f0';
  const color = tone === 'error' ? '#c03448' : '#168b62';
  return (
    <View style={[styles.notice, { backgroundColor, borderColor: tone === 'error' ? '#f6c9d3' : '#bfe8d3' }]}>
      <MaterialCommunityIcons
        name={tone === 'error' ? 'alert-circle-outline' : 'check-circle-outline'}
        size={16}
        color={color}
      />
      <ThemedText style={[styles.noticeText, { color }]}>{text}</ThemedText>
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

function StatCard({ label, value }: { label: string; value: string }) {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.statCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <ThemedText style={styles.statValue}>{value}</ThemedText>
      <ThemedText style={[styles.statLabel, { color: colors.mutedText }]}>{label}</ThemedText>
    </View>
  );
}

function CenterState({ icon, loading, title }: { icon?: string; loading?: boolean; title: string }) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.centerState}>
      {loading ? (
        <ActivityIndicator color={colors.primary} size="large" />
      ) : icon ? (
        <View style={[styles.stateIcon, { backgroundColor: colors.primarySoft }]}>
          <MaterialCommunityIcons name={icon as never} size={30} color={colors.primary} />
        </View>
      ) : null}
      <ThemedText style={styles.stateTitle}>{title}</ThemedText>
    </View>
  );
}

function DiaryModal({
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
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={open}>
      <View style={styles.sheetRoot}>
        <Pressable accessibilityLabel="关闭" onPress={onClose} style={styles.sheetBackdrop} />
        <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <ThemedText style={styles.sheetTitle}>{title}</ThemedText>
            <Pressable accessibilityLabel="关闭" accessibilityRole="button" onPress={onClose} style={styles.sheetClose}>
              <MaterialCommunityIcons name="close" size={20} color={colors.text} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  screen: { flex: 1, width: '100%' },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 8,
  },
  headerTitleWrap: { alignItems: 'center' },
  headerTitle: { fontSize: 19, fontWeight: '900' },
  headerMeta: { fontSize: 9, marginTop: 2 },
  headerActions: { flexDirection: 'row', gap: 8 },
  iconButton: {
    alignItems: 'center',
    borderColor: '#dde6fb',
    borderRadius: 12,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  pressed: { opacity: 0.72 },
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
  tabText: { fontSize: 11, fontWeight: '800' },
  scrollContent: { gap: 10, paddingBottom: 30, paddingHorizontal: 14, paddingTop: 12 },
  heroCard: { backgroundColor: '#151b3b', borderRadius: 16, padding: 15 },
  heroTop: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  heroEyebrow: { color: '#aab6d6', fontSize: 10, fontWeight: '700' },
  heroTitle: { color: '#ffffff', fontSize: 20, fontWeight: '900', marginTop: 3 },
  heroBadge: {
    alignItems: 'center',
    backgroundColor: '#c9f36a',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  heroBadgeText: { color: '#151b3b', fontSize: 10, fontWeight: '900' },
  heroStats: { flexDirection: 'row', gap: 10, marginTop: 13 },
  heroStat: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    padding: 9,
  },
  heroStatValue: { color: '#ffffff', fontSize: 16, fontWeight: '900' },
  heroStatLabel: { color: '#aab6d6', fontSize: 9, marginTop: 2 },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
    paddingHorizontal: 2,
    paddingVertical: 6,
  },
  sectionTitle: { fontSize: 14, fontWeight: '900' },
  sectionAction: { fontSize: 11, fontWeight: '800' },
  notebookCard: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 11,
    minHeight: 68,
    padding: 11,
  },
  notebookCover: {
    alignItems: 'center',
    borderRadius: 12,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  notebookCopy: { flex: 1, minWidth: 0 },
  notebookNameRow: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  notebookName: { fontSize: 13.5, fontWeight: '800' },
  lockPill: {
    alignItems: 'center',
    backgroundColor: 'rgba(116,131,162,0.12)',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  lockPillText: { fontSize: 9, fontWeight: '800' },
  notebookMeta: { fontSize: 9.5, marginTop: 4 },
  dateRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  dateTitle: { fontSize: 17, fontWeight: '900' },
  dateSub: { fontSize: 10, marginTop: 2 },
  smallDangerButton: { alignItems: 'center', flexDirection: 'row', gap: 4 },
  smallDangerText: { color: '#e33b4f', fontSize: 10, fontWeight: '800' },
  editorCard: { borderRadius: 14, borderWidth: 1, padding: 13 },
  field: { gap: 6 },
  fieldLabel: { fontSize: 10, fontWeight: '800', marginTop: 8 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 7 },
  chip: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 5,
    minHeight: 30,
    paddingHorizontal: 11,
  },
  chipText: { fontSize: 10, fontWeight: '800' },
  titleInput: { borderRadius: 11, fontSize: 14, fontWeight: '800', marginTop: 12, minHeight: 44, paddingHorizontal: 11 },
  bodyInput: { borderRadius: 11, fontSize: 13, lineHeight: 20, marginTop: 9, minHeight: 140, padding: 11 },
  mediaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  mediaCell: { borderRadius: 10, height: 78, overflow: 'hidden', position: 'relative', width: 78 },
  mediaImage: { height: '100%', width: '100%' },
  removeMedia: {
    alignItems: 'center',
    backgroundColor: 'rgba(20,20,30,0.62)',
    borderRadius: 999,
    height: 22,
    justifyContent: 'center',
    position: 'absolute',
    right: 4,
    top: 4,
    width: 22,
  },
  addMedia: {
    alignItems: 'center',
    borderColor: '#dde6fb',
    borderRadius: 10,
    borderWidth: 1,
    height: 78,
    justifyContent: 'center',
    width: 78,
  },
  addMediaSingle: {
    alignItems: 'center',
    borderRadius: 11,
    borderStyle: 'dashed',
    borderWidth: 1,
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    marginTop: 12,
    minHeight: 44,
  },
  addMediaText: { fontSize: 10, fontWeight: '700' },
  primaryButton: {
    alignItems: 'center',
    alignSelf: 'stretch',
    backgroundColor: '#4b6bff',
    borderRadius: 13,
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    minHeight: 46,
    marginTop: 12,
    paddingHorizontal: 14,
  },
  primaryButtonText: { color: '#ffffff', fontSize: 13, fontWeight: '900' },
  calendarHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  calendarTitle: { fontSize: 16, fontWeight: '900' },
  calendarNav: { flexDirection: 'row', gap: 7 },
  calendarCard: { borderRadius: 14, borderWidth: 1, padding: 11 },
  weekdayRow: { flexDirection: 'row', marginBottom: 4 },
  weekday: { fontSize: 9, fontWeight: '800', textAlign: 'center', width: '14.28%' },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calendarCell: { alignItems: 'center', height: 40, justifyContent: 'center', width: '14.28%' },
  calendarDay: { fontSize: 11, fontWeight: '700' },
  calendarDot: {
    borderRadius: 999,
    borderWidth: 1,
    height: 5,
    marginTop: 2,
    width: 5,
  },
  entryPreview: { borderRadius: 14, borderWidth: 1, padding: 13 },
  entryPreviewHead: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  entryPreviewTitle: { fontSize: 13, fontWeight: '800' },
  entryPreviewMood: { fontSize: 10, fontWeight: '800' },
  entryPreviewBody: { fontSize: 11, lineHeight: 18, marginTop: 8 },
  searchRow: { flexDirection: 'row', gap: 8 },
  searchInput: { borderRadius: 11, borderWidth: 1, flex: 1, fontSize: 12, minHeight: 42, paddingHorizontal: 11 },
  searchButton: {
    alignItems: 'center',
    backgroundColor: '#4b6bff',
    borderRadius: 11,
    justifyContent: 'center',
    width: 42,
  },
  searchResults: { gap: 8 },
  resultRow: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 9,
    padding: 11,
  },
  resultCopy: { flex: 1, minWidth: 0 },
  resultTitle: { fontSize: 12, fontWeight: '800' },
  resultBody: { fontSize: 10, marginTop: 3 },
  statGrid: { flexDirection: 'row', gap: 8 },
  statCard: { borderRadius: 13, borderWidth: 1, flex: 1, padding: 11 },
  statValue: { fontSize: 19, fontWeight: '900' },
  statLabel: { fontSize: 9, fontWeight: '700', marginTop: 3 },
  chartCard: { borderRadius: 14, borderWidth: 1, gap: 10, padding: 13 },
  chartTitle: { fontSize: 13, fontWeight: '900' },
  distRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  distName: { fontSize: 10, fontWeight: '800', width: 52 },
  distTrack: { borderRadius: 999, flex: 1, height: 7, overflow: 'hidden' },
  distFill: { borderRadius: 999, height: '100%' },
  distValue: { fontSize: 9, fontWeight: '800', textAlign: 'right', width: 30 },
  weekBars: { alignItems: 'flex-end', flexDirection: 'row', gap: 7, height: 96 },
  weekBarCol: { alignItems: 'center', flex: 1, gap: 5, height: '100%', justifyContent: 'flex-end' },
  weekBar: { borderRadius: 5, minHeight: 8, width: '100%' },
  weekLabel: { fontSize: 8, fontWeight: '700' },
  settingCard: { borderRadius: 14, borderWidth: 1, gap: 6, padding: 13 },
  settingTitle: { fontSize: 13, fontWeight: '900' },
  switchRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  switchCopy: { flex: 1, paddingRight: 10 },
  switchHint: { fontSize: 9, lineHeight: 14, marginTop: 3 },
  rowAction: {
    alignItems: 'center',
    borderRadius: 11,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
    minHeight: 42,
    paddingHorizontal: 11,
  },
  rowActionText: { fontSize: 11, fontWeight: '800' },
  securityHint: { fontSize: 9, lineHeight: 15, marginTop: 6 },
  deleteZone: {
    alignItems: 'center',
    borderColor: '#f6c9d3',
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 46,
  },
  deleteText: { color: '#e33b4f', fontSize: 12, fontWeight: '900' },
  lockedCard: { alignItems: 'center', borderRadius: 16, borderWidth: 1, gap: 10, padding: 20 },
  lockedIcon: { alignItems: 'center', borderRadius: 16, height: 54, justifyContent: 'center', width: 54 },
  lockedTitle: { fontSize: 16, fontWeight: '900' },
  lockedText: { fontSize: 11, lineHeight: 17, textAlign: 'center' },
  emptyRow: {
    alignItems: 'center',
    borderRadius: 12,
    borderStyle: 'dashed',
    borderWidth: 1,
    flexDirection: 'row',
    gap: 9,
    padding: 13,
  },
  emptyText: { flex: 1, fontSize: 10, lineHeight: 15 },
  notice: { alignItems: 'center', borderRadius: 11, borderWidth: 1, flexDirection: 'row', gap: 8, padding: 10 },
  noticeText: { flex: 1, fontSize: 10, fontWeight: '700' },
  loginState: { alignItems: 'center', flex: 1, justifyContent: 'center', paddingHorizontal: 30 },
  centerState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40 },
  stateIcon: { alignItems: 'center', borderRadius: 18, height: 62, justifyContent: 'center', width: 62 },
  stateTitle: { fontSize: 16, fontWeight: '900', marginTop: 12, textAlign: 'center' },
  stateText: { fontSize: 12, lineHeight: 19, marginTop: 7, textAlign: 'center' },
  input: { borderRadius: 11, borderWidth: 1, fontSize: 13, minHeight: 42, paddingHorizontal: 11, paddingVertical: 8 },
  colorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 8 },
  colorSwatch: { borderRadius: 999, borderWidth: 3, height: 26, width: 26 },
  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  sheetBackdrop: { backgroundColor: 'rgba(10,14,28,0.45)', bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
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
  sheetHandle: { alignSelf: 'center', backgroundColor: '#c6cede', borderRadius: 999, height: 4, marginTop: 8, width: 42 },
  sheetHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  sheetTitle: { fontSize: 17, fontWeight: '900' },
  sheetClose: { padding: 6 },
  sheetContent: { gap: 10, paddingHorizontal: 16 },
  unlockIconWrap: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: '#e7ecff',
    borderRadius: 18,
    height: 58,
    justifyContent: 'center',
    width: 58,
  },
  unlockHint: { fontSize: 10, lineHeight: 16, textAlign: 'center' },
});
