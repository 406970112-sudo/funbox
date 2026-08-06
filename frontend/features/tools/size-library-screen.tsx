import * as Clipboard from 'expo-clipboard';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter } from 'expo-router';
import type { ComponentProps } from 'react';
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
import {
  fetchSizeLibraryState,
  getSizeLibraryErrorMessage,
  saveSizeLibraryState,
} from '@/lib/size-library-api';
import {
  addSizeProfile,
  buildCopyText,
  buildShoppingCheck,
  clearSizeLibraryState,
  getMeasurementMap,
  getProfileMeasurements,
  profileCounts,
  profileKindLabel,
  relatedProfiles,
  removeSizeMeasurement,
  removeSizeProfile,
  roomArea,
  scenarioProfileKind,
  shoppingScenarioLabel,
  SIZE_DIMENSION_META,
  updateSizeProfile,
  upsertSizeMeasurement,
} from '@/lib/size-library';
import {
  getSizeLibraryState,
  setSizeLibraryState,
} from '@/lib/size-library-storage';
import {
  createEmptySizeLibraryState,
  SIZE_LIBRARY_MAX_CUSTOM_MEASUREMENTS,
} from '@/types/size-library';
import type {
  SizeLibraryState,
  SizeMeasurement,
  SizeProfile,
  SizeProfileKind,
  SizeShoppingScenario,
} from '@/types/size-library';

type SizeLibraryTab = 'home' | 'people' | 'spaces' | 'check';
type SpaceKind = 'room' | 'desk' | 'curtain';
type DraftField = {
  value: string;
  unit: string;
  note: string;
};
type CustomDraft = {
  id: string;
  label: string;
  value: string;
  unit: string;
  note: string;
};
type EditorState = {
  kind: SizeProfileKind;
  profileId: string | null;
};

type Color = ReturnType<typeof useAppTheme>['colors'];

function normalizeSizeLibraryState(value: SizeLibraryState): SizeLibraryState {
  return {
    ...createEmptySizeLibraryState(),
    ...value,
    profiles: Array.isArray(value.profiles) ? value.profiles : [],
    measurements: Array.isArray(value.measurements) ? value.measurements : [],
  };
}

