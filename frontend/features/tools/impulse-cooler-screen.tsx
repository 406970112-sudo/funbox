import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as ImagePicker from 'expo-image-picker';
import * as Notifications from 'expo-notifications';
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
import { useAppTheme } from '@/hooks/use-app-theme';
import { useAuth } from '@/features/auth/auth-provider';
import {
  clearCoolingData,
  createCoolingItem,
  decideCoolingItem,
  deleteCoolingItem,
  exportCoolingData,
  extendCoolingItem,
  fetchCoolingEvidence,
  fetchCoolingEvents,
  fetchCoolingHome,
  fetchCoolingItem,
  fetchCoolingSettings,
  getCoolingErrorMessage,
  saveCoolingSettings,
  undoCoolingItem,
  uploadCoolingEvidence,
} from '@/lib/impulse-cooler-api';
import {
  answerLabel,
  completionRateText,
  formatCents,
  formatHours,
  formatPercent,
  maxBarHeight,
  parseYuanToCents,
  remainingText,
  riskMeta,
  SIMILAR_OPTIONS,
  sourceLabel,
  statusMeta,
  USAGE_OPTIONS,
  WANTS_OPTIONS,
  WHY_BUY_OPTIONS,
} from '@/lib/impulse-cooler';
import type {
  CoolingAnswers,
  CoolingEvidence,
  CoolingEvent,
  CoolingHome,
  CoolingItem,
  CoolingItemInput,
  CoolingSettings,
} from '@/types/impulse-cooler';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

