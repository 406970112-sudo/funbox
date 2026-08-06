import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
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
  addDailyLuckSignCompletion,
  deleteDailyLuckSignCompletion,
  fetchDailyLuckSign,
  fetchDailyLuckSignHistory,
  fetchDailyLuckSignSettings,
  getDailyLuckSignErrorMessage,
  saveDailyLuckSignSettings,
  searchDailyLuckSignCities,
} from '@/lib/daily-luck-sign-api';
import {
  categoryLabels,
  completionId,
  completionStats,
  factValue,
  findFact,
  formatChineseDate,
  groupSuggestions,
  isCompletionDone,
  removeCompletion,
  todayDateString,
  upsertCompletion,
} from '@/lib/daily-luck-sign';
import {
  emptyDailyLuckSignSettings,
  getDailyLuckSignCompletions,
  getDailyLuckSignSettings,
  setDailyLuckSignCompletions,
  setDailyLuckSignSettings,
} from '@/lib/daily-luck-sign-storage';
import type {
  DailyLuckSignCategory,
  DailyLuckSignCity,
  DailyLuckSignCompletion,
  DailyLuckSignResponse,
  DailyLuckSignSettings,
  DailyLuckSignSuggestion,
} from '@/types/daily-luck-sign';

type DailyLuckSignTab = 'today' | 'actions' | 'detail' | 'history' | 'settings';

const tabs: { id: DailyLuckSignTab; label: string; icon: string }[] = [
  { id: 'today', label: '今日', icon: 'weather-sunny' },
  { id: 'actions', label: '行动', icon: 'check-circle-outline' },
  { id: 'detail', label: '明细', icon: 'database-outline' },
  { id: 'history', label: '完成', icon: 'history' },
  { id: 'settings', label: '设置', icon: 'tune-variant' },
];