export function SizeLibraryScreen() {
  const router = useRouter();
  const { accessToken: token, status: authStatus } = useAuth();
  const { colors } = useAppTheme();
  const [state, setState] = useState<SizeLibraryState>(createEmptySizeLibraryState);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SizeLibraryTab>('home');
  const [spaceKind, setSpaceKind] = useState<SpaceKind>('room');
  const [checkScenario, setCheckScenario] = useState<SizeShoppingScenario>('clothes');
  const [checkProfileId, setCheckProfileId] = useState<string | null>(null);
  const [detailProfileId, setDetailProfileId] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const stateRef = useRef(state);
  const syncQueueRef = useRef<Promise<void>>(Promise.resolve());

  stateRef.current = state;

  const persistAndSync = useCallback(
    (nextState: SizeLibraryState, notice?: string, sync = true) => {
      setState(nextState);
      if (notice) setMessage(notice);
      void setSizeLibraryState(nextState);
      if (!token || !sync) return;
      syncQueueRef.current = syncQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          try {
            const saved = await saveSizeLibraryState(token, nextState);
            setSyncMessage(null);
            const normalized = normalizeSizeLibraryState(saved);
            setState((current) =>
              current.updatedAt >= normalized.updatedAt ? current : normalized,
            );
          } catch (error) {
            setSyncMessage(getSizeLibraryErrorMessage(error));
          }
        });
    },
    [token],
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      const local = await getSizeLibraryState();
      let nextState = local;
      if (token) {
        try {
          const remote = await fetchSizeLibraryState(token);
          if (
            remote.updatedAt > 0 &&
            (nextState.updatedAt === 0 || remote.updatedAt > nextState.updatedAt)
          ) {
            nextState = normalizeSizeLibraryState(remote);
          } else if (
            nextState.updatedAt > 0 &&
            (remote.updatedAt === 0 || nextState.updatedAt > remote.updatedAt)
          ) {
            const saved = await saveSizeLibraryState(token, nextState);
            nextState = normalizeSizeLibraryState(saved);
          }
        } catch (error) {
          if (active) setSyncMessage(getSizeLibraryErrorMessage(error));
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

  const checkProfiles = useMemo(() => {
    const kind = scenarioProfileKind(checkScenario);
    return kind ? state.profiles.filter((profile) => profile.kind === kind) : [];
  }, [checkScenario, state.profiles]);

  useEffect(() => {
    if (!checkProfileId || !checkProfiles.some((profile) => profile.id === checkProfileId)) {
      setCheckProfileId(checkProfiles[0]?.id ?? null);
    }
  }, [checkProfiles, checkProfileId]);

  function handleOpenEditor(kind: SizeProfileKind, profileId: string | null = null) {
    setMessage(null);
    setEditor({ kind, profileId });
    setDetailProfileId(null);
  }

  function handleDeleteProfile(profileId: string) {
    const profile = stateRef.current.profiles.find((item) => item.id === profileId);
    if (!profile) return;
    Alert.alert(
      '删除档案',
      `将删除「${profile.name}」及其全部真实尺寸，该操作不可恢复。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: () => {
            const next = removeSizeProfile(stateRef.current, profileId);
            persistAndSync(next, '档案已删除');
            setDetailProfileId(null);
          },
        },
      ],
    );
  }

  function handleClearAll() {
    Alert.alert('清空尺寸库', '将删除全部家人、空间与真实尺寸，该操作不可恢复。', [
      { text: '取消', style: 'cancel' },
      {
        text: '清空',
        style: 'destructive',
        onPress: () => {
          persistAndSync(clearSizeLibraryState(), '尺寸库已清空');
          setDetailProfileId(null);
          setEditor(null);
        },
      },
    ]);
  }

  async function handleCopy(scenario: SizeShoppingScenario, profileId: string) {
    const text = buildCopyText(stateRef.current, scenario, profileId);
    if (!text) {
      setMessage('当前档案还没有可复制的真实尺寸');
      return;
    }
    try {
      await Clipboard.setStringAsync(text);
      setMessage('已复制真实尺寸');
    } catch {
      setMessage('复制失败，请手动选择尺寸文本');
    }
  }

  if (authStatus === 'loading' || loading) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.primary} size="large" />
          <ThemedText style={[styles.stateTitle, { color: colors.text }]}>
            正在打开我的尺寸库
          </ThemedText>
          <ThemedText style={[styles.stateText, { color: colors.mutedText }]}>
            正在读取真实档案与尺寸
          </ThemedText>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={[styles.screen, { maxWidth: appLayout.screenMaxWidth, alignSelf: 'center' }]}>
        {editor ? (
          <Editor
            colors={colors}
            editor={editor}
            onBack={() => setEditor(null)}
            onSave={(result) => {
              setEditor(null);
              if (result.profileId) setDetailProfileId(result.profileId);
              if (result.message) setMessage(result.message);
            }}
            onError={setMessage}
            state={state}
            persistAndSync={persistAndSync}
          />
        ) : detailProfileId ? (
          <ProfileDetail
            colors={colors}
            onBack={() => setDetailProfileId(null)}
            onCheck={(scenario) => {
              setCheckScenario(scenario);
              setCheckProfileId(detailProfileId);
              setDetailProfileId(null);
              setActiveTab('check');
            }}
            onCopy={(scenario) => {
              void handleCopy(scenario, detailProfileId);
            }}
            onDelete={() => handleDeleteProfile(detailProfileId)}
            onEdit={(kind) => handleOpenEditor(kind, detailProfileId)}
            state={state}
            profileId={detailProfileId}
          />
        ) : (
          <MainTabs
            activeTab={activeTab}
            checkProfileId={checkProfileId}
            checkProfiles={checkProfiles}
            checkScenario={checkScenario}
            colors={colors}
            message={message}
            onAdd={(kind) => handleOpenEditor(kind)}
            onCheckProfileChange={setCheckProfileId}
            onCheckScenario={(scenario) => {
              setCheckScenario(scenario);
              setCheckProfileId(null);
            }}
            onClearAll={handleClearAll}
            onCopy={(scenario, profileId) => {
              void handleCopy(scenario, profileId);
            }}
            onOpenDetail={setDetailProfileId}
            onSelectSpaceKind={setSpaceKind}
            onSetTab={setActiveTab}
            onSyncMessage={setSyncMessage}
            spaceKind={spaceKind}
            state={state}
            syncMessage={syncMessage}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

function MainTabs({
  activeTab,
  checkProfileId,
  checkProfiles,
  checkScenario,
  colors,
  message,
  onAdd,
  onCheckProfileChange,
  onCheckScenario,
  onClearAll,
  onCopy,
  onOpenDetail,
  onSelectSpaceKind,
  onSetTab,
  onSyncMessage,
  spaceKind,
  state,
  syncMessage,
}: {
  activeTab: SizeLibraryTab;
  checkProfileId: string | null;
  checkProfiles: SizeProfile[];
  checkScenario: SizeShoppingScenario;
  colors: Color;
  message: string | null;
  onAdd: (kind: SizeProfileKind) => void;
  onCheckProfileChange: (profileId: string | null) => void;
  onCheckScenario: (scenario: SizeShoppingScenario) => void;
  onClearAll: () => void;
  onCopy: (scenario: SizeShoppingScenario, profileId: string) => void;
  onOpenDetail: (profileId: string) => void;
  onSelectSpaceKind: (kind: SpaceKind) => void;
  onSetTab: (tab: SizeLibraryTab) => void;
  onSyncMessage: (message: string | null) => void;
  spaceKind: SpaceKind;
  state: SizeLibraryState;
  syncMessage: string | null;
}) {
  const counts = profileCounts(state);
  const spaceCount = counts.room + counts.desk + counts.curtain;
  const tabLabels: [SizeLibraryTab, string][] = [
    ['home', '主页'],
    ['people', `家人 ${counts.person}`],
    ['spaces', `空间 ${spaceCount}`],
    ['check', '购买核对'],
  ];

  return (
    <>
      <Header
        colors={colors}
        onClearAll={onClearAll}
        subtitle={
          state.profiles.length > 0
            ? `${counts.person} 位家人 · ${spaceCount} 个空间 · 已同步`
            : '真实录入 · 不做推算'
        }
        title="我的尺寸库"
      />
      <View style={[styles.tabs, { backgroundColor: colors.surfaceMuted }]}>
        {tabLabels.map(([tab, label]) => (
          <Pressable
            key={tab}
            accessibilityRole="button"
            onPress={() => {
              onSetTab(tab);
              onSyncMessage(null);
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
          <HomeTab
            colors={colors}
            counts={counts}
            onAdd={onAdd}
            onCheckScenario={(scenario) => {
              onCheckScenario(scenario);
              onSetTab('check');
            }}
            onOpenDetail={onOpenDetail}
            state={state}
          />
        ) : null}
        {activeTab === 'people' ? (
          <PeopleTab
            colors={colors}
            onAdd={() => onAdd('person')}
            onOpenDetail={onOpenDetail}
            people={state.profiles.filter((profile) => profile.kind === 'person')}
          />
        ) : null}
        {activeTab === 'spaces' ? (
          <SpacesTab
            colors={colors}
            onAdd={onAdd}
            onOpenDetail={onOpenDetail}
            onSelectSpaceKind={onSelectSpaceKind}
            spaceKind={spaceKind}
            state={state}
          />
        ) : null}
        {activeTab === 'check' ? (
          <CheckTab
            checkProfileId={checkProfileId}
            checkProfiles={checkProfiles}
            checkScenario={checkScenario}
            colors={colors}
            onCheckProfileChange={onCheckProfileChange}
            onCheckScenario={onCheckScenario}
            onCopy={onCopy}
            state={state}
          />
        ) : null}
      </ScrollView>
    </>
  );
}

function Header({
  colors,
  onClearAll,
  subtitle,
  title,
}: {
  colors: Color;
  onClearAll: () => void;
  subtitle: string;
  title: string;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.headerTitleWrap}>
        <ThemedText style={styles.headerTitle}>{title}</ThemedText>
        <ThemedText style={[styles.headerMeta, { color: colors.mutedText }]}>
          {subtitle}
        </ThemedText>
      </View>
      <Pressable
        accessibilityLabel="清空尺寸库"
        accessibilityRole="button"
        onPress={onClearAll}
        style={({ pressed }) => [styles.headerAction, pressed && styles.pressed]}>
        <MaterialCommunityIcons name="trash-can-outline" size={18} color={colors.accent} />
      </Pressable>
    </View>
  );
}

function HomeTab({
  colors,
  counts,
  onAdd,
  onCheckScenario,
  onOpenDetail,
  state,
}: {
  colors: Color;
  counts: Record<SizeProfileKind, number>;
  onAdd: (kind: SizeProfileKind) => void;
  onCheckScenario: (scenario: SizeShoppingScenario) => void;
  onOpenDetail: (profileId: string) => void;
  state: SizeLibraryState;
}) {
  const people = state.profiles.filter((profile) => profile.kind === 'person');
  const spaces = state.profiles.filter(
    (profile) => profile.kind === 'room' || profile.kind === 'desk' || profile.kind === 'curtain',
  );
  if (state.profiles.length === 0) {
    return (
      <View style={[styles.emptyCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <View style={[styles.emptyIcon, { backgroundColor: colors.primarySoft }]}>
          <MaterialCommunityIcons name="tape-measure" size={34} color={colors.primary} />
        </View>
        <ThemedText style={styles.emptyTitle}>还没有真实尺寸数据</ThemedText>
        <ThemedText style={[styles.emptyText, { color: colors.mutedText }]}>
          先添加家人、房间、书桌或窗帘，所有内容只来自你的真实录入。
        </ThemedText>
        <Pressable
          accessibilityRole="button"
          onPress={() => onAdd('person')}
          style={({ pressed }) => [
            styles.primaryButton,
            { backgroundColor: colors.primary },
            pressed && styles.pressed,
          ]}>
          <MaterialCommunityIcons name="account-plus-outline" size={17} color="#ffffff" />
          <ThemedText style={styles.primaryButtonText}>添加家人</ThemedText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => onAdd('room')}
          style={({ pressed }) => [
            styles.secondaryButton,
            { backgroundColor: colors.surfaceMuted, borderColor: colors.line },
            pressed && styles.pressed,
          ]}>
          <MaterialCommunityIcons name="home-plus-outline" size={17} color={colors.primary} />
          <ThemedText style={[styles.secondaryButtonText, { color: colors.primary }]}>
            添加房间
          </ThemedText>
        </Pressable>
      </View>
    );
  }

  return (
    <>
      <View style={[styles.heroCard, { backgroundColor: colors.hero }]}>
        <View style={styles.heroIcon}>
          <MaterialCommunityIcons name="tape-measure" size={22} color="#c9f36a" />
        </View>
        <ThemedText style={styles.heroTitle}>
          {counts.person} 位家人 · {counts.room + counts.desk + counts.curtain} 个空间
        </ThemedText>
        <ThemedText style={styles.heroText}>
          身体尺寸、衣物鞋饰、房间、书桌与窗帘都在这里。
        </ThemedText>
        <View style={styles.heroMetaRow}>
          <View style={styles.heroMeta}>
            <ThemedText style={styles.heroMetaText}>
              最近更新 {formatShortDate(state.updatedAt)}
            </ThemedText>
          </View>
          <View style={styles.heroMeta}>
            <ThemedText style={styles.heroMetaText}>真实数据</ThemedText>
          </View>
        </View>
      </View>

      <View style={styles.quickGrid}>
        {(
          [
            ['clothes', 'shopping-outline', '买衣服'],
            ['shoes', 'shoe-sneaker', '买鞋'],
            ['ring', 'diamond-stone', '买戒指'],
            ['desk', 'desk', '买书桌'],
            ['curtain', 'blinds', '买窗帘'],
            ['room', 'sofa-outline', '房间软装'],
          ] as [SizeShoppingScenario, ComponentProps<typeof MaterialCommunityIcons>['name'], string][]
        ).map(([scenario, icon, label]) => (
          <Pressable
            key={scenario}
            accessibilityRole="button"
            onPress={() => onCheckScenario(scenario)}
            style={({ pressed }) => [
              styles.quickItem,
              { backgroundColor: colors.surface, borderColor: colors.line },
              pressed && styles.pressed,
            ]}>
            <MaterialCommunityIcons name={icon} size={19} color={colors.primary} />
            <ThemedText style={styles.quickItemText}>{label}</ThemedText>
          </Pressable>
        ))}
      </View>

      <ProfilePanel
        colors={colors}
        emptyText="还没有家人，先添加一位真实家人"
        onAdd={() => onAdd('person')}
        onOpenDetail={onOpenDetail}
        profiles={people}
        title="家人"
      />
      <ProfilePanel
        colors={colors}
        emptyText="还没有空间，先添加房间、书桌或窗帘"
        onAdd={() => onAdd('room')}
        onOpenDetail={onOpenDetail}
        profiles={spaces}
        title="空间"
      />
    </>
  );
}

function ProfilePanel({
  colors,
  emptyText,
  onAdd,
  onOpenDetail,
  profiles,
  title,
}: {
  colors: Color;
  emptyText: string;
  onAdd: () => void;
  onOpenDetail: (profileId: string) => void;
  profiles: SizeProfile[];
  title: string;
}) {
  return (
    <View style={[styles.panelCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <View style={styles.panelHead}>
        <ThemedText style={styles.panelTitle}>{title}</ThemedText>
        <Pressable accessibilityRole="button" onPress={onAdd} style={styles.panelAdd}>
          <MaterialCommunityIcons name="plus" size={16} color={colors.primary} />
          <ThemedText style={[styles.panelAddText, { color: colors.primary }]}>添加</ThemedText>
        </Pressable>
      </View>
      {profiles.length === 0 ? (
        <ThemedText style={[styles.panelEmpty, { color: colors.mutedText }]}>{emptyText}</ThemedText>
      ) : (
        profiles.slice(0, 5).map((profile) => (
          <ProfileRow
            colors={colors}
            key={profile.id}
            onPress={() => onOpenDetail(profile.id)}
            profile={profile}
          />
        ))
      )}
    </View>
  );
}

function PeopleTab({
  colors,
  onAdd,
  onOpenDetail,
  people,
}: {
  colors: Color;
  onAdd: () => void;
  onOpenDetail: (profileId: string) => void;
  people: SizeProfile[];
}) {
  return (
    <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <View style={styles.sectionHead}>
        <ThemedText style={styles.sectionTitle}>家人</ThemedText>
        <Pressable
          accessibilityRole="button"
          onPress={onAdd}
          style={({ pressed }) => [
            styles.addButton,
            { backgroundColor: colors.primary },
            pressed && styles.pressed,
          ]}>
          <MaterialCommunityIcons name="account-plus-outline" size={16} color="#ffffff" />
          <ThemedText style={styles.addButtonText}>添加家人</ThemedText>
        </Pressable>
      </View>
      {people.length === 0 ? (
        <View style={styles.emptyList}>
          <MaterialCommunityIcons name="account-group-outline" size={30} color={colors.mutedText} />
          <ThemedText style={[styles.emptyListText, { color: colors.mutedText }]}>
            还没有真实家人档案
          </ThemedText>
        </View>
      ) : (
        people.map((profile) => (
          <ProfileRow
            colors={colors}
            key={profile.id}
            onPress={() => onOpenDetail(profile.id)}
            profile={profile}
          />
        ))
      )}
    </View>
  );
}

function SpacesTab({
  colors,
  onAdd,
  onOpenDetail,
  onSelectSpaceKind,
  spaceKind,
  state,
}: {
  colors: Color;
  onAdd: (kind: SizeProfileKind) => void;
  onOpenDetail: (profileId: string) => void;
  onSelectSpaceKind: (kind: SpaceKind) => void;
  spaceKind: SpaceKind;
  state: SizeLibraryState;
}) {
  const spaces = state.profiles.filter((profile) => profile.kind === spaceKind);
  return (
    <>
      <View style={[styles.segmented, { backgroundColor: colors.surfaceMuted }]}>
        {(['room', 'desk', 'curtain'] as SpaceKind[]).map((kind) => (
          <Pressable
            key={kind}
            accessibilityRole="button"
            onPress={() => onSelectSpaceKind(kind)}
            style={[
              styles.segment,
              spaceKind === kind && { backgroundColor: colors.surface },
            ]}>
            <ThemedText
              style={[
                styles.segmentText,
                { color: spaceKind === kind ? colors.text : colors.mutedText },
              ]}>
              {profileKindLabel(kind)}
            </ThemedText>
          </Pressable>
        ))}
      </View>
      <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <View style={styles.sectionHead}>
          <ThemedText style={styles.sectionTitle}>{profileKindLabel(spaceKind)}</ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={() => onAdd(spaceKind)}
            style={({ pressed }) => [
              styles.addButton,
              { backgroundColor: colors.primary },
              pressed && styles.pressed,
            ]}>
            <MaterialCommunityIcons name="plus" size={16} color="#ffffff" />
            <ThemedText style={styles.addButtonText}>添加</ThemedText>
          </Pressable>
        </View>
        {spaces.length === 0 ? (
          <View style={styles.emptyList}>
            <MaterialCommunityIcons name="home-outline" size={30} color={colors.mutedText} />
            <ThemedText style={[styles.emptyListText, { color: colors.mutedText }]}>
              还没有真实{profileKindLabel(spaceKind)}档案
            </ThemedText>
          </View>
        ) : (
          spaces.map((profile) => (
            <ProfileRow
              colors={colors}
              key={profile.id}
              onPress={() => onOpenDetail(profile.id)}
              profile={profile}
            />
          ))
        )}
      </View>
    </>
  );
}

function CheckTab({
  checkProfileId,
  checkProfiles,
  checkScenario,
  colors,
  onCheckProfileChange,
  onCheckScenario,
  onCopy,
  state,
}: {
  checkProfileId: string | null;
  checkProfiles: SizeProfile[];
  checkScenario: SizeShoppingScenario;
  colors: Color;
  onCheckProfileChange: (profileId: string | null) => void;
  onCheckScenario: (scenario: SizeShoppingScenario) => void;
  onCopy: (scenario: SizeShoppingScenario, profileId: string) => void;
  state: SizeLibraryState;
}) {
  const scenarios: SizeShoppingScenario[] = [
    'clothes',
    'shoes',
    'ring',
    'desk',
    'curtain',
    'room',
  ];
  const result = checkProfileId
    ? buildShoppingCheck(state, checkScenario, checkProfileId)
    : { error: '请先添加档案', rows: [], profile: null };
  return (
    <>
      <View style={styles.scenarioGrid}>
        {scenarios.map((scenario) => (
          <Pressable
            key={scenario}
            accessibilityRole="button"
            onPress={() => onCheckScenario(scenario)}
            style={[
              styles.scenarioChip,
              {
                backgroundColor:
                  checkScenario === scenario ? colors.primarySoft : colors.surface,
                borderColor: checkScenario === scenario ? colors.primary : colors.line,
              },
            ]}>
            <MaterialCommunityIcons
              name={scenarioIcon(scenario)}
              size={15}
              color={checkScenario === scenario ? colors.primary : colors.mutedText}
            />
            <ThemedText
              style={[
                styles.scenarioText,
                {
                  color: checkScenario === scenario ? colors.primary : colors.mutedText,
                },
              ]}>
              {shoppingScenarioLabel(scenario)}
            </ThemedText>
          </Pressable>
        ))}
      </View>

      <ThemedText style={[styles.fieldLabel, { color: colors.mutedText }]}>选择档案</ThemedText>
      <View style={[styles.selectorCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        {checkProfiles.length === 0 ? (
          <View style={styles.emptyList}>
            <MaterialCommunityIcons name="folder-open-outline" size={28} color={colors.mutedText} />
            <ThemedText style={[styles.emptyListText, { color: colors.mutedText }]}>
              还没有可核对的真实档案
            </ThemedText>
          </View>
        ) : (
          checkProfiles.map((profile) => (
            <Pressable
              key={profile.id}
              accessibilityRole="button"
              onPress={() => onCheckProfileChange(profile.id)}
              style={[
                styles.profileRow,
                {
                  borderBottomColor: colors.line,
                  backgroundColor:
                    checkProfileId === profile.id ? colors.primarySoft : 'transparent',
                },
              ]}>
              <View style={[styles.miniAvatar, { backgroundColor: colors.primarySoft }]}>
                <ThemedText style={[styles.miniAvatarText, { color: colors.primary }]}>
                  {profile.name.slice(0, 1)}
                </ThemedText>
              </View>
              <View style={styles.profileCopy}>
                <ThemedText style={styles.profileName}>{profile.name}</ThemedText>
                <ThemedText style={[styles.profileMeta, { color: colors.mutedText }]}>
                  {profileKindLabel(profile.kind)}
                  {profile.relation ? ` · ${profile.relation}` : ''}
                </ThemedText>
              </View>
              <MaterialCommunityIcons
                name={checkProfileId === profile.id ? 'check-circle' : 'circle-outline'}
                size={19}
                color={checkProfileId === profile.id ? colors.primary : colors.mutedText}
              />
            </Pressable>
          ))
        )}
      </View>

      {result.profile ? (
        <View style={[styles.checkCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <View style={styles.checkHead}>
            <View style={[styles.checkIcon, { backgroundColor: colors.primarySoft }]}>
              <MaterialCommunityIcons
                name={scenarioIcon(checkScenario)}
                size={18}
                color={colors.primary}
              />
            </View>
            <View style={styles.profileCopy}>
              <ThemedText style={styles.checkTitle}>
                {shoppingScenarioLabel(checkScenario)} · {result.profile.name}
              </ThemedText>
              <ThemedText style={[styles.checkMeta, { color: colors.mutedText }]}>
                以下内容来自真实录入
              </ThemedText>
            </View>
          </View>
          {result.rows.map((row) => (
            <View key={row.dimensionKey} style={[styles.checkRow, { borderBottomColor: colors.line }]}>
              <ThemedText style={[styles.checkLabel, { color: colors.mutedText }]}>
                {row.label}
              </ThemedText>
              <ThemedText
                style={[
                  styles.checkValue,
                  row.filled ? { color: colors.text } : { color: colors.mutedText },
                ]}>
                {row.filled ? row.value : '未填写'}
              </ThemedText>
              {row.filled && row.unit ? (
                <ThemedText style={[styles.checkUnit, { color: colors.mutedText }]}>
                  {row.unit}
                </ThemedText>
              ) : null}
            </View>
          ))}
          {result.rows.some((row) => row.filled && row.note) ? (
            <View style={[styles.noteRow, { backgroundColor: colors.surfaceMuted }]}>
              <MaterialCommunityIcons name="message-text-outline" size={13} color={colors.mutedText} />
              <ThemedText style={[styles.noteText, { color: colors.mutedText }]}>
                {result.rows
                  .filter((row) => row.filled && row.note)
                  .map((row) => `${row.label}：${row.note}`)
                  .join('；')}
              </ThemedText>
            </View>
          ) : null}
          <Pressable
            accessibilityRole="button"
            onPress={() => checkProfileId && onCopy(checkScenario, checkProfileId)}
            style={({ pressed }) => [
              styles.primaryButton,
              { backgroundColor: colors.primary },
              pressed && styles.pressed,
            ]}>
            <MaterialCommunityIcons name="content-copy" size={17} color="#ffffff" />
            <ThemedText style={styles.primaryButtonText}>复制真实尺寸</ThemedText>
          </Pressable>
        </View>
      ) : null}
    </>
  );
}

function ProfileDetail({
  colors,
  onBack,
  onCheck,
  onCopy,
  onDelete,
  onEdit,
  profileId,
  state,
}: {
  colors: Color;
  onBack: () => void;
  onCheck: (scenario: SizeShoppingScenario) => void;
  onCopy: (scenario: SizeShoppingScenario) => void;
  onDelete: () => void;
  onEdit: (kind: SizeProfileKind) => void;
  profileId: string;
  state: SizeLibraryState;
}) {
  const profile = state.profiles.find((item) => item.id === profileId);
  if (!profile) return null;
  const measurements = getProfileMeasurements(state, profileId);
  const rooms = state.profiles.filter((item) => item.kind === 'room');
  const related = relatedProfiles(state, profileId);
  const scenario = detailScenario(profile.kind);
  const area = profile.kind === 'room' ? roomArea(state, profileId) : null;
  const room =
    profile.roomId ? rooms.find((item) => item.id === profile.roomId) : undefined;

  return (
    <>
      <DetailHeader
        colors={colors}
        onBack={onBack}
        onDelete={onDelete}
        onEdit={() => onEdit(profile.kind)}
        profile={profile}
      />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        <View style={[styles.detailHero, { backgroundColor: colors.hero }]}>
          <View style={[styles.detailAvatar, { backgroundColor: colors.primarySoft }]}>
            <ThemedText style={[styles.detailAvatarText, { color: colors.primary }]}>
              {profile.name.slice(0, 1)}
            </ThemedText>
          </View>
          <View style={styles.profileCopy}>
            <ThemedText style={styles.detailHeroTitle}>{profile.name}</ThemedText>
            <ThemedText style={styles.detailHeroMeta}>
              {profileKindLabel(profile.kind)}
              {profile.relation ? ` · ${profile.relation}` : ''}
            </ThemedText>
          </View>
        </View>

        {measurements.length > 0 ? (
          <MeasurementGroup
            colors={colors}
            kind={profile.kind}
            measurements={measurements}
          />
        ) : (
          <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <ThemedText style={[styles.emptyListText, { color: colors.mutedText }]}>
              还没有真实尺寸，点击编辑开始录入
            </ThemedText>
          </View>
        )}

        {profile.kind === 'room' && area !== null ? (
          <View style={[styles.areaCard, { backgroundColor: colors.primarySoft }]}>
            <MaterialCommunityIcons name="ruler-square" size={18} color={colors.primary} />
            <ThemedText style={[styles.areaText, { color: colors.primary }]}>
              面积 {Math.round(area / 10000 * 100) / 100} m² · 由真实长宽计算
            </ThemedText>
          </View>
        ) : null}

        {profile.kind === 'room' && related.length > 0 ? (
          <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <ThemedText style={styles.sectionTitle}>关联书桌与窗帘</ThemedText>
            {related.map((item) => (
              <ProfileRow
                colors={colors}
                key={item.id}
                onPress={() => undefined}
                profile={item}
              />
            ))}
          </View>
        ) : null}

        {profile.kind === 'desk' || profile.kind === 'curtain' ? (
          <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <ThemedText style={styles.sectionTitle}>放置房间</ThemedText>
            <ThemedText style={[styles.roomName, { color: colors.mutedText }]}>
              {room ? room.name : '未关联'}
            </ThemedText>
          </View>
        ) : null}

        {scenario ? (
          <View style={styles.detailActions}>
            <Pressable
              accessibilityRole="button"
              onPress={() => onCheck(scenario)}
              style={({ pressed }) => [
                styles.primaryButton,
                { backgroundColor: colors.primary },
                pressed && styles.pressed,
              ]}>
              <MaterialCommunityIcons name="shopping-outline" size={17} color="#ffffff" />
              <ThemedText style={styles.primaryButtonText}>
                {shoppingScenarioLabel(scenario)}核对
              </ThemedText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => onCopy(scenario)}
              style={({ pressed }) => [
                styles.secondaryButton,
                { backgroundColor: colors.surfaceMuted, borderColor: colors.line },
                pressed && styles.pressed,
              ]}>
              <MaterialCommunityIcons name="content-copy" size={17} color={colors.primary} />
              <ThemedText style={[styles.secondaryButtonText, { color: colors.primary }]}>
                复制全部
              </ThemedText>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}

function MeasurementGroup({
  colors,
  kind,
  measurements,
}: {
  colors: Color;
  kind: SizeProfileKind;
  measurements: SizeMeasurement[];
}) {
  const groups = Array.from(new Set(SIZE_DIMENSION_META.filter((meta) => meta.kind === kind).map((meta) => meta.group)));
  return (
    <>
      {groups.map((group) => {
        const rows = measurements.filter((item) => {
          const meta = SIZE_DIMENSION_META.find((entry) => entry.key === item.dimensionKey);
          return meta?.kind === kind && meta.group === group;
        });
        if (rows.length === 0) return null;
        return (
          <View key={group} style={[styles.dimGroup, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <View style={styles.dimGroupHead}>
              <ThemedText style={styles.sectionTitle}>{group}</ThemedText>
              <ThemedText style={[styles.dimGroupCount, { color: colors.mutedText }]}>
                {rows.length} 项
              </ThemedText>
            </View>
            {rows.map((item) => (
              <View key={item.id} style={[styles.dimRow, { borderBottomColor: colors.line }]}>
                <ThemedText style={[styles.dimLabel, { color: colors.mutedText }]}>
                  {item.label}
                </ThemedText>
                <ThemedText style={[styles.dimValue, { color: colors.text }]}>{item.value}</ThemedText>
                {item.unit ? (
                  <ThemedText style={[styles.dimUnit, { color: colors.mutedText }]}>{item.unit}</ThemedText>
                ) : null}
              </View>
            ))}
          </View>
        );
      })}
      {measurements.some((item) => item.dimensionKey.startsWith('custom_')) ? (
        <View style={[styles.dimGroup, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <View style={styles.dimGroupHead}>
            <ThemedText style={styles.sectionTitle}>其他尺寸</ThemedText>
            <ThemedText style={[styles.dimGroupCount, { color: colors.mutedText }]}>
              {measurements.filter((item) => item.dimensionKey.startsWith('custom_')).length} 项
            </ThemedText>
          </View>
          {measurements
            .filter((item) => item.dimensionKey.startsWith('custom_'))
            .map((item) => (
              <View key={item.id} style={[styles.dimRow, { borderBottomColor: colors.line }]}>
                <ThemedText style={[styles.dimLabel, { color: colors.mutedText }]}>
                  {item.label}
                </ThemedText>
                <ThemedText style={[styles.dimValue, { color: colors.text }]}>{item.value}</ThemedText>
                {item.unit ? (
                  <ThemedText style={[styles.dimUnit, { color: colors.mutedText }]}>{item.unit}</ThemedText>
                ) : null}
              </View>
            ))}
        </View>
      ) : null}
    </>
  );
}

function DetailHeader({
  colors,
  onBack,
  onDelete,
  onEdit,
  profile,
}: {
  colors: Color;
  onBack: () => void;
  onDelete: () => void;
  onEdit: () => void;
  profile: SizeProfile;
}) {
  return (
    <View style={styles.header}>
      <Pressable
        accessibilityLabel="返回"
        accessibilityRole="button"
        onPress={onBack}
        style={({ pressed }) => [styles.headerAction, pressed && styles.pressed]}>
        <MaterialCommunityIcons name="chevron-left" size={26} color={colors.text} />
      </Pressable>
      <View style={styles.headerTitleWrap}>
        <ThemedText style={styles.headerTitle}>{profile.name}</ThemedText>
        <ThemedText style={[styles.headerMeta, { color: colors.mutedText }]}>
          {profileKindLabel(profile.kind)} · 最后更新 {formatShortDate(profile.updatedAt)}
        </ThemedText>
      </View>
      <Pressable
        accessibilityLabel="编辑"
        accessibilityRole="button"
        onPress={onEdit}
        style={({ pressed }) => [styles.headerAction, pressed && styles.pressed]}>
        <MaterialCommunityIcons name="pencil-outline" size={20} color={colors.primary} />
      </Pressable>
      <Pressable
        accessibilityLabel="删除"
        accessibilityRole="button"
        onPress={onDelete}
        style={({ pressed }) => [styles.headerAction, pressed && styles.pressed]}>
        <MaterialCommunityIcons name="trash-can-outline" size={20} color={colors.accent} />
      </Pressable>
    </View>
  );
}

function Editor({
  colors,
  editor,
  onBack,
  onError,
  onSave,
  persistAndSync,
  state,
}: {
  colors: Color;
  editor: EditorState;
  onBack: () => void;
  onError: (message: string) => void;
  onSave: (result: { profileId: string | null; message: string }) => void;
  persistAndSync: (state: SizeLibraryState, notice?: string, sync?: boolean) => void;
  state: SizeLibraryState;
}) {
  const profile = editor.profileId
    ? state.profiles.find((item) => item.id === editor.profileId)
    : undefined;
  const initialMap = profile ? getMeasurementMap(state, profile.id) : {};
  const [name, setName] = useState(profile?.name ?? '');
  const [relation, setRelation] = useState(profile?.relation ?? '');
  const [roomId, setRoomId] = useState(profile?.roomId ?? null);
  const [draft, setDraft] = useState<Record<string, DraftField>>(() => {
    const next: Record<string, DraftField> = {};
    for (const meta of SIZE_DIMENSION_META) {
      if (meta.kind !== editor.kind) continue;
      const item = initialMap[meta.key];
      next[meta.key] = {
        value: item?.value ?? '',
        unit: item?.unit ?? meta.unit,
        note: item?.note ?? '',
      };
    }
    return next;
  });
  const [customDrafts, setCustomDrafts] = useState<CustomDraft[]>(() =>
    state.measurements
      .filter((item) => item.profileId === editor.profileId && item.dimensionKey.startsWith('custom_'))
      .map((item) => ({
        id: item.dimensionKey.replace('custom_', ''),
        label: item.label,
        value: item.value,
        unit: item.unit,
        note: item.note,
      })),
  );
  const rooms = state.profiles.filter((item) => item.kind === 'room');
  const fields = SIZE_DIMENSION_META.filter((meta) => meta.kind === editor.kind);

  function updateDraft(key: string, patch: Partial<DraftField>) {
    setDraft((current) => ({
      ...current,
      [key]: {
        ...current[key],
        ...patch,
      },
    }));
  }

  function save() {
    let current = state;
    let profileId = editor.profileId;
    if (!profileId) {
      const added = addSizeProfile(current, editor.kind, name, relation, roomId);
      if (added.error || !added.profile) {
        onError(added.error ?? '保存失败');
        return;
      }
      profileId = added.profile.id;
      current = added.state;
    } else {
      const updated = updateSizeProfile(current, profileId, { name, relation, roomId });
      if (updated.error) {
        onError(updated.error);
        return;
      }
      current = updated.state;
    }

    for (const meta of fields) {
      const field = draft[meta.key];
      if (!field) continue;
      if (field.value.trim()) {
        const result = upsertSizeMeasurement(
          current,
          profileId,
          meta.key,
          meta.label,
          field.value,
          field.unit,
          field.note,
        );
        if (result.error) {
          onError(result.error);
          return;
        }
        current = result.state;
      } else if (getMeasurementMap(current, profileId)[meta.key]) {
        current = removeSizeMeasurement(current, profileId, meta.key);
      }
    }

    for (const custom of customDrafts) {
      const key = `custom_${custom.id}`;
      if (custom.label.trim() && custom.value.trim()) {
        const result = upsertSizeMeasurement(
          current,
          profileId,
          key,
          custom.label,
          custom.value,
          custom.unit,
          custom.note,
        );
        if (result.error) {
          onError(result.error);
          return;
        }
        current = result.state;
      } else if (getMeasurementMap(current, profileId)[key]) {
        current = removeSizeMeasurement(current, profileId, key);
      }
    }

    persistAndSync(current, '已保存真实尺寸');
    onSave({ profileId, message: '已保存真实尺寸' });
  }

  return (
    <>
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="返回"
          accessibilityRole="button"
          onPress={onBack}
          style={({ pressed }) => [styles.headerAction, pressed && styles.pressed]}>
          <MaterialCommunityIcons name="chevron-left" size={26} color={colors.text} />
        </Pressable>
        <View style={styles.headerTitleWrap}>
          <ThemedText style={styles.headerTitle}>
            {profile ? '编辑' : '添加'}{profileKindLabel(editor.kind)}
          </ThemedText>
          <ThemedText style={[styles.headerMeta, { color: colors.mutedText }]}>
            只保存真实录入的数据
          </ThemedText>
        </View>
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}>
        <View style={[styles.formCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <ThemedText style={[styles.fieldLabel, { color: colors.mutedText }]}>
            {profileKindLabel(editor.kind)}名称
          </ThemedText>
          <TextInput
            maxLength={editor.kind === 'person' ? 12 : 20}
            onChangeText={setName}
            placeholder={
              editor.kind === 'person' ? '请输入真实称呼' : `请输入${profileKindLabel(editor.kind)}名称`
            }
            placeholderTextColor={colors.mutedText}
            style={[styles.input, { backgroundColor: colors.surfaceMuted, borderColor: colors.line, color: colors.text }]}
            value={name}
          />
          {editor.kind === 'person' ? (
            <View style={styles.fieldSpacing}>
              <ThemedText style={[styles.fieldLabel, { color: colors.mutedText }]}>
                关系（选填）
              </ThemedText>
              <TextInput
                maxLength={12}
                onChangeText={setRelation}
                placeholder="例如：妈妈、爸爸、本人"
                placeholderTextColor={colors.mutedText}
                style={[styles.input, { backgroundColor: colors.surfaceMuted, borderColor: colors.line, color: colors.text }]}
                value={relation}
              />
            </View>
          ) : null}
          {editor.kind === 'desk' || editor.kind === 'curtain' ? (
            <View style={styles.fieldSpacing}>
              <ThemedText style={[styles.fieldLabel, { color: colors.mutedText }]}>
                放置房间（选填）
              </ThemedText>
              <View style={[styles.roomSelector, { backgroundColor: colors.surfaceMuted, borderColor: colors.line }]}>
                {rooms.length === 0 ? (
                  <ThemedText style={[styles.roomEmpty, { color: colors.mutedText }]}>
                    还没有房间，可先留空
                  </ThemedText>
                ) : (
                  rooms.map((room) => (
                    <Pressable
                      key={room.id}
                      accessibilityRole="button"
                      onPress={() => setRoomId(roomId === room.id ? null : room.id)}
                      style={[
                        styles.roomChip,
                        {
                          backgroundColor:
                            roomId === room.id ? colors.primarySoft : colors.surface,
                          borderColor: roomId === room.id ? colors.primary : colors.line,
                        },
                      ]}>
                      <ThemedText
                        style={[
                          styles.roomChipText,
                          { color: roomId === room.id ? colors.primary : colors.mutedText },
                        ]}>
                        {room.name}
                      </ThemedText>
                    </Pressable>
                  ))
                )}
              </View>
            </View>
          ) : null}
        </View>

        <View style={[styles.formCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          {fields.map((meta) => (
            <View key={meta.key} style={styles.fieldSpacing}>
              <ThemedText style={[styles.fieldLabel, { color: colors.mutedText }]}>
                {meta.label}
              </ThemedText>
              <View style={styles.inputRow}>
                <TextInput
                  keyboardType={meta.numeric ? 'decimal-pad' : 'default'}
                  maxLength={meta.numeric ? 10 : 40}
                  onChangeText={(value) => updateDraft(meta.key, { value })}
                  placeholder={`请输入${meta.label}`}
                  placeholderTextColor={colors.mutedText}
                  style={[styles.input, { backgroundColor: colors.surfaceMuted, borderColor: colors.line, color: colors.text }]}
                  value={draft[meta.key]?.value ?? ''}
                />
                {meta.unit ? (
                  <ThemedText style={[styles.inputUnit, { color: colors.mutedText }]}>
                    {meta.unit}
                  </ThemedText>
                ) : null}
              </View>
              <TextInput
                maxLength={60}
                onChangeText={(note) => updateDraft(meta.key, { note })}
                placeholder="备注（选填）"
                placeholderTextColor={colors.mutedText}
                style={[
                  styles.noteInput,
                  { backgroundColor: colors.surfaceMuted, borderColor: colors.line, color: colors.text },
                ]}
                value={draft[meta.key]?.note ?? ''}
              />
            </View>
          ))}
        </View>

        {editor.kind === 'person' ? (
          <View style={[styles.formCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <View style={styles.dimGroupHead}>
              <ThemedText style={styles.sectionTitle}>其他尺寸</ThemedText>
              <ThemedText style={[styles.dimGroupCount, { color: colors.mutedText }]}>
                最多 {SIZE_LIBRARY_MAX_CUSTOM_MEASUREMENTS} 条
              </ThemedText>
            </View>
            {customDrafts.map((custom, index) => (
              <View key={custom.id} style={styles.customBlock}>
                <View style={styles.customHead}>
                  <TextInput
                    maxLength={20}
                    onChangeText={(label) =>
                      setCustomDrafts((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, label } : item,
                        ),
                      )
                    }
                    placeholder="尺寸名称"
                    placeholderTextColor={colors.mutedText}
                    style={[
                      styles.input,
                      styles.customNameInput,
                      { backgroundColor: colors.surfaceMuted, borderColor: colors.line, color: colors.text },
                    ]}
                    value={custom.label}
                  />
                  <Pressable
                    accessibilityLabel="删除其他尺寸"
                    accessibilityRole="button"
                    onPress={() =>
                      setCustomDrafts((current) => current.filter((_, itemIndex) => itemIndex !== index))
                    }
                    style={({ pressed }) => [styles.removeButton, pressed && styles.pressed]}>
                    <MaterialCommunityIcons name="close" size={18} color={colors.accent} />
                  </Pressable>
                </View>
                <View style={styles.inputRow}>
                  <TextInput
                    keyboardType="default"
                    maxLength={40}
                    onChangeText={(value) =>
                      setCustomDrafts((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, value } : item,
                        ),
                      )
                    }
                    placeholder="请输入数值"
                    placeholderTextColor={colors.mutedText}
                    style={[
                      styles.input,
                      { backgroundColor: colors.surfaceMuted, borderColor: colors.line, color: colors.text },
                    ]}
                    value={custom.value}
                  />
                  <TextInput
                    maxLength={4}
                    onChangeText={(unit) =>
                      setCustomDrafts((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, unit } : item,
                        ),
                      )
                    }
                    placeholder="单位"
                    placeholderTextColor={colors.mutedText}
                    style={[
                      styles.unitInput,
                      { backgroundColor: colors.surfaceMuted, borderColor: colors.line, color: colors.text },
                    ]}
                    value={custom.unit}
                  />
                </View>
              </View>
            ))}
            <Pressable
              accessibilityRole="button"
              disabled={customDrafts.length >= SIZE_LIBRARY_MAX_CUSTOM_MEASUREMENTS}
              onPress={() =>
                setCustomDrafts((current) => [
                  ...current,
                  {
                    id: `${Date.now()}_${current.length}`,
                    label: '',
                    value: '',
                    unit: '',
                    note: '',
                  },
                ])
              }
              style={({ pressed }) => [
                styles.addCustomButton,
                { backgroundColor: colors.primarySoft, borderColor: colors.primary },
                pressed && styles.pressed,
              ]}>
              <MaterialCommunityIcons name="plus" size={16} color={colors.primary} />
              <ThemedText style={[styles.addCustomText, { color: colors.primary }]}>
                添加其他尺寸
              </ThemedText>
            </Pressable>
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          onPress={save}
          style={({ pressed }) => [
            styles.saveButton,
            { backgroundColor: colors.primary },
            pressed && styles.pressed,
          ]}>
          <MaterialCommunityIcons name="content-save-outline" size={18} color="#ffffff" />
          <ThemedText style={styles.saveButtonText}>保存尺寸</ThemedText>
        </Pressable>
      </ScrollView>
    </>
  );
}

function ProfileRow({
  colors,
  onPress,
  profile,
}: {
  colors: Color;
  onPress: () => void;
  profile: SizeProfile;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.profileRow,
        { borderBottomColor: colors.line },
        pressed && styles.pressed,
      ]}>
      <View style={[styles.miniAvatar, { backgroundColor: colors.primarySoft }]}>
        <ThemedText style={[styles.miniAvatarText, { color: colors.primary }]}>
          {profile.name.slice(0, 1)}
        </ThemedText>
      </View>
      <View style={styles.profileCopy}>
        <ThemedText style={styles.profileName}>{profile.name}</ThemedText>
        <ThemedText style={[styles.profileMeta, { color: colors.mutedText }]}>
          {profileKindLabel(profile.kind)}
          {profile.relation ? ` · ${profile.relation}` : ''}
        </ThemedText>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={20} color={colors.mutedText} />
    </Pressable>
  );
}

function detailScenario(kind: SizeProfileKind): SizeShoppingScenario | null {
  const map: Record<SizeProfileKind, SizeShoppingScenario> = {
    person: 'clothes',
    room: 'room',
    desk: 'desk',
    curtain: 'curtain',
  };
  return map[kind];
}

function scenarioIcon(scenario: SizeShoppingScenario) {
  const icons: Record<SizeShoppingScenario, ComponentProps<typeof MaterialCommunityIcons>['name']> = {
    clothes: 'tshirt-crew-outline',
    shoes: 'shoe-sneaker',
    ring: 'diamond-stone',
    desk: 'desk',
    curtain: 'blinds',
    room: 'sofa-outline',
  };
  return icons[scenario];
}

function formatShortDate(timestamp: number) {
  if (!timestamp) return '暂无';
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
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
  headerAction: {
    alignItems: 'center',
    borderRadius: 10,
    height: 36,
    justifyContent: 'center',
    width: 36,
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
    gap: 12,
    paddingBottom: 40,
    paddingHorizontal: 14,
    paddingTop: 12,
  },
  heroCard: {
    borderRadius: 20,
    padding: 16,
  },
  heroIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(201, 243, 106, 0.14)',
    borderColor: 'rgba(201, 243, 106, 0.28)',
    borderRadius: 12,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  heroTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '900',
    marginTop: 12,
  },
  heroText: {
    color: 'rgba(255, 255, 255, 0.72)',
    fontSize: 10,
    fontWeight: '600',
    lineHeight: 16,
    marginTop: 5,
  },
  heroMetaRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  heroMeta: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderColor: 'rgba(255, 255, 255, 0.14)',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  heroMetaText: {
    color: 'rgba(255, 255, 255, 0.9)',
    fontSize: 9,
    fontWeight: '800',
  },
  quickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  quickItem: {
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 14,
    flexBasis: '31%',
    flexGrow: 1,
    gap: 7,
    minHeight: 64,
    justifyContent: 'center',
  },
  quickItemText: {
    fontSize: 10,
    fontWeight: '800',
  },
  panelCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 12,
  },
  panelHead: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  panelTitle: {
    fontSize: 13,
    fontWeight: '900',
  },
  panelAdd: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  panelAddText: {
    fontSize: 10,
    fontWeight: '900',
  },
  panelEmpty: {
    fontSize: 10,
    fontWeight: '700',
    paddingVertical: 14,
  },
  sectionCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 13,
  },
  sectionHead: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '900',
  },
  addButton: {
    alignItems: 'center',
    borderRadius: 10,
    flexDirection: 'row',
    gap: 4,
    height: 34,
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  addButtonText: {
    color: '#ffffff',
    fontSize: 10,
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
  emptyCard: {
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 20,
    padding: 24,
  },
  emptyIcon: {
    alignItems: 'center',
    borderRadius: 999,
    height: 68,
    justifyContent: 'center',
    width: 68,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '900',
    marginTop: 14,
  },
  emptyText: {
    fontSize: 10,
    fontWeight: '600',
    lineHeight: 17,
    marginBottom: 14,
    marginTop: 6,
    textAlign: 'center',
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 6,
    height: 44,
    justifyContent: 'center',
    marginTop: 8,
    paddingHorizontal: 16,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '900',
  },
  secondaryButton: {
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    flexDirection: 'row',
    gap: 6,
    height: 44,
    justifyContent: 'center',
    marginTop: 8,
    paddingHorizontal: 16,
  },
  secondaryButtonText: {
    fontSize: 11,
    fontWeight: '900',
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
    height: 34,
    justifyContent: 'center',
  },
  segmentText: {
    fontSize: 10,
    fontWeight: '900',
  },
  scenarioGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  scenarioChip: {
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 999,
    flexDirection: 'row',
    gap: 5,
    height: 34,
    paddingHorizontal: 11,
  },
  scenarioText: {
    fontSize: 9,
    fontWeight: '900',
  },
  fieldLabel: {
    fontSize: 9,
    fontWeight: '800',
    marginBottom: 6,
  },
  selectorCard: {
    borderWidth: 1,
    borderRadius: 14,
    overflow: 'hidden',
  },
  profileRow: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 56,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  miniAvatar: {
    alignItems: 'center',
    borderRadius: 10,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  miniAvatarText: {
    fontSize: 12,
    fontWeight: '900',
  },
  profileCopy: {
    flex: 1,
    minWidth: 0,
  },
  profileName: {
    fontSize: 12,
    fontWeight: '900',
  },
  profileMeta: {
    fontSize: 9,
    fontWeight: '700',
    marginTop: 2,
  },
  checkCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 13,
  },
  checkHead: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
  },
  checkIcon: {
    alignItems: 'center',
    borderRadius: 11,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  checkTitle: {
    fontSize: 13,
    fontWeight: '900',
  },
  checkMeta: {
    fontSize: 8.5,
    fontWeight: '700',
    marginTop: 2,
  },
  checkRow: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 38,
  },
  checkLabel: {
    flex: 1,
    fontSize: 10,
    fontWeight: '700',
  },
  checkValue: {
    fontFamily: 'System',
    fontSize: 12,
    fontWeight: '800',
  },
  checkUnit: {
    fontSize: 9,
    fontWeight: '700',
  },
  noteRow: {
    alignItems: 'center',
    borderRadius: 9,
    flexDirection: 'row',
    gap: 6,
    marginVertical: 8,
    padding: 8,
  },
  noteText: {
    flex: 1,
    fontSize: 8.5,
    fontWeight: '700',
    lineHeight: 14,
  },
  detailHero: {
    alignItems: 'center',
    borderRadius: 20,
    flexDirection: 'row',
    gap: 12,
    padding: 16,
  },
  detailAvatar: {
    alignItems: 'center',
    borderRadius: 14,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  detailAvatarText: {
    fontSize: 16,
    fontWeight: '900',
  },
  detailHeroTitle: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '900',
  },
  detailHeroMeta: {
    color: 'rgba(255, 255, 255, 0.72)',
    fontSize: 10,
    fontWeight: '700',
    marginTop: 3,
  },
  measureCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
  },
  measureLabel: {
    fontSize: 9,
    fontWeight: '700',
  },
  measureValue: {
    fontSize: 18,
    fontWeight: '900',
    marginTop: 5,
  },
  measureUnit: {
    fontSize: 9,
    fontWeight: '700',
    marginLeft: 3,
  },
  dimGroup: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
  },
  dimGroupHead: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  dimGroupCount: {
    fontSize: 8.5,
    fontWeight: '800',
  },
  dimRow: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 42,
  },
  dimLabel: {
    flex: 1,
    fontSize: 10,
    fontWeight: '700',
  },
  dimValue: {
    fontSize: 12,
    fontWeight: '800',
  },
  dimUnit: {
    fontSize: 9,
    fontWeight: '700',
  },
  areaCard: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 7,
    padding: 11,
  },
  areaText: {
    fontSize: 10,
    fontWeight: '900',
  },
  roomName: {
    fontSize: 11,
    fontWeight: '700',
    marginTop: 6,
  },
  detailActions: {
    flexDirection: 'row',
    gap: 8,
  },
  formCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 13,
  },
  fieldSpacing: {
    marginTop: 12,
  },
  inputRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  input: {
    borderRadius: 11,
    borderWidth: 1,
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    height: 42,
    minWidth: 0,
    paddingHorizontal: 11,
    paddingVertical: 0,
  },
  inputUnit: {
    fontSize: 10,
    fontWeight: '800',
    width: 26,
  },
  noteInput: {
    borderRadius: 10,
    borderWidth: 1,
    fontSize: 10,
    fontWeight: '600',
    height: 38,
    marginTop: 7,
    paddingHorizontal: 11,
    paddingVertical: 0,
  },
  roomSelector: {
    borderRadius: 11,
    borderWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    padding: 8,
  },
  roomChip: {
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 999,
    minHeight: 30,
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  roomChipText: {
    fontSize: 9,
    fontWeight: '800',
  },
  roomEmpty: {
    fontSize: 9,
    fontWeight: '700',
    paddingVertical: 4,
  },
  customBlock: {
    borderTopWidth: 1,
    marginTop: 10,
    paddingTop: 10,
  },
  customHead: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  customNameInput: {
    flex: 1,
  },
  removeButton: {
    alignItems: 'center',
    borderRadius: 9,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  unitInput: {
    borderRadius: 10,
    borderWidth: 1,
    fontSize: 11,
    fontWeight: '700',
    height: 42,
    paddingHorizontal: 8,
    textAlign: 'center',
    width: 62,
  },
  addCustomButton: {
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 11,
    flexDirection: 'row',
    gap: 5,
    height: 38,
    justifyContent: 'center',
    marginTop: 12,
  },
  addCustomText: {
    fontSize: 10,
    fontWeight: '900',
  },
  saveButton: {
    alignItems: 'center',
    borderRadius: 14,
    flexDirection: 'row',
    gap: 7,
    height: 48,
    justifyContent: 'center',
  },
  saveButtonText: {
    color: '#ffffff',
    fontSize: 12,
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
