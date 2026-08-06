import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/features/auth/auth-provider';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  addGoOutChecklistCompletion,
  applyGoOutChecklistTemplate,
  clearGoOutChecklistData,
  createGoOutChecklistItem,
  createGoOutChecklistScene,
  deleteGoOutChecklistCompletion,
  deleteGoOutChecklistItem,
  deleteGoOutChecklistScene,
  downloadGoOutChecklistExport,
  fetchGoOutChecklistHealth,
  fetchGoOutChecklistHistory,
  fetchGoOutChecklistHome,
  fetchGoOutChecklistSettings,
  fetchGoOutChecklistTemplates,
  fetchLocalGoOutWeather,
  getGoOutChecklistErrorMessage,
  saveGoOutChecklistSettings,
  searchGoOutChecklistCities,
  updateGoOutChecklistScene,
} from '@/lib/go-out-checklist-api';
import {
  buildLocalHomeItems,
  buildLocalWeatherSuggestions,
  completionResultText,
  emptyGoOutSettings,
  GO_OUT_TEMPLATES,
  formatGoOutDate,
  formatGoOutTime,
  groupHomeItems,
  localHistoryStats,
  resolveActiveScene,
  scheduleDaysLabel,
  scheduleLabel,
  weatherRuleLabel,
  weatherSourceText,
  weatherStatusLabel,
} from '@/lib/go-out-checklist';
import {
  clearGoOutLocalState,
  emptyGoOutLocalState,
  getGoOutLocalState,
  setGoOutLocalState,
} from '@/lib/go-out-checklist-storage';
import { MobileScreen } from '@/shared/ui/mobile-screen';
import { PageHeader } from '@/shared/ui/page-header';
import { PageLoadingFrame } from '@/shared/ui/page-loading-frame';
import { SurfaceCard } from '@/shared/ui/surface-card';
import type {
  GoOutCity,
  GoOutCompletion,
  GoOutConfirmedItem,
  GoOutHomeItem,
  GoOutHomeResponse,
  GoOutItem,
  GoOutItemType,
  GoOutLocalState,
  GoOutSchedule,
  GoOutSettingsPayload,
  GoOutTemplate,
  GoOutWeatherSnapshot,
} from '@/types/go-out-checklist';

type Tab = 'check' | 'scenes' | 'weather' | 'reminder' | 'history';

const tabs: { id: Tab; label: string; icon: string }[] = [
  { id: 'check', label: '检查', icon: 'clipboard-check-outline' },
  { id: 'scenes', label: '场景', icon: 'briefcase-outline' },
  { id: 'weather', label: '天气', icon: 'weather-partly-cloudy' },
  { id: 'reminder', label: '提醒', icon: 'bell-outline' },
  { id: 'history', label: '历史', icon: 'history' },
];