type Tab = 'home' | 'stats' | 'settings';
type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export function ImpulseCoolerScreen() {
  const router = useRouter();
  const { accessToken, status: authStatus, user } = useAuth();
  const { colors, colorScheme } = useAppTheme();
  const dark = colorScheme === 'dark';
  const [activeTab, setActiveTab] = useState<Tab>('home');
  const [home, setHome] = useState<CoolingHome | null>(null);
  const [settings, setSettings] = useState<CoolingSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newModal, setNewModal] = useState(false);
  const [detail, setDetail] = useState<CoolingItem | null>(null);
  const [detailEvents, setDetailEvents] = useState<CoolingEvent[]>([]);
  const [detailEvidence, setDetailEvidence] = useState<CoolingEvidence[]>([]);
  const [decisionItem, setDecisionItem] = useState<CoolingItem | null>(null);
  const requestRef = useRef(0);
  const hasLoadedRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!accessToken) return;
    const requestID = ++requestRef.current;
    setLoading(!hasLoadedRef.current);
    setError(null);
    try {
      const [homeData, settingsData] = await Promise.all([
        fetchCoolingHome(accessToken),
        fetchCoolingSettings(accessToken),
      ]);
      if (requestID !== requestRef.current) return;
      setHome(homeData);
      setSettings(settingsData);
      setLoading(false);
      hasLoadedRef.current = true;
    } catch (nextError) {
      if (requestID !== requestRef.current) return;
      setError(getCoolingErrorMessage(nextError));
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
      setError(getCoolingErrorMessage(nextError));
    } finally {
      setBusy(false);
    }
  }

  async function openDetail(itemId: string) {
    if (!accessToken) return;
    setDetail(null);
    setDetailEvents([]);
    setDetailEvidence([]);
    try {
      const [item, events, evidence] = await Promise.all([
        fetchCoolingItem(accessToken, itemId),
        fetchCoolingEvents(accessToken, itemId),
        fetchCoolingEvidence(accessToken, itemId),
      ]);
      setDetail(item);
      setDetailEvents(events);
      setDetailEvidence(evidence);
    } catch (nextError) {
      setError(getCoolingErrorMessage(nextError));
    }
  }

  async function createItem(input: CoolingItemInput) {
    if (!accessToken) return;
    await runMutation(async () => {
      const item = await createCoolingItem(accessToken, input);
      await scheduleCoolingNotification(item, settings);
      setNewModal(false);
      await openDetail(item.id);
    }, '冷静记录已创建');
  }

  async function decide(item: CoolingItem, action: 'buy' | 'drop', finalPriceCents?: number) {
    if (!accessToken) return;
    await runMutation(async () => {
      await decideCoolingItem(accessToken, item.id, {
        action,
        ...(action === 'buy' && finalPriceCents ? { finalPriceCents } : {}),
      });
      setDecisionItem(null);
      if (detail?.id === item.id) await openDetail(item.id);
    }, action === 'buy' ? '已记录为仍要买' : '已记录为不买了');
  }

  async function extend(item: CoolingItem) {
    if (!accessToken) return;
    await runMutation(async () => {
      await extendCoolingItem(accessToken, item.id);
      if (detail?.id === item.id) await openDetail(item.id);
    }, '已延长 24 小时');
  }

  async function undo(item: CoolingItem) {
    if (!accessToken) return;
    await runMutation(async () => {
      await undoCoolingItem(accessToken, item.id);
      if (detail?.id === item.id) await openDetail(item.id);
    }, '已撤销决策');
  }

  async function remove(item: CoolingItem) {
    if (!accessToken) return;
    Alert.alert('删除冷静记录', `确定删除「${item.name}」吗？删除后不可恢复。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () =>
          void runMutation(async () => {
            await deleteCoolingItem(accessToken, item.id);
            setDetail(null);
          }, '记录已删除'),
      },
    ]);
  }

  async function uploadEvidence(item: CoolingItem) {
    if (!accessToken) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    await runMutation(async () => {
      await uploadCoolingEvidence(accessToken, item.id, {
        uri: asset.uri,
        name: asset.fileName ?? 'evidence.jpg',
        type: asset.mimeType ?? 'image/jpeg',
      });
      if (detail?.id === item.id) await openDetail(item.id);
    }, '凭证已上传');
  }

  if (authStatus === 'loading') {
    return <CenterState icon="snowflake" title="正在打开冷静器" loading />;
  }

  if (!accessToken || !user) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
        <View style={styles.loginState}>
          <View style={[styles.stateIcon, { backgroundColor: colors.primarySoft }]}>
            <MaterialCommunityIcons name="snowflake" size={34} color={colors.primary} />
          </View>
          <ThemedText style={styles.stateTitle}>登录后使用冲动消费冷静器</ThemedText>
          <ThemedText style={[styles.stateText, { color: colors.mutedText }]}>
            你的冷静记录会保存在 FunBox 账号里，首启为空，不预置任何数据。
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/auth', params: { returnTo: '/tools/impulse-cooler' } })}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
            <MaterialCommunityIcons name="login" size={18} color="#ffffff" />
            <ThemedText style={styles.primaryButtonText}>登录</ThemedText>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (loading || !home || !settings) {
    return <CenterState icon="snowflake" title="正在整理冷静记录" loading />;
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
            <ThemedText style={styles.headerTitle}>冲动消费冷静器</ThemedText>
            <ThemedText style={[styles.headerMeta, { color: colors.mutedText }]}>
              不拦你买，只让你多想 24 小时
            </ThemedText>
          </View>
          <Pressable
            accessibilityLabel="新增冷静记录"
            accessibilityRole="button"
            onPress={() => setNewModal(true)}
            style={({ pressed }) => [styles.primaryButton, styles.headerAdd, pressed && styles.pressed]}>
            <MaterialCommunityIcons name="plus" size={18} color="#ffffff" />
            <ThemedText style={styles.primaryButtonText}>新增</ThemedText>
          </Pressable>
        </View>

        <View style={[styles.tabs, { backgroundColor: colors.surfaceMuted, borderColor: colors.line }]}>
          {(
            [
              ['home', '冷静舱', 'home-outline'],
              ['stats', '统计', 'chart-box-outline'],
              ['settings', '设置', 'cog-outline'],
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
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void refresh();
              }}
            />
          }>
          {error ? (
            <NoticeRow color="#d84b5c" background="#fff1f1" border="#ffd3d3" icon="alert-circle-outline" text={error} />
          ) : null}
          {message ? (
            <NoticeRow color={colors.primary} background={colors.primarySoft} border={colors.line} icon="check-circle-outline" text={message} />
          ) : null}

          {activeTab === 'home' ? (
            <HomeTab
              home={home}
              colors={colors}
              onAdd={() => setNewModal(true)}
              onOpen={openDetail}
            />
          ) : null}
          {activeTab === 'stats' ? <StatsTab home={home} colors={colors} /> : null}
          {activeTab === 'settings' ? (
            <SettingsTab
              settings={settings}
              colors={colors}
              onSave={async (input) => {
                await runMutation(async () => {
                  const saved = await saveCoolingSettings(accessToken, input);
                  setSettings(saved);
                }, '设置已保存');
              }}
              onExport={async (format) => {
                await runMutation(async () => {
                  await exportCoolingData(accessToken, format);
                }, '导出已开始');
              }}
              onClear={() => {
                Alert.alert('清空全部数据', '将删除当前账号的全部冷静记录，此操作不可恢复。', [
                  { text: '取消', style: 'cancel' },
                  {
                    text: '清空',
                    style: 'destructive',
                    onPress: () =>
                      void runMutation(async () => {
                        await clearCoolingData(accessToken);
                      }, '数据已清空'),
                  },
                ]);
              }}
            />
          ) : null}
        </ScrollView>
      </View>

      <NewItemModal
        visible={newModal}
        settings={settings}
        onClose={() => setNewModal(false)}
        onCreate={createItem}
        colors={colors}
        dark={dark}
      />

      <DetailModal
        item={detail}
        events={detailEvents}
        evidence={detailEvidence}
        serverNow={home.serverNow}
        colors={colors}
        busy={busy}
        onClose={() => setDetail(null)}
        onDecide={setDecisionItem}
        onExtend={extend}
        onUndo={undo}
        onDelete={remove}
        onUpload={uploadEvidence}
      />

      <DecisionModal
        item={decisionItem}
        colors={colors}
        onClose={() => setDecisionItem(null)}
        onDecide={decide}
      />
    </SafeAreaView>
  );
}

function HomeTab({
  home,
  colors,
  onAdd,
  onOpen,
}: {
  home: CoolingHome;
  colors: ReturnType<typeof useAppTheme>['colors'];
  onAdd: () => void;
  onOpen: (itemId: string) => void;
}) {
  const hasAny = home.stats.totalCount > 0;
  return (
    <View style={styles.tabBody}>
      <View style={[styles.heroCard, { backgroundColor: colors.hero }]}>
        <View style={styles.heroEyebrow}>
          <MaterialCommunityIcons name="shield-check" size={14} color="#c9f36a" />
          <ThemedText style={styles.heroEyebrowText}>冷静舱</ThemedText>
        </View>
        <ThemedText style={styles.heroTitle}>
          {hasAny ? `${home.stats.coolingCount} 件正在冷静` : '还没有冷静记录'}
        </ThemedText>
        <ThemedText style={[styles.heroSubtitle, { color: 'rgba(255,255,255,0.78)' }]}>
          所有数字只来自你的填写和真实记录，待决定和冷静中不会计入已省金额。
        </ThemedText>
      </View>

      <View style={styles.metricGrid}>
        <MetricCard label="冷静中" value={`${home.stats.coolingCount}`} suffix="件" color={colors.primary} />
        <MetricCard label="待决定" value={`${home.stats.pendingCount}`} suffix="件" color="#ff5d6c" />
        <MetricCard label="已放弃" value={`¥${formatCents(home.stats.droppedAmountCents)}`} color="#1db991" />
      </View>

      {home.pending.length > 0 ? (
        <View style={styles.section}>
          <SectionTitle title="待决定" meta={`${home.pending.length} 项`} />
          {home.pending.map((item) => (
            <ItemRow key={item.id} item={item} colors={colors} onPress={() => onOpen(item.id)} />
          ))}
        </View>
      ) : null}

      {home.cooling.length > 0 ? (
        <View style={styles.section}>
          <SectionTitle title="正在冷静" meta={`${home.cooling.length} 项`} />
          {home.cooling.map((item) => (
            <ItemRow key={item.id} item={item} colors={colors} onPress={() => onOpen(item.id)} />
          ))}
        </View>
      ) : null}

      {!hasAny ? (
        <View style={[styles.emptyState, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <View style={[styles.emptyIcon, { backgroundColor: colors.primarySoft }]}>
            <MaterialCommunityIcons name="package-variant-closed" size={25} color={colors.primary} />
          </View>
          <ThemedText style={styles.emptyTitle}>输入想买的东西和价格</ThemedText>
          <ThemedText style={[styles.emptyText, { color: colors.mutedText }]}>
            回答五个问题，开始你的第一次 24 小时冷静。
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={onAdd}
            style={({ pressed }) => [styles.primaryButton, styles.emptyButton, pressed && styles.pressed]}>
            <MaterialCommunityIcons name="plus" size={18} color="#ffffff" />
            <ThemedText style={styles.primaryButtonText}>新增冷静记录</ThemedText>
          </Pressable>
        </View>
      ) : null}

      {home.recent.length > 0 ? (
        <View style={styles.section}>
          <SectionTitle title="最近记录" meta="真实数据" />
          {home.recent.map((item) => (
            <ItemRow key={item.id} item={item} colors={colors} onPress={() => onOpen(item.id)} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function StatsTab({ home, colors }: { home: CoolingHome; colors: ReturnType<typeof useAppTheme>['colors'] }) {
  const stats = home.stats;
  const maxHeight = maxBarHeight(stats);
  return (
    <View style={styles.tabBody}>
      <View style={styles.metricGrid}>
        <MetricCard label="累计冷静金额" value={`¥${formatCents(stats.totalAmountCents)}`} color={colors.primary} />
        <MetricCard label="已放弃" value={`¥${formatCents(stats.droppedAmountCents)}`} color="#1db991" />
        <MetricCard label="最终购买" value={`¥${formatCents(stats.boughtAmountCents)}`} color="#7e5bef" />
      </View>
      <View style={styles.metricGrid}>
        <MetricCard label="冷静完成率" value={completionRateText(stats)} color={colors.primary} />
        <MetricCard label="平均等价工时" value={formatHours(stats.avgEquivalentHours)} suffix="h" color="#f1a33b" />
        <MetricCard label="总记录" value={`${stats.totalCount}`} suffix="条" color={colors.mutedText} />
      </View>

      <View style={[styles.chartCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <SectionTitle title="近 30 天" meta="按真实记录日期" />
        <View style={styles.chartBars}>
          {stats.daily.map((day) => {
            const total = day.createdCount + day.boughtCount + day.droppedCount;
            const height = total > 0 ? Math.max(8, (total / maxHeight) * 90) : 5;
            return (
              <View key={day.date} style={styles.chartBarWrap}>
                <View style={[styles.chartBar, { height, backgroundColor: total > 0 ? colors.primary : colors.line }]} />
                <ThemedText style={[styles.chartBarDate, { color: colors.mutedText }]}>
                  {day.date.slice(8)}
                </ThemedText>
              </View>
            );
          })}
        </View>
      </View>

      {stats.totalCount === 0 ? (
        <View style={[styles.emptyState, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <View style={[styles.emptyIcon, { backgroundColor: colors.primarySoft }]}>
            <MaterialCommunityIcons name="chart-box-outline" size={25} color={colors.primary} />
          </View>
          <ThemedText style={styles.emptyTitle}>完成第一次冷静后生成统计</ThemedText>
          <ThemedText style={[styles.emptyText, { color: colors.mutedText }]}>
            不绘制占位曲线，也不使用 mock 数据。
          </ThemedText>
        </View>
      ) : null}
    </View>
  );
}

function SettingsTab({
  settings,
  colors,
  onSave,
  onExport,
  onClear,
}: {
  settings: CoolingSettings;
  colors: ReturnType<typeof useAppTheme>['colors'];
  onSave: (input: Parameters<typeof saveCoolingSettings>[1]) => Promise<void>;
  onExport: (format: 'csv' | 'json') => Promise<void>;
  onClear: () => void;
}) {
  const [monthly, setMonthly] = useState(
    settings.monthlySalaryCents > 0 ? formatCents(settings.monthlySalaryCents) : '',
  );
  const [hours, setHours] = useState(settings.monthlyWorkHours > 0 ? String(settings.monthlyWorkHours) : '');
  const [hourly, setHourly] = useState(settings.hourlyWageCents > 0 ? formatCents(settings.hourlyWageCents) : '');

  useEffect(() => {
    setMonthly(settings.monthlySalaryCents > 0 ? formatCents(settings.monthlySalaryCents) : '');
    setHours(settings.monthlyWorkHours > 0 ? String(settings.monthlyWorkHours) : '');
    setHourly(settings.hourlyWageCents > 0 ? formatCents(settings.hourlyWageCents) : '');
  }, [settings]);

  return (
    <View style={styles.tabBody}>
      <View style={[styles.formCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <ThemedText style={styles.formTitle}>真实时薪</ThemedText>
        <Field label="税后月收入（元）" value={monthly} onChangeText={setMonthly} placeholder="待填写" />
        <Field label="月工作小时" value={hours} onChangeText={setHours} placeholder="待填写" keyboardType="numeric" />
        <Field label="直接时薪（元）" value={hourly} onChangeText={setHourly} placeholder="待填写" keyboardType="decimal-pad" />
        <ThemedText style={[styles.formHint, { color: colors.mutedText }]}>
          时薪 = 税后月收入 / 月工作小时。未填写时不计算等价工时，也不使用地区平均值。
        </ThemedText>
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={() =>
          void onSave({
            monthlySalaryCents: monthly ? parseYuanToCents(monthly) ?? 0 : 0,
            monthlyWorkHours: hours ? Number(hours) : 0,
            hourlyWageCents: hourly ? parseYuanToCents(hourly) ?? 0 : 0,
            wageSource: hourly ? 'hourly' : 'monthly',
            notifyBeforeHours: settings.notifyBeforeHours,
            notificationEnabled: settings.notificationEnabled,
          })
        }
        style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
        <MaterialCommunityIcons name="content-save" size={18} color="#ffffff" />
        <ThemedText style={styles.primaryButtonText}>保存时薪</ThemedText>
      </Pressable>

      <View style={[styles.dataCard, { backgroundColor: '#e4f7ee', borderColor: '#bfe9d1' }]}>
        <ThemedText style={[styles.dataTitle, { color: '#1c5b3c' }]}>
          <MaterialCommunityIcons name="shield-check" size={15} color="#1db991" /> 真实数据说明
        </ThemedText>
        <ThemedText style={[styles.dataText, { color: '#1c5b3c' }]}>
          无 mock、无种子数据、无第三方价格抓取。价格、时薪、答案和统计全部来自当前用户或系统时间。
        </ThemedText>
      </View>

      <View style={styles.actionRow}>
        <Pressable
          accessibilityRole="button"
          onPress={() => void onExport('csv')}
          style={({ pressed }) => [styles.outlineButton, { borderColor: colors.line }, pressed && styles.pressed]}>
          <MaterialCommunityIcons name="file-delimited-outline" size={17} color={colors.primary} />
          <ThemedText style={[styles.outlineButtonText, { color: colors.primary }]}>导出 CSV</ThemedText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => void onExport('json')}
          style={({ pressed }) => [styles.outlineButton, { borderColor: colors.line }, pressed && styles.pressed]}>
          <MaterialCommunityIcons name="code-json" size={17} color={colors.primary} />
          <ThemedText style={[styles.outlineButtonText, { color: colors.primary }]}>导出 JSON</ThemedText>
        </Pressable>
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={onClear}
        style={({ pressed }) => [styles.outlineButton, styles.dangerButton, pressed && styles.pressed]}>
        <MaterialCommunityIcons name="trash-can-outline" size={17} color="#d84b5c" />
        <ThemedText style={[styles.outlineButtonText, { color: '#d84b5c' }]}>清空全部数据</ThemedText>
      </Pressable>
    </View>
  );
}

function NewItemModal({
  visible,
  settings,
  colors,
  dark,
  onClose,
  onCreate,
}: {
  visible: boolean;
  settings: CoolingSettings;
  colors: ReturnType<typeof useAppTheme>['colors'];
  dark: boolean;
  onClose: () => void;
  onCreate: (input: CoolingItemInput) => Promise<void>;
}) {
  const [step, setStep] = useState<'basic' | 'questions'>('basic');
  const [name, setName] = useState('');
  const [priceText, setPriceText] = useState('');
  const [sourceType, setSourceType] = useState('manual');
  const [sourceText, setSourceText] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [answers, setAnswers] = useState<CoolingAnswers>({
    whyBuy: '',
    similarCount: '',
    usageFrequency: '',
    wantsAfter24h: '',
  });

  useEffect(() => {
    if (visible) {
      setStep('basic');
      setName('');
      setPriceText('');
      setSourceType('manual');
      setSourceText('');
      setSourceUrl('');
      setAnswers({ whyBuy: '', similarCount: '', usageFrequency: '', wantsAfter24h: '' });
    }
  }, [visible]);

  const priceCents = parseYuanToCents(priceText);
  const hourly = settings.effectiveHourlyWageCents;
  const equivalent = hourly && priceCents ? priceCents / hourly : null;
  const basicValid = name.trim().length > 0 && priceCents !== null;
  const questionsValid =
    answers.whyBuy !== '' &&
    answers.similarCount !== '' &&
    (answers.similarCount === 'none' || answers.similarInUse !== undefined) &&
    answers.usageFrequency !== '' &&
    answers.wantsAfter24h !== '';

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
        <View style={[styles.modalSheet, { backgroundColor: colors.background }]}>
          <View style={styles.modalHeader}>
            <ThemedText style={styles.modalTitle}>
              {step === 'basic' ? '新增冷静记录' : '五个问题'}
            </ThemedText>
            <Pressable accessibilityRole="button" onPress={onClose} style={styles.iconButton}>
              <MaterialCommunityIcons name="close" size={22} color={colors.text} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.modalBody}>
            {step === 'basic' ? (
              <>
                <Field label="商品名称 *" value={name} onChangeText={setName} placeholder="填写你想买的商品" />
                <Field
                  label="价格 *"
                  value={priceText}
                  onChangeText={setPriceText}
                  placeholder="0.00"
                  keyboardType="decimal-pad"
                />
                <ThemedText style={[styles.formHint, { color: colors.mutedText }]}>
                  价格由你填写，保存为整数分；系统不抓取第三方价格。
                </ThemedText>
                <View style={styles.choiceRow}>
                  {(
                    [
                      ['manual', '手动填写'],
                      ['screenshot', '订单截图'],
                      ['link', '商品链接'],
                    ] as const
                  ).map(([value, label]) => (
                    <ChoiceChip
                      key={value}
                      active={sourceType === value}
                      label={label}
                      color={colors.primary}
                      onPress={() => setSourceType(value)}
                    />
                  ))}
                </View>
                {sourceType === 'link' ? (
                  <Field label="商品链接（可选）" value={sourceUrl} onChangeText={setSourceUrl} placeholder="粘贴真实商品链接" />
                ) : (
                  <Field label="来源说明（可选）" value={sourceText} onChangeText={setSourceText} placeholder="例如：在哪个平台看到" />
                )}
                <Pressable
                  accessibilityRole="button"
                  disabled={!basicValid}
                  onPress={() => setStep('questions')}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    !basicValid && styles.disabledButton,
                    pressed && styles.pressed,
                  ]}>
                  <MaterialCommunityIcons name="arrow-right" size={18} color="#ffffff" />
                  <ThemedText style={styles.primaryButtonText}>下一步：回答五个问题</ThemedText>
                </Pressable>
              </>
            ) : (
              <>
                <QuestionBlock index={1} title="为什么想买" hint="选择最接近的真实原因" color={colors.primary}>
                  <View style={styles.choiceGrid}>
                    {WHY_BUY_OPTIONS.map((option) => (
                      <ChoiceChip
                        key={option.value}
                        active={answers.whyBuy === option.value}
                        label={option.label}
                        color={colors.primary}
                        onPress={() =>
                          setAnswers((prev) => ({ ...prev, whyBuy: option.value, otherReason: '' }))
                        }
                      />
                    ))}
                  </View>
                </QuestionBlock>
                {answers.whyBuy === 'other' ? (
                  <Field label="其他原因" value={answers.otherReason ?? ''} onChangeText={(text) => setAnswers((prev) => ({ ...prev, otherReason: text }))} placeholder="补充一句话" />
                ) : null}

                <QuestionBlock index={2} title="是否已有类似物品" hint="有的话，是否经常使用" color={colors.primary}>
                  <View style={styles.choiceGrid}>
                    {SIMILAR_OPTIONS.map((option) => (
                      <ChoiceChip
                        key={option.value}
                        active={answers.similarCount === option.value}
                        label={option.label}
                        color={colors.primary}
                        onPress={() => setAnswers((prev) => ({ ...prev, similarCount: option.value, similarInUse: undefined }))}
                      />
                    ))}
                  </View>
                  {answers.similarCount !== '' && answers.similarCount !== 'none' ? (
                    <View style={styles.choiceRow}>
                      {(
                        [
                          ['yes', '经常使用'],
                          ['no', '不经常使用'],
                        ] as const
                      ).map(([value, label]) => (
                        <ChoiceChip
                          key={value}
                          active={answers.similarInUse === value}
                          label={label}
                          color={colors.primary}
                          onPress={() => setAnswers((prev) => ({ ...prev, similarInUse: value }))}
                        />
                      ))}
                    </View>
                  ) : null}
                </QuestionBlock>

                <QuestionBlock index={3} title="预计使用频率" hint="按照真实生活场景判断" color={colors.primary}>
                  <View style={styles.choiceGrid}>
                    {USAGE_OPTIONS.map((option) => (
                      <ChoiceChip
                        key={option.value}
                        active={answers.usageFrequency === option.value}
                        label={option.label}
                        color={colors.primary}
                        onPress={() => setAnswers((prev) => ({ ...prev, usageFrequency: option.value }))}
                      />
                    ))}
                  </View>
                </QuestionBlock>

                <QuestionBlock index={4} title="相当于多少小时工资" hint="时薪未设置时显示待填写" color={colors.primary}>
                  <View style={[styles.calcPreview, { backgroundColor: colors.hero }]}>
                    <ThemedText style={styles.calcValue}>
                      {equivalent !== null ? `${formatHours(equivalent)} 小时` : '待填写'}
                    </ThemedText>
                    <ThemedText style={[styles.calcFormula, { color: 'rgba(255,255,255,0.72)' }]}>
                      {equivalent !== null
                        ? `${formatCents(priceCents ?? 0)} 元 / ${formatCents(hourly ?? 0)} 元/小时`
                        : '设置你的真实时薪后自动计算：价格 / 时薪'}
                    </ThemedText>
                  </View>
                </QuestionBlock>

                <QuestionBlock index={5} title="延迟 24 小时后是否还想买" hint="诚实回答即可" color={colors.primary}>
                  <View style={styles.choiceGrid}>
                    {WANTS_OPTIONS.map((option) => (
                      <ChoiceChip
                        key={option.value}
                        active={answers.wantsAfter24h === option.value}
                        label={option.label}
                        color={colors.primary}
                        onPress={() => setAnswers((prev) => ({ ...prev, wantsAfter24h: option.value }))}
                      />
                    ))}
                  </View>
                </QuestionBlock>

                <Pressable
                  accessibilityRole="button"
                  disabled={!questionsValid}
                  onPress={() =>
                    void onCreate({
                      name: name.trim(),
                      priceCents: priceCents ?? 0,
                      currency: 'CNY',
                      sourceType,
                      sourceText: sourceType === 'manual' ? sourceText : '',
                      sourceUrl: sourceType === 'link' ? sourceUrl : '',
                      answers,
                    })
                  }
                  style={({ pressed }) => [
                    styles.primaryButton,
                    !questionsValid && styles.disabledButton,
                    pressed && styles.pressed,
                  ]}>
                  <MaterialCommunityIcons name="timer-outline" size={18} color="#ffffff" />
                  <ThemedText style={styles.primaryButtonText}>开始 24 小时冷静</ThemedText>
                </Pressable>
              </>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function DetailModal({
  item,
  events,
  evidence,
  serverNow,
  colors,
  busy,
  onClose,
  onDecide,
  onExtend,
  onUndo,
  onDelete,
  onUpload,
}: {
  item: CoolingItem | null;
  events: CoolingEvent[];
  evidence: CoolingEvidence[];
  serverNow: string;
  colors: ReturnType<typeof useAppTheme>['colors'];
  busy: boolean;
  onClose: () => void;
  onDecide: (item: CoolingItem, action: 'buy' | 'drop') => void;
  onExtend: (item: CoolingItem) => void;
  onUndo: (item: CoolingItem) => void;
  onDelete: (item: CoolingItem) => void;
  onUpload: (item: CoolingItem) => Promise<void>;
}) {
  if (!item) return null;
  const risk = riskMeta(item.riskLevel);
  const status = statusMeta(item.status);
  return (
    <Modal visible={Boolean(item)} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalSheet, { backgroundColor: colors.background }]}>
          <View style={styles.modalHeader}>
            <ThemedText style={styles.modalTitle}>冷静详情</ThemedText>
            <View style={styles.modalActions}>
              <Pressable accessibilityRole="button" onPress={() => onUpload(item)} style={styles.iconButton}>
                <MaterialCommunityIcons name="image-plus" size={21} color={colors.text} />
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => onDelete(item)} style={styles.iconButton}>
                <MaterialCommunityIcons name="trash-can-outline" size={21} color={colors.text} />
              </Pressable>
              <Pressable accessibilityRole="button" onPress={onClose} style={styles.iconButton}>
                <MaterialCommunityIcons name="close" size={22} color={colors.text} />
              </Pressable>
            </View>
          </View>
          <ScrollView contentContainerStyle={styles.modalBody}>
            <View style={[styles.itemCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
              <View style={styles.itemMain}>
                <View style={styles.itemCopy}>
                  <ThemedText style={styles.itemName}>{item.name}</ThemedText>
                  <ThemedText style={[styles.itemMeta, { color: colors.mutedText }]}>
                    {sourceLabel(item.sourceType)} · {new Date(item.createdAt).toLocaleString()}
                  </ThemedText>
                </View>
                <ThemedText style={styles.itemPrice}>¥{formatCents(item.priceCents)}</ThemedText>
              </View>
              <View style={styles.tagRow}>
                <Tag color={status.color} icon={status.label === '冷静中' ? 'timer-outline' : 'check-circle-outline'} label={status.label} />
                <Tag color={risk.color} icon="alert-circle-outline" label={risk.label} />
                {item.evidenceCount > 0 ? (
                  <Tag color={colors.primary} icon="image-multiple-outline" label={`${item.evidenceCount} 张凭证`} />
                ) : null}
              </View>
            </View>

            {item.status === 'cooling' ? (
              <View style={[styles.timerCard, { backgroundColor: colors.hero }]}>
                <View style={styles.timerTop}>
                  <ThemedText style={[styles.timerLabel, { color: 'rgba(255,255,255,0.72)' }]}>真实服务端倒计时</ThemedText>
                  <Tag color="#c9f36a" icon="radio" label="进行中" />
                </View>
                <ThemedText style={styles.timerValue}>{remainingText(item, serverNow)}</ThemedText>
                <ThemedText style={[styles.timerMeta, { color: 'rgba(255,255,255,0.68)' }]}>
                  截止：{new Date(item.coolEndsAt).toLocaleString()}
                </ThemedText>
              </View>
            ) : null}
            {item.status === 'pending_decision' ? (
              <View style={[styles.decisionStage, { backgroundColor: '#ffe8eb', borderColor: '#f7c4cc' }]}>
                <MaterialCommunityIcons name="bell-ring" size={22} color="#ff5d6c" />
                <View style={styles.decisionStageCopy}>
                  <ThemedText style={[styles.decisionStageTitle, { color: '#8c3e47' }]}>24 小时冷静期已结束</ThemedText>
                  <ThemedText style={[styles.decisionStageText, { color: '#8c3e47' }]}>
                    只有你做出选择后，记录才会计入购买或已省金额。
                  </ThemedText>
                </View>
              </View>
            ) : null}

            {item.equivalentHours !== undefined ? (
              <View style={[styles.calcPreview, { backgroundColor: colors.hero }]}>
                <ThemedText style={styles.calcValue}>{formatHours(item.equivalentHours)} 小时</ThemedText>
                <ThemedText style={[styles.calcFormula, { color: 'rgba(255,255,255,0.72)' }]}>
                  {formatCents(item.priceCents)} 元 / {formatCents(item.hourlyWageCents)} 元/小时
                  {item.incomeRatioPercent !== undefined ? ` · 月收入占比 ${formatPercent(item.incomeRatioPercent)}` : ''}
                </ThemedText>
              </View>
            ) : null}

            <View style={[styles.answerCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
              <AnswerRow label="为什么想买" value={answerLabel(item.answers, 'whyBuy')} />
              <AnswerRow label="同类物品" value={answerLabel(item.answers, 'similarCount')} />
              <AnswerRow label="使用频率" value={answerLabel(item.answers, 'usageFrequency')} />
              <AnswerRow label="24 小时后" value={answerLabel(item.answers, 'wantsAfter24h')} />
            </View>

            {item.riskReasons.length > 0 ? (
              <View style={[styles.riskCard, { backgroundColor: '#fff2df', borderColor: '#f7e1bd' }]}>
                <ThemedText style={[styles.riskTitle, { color: '#9a6418' }]}>提示触发原因</ThemedText>
                {item.riskReasons.map((reason) => (
                  <ThemedText key={reason} style={[styles.riskReason, { color: '#9a6418' }]}>
                    · {reason}
                  </ThemedText>
                ))}
              </View>
            ) : null}

            {item.status === 'cooling' ? (
              <View style={styles.modalActionStack}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => onDecide(item, 'drop')}
                  disabled={busy}
                  style={({ pressed }) => [styles.outlineButton, { borderColor: colors.line }, pressed && styles.pressed]}>
                  <MaterialCommunityIcons name="close" size={17} color={colors.text} />
                  <ThemedText style={[styles.outlineButtonText, { color: colors.text }]}>现在放弃</ThemedText>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => onDecide(item, 'buy')}
                  disabled={busy}
                  style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
                  <MaterialCommunityIcons name="credit-card-outline" size={18} color="#ffffff" />
                  <ThemedText style={styles.primaryButtonText}>仍然现在买</ThemedText>
                </Pressable>
              </View>
            ) : null}
            {item.status === 'pending_decision' ? (
              <View style={styles.modalActionStack}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => onDecide(item, 'buy')}
                  disabled={busy}
                  style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
                  <MaterialCommunityIcons name="credit-card-outline" size={18} color="#ffffff" />
                  <ThemedText style={styles.primaryButtonText}>仍要买</ThemedText>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => onDecide(item, 'drop')}
                  disabled={busy}
                  style={({ pressed }) => [styles.greenButton, pressed && styles.pressed]}>
                  <MaterialCommunityIcons name="check" size={18} color="#ffffff" />
                  <ThemedText style={styles.primaryButtonText}>不买了</ThemedText>
                </Pressable>
                {item.extendCount < 3 ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => onExtend(item)}
                    disabled={busy}
                    style={({ pressed }) => [styles.outlineButton, { borderColor: colors.line }, pressed && styles.pressed]}>
                    <MaterialCommunityIcons name="restore" size={17} color={colors.text} />
                    <ThemedText style={[styles.outlineButtonText, { color: colors.text }]}>
                      再想想 24h（已延长 {item.extendCount}/3）
                    </ThemedText>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
            {item.status === 'bought' || item.status === 'dropped' ? (
              <View style={[styles.itemCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
                <ThemedText style={styles.formTitle}>
                  {item.status === 'bought' ? `最终成交 ¥${formatCents(item.finalPriceCents ?? item.priceCents)}` : '已放弃'}
                </ThemedText>
                {item.finalPurchaseAt ? (
                  <ThemedText style={[styles.formHint, { color: colors.mutedText }]}>购买日期：{item.finalPurchaseAt}</ThemedText>
                ) : null}
                {item.decidedAt && new Date().getTime() - new Date(item.decidedAt).getTime() < 5 * 60_000 ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => onUndo(item)}
                    disabled={busy}
                    style={({ pressed }) => [styles.outlineButton, { borderColor: colors.line }, pressed && styles.pressed]}>
                    <MaterialCommunityIcons name="undo" size={17} color={colors.text} />
                    <ThemedText style={[styles.outlineButtonText, { color: colors.text }]}>5 分钟内撤销</ThemedText>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            {events.length > 0 ? (
              <View style={styles.section}>
                <SectionTitle title="事件流" meta={`${events.length} 条`} />
                {events.map((event) => (
                  <View key={event.id} style={[styles.eventRow, { backgroundColor: colors.surface, borderColor: colors.line }]}>
                    <MaterialCommunityIcons name={eventIcon(event.action)} size={16} color={colors.primary} />
                    <View style={styles.eventCopy}>
                      <ThemedText style={styles.eventTitle}>{eventLabel(event.action)}</ThemedText>
                      {event.note ? <ThemedText style={[styles.eventMeta, { color: colors.mutedText }]}>{event.note}</ThemedText> : null}
                    </View>
                    <ThemedText style={[styles.eventTime, { color: colors.mutedText }]}>
                      {new Date(event.createdAt).toLocaleDateString()}
                    </ThemedText>
                  </View>
                ))}
              </View>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function DecisionModal({
  item,
  colors,
  onClose,
  onDecide,
}: {
  item: CoolingItem | null;
  colors: ReturnType<typeof useAppTheme>['colors'];
  onClose: () => void;
  onDecide: (item: CoolingItem, action: 'buy' | 'drop', finalPriceCents?: number) => Promise<void>;
}) {
  const [finalPrice, setFinalPrice] = useState('');
  useEffect(() => {
    if (item) setFinalPrice(formatCents(item.priceCents));
  }, [item]);
  if (!item) return null;
  const action = 'buy';
  const priceCents = parseYuanToCents(finalPrice) ?? item.priceCents;
  return (
    <Modal visible animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.confirmOverlay}>
        <View style={[styles.confirmCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <ThemedText style={styles.confirmTitle}>仍要买「{item.name}」？</ThemedText>
          <ThemedText style={[styles.confirmText, { color: colors.mutedText }]}>
            可以修改最终成交价；购买日期默认今天，保存后计入最终购买金额。
          </ThemedText>
          <Field label="最终成交价（元）" value={finalPrice} onChangeText={setFinalPrice} keyboardType="decimal-pad" />
          <View style={styles.confirmActions}>
            <Pressable accessibilityRole="button" onPress={onClose} style={[styles.outlineButton, { borderColor: colors.line }]}>
              <ThemedText style={[styles.outlineButtonText, { color: colors.text }]}>取消</ThemedText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => void onDecide(item, action, priceCents)}
              style={[styles.primaryButton, styles.confirmButton]}>
              <ThemedText style={styles.primaryButtonText}>确认仍要买</ThemedText>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function ItemRow({
  item,
  colors,
  onPress,
}: {
  item: CoolingItem;
  colors: ReturnType<typeof useAppTheme>['colors'];
  onPress: () => void;
}) {
  const status = statusMeta(item.status);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.itemRow,
        { backgroundColor: colors.surface, borderColor: colors.line },
        pressed && styles.pressed,
      ]}>
      <View style={[styles.itemRowIcon, { backgroundColor: `${status.color}18` }]}>
        <MaterialCommunityIcons name={item.status === 'cooling' ? 'timer-outline' : item.status === 'pending_decision' ? 'bell-ring-outline' : 'check-circle-outline'} size={19} color={status.color} />
      </View>
      <View style={styles.itemRowCopy}>
        <ThemedText style={styles.itemRowTitle}>{item.name}</ThemedText>
        <ThemedText style={[styles.itemRowMeta, { color: colors.mutedText }]}>
          {status.label}
          {item.status === 'cooling' ? ` · ${remainingText(item, new Date().toISOString())}` : ''}
        </ThemedText>
      </View>
      <ThemedText style={styles.itemRowPrice}>¥{formatCents(item.priceCents)}</ThemedText>
    </Pressable>
  );
}

function MetricCard({
  label,
  value,
  suffix,
  color,
}: {
  label: string;
  value: string;
  suffix?: string;
  color: string;
}) {
  return (
    <View style={[styles.metricCard, { backgroundColor: color === '#eef4ff' ? '#ffffff' : '#ffffff', borderColor: '#dce5f6' }]}>
      <ThemedText style={styles.metricLabel}>{label}</ThemedText>
      <View style={styles.metricValueRow}>
        <ThemedText style={[styles.metricValue, { color }]}>{value}</ThemedText>
        {suffix ? <ThemedText style={styles.metricSuffix}>{suffix}</ThemedText> : null}
      </View>
    </View>
  );
}

function SectionTitle({ title, meta }: { title: string; meta: string }) {
  return (
    <View style={styles.sectionTitle}>
      <ThemedText style={styles.sectionTitleText}>{title}</ThemedText>
      <ThemedText style={styles.sectionTitleMeta}>{meta}</ThemedText>
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'numeric' | 'decimal-pad';
}) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.field}>
      <ThemedText style={[styles.fieldLabel, { color: colors.mutedText }]}>{label}</ThemedText>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#9aa6bd"
        keyboardType={keyboardType}
        style={[styles.input, { backgroundColor: colors.surfaceMuted, borderColor: colors.line, color: colors.text }]}
      />
    </View>
  );
}

function ChoiceChip({
  active,
  label,
  color,
  onPress,
}: {
  active: boolean;
  label: string;
  color: string;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.choiceChip,
        {
          backgroundColor: active ? `${color}18` : colors.surfaceMuted,
          borderColor: active ? color : colors.line,
        },
        pressed && styles.pressed,
      ]}>
      <ThemedText style={[styles.choiceChipText, { color: active ? color : colors.mutedText }]}>{label}</ThemedText>
    </Pressable>
  );
}

function QuestionBlock({
  index,
  title,
  hint,
  color,
  children,
}: {
  index: number;
  title: string;
  hint: string;
  color: string;
  children: ReactNode;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.questionBlock, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <View style={styles.questionHead}>
        <View style={[styles.questionNum, { backgroundColor: `${color}18` }]}>
          <ThemedText style={[styles.questionNumText, { color }]}>{index}</ThemedText>
        </View>
        <View style={styles.questionCopy}>
          <ThemedText style={styles.questionTitle}>{title}</ThemedText>
          <ThemedText style={[styles.questionHint, { color: colors.mutedText }]}>{hint}</ThemedText>
        </View>
      </View>
      {children}
    </View>
  );
}

function AnswerRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.answerRow}>
      <ThemedText style={styles.answerLabel}>{label}</ThemedText>
      <ThemedText style={styles.answerValue}>{value}</ThemedText>
    </View>
  );
}

function Tag({
  color,
  icon,
  label,
}: {
  color: string;
  icon: IconName;
  label: string;
}) {
  return (
    <View style={[styles.tag, { backgroundColor: `${color}18`, borderColor: `${color}44` }]}>
      <MaterialCommunityIcons name={icon} size={11} color={color} />
      <ThemedText style={[styles.tagText, { color }]}>{label}</ThemedText>
    </View>
  );
}

function NoticeRow({
  color,
  background,
  border,
  icon,
  text,
}: {
  color: string;
  background: string;
  border: string;
  icon: IconName;
  text: string;
}) {
  return (
    <View style={[styles.noticeRow, { backgroundColor: background, borderColor: border }]}>
      <MaterialCommunityIcons name={icon} size={16} color={color} />
      <ThemedText style={[styles.noticeText, { color }]}>{text}</ThemedText>
    </View>
  );
}

function CenterState({
  icon,
  title,
  loading,
}: {
  icon: IconName;
  title: string;
  loading?: boolean;
}) {
  const { colors } = useAppTheme();
  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={styles.centerState}>
        {loading ? <ActivityIndicator color={colors.primary} /> : <MaterialCommunityIcons name={icon} size={34} color={colors.primary} />}
        <ThemedText style={styles.stateTitle}>{title}</ThemedText>
      </View>
    </SafeAreaView>
  );
}

async function scheduleCoolingNotification(item: CoolingItem, settings: CoolingSettings | null) {
  if (Platform.OS === 'web' || !settings?.notificationEnabled) return;
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.status !== 'granted') {
      const requested = await Notifications.requestPermissionsAsync();
      if (requested.status !== 'granted') return;
    }
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '冲动消费冷静器',
        body: `${item.name} 的 24 小时冷静期已结束，请回来做最终决定。`,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(item.coolEndsAt),
      },
    });
  } catch {
    // Web or an unsupported platform can still rely on the in-app pending section.
  }
}

function eventIcon(action: string): IconName {
  if (action === 'decided_drop' || action === 'dropped_early') return 'check-circle-outline';
  if (action === 'decided_buy' || action === 'bought_early') return 'credit-card-outline';
  if (action === 'extended') return 'restore';
  if (action === 'notified') return 'bell-ring-outline';
  if (action === 'undone') return 'undo';
  return 'circle-small';
}

function eventLabel(action: string): string {
  if (action === 'decided_drop' || action === 'dropped_early') return '不买了';
  if (action === 'decided_buy' || action === 'bought_early') return '仍要买';
  if (action === 'extended') return '再想想 24h';
  if (action === 'notified') return '冷静期结束提醒';
  if (action === 'undone') return '撤销决策';
  return '创建记录';
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
    height: 58,
    paddingHorizontal: 14,
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
    fontSize: 9,
    fontWeight: '700',
    marginTop: 2,
  },
  headerAdd: {
    height: 36,
    paddingHorizontal: 13,
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: 10,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  tabs: {
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    marginHorizontal: 14,
    padding: 4,
  },
  tabButton: {
    alignItems: 'center',
    borderRadius: 10,
    flex: 1,
    flexDirection: 'row',
    gap: 5,
    height: 36,
    justifyContent: 'center',
  },
  tabLabel: {
    fontSize: 12,
    fontWeight: '800',
  },
  content: {
    gap: 12,
    padding: 14,
    paddingBottom: 40,
  },
  tabBody: {
    gap: 12,
  },
  heroCard: {
    borderRadius: 16,
    padding: 16,
  },
  heroEyebrow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    marginBottom: 9,
  },
  heroEyebrowText: {
    color: '#c9f36a',
    fontSize: 10,
    fontWeight: '900',
  },
  heroTitle: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '900',
  },
  heroSubtitle: {
    fontSize: 11,
    lineHeight: 18,
    marginTop: 8,
  },
  metricGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  metricCard: {
    borderWidth: 1,
    borderRadius: 12,
    flex: 1,
    padding: 10,
  },
  metricLabel: {
    color: '#7483a2',
    fontSize: 9,
    fontWeight: '800',
    marginBottom: 6,
  },
  metricValueRow: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: 3,
  },
  metricValue: {
    fontFamily: 'Manrope',
    fontSize: 17,
    fontWeight: '800',
  },
  metricSuffix: {
    color: '#7483a2',
    fontSize: 9,
    fontWeight: '700',
  },
  section: {
    gap: 8,
  },
  sectionTitle: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sectionTitleText: {
    fontSize: 13,
    fontWeight: '900',
  },
  sectionTitleMeta: {
    color: '#7483a2',
    fontSize: 9,
    fontWeight: '800',
  },
  itemRow: {
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    flexDirection: 'row',
    gap: 10,
    padding: 12,
  },
  itemRowIcon: {
    alignItems: 'center',
    borderRadius: 9,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  itemRowCopy: {
    flex: 1,
    minWidth: 0,
  },
  itemRowTitle: {
    fontSize: 12,
    fontWeight: '900',
  },
  itemRowMeta: {
    fontSize: 9,
    fontWeight: '700',
    marginTop: 3,
  },
  itemRowPrice: {
    fontSize: 15,
    fontWeight: '800',
  },
  emptyState: {
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 14,
    padding: 20,
  },
  emptyIcon: {
    alignItems: 'center',
    borderRadius: 999,
    height: 50,
    justifyContent: 'center',
    marginBottom: 10,
    width: 50,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '900',
  },
  emptyText: {
    fontSize: 10,
    lineHeight: 16,
    marginTop: 5,
    textAlign: 'center',
  },
  emptyButton: {
    marginTop: 14,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#4b6bff',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 6,
    height: 44,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  greenButton: {
    alignItems: 'center',
    backgroundColor: '#1db991',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 6,
    height: 44,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '900',
  },
  outlineButton: {
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    flexDirection: 'row',
    gap: 6,
    height: 44,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  outlineButtonText: {
    fontSize: 12,
    fontWeight: '900',
  },
  disabledButton: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.75,
  },
  formCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
  formTitle: {
    fontSize: 13,
    fontWeight: '900',
    marginBottom: 10,
  },
  formHint: {
    fontSize: 9,
    lineHeight: 16,
    marginTop: 10,
  },
  field: {
    marginBottom: 10,
  },
  fieldLabel: {
    fontSize: 9,
    fontWeight: '800',
    marginBottom: 6,
  },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    fontSize: 12,
    fontWeight: '700',
    height: 40,
    paddingHorizontal: 12,
  },
  dataCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
  },
  dataTitle: {
    fontSize: 12,
    fontWeight: '900',
  },
  dataText: {
    fontSize: 9,
    lineHeight: 16,
    marginTop: 6,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  dangerButton: {
    marginTop: 8,
  },
  modalOverlay: {
    backgroundColor: 'rgba(9,17,38,0.42)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '92%',
    minHeight: '60%',
  },
  modalHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '900',
  },
  modalActions: {
    flexDirection: 'row',
  },
  modalBody: {
    gap: 12,
    padding: 16,
    paddingBottom: 40,
  },
  choiceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  choiceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  choiceChip: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    height: 34,
    justifyContent: 'center',
    minWidth: 72,
    paddingHorizontal: 12,
  },
  choiceChipText: {
    fontSize: 11,
    fontWeight: '800',
  },
  questionBlock: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 13,
  },
  questionHead: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 9,
  },
  questionNum: {
    alignItems: 'center',
    borderRadius: 8,
    height: 25,
    justifyContent: 'center',
    width: 25,
  },
  questionNumText: {
    fontSize: 10,
    fontWeight: '900',
  },
  questionCopy: {
    flex: 1,
  },
  questionTitle: {
    fontSize: 13,
    fontWeight: '900',
  },
  questionHint: {
    fontSize: 9,
    fontWeight: '700',
    marginTop: 2,
  },
  calcPreview: {
    borderRadius: 14,
    marginTop: 10,
    padding: 14,
  },
  calcValue: {
    color: '#ffffff',
    fontFamily: 'Manrope',
    fontSize: 28,
    fontWeight: '800',
  },
  calcFormula: {
    fontSize: 9,
    lineHeight: 16,
    marginTop: 8,
  },
  itemCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
  itemMain: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  itemCopy: {
    flex: 1,
    minWidth: 0,
  },
  itemName: {
    fontSize: 14,
    fontWeight: '900',
  },
  itemMeta: {
    fontSize: 9,
    fontWeight: '700',
    marginTop: 4,
  },
  itemPrice: {
    fontSize: 21,
    fontWeight: '800',
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
  },
  tag: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    height: 23,
    paddingHorizontal: 8,
  },
  tagText: {
    fontSize: 8,
    fontWeight: '900',
  },
  timerCard: {
    borderRadius: 14,
    padding: 14,
  },
  timerTop: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  timerLabel: {
    fontSize: 9,
    fontWeight: '800',
  },
  timerValue: {
    color: '#ffffff',
    fontFamily: 'Manrope',
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: 1,
  },
  timerMeta: {
    fontSize: 8,
    fontWeight: '700',
    marginTop: 8,
  },
  decisionStage: {
    alignItems: 'flex-start',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    padding: 13,
  },
  decisionStageCopy: {
    flex: 1,
  },
  decisionStageTitle: {
    fontSize: 12,
    fontWeight: '900',
  },
  decisionStageText: {
    fontSize: 9,
    lineHeight: 15,
    marginTop: 4,
  },
  answerCard: {
    borderWidth: 1,
    borderRadius: 14,
    overflow: 'hidden',
  },
  answerRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  answerLabel: {
    color: '#7483a2',
    fontSize: 9,
    fontWeight: '800',
  },
  answerValue: {
    fontSize: 10,
    fontWeight: '900',
    maxWidth: '62%',
    textAlign: 'right',
  },
  riskCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  riskTitle: {
    fontSize: 10,
    fontWeight: '900',
    marginBottom: 6,
  },
  riskReason: {
    fontSize: 9,
    lineHeight: 16,
  },
  modalActionStack: {
    gap: 8,
  },
  eventRow: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 9,
    padding: 10,
  },
  eventCopy: {
    flex: 1,
  },
  eventTitle: {
    fontSize: 10,
    fontWeight: '900',
  },
  eventMeta: {
    fontSize: 8,
    fontWeight: '700',
    marginTop: 2,
  },
  eventTime: {
    fontSize: 8,
    fontWeight: '700',
  },
  confirmOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(9,17,38,0.45)',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  confirmCard: {
    borderRadius: 18,
    borderWidth: 1,
    maxWidth: 420,
    padding: 18,
    width: '100%',
  },
  confirmTitle: {
    fontSize: 16,
    fontWeight: '900',
  },
  confirmText: {
    fontSize: 10,
    lineHeight: 17,
    marginBottom: 12,
    marginTop: 6,
  },
  confirmActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  confirmButton: {
    flex: 1,
  },
  chartCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
  chartBars: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: 3,
    height: 108,
    marginTop: 12,
  },
  chartBarWrap: {
    alignItems: 'center',
    flex: 1,
    height: '100%',
    justifyContent: 'flex-end',
  },
  chartBar: {
    borderRadius: 4,
    minHeight: 5,
    width: '78%',
  },
  chartBarDate: {
    fontSize: 6,
    fontWeight: '700',
    marginTop: 5,
  },
  noticeRow: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 7,
    padding: 10,
  },
  noticeText: {
    flex: 1,
    fontSize: 10,
    fontWeight: '800',
    lineHeight: 15,
  },
  loginState: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  stateIcon: {
    alignItems: 'center',
    borderRadius: 999,
    height: 64,
    justifyContent: 'center',
    marginBottom: 14,
    width: 64,
  },
  stateTitle: {
    fontSize: 18,
    fontWeight: '900',
  },
  stateText: {
    fontSize: 11,
    lineHeight: 18,
    marginBottom: 18,
    marginTop: 8,
    textAlign: 'center',
  },
  centerState: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
});
