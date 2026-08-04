import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
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
  completeDaysLeftRecord,
  createDaysLeftCategory,
  createDaysLeftRecord,
  deleteDaysLeftCategory,
  deleteDaysLeftRecord,
  dismissDaysLeftReminder,
  fetchDaysLeftCalendar,
  fetchDaysLeftCategories,
  fetchDaysLeftEvents,
  fetchDaysLeftEvidence,
  fetchDaysLeftRecord,
  fetchDaysLeftRecords,
  fetchDaysLeftReminders,
  fetchDaysLeftStats,
  fetchDaysLeftSummary,
  getDaysLeftErrorMessage,
  getDaysLeftExportUrl,
  importDaysLeftRecords,
  renewDaysLeftRecord,
  undoDaysLeftRecord,
  updateDaysLeftCategory,
  updateDaysLeftRecord,
  uploadDaysLeftEvidence,
  verifyDaysLeftSSL,
} from '@/lib/days-left-api';
import {
  buildCalendarDays,
  currentMonthKey,
  cycleUnitLabel,
  formatDateCN,
  formatShortDate,
  iconForCategory,
  iconForRecordType,
  recordTypeLabel,
  riskColor,
  riskLabel,
  sourceLabel,
  todayDateString,
} from '@/lib/days-left';
import type {
  DaysLeftCategory,
  DaysLeftRecord,
  DaysLeftRecordInput,
  DaysLeftRecordType,
  DaysLeftSummary,
} from '@/types/days-left';

type DaysLeftTab = 'home' | 'records' | 'categories' | 'reminders';
type StatusFilter = 'all' | 'active' | 'completed';
type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

const RECORD_TYPES: DaysLeftRecordType[] = ['fixed', 'opened', 'recurring', 'event'];
const LEAD_OPTIONS = [3, 7, 14, 30, 60, 90];

function mciName(name: string): IconName {
  return name as IconName;
}

export function DaysLeftScreen() {
  const router = useRouter();
  const { accessToken, status: authStatus, user } = useAuth();
  const { colors, colorScheme } = useAppTheme();
  const dark = colorScheme === 'dark';
  const [activeTab, setActiveTab] = useState<DaysLeftTab>('home');
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof fetchDaysLeftSummary>> | null>(null);
  const [records, setRecords] = useState<DaysLeftRecord[]>([]);
  const [categories, setCategories] = useState<DaysLeftCategory[]>([]);
  const [reminders, setReminders] = useState<Awaited<ReturnType<typeof fetchDaysLeftReminders>>>([]);
  const [stats, setStats] = useState<Awaited<ReturnType<typeof fetchDaysLeftStats>> | null>(null);
  const [calendar, setCalendar] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sort, setSort] = useState('days');
  const [recordModal, setRecordModal] = useState<{ open: boolean; record?: DaysLeftRecord }>({ open: false });
  const [detailModal, setDetailModal] = useState<{ open: boolean; recordId?: string }>({ open: false });
  const [detail, setDetail] = useState<DaysLeftRecord | null>(null);
  const [detailEvents, setDetailEvents] = useState<Awaited<ReturnType<typeof fetchDaysLeftEvents>>>([]);
  const [detailEvidence, setDetailEvidence] = useState<Awaited<ReturnType<typeof fetchDaysLeftEvidence>>>([]);
  const [categoryModal, setCategoryModal] = useState<{ open: boolean; category?: DaysLeftCategory }>({ open: false });
  const [renewModal, setRenewModal] = useState<{ open: boolean; record?: DaysLeftRecord }>({ open: false });
  const requestRef = useRef(0);
  const hasLoadedRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!accessToken) return;
    const requestID = ++requestRef.current;
    setLoading(!hasLoadedRef.current);
    setError(null);
    try {
      const [summaryData, categoryData, statData, calendarData, reminderData] = await Promise.all([
        fetchDaysLeftSummary(accessToken, todayDateString()),
        fetchDaysLeftCategories(accessToken),
        fetchDaysLeftStats(accessToken, 'month'),
        fetchDaysLeftCalendar(accessToken, currentMonthKey()),
        fetchDaysLeftReminders(accessToken),
      ]);
      if (requestID !== requestRef.current) return;
      setSummary(summaryData);
      setCategories(categoryData);
      setStats(statData);
      setCalendar(new Map(calendarData.days.map((day) => [day.date, day.count])));
      setReminders(reminderData);
      setLoading(false);
      hasLoadedRef.current = true;
    } catch (nextError) {
      if (requestID !== requestRef.current) return;
      setError(getDaysLeftErrorMessage(nextError));
      setLoading(false);
    } finally {
      if (requestID === requestRef.current) setRefreshing(false);
    }
  }, [accessToken]);

  const loadRecords = useCallback(async () => {
    if (!accessToken) return;
    const requestID = ++requestRef.current;
    try {
      const items = await fetchDaysLeftRecords(accessToken, {
        category: categoryFilter === 'all' ? undefined : categoryFilter,
        status: statusFilter === 'all' ? undefined : statusFilter,
        q: search || undefined,
        sort,
      });
      if (requestID !== requestRef.current) return;
      setRecords(items);
    } catch (nextError) {
      if (requestID !== requestRef.current) return;
      setError(getDaysLeftErrorMessage(nextError));
    }
  }, [accessToken, categoryFilter, statusFilter, search, sort]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (accessToken && activeTab === 'records') void loadRecords();
  }, [accessToken, activeTab, loadRecords]);

  async function runMutation(action: () => Promise<unknown>, success?: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      if (success) setMessage(success);
      await refresh();
      if (activeTab === 'records') await loadRecords();
    } catch (nextError) {
      setError(getDaysLeftErrorMessage(nextError));
    } finally {
      setBusy(false);
    }
  }

  async function openDetail(recordId: string) {
    if (!accessToken) return;
    setDetailModal({ open: true, recordId });
    setDetail(null);
    setDetailEvents([]);
    setDetailEvidence([]);
    try {
      const [record, events, evidence] = await Promise.all([
        fetchDaysLeftRecord(accessToken, recordId),
        fetchDaysLeftEvents(accessToken, recordId),
        fetchDaysLeftEvidence(accessToken, recordId),
      ]);
      setDetail(record);
      setDetailEvents(events);
      setDetailEvidence(evidence);
    } catch (nextError) {
      setError(getDaysLeftErrorMessage(nextError));
      setDetailModal({ open: false });
    }
  }

  if (authStatus === 'loading') {
    return <CenterState icon="calendar-clock-outline" title="正在打开还有几天" loading />;
  }

  if (!accessToken || !user) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
        <View style={styles.loginState}>
          <View style={[styles.stateIcon, { backgroundColor: colors.primarySoft }]}>
            <MaterialCommunityIcons name="calendar-clock-outline" size={34} color={colors.primary} />
          </View>
          <ThemedText style={styles.stateTitle}>登录后使用还有几天</ThemedText>
          <ThemedText style={[styles.stateText, { color: colors.mutedText }]}>
            你的到期记录会保存在 FunBox 账号里，首启为空，不预置任何数据。
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/auth', params: { returnTo: '/tools/days-left' } })}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
            <MaterialCommunityIcons name="login" size={18} color="#ffffff" />
            <ThemedText style={styles.primaryButtonText}>登录</ThemedText>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (loading || !summary) {
    return <CenterState icon="calendar-clock-outline" title="正在整理到期记录" loading />;
  }

  const hasAnyDue = summary.overdue + summary.dueToday + summary.next7 + summary.next30 + summary.next90 > 0;

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
            <ThemedText style={styles.headerTitle}>还有几天</ThemedText>
            <ThemedText style={[styles.headerMeta, { color: colors.mutedText }]}>
              {formatDateCN(summary.date)}
            </ThemedText>
          </View>
          <Pressable
            accessibilityLabel="添加到期记录"
            accessibilityRole="button"
            onPress={() => setRecordModal({ open: true })}
            style={({ pressed }) => [styles.primaryButton, styles.headerAdd, pressed && styles.pressed]}>
            <MaterialCommunityIcons name="plus" size={18} color="#ffffff" />
            <ThemedText style={styles.primaryButtonText}>添加</ThemedText>
          </Pressable>
        </View>

        <View style={[styles.tabs, { backgroundColor: colors.surfaceMuted, borderColor: colors.line }]}>
          {(
            [
              ['home', '首页', 'home-outline'],
              ['records', '记录', 'format-list-bulleted'],
              ['categories', '分类', 'folder-outline'],
              ['reminders', '提醒', 'bell-outline'],
            ] as const
          ).map(([key, label, icon]) => (
            <Pressable
              key={key}
              accessibilityRole="button"
              onPress={() => setActiveTab(key)}
              style={[styles.tabButton, activeTab === key && { backgroundColor: colors.surface }]}>
              <MaterialCommunityIcons
                name={icon}
                size={15}
                color={activeTab === key ? colors.primary : colors.mutedText}
              />
              <ThemedText
                style={[
                  styles.tabLabel,
                  { color: activeTab === key ? colors.primary : colors.mutedText },
                ]}>
                {label}
              </ThemedText>
            </Pressable>
          ))}
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void refresh(); }} />
          }>
          {error ? (
            <View style={[styles.notice, { backgroundColor: '#fff1f1', borderColor: '#ffd3d3' }]}>
              <MaterialCommunityIcons name="alert-circle-outline" size={16} color="#d84b5c" />
              <ThemedText style={[styles.noticeText, { color: '#a53a49' }]}>{error}</ThemedText>
            </View>
          ) : null}
          {message ? (
            <View style={[styles.notice, { backgroundColor: colors.primarySoft, borderColor: colors.line }]}>
              <MaterialCommunityIcons name="check-circle-outline" size={16} color={colors.primary} />
              <ThemedText style={[styles.noticeText, { color: colors.primary }]}>{message}</ThemedText>
            </View>
          ) : null}

          {activeTab === 'home' ? (
            <HomeTab
              summary={summary}
              hasAnyDue={hasAnyDue}
              categories={categories}
              onAdd={() => setRecordModal({ open: true })}
              onOpen={openDetail}
              colors={colors}
              dark={dark}
            />
          ) : null}

          {activeTab === 'records' ? (
            <RecordsTab
              records={records}
              search={search}
              setSearch={setSearch}
              categoryFilter={categoryFilter}
              setCategoryFilter={setCategoryFilter}
              statusFilter={statusFilter}
              setStatusFilter={setStatusFilter}
              sort={sort}
              setSort={setSort}
              categories={categories}
              onOpen={openDetail}
              onAdd={() => setRecordModal({ open: true })}
              colors={colors}
            />
          ) : null}

          {activeTab === 'categories' ? (
            <CategoriesTab
              categories={categories}
              onEdit={(category) => setCategoryModal({ open: true, category })}
              onAdd={() => setCategoryModal({ open: true })}
              colors={colors}
            />
          ) : null}

          {activeTab === 'reminders' ? (
            <RemindersTab
              reminders={reminders}
              stats={stats}
              calendar={calendar}
              accessToken={accessToken}
              onDismiss={(id) => runMutation(() => dismissDaysLeftReminder(accessToken, id), '提醒已关闭')}
              onChanged={async () => {
                await refresh();
              }}
              colors={colors}
            />
          ) : null}
        </ScrollView>
      </View>

      <RecordModal
        open={recordModal.open}
        record={recordModal.record}
        categories={categories}
        accessToken={accessToken}
        onClose={() => setRecordModal({ open: false })}
        onSaved={async () => {
          setRecordModal({ open: false });
          await refresh();
          if (activeTab === 'records') await loadRecords();
        }}
        colors={colors}
        dark={dark}
      />
      <DetailModal
        open={detailModal.open}
        record={detail}
        events={detailEvents}
        evidence={detailEvidence}
        accessToken={accessToken}
        busy={busy}
        onClose={() => setDetailModal({ open: false })}
        onRenew={(item) => setRenewModal({ open: true, record: item })}
        onComplete={(id) => runMutation(() => completeDaysLeftRecord(accessToken, id), '已完成本次')}
        onUndo={(id) => runMutation(() => undoDaysLeftRecord(accessToken, id), '已撤销最近动作')}
        onDelete={async (id) => {
          const ok = Platform.OS === 'web' ? window.confirm('确认删除这条记录？') : await confirmNative();
          if (!ok) return;
          await runMutation(() => deleteDaysLeftRecord(accessToken, id), '记录已删除');
          setDetailModal({ open: false });
        }}
        onEvidenceUploaded={async (id) => {
          await runMutation(async () => {
            await openDetail(id);
          });
        }}
        colors={colors}
      />
      <RenewModal
        open={renewModal.open}
        record={renewModal.record}
        accessToken={accessToken}
        onClose={() => setRenewModal({ open: false })}
        onSaved={async () => {
          setRenewModal({ open: false });
          await refresh();
          if (detailModal.open && detailModal.recordId) await openDetail(detailModal.recordId);
        }}
        colors={colors}
      />
      <CategoryModal
        open={categoryModal.open}
        category={categoryModal.category}
        accessToken={accessToken}
        onClose={() => setCategoryModal({ open: false })}
        onSaved={async () => {
          setCategoryModal({ open: false });
          await refresh();
        }}
        colors={colors}
      />
    </SafeAreaView>
  );
}