export function GoOutChecklistScreen() {
  const router = useRouter();
  const { accessToken: token, status: authStatus } = useAuth();
  const { colors } = useAppTheme();
  const [activeTab, setActiveTab] = useState<Tab>('check');
  const [localState, setLocalState] = useState<GoOutLocalState>(emptyGoOutLocalState());
  const [home, setHome] = useState<GoOutHomeResponse | null>(null);
  const [templates, setTemplates] = useState<GoOutTemplate[]>([]);
  const [settingsPayload, setSettingsPayload] = useState<GoOutSettingsPayload>({
    settings: emptyGoOutSettings(),
    schedules: [],
  });
  const [history, setHistory] = useState<GoOutCompletion[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [completed, setCompleted] = useState<GoOutCompletion | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [cityQuery, setCityQuery] = useState('');
  const [cityResults, setCityResults] = useState<GoOutCity[]>([]);
  const [health, setHealth] = useState<{ status: string; sources: { source: string; status: string }[] }>({
    status: 'unknown',
    sources: [],
  });
  const requestRef = useRef(0);

  const activeSceneId = home?.activeSceneId || resolveActiveScene(
    localState.scenes,
    localState.schedules,
    localState.settings.activeSceneId,
  );

  const loadLocal = useCallback(async () => {
    const state = await getGoOutLocalState();
    setLocalState(state);
    return state;
  }, []);

  const mergeRemoteIntoLocal = useCallback(
    (nextHome: GoOutHomeResponse, payload: GoOutSettingsPayload, records: GoOutCompletion[]) => {
      const next: GoOutLocalState = {
        schemaVersion: 1,
        items: nextHome.items.map(({ group: _group, sceneId: _sceneId, weatherRuleId: _weatherRuleId, weatherReason: _weatherReason, ...item }) => item),
        scenes: nextHome.scenes,
        sceneItems: nextHome.sceneItems,
        schedules: payload.schedules,
        settings: payload.settings,
        completions: records,
        updatedAt: nextHome.updatedAt,
      };
      setLocalState(next);
      void setGoOutLocalState(next);
      return next;
    },
    [],
  );

  const refreshAll = useCallback(
    async (sceneId?: string) => {
      const requestID = ++requestRef.current;
      setLoading(true);
      setError(null);
      try {
        if (!token) {
          const local = await loadLocal();
          const weather = local.settings.weatherEnabled
            ? await fetchLocalGoOutWeather(local.settings)
            : unavailableWeather('天气联动未开启');
          const activeId = resolveActiveScene(
            local.scenes,
            local.schedules,
            local.settings.activeSceneId,
          );
          const items = buildLocalHomeItems(local, activeId, weather);
          const nextHome: GoOutHomeResponse = {
            items,
            scenes: local.scenes,
            sceneItems: local.sceneItems,
            schedules: local.schedules,
            activeSceneId: activeId,
            weather,
            weatherSuggestions: buildLocalWeatherSuggestions(local.items, weather),
            settings: local.settings,
            serverNow: new Date().toISOString(),
            updatedAt: local.updatedAt,
          };
          if (requestID !== requestRef.current) return;
          setHome(nextHome);
          setTemplates(GO_OUT_TEMPLATES);
          setSettingsPayload({ settings: local.settings, schedules: local.schedules });
          setHistory(local.completions);
          setLoading(false);
          return;
        }
        const [settingsData, historyData, templateData, homeData] = await Promise.all([
          fetchGoOutChecklistSettings(token),
          fetchGoOutChecklistHistory(token),
          fetchGoOutChecklistTemplates(token),
          fetchGoOutChecklistHome(token, sceneId),
        ]);
        if (requestID !== requestRef.current) return;
        setSettingsPayload(settingsData);
        setHistory(historyData.records);
        setTemplates(templateData);
        setHome(homeData);
        mergeRemoteIntoLocal(homeData, settingsData, historyData.records);
        setHealth(await fetchGoOutChecklistHealth(token).catch(() => ({ status: 'unknown', sources: [] })));
        setLoading(false);
      } catch (nextError) {
        if (requestID !== requestRef.current) return;
        setError(getGoOutChecklistErrorMessage(nextError));
        setLoading(false);
      }
    },
    [loadLocal, mergeRemoteIntoLocal, token],
  );

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    if (home) {
      setSelected(Object.fromEntries(home.items.map((item) => [item.id, false])));
    }
  }, [home?.activeSceneId]);

  async function runMutation(action: () => Promise<unknown>, success?: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      if (success) setMessage(success);
      await refreshAll(home?.activeSceneId);
    } catch (nextError) {
      setError(getGoOutChecklistErrorMessage(nextError));
    } finally {
      setBusy(false);
    }
  }

  async function handleApplyTemplate(template: GoOutTemplate) {
    if (!token) {
      const next = applyLocalTemplate(localState, template);
      setLocalState(next);
      await setGoOutLocalState(next);
      await refreshAll();
      setMessage(`已创建 ${template.name}`);
      return;
    }
    await runMutation(
      () => applyGoOutChecklistTemplate(token, template.id),
      `已创建 ${template.name}`,
    );
  }

  async function handleToggleItem(item: GoOutHomeItem) {
    const next = { ...selected, [item.id]: !selected[item.id] };
    setSelected(next);
    setCompleted(null);
  }

  async function handleConfirmAll() {
    if (!home) return;
    const allItems = home.items;
    const missing = allItems.filter((item) => !selected[item.id]);
    if (missing.length > 0) {
      setError(`还有 ${missing.length} 项未确认`);
      return;
    }
    const confirmedItems: GoOutConfirmedItem[] = allItems.map((item) => ({
      id: item.id,
      name: item.name,
      weather: item.group === 'weather',
      reason: item.weatherReason,
    }));
    if (!token) {
      const completion: GoOutCompletion = {
        id: `local-${Date.now()}`,
        sceneId: home.activeSceneId,
        sceneName: home.activeScene?.name || '未设置场景',
        checkedAt: new Date().toISOString(),
        confirmedItems,
        weather: home.weather,
        resultText: completionResultText(),
      };
      const next = {
        ...localState,
        completions: [completion, ...localState.completions].slice(0, 200),
        updatedAt: Date.now(),
      };
      setLocalState(next);
      await setGoOutLocalState(next);
      setCompleted(completion);
      setHistory(next.completions);
      return;
    }
    await runMutation(async () => {
      const created = await addGoOutChecklistCompletion(token, {
        sceneId: home.activeSceneId,
        confirmedItems,
      });
      setCompleted(created);
    }, '今日出门检查完成，没有遗漏。');
  }

  async function handleAddItem(safety = false) {
    const name = promptText(safety ? '添加安全确认项名称' : '添加检查项名称');
    if (!name) return;
    const itemType: GoOutItemType = safety ? 'safety' : 'item';
    const action = () =>
      token
        ? createGoOutChecklistItem(token, {
            name,
            icon: safety ? 'shield-check' : 'package-variant',
            itemType,
          })
        : Promise.resolve(null);
    if (!token) {
      const newItem: GoOutItem = {
        id: `local-item-${Date.now()}`,
        name,
        icon: safety ? 'shield-check' : 'package-variant',
        itemType,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const next: GoOutLocalState = {
        ...localState,
        items: [...localState.items, newItem],
        updatedAt: Date.now(),
      };
      setLocalState(next);
      await setGoOutLocalState(next);
      await refreshAll();
      return;
    }
    await runMutation(action, '检查项已添加');
  }

  async function handleCreateScene() {
    const name = promptText('新建场景名称');
    if (!name) return;
    const action = () =>
      token
        ? createGoOutChecklistScene(token, {
            name,
            icon: 'briefcase',
            sortOrder: localState.scenes.length,
          })
        : Promise.resolve(null);
    if (!token) {
      const sceneId = `local-scene-${Date.now()}`;
      const next: GoOutLocalState = {
        ...localState,
        scenes: [
          ...localState.scenes,
          {
            id: sceneId,
            userId: '',
            name,
            icon: 'briefcase',
            sortOrder: localState.scenes.length,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ],
        settings: { ...localState.settings, activeSceneId: sceneId, updatedAt: Date.now() },
        updatedAt: Date.now(),
      };
      setLocalState(next);
      await setGoOutLocalState(next);
      await refreshAll();
      return;
    }
    await runMutation(action, '场景已创建');
  }

  async function handleSelectScene(sceneId: string) {
    if (token) {
      await refreshAll(sceneId);
      return;
    }
    const next = {
      ...localState,
      settings: { ...localState.settings, activeSceneId: sceneId, updatedAt: Date.now() },
      updatedAt: Date.now(),
    };
    setLocalState(next);
    await setGoOutLocalState(next);
    await refreshAll(sceneId);
  }

  async function handleToggleSceneItem(item: GoOutHomeItem) {
    if (!home || !home.activeSceneId) return;
    const linked = home.sceneItems
      .filter((link) => link.sceneId === home.activeSceneId)
      .map((link) => link.itemId);
    const nextItemIds = linked.includes(item.id)
      ? linked.filter((id) => id !== item.id)
      : [...linked, item.id];
    if (token) {
      await runMutation(() =>
        updateGoOutChecklistScene(token, home.activeSceneId, {
          name: home.activeScene?.name || '自定义场景',
          icon: home.activeScene?.icon || 'briefcase',
          sortOrder: home.activeScene?.sortOrder || 0,
          itemIds: nextItemIds,
        }),
      );
      return;
    }
    const next = {
      ...localState,
      sceneItems: [
        ...localState.sceneItems.filter(
          (link) => link.sceneId !== home.activeSceneId || link.itemId !== item.id,
        ),
        ...(linked.includes(item.id) ? [] : [{ sceneId: home.activeSceneId, itemId: item.id, position: linked.length }]),
      ],
      updatedAt: Date.now(),
    };
    setLocalState(next);
    await setGoOutLocalState(next);
    await refreshAll();
  }

  async function handleSaveWeatherSettings() {
    const settings = settingsPayload.settings;
    if (!settings.city || !settings.lat || !settings.lon) {
      setError('请先选择城市');
      return;
    }
    const nextPayload = {
      ...settingsPayload,
      settings: { ...settings, weatherEnabled: true, updatedAt: Date.now() },
    };
    setSettingsPayload(nextPayload);
    if (token) {
      await runMutation(() => saveGoOutChecklistSettings(token, nextPayload), '天气联动已开启');
      return;
    }
    const next = {
      ...localState,
      settings: nextPayload.settings,
      schedules: nextPayload.schedules,
      updatedAt: Date.now(),
    };
    setLocalState(next);
    await setGoOutLocalState(next);
    await refreshAll();
  }

  async function handleSearchCities() {
    const query = cityQuery.trim();
    if (!query) return;
    setBusy(true);
    setMessage(null);
    try {
      const results = token
        ? await searchGoOutChecklistCities(token, query)
        : await searchLocalCities(query);
      setCityResults(results);
      if (results.length === 0) setMessage('没有找到这个城市，请换一个关键词。');
    } catch (nextError) {
      setError(getGoOutChecklistErrorMessage(nextError));
    } finally {
      setBusy(false);
    }
  }

  async function handleSelectCity(city: GoOutCity) {
    const nextPayload = {
      ...settingsPayload,
      settings: {
        ...settingsPayload.settings,
        city: city.admin1 ? `${city.admin1} ${city.name}` : city.name,
        lat: city.lat,
        lon: city.lon,
        timezone: settingsPayload.settings.timezone || 'Asia/Shanghai',
        updatedAt: Date.now(),
      },
    };
    setSettingsPayload(nextPayload);
    setCityQuery('');
    setCityResults([]);
    if (token) {
      await runMutation(() => saveGoOutChecklistSettings(token, nextPayload), '城市已保存');
      return;
    }
    const next = {
      ...localState,
      settings: nextPayload.settings,
      schedules: nextPayload.schedules,
      updatedAt: Date.now(),
    };
    setLocalState(next);
    await setGoOutLocalState(next);
    await refreshAll();
  }

  async function handleAddSchedule() {
    if (!activeSceneId) {
      setError('请先创建一个场景');
      return;
    }
    const time = promptText('提醒时间，例如 08:20');
    if (!time) return;
    const schedule: GoOutSchedule = {
      id: token ? '' : `local-schedule-${Date.now()}`,
      sceneId: activeSceneId,
      daysOfWeek: [1, 2, 3, 4, 5],
      time,
      enabled: true,
    };
    const nextPayload = {
      ...settingsPayload,
      schedules: [...settingsPayload.schedules.filter((item) => item.sceneId !== activeSceneId), schedule],
    };
    setSettingsPayload(nextPayload);
    if (token) {
      await runMutation(() => saveGoOutChecklistSettings(token, nextPayload), '定时切换已保存');
      return;
    }
    const next = {
      ...localState,
      settings: nextPayload.settings,
      schedules: nextPayload.schedules,
      updatedAt: Date.now(),
    };
    setLocalState(next);
    await setGoOutLocalState(next);
    await refreshAll();
  }

  async function handleToggleSchedule(schedule: GoOutSchedule) {
    const nextPayload = {
      ...settingsPayload,
      schedules: settingsPayload.schedules.map((item) =>
        item.id === schedule.id ? { ...item, enabled: !item.enabled } : item,
      ),
    };
    setSettingsPayload(nextPayload);
    if (token) {
      await runMutation(() => saveGoOutChecklistSettings(token, nextPayload));
      return;
    }
    const next = {
      ...localState,
      settings: nextPayload.settings,
      schedules: nextPayload.schedules,
      updatedAt: Date.now(),
    };
    setLocalState(next);
    await setGoOutLocalState(next);
    await refreshAll();
  }

  async function handleDeleteCompletion(id: string) {
    if (!confirmAction('删除这条完成记录？')) return;
    await runMutation(() =>
      token ? deleteGoOutChecklistCompletion(token, id) : Promise.resolve(null),
    );
    if (!token) {
      const next = {
        ...localState,
        completions: localState.completions.filter((item) => item.id !== id),
        updatedAt: Date.now(),
      };
      setLocalState(next);
      await setGoOutLocalState(next);
      setHistory(next.completions);
    }
  }

  async function handleClearData() {
    if (!confirmAction('清空全部出门检查数据？此操作不可撤销。')) return;
    if (token) {
      await runMutation(() => clearGoOutChecklistData(token), '数据已清空');
      return;
    }
    await clearGoOutLocalState();
    setLocalState(emptyGoOutLocalState());
    setHistory([]);
    await refreshAll();
  }

  const grouped = useMemo(() => groupHomeItems(home?.items ?? []), [home?.items]);
  const confirmedCount = home?.items.filter((item) => selected[item.id]).length ?? 0;

  if (authStatus === 'loading') {
    return <PageLoadingFrame title="出门检查清单" variant="workbench" />;
  }

  return (
    <MobileScreen scrollContentStyle={styles.pageContent}>
      <PageHeader
        title="出门检查清单"
        subtitle="出门前一键确认，真实天气自动补充"
        eyebrow="FunBox Tools"
        rightSlot={
          <View style={styles.headerActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="刷新"
              onPress={() => void refreshAll()}
              style={[styles.iconButton, { backgroundColor: colors.surface, borderColor: colors.line }]}>
              <MaterialCommunityIcons name="refresh" size={18} color={colors.primary} />
            </Pressable>
            {!token ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/auth')}
                style={[styles.iconButton, { backgroundColor: colors.hero, borderColor: colors.hero }]}>
                <MaterialCommunityIcons name="login" size={18} color="#c9f36a" />
              </Pressable>
            ) : null}
          </View>
        }
      />

      <View style={[styles.tabs, { backgroundColor: colors.surfaceMuted, borderColor: colors.line }]}>
        {tabs.map((tab) => (
          <Pressable
            key={tab.id}
            accessibilityRole="button"
            onPress={() => setActiveTab(tab.id)}
            style={[styles.tabButton, activeTab === tab.id && { backgroundColor: colors.surface }]}>
            <MaterialCommunityIcons
              name={tab.icon as never}
              size={16}
              color={activeTab === tab.id ? colors.primary : colors.mutedText}
            />
            <ThemedText
              style={[styles.tabLabel, { color: activeTab === tab.id ? colors.text : colors.mutedText }]}>
              {tab.label}
            </ThemedText>
          </Pressable>
        ))}
      </View>

      {message ? (
        <View style={[styles.banner, { backgroundColor: colors.success + '18' }]}>
          <MaterialCommunityIcons name="check-circle-outline" size={15} color={colors.success} />
          <ThemedText style={[styles.bannerText, { color: colors.success }]}>{message}</ThemedText>
        </View>
      ) : null}
      {error ? (
        <View style={[styles.banner, { backgroundColor: colors.accent + '18' }]}>
          <MaterialCommunityIcons name="alert-circle-outline" size={15} color={colors.accent} />
          <ThemedText style={[styles.bannerText, { color: colors.accent }]}>{error}</ThemedText>
        </View>
      ) : null}

      {loading ? (
        <SurfaceCard style={styles.loadingCard}>
          <ActivityIndicator color={colors.primary} />
          <ThemedText style={[styles.loadingText, { color: colors.mutedText }]}>
            正在读取真实数据
          </ThemedText>
        </SurfaceCard>
      ) : activeTab === 'check' ? (
        <CheckTab
          home={home}
          grouped={grouped}
          selected={selected}
          confirmedCount={confirmedCount}
          completed={completed}
          colors={colors}
          busy={busy}
          onSelectScene={(sceneId) => void handleSelectScene(sceneId)}
          onToggleItem={(item) => void handleToggleItem(item)}
          onConfirmAll={() => void handleConfirmAll()}
          onAddSafety={() => void handleAddItem(true)}
        />
      ) : activeTab === 'scenes' ? (
        <ScenesTab
          home={home}
          templates={templates}
          colors={colors}
          busy={busy}
          onApplyTemplate={(template) => void handleApplyTemplate(template)}
          onCreateScene={() => void handleCreateScene()}
          onSelectScene={(sceneId) => void handleSelectScene(sceneId)}
          onAddItem={() => void handleAddItem(false)}
          onAddSafety={() => void handleAddItem(true)}
          onToggleSceneItem={(item) => void handleToggleSceneItem(item)}
        />
      ) : activeTab === 'weather' ? (
        <WeatherTab
          payload={settingsPayload}
          health={health}
          cityQuery={cityQuery}
          cityResults={cityResults}
          colors={colors}
          busy={busy}
          onCityQuery={setCityQuery}
          onSearch={() => void handleSearchCities()}
          onSelectCity={(city) => void handleSelectCity(city)}
          onSave={() => void handleSaveWeatherSettings()}
        />
      ) : activeTab === 'reminder' ? (
        <ReminderTab
          payload={settingsPayload}
          activeSceneId={activeSceneId}
          colors={colors}
          onAddSchedule={() => void handleAddSchedule()}
          onToggleSchedule={(schedule) => void handleToggleSchedule(schedule)}
        />
      ) : (
        <HistoryTab
          records={history}
          colors={colors}
          busy={busy}
          onDelete={(id) => void handleDeleteCompletion(id)}
          onExport={(format) => {
            if (token) void downloadGoOutChecklistExport(token, format);
          }}
          onClear={() => void handleClearData()}
        />
      )}
    </MobileScreen>
  );
}

function CheckTab({
  home,
  grouped,
  selected,
  confirmedCount,
  completed,
  colors,
  busy,
  onSelectScene,
  onToggleItem,
  onConfirmAll,
  onAddSafety,
}: {
  home: GoOutHomeResponse | null;
  grouped: ReturnType<typeof groupHomeItems>;
  selected: Record<string, boolean>;
  confirmedCount: number;
  completed: GoOutCompletion | null;
  colors: any;
  busy: boolean;
  onSelectScene: (sceneId: string) => void;
  onToggleItem: (item: GoOutHomeItem) => void;
  onConfirmAll: () => void;
  onAddSafety: () => void;
}) {
  if (completed) {
    return (
      <SurfaceCard style={styles.completedCard}>
        <View style={[styles.completedIcon, { backgroundColor: colors.success + '20' }]}>
          <MaterialCommunityIcons name="check-decagram" size={34} color={colors.success} />
        </View>
        <ThemedText style={styles.completedTitle}>{completed.resultText}</ThemedText>
        <ThemedText style={[styles.completedMeta, { color: colors.mutedText }]}>
          {formatGoOutDate(completed.checkedAt)} · {completed.sceneName} ·{' '}
          {completed.confirmedItems.length}/{home?.items.length ?? completed.confirmedItems.length} 已确认
        </ThemedText>
        {completed.weather.available ? (
          <View style={[styles.weatherNote, { backgroundColor: colors.accent + '18' }]}>
            <MaterialCommunityIcons name="umbrella" size={14} color={colors.accent} />
            <ThemedText style={[styles.weatherNoteText, { color: colors.accent }]}>
              天气补充 {completed.weather.ruleHits?.length ?? 1} 项 · {weatherSourceText(completed.weather)}
            </ThemedText>
          </View>
        ) : null}
      </SurfaceCard>
    );
  }
  if (!home) {
    return (
      <SurfaceCard style={styles.emptyCard}>
        <MaterialCommunityIcons name="clipboard-alert-outline" size={34} color={colors.mutedText} />
        <ThemedText style={styles.emptyTitle}>先创建场景和检查项</ThemedText>
        <ThemedText style={[styles.emptyBody, { color: colors.mutedText }]}>
          首次进入没有预置数据，请从模板创建或添加自己的检查项。
        </ThemedText>
      </SurfaceCard>
    );
  }
  const allCount = home.items.length;
  return (
    <>
      <SurfaceCard style={styles.weatherCard}>
        <View style={styles.weatherTop}>
          <View>
            <ThemedText style={styles.weatherTemp}>
              {home.weather.available ? `${Math.round(home.weather.temperature ?? 0)}°C` : '--'}
            </ThemedText>
            <ThemedText style={[styles.weatherDesc, { color: colors.mutedText }]}>
              {home.weather.available
                ? `降雨 ${Math.round(home.weather.precipProb ?? 0)}% · UV ${home.weather.uvIndex ?? '-'} · AQI ${home.weather.aqi ?? '-'}`
                : home.weather.unavailableMsg || '天气暂未获取'}
            </ThemedText>
          </View>
          <View style={[styles.statusPill, { backgroundColor: colors.success + '18' }]}>
            <MaterialCommunityIcons name="check-decagram" size={12} color={colors.success} />
            <ThemedText style={[styles.statusPillText, { color: colors.success }]}>
              {weatherStatusLabel(home.weather)}
            </ThemedText>
          </View>
        </View>
        {home.weather.available ? (
          <ThemedText style={[styles.sourceText, { color: colors.mutedText }]}>
            {weatherSourceText(home.weather)}
          </ThemedText>
        ) : null}
      </SurfaceCard>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.sceneScroller}>
        {home.scenes.map((scene) => (
          <Pressable
            key={scene.id}
            onPress={() => onSelectScene(scene.id)}
            style={[
              styles.sceneChip,
              {
                backgroundColor: home.activeSceneId === scene.id ? colors.hero : colors.surface,
                borderColor: home.activeSceneId === scene.id ? colors.hero : colors.line,
              },
            ]}>
            <MaterialCommunityIcons
              name={scene.icon as never}
              size={13}
              color={home.activeSceneId === scene.id ? '#c9f36a' : colors.primary}
            />
            <ThemedText
              style={[
                styles.sceneChipText,
                { color: home.activeSceneId === scene.id ? '#c9f36a' : colors.text },
              ]}>
              {scene.name}
            </ThemedText>
          </Pressable>
        ))}
        {home.scenes.length === 0 ? (
          <View style={[styles.sceneChip, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <ThemedText style={[styles.sceneChipText, { color: colors.mutedText }]}>暂无场景</ThemedText>
          </View>
        ) : null}
      </ScrollView>

      {renderGroup('常备物品', grouped.essential, selected, colors, onToggleItem)}
      {renderGroup('当前场景', grouped.scene, selected, colors, onToggleItem)}
      {home.weatherSuggestions.length > 0 ? (
        <SurfaceCard style={styles.suggestionCard}>
          <ThemedText style={styles.suggestionTitle}>天气建议</ThemedText>
          {home.weatherSuggestions.map((suggestion) => (
            <ThemedText key={suggestion.ruleId} style={[styles.suggestionText, { color: colors.mutedText }]}>
              {suggestion.name}：{suggestion.reason}
            </ThemedText>
          ))}
        </SurfaceCard>
      ) : null}
      {renderGroup('天气补充', grouped.weather, selected, colors, onToggleItem)}
      {renderGroup('离家安全', grouped.safety, selected, colors, onToggleItem, true)}

      <Pressable
        accessibilityRole="button"
        onPress={onAddSafety}
        style={[styles.addSafetyButton, { borderColor: colors.line }]}>
        <MaterialCommunityIcons name="shield-plus-outline" size={15} color={colors.primary} />
        <ThemedText style={[styles.addSafetyText, { color: colors.primary }]}>添加安全确认项</ThemedText>
      </Pressable>

      <SurfaceCard style={styles.confirmBar}>
        <View style={styles.confirmCopy}>
          <ThemedText style={styles.confirmTitle}>全部确认后生成完成反馈</ThemedText>
          <ThemedText style={[styles.confirmMeta, { color: colors.mutedText }]}>
            {confirmedCount} / {allCount} 已确认
          </ThemedText>
        </View>
        <Pressable
          accessibilityRole="button"
          disabled={busy || confirmedCount !== allCount}
          onPress={onConfirmAll}
          style={[styles.confirmButton, { backgroundColor: colors.hero, opacity: busy || confirmedCount !== allCount ? 0.45 : 1 }]}>
          <MaterialCommunityIcons name="check-all" size={16} color="#c9f36a" />
          <ThemedText style={styles.confirmButtonText}>确认全部已带</ThemedText>
        </Pressable>
      </SurfaceCard>
    </>
  );
}

function renderGroup(
  title: string,
  items: GoOutHomeItem[],
  selected: Record<string, boolean>,
  colors: any,
  onToggleItem: (item: GoOutHomeItem) => void,
  safety = false,
) {
  if (items.length === 0) return null;
  return (
    <View style={styles.group}>
      <View style={styles.groupHead}>
        <ThemedText style={styles.groupTitle}>{title}</ThemedText>
        <ThemedText style={[styles.groupCount, { color: colors.mutedText }]}>{items.length}</ThemedText>
      </View>
      {items.map((item) => (
        <Pressable
          key={item.id}
          onPress={() => onToggleItem(item)}
          style={[
            styles.checkRow,
            {
              backgroundColor: safety ? colors.accent + '10' : colors.surface,
              borderColor: safety ? colors.accent + '35' : colors.line,
            },
          ]}>
          <View style={[styles.checkIcon, { backgroundColor: colors.surfaceMuted }]}>
            <MaterialCommunityIcons
              name={(item.icon || 'package-variant') as never}
              size={16}
              color={safety ? colors.accent : colors.primary}
            />
          </View>
          <View style={styles.checkCopy}>
            <ThemedText style={styles.checkName}>{item.name}</ThemedText>
            <ThemedText style={[styles.checkReason, { color: colors.mutedText }]}>
              {item.weatherReason || (item.group === 'weather' ? weatherRuleLabel(item.weatherRuleId) : safety ? '安全确认项' : '真实检查项')}
            </ThemedText>
          </View>
          <View
            style={[
              styles.checkBox,
              {
                backgroundColor: selected[item.id] ? colors.success : colors.surface,
                borderColor: selected[item.id] ? colors.success : colors.line,
              },
            ]}>
            {selected[item.id] ? (
              <MaterialCommunityIcons name="check" size={13} color="#ffffff" />
            ) : null}
          </View>
        </Pressable>
      ))}
    </View>
  );
}

function ScenesTab({
  home,
  templates,
  colors,
  busy,
  onApplyTemplate,
  onCreateScene,
  onSelectScene,
  onAddItem,
  onAddSafety,
  onToggleSceneItem,
}: {
  home: GoOutHomeResponse | null;
  templates: GoOutTemplate[];
  colors: any;
  busy: boolean;
  onApplyTemplate: (template: GoOutTemplate) => void;
  onCreateScene: () => void;
  onSelectScene: (sceneId: string) => void;
  onAddItem: () => void;
  onAddSafety: () => void;
  onToggleSceneItem: (item: GoOutHomeItem) => void;
}) {
  const sceneItems = home?.items.filter((item) => item.group === 'scene') ?? [];
  const otherItems = home?.items.filter((item) => item.group !== 'safety' && item.group !== 'scene') ?? [];
  return (
    <>
      <View style={styles.sectionHead}>
        <ThemedText style={styles.sectionTitle}>模板库</ThemedText>
        <Pressable onPress={onCreateScene} style={[styles.smallButton, { backgroundColor: colors.hero }]}>
          <MaterialCommunityIcons name="plus" size={14} color="#c9f36a" />
          <ThemedText style={styles.smallButtonText}>新建场景</ThemedText>
        </Pressable>
      </View>
      {templates.map((template) => (
        <SurfaceCard key={template.id} style={styles.templateCard}>
          <View style={styles.templateHead}>
            <View style={styles.templateTitleRow}>
              <MaterialCommunityIcons name={template.icon as never} size={16} color={colors.primary} />
              <ThemedText style={styles.templateName}>{template.name}</ThemedText>
            </View>
            <Pressable
              disabled={busy}
              onPress={() => onApplyTemplate(template)}
              style={[styles.useTemplateButton, { backgroundColor: colors.primarySoft }]}>
              <ThemedText style={[styles.useTemplateText, { color: colors.primary }]}>使用模板</ThemedText>
            </Pressable>
          </View>
          <View style={styles.templateItems}>
            {template.items.map((item) => (
              <View key={item.name} style={[styles.templateItemChip, { backgroundColor: colors.surfaceMuted }]}>
                <MaterialCommunityIcons name={(item.icon || 'package-variant') as never} size={11} color={colors.primary} />
                <ThemedText style={[styles.templateItemText, { color: colors.mutedText }]}>{item.name}</ThemedText>
              </View>
            ))}
          </View>
        </SurfaceCard>
      ))}

      <View style={styles.sectionHead}>
        <ThemedText style={styles.sectionTitle}>我的场景</ThemedText>
        <Pressable onPress={onAddItem} style={[styles.smallButton, { backgroundColor: colors.primarySoft }]}>
          <MaterialCommunityIcons name="plus" size={14} color={colors.primary} />
          <ThemedText style={[styles.smallButtonText, { color: colors.primary }]}>添加检查项</ThemedText>
        </Pressable>
      </View>
      {home?.scenes.map((scene) => (
        <Pressable
          key={scene.id}
          onPress={() => onSelectScene(scene.id)}
          style={[
            styles.sceneRow,
            {
              backgroundColor: home.activeSceneId === scene.id ? colors.primarySoft : colors.surface,
              borderColor: home.activeSceneId === scene.id ? colors.primary : colors.line,
            },
          ]}>
          <MaterialCommunityIcons name={scene.icon as never} size={17} color={colors.primary} />
          <View style={styles.sceneCopy}>
            <ThemedText style={styles.sceneName}>{scene.name}</ThemedText>
            <ThemedText style={[styles.sceneMeta, { color: colors.mutedText }]}>
              {home.sceneItems.filter((link) => link.sceneId === scene.id).length} 个物品
            </ThemedText>
          </View>
          {home.activeSceneId === scene.id ? (
            <View style={[styles.activeChip, { backgroundColor: colors.success + '18' }]}>
              <ThemedText style={[styles.activeChipText, { color: colors.success }]}>当前</ThemedText>
            </View>
          ) : null}
        </Pressable>
      ))}

      {home?.scenes.length ? (
        <View style={styles.group}>
          <View style={styles.groupHead}>
            <ThemedText style={styles.groupTitle}>当前场景物品</ThemedText>
            <ThemedText style={[styles.groupCount, { color: colors.mutedText }]}>{sceneItems.length}</ThemedText>
          </View>
          {sceneItems.map((item) => (
            <CheckToggleRow key={item.id} item={item} colors={colors} onToggle={() => onToggleSceneItem(item)} />
          ))}
          {otherItems.map((item) => (
            <CheckToggleRow key={item.id} item={item} colors={colors} onToggle={() => onToggleSceneItem(item)} />
          ))}
        </View>
      ) : null}
      <Pressable onPress={onAddSafety} style={[styles.addSafetyButton, { borderColor: colors.line }]}>
        <MaterialCommunityIcons name="shield-plus-outline" size={15} color={colors.accent} />
        <ThemedText style={[styles.addSafetyText, { color: colors.accent }]}>添加安全确认项</ThemedText>
      </Pressable>
    </>
  );
}

function CheckToggleRow({
  item,
  colors,
  onToggle,
}: {
  item: GoOutHomeItem;
  colors: any;
  onToggle: () => void;
}) {
  return (
    <Pressable onPress={onToggle} style={[styles.checkRow, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <MaterialCommunityIcons
        name={(item.icon || 'package-variant') as never}
        size={15}
        color={colors.primary}
      />
      <ThemedText style={styles.checkName}>{item.name}</ThemedText>
      <MaterialCommunityIcons
        name={item.group === 'scene' ? 'check-circle' : 'circle-outline'}
        size={18}
        color={item.group === 'scene' ? colors.success : colors.mutedText}
      />
    </Pressable>
  );
}

function WeatherTab({
  payload,
  health,
  cityQuery,
  cityResults,
  colors,
  busy,
  onCityQuery,
  onSearch,
  onSelectCity,
  onSave,
}: {
  payload: GoOutSettingsPayload;
  health: { status: string; sources: { source: string; status: string }[] };
  cityQuery: string;
  cityResults: GoOutCity[];
  colors: any;
  busy: boolean;
  onCityQuery: (value: string) => void;
  onSearch: () => void;
  onSelectCity: (city: GoOutCity) => void;
  onSave: () => void;
}) {
  const rules = [
    { id: 'rain-umbrella', label: '雨伞', icon: 'umbrella', on: true },
    { id: 'uv-protect', label: '防晒霜', icon: 'white-balance-sunny', on: true },
    { id: 'heat-water', label: '水杯', icon: 'cup-water', on: true },
    { id: 'air-mask', label: '口罩', icon: 'shield-check', on: false },
  ];
  return (
    <>
      <SurfaceCard style={styles.weatherCard}>
        <ThemedText style={styles.weatherCity}>{payload.settings.city || '尚未选择城市'}</ThemedText>
        <ThemedText style={[styles.weatherDesc, { color: colors.mutedText }]}>
          {payload.settings.lat ? `${payload.settings.lat.toFixed(2)}°N ${payload.settings.lon.toFixed(2)}°E` : '手动选择城市后获取真实天气'}
        </ThemedText>
      </SurfaceCard>
      <View style={styles.searchRow}>
        <TextInput
          value={cityQuery}
          onChangeText={onCityQuery}
          placeholder="输入城市关键词"
          placeholderTextColor={colors.mutedText}
          style={[styles.searchInput, { backgroundColor: colors.surface, borderColor: colors.line, color: colors.text }]}
        />
        <Pressable
          disabled={busy}
          onPress={onSearch}
          style={[styles.searchButton, { backgroundColor: colors.primary }]}>
          <MaterialCommunityIcons name="magnify" size={16} color="#ffffff" />
        </Pressable>
      </View>
      {cityResults.map((city) => (
        <Pressable
          key={`${city.name}-${city.lat}-${city.lon}`}
          onPress={() => onSelectCity(city)}
          style={[styles.cityRow, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <MaterialCommunityIcons name="map-marker" size={15} color={colors.primary} />
          <ThemedText style={styles.cityName}>
            {city.admin1 ? `${city.admin1} ${city.name}` : city.name}
          </ThemedText>
        </Pressable>
      ))}
      <View style={styles.sectionHead}>
        <ThemedText style={styles.sectionTitle}>天气规则</ThemedText>
      </View>
      {rules.map((rule) => (
        <SurfaceCard key={rule.id} style={styles.ruleCard}>
          <MaterialCommunityIcons name={rule.icon as never} size={16} color={colors.accent} />
          <View style={styles.ruleCopy}>
            <ThemedText style={styles.ruleName}>{rule.label}</ThemedText>
            <ThemedText style={[styles.ruleReason, { color: colors.mutedText }]}>
              {weatherRuleLabel(rule.id)}
            </ThemedText>
          </View>
          <View style={[styles.dot, { backgroundColor: rule.on ? colors.success : colors.line }]} />
        </SurfaceCard>
      ))}
      <Pressable disabled={busy} onPress={onSave} style={[styles.primaryButton, { backgroundColor: colors.hero }]}>
        <ThemedText style={styles.primaryButtonText}>开启并保存天气联动</ThemedText>
      </Pressable>
    </>
  );
}

function ReminderTab({
  payload,
  activeSceneId,
  colors,
  onAddSchedule,
  onToggleSchedule,
}: {
  payload: GoOutSettingsPayload;
  activeSceneId: string;
  colors: any;
  onAddSchedule: () => void;
  onToggleSchedule: (schedule: GoOutSchedule) => void;
}) {
  return (
    <>
      <View style={styles.sectionHead}>
        <ThemedText style={styles.sectionTitle}>定时自动切换</ThemedText>
        <Pressable onPress={onAddSchedule} style={[styles.smallButton, { backgroundColor: colors.hero }]}>
          <MaterialCommunityIcons name="plus" size={14} color="#c9f36a" />
          <ThemedText style={styles.smallButtonText}>新增提醒</ThemedText>
        </Pressable>
      </View>
      {payload.schedules.map((schedule) => (
        <SurfaceCard key={schedule.id || schedule.sceneId} style={styles.scheduleCard}>
          <View style={styles.scheduleCopy}>
            <ThemedText style={styles.scheduleName}>{scheduleLabel(schedule)}</ThemedText>
            <ThemedText style={[styles.scheduleMeta, { color: colors.mutedText }]}>
              {schedule.daysOfWeek.map((day) => scheduleDaysLabel([day])).join('、')}
            </ThemedText>
          </View>
          <Pressable
            onPress={() => onToggleSchedule(schedule)}
            style={[
              styles.switch,
              { backgroundColor: schedule.enabled ? colors.success : colors.line },
            ]}>
            <View style={[styles.switchDot, schedule.enabled && styles.switchDotOn]} />
          </Pressable>
        </SurfaceCard>
      ))}
      {payload.schedules.length === 0 ? (
        <SurfaceCard style={styles.emptyCard}>
          <MaterialCommunityIcons name="bell-sleep-outline" size={30} color={colors.mutedText} />
          <ThemedText style={styles.emptyTitle}>还没有定时提醒</ThemedText>
          <ThemedText style={[styles.emptyBody, { color: colors.mutedText }]}>
            未配置时不改变当前场景，不做任何推断。
          </ThemedText>
        </SurfaceCard>
      ) : null}
      <SurfaceCard style={styles.noteCard}>
        <MaterialCommunityIcons name="calendar-clock" size={16} color={colors.primary} />
        <ThemedText style={[styles.noteText, { color: colors.mutedText }]}>
          到时间后切换当前场景并发送本地提醒；当前场景 ID：{activeSceneId || '未设置'}
        </ThemedText>
      </SurfaceCard>
    </>
  );
}

function HistoryTab({
  records,
  colors,
  busy,
  onDelete,
  onExport,
  onClear,
}: {
  records: GoOutCompletion[];
  colors: any;
  busy: boolean;
  onDelete: (id: string) => void;
  onExport: (format: 'csv' | 'json') => void;
  onClear: () => void;
}) {
  const stats = localHistoryStats(records);
  return (
    <>
      <View style={styles.statsRow}>
        {[
          { label: '今日', value: stats.today },
          { label: '本周', value: stats.week },
          { label: '连续', value: stats.streak },
        ].map((item) => (
          <SurfaceCard key={item.label} style={styles.statTile}>
            <ThemedText style={styles.statValue}>{item.value}</ThemedText>
            <ThemedText style={[styles.statLabel, { color: colors.mutedText }]}>{item.label}</ThemedText>
          </SurfaceCard>
        ))}
      </View>
      {records.map((record) => (
        <SurfaceCard key={record.id} style={styles.historyCard}>
          <View style={styles.historyTop}>
            <View>
              <ThemedText style={styles.historyTitle}>{formatGoOutDate(record.checkedAt)}</ThemedText>
              <ThemedText style={[styles.historyMeta, { color: colors.mutedText }]}>
                {formatGoOutTime(record.checkedAt)} · {record.sceneName} · {record.confirmedItems.length} 项
              </ThemedText>
            </View>
            <Pressable onPress={() => onDelete(record.id)} style={styles.deleteButton}>
              <MaterialCommunityIcons name="trash-can-outline" size={16} color={colors.accent} />
            </Pressable>
          </View>
          <ThemedText style={[styles.historyResult, { color: colors.success }]}>{record.resultText}</ThemedText>
        </SurfaceCard>
      ))}
      {records.length === 0 ? (
        <SurfaceCard style={styles.emptyCard}>
          <MaterialCommunityIcons name="clipboard-text-clock-outline" size={32} color={colors.mutedText} />
          <ThemedText style={styles.emptyTitle}>还没有完成记录</ThemedText>
          <ThemedText style={[styles.emptyBody, { color: colors.mutedText }]}>
            完成一次出门检查后，真实记录会出现在这里。
          </ThemedText>
        </SurfaceCard>
      ) : null}
      <View style={styles.exportRow}>
        <Pressable disabled={busy} onPress={() => onExport('csv')} style={[styles.secondaryButton, { borderColor: colors.line }]}>
          <MaterialCommunityIcons name="download" size={15} color={colors.primary} />
          <ThemedText style={[styles.secondaryButtonText, { color: colors.primary }]}>导出 CSV</ThemedText>
        </Pressable>
        <Pressable disabled={busy} onPress={onClear} style={[styles.secondaryButton, { borderColor: colors.accent + '55' }]}>
          <MaterialCommunityIcons name="delete-sweep-outline" size={15} color={colors.accent} />
          <ThemedText style={[styles.secondaryButtonText, { color: colors.accent }]}>清空数据</ThemedText>
        </Pressable>
      </View>
    </>
  );
}

function applyLocalTemplate(state: GoOutLocalState, template: GoOutTemplate): GoOutLocalState {
  const now = Date.now();
  const sceneId = `local-scene-${now}`;
  const items = [...state.items];
  const sceneItems = [...state.sceneItems];
  template.items.forEach((templateItem, position) => {
    let item = items.find((candidate) => candidate.name === templateItem.name);
    if (!item) {
      item = {
        id: `local-item-${now}-${position}`,
        name: templateItem.name,
        icon: templateItem.icon,
        itemType: 'item',
        weatherRuleIds: templateItem.weatherRuleIds,
        createdAt: now,
        updatedAt: now,
      };
      items.push(item);
    }
    sceneItems.push({ sceneId, itemId: item.id, position });
  });
  return {
    ...state,
    items,
    sceneItems,
    scenes: [
      ...state.scenes,
      {
        id: sceneId,
        userId: '',
        name: template.name,
        icon: template.icon,
        sortOrder: state.scenes.length,
        createdAt: now,
        updatedAt: now,
      },
    ],
    settings: { ...state.settings, activeSceneId: sceneId, updatedAt: now },
    updatedAt: now,
  };
}

function unavailableWeather(message: string): GoOutWeatherSnapshot {
  return { available: false, status: 'unavailable', unavailableMsg: message };
}

function promptText(message: string) {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.prompt === 'function') {
    return window.prompt(message)?.trim();
  }
  return '';
}

function confirmAction(message: string) {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.confirm === 'function') {
    return window.confirm(message);
  }
  Alert.alert('确认操作', message, [
    { text: '取消', style: 'cancel' },
    { text: '确认', style: 'destructive' },
  ]);
  return true;
}

async function searchLocalCities(query: string): Promise<GoOutCity[]> {
  const response = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=8&language=zh&format=json`,
  );
  const payload = (await response.json()) as {
    results?: { name: string; country: string; admin1?: string; latitude: number; longitude: number }[];
  };
  return (payload.results ?? []).map((item) => ({
    name: item.name,
    country: item.country,
    admin1: item.admin1,
    lat: item.latitude,
    lon: item.longitude,
  }));
}

const styles = StyleSheet.create({
  pageContent: {
    gap: 10,
    paddingBottom: 28,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 7,
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  tabs: {
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    padding: 4,
  },
  tabButton: {
    alignItems: 'center',
    borderRadius: 11,
    flex: 1,
    gap: 2,
    minHeight: 42,
    justifyContent: 'center',
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: '800',
  },
  banner: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 7,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  bannerText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
  },
  loadingCard: {
    alignItems: 'center',
    gap: 10,
    padding: 22,
  },
  loadingText: {
    fontSize: 12,
    fontWeight: '700',
  },
  weatherCard: {
    gap: 8,
    padding: 14,
  },
  weatherTop: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  weatherTemp: {
    fontSize: 30,
    fontWeight: '900',
  },
  weatherDesc: {
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 18,
    marginTop: 3,
  },
  weatherCity: {
    fontSize: 18,
    fontWeight: '900',
  },
  statusPill: {
    alignItems: 'center',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  statusPillText: {
    fontSize: 10,
    fontWeight: '900',
  },
  sourceText: {
    fontSize: 10,
    fontWeight: '600',
  },
  sceneScroller: {
    flexGrow: 0,
  },
  sceneChip: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 5,
    marginRight: 7,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  sceneChipText: {
    fontSize: 11,
    fontWeight: '800',
  },
  group: {
    gap: 6,
  },
  groupHead: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  groupTitle: {
    fontSize: 13,
    fontWeight: '900',
  },
  groupCount: {
    fontSize: 11,
    fontWeight: '700',
  },
  checkRow: {
    alignItems: 'center',
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 9,
    minHeight: 46,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  checkIcon: {
    alignItems: 'center',
    borderRadius: 10,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  checkCopy: {
    flex: 1,
    minWidth: 0,
  },
  checkName: {
    fontSize: 13,
    fontWeight: '900',
  },
  checkReason: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  },
  checkBox: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  suggestionCard: {
    gap: 5,
    padding: 12,
  },
  suggestionTitle: {
    fontSize: 12,
    fontWeight: '900',
  },
  suggestionText: {
    fontSize: 11,
    lineHeight: 17,
  },
  addSafetyButton: {
    alignItems: 'center',
    borderRadius: 13,
    borderStyle: 'dashed',
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minHeight: 42,
  },
  addSafetyText: {
    fontSize: 12,
    fontWeight: '800',
  },
  confirmBar: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    padding: 10,
  },
  confirmCopy: {
    flex: 1,
  },
  confirmTitle: {
    fontSize: 12,
    fontWeight: '900',
  },
  confirmMeta: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  },
  confirmButton: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 5,
    minHeight: 38,
    paddingHorizontal: 11,
  },
  confirmButtonText: {
    color: '#c9f36a',
    fontSize: 11,
    fontWeight: '900',
  },
  completedCard: {
    alignItems: 'center',
    gap: 10,
    padding: 24,
  },
  completedIcon: {
    alignItems: 'center',
    borderRadius: 18,
    height: 62,
    justifyContent: 'center',
    width: 62,
  },
  completedTitle: {
    fontSize: 18,
    fontWeight: '900',
    textAlign: 'center',
  },
  completedMeta: {
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
  },
  weatherNote: {
    alignItems: 'center',
    borderRadius: 11,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  weatherNoteText: {
    flex: 1,
    fontSize: 10,
    fontWeight: '700',
  },
  emptyCard: {
    alignItems: 'center',
    gap: 8,
    padding: 22,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '900',
  },
  emptyBody: {
    fontSize: 12,
    lineHeight: 19,
    textAlign: 'center',
  },
  sectionHead: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '900',
  },
  smallButton: {
    alignItems: 'center',
    borderRadius: 11,
    flexDirection: 'row',
    gap: 4,
    minHeight: 32,
    paddingHorizontal: 10,
  },
  smallButtonText: {
    color: '#c9f36a',
    fontSize: 11,
    fontWeight: '900',
  },
  templateCard: {
    gap: 9,
    padding: 12,
  },
  templateHead: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  templateTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  templateName: {
    fontSize: 14,
    fontWeight: '900',
  },
  useTemplateButton: {
    borderRadius: 9,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  useTemplateText: {
    fontSize: 10,
    fontWeight: '900',
  },
  templateItems: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  templateItemChip: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 5,
  },
  templateItemText: {
    fontSize: 10,
    fontWeight: '700',
  },
  sceneRow: {
    alignItems: 'center',
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 9,
    padding: 11,
  },
  sceneCopy: {
    flex: 1,
  },
  sceneName: {
    fontSize: 13,
    fontWeight: '900',
  },
  sceneMeta: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  },
  activeChip: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  activeChipText: {
    fontSize: 9,
    fontWeight: '900',
  },
  searchRow: {
    flexDirection: 'row',
    gap: 7,
  },
  searchInput: {
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    fontSize: 13,
    minHeight: 40,
    paddingHorizontal: 12,
  },
  searchButton: {
    alignItems: 'center',
    borderRadius: 12,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  cityRow: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    padding: 10,
  },
  cityName: {
    fontSize: 12,
    fontWeight: '800',
  },
  ruleCard: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 9,
    padding: 11,
  },
  ruleCopy: {
    flex: 1,
  },
  ruleName: {
    fontSize: 12,
    fontWeight: '900',
  },
  ruleReason: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  },
  dot: {
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 13,
    justifyContent: 'center',
    minHeight: 42,
  },
  primaryButtonText: {
    color: '#c9f36a',
    fontSize: 12,
    fontWeight: '900',
  },
  scheduleCard: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 9,
    padding: 12,
  },
  scheduleCopy: {
    flex: 1,
  },
  scheduleName: {
    fontSize: 13,
    fontWeight: '900',
  },
  scheduleMeta: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  },
  switch: {
    borderRadius: 999,
    height: 22,
    padding: 3,
    width: 38,
  },
  switchDot: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    height: 16,
    width: 16,
  },
  switchDotOn: {
    marginLeft: 16,
  },
  noteCard: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 7,
    padding: 12,
  },
  noteText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 17,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  statTile: {
    alignItems: 'center',
    flex: 1,
    padding: 12,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '900',
  },
  statLabel: {
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
  },
  historyCard: {
    gap: 6,
    padding: 12,
  },
  historyTop: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  historyTitle: {
    fontSize: 13,
    fontWeight: '900',
  },
  historyMeta: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  },
  historyResult: {
    fontSize: 11,
    fontWeight: '800',
  },
  deleteButton: {
    padding: 4,
  },
  exportRow: {
    flexDirection: 'row',
    gap: 8,
  },
  secondaryButton: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: 5,
    justifyContent: 'center',
    minHeight: 40,
  },
  secondaryButtonText: {
    fontSize: 11,
    fontWeight: '900',
  },
});