export function DailyLuckSignScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { accessToken: token, status: authStatus } = useAuth();
  const [activeTab, setActiveTab] = useState<DailyLuckSignTab>('today');
  const [settings, setSettings] = useState<DailyLuckSignSettings>(emptyDailyLuckSignSettings);
  const [response, setResponse] = useState<DailyLuckSignResponse | null>(null);
  const [completions, setCompletions] = useState<DailyLuckSignCompletion[]>([]);
  const [loading, setLoading] = useState(true);
  const [signLoading, setSignLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [cityQuery, setCityQuery] = useState('');
  const [cityResults, setCityResults] = useState<DailyLuckSignCity[]>([]);
  const [searchingCity, setSearchingCity] = useState(false);

  const date = useMemo(() => todayDateString(), []);
  const grouped = useMemo(
    () => groupSuggestions(response?.suggestions ?? []),
    [response?.suggestions],
  );
  const stats = useMemo(() => completionStats(completions, date), [completions, date]);

  const loadLocalState = useCallback(async () => {
    const [localSettings, localCompletions] = await Promise.all([
      getDailyLuckSignSettings(),
      getDailyLuckSignCompletions(),
    ]);
    setSettings(localSettings);
    setCompletions(localCompletions);
    return { localSettings, localCompletions };
  }, []);

  const refreshSign = useCallback(
    async (location: DailyLuckSignSettings) => {
      if (!location.city || location.lat === 0 || location.lon === 0) return;
      setSignLoading(true);
      setMessage(null);
      try {
        const next = await fetchDailyLuckSign({
          date,
          location: {
            name: location.city,
            lat: location.lat,
            lon: location.lon,
            source: location.source,
          },
          token,
        });
        setResponse(next);
      } catch (error) {
        setMessage(getDailyLuckSignErrorMessage(error));
      } finally {
        setSignLoading(false);
      }
    },
    [date, token],
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      const local = await loadLocalState();
      let nextCompletions = local.localCompletions;
      let nextSettings = local.localSettings;
      if (token) {
        try {
          const [remoteSettings, remoteHistory] = await Promise.all([
            fetchDailyLuckSignSettings(token),
            fetchDailyLuckSignHistory(token),
          ]);
          if (remoteSettings.city && remoteSettings.updatedAt >= nextSettings.updatedAt) {
            nextSettings = remoteSettings;
          }
          for (const record of remoteHistory.records) {
            nextCompletions = upsertCompletion(nextCompletions, record);
          }
        } catch (error) {
          if (active) setSyncMessage(getDailyLuckSignErrorMessage(error));
        }
      }
      if (!active) return;
      setSettings(nextSettings);
      setCompletions(nextCompletions);
      await setDailyLuckSignCompletions(nextCompletions);
      if (nextSettings.city) {
        await refreshSign(nextSettings);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [loadLocalState, refreshSign, token]);

  async function handleSearchCity() {
    const query = cityQuery.trim();
    if (!query) return;
    setSearchingCity(true);
    setMessage(null);
    try {
      const payload = await searchDailyLuckSignCities(query);
      setCityResults(payload.results);
      if (payload.results.length === 0) {
        setMessage('没有找到这个城市，请换一个关键词。');
      }
    } catch (error) {
      setMessage(getDailyLuckSignErrorMessage(error));
    } finally {
      setSearchingCity(false);
    }
  }

  async function handleSelectCity(city: DailyLuckSignCity) {
    const nextSettings: DailyLuckSignSettings = {
      city: city.admin1 ? `${city.admin1} ${city.name}` : city.name,
      lat: city.lat,
      lon: city.lon,
      source: 'manual',
      updatedAt: Date.now(),
    };
    setSettings(nextSettings);
    await setDailyLuckSignSettings(nextSettings);
    setCityQuery('');
    setCityResults([]);
    setActiveTab('today');
    if (token) {
      try {
        await saveDailyLuckSignSettings(token, nextSettings);
        setSyncMessage(null);
      } catch (error) {
        setSyncMessage(getDailyLuckSignErrorMessage(error));
      }
    }
    await refreshSign(nextSettings);
  }

  async function handleUseSystemLocation() {
    const geolocation = (globalThis as Record<string, any>).navigator?.geolocation;
    if (!geolocation?.getCurrentPosition) {
      setMessage('当前设备不支持自动定位，请手动选择城市。');
      return;
    }
    setMessage(null);
    geolocation.getCurrentPosition(
      async (position: { coords: { latitude: number; longitude: number } }) => {
        const nextSettings: DailyLuckSignSettings = {
          city: '当前位置',
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          source: 'system-location',
          updatedAt: Date.now(),
        };
        setSettings(nextSettings);
        await setDailyLuckSignSettings(nextSettings);
        setActiveTab('today');
        if (token) {
          try {
            await saveDailyLuckSignSettings(token, nextSettings);
          } catch (error) {
            setSyncMessage(getDailyLuckSignErrorMessage(error));
          }
        }
        await refreshSign(nextSettings);
      },
      () => setMessage('定位失败，请手动选择城市。'),
      { enableHighAccuracy: false, timeout: 10000 },
    );
  }

  async function handleComplete(suggestion: DailyLuckSignSuggestion) {
    if (isCompletionDone(completions, date, suggestion.ruleId)) return;
    const item: DailyLuckSignCompletion = {
      id: completionId(date, suggestion.ruleId),
      date,
      ruleId: suggestion.ruleId,
      title: suggestion.title,
      completedAt: new Date().toISOString(),
    };
    const next = upsertCompletion(completions, item);
    setCompletions(next);
    await setDailyLuckSignCompletions(next);
    if (!token) return;
    try {
      const remote = await addDailyLuckSignCompletion(token, {
        date: item.date,
        ruleId: item.ruleId,
        title: item.title,
      });
      const merged = upsertCompletion(next, remote);
      setCompletions(merged);
      await setDailyLuckSignCompletions(merged);
    } catch (error) {
      setSyncMessage(getDailyLuckSignErrorMessage(error));
    }
  }

  async function handleDeleteCompletion(id: string) {
    const next = removeCompletion(completions, id);
    setCompletions(next);
    await setDailyLuckSignCompletions(next);
    if (!token || id.startsWith('local-')) return;
    try {
      await deleteDailyLuckSignCompletion(token, id);
    } catch (error) {
      setSyncMessage(getDailyLuckSignErrorMessage(error));
    }
  }

  if (authStatus === 'loading' || loading) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.primary} size="large" />
          <ThemedText style={[styles.stateTitle, { color: colors.text }]}>正在打开今日运气签</ThemedText>
          <ThemedText style={[styles.stateText, { color: colors.mutedText }]}>
            正在读取真实位置与今日数据
          </ThemedText>
        </View>
      </SafeAreaView>
    );
  }

  if (!settings.city) {
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
              <ThemedText style={styles.headerTitle}>今日运气签</ThemedText>
              <ThemedText style={[styles.headerMeta, { color: colors.mutedText }]}>
                先选择真实位置
              </ThemedText>
            </View>
          </View>
          <ScrollView contentContainerStyle={styles.scrollContent}>
            <View style={[styles.emptyCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
              <View style={[styles.emptyIcon, { backgroundColor: colors.primarySoft }]}>
                <MaterialCommunityIcons name="map-marker-radius-outline" size={30} color={colors.primary} />
              </View>
              <ThemedText style={styles.emptyTitle}>还没有选择城市</ThemedText>
              <ThemedText style={[styles.emptyText, { color: colors.mutedText }]}>
                今日签由真实天气、空气和日历生成。首次使用请搜索城市或开启定位，不会预置任何默认位置。
              </ThemedText>
              <View style={[styles.searchField, { backgroundColor: colors.surface, borderColor: colors.line }]}>
                <MaterialCommunityIcons name="magnify" size={18} color={colors.primary} />
                <TextInput
                  value={cityQuery}
                  onChangeText={setCityQuery}
                  onSubmitEditing={handleSearchCity}
                  placeholder="搜索城市，例如 上海"
                  placeholderTextColor={colors.mutedText}
                  style={[styles.searchInput, { color: colors.text }]}
                  returnKeyType="search"
                />
                <Pressable accessibilityRole="button" onPress={handleSearchCity} style={[styles.searchButton, { backgroundColor: colors.hero }]}>
                  {searchingCity ? (
                    <ActivityIndicator color="#c9f36a" size="small" />
                  ) : (
                    <MaterialCommunityIcons name="arrow-right" size={17} color="#c9f36a" />
                  )}
                </Pressable>
              </View>
              <Pressable accessibilityRole="button" onPress={handleUseSystemLocation} style={[styles.locationButton, { borderColor: colors.line }]}>
                <MaterialCommunityIcons name="crosshairs-gps" size={17} color={colors.primary} />
                <ThemedText style={[styles.locationButtonText, { color: colors.primary }]}>使用系统定位</ThemedText>
              </Pressable>
              {cityResults.length > 0 ? (
                <View style={styles.cityResults}>
                  {cityResults.map((city) => (
                    <Pressable
                      key={`${city.lat}-${city.lon}-${city.name}`}
                      accessibilityRole="button"
                      onPress={() => void handleSelectCity(city)}
                      style={({ pressed }) => [styles.cityResult, { backgroundColor: colors.surfaceMuted }, pressed && styles.pressed]}>
                      <MaterialCommunityIcons name="city-variant-outline" size={17} color={colors.primary} />
                      <View style={styles.cityCopy}>
                        <ThemedText style={styles.cityName}>{city.admin1 ? `${city.admin1} ${city.name}` : city.name}</ThemedText>
                        <ThemedText style={[styles.cityMeta, { color: colors.mutedText }]}>
                          {city.country}
                          {city.admin1 ? ` · ${city.admin1}` : ''}
                        </ThemedText>
                      </View>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              {message ? (
                <ThemedText style={[styles.message, { color: colors.accent }]}>{message}</ThemedText>
              ) : null}
            </View>
          </ScrollView>
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
            <ThemedText style={styles.headerTitle}>今日运气签</ThemedText>
            <ThemedText style={[styles.headerMeta, { color: colors.mutedText }]}>
              {settings.city} · 真实数据 · 不测吉凶
            </ThemedText>
          </View>
          <Pressable
            accessibilityLabel="刷新"
            accessibilityRole="button"
            hitSlop={10}
            onPress={() => void refreshSign(settings)}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
            <MaterialCommunityIcons name="refresh" size={21} color={colors.text} />
          </Pressable>
        </View>

        <View style={[styles.tabs, { backgroundColor: colors.surfaceMuted }]}>
          {tabs.map((tab) => (
            <Pressable
              key={tab.id}
              accessibilityRole="button"
              onPress={() => {
                setActiveTab(tab.id);
                setMessage(null);
              }}
              style={[styles.tab, activeTab === tab.id && { backgroundColor: colors.surface }]}>
              <MaterialCommunityIcons
                name={(tab.icon as never)}
                size={16}
                color={activeTab === tab.id ? colors.primary : colors.mutedText}
              />
              <ThemedText
                style={[
                  styles.tabText,
                  { color: activeTab === tab.id ? colors.text : colors.mutedText },
                ]}>
                {tab.label}
              </ThemedText>
            </Pressable>
          ))}
        </View>

        {syncMessage ? (
          <View style={[styles.syncBar, { backgroundColor: colors.primarySoft }]}>
            <MaterialCommunityIcons name="cloud-sync-outline" size={15} color={colors.primary} />
            <ThemedText style={[styles.syncText, { color: colors.primary }]}>{syncMessage}</ThemedText>
          </View>
        ) : null}

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          {signLoading && !response ? (
            <View style={styles.loadingBlock}>
              <ActivityIndicator color={colors.primary} size="large" />
              <ThemedText style={[styles.loadingText, { color: colors.mutedText }]}>
                正在获取今日真实数据
              </ThemedText>
            </View>
          ) : null}
          {!signLoading && !response && !message ? (
            <View style={[styles.emptyCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
              <View style={[styles.emptyIcon, { backgroundColor: colors.primarySoft }]}>
                <MaterialCommunityIcons name="weather-cloudy-alert" size={30} color={colors.primary} />
              </View>
              <ThemedText style={styles.emptyTitle}>今日数据暂未获取</ThemedText>
              <ThemedText style={[styles.emptyText, { color: colors.mutedText }]}>
                数据源不可用时不会补造字段，请稍后刷新重试。
              </ThemedText>
              <Pressable accessibilityRole="button" onPress={() => void refreshSign(settings)} style={[styles.primaryButton, { backgroundColor: colors.hero }]}>
                <MaterialCommunityIcons name="refresh" size={17} color="#c9f36a" />
                <ThemedText style={[styles.primaryButtonText, { color: '#c9f36a' }]}>重新获取</ThemedText>
              </Pressable>
            </View>
          ) : null}

          {activeTab === 'today' && response ? (
            <TodayView
              colors={colors}
              response={response}
              grouped={grouped}
              completions={completions}
              date={date}
              onComplete={(item) => void handleComplete(item)}
            />
          ) : null}

          {activeTab === 'actions' && response ? (
            <ActionsView
              colors={colors}
              suggestions={response.suggestions}
              completions={completions}
              date={date}
              onComplete={(item) => void handleComplete(item)}
            />
          ) : null}

          {activeTab === 'detail' && response ? <DetailView colors={colors} response={response} /> : null}

          {activeTab === 'history' ? (
            <HistoryView
              colors={colors}
              completions={completions}
              stats={stats}
              onDelete={(id) => void handleDeleteCompletion(id)}
            />
          ) : null}

          {activeTab === 'settings' ? (
            <SettingsView
              colors={colors}
              settings={settings}
              cityQuery={cityQuery}
              cityResults={cityResults}
              searchingCity={searchingCity}
              onChangeQuery={setCityQuery}
              onSearch={() => void handleSearchCity()}
              onSelectCity={(city) => void handleSelectCity(city)}
              onUseSystemLocation={() => void handleUseSystemLocation()}
            />
          ) : null}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function TodayView({
  colors,
  response,
  grouped,
  completions,
  date,
  onComplete,
}: {
  colors: ReturnType<typeof useAppTheme>['colors'];
  response: DailyLuckSignResponse;
  grouped: Record<DailyLuckSignCategory, DailyLuckSignSuggestion[]>;
  completions: DailyLuckSignCompletion[];
  date: string;
  onComplete: (item: DailyLuckSignSuggestion) => void;
}) {
  const tempMax = findFact(response, 'temp-max');
  const tempMin = findFact(response, 'temp-min');
  const precip = findFact(response, 'precip-prob');
  const uv = findFact(response, 'uv-index');
  const aqi = findFact(response, 'aqi');
  const lunar = findFact(response, 'lunar');
  const solarTerm = findFact(response, 'next-solar-term');
  return (
    <View>
      <View style={[styles.dateRow, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <View style={styles.dateCopy}>
          <ThemedText style={styles.dateTitle}>{formatChineseDate(response.date)}</ThemedText>
          <ThemedText style={[styles.dateMeta, { color: colors.mutedText }]}>
            {lunar ? `农历${String(lunar.value)}` : '农历'}
            {solarTerm ? ` · 下一个节气 ${String(solarTerm.value)}` : ''}
          </ThemedText>
        </View>
        <View style={[styles.statusPill, response.status === 'partial' ? { backgroundColor: '#fff2df' } : { backgroundColor: '#e4f7ee' }]}>
          <MaterialCommunityIcons
            name={response.status === 'partial' ? 'alert-outline' : 'check-decagram-outline'}
            size={13}
            color={response.status === 'partial' ? '#9a5b0f' : '#1c5b3c'}
          />
          <ThemedText style={[styles.statusText, { color: response.status === 'partial' ? '#9a5b0f' : '#1c5b3c' }]}>
            {response.status === 'complete' ? '完整可用' : response.status === 'partial' ? '部分可用' : '不可用'}
          </ThemedText>
        </View>
      </View>

      {response.color.hex ? (
        <View style={[styles.colorCard, { backgroundColor: response.color.hex }]}>
          <View>
            <ThemedText style={styles.colorTitle}>今日灵感色</ThemedText>
            <ThemedText style={styles.colorName}>{response.color.name}</ThemedText>
            <ThemedText style={styles.colorReason}>{response.color.rationale}</ThemedText>
          </View>
          <View style={styles.hexBadge}>
            <ThemedText style={styles.hexText}>{response.color.hex}</ThemedText>
          </View>
        </View>
      ) : null}

      <View style={styles.factGrid}>
        <FactTile label="最高 / 最低" value={tempMax && tempMin ? `${String(tempMax.value)}° / ${String(tempMin.value)}°` : '--'} />
        <FactTile label="降雨概率" value={precip ? `${String(precip.value)}%` : '--'} />
        <FactTile label="最大 UV" value={uv ? String(uv.value) : '--'} />
        <FactTile label="AQI" value={aqi ? String(aqi.value) : '--'} />
      </View>

      <SuggestionBlock
        colors={colors}
        title="今日小事"
        items={grouped['small-thing']}
        completions={completions}
        date={date}
        onComplete={onComplete}
      />
      <SuggestionBlock
        colors={colors}
        title="今日挑战"
        items={grouped.challenge}
        completions={completions}
        date={date}
        onComplete={onComplete}
      />
      <SuggestionBlock
        colors={colors}
        title="今日鼓励"
        items={grouped.encouragement}
        completions={completions}
        date={date}
        onComplete={onComplete}
      />
    </View>
  );
}

function ActionsView({
  colors,
  suggestions,
  completions,
  date,
  onComplete,
}: {
  colors: ReturnType<typeof useAppTheme>['colors'];
  suggestions: DailyLuckSignSuggestion[];
  completions: DailyLuckSignCompletion[];
  date: string;
  onComplete: (item: DailyLuckSignSuggestion) => void;
}) {
  return (
    <View>
      {(['small-thing', 'challenge', 'encouragement'] as DailyLuckSignCategory[]).map((category) => (
        <SuggestionBlock
          key={category}
          colors={colors}
          title={categoryLabels[category]}
          items={suggestions.filter((item) => item.category === category)}
          completions={completions}
          date={date}
          onComplete={onComplete}
          expandable
        />
      ))}
    </View>
  );
}

function SuggestionBlock({
  colors,
  title,
  items,
  completions,
  date,
  onComplete,
  expandable = false,
}: {
  colors: ReturnType<typeof useAppTheme>['colors'];
  title: string;
  items: DailyLuckSignSuggestion[];
  completions: DailyLuckSignCompletion[];
  date: string;
  onComplete: (item: DailyLuckSignSuggestion) => void;
  expandable?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <View style={styles.block}>
      <View style={styles.sectionHead}>
        <ThemedText style={styles.sectionTitle}>{title}</ThemedText>
        <ThemedText style={[styles.sectionMeta, { color: colors.mutedText }]}>
          {expandable ? `${items.length} 项` : '真实依据'}
        </ThemedText>
      </View>
      {items.map((item) => {
        const done = isCompletionDone(completions, date, item.ruleId);
        const icon =
          item.category === 'challenge' ? 'trophy-outline' : item.category === 'encouragement' ? 'heart-outline' : 'check-circle-outline';
        return (
          <View key={item.id} style={[styles.suggestionCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <View style={[styles.suggestionIcon, { backgroundColor: colors.primarySoft }]}>
              <MaterialCommunityIcons name={icon} size={17} color={colors.primary} />
            </View>
            <View style={styles.suggestionCopy}>
              <ThemedText style={styles.suggestionTitle}>{item.title}</ThemedText>
              <ThemedText style={[styles.suggestionReason, { color: colors.mutedText }]}>{item.reason}</ThemedText>
              <View style={styles.suggestionMeta}>
                <ThemedText style={[styles.ruleId, { color: colors.primary }]}>{item.ruleId}</ThemedText>
                {item.sources.map((source) => (
                  <ThemedText key={source} style={[styles.sourceTag, { color: colors.mutedText }]}>{source}</ThemedText>
                ))}
              </View>
            </View>
            {item.category === 'challenge' ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => onComplete(item)}
                disabled={done}
                style={[
                  styles.completeButton,
                  done ? { backgroundColor: '#e4f7ee' } : { backgroundColor: colors.hero },
                ]}>
                <MaterialCommunityIcons name={done ? 'check' : 'plus'} size={15} color={done ? '#1c5b3c' : '#c9f36a'} />
                <ThemedText style={[styles.completeText, { color: done ? '#1c5b3c' : '#c9f36a' }]}>
                  {done ? '已完成' : '完成'}
                </ThemedText>
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function DetailView({
  colors,
  response,
}: {
  colors: ReturnType<typeof useAppTheme>['colors'];
  response: DailyLuckSignResponse;
}) {
  const groups = useMemo(() => {
    const bySource = new Map<string, typeof response.facts>();
    for (const fact of response.facts) {
      const items = bySource.get(fact.source) ?? [];
      items.push(fact);
      bySource.set(fact.source, items);
    }
    return Array.from(bySource.entries());
  }, [response]);
  return (
    <View>
      {groups.map(([source, facts]) => (
        <View key={source} style={[styles.detailCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <View style={styles.detailHead}>
            <ThemedText style={styles.detailSource}>{source}</ThemedText>
            <ThemedText style={[styles.detailCount, { color: colors.mutedText }]}>{facts.length} 个字段</ThemedText>
          </View>
          {facts.map((fact) => (
            <View key={fact.key} style={styles.factRow}>
              <ThemedText style={[styles.factLabel, { color: colors.mutedText }]}>{fact.label}</ThemedText>
              <View style={styles.factValueWrap}>
                <ThemedText style={styles.factValue}>{factValue(fact)}</ThemedText>
                <ThemedText style={[styles.factMeta, { color: colors.mutedText }]}>
                  {fact.fetchedAt} · {fact.license}
                </ThemedText>
              </View>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

function HistoryView({
  colors,
  completions,
  stats,
  onDelete,
}: {
  colors: ReturnType<typeof useAppTheme>['colors'];
  completions: DailyLuckSignCompletion[];
  stats: ReturnType<typeof completionStats>;
  onDelete: (id: string) => void;
}) {
  return (
    <View>
      <View style={styles.statsRow}>
        <StatTile label="今日完成" value={stats.today} />
        <StatTile label="本月完成" value={stats.month} />
        <StatTile label="累计完成" value={stats.total} />
      </View>
      {completions.length === 0 ? (
        <View style={[styles.emptyCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <View style={[styles.emptyIcon, { backgroundColor: colors.primarySoft }]}>
            <MaterialCommunityIcons name="notebook-check-outline" size={30} color={colors.primary} />
          </View>
          <ThemedText style={styles.emptyTitle}>还没有完成记录</ThemedText>
          <ThemedText style={[styles.emptyText, { color: colors.mutedText }]}>
            完成一项今日挑战后，真实打卡会出现在这里，不会预置任何演示记录。
          </ThemedText>
        </View>
      ) : (
        completions.map((item) => (
          <View key={item.id} style={[styles.historyCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <View style={[styles.historyIcon, { backgroundColor: colors.primarySoft }]}>
              <MaterialCommunityIcons name="check-decagram-outline" size={18} color={colors.primary} />
            </View>
            <View style={styles.historyCopy}>
              <ThemedText style={styles.historyTitle}>{item.title}</ThemedText>
              <ThemedText style={[styles.historyMeta, { color: colors.mutedText }]}>
                {item.date} · {item.ruleId}
              </ThemedText>
            </View>
            <Pressable accessibilityRole="button" onPress={() => onDelete(item.id)} hitSlop={8} style={styles.deleteButton}>
              <MaterialCommunityIcons name="trash-can-outline" size={17} color={colors.accent} />
            </Pressable>
          </View>
        ))
      )}
    </View>
  );
}

function SettingsView({
  colors,
  settings,
  cityQuery,
  cityResults,
  searchingCity,
  onChangeQuery,
  onSearch,
  onSelectCity,
  onUseSystemLocation,
}: {
  colors: ReturnType<typeof useAppTheme>['colors'];
  settings: DailyLuckSignSettings;
  cityQuery: string;
  cityResults: DailyLuckSignCity[];
  searchingCity: boolean;
  onChangeQuery: (value: string) => void;
  onSearch: () => void;
  onSelectCity: (city: DailyLuckSignCity) => void;
  onUseSystemLocation: () => void;
}) {
  return (
    <View>
      <View style={[styles.settingCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <View style={[styles.settingIcon, { backgroundColor: colors.primarySoft }]}>
          <MaterialCommunityIcons name="map-marker-outline" size={19} color={colors.primary} />
        </View>
        <View style={styles.settingCopy}>
          <ThemedText style={styles.settingTitle}>{settings.city}</ThemedText>
          <ThemedText style={[styles.settingMeta, { color: colors.mutedText }]}>
            {settings.lat.toFixed(2)}, {settings.lon.toFixed(2)} · {settings.source === 'system-location' ? '系统定位' : '手动选择'}
          </ThemedText>
        </View>
      </View>

      <View style={[styles.searchField, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <MaterialCommunityIcons name="magnify" size={18} color={colors.primary} />
        <TextInput
          value={cityQuery}
          onChangeText={onChangeQuery}
          onSubmitEditing={onSearch}
          placeholder="搜索并切换真实城市"
          placeholderTextColor={colors.mutedText}
          style={[styles.searchInput, { color: colors.text }]}
          returnKeyType="search"
        />
        <Pressable accessibilityRole="button" onPress={onSearch} style={[styles.searchButton, { backgroundColor: colors.hero }]}>
          {searchingCity ? <ActivityIndicator color="#c9f36a" size="small" /> : <MaterialCommunityIcons name="arrow-right" size={17} color="#c9f36a" />}
        </Pressable>
      </View>

      {cityResults.length > 0 ? (
        <View style={styles.cityResults}>
          {cityResults.map((city) => (
            <Pressable
              key={`${city.lat}-${city.lon}-${city.name}`}
              accessibilityRole="button"
              onPress={() => onSelectCity(city)}
              style={({ pressed }) => [styles.cityResult, { backgroundColor: colors.surfaceMuted }, pressed && styles.pressed]}>
              <MaterialCommunityIcons name="city-variant-outline" size={17} color={colors.primary} />
              <View style={styles.cityCopy}>
                <ThemedText style={styles.cityName}>{city.admin1 ? `${city.admin1} ${city.name}` : city.name}</ThemedText>
                <ThemedText style={[styles.cityMeta, { color: colors.mutedText }]}>
                  {city.country}
                  {city.admin1 ? ` · ${city.admin1}` : ''}
                </ThemedText>
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}

      <Pressable accessibilityRole="button" onPress={onUseSystemLocation} style={[styles.locationButton, { borderColor: colors.line }]}>
        <MaterialCommunityIcons name="crosshairs-gps" size={17} color={colors.primary} />
        <ThemedText style={[styles.locationButtonText, { color: colors.primary }]}>使用系统定位</ThemedText>
      </Pressable>
      <View style={[styles.privacyNote, { backgroundColor: colors.primarySoft }]}>
        <MaterialCommunityIcons name="lock-outline" size={15} color={colors.primary} />
        <ThemedText style={[styles.privacyText, { color: colors.primary }]}>
          不保存精确坐标，只使用城市和近似坐标查询真实天气与空气数据。
        </ThemedText>
      </View>
    </View>
  );
}

function FactTile({ label, value }: { label: string; value: string }) {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.factTile, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <ThemedText style={[styles.factTileLabel, { color: colors.mutedText }]}>{label}</ThemedText>
      <ThemedText style={styles.factTileValue}>{value}</ThemedText>
    </View>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.statTile, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <ThemedText style={styles.statValue}>{value}</ThemedText>
      <ThemedText style={[styles.statLabel, { color: colors.mutedText }]}>{label}</ThemedText>
    </View>
  );
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
    padding: 24,
  },
  stateTitle: {
    fontSize: 17,
    fontWeight: '900',
    marginTop: 14,
  },
  stateText: {
    fontSize: 12,
    marginTop: 6,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    minHeight: 56,
    paddingHorizontal: 12,
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: 12,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  pressed: {
    opacity: 0.72,
  },
  headerTitleWrap: {
    flex: 1,
    marginLeft: 4,
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
  tabs: {
    borderRadius: 14,
    flexDirection: 'row',
    gap: 3,
    marginHorizontal: 12,
    padding: 4,
  },
  tab: {
    alignItems: 'center',
    borderRadius: 11,
    flex: 1,
    gap: 2,
    justifyContent: 'center',
    minHeight: 46,
    paddingVertical: 4,
  },
  tabText: {
    fontSize: 9,
    fontWeight: '900',
  },
  syncBar: {
    alignItems: 'center',
    borderRadius: 10,
    flexDirection: 'row',
    gap: 7,
    marginHorizontal: 12,
    marginTop: 8,
    padding: 8,
  },
  syncText: {
    flex: 1,
    fontSize: 10,
    fontWeight: '700',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 12,
    paddingBottom: 28,
  },
  loadingBlock: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  loadingText: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 10,
  },
  emptyCard: {
    alignItems: 'center',
    borderRadius: 22,
    borderWidth: 1,
    padding: 22,
  },
  emptyIcon: {
    alignItems: 'center',
    borderRadius: 18,
    height: 62,
    justifyContent: 'center',
    marginBottom: 13,
    width: 62,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '900',
  },
  emptyText: {
    fontSize: 11,
    lineHeight: 18,
    marginTop: 8,
    textAlign: 'center',
  },
  searchField: {
    alignItems: 'center',
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    height: 46,
    marginTop: 18,
    paddingLeft: 12,
    paddingRight: 6,
    width: '100%',
  },
  searchInput: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    minWidth: 0,
  },
  searchButton: {
    alignItems: 'center',
    borderRadius: 10,
    height: 34,
    justifyContent: 'center',
    width: 36,
  },
  locationButton: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 7,
    height: 42,
    justifyContent: 'center',
    marginTop: 10,
    width: '100%',
  },
  locationButtonText: {
    fontSize: 11,
    fontWeight: '900',
  },
  cityResults: {
    gap: 7,
    marginTop: 12,
    width: '100%',
  },
  cityResult: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 10,
    minHeight: 52,
    paddingHorizontal: 11,
  },
  cityCopy: {
    flex: 1,
  },
  cityName: {
    fontSize: 12,
    fontWeight: '900',
  },
  cityMeta: {
    fontSize: 9,
    fontWeight: '700',
    marginTop: 2,
  },
  message: {
    fontSize: 10,
    fontWeight: '700',
    marginTop: 12,
    textAlign: 'center',
  },
  dateRow: {
    alignItems: 'center',
    borderRadius: 15,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 12,
  },
  dateCopy: {
    flex: 1,
  },
  dateTitle: {
    fontSize: 15,
    fontWeight: '900',
  },
  dateMeta: {
    fontSize: 9,
    fontWeight: '700',
    marginTop: 4,
  },
  statusPill: {
    alignItems: 'center',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  statusText: {
    fontSize: 9,
    fontWeight: '900',
  },
  colorCard: {
    borderRadius: 22,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    minHeight: 112,
    padding: 16,
  },
  colorTitle: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 11,
    fontWeight: '800',
  },
  colorName: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '900',
    marginTop: 5,
  },
  colorReason: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 9,
    fontWeight: '700',
    marginTop: 5,
  },
  hexBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  hexText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '900',
  },
  factGrid: {
    flexDirection: 'row',
    gap: 7,
    marginTop: 10,
  },
  factTile: {
    borderRadius: 13,
    borderWidth: 1,
    flex: 1,
    minHeight: 54,
    padding: 8,
  },
  factTileLabel: {
    fontSize: 8,
    fontWeight: '800',
  },
  factTileValue: {
    fontSize: 12,
    fontWeight: '900',
    marginTop: 5,
  },
  block: {
    marginTop: 14,
  },
  sectionHead: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '900',
  },
  sectionMeta: {
    fontSize: 9,
    fontWeight: '700',
  },
  suggestionCard: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
    minHeight: 70,
    padding: 10,
  },
  suggestionIcon: {
    alignItems: 'center',
    borderRadius: 11,
    flex: 0,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  suggestionCopy: {
    flex: 1,
    minWidth: 0,
  },
  suggestionTitle: {
    fontSize: 11,
    fontWeight: '900',
  },
  suggestionReason: {
    fontSize: 9,
    fontWeight: '600',
    lineHeight: 14,
    marginTop: 3,
  },
  suggestionMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    marginTop: 5,
  },
  ruleId: {
    fontSize: 8,
    fontWeight: '900',
  },
  sourceTag: {
    fontSize: 8,
    fontWeight: '700',
  },
  completeButton: {
    alignItems: 'center',
    borderRadius: 9,
    gap: 2,
    justifyContent: 'center',
    minHeight: 34,
    paddingHorizontal: 7,
  },
  completeText: {
    fontSize: 8,
    fontWeight: '900',
  },
  detailCard: {
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 10,
    padding: 11,
  },
  detailHead: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 5,
  },
  detailSource: {
    fontSize: 12,
    fontWeight: '900',
  },
  detailCount: {
    fontSize: 9,
    fontWeight: '700',
  },
  factRow: {
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: 'rgba(116,131,162,0.16)',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 7,
  },
  factLabel: {
    fontSize: 10,
    fontWeight: '700',
  },
  factValueWrap: {
    alignItems: 'flex-end',
  },
  factValue: {
    fontSize: 11,
    fontWeight: '900',
  },
  factMeta: {
    fontSize: 7,
    fontWeight: '600',
    marginTop: 2,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  statTile: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    paddingVertical: 12,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '900',
  },
  statLabel: {
    fontSize: 9,
    fontWeight: '800',
    marginTop: 3,
  },
  historyCard: {
    alignItems: 'center',
    borderRadius: 15,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
    padding: 10,
  },
  historyIcon: {
    alignItems: 'center',
    borderRadius: 10,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  historyCopy: {
    flex: 1,
  },
  historyTitle: {
    fontSize: 11,
    fontWeight: '900',
  },
  historyMeta: {
    fontSize: 9,
    fontWeight: '700',
    marginTop: 3,
  },
  deleteButton: {
    padding: 6,
  },
  settingCard: {
    alignItems: 'center',
    borderRadius: 15,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    padding: 11,
  },
  settingIcon: {
    alignItems: 'center',
    borderRadius: 11,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  settingCopy: {
    flex: 1,
  },
  settingTitle: {
    fontSize: 13,
    fontWeight: '900',
  },
  settingMeta: {
    fontSize: 9,
    fontWeight: '700',
    marginTop: 3,
  },
  privacyNote: {
    alignItems: 'center',
    borderRadius: 11,
    flexDirection: 'row',
    gap: 7,
    marginTop: 12,
    padding: 10,
  },
  privacyText: {
    flex: 1,
    fontSize: 9,
    fontWeight: '700',
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 11,
    flexDirection: 'row',
    gap: 6,
    height: 42,
    justifyContent: 'center',
    marginTop: 16,
    width: '100%',
  },
  primaryButtonText: {
    fontSize: 11,
    fontWeight: '900',
  },
});