function HomeTab(props: {
  summary: DaysLeftSummary;
  hasAnyDue: boolean;
  categories: DaysLeftCategory[];
  onAdd: () => void;
  onOpen: (id: string) => void;
  colors: ReturnType<typeof useAppTheme>['colors'];
  dark: boolean;
}) {
  const { summary, hasAnyDue, categories, onAdd, onOpen, colors, dark } = props;
  const dueCount = summary.overdue + summary.dueToday + summary.next7 + summary.next30 + summary.next90;
  return (
    <>
      <View style={[styles.heroCard, dark ? styles.heroDark : styles.heroLight]}>
        <View style={styles.heroKicker}>
          <MaterialCommunityIcons name="shield-check-outline" size={14} color="#c9f36a" />
          <ThemedText style={styles.heroKickerText}>真实到期摘要</ThemedText>
        </View>
        <View style={styles.heroDays}>
          <ThemedText style={styles.heroDaysValue}>{hasAnyDue ? dueCount : 0}</ThemedText>
          <ThemedText style={styles.heroDaysUnit}>{hasAnyDue ? '项需要关注' : '项待添加'}</ThemedText>
        </View>
        <ThemedText style={styles.heroTitle}>
          {hasAnyDue ? '未来 90 天内有真实到期记录' : '还没有到期记录'}
        </ThemedText>
        <ThemedText style={styles.heroSubtitle}>
          {hasAnyDue
            ? `${summary.overdue} 项已逾期 · ${summary.next7} 项 7 天内`
            : '从你手边的真实证件、账单或包装开始。'}
        </ThemedText>
      </View>

      <View style={styles.statGrid}>
        <StatCard label="已逾期" value={summary.overdue} color="#ff5d6c" />
        <StatCard label="7 天内" value={summary.next7} color="#f1a33b" />
        <StatCard label="30 天内" value={summary.next30} color="#4b6bff" />
        <StatCard label="90 天内" value={summary.next90} color="#1db991" />
      </View>

      <SectionTitle title="今日到期" meta={`${summary.today.length} 条真实记录`} />
      {summary.today.length === 0 ? (
        <EmptyState
          icon="check-circle-outline"
          title="今天没有到期"
          subtitle="已逾期与今日到期均为 0"
        />
      ) : (
        summary.today.map((record) => (
          <RecordCard key={record.id} record={record} onPress={() => onOpen(record.id)} />
        ))
      )}

      <SectionTitle title="即将到期" meta={`${summary.soon.length} 条真实记录`} />
      {summary.soon.length === 0 ? (
        <EmptyState icon="calendar-blank-outline" title="暂无即将到期" subtitle="未来 90 天内没有记录" />
      ) : (
        summary.soon.map((record) => (
          <RecordCard key={record.id} record={record} onPress={() => onOpen(record.id)} />
        ))
      )}

      <SectionTitle title="分类模板" meta="产品结构 · 不包含数据" />
      <View style={styles.categoryGrid}>
        {categories.map((category) => (
          <View key={category.id} style={[styles.categoryChip, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <View style={[styles.categoryIcon, { backgroundColor: `${category.color}1f` }]}>
              <MaterialCommunityIcons name={mciName(iconForCategory(category.icon))} size={14} color={category.color} />
            </View>
            <View style={styles.categoryChipText}>
              <ThemedText style={styles.categoryName}>{category.name}</ThemedText>
              <ThemedText style={[styles.categoryMeta, { color: colors.mutedText }]}>
                {category.recordCount} 条真实记录
              </ThemedText>
            </View>
          </View>
        ))}
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={onAdd}
        style={({ pressed }) => [styles.addBar, { backgroundColor: colors.hero }, pressed && styles.pressed]}>
        <MaterialCommunityIcons name="plus" size={18} color="#c9f36a" />
        <ThemedText style={styles.addBarText}>添加到期记录</ThemedText>
      </Pressable>
    </>
  );
}

function RecordsTab(props: {
  records: DaysLeftRecord[];
  search: string;
  setSearch: (value: string) => void;
  categoryFilter: string;
  setCategoryFilter: (value: string) => void;
  statusFilter: StatusFilter;
  setStatusFilter: (value: StatusFilter) => void;
  sort: string;
  setSort: (value: string) => void;
  categories: DaysLeftCategory[];
  onOpen: (id: string) => void;
  onAdd: () => void;
  colors: ReturnType<typeof useAppTheme>['colors'];
}) {
  const { records, search, setSearch, categoryFilter, setCategoryFilter, statusFilter, setStatusFilter, sort, setSort, categories, onOpen, onAdd, colors } = props;
  return (
    <>
      <View style={[styles.searchShell, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <MaterialCommunityIcons name="magnify" size={17} color={colors.mutedText} />
        <TextInput
          style={[styles.searchInput, { color: colors.text }]}
          placeholder="搜索名称、备注或来源"
          placeholderTextColor="#9aa6bd"
          value={search}
          onChangeText={setSearch}
        />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillRow}>
        <FilterPill label="全部" active={categoryFilter === 'all'} onPress={() => setCategoryFilter('all')} />
        {categories.map((category) => (
          <FilterPill
            key={category.id}
            label={category.name}
            icon={mciName(iconForCategory(category.icon))}
            active={categoryFilter === category.id}
            onPress={() => setCategoryFilter(category.id)}
          />
        ))}
      </ScrollView>
      <View style={[styles.seg, { backgroundColor: colors.surfaceMuted }]}>
        {(
          [
            ['all', '全部'],
            ['active', '待处理'],
            ['completed', '已完成'],
          ] as const
        ).map(([key, label]) => (
          <Pressable
            key={key}
            onPress={() => setStatusFilter(key)}
            style={[styles.segButton, statusFilter === key && { backgroundColor: colors.surface }]}>
            <ThemedText style={[styles.segText, { color: statusFilter === key ? colors.text : colors.mutedText }]}>
              {label}
            </ThemedText>
          </Pressable>
        ))}
      </View>
      <View style={styles.sortRow}>
        <ThemedText style={[styles.sortMeta, { color: colors.mutedText }]}>共 {records.length} 条真实记录</ThemedText>
        <Pressable onPress={() => setSort(sort === 'days' ? 'risk' : 'days')} style={styles.sortButton}>
          <MaterialCommunityIcons name="sort" size={13} color={colors.primary} />
          <ThemedText style={[styles.sortLabel, { color: colors.primary }]}>
            {sort === 'risk' ? '按风险' : '按剩余天数'}
          </ThemedText>
        </Pressable>
      </View>
      {records.length === 0 ? (
        <EmptyState icon="calendar-remove-outline" title="没有符合条件的记录" subtitle="清空筛选或添加一条真实记录" />
      ) : (
        records.map((record) => <RecordCard key={record.id} record={record} onPress={() => onOpen(record.id)} />)
      )}
      <Pressable
        accessibilityRole="button"
        onPress={onAdd}
        style={({ pressed }) => [styles.addBar, { backgroundColor: colors.hero }, pressed && styles.pressed]}>
        <MaterialCommunityIcons name="plus" size={18} color="#c9f36a" />
        <ThemedText style={styles.addBarText}>添加到期记录</ThemedText>
      </Pressable>
    </>
  );
}

function CategoriesTab(props: {
  categories: DaysLeftCategory[];
  onEdit: (category: DaysLeftCategory) => void;
  onAdd: () => void;
  colors: ReturnType<typeof useAppTheme>['colors'];
}) {
  const { categories, onEdit, onAdd, colors } = props;
  return (
    <>
      <SectionTitle title="内置与自定义分类" meta={`${categories.length} 个分类`} />
      {categories.map((category) => (
        <Pressable
          key={category.id}
          onPress={() => onEdit(category)}
          style={[styles.listCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <View style={[styles.listIcon, { backgroundColor: `${category.color}1f` }]}>
            <MaterialCommunityIcons name={mciName(iconForCategory(category.icon))} size={17} color={category.color} />
          </View>
          <View style={styles.listMain}>
            <ThemedText style={styles.listTitle}>{category.name}</ThemedText>
            <ThemedText style={[styles.listSub, { color: colors.mutedText }]}>
              {recordTypeLabel(category.defaultRecordType)} · 提前 {category.reminderLeadDays} 天
            </ThemedText>
          </View>
          <ThemedText style={[styles.listCount, { color: colors.mutedText }]}>{category.recordCount}</ThemedText>
        </Pressable>
      ))}
      <Pressable
        accessibilityRole="button"
        onPress={onAdd}
        style={[styles.addCategory, { borderColor: colors.line }]}>
        <MaterialCommunityIcons name="plus" size={16} color={colors.primary} />
        <ThemedText style={[styles.addCategoryText, { color: colors.primary }]}>新建自定义分类</ThemedText>
      </Pressable>
    </>
  );
}

function RemindersTab(props: {
  reminders: Awaited<ReturnType<typeof fetchDaysLeftReminders>>;
  stats: Awaited<ReturnType<typeof fetchDaysLeftStats>> | null;
  calendar: Map<string, number>;
  accessToken: string;
  onDismiss: (id: string) => void;
  onChanged: () => Promise<void>;
  colors: ReturnType<typeof useAppTheme>['colors'];
}) {
  const { reminders, stats, calendar, accessToken, onDismiss, onChanged, colors } = props;
  const monthKey = currentMonthKey();
  const cells = buildCalendarDays(monthKey, calendar);

  async function downloadExport(format: 'csv' | 'json') {
    const response = await fetch(getDaysLeftExportUrl(format), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      Alert.alert('导出失败', '请稍后重试。');
      return;
    }
    const blob = await response.blob();
    if (Platform.OS === 'web') {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `days-left-export.${format}`;
      anchor.click();
      URL.revokeObjectURL(url);
    } else {
      Alert.alert('导出提示', '当前可在网页端下载 CSV/JSON 导出文件。');
    }
  }

  async function importJson() {
    const picked = await DocumentPicker.getDocumentAsync({
      type: 'application/json',
      copyToCacheDirectory: true,
    });
    if (picked.canceled || picked.assets.length === 0) return;
    try {
      const uri = picked.assets[0].uri;
      const text = await fetch(uri).then((response) => response.text());
      const records = JSON.parse(text);
      const count = await importDaysLeftRecords(accessToken, records);
      Alert.alert('导入完成', `已导入 ${count} 条真实记录。`);
      await onChanged();
    } catch {
      Alert.alert('导入失败', '请确认文件是有效的 JSON 到期记录。');
    }
  }

  return (
    <>
      <View style={[styles.statsHero, styles.heroLight]}>
        <View style={styles.heroKicker}>
          <MaterialCommunityIcons name="chart-donut" size={14} color="#c9f36a" />
          <ThemedText style={styles.heroKickerText}>真实统计</ThemedText>
        </View>
        <View style={styles.heroDays}>
          <ThemedText style={styles.heroDaysValue}>{stats?.next90 ?? 0}</ThemedText>
          <ThemedText style={styles.heroDaysUnit}>项未来 90 天到期</ThemedText>
        </View>
        <ThemedText style={styles.heroSubtitle}>
          已逾期 {stats?.overdue ?? 0} · 已处理 {stats?.completed ?? 0} · 处理率 {Math.round((stats?.rate ?? 0) * 100)}%
        </ThemedText>
      </View>
      <View style={styles.statGrid}>
        <StatCard label="30 天内" value={stats?.next30 ?? 0} color="#4b6bff" />
        <StatCard label="90 天内" value={stats?.next90 ?? 0} color="#1db991" />
        <StatCard label="已逾期" value={stats?.overdue ?? 0} color="#ff5d6c" />
        <StatCard label="已处理" value={stats?.completed ?? 0} color="#f1a33b" />
      </View>
      <SectionTitle title="待提醒" meta={`${reminders.length} 条真实记录`} />
      {reminders.length === 0 ? (
        <EmptyState icon="bell-outline" title="暂无待提醒" subtitle="有提前量的真实记录会自动出现" />
      ) : (
        reminders.map((reminder) => (
          <View key={reminder.id} style={[styles.reminderCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <View style={[styles.listIcon, { backgroundColor: colors.primarySoft }]}>
              <MaterialCommunityIcons name="bell-outline" size={17} color={colors.primary} />
            </View>
            <View style={styles.listMain}>
              <ThemedText style={styles.listTitle}>{reminder.recordName}</ThemedText>
              <ThemedText style={[styles.listSub, { color: colors.mutedText }]}>
                {formatShortDate(reminder.remindAt)} 提醒 · 剩余 {reminder.daysLeft} 天
              </ThemedText>
            </View>
            <Pressable onPress={() => onDismiss(reminder.id)} style={styles.dismissButton}>
              <ThemedText style={[styles.dismissText, { color: colors.primary }]}>关闭</ThemedText>
            </Pressable>
          </View>
        ))
      )}
      <SectionTitle title={`${monthKey} 日历`} meta="真实到期日" />
      <View style={[styles.calendarCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <View style={styles.calendarHead}>
          {['一', '二', '三', '四', '五', '六', '日'].map((day) => (
            <ThemedText key={day} style={[styles.calendarHeadText, { color: colors.mutedText }]}>{day}</ThemedText>
          ))}
        </View>
        <View style={styles.calendarGrid}>
          {cells.map((cell, index) => (
            <View
              key={`${cell.date}-${index}`}
              style={[
                styles.calendarCell,
                cell.today && { backgroundColor: colors.primary },
                cell.count > 0 && { backgroundColor: '#e4f7ee' },
              ]}>
              {cell.day > 0 ? (
                <>
                  <ThemedText
                    style={[
                      styles.calendarDay,
                      cell.today && { color: '#ffffff' },
                      cell.count > 0 && { color: '#1db991' },
                    ]}>
                    {cell.day}
                  </ThemedText>
                  {cell.count > 0 ? <View style={styles.calendarDot} /> : null}
                </>
              ) : null}
            </View>
          ))}
        </View>
      </View>
      <SectionTitle title="导入导出" meta="只导出当前账号真实数据" />
      <View style={styles.exportRow}>
        <Pressable
          accessibilityRole="button"
          onPress={() => void downloadExport('csv')}
          style={[styles.exportButton, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <MaterialCommunityIcons name="file-delimited-outline" size={16} color={colors.primary} />
          <ThemedText style={[styles.exportText, { color: colors.text }]}>导出 CSV</ThemedText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => void downloadExport('json')}
          style={[styles.exportButton, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <MaterialCommunityIcons name="code-json" size={16} color={colors.primary} />
          <ThemedText style={[styles.exportText, { color: colors.text }]}>导出 JSON</ThemedText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => void importJson()}
          style={[styles.exportButton, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <MaterialCommunityIcons name="file-import-outline" size={16} color={colors.primary} />
          <ThemedText style={[styles.exportText, { color: colors.text }]}>导入 JSON</ThemedText>
        </Pressable>
      </View>
    </>
  );
}

function RecordModal(props: {
  open: boolean;
  record?: DaysLeftRecord;
  categories: DaysLeftCategory[];
  accessToken: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
  colors: ReturnType<typeof useAppTheme>['colors'];
  dark: boolean;
}) {
  const { open, record, categories, accessToken, onClose, onSaved, colors, dark } = props;
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [recordType, setRecordType] = useState<DaysLeftRecordType>('fixed');
  const [expiryDate, setExpiryDate] = useState('');
  const [startDate, setStartDate] = useState('');
  const [validityValue, setValidityValue] = useState('');
  const [validityUnit, setValidityUnit] = useState('day');
  const [cycleUnit, setCycleUnit] = useState('year');
  const [cycleInterval, setCycleInterval] = useState('1');
  const [reminderLeadDays, setReminderLeadDays] = useState(30);
  const [note, setNote] = useState('');
  const [source, setSource] = useState<DaysLeftRecordInput['source']>('user');
  const [verifyHost, setVerifyHost] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pickedEvidence, setPickedEvidence] = useState<{ uri: string; name?: string; type?: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(record?.name ?? '');
    setCategoryId(record?.categoryId ?? categories[0]?.id ?? '');
    setRecordType(record?.recordType ?? categories[0]?.defaultRecordType ?? 'fixed');
    setExpiryDate(record?.expiryDate ?? '');
    setStartDate(record?.startDate ?? '');
    setValidityValue(record ? String(record.validityValue) : '');
    setValidityUnit(record?.validityUnit ?? 'day');
    setCycleUnit(record?.cycleUnit ?? 'year');
    setCycleInterval(record ? String(record.cycleInterval) : '1');
    setReminderLeadDays(record?.reminderLeadDays ?? 30);
    setNote(record?.note ?? '');
    setSource(record?.source ?? 'user');
    setVerifyHost('');
    setSubmitError(null);
    setPickedEvidence(null);
  }, [open, record, categories]);

  async function pickEvidence() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.9,
      allowsEditing: false,
    });
    if (picked.canceled || picked.assets.length === 0) return;
    const asset = picked.assets[0];
    setPickedEvidence({
      uri: asset.uri,
      name: asset.fileName ?? 'evidence.jpg',
      type: asset.mimeType ?? 'image/jpeg',
    });
  }

  async function verifySSL() {
    if (!verifyHost.trim()) return;
    setVerifying(true);
    setSubmitError(null);
    try {
      const result = await verifyDaysLeftSSL(accessToken, verifyHost.trim());
      setExpiryDate(result.expiresAt.slice(0, 10));
      setSource('api');
      setRecordType('recurring');
      setNote((current) => `${current}${current ? '\n' : ''}${result.issuer} · 真实校验 ${result.checkedAt.slice(0, 10)}`);
    } catch (nextError) {
      setSubmitError(getDaysLeftErrorMessage(nextError));
    } finally {
      setVerifying(false);
    }
  }

  async function save() {
    setSubmitError(null);
    if (!name.trim() || !categoryId) {
      setSubmitError('请填写名称并选择分类。');
      return;
    }
    const input: DaysLeftRecordInput = {
      name: name.trim(),
      categoryId,
      recordType,
      reminderLeadDays,
      note: note.trim(),
      source,
      verified: source === 'api',
      verifiedAt: source === 'api' ? new Date().toISOString() : undefined,
    };
    if (recordType === 'opened') {
      if (!startDate || !validityValue) {
        setSubmitError('开封有效期需要填写开封日期和有效期。');
        return;
      }
      input.startDate = startDate;
      input.validityValue = Number(validityValue);
      input.validityUnit = validityUnit as DaysLeftRecordInput['validityUnit'];
    } else {
      if (!expiryDate) {
        setSubmitError('请填写到期日期。');
        return;
      }
      input.expiryDate = expiryDate;
      if (recordType === 'recurring') {
        input.cycleUnit = cycleUnit as DaysLeftRecordInput['cycleUnit'];
        input.cycleInterval = Number(cycleInterval) || 1;
      }
    }
    try {
      let saved = record?.id
        ? await updateDaysLeftRecord(accessToken, record.id, input)
        : await createDaysLeftRecord(accessToken, input);
      if (pickedEvidence) {
        await uploadDaysLeftEvidence(accessToken, saved.id, pickedEvidence);
      }
      await onSaved();
    } catch (nextError) {
      setSubmitError(getDaysLeftErrorMessage(nextError));
    }
  }

  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalRoot}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} />
        <View style={[styles.modalSheet, { backgroundColor: colors.background }]}>
          <ModalHeader title={record ? '编辑到期记录' : '新增到期记录'} onClose={onClose} />
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.modalContent}>
            <FormLabel label="名称" />
            <TextInput
              style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.line, color: colors.text }]}
              placeholder="例如：身份证、房租、药品"
              placeholderTextColor="#9aa6bd"
              value={name}
              onChangeText={setName}
            />
            <FormLabel label="分类" />
            <View style={styles.pillRow}>
              {categories.map((category) => (
                <FilterPill
                  key={category.id}
                  label={category.name}
                  icon={mciName(iconForCategory(category.icon))}
                  active={categoryId === category.id}
                  onPress={() => {
                    setCategoryId(category.id);
                    setRecordType(category.defaultRecordType);
                  }}
                />
              ))}
            </View>
            <FormLabel label="到期类型" />
            <View style={[styles.seg, { backgroundColor: colors.surfaceMuted }]}>
              {RECORD_TYPES.map((type) => (
                <Pressable
                  key={type}
                  onPress={() => setRecordType(type)}
                  style={[styles.segButton, recordType === type && { backgroundColor: colors.surface }]}>
                  <ThemedText style={[styles.segText, { color: recordType === type ? colors.text : colors.mutedText }]}>
                    {recordTypeLabel(type)}
                  </ThemedText>
                </Pressable>
              ))}
            </View>
            {recordType === 'opened' ? (
              <>
                <FormLabel label="开封日期" />
                <TextInput
                  style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.line, color: colors.text }]}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="#9aa6bd"
                  value={startDate}
                  onChangeText={setStartDate}
                />
                <FormLabel label="有效期" />
                <View style={styles.inlineRow}>
                  <TextInput
                    style={[styles.input, styles.flexInput, { backgroundColor: colors.surface, borderColor: colors.line, color: colors.text }]}
                    keyboardType="number-pad"
                    placeholder="30"
                    placeholderTextColor="#9aa6bd"
                    value={validityValue}
                    onChangeText={setValidityValue}
                  />
                  <View style={[styles.seg, styles.unitSeg, { backgroundColor: colors.surfaceMuted }]}>
                    {(['day', 'month', 'year'] as const).map((unit) => (
                      <Pressable
                        key={unit}
                        onPress={() => setValidityUnit(unit)}
                        style={[styles.segButton, validityUnit === unit && { backgroundColor: colors.surface }]}>
                        <ThemedText style={[styles.segText, { color: validityUnit === unit ? colors.text : colors.mutedText }]}>
                          {cycleUnitLabel(unit)}
                        </ThemedText>
                      </Pressable>
                    ))}
                  </View>
                </View>
              </>
            ) : (
              <>
                <FormLabel label="到期日期" />
                <TextInput
                  style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.line, color: colors.text }]}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="#9aa6bd"
                  value={expiryDate}
                  onChangeText={setExpiryDate}
                />
              </>
            )}
            {recordType === 'recurring' ? (
              <>
                <FormLabel label="续费周期" />
                <View style={styles.inlineRow}>
                  <TextInput
                    style={[styles.input, styles.flexInput, { backgroundColor: colors.surface, borderColor: colors.line, color: colors.text }]}
                    keyboardType="number-pad"
                    placeholder="1"
                    placeholderTextColor="#9aa6bd"
                    value={cycleInterval}
                    onChangeText={setCycleInterval}
                  />
                  <View style={[styles.seg, styles.unitSeg, { backgroundColor: colors.surfaceMuted }]}>
                    {(['day', 'week', 'month', 'year'] as const).map((unit) => (
                      <Pressable
                        key={unit}
                        onPress={() => setCycleUnit(unit)}
                        style={[styles.segButton, cycleUnit === unit && { backgroundColor: colors.surface }]}>
                        <ThemedText style={[styles.segText, { color: cycleUnit === unit ? colors.text : colors.mutedText }]}>
                          {cycleUnitLabel(unit)}
                        </ThemedText>
                      </Pressable>
                    ))}
                  </View>
                </View>
                <FormLabel label="真实证书校验（可选）" />
                <View style={styles.inlineRow}>
                  <TextInput
                    style={[styles.input, styles.flexInput, { backgroundColor: colors.surface, borderColor: colors.line, color: colors.text }]}
                    placeholder="xwhub.cn"
                    placeholderTextColor="#9aa6bd"
                    value={verifyHost}
                    onChangeText={setVerifyHost}
                  />
                  <Pressable onPress={() => void verifySSL()} disabled={verifying} style={[styles.verifyButton, { backgroundColor: colors.primary }]}>
                    {verifying ? (
                      <ActivityIndicator size="small" color="#ffffff" />
                    ) : (
                      <ThemedText style={styles.verifyButtonText}>校验</ThemedText>
                    )}
                  </Pressable>
                </View>
              </>
            ) : null}
            <FormLabel label="提前提醒" />
            <View style={styles.pillRow}>
              {LEAD_OPTIONS.map((days) => (
                <FilterPill
                  key={days}
                  label={`${days} 天`}
                  active={reminderLeadDays === days}
                  onPress={() => setReminderLeadDays(days)}
                />
              ))}
            </View>
            <FormLabel label="备注" />
            <TextInput
              style={[styles.textArea, { backgroundColor: colors.surface, borderColor: colors.line, color: colors.text }]}
              multiline
              placeholder="可选，最长 500 字"
              placeholderTextColor="#9aa6bd"
              value={note}
              onChangeText={setNote}
            />
            <FormLabel label="来源" />
            <View style={styles.pillRow}>
              {(['user', 'photo', 'scanner', 'api', 'import'] as const).map((item) => (
                <FilterPill key={item} label={sourceLabel(item)} active={source === item} onPress={() => setSource(item)} />
              ))}
            </View>
            <FormLabel label="证据照片" />
            <Pressable onPress={() => void pickEvidence()} style={[styles.uploadZone, { borderColor: colors.line }]}>
              <MaterialCommunityIcons name={pickedEvidence ? 'image-check-outline' : 'camera-outline'} size={22} color={colors.primary} />
              <ThemedText style={[styles.uploadTitle, { color: colors.text }]}>
                {pickedEvidence ? '已选择真实照片' : '拍摄或上传真实照片'}
              </ThemedText>
              <ThemedText style={[styles.uploadSub, { color: colors.mutedText }]}>照片只作为证据，不生成日期</ThemedText>
            </Pressable>
            {submitError ? <FormError text={submitError} /> : null}
            <Pressable onPress={() => void save()} style={({ pressed }) => [styles.saveButton, { backgroundColor: colors.hero }, pressed && styles.pressed]}>
              <ThemedText style={styles.saveButtonText}>保存记录</ThemedText>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function DetailModal(props: {
  open: boolean;
  record: DaysLeftRecord | null;
  events: Awaited<ReturnType<typeof fetchDaysLeftEvents>>;
  evidence: Awaited<ReturnType<typeof fetchDaysLeftEvidence>>;
  accessToken: string;
  busy: boolean;
  onClose: () => void;
  onRenew: (record: DaysLeftRecord) => void;
  onComplete: (id: string) => void;
  onUndo: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
  onEvidenceUploaded: (id: string) => Promise<void>;
  colors: ReturnType<typeof useAppTheme>['colors'];
}) {
  const { open, record, events, evidence, accessToken, busy, onClose, onRenew, onComplete, onUndo, onDelete, onEvidenceUploaded, colors } = props;

  async function addEvidence() {
    if (!record) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 });
    if (picked.canceled || picked.assets.length === 0) return;
    const asset = picked.assets[0];
    await uploadDaysLeftEvidence(accessToken, record.id, {
      uri: asset.uri,
      name: asset.fileName ?? 'evidence.jpg',
      type: asset.mimeType ?? 'image/jpeg',
    });
    await onEvidenceUploaded(record.id);
  }

  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} />
        <View style={[styles.modalSheet, { backgroundColor: colors.background }]}>
          <ModalHeader title="记录详情" onClose={onClose} />
          <ScrollView contentContainerStyle={styles.modalContent}>
            {record ? (
              <>
                <View style={[styles.detailHero, { backgroundColor: colors.hero }]}>
                  <View style={styles.heroKicker}>
                    <MaterialCommunityIcons name={mciName(iconForRecordType(record.recordType))} size={14} color="#c9f36a" />
                    <ThemedText style={styles.heroKickerText}>{record.categoryName} · {recordTypeLabel(record.recordType)}</ThemedText>
                  </View>
                  <ThemedText style={styles.detailTitle}>{record.name}</ThemedText>
                  <View style={styles.detailDays}>
                    <ThemedText style={styles.detailDaysValue}>{record.daysLeft}</ThemedText>
                    <ThemedText style={styles.detailDaysUnit}>天后到期</ThemedText>
                  </View>
                  <ThemedText style={styles.detailMeta}>
                    {formatDateCN(record.expiryDate)} · {riskLabel(record.riskLevel)}
                  </ThemedText>
                </View>
                <View style={[styles.infoCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
                  <InfoRow label="到期日期" value={`${record.expiryDate}（${record.daysLeft} 天）`} />
                  <InfoRow label="提前提醒" value={`${record.reminderLeadDays} 天 · ${record.remindAt || '未计算'}`} />
                  <InfoRow label="来源" value={`${sourceLabel(record.source)}${record.verified ? ' · 已核验' : ''}`} />
                  {record.verifiedAt ? <InfoRow label="校验时间" value={record.verifiedAt.slice(0, 10)} /> : null}
                </View>
                {record.note ? (
                  <View style={[styles.infoCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
                    <ThemedText style={styles.infoNote}>{record.note}</ThemedText>
                  </View>
                ) : null}
                <View style={styles.detailActions}>
                  <Pressable onPress={() => onRenew(record)} style={[styles.actionButton, { backgroundColor: colors.primary }]}>
                    <MaterialCommunityIcons name="refresh" size={16} color="#ffffff" />
                    <ThemedText style={styles.actionButtonText}>标记已续期</ThemedText>
                  </Pressable>
                  <Pressable onPress={() => onComplete(record.id)} disabled={busy} style={[styles.actionButton, { backgroundColor: colors.surface, borderColor: colors.line }]}>
                    <ThemedText style={[styles.actionGhostText, { color: colors.text }]}>标记已完成</ThemedText>
                  </Pressable>
                </View>
                {events.length > 0 ? (
                  <Pressable onPress={() => onUndo(record.id)} disabled={busy} style={styles.undoButton}>
                    <MaterialCommunityIcons name="history" size={15} color={colors.primary} />
                    <ThemedText style={[styles.undoText, { color: colors.primary }]}>撤销最近动作</ThemedText>
                  </Pressable>
                ) : null}
                <SectionTitle title="证据照片" meta={`${evidence.length} 张真实照片`} />
                {evidence.length === 0 ? (
                  <EmptyState icon="image-outline" title="暂无证据照片" subtitle="可以上传真实证件、包装或账单照片" />
                ) : (
                  <View style={styles.evidenceRow}>
                    {evidence.map((item) => (
                      <Image key={item.id} source={{ uri: item.fileUrl }} style={styles.evidenceImage} />
                    ))}
                  </View>
                )}
                <Pressable onPress={() => void addEvidence()} style={[styles.uploadZone, { borderColor: colors.line }]}>
                  <MaterialCommunityIcons name="camera-plus-outline" size={22} color={colors.primary} />
                  <ThemedText style={[styles.uploadTitle, { color: colors.text }]}>添加真实照片</ThemedText>
                </Pressable>
                <SectionTitle title="续期历史" meta={`${events.length} 条记录`} />
                {events.length === 0 ? (
                  <EmptyState icon="history" title="暂无历史" subtitle="续期和完成动作会在这里保留" />
                ) : (
                  events.map((event) => (
                    <View key={event.id} style={[styles.infoCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
                      <ThemedText style={styles.historyTitle}>{event.action === 'renewed' ? '续期' : '完成'} · {event.createdAt.slice(0, 10)}</ThemedText>
                      <ThemedText style={[styles.historySub, { color: colors.mutedText }]}>
                        {event.previousExpiryDate} → {event.newExpiryDate}
                      </ThemedText>
                    </View>
                  ))
                )}
                <Pressable onPress={() => void onDelete(record.id)} disabled={busy} style={styles.deleteButton}>
                  <ThemedText style={styles.deleteText}>删除记录</ThemedText>
                </Pressable>
              </>
            ) : (
              <View style={styles.modalLoading}><ActivityIndicator color={colors.primary} /></View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function RenewModal(props: {
  open: boolean;
  record?: DaysLeftRecord;
  accessToken: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
  colors: ReturnType<typeof useAppTheme>['colors'];
}) {
  const { open, record, accessToken, onClose, onSaved, colors } = props;
  const [expiryDate, setExpiryDate] = useState('');
  const [cycleUnit, setCycleUnit] = useState('year');
  const [cycleInterval, setCycleInterval] = useState('1');
  const [note, setNote] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setExpiryDate('');
    setCycleUnit(record?.cycleUnit ?? 'year');
    setCycleInterval(record ? String(record.cycleInterval) : '1');
    setNote('');
    setSubmitError(null);
  }, [open, record]);

  async function save() {
    if (!record) return;
    setSubmitError(null);
    try {
      await renewDaysLeftRecord(accessToken, record.id, {
        newExpiryDate: expiryDate || undefined,
        cycleUnit: cycleUnit as DaysLeftRecordInput['cycleUnit'],
        cycleInterval: Number(cycleInterval) || 1,
        note: note.trim(),
      });
      await onSaved();
    } catch (nextError) {
      setSubmitError(getDaysLeftErrorMessage(nextError));
    }
  }

  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} />
        <View style={[styles.modalSheet, { backgroundColor: colors.background }]}>
          <ModalHeader title="标记已续期" onClose={onClose} />
          <ScrollView contentContainerStyle={styles.modalContent}>
            <FormLabel label="新到期日期（留空按周期计算）" />
            <TextInput
              style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.line, color: colors.text }]}
              placeholder="YYYY-MM-DD"
              placeholderTextColor="#9aa6bd"
              value={expiryDate}
              onChangeText={setExpiryDate}
            />
            <FormLabel label="续费周期" />
            <View style={styles.inlineRow}>
              <TextInput
                style={[styles.input, styles.flexInput, { backgroundColor: colors.surface, borderColor: colors.line, color: colors.text }]}
                keyboardType="number-pad"
                value={cycleInterval}
                onChangeText={setCycleInterval}
              />
              <View style={[styles.seg, styles.unitSeg, { backgroundColor: colors.surfaceMuted }]}>
                {(['day', 'week', 'month', 'year'] as const).map((unit) => (
                  <Pressable key={unit} onPress={() => setCycleUnit(unit)} style={[styles.segButton, cycleUnit === unit && { backgroundColor: colors.surface }]}>
                    <ThemedText style={[styles.segText, { color: cycleUnit === unit ? colors.text : colors.mutedText }]}>{cycleUnitLabel(unit)}</ThemedText>
                  </Pressable>
                ))}
              </View>
            </View>
            <FormLabel label="备注" />
            <TextInput
              style={[styles.textArea, { backgroundColor: colors.surface, borderColor: colors.line, color: colors.text }]}
              multiline
              placeholder="可选"
              placeholderTextColor="#9aa6bd"
              value={note}
              onChangeText={setNote}
            />
            {submitError ? <FormError text={submitError} /> : null}
            <Pressable onPress={() => void save()} style={[styles.saveButton, { backgroundColor: colors.hero }]}>
              <ThemedText style={styles.saveButtonText}>确认续期</ThemedText>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function CategoryModal(props: {
  open: boolean;
  category?: DaysLeftCategory;
  accessToken: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
  colors: ReturnType<typeof useAppTheme>['colors'];
}) {
  const { open, category, accessToken, onClose, onSaved, colors } = props;
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('calendar-clock-outline');
  const [color, setColor] = useState('#4b6bff');
  const [reminderLeadDays, setReminderLeadDays] = useState(30);
  const [defaultRecordType, setDefaultRecordType] = useState<DaysLeftRecordType>('fixed');
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(category?.name ?? '');
    setIcon(category?.icon ?? 'calendar-clock-outline');
    setColor(category?.color ?? '#4b6bff');
    setReminderLeadDays(category?.reminderLeadDays ?? 30);
    setDefaultRecordType(category?.defaultRecordType ?? 'fixed');
    setSubmitError(null);
  }, [open, category]);

  async function save() {
    if (!name.trim()) {
      setSubmitError('请填写分类名称。');
      return;
    }
    const input = {
      name: name.trim(),
      icon,
      color,
      reminderLeadDays,
      defaultRecordType,
    };
    try {
      if (category) {
        await updateDaysLeftCategory(accessToken, category.id, input);
      } else {
        await createDaysLeftCategory(accessToken, input);
      }
      await onSaved();
    } catch (nextError) {
      setSubmitError(getDaysLeftErrorMessage(nextError));
    }
  }

  async function remove() {
    if (!category || category.isSystem) return;
    const ok = Platform.OS === 'web' ? window.confirm('确认删除该自定义分类？') : await confirmNative();
    if (!ok) return;
    try {
      await deleteDaysLeftCategory(accessToken, category.id);
      await onSaved();
    } catch (nextError) {
      setSubmitError(getDaysLeftErrorMessage(nextError));
    }
  }

  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} />
        <View style={[styles.modalSheet, { backgroundColor: colors.background }]}>
          <ModalHeader title={category ? '编辑分类' : '新建自定义分类'} onClose={onClose} />
          <ScrollView contentContainerStyle={styles.modalContent}>
            <FormLabel label="名称" />
            <TextInput
              style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.line, color: colors.text }]}
              value={name}
              onChangeText={setName}
            />
            <FormLabel label="图标" />
            <TextInput
              style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.line, color: colors.text }]}
              value={icon}
              onChangeText={setIcon}
            />
            <FormLabel label="颜色" />
            <View style={styles.pillRow}>
              {['#4b6bff', '#7e5bef', '#1db991', '#f1a33b', '#ff6b8f'].map((item) => (
                <Pressable key={item} onPress={() => setColor(item)} style={[styles.colorSwatch, { backgroundColor: item, borderColor: color === item ? colors.text : 'transparent' }]} />
              ))}
            </View>
            <FormLabel label="默认提醒提前量" />
            <View style={styles.pillRow}>
              {[3, 7, 14, 30, 60, 90].map((days) => (
                <FilterPill key={days} label={`${days} 天`} active={reminderLeadDays === days} onPress={() => setReminderLeadDays(days)} />
              ))}
            </View>
            <FormLabel label="默认到期类型" />
            <View style={[styles.seg, { backgroundColor: colors.surfaceMuted }]}>
              {RECORD_TYPES.map((type) => (
                <Pressable key={type} onPress={() => setDefaultRecordType(type)} style={[styles.segButton, defaultRecordType === type && { backgroundColor: colors.surface }]}>
                  <ThemedText style={[styles.segText, { color: defaultRecordType === type ? colors.text : colors.mutedText }]}>
                    {recordTypeLabel(type)}
                  </ThemedText>
                </Pressable>
              ))}
            </View>
            {submitError ? <FormError text={submitError} /> : null}
            <Pressable onPress={() => void save()} style={[styles.saveButton, { backgroundColor: colors.hero }]}>
              <ThemedText style={styles.saveButtonText}>保存分类</ThemedText>
            </Pressable>
            {category && !category.isSystem ? (
              <Pressable onPress={() => void remove()} style={styles.deleteButton}>
                <ThemedText style={styles.deleteText}>删除分类</ThemedText>
              </Pressable>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function RecordCard(props: { record: DaysLeftRecord; onPress: () => void }) {
  const { record, onPress } = props;
  const color = riskColor(record.riskLevel);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.recordCard, { borderLeftColor: color }, pressed && styles.pressed]}>
      <View style={[styles.recordIcon, { backgroundColor: `${record.categoryColor}1f` }]}>
        <MaterialCommunityIcons name={mciName(iconForRecordType(record.recordType))} size={17} color={record.categoryColor} />
      </View>
      <View style={styles.recordMain}>
        <ThemedText style={styles.recordTitle} numberOfLines={1}>{record.name}</ThemedText>
        <ThemedText style={styles.recordSub} numberOfLines={1}>
          {record.categoryName} · {formatShortDate(record.expiryDate)} · {sourceLabel(record.source)}
        </ThemedText>
        <View style={styles.recordBadges}>
          <View style={[styles.badge, { backgroundColor: `${color}18` }]}>
            <ThemedText style={[styles.badgeText, { color }]}>{riskLabel(record.riskLevel)}</ThemedText>
          </View>
          {record.verified ? (
            <View style={[styles.badge, { backgroundColor: '#e4f7ee' }]}>
              <ThemedText style={[styles.badgeText, { color: '#1db991' }]}>已核验</ThemedText>
            </View>
          ) : null}
        </View>
      </View>
      <View style={styles.recordRight}>
        <ThemedText style={[styles.recordDays, { color }]}>{record.daysLeft}</ThemedText>
        <ThemedText style={styles.recordDaysUnit}>天</ThemedText>
      </View>
    </Pressable>
  );
}

function StatCard(props: { label: string; value: number; color: string }) {
  const { label, value, color } = props;
  return (
    <View style={styles.statCard}>
      <ThemedText style={[styles.statValue, { color }]}>{value}</ThemedText>
      <ThemedText style={styles.statLabel}>{label}</ThemedText>
    </View>
  );
}

function SectionTitle(props: { title: string; meta: string }) {
  return (
    <View style={styles.sectionTitle}>
      <ThemedText style={styles.sectionTitleText}>{props.title}</ThemedText>
      <ThemedText style={styles.sectionMeta}>{props.meta}</ThemedText>
    </View>
  );
}

function EmptyState(props: { icon: IconName; title: string; subtitle: string }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <MaterialCommunityIcons name={props.icon} size={18} color="#1db991" />
      </View>
      <View style={styles.emptyText}>
        <ThemedText style={styles.emptyTitle}>{props.title}</ThemedText>
        <ThemedText style={styles.emptySub}>{props.subtitle}</ThemedText>
      </View>
    </View>
  );
}

function FilterPill(props: { label: string; icon?: IconName; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={props.onPress} style={[styles.pill, props.active && styles.pillActive]}>
      {props.icon ? <MaterialCommunityIcons name={props.icon} size={13} color={props.active ? '#c9f36a' : '#56647f'} /> : null}
      <ThemedText style={[styles.pillText, props.active && styles.pillTextActive]}>{props.label}</ThemedText>
    </Pressable>
  );
}

function FormLabel(props: { label: string }) {
  return <ThemedText style={styles.formLabel}>{props.label}</ThemedText>;
}

function FormError(props: { text: string }) {
  return <ThemedText style={styles.formError}>{props.text}</ThemedText>;
}

function InfoRow(props: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <ThemedText style={styles.infoLabel}>{props.label}</ThemedText>
      <ThemedText style={styles.infoValue}>{props.value}</ThemedText>
    </View>
  );
}

function ModalHeader(props: { title: string; onClose: () => void }) {
  return (
    <View style={styles.modalHeader}>
      <ThemedText style={styles.modalTitle}>{props.title}</ThemedText>
      <Pressable onPress={props.onClose} style={styles.modalClose}>
        <MaterialCommunityIcons name="close" size={20} color="#7483a2" />
      </Pressable>
    </View>
  );
}

function CenterState(props: { icon: IconName; title: string; loading?: boolean }) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.centerState}>
        {props.loading ? <ActivityIndicator size="large" color="#4b6bff" /> : <MaterialCommunityIcons name={props.icon} size={38} color="#4b6bff" />}
        <ThemedText style={styles.centerTitle}>{props.title}</ThemedText>
      </View>
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
  headerAdd: {
    minHeight: 34,
    paddingHorizontal: 11,
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: 13,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
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
    gap: 4,
    justifyContent: 'center',
    minHeight: 34,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '800',
  },
  content: {
    paddingBottom: 40,
    paddingHorizontal: 14,
    paddingTop: 12,
  },
  notice: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
    padding: 10,
  },
  noticeText: {
    flex: 1,
    fontSize: 11,
    fontWeight: '700',
  },
  heroCard: {
    borderRadius: 18,
    marginBottom: 12,
    padding: 16,
  },
  heroLight: {
    backgroundColor: '#151b3b',
  },
  heroDark: {
    backgroundColor: '#1d2730',
  },
  heroKicker: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 5,
  },
  heroKickerText: {
    color: '#c9f36a',
    fontSize: 10,
    fontWeight: '900',
  },
  heroDays: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  heroDaysValue: {
    color: '#ffffff',
    fontFamily: 'monospace',
    fontSize: 36,
    fontWeight: '900',
    lineHeight: 38,
  },
  heroDaysUnit: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 12,
    fontWeight: '800',
  },
  heroTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '900',
    marginTop: 8,
  },
  heroSubtitle: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 10,
    fontWeight: '700',
    marginTop: 5,
  },
  statGrid: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  statCard: {
    backgroundColor: '#ffffff',
    borderColor: '#dce5f6',
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    paddingHorizontal: 6,
    paddingVertical: 9,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '900',
    lineHeight: 22,
  },
  statLabel: {
    color: '#7483a2',
    fontSize: 9,
    fontWeight: '700',
    marginTop: 4,
  },
  sectionTitle: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
    marginTop: 4,
  },
  sectionTitleText: {
    fontSize: 14,
    fontWeight: '900',
  },
  sectionMeta: {
    color: '#7483a2',
    fontSize: 9,
    fontWeight: '700',
  },
  empty: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#cfd9eb',
    borderRadius: 14,
    borderStyle: 'dashed',
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 12,
    padding: 12,
  },
  emptyIcon: {
    alignItems: 'center',
    backgroundColor: '#e4f7ee',
    borderRadius: 999,
    height: 34,
    justifyContent: 'center',
    marginRight: 10,
    width: 34,
  },
  emptyText: {
    flex: 1,
  },
  emptyTitle: {
    fontSize: 11,
    fontWeight: '900',
  },
  emptySub: {
    color: '#7483a2',
    fontSize: 9,
    marginTop: 3,
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  categoryChip: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    flexBasis: '47%',
    flexDirection: 'row',
    gap: 8,
    padding: 9,
  },
  categoryIcon: {
    alignItems: 'center',
    borderRadius: 9,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  categoryChipText: {
    flex: 1,
  },
  categoryName: {
    fontSize: 10,
    fontWeight: '900',
  },
  categoryMeta: {
    fontSize: 8,
    marginTop: 2,
  },
  addBar: {
    alignItems: 'center',
    borderRadius: 14,
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    minHeight: 44,
    marginTop: 4,
  },
  addBarText: {
    color: '#c9f36a',
    fontSize: 13,
    fontWeight: '900',
  },
  searchShell: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    height: 44,
    marginBottom: 10,
    paddingHorizontal: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 11,
    fontWeight: '700',
  },
  pillRow: {
    gap: 6,
    paddingBottom: 8,
    paddingTop: 2,
  },
  pill: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#dce5f6',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    height: 30,
    paddingHorizontal: 11,
  },
  pillActive: {
    backgroundColor: '#151b3b',
    borderColor: '#151b3b',
  },
  pillText: {
    color: '#56647f',
    fontSize: 10,
    fontWeight: '800',
  },
  pillTextActive: {
    color: '#c9f36a',
  },
  seg: {
    borderRadius: 12,
    flexDirection: 'row',
    gap: 3,
    marginBottom: 10,
    padding: 3,
  },
  segButton: {
    alignItems: 'center',
    borderRadius: 9,
    flex: 1,
    justifyContent: 'center',
    minHeight: 30,
  },
  segText: {
    fontSize: 10,
    fontWeight: '800',
  },
  sortRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  sortMeta: {
    fontSize: 10,
    fontWeight: '700',
  },
  sortButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 3,
  },
  sortLabel: {
    fontSize: 10,
    fontWeight: '900',
  },
  recordCard: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#dce5f6',
    borderRadius: 14,
    borderLeftWidth: 3,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
    padding: 11,
  },
  recordIcon: {
    alignItems: 'center',
    borderRadius: 9,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  recordMain: {
    flex: 1,
    minWidth: 0,
  },
  recordTitle: {
    fontSize: 11,
    fontWeight: '900',
  },
  recordSub: {
    color: '#7483a2',
    fontSize: 8.5,
    marginTop: 3,
  },
  recordBadges: {
    flexDirection: 'row',
    gap: 5,
    marginTop: 5,
  },
  badge: {
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 8,
    fontWeight: '900',
  },
  recordRight: {
    alignItems: 'flex-end',
  },
  recordDays: {
    fontSize: 18,
    fontWeight: '900',
  },
  recordDaysUnit: {
    color: '#7483a2',
    fontSize: 9,
  },
  listCard: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
    padding: 10,
  },
  listIcon: {
    alignItems: 'center',
    borderRadius: 9,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  listMain: {
    flex: 1,
  },
  listTitle: {
    fontSize: 11,
    fontWeight: '900',
  },
  listSub: {
    fontSize: 9,
    marginTop: 3,
  },
  listCount: {
    fontSize: 15,
    fontWeight: '900',
  },
  addCategory: {
    alignItems: 'center',
    borderRadius: 14,
    borderStyle: 'dashed',
    borderWidth: 1,
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    minHeight: 46,
    marginTop: 4,
  },
  addCategoryText: {
    fontSize: 11,
    fontWeight: '900',
  },
  statsHero: {
    borderRadius: 18,
    marginBottom: 12,
    padding: 16,
  },
  reminderCard: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
    padding: 10,
  },
  dismissButton: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  dismissText: {
    fontSize: 10,
    fontWeight: '900',
  },
  calendarCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
  },
  calendarHead: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  calendarHeadText: {
    flex: 1,
    fontSize: 9,
    fontWeight: '800',
    textAlign: 'center',
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  calendarCell: {
    alignItems: 'center',
    borderRadius: 8,
    height: 34,
    justifyContent: 'center',
    width: '14.2857%',
  },
  calendarDay: {
    fontSize: 10,
    fontWeight: '800',
  },
  calendarDot: {
    backgroundColor: '#1db991',
    borderRadius: 999,
    height: 4,
    marginTop: 2,
    width: 4,
  },
  exportRow: {
    flexDirection: 'row',
    gap: 8,
  },
  exportButton: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: 5,
    justifyContent: 'center',
    minHeight: 42,
  },
  exportText: {
    fontSize: 10,
    fontWeight: '900',
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
    height: '92%',
    overflow: 'hidden',
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
  formLabel: {
    color: '#56647f',
    fontSize: 10,
    fontWeight: '900',
    marginBottom: 6,
    marginTop: 10,
  },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    fontSize: 11,
    height: 42,
    paddingHorizontal: 12,
  },
  textArea: {
    borderRadius: 12,
    borderWidth: 1,
    fontSize: 11,
    minHeight: 76,
    padding: 12,
    textAlignVertical: 'top',
  },
  inlineRow: {
    flexDirection: 'row',
    gap: 8,
  },
  flexInput: {
    flex: 1,
  },
  unitSeg: {
    flex: 1,
  },
  verifyButton: {
    alignItems: 'center',
    borderRadius: 12,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: 14,
  },
  verifyButtonText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '900',
  },
  uploadZone: {
    alignItems: 'center',
    borderRadius: 14,
    borderStyle: 'dashed',
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 96,
    padding: 14,
  },
  uploadTitle: {
    fontSize: 11,
    fontWeight: '900',
    marginTop: 6,
  },
  uploadSub: {
    fontSize: 9,
    marginTop: 3,
  },
  formError: {
    color: '#d84b5c',
    fontSize: 10,
    fontWeight: '700',
    marginTop: 8,
  },
  saveButton: {
    alignItems: 'center',
    borderRadius: 14,
    justifyContent: 'center',
    minHeight: 46,
    marginTop: 16,
  },
  saveButtonText: {
    color: '#c9f36a',
    fontSize: 13,
    fontWeight: '900',
  },
  detailHero: {
    borderRadius: 18,
    padding: 16,
  },
  detailTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '900',
    marginTop: 10,
  },
  detailDays: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: 7,
    marginTop: 10,
  },
  detailDaysValue: {
    color: '#ffffff',
    fontSize: 32,
    fontWeight: '900',
  },
  detailDaysUnit: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 11,
    fontWeight: '800',
  },
  detailMeta: {
    color: 'rgba(255,255,255,0.74)',
    fontSize: 9,
    marginTop: 6,
  },
  infoCard: {
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 10,
    padding: 12,
  },
  infoRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  infoLabel: {
    color: '#7483a2',
    fontSize: 10,
    fontWeight: '700',
  },
  infoValue: {
    fontSize: 10,
    fontWeight: '900',
    maxWidth: '62%',
  },
  infoNote: {
    fontSize: 10,
    lineHeight: 16,
  },
  detailActions: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  actionButton: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: 5,
    justifyContent: 'center',
    minHeight: 42,
  },
  actionButtonText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '900',
  },
  actionGhostText: {
    fontSize: 11,
    fontWeight: '900',
  },
  undoButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 5,
    justifyContent: 'center',
    marginBottom: 10,
    paddingVertical: 6,
  },
  undoText: {
    fontSize: 11,
    fontWeight: '900',
  },
  evidenceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  evidenceImage: {
    borderRadius: 12,
    height: 92,
    width: 92,
  },
  historyTitle: {
    fontSize: 11,
    fontWeight: '900',
  },
  historySub: {
    fontSize: 9,
    marginTop: 4,
  },
  deleteButton: {
    alignItems: 'center',
    borderRadius: 12,
    marginTop: 8,
    paddingVertical: 11,
  },
  deleteText: {
    color: '#d84b5c',
    fontSize: 12,
    fontWeight: '900',
  },
  modalLoading: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 300,
  },
  colorSwatch: {
    borderRadius: 999,
    borderWidth: 2,
    height: 30,
    width: 30,
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
    height: 56,
    justifyContent: 'center',
    marginBottom: 14,
    width: 56,
  },
  stateTitle: {
    fontSize: 18,
    fontWeight: '900',
  },
  stateText: {
    fontSize: 12,
    lineHeight: 19,
    marginTop: 8,
    textAlign: 'center',
  },
  centerState: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  centerTitle: {
    fontSize: 15,
    fontWeight: '800',
    marginTop: 12,
  },
});
