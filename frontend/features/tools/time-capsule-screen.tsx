import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as DocumentPicker from 'expo-document-picker';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState, type ComponentProps } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/features/auth/auth-provider';
import { useAppTheme } from '@/hooks/use-app-theme';
import { getAPIBaseUrl } from '@/lib/auth-api';
import {
  acceptTimeCapsuleInvite,
  addTimeCapsuleContent,
  archiveTimeCapsule,
  createTimeCapsule,
  declineTimeCapsuleInvite,
  deleteTimeCapsule,
  exitTimeCapsule,
  fetchTimeCapsule,
  fetchTimeCapsuleBirthday,
  fetchTimeCapsuleDaysLeftSources,
  fetchTimeCapsuleFocusSources,
  fetchTimeCapsuleHome,
  fetchTimeCapsuleNotifications,
  getTimeCapsuleErrorMessage,
  markTimeCapsuleNotificationsRead,
  sealTimeCapsule,
  updateTimeCapsule,
  uploadTimeCapsuleMedia,
} from '@/lib/time-capsule-api';
import { listFriends } from '@/lib/social-api';
import { MobileScreen } from '@/shared/ui/mobile-screen';
import { PageHeader } from '@/shared/ui/page-header';
import { SurfaceCard } from '@/shared/ui/surface-card';
import type {
  DaysLeftSource,
  FocusSource,
  TimeCapsule,
  TimeCapsuleContent,
  TimeCapsuleDetail,
  TimeCapsuleHome,
  TimeCapsuleInput,
  TimeCapsuleMember,
  TimeCapsuleNotification,
} from '@/types/time-capsule';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];
type Tab = 'home' | 'create' | 'notifications';

type CreateFormState = {
  mode: TimeCapsuleInput['mode'];
  title: string;
  note: string;
  openRule: TimeCapsuleInput['openRule'];
  openAt: string;
  openTimezone: string;
  friendId: string;
  linkedDaysLeftId: string;
  linkedFocusGoalId: string;
  linkedFocusTaskId: string;
};

const OPEN_RULES: { key: TimeCapsuleInput['openRule']; label: string; icon: IconName }[] = [
  { key: 'date', label: '日期', icon: 'calendar-outline' },
  { key: 'birthday', label: '生日', icon: 'cake-variant-outline' },
  { key: 'days_left', label: '还有几天', icon: 'calendar-clock-outline' },
  { key: 'focus_goal', label: '目标', icon: 'target' },
];

export function TimeCapsuleScreen() {
  const router = useRouter();
  const { accessToken, status: authStatus, user } = useAuth();
  const { colors, colorScheme } = useAppTheme();
  const dark = colorScheme === 'dark';

  const [tab, setTab] = useState<Tab>('home');
  const [home, setHome] = useState<TimeCapsuleHome | null>(null);
  const [notifications, setNotifications] = useState<TimeCapsuleNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [form, setForm] = useState<CreateFormState>({
    mode: 'personal' as TimeCapsuleInput['mode'],
    title: '',
    note: '',
    openRule: 'date' as TimeCapsuleInput['openRule'],
    openAt: '',
    openTimezone: 'Asia/Shanghai',
    friendId: '',
    linkedDaysLeftId: '',
    linkedFocusGoalId: '',
    linkedFocusTaskId: '',
  });
  const [textContent, setTextContent] = useState('');
  const [photo, setPhoto] = useState<{ mediaId: string; uri: string } | null>(null);
  const [voice, setVoice] = useState<{ mediaId: string; name: string } | null>(null);
  const [friends, setFriends] = useState<{ id: string; displayName: string }[]>([]);
  const [birthday, setBirthday] = useState('');
  const [daysLeftSources, setDaysLeftSources] = useState<DaysLeftSource[]>([]);
  const [focusSources, setFocusSources] = useState<FocusSource[]>([]);
  const [detail, setDetail] = useState<TimeCapsuleDetail | null>(null);
  const [detailId, setDetailId] = useState('');

  const refreshHome = useCallback(async () => {
    if (!accessToken) return;
    setError('');
    try {
      const [homeData, notificationData] = await Promise.all([
        fetchTimeCapsuleHome(accessToken),
        fetchTimeCapsuleNotifications(accessToken),
      ]);
      setHome(homeData);
      setNotifications(notificationData);
    } catch (nextError) {
      setError(getTimeCapsuleErrorMessage(nextError));
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  const refreshSources = useCallback(async () => {
    if (!accessToken) return;
    try {
      const [friendData, birthdayData, daysLeftData, focusData] = await Promise.all([
        listFriends(accessToken),
        fetchTimeCapsuleBirthday(accessToken),
        fetchTimeCapsuleDaysLeftSources(accessToken),
        fetchTimeCapsuleFocusSources(accessToken),
      ]);
      setFriends(friendData.map((item) => ({ id: item.user.id, displayName: item.user.displayName })));
      setBirthday(birthdayData.birthday);
      setDaysLeftSources(daysLeftData);
      setFocusSources(focusData);
    } catch {
      // Source lists are non-blocking; creation still validates on the server.
    }
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) return;
    void refreshHome();
    void refreshSources();
  }, [accessToken, refreshHome, refreshSources]);

  const openDetail = useCallback(async (capsuleId: string) => {
    if (!accessToken) return;
    setDetailId(capsuleId);
    setDetail(null);
    setError('');
    try {
      setDetail(await fetchTimeCapsule(accessToken, capsuleId));
    } catch (nextError) {
      setError(getTimeCapsuleErrorMessage(nextError));
      setDetailId('');
    }
  }, [accessToken]);

  async function runAction(action: () => Promise<unknown>, successText: string) {
    if (busy || !accessToken) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
      setMessage(successText);
      await refreshHome();
      if (detailId) await openDetail(detailId);
    } catch (nextError) {
      setError(getTimeCapsuleErrorMessage(nextError));
    } finally {
      setBusy(false);
    }
  }

  async function pickPhoto() {
    if (!accessToken || !detailId) {
      setError('请先创建胶囊，再添加照片。');
      return;
    }
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('需要相册权限才能选择照片。');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.9,
    });
    const asset = result.assets?.[0];
    if (!asset) return;
    setBusy(true);
    try {
      const uploaded = await uploadTimeCapsuleMedia(accessToken, detailId, 'photo', {
        uri: asset.uri,
        name: asset.fileName || 'capsule.jpg',
        type: asset.mimeType || 'image/jpeg',
      });
      await addTimeCapsuleContent(accessToken, detailId, {
        kind: 'photo',
        mediaId: uploaded.media.id,
      });
      setPhoto({ mediaId: uploaded.media.id, uri: uploaded.draftUrl });
      await openDetail(detailId);
      setMessage('照片已放入胶囊。');
    } catch (nextError) {
      setError(getTimeCapsuleErrorMessage(nextError));
    } finally {
      setBusy(false);
    }
  }

  async function pickVoice() {
    if (!accessToken || !detailId) {
      setError('请先创建胶囊，再添加语音。');
      return;
    }
    const result = await DocumentPicker.getDocumentAsync({
      type: ['audio/*', 'video/*'],
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setBusy(true);
    try {
      const uploaded = await uploadTimeCapsuleMedia(accessToken, detailId, 'voice', {
        uri: asset.uri,
        name: asset.name || 'capsule.m4a',
        type: asset.mimeType || 'audio/mp4',
      });
      await addTimeCapsuleContent(accessToken, detailId, {
        kind: 'voice',
        mediaId: uploaded.media.id,
      });
      setVoice({ mediaId: uploaded.media.id, name: asset.name || '语音文件' });
      await openDetail(detailId);
      setMessage('语音已放入胶囊。');
    } catch (nextError) {
      setError(getTimeCapsuleErrorMessage(nextError));
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft(sealNow: boolean) {
    if (!accessToken) return;
    if (!form.title.trim()) {
      setError('请填写胶囊标题。');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const input: TimeCapsuleInput = {
        mode: form.mode,
        title: form.title.trim(),
        note: form.note.trim(),
        openRule: form.openRule,
        openTimezone: form.openTimezone,
      };
      if (form.openRule === 'date' && form.openAt) {
        input.openAt = new Date(form.openAt).toISOString();
      }
      if (form.openRule === 'days_left' && form.linkedDaysLeftId) {
        input.linkedDaysLeftId = form.linkedDaysLeftId;
      }
      if (form.openRule === 'focus_goal' && form.linkedFocusGoalId) {
        input.linkedFocusGoalId = form.linkedFocusGoalId;
      }
      if (form.openRule === 'focus_task' && form.linkedFocusTaskId) {
        input.linkedFocusTaskId = form.linkedFocusTaskId;
      }
      if (form.mode === 'joint' && form.friendId) {
        input.friendId = form.friendId;
      }
      const created = await createTimeCapsule(accessToken, input);
      const capsuleId = created.capsule.id;
      const hasMedia = Boolean(photo || voice);
      if (textContent.trim() || hasMedia) {
        if (textContent.trim()) {
          await addTimeCapsuleContent(accessToken, capsuleId, {
            kind: 'text',
            textContent: textContent.trim(),
          });
        }
        if (photo?.mediaId) {
          await addTimeCapsuleContent(accessToken, capsuleId, {
            kind: 'photo',
            mediaId: photo.mediaId,
          });
        }
        if (voice?.mediaId) {
          await addTimeCapsuleContent(accessToken, capsuleId, {
            kind: 'voice',
            mediaId: voice.mediaId,
          });
        }
      }
      if (sealNow && form.mode === 'personal') {
        await sealTimeCapsule(accessToken, capsuleId);
      } else if (sealNow && form.mode === 'joint') {
        setMessage('邀请已发送，等待好友接受并放入内容后即可封存。');
      }
      setMessage(sealNow && form.mode === 'personal' ? '胶囊已封存。' : '草稿已保存。');
      await refreshHome();
      if (sealNow && form.mode === 'personal') {
        await openDetail(capsuleId);
      } else {
        setTab('home');
      }
      setForm({
        mode: 'personal',
        title: '',
        note: '',
        openRule: 'date',
        openAt: '',
        openTimezone: 'Asia/Shanghai',
        friendId: '',
        linkedDaysLeftId: '',
        linkedFocusGoalId: '',
        linkedFocusTaskId: '',
      });
      setTextContent('');
      setPhoto(null);
      setVoice(null);
    } catch (nextError) {
      setError(getTimeCapsuleErrorMessage(nextError));
    } finally {
      setBusy(false);
    }
  }

  async function acceptInvite(capsuleId: string) {
    if (!accessToken) return;
    await runAction(() => acceptTimeCapsuleInvite(accessToken, capsuleId), '已接受邀请，可以放入内容。');
  }

  if (authStatus === 'loading') {
    return (
      <MobileScreen contentContainerStyle={styles.center}>
        <ActivityIndicator color={colors.primary} />
        <ThemedText style={styles.centerText}>正在打开时间胶囊</ThemedText>
      </MobileScreen>
    );
  }

  if (!accessToken) {
    return (
      <MobileScreen contentContainerStyle={styles.center}>
        <View style={[styles.stateIcon, { backgroundColor: colors.primarySoft }]}>
          <MaterialCommunityIcons name="clock-fast" size={34} color={colors.primary} />
        </View>
        <ThemedText style={styles.stateTitle}>登录后使用时间胶囊</ThemedText>
        <ThemedText style={[styles.stateText, { color: colors.mutedText }]}>
          你的胶囊、好友邀请和真实内容都会保存在 FunBox 账号里。
        </ThemedText>
        <Pressable
          onPress={() => router.push({ pathname: '/auth', params: { returnTo: '/tools/time-capsule' } })}
          style={[styles.primaryButton, { backgroundColor: colors.hero }]}>
          <MaterialCommunityIcons name="login" size={18} color="#ffffff" />
          <ThemedText style={styles.primaryButtonText}>登录</ThemedText>
        </Pressable>
      </MobileScreen>
    );
  }

  return (
    <MobileScreen contentContainerStyle={styles.page}>
      <PageHeader
        eyebrow="Time Capsule"
        title="时间胶囊"
        subtitle="把今天寄给未来的自己或我们"
        rightSlot={
          <Pressable
            accessibilityLabel="返回"
            onPress={() => router.back()}
            style={[styles.iconButton, { backgroundColor: colors.surface }]}>
            <MaterialCommunityIcons name="arrow-left" size={21} color={colors.text} />
          </Pressable>
        }
      />

      <View style={[styles.tabs, { backgroundColor: colors.surfaceMuted, borderColor: colors.line }]}>
        {(
          [
            ['home', '首页', 'home-outline'],
            ['create', '创建', 'plus'],
            ['notifications', '通知', 'bell-outline'],
          ] as const
        ).map(([key, label, icon]) => (
          <Pressable
            key={key}
            onPress={() => setTab(key)}
            style={[styles.tabButton, tab === key && { backgroundColor: colors.surface }]}>
            <MaterialCommunityIcons
              name={icon}
              size={15}
              color={tab === key ? colors.primary : colors.mutedText}
            />
            <ThemedText style={[styles.tabLabel, { color: tab === key ? colors.primary : colors.mutedText }]}>
              {label}
            </ThemedText>
          </Pressable>
        ))}
      </View>

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

      {loading ? (
        <SurfaceCard style={styles.card}>
          <ActivityIndicator color={colors.primary} />
          <ThemedText style={[styles.cardHint, { color: colors.mutedText }]}>正在读取真实记录</ThemedText>
        </SurfaceCard>
      ) : null}

      {tab === 'home' && home ? <HomeTab home={home} onOpen={openDetail} onAccept={acceptInvite} onNew={() => setTab('create')} colors={colors} dark={dark} /> : null}
      {tab === 'create' ? (
        <CreateTab
          form={form}
          setForm={setForm}
          textContent={textContent}
          setTextContent={setTextContent}
          photo={photo}
          voice={voice}
          friends={friends}
          birthday={birthday}
          daysLeftSources={daysLeftSources}
          focusSources={focusSources}
          busy={busy}
          onSave={() => void saveDraft(false)}
          onSeal={() => void saveDraft(true)}
          colors={colors}
          dark={dark}
        />
      ) : null}
      {tab === 'notifications' ? (
        <NotificationsTab
          notifications={notifications}
          onOpen={(id) => {
            setTab('home');
            void openDetail(id);
            if (accessToken) void markTimeCapsuleNotificationsRead(accessToken, notifications.filter((n) => n.capsuleId === id).map((n) => n.id));
          }}
          colors={colors}
        />
      ) : null}

      {detailId ? (
        <DetailCard
          detail={detail}
          currentUserId={user?.id ?? ''}
          busy={busy}
          onClose={() => setDetailId('')}
          onAccept={() => void runAction(() => acceptTimeCapsuleInvite(accessToken, detailId), '已接受邀请。')}
          onDecline={() => void runAction(() => declineTimeCapsuleInvite(accessToken, detailId), '已拒绝邀请。')}
          onExit={() => void runAction(() => exitTimeCapsule(accessToken, detailId), '已退出共同创建。')}
          onSeal={() => void runAction(() => sealTimeCapsule(accessToken, detailId), '胶囊已封存。')}
          onArchive={() => void runAction(() => archiveTimeCapsule(accessToken, detailId), '已归档。')}
          onDelete={() => void runAction(() => deleteTimeCapsule(accessToken, detailId), '草稿已删除。')}
          onPickPhoto={() => void pickPhoto()}
          onPickVoice={() => void pickVoice()}
          colors={colors}
          dark={dark}
        />
      ) : null}
    </MobileScreen>
  );
}

function HomeTab(props: {
  home: TimeCapsuleHome;
  onOpen: (id: string) => void;
  onAccept: (id: string) => void;
  onNew: () => void;
  colors: ReturnType<typeof useAppTheme>['colors'];
  dark: boolean;
}) {
  const { home, onOpen, onAccept, onNew, colors, dark } = props;
  return (
    <>
      <SurfaceCard style={[styles.heroCard, dark ? styles.heroDark : styles.heroLight]}>
        <View style={styles.heroIcon}>
          <MaterialCommunityIcons name="clock-fast" size={22} color="#f2bd70" />
        </View>
        <ThemedText style={styles.heroTitle}>
          {home.capsules.length === 0 ? '还没有时间胶囊' : `${home.counts.sealed} 个胶囊等待开启`}
        </ThemedText>
        <ThemedText style={[styles.heroSub, { color: 'rgba(255,255,255,0.72)' }]}>
          首次进入为空态，所有内容都来自你的真实录入。
        </ThemedText>
        <View style={styles.heroStats}>
          <View style={styles.heroStat}>
            <ThemedText style={styles.heroStatValue}>{home.counts.draft}</ThemedText>
            <ThemedText style={styles.heroStatLabel}>草稿</ThemedText>
          </View>
          <View style={styles.heroStat}>
            <ThemedText style={styles.heroStatValue}>{home.counts.sealed}</ThemedText>
            <ThemedText style={styles.heroStatLabel}>待开启</ThemedText>
          </View>
          <View style={styles.heroStat}>
            <ThemedText style={styles.heroStatValue}>{home.counts.opened}</ThemedText>
            <ThemedText style={styles.heroStatLabel}>已开启</ThemedText>
          </View>
          <View style={styles.heroStat}>
            <ThemedText style={styles.heroStatValue}>{home.counts.invitations}</ThemedText>
            <ThemedText style={styles.heroStatLabel}>邀请</ThemedText>
          </View>
        </View>
      </SurfaceCard>

      {home.invitations.length > 0 ? (
        <>
          <SectionTitle title="待处理邀请" meta={`${home.invitations.length} 条真实邀请`} />
          {home.invitations.map((capsule) => (
            <SurfaceCard key={capsule.id} style={styles.listCard}>
              <View style={[styles.listIcon, { backgroundColor: '#fff3dc' }]}>
                <MaterialCommunityIcons name="account-heart-outline" size={18} color="#bd7620" />
              </View>
              <View style={styles.listCopy}>
                <ThemedText style={styles.listTitle}>{capsule.title}</ThemedText>
                <ThemedText style={[styles.listMeta, { color: colors.mutedText }]}>
                  双人共同创建 · 等待你的回应
                </ThemedText>
              </View>
              <Pressable onPress={() => onAccept(capsule.id)} style={[styles.smallButton, { backgroundColor: colors.hero }]}>
                <ThemedText style={styles.smallButtonText}>接受</ThemedText>
              </Pressable>
            </SurfaceCard>
          ))}
        </>
      ) : null}

      <SectionTitle title="我的胶囊" meta={`${home.capsules.length} 条真实记录`} />
      {home.capsules.length === 0 ? (
        <SurfaceCard style={[styles.emptyCard, { borderColor: colors.line }]}>
          <MaterialCommunityIcons name="timer-sand-empty" size={30} color={colors.mutedText} />
          <ThemedText style={styles.emptyTitle}>首启为空，不预置任何数据</ThemedText>
          <ThemedText style={[styles.emptyText, { color: colors.mutedText }]}>
            写一句话、放一张照片或录一段语音，封存到未来。
          </ThemedText>
          <Pressable onPress={onNew} style={[styles.primaryButton, { backgroundColor: colors.hero, width: '100%' }]}>
            <MaterialCommunityIcons name="plus" size={18} color="#ffffff" />
            <ThemedText style={styles.primaryButtonText}>新建胶囊</ThemedText>
          </Pressable>
        </SurfaceCard>
      ) : (
        home.capsules.map((capsule) => (
          <Pressable key={capsule.id} onPress={() => onOpen(capsule.id)}>
            <SurfaceCard style={styles.capsuleCard}>
              <View style={[styles.capsuleIcon, { backgroundColor: '#fff3dc' }]}>
                <MaterialCommunityIcons name="lock-outline" size={18} color="#bd7620" />
              </View>
              <View style={styles.capsuleCopy}>
                <ThemedText style={styles.capsuleTitle}>{capsule.title}</ThemedText>
                <ThemedText style={[styles.capsuleMeta, { color: colors.mutedText }]}>
                  {statusLabel(capsule.status)} · {capsule.mode === 'joint' ? '双人' : '个人'} · {capsule.contentCount} 条内容
                </ThemedText>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={18} color={colors.mutedText} />
            </SurfaceCard>
          </Pressable>
        ))
      )}
    </>
  );
}

function CreateTab(props: {
  form: CreateFormState;
  setForm: (next: CreateFormState) => void;
  textContent: string;
  setTextContent: (value: string) => void;
  photo: { mediaId: string; uri: string } | null;
  voice: { mediaId: string; name: string } | null;
  friends: { id: string; displayName: string }[];
  birthday: string;
  daysLeftSources: DaysLeftSource[];
  focusSources: FocusSource[];
  busy: boolean;
  onSave: () => void;
  onSeal: () => void;
  colors: ReturnType<typeof useAppTheme>['colors'];
  dark: boolean;
}) {
  const { form, setForm, textContent, setTextContent, photo, voice, friends, birthday, daysLeftSources, focusSources, busy, onSave, onSeal, colors, dark } = props;
  return (
    <SurfaceCard style={styles.formCard}>
      <View style={styles.segmented}>
        {(
          [
            ['personal', '单人', 'account-outline'],
            ['joint', '双人', 'account-group-outline'],
          ] as const
        ).map(([key, label, icon]) => (
          <Pressable
            key={key}
            onPress={() => setForm({ ...form, mode: key, friendId: '' })}
            style={[styles.segButton, form.mode === key && { backgroundColor: colors.surface }]}>
            <MaterialCommunityIcons
              name={icon}
              size={15}
              color={form.mode === key ? colors.primary : colors.mutedText}
            />
            <ThemedText style={[styles.segLabel, { color: form.mode === key ? colors.primary : colors.mutedText }]}>
              {label}
            </ThemedText>
          </Pressable>
        ))}
      </View>

      <FieldLabel label="胶囊标题" />
      <TextInput
        maxLength={40}
        onChangeText={(value) => setForm({ ...form, title: value })}
        placeholder="写给未来的自己"
        placeholderTextColor={colors.mutedText}
        style={[styles.input, { backgroundColor: colors.surfaceMuted, borderColor: colors.line, color: colors.text }]}
        value={form.title}
      />

      <FieldLabel label="开启条件" />
      <View style={styles.ruleRow}>
        {OPEN_RULES.map((rule) => (
          <Pressable
            key={rule.key}
            onPress={() => setForm({ ...form, openRule: rule.key, openAt: '', linkedDaysLeftId: '', linkedFocusGoalId: '', linkedFocusTaskId: '' })}
            style={[styles.rulePill, form.openRule === rule.key && { backgroundColor: '#fff3dc', borderColor: '#edc681' }]}>
            <MaterialCommunityIcons name={rule.icon} size={14} color={form.openRule === rule.key ? '#bd7620' : colors.mutedText} />
            <ThemedText style={[styles.ruleText, { color: form.openRule === rule.key ? '#bd7620' : colors.mutedText }]}>{rule.label}</ThemedText>
          </Pressable>
        ))}
      </View>

      {form.openRule === 'date' ? (
        <>
          <View style={styles.presetRow}>
            {[
              ['1 个月后', 1, 'month'],
              ['3 个月后', 3, 'month'],
              ['1 年后', 1, 'year'],
            ].map(([label, value, unit]) => (
              <Pressable
                key={label as string}
                onPress={() => setForm({ ...form, openAt: addDuration(value as number, unit as 'month' | 'year').toISOString() })}
                style={[styles.chip, { borderColor: colors.line }]}>
                <ThemedText style={[styles.chipText, { color: colors.mutedText }]}>{label}</ThemedText>
              </Pressable>
            ))}
          </View>
          <TextInput
            onChangeText={(value) => setForm({ ...form, openAt: value })}
            placeholder="自定义：2026-09-06T09:00"
            placeholderTextColor={colors.mutedText}
            style={[styles.input, { backgroundColor: colors.surfaceMuted, borderColor: colors.line, color: colors.text }]}
            value={form.openAt}
          />
        </>
      ) : null}

      {form.openRule === 'birthday' ? (
        <ThemedText style={[styles.hint, { color: colors.mutedText }]}>
          {birthday ? `使用真实生日 ${birthday}，服务端计算下一个生日。` : '个人资料还没有真实生日，请先在编辑资料中填写。'}
        </ThemedText>
      ) : null}

      {form.openRule === 'days_left' ? (
        daysLeftSources.length === 0 ? (
          <ThemedText style={[styles.hint, { color: colors.mutedText }]}>还没有可关联的真实到期记录。</ThemedText>
        ) : (
          daysLeftSources.map((source) => (
            <Pressable
              key={source.id}
              onPress={() => setForm({ ...form, linkedDaysLeftId: source.id })}
              style={[styles.sourceRow, form.linkedDaysLeftId === source.id && { borderColor: '#edc681' }]}>
              <MaterialCommunityIcons name="calendar-clock-outline" size={16} color="#bd7620" />
              <View style={styles.sourceCopy}>
                <ThemedText style={styles.sourceTitle}>{source.name}</ThemedText>
                <ThemedText style={[styles.sourceMeta, { color: colors.mutedText }]}>{source.expiryDate}</ThemedText>
              </View>
            </Pressable>
          ))
        )
      ) : null}

      {form.openRule === 'focus_goal' || form.openRule === 'focus_task' ? (
        focusSources.length === 0 ? (
          <ThemedText style={[styles.hint, { color: colors.mutedText }]}>还没有可关联的真实效率清单目标。</ThemedText>
        ) : (
          focusSources.map((source) => (
            <Pressable
              key={`${source.kind}-${source.id}`}
              onPress={() =>
                setForm(
                  source.kind === 'goal'
                    ? { ...form, linkedFocusGoalId: source.id, linkedFocusTaskId: '' }
                    : { ...form, linkedFocusTaskId: source.id, linkedFocusGoalId: '' },
                )
              }
              style={[
                styles.sourceRow,
                (source.kind === 'goal' ? form.linkedFocusGoalId === source.id : form.linkedFocusTaskId === source.id) && { borderColor: '#edc681' },
              ]}>
              <MaterialCommunityIcons name="target" size={16} color="#bd7620" />
              <View style={styles.sourceCopy}>
                <ThemedText style={styles.sourceTitle}>{source.title}</ThemedText>
                <ThemedText style={[styles.sourceMeta, { color: colors.mutedText }]}>{source.kind === 'goal' ? '今日目标' : '效率清单任务'}</ThemedText>
              </View>
            </Pressable>
          ))
        )
      ) : null}

      {form.mode === 'joint' ? (
        <>
          <FieldLabel label="选择真实好友" />
          {friends.length === 0 ? (
            <ThemedText style={[styles.hint, { color: colors.mutedText }]}>还没有好友，请先添加好友。</ThemedText>
          ) : (
            <View style={styles.friendRow}>
              {friends.map((friend) => (
                <Pressable
                  key={friend.id}
                  onPress={() => setForm({ ...form, friendId: friend.id })}
                  style={[styles.friendPill, form.friendId === friend.id && { backgroundColor: '#fff3dc', borderColor: '#edc681' }]}>
                  <ThemedText style={[styles.friendText, { color: form.friendId === friend.id ? '#bd7620' : colors.text }]}>
                    {friend.displayName}
                  </ThemedText>
                </Pressable>
              ))}
            </View>
          )}
        </>
      ) : null}

      <FieldLabel label="写给未来的内容" />
      <TextInput
        maxLength={2000}
        multiline
        onChangeText={setTextContent}
        placeholder="写下一句话，或添加真实照片和语音"
        placeholderTextColor={colors.mutedText}
        style={[styles.textArea, { backgroundColor: colors.surfaceMuted, borderColor: colors.line, color: colors.text }]}
        value={textContent}
      />
      <View style={styles.mediaRow}>
        <Pressable onPress={onSave} style={[styles.mediaTile, { borderColor: colors.line }]}>
          <MaterialCommunityIcons name="camera-outline" size={18} color="#bd7620" />
          <ThemedText style={styles.mediaText}>{photo ? '已添加照片' : '添加照片'}</ThemedText>
        </Pressable>
        <Pressable onPress={onSave} style={[styles.mediaTile, { borderColor: colors.line }]}>
          <MaterialCommunityIcons name="microphone-outline" size={18} color="#bd7620" />
          <ThemedText style={styles.mediaText}>{voice ? voice.name : '添加语音文件'}</ThemedText>
        </Pressable>
      </View>
      <ThemedText style={[styles.hint, { color: colors.mutedText }]}>
        照片和语音需要在保存草稿后从胶囊详情中添加。
      </ThemedText>

      <View style={styles.actionRow}>
        <Pressable
          disabled={busy}
          onPress={onSave}
          style={[styles.secondaryButton, { borderColor: colors.line }]}>
          <ThemedText style={[styles.secondaryText, { color: colors.text }]}>保存草稿</ThemedText>
        </Pressable>
        <Pressable
          disabled={busy}
          onPress={onSeal}
          style={[styles.primaryButton, { backgroundColor: colors.hero }]}>
          {busy ? <ActivityIndicator color="#ffffff" /> : <MaterialCommunityIcons name="lock-outline" size={18} color="#ffffff" />}
          <ThemedText style={styles.primaryButtonText}>{busy ? '正在保存' : '创建并封存'}</ThemedText>
        </Pressable>
      </View>
    </SurfaceCard>
  );
}

function NotificationsTab(props: {
  notifications: TimeCapsuleNotification[];
  onOpen: (id: string) => void;
  colors: ReturnType<typeof useAppTheme>['colors'];
}) {
  const { notifications, onOpen, colors } = props;
  return (
    <>
      <SectionTitle title="时间胶囊通知" meta={`${notifications.filter((n) => !n.read).length} 条未读`} />
      {notifications.length === 0 ? (
        <SurfaceCard style={styles.emptyCard}>
          <MaterialCommunityIcons name="bell-outline" size={30} color={colors.mutedText} />
          <ThemedText style={styles.emptyTitle}>暂无真实通知</ThemedText>
        </SurfaceCard>
      ) : (
        notifications.map((notification) => (
          <Pressable key={notification.id} onPress={() => onOpen(notification.capsuleId)}>
            <SurfaceCard style={styles.notificationCard}>
              <View style={[styles.notificationDot, !notification.read && { backgroundColor: colors.accent }]} />
              <View style={styles.notificationCopy}>
                <ThemedText style={styles.notificationTitle}>{notification.title}</ThemedText>
                <ThemedText style={[styles.notificationMeta, { color: colors.mutedText }]}>
                  {notificationTypeLabel(notification.type)} · {formatDate(notification.createdAt)}
                </ThemedText>
              </View>
            </SurfaceCard>
          </Pressable>
        ))
      )}
    </>
  );
}

function DetailCard(props: {
  detail: TimeCapsuleDetail | null;
  currentUserId: string;
  busy: boolean;
  onClose: () => void;
  onAccept: () => void;
  onDecline: () => void;
  onExit: () => void;
  onSeal: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onPickPhoto: () => void;
  onPickVoice: () => void;
  colors: ReturnType<typeof useAppTheme>['colors'];
  dark: boolean;
}) {
  const { detail, currentUserId, busy, onClose, onAccept, onDecline, onExit, onSeal, onArchive, onDelete, onPickPhoto, onPickVoice, colors, dark } = props;
  const myMember = detail?.members.find((member) => member.userId === currentUserId) as TimeCapsuleMember | undefined;
  const isCreator = detail?.capsule.creatorId === currentUserId;
  return (
    <>
      <SectionTitle title="胶囊详情" meta="真实内容与状态" />
      <SurfaceCard style={[styles.detailCard, dark ? styles.heroDark : styles.heroLight]}>
        <View style={styles.detailTop}>
          <ThemedText style={styles.detailTitle}>{detail?.capsule.title ?? '加载中'}</ThemedText>
          <Pressable onPress={onClose} style={styles.closeButton}>
            <MaterialCommunityIcons name="close" size={18} color="#ffffff" />
          </Pressable>
        </View>
        <ThemedText style={[styles.detailMeta, { color: 'rgba(255,255,255,0.72)' }]}>
          {detail ? statusLabel(detail.capsule.status) : '加载中'} · {detail?.capsule.mode === 'joint' ? '双人共同封存' : '个人胶囊'}
        </ThemedText>
        {detail?.capsule.openAt ? (
          <ThemedText style={[styles.detailMeta, { color: 'rgba(255,255,255,0.72)' }]}>
            开启时间 {formatDate(detail.capsule.openAt)}
          </ThemedText>
        ) : null}
      </SurfaceCard>

      {detail ? (
        <>
          <SectionTitle title="成员" meta={`${detail.members.length} 位`} />
          <SurfaceCard style={styles.card}>
            {detail.members.map((member) => (
              <View key={member.id} style={styles.memberRow}>
                <View style={[styles.memberAvatar, { backgroundColor: member.role === 'creator' ? colors.primary : '#18a78f' }]}>
                  <ThemedText style={styles.memberAvatarText}>{member.displayName.slice(0, 1)}</ThemedText>
                </View>
                <View style={styles.memberCopy}>
                  <ThemedText style={styles.memberName}>{member.displayName}</ThemedText>
                  <ThemedText style={[styles.memberMeta, { color: colors.mutedText }]}>
                    {member.inviteStatus === 'accepted' ? `已放入 ${member.contentCount} 条内容` : inviteLabel(member.inviteStatus)}
                  </ThemedText>
                </View>
                <ThemedText style={[styles.memberStatus, { color: member.inviteStatus === 'accepted' ? colors.success : colors.mutedText }]}>
                  {inviteLabel(member.inviteStatus)}
                </ThemedText>
              </View>
            ))}
          </SurfaceCard>

          {detail.capsule.status === 'draft' && myMember?.inviteStatus === 'pending' ? (
            <View style={styles.actionRow}>
              <Pressable onPress={onDecline} style={[styles.secondaryButton, { borderColor: colors.line }]}>
                <ThemedText style={[styles.secondaryText, { color: colors.text }]}>拒绝</ThemedText>
              </Pressable>
              <Pressable onPress={onAccept} style={[styles.primaryButton, { backgroundColor: colors.hero }]}>
                <MaterialCommunityIcons name="check" size={18} color="#ffffff" />
                <ThemedText style={styles.primaryButtonText}>接受邀请</ThemedText>
              </Pressable>
            </View>
          ) : null}

          {detail.capsule.status === 'draft' && myMember?.inviteStatus === 'accepted' ? (
            <SurfaceCard style={styles.card}>
              <ThemedText style={styles.cardTitle}>我的内容</ThemedText>
              {detail.contents.length === 0 ? (
                <ThemedText style={[styles.hint, { color: colors.mutedText }]}>还没有内容，先放入一条真实记录。</ThemedText>
              ) : (
                detail.contents.map((content) => <ContentRow key={content.id} content={content} colors={colors} />)
              )}
              <View style={styles.actionRow}>
                <Pressable onPress={onPickPhoto} style={[styles.secondaryButton, { borderColor: colors.line }]}>
                  <MaterialCommunityIcons name="camera-outline" size={16} color="#bd7620" />
                  <ThemedText style={[styles.secondaryText, { color: colors.text }]}>照片</ThemedText>
                </Pressable>
                <Pressable onPress={onPickVoice} style={[styles.secondaryButton, { borderColor: colors.line }]}>
                  <MaterialCommunityIcons name="microphone-outline" size={16} color="#bd7620" />
                  <ThemedText style={[styles.secondaryText, { color: colors.text }]}>语音</ThemedText>
                </Pressable>
              </View>
              <Pressable
                disabled={busy || detail.contents.length === 0 || (detail.capsule.mode === 'joint' && detail.members.some((m) => m.inviteStatus !== 'accepted' || m.contentCount === 0))}
                onPress={onSeal}
                style={[styles.primaryButton, { backgroundColor: colors.hero, width: '100%', marginTop: 10 }]}>
                <MaterialCommunityIcons name="lock-outline" size={18} color="#ffffff" />
                <ThemedText style={styles.primaryButtonText}>封存胶囊</ThemedText>
              </Pressable>
              {!isCreator ? (
                <Pressable onPress={onExit} style={styles.textButton}>
                  <ThemedText style={[styles.dangerText, { color: '#d84b5c' }]}>退出共同创建</ThemedText>
                </Pressable>
              ) : null}
              {isCreator ? (
                <Pressable onPress={onDelete} style={styles.textButton}>
                  <ThemedText style={[styles.dangerText, { color: '#d84b5c' }]}>删除草稿</ThemedText>
                </Pressable>
              ) : null}
            </SurfaceCard>
          ) : null}

          {detail.capsule.status === 'sealed' ? (
            <SurfaceCard style={styles.card}>
              <View style={styles.lockedRow}>
                <MaterialCommunityIcons name="lock-outline" size={22} color="#bd7620" />
                <View style={styles.lockedCopy}>
                  <ThemedText style={styles.cardTitle}>内容已隐藏</ThemedText>
                  <ThemedText style={[styles.hint, { color: colors.mutedText }]}>
                    {detail.capsule.contentCount} 条内容，开启后才可查看。
                  </ThemedText>
                </View>
              </View>
            </SurfaceCard>
          ) : null}

          {detail.capsule.status === 'opened' ? (
            <>
              <SectionTitle title="开启内容" meta={`${detail.contents.length} 条真实内容`} />
              {detail.contents.length === 0 ? (
                <SurfaceCard style={styles.emptyCard}>
                  <ThemedText style={styles.emptyTitle}>内容为空</ThemedText>
                </SurfaceCard>
              ) : (
                detail.contents.map((content) => <ContentRow key={content.id} content={content} colors={colors} />)
              )}
              <Pressable onPress={onArchive} style={[styles.secondaryButton, { borderColor: colors.line, width: '100%' }]}>
                <MaterialCommunityIcons name="archive-outline" size={16} color={colors.text} />
                <ThemedText style={[styles.secondaryText, { color: colors.text }]}>归档已开启胶囊</ThemedText>
              </Pressable>
            </>
          ) : null}
        </>
      ) : (
        <SurfaceCard style={styles.card}>
          <ActivityIndicator color={colors.primary} />
        </SurfaceCard>
      )}
    </>
  );
}

function ContentRow(props: { content: TimeCapsuleContent; colors: ReturnType<typeof useAppTheme>['colors'] }) {
  const { content, colors } = props;
  const mediaURL = content.mediaUrl ? resolveMediaURL(content.mediaUrl) : '';
  if (content.kind === 'text') {
    return (
      <SurfaceCard style={styles.contentCard}>
        <ThemedText style={styles.contentText}>{content.textContent}</ThemedText>
      </SurfaceCard>
    );
  }
  if (content.kind === 'photo') {
    return (
      <SurfaceCard style={styles.contentCard}>
        {mediaURL ? (
          <Image source={{ uri: mediaURL }} style={styles.contentImage} contentFit="cover" />
        ) : (
          <View style={[styles.photoPlaceholder, { backgroundColor: colors.primarySoft }]}>
            <MaterialCommunityIcons name="image-outline" size={22} color={colors.primary} />
            <ThemedText style={[styles.hint, { color: colors.mutedText }]}>真实照片</ThemedText>
          </View>
        )}
      </SurfaceCard>
    );
  }
  return (
    <SurfaceCard style={styles.contentCard}>
      <View style={styles.voiceRow}>
        <MaterialCommunityIcons name="microphone-outline" size={20} color="#bd7620" />
        <ThemedText style={styles.voiceName}>{content.fileName || '语音文件'}</ThemedText>
        {mediaURL ? (
          <Pressable onPress={() => void Linking.openURL(mediaURL)} style={[styles.smallButton, { backgroundColor: '#151b3b' }]}>
            <ThemedText style={styles.smallButtonText}>播放</ThemedText>
          </Pressable>
        ) : null}
      </View>
    </SurfaceCard>
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

function FieldLabel(props: { label: string }) {
  return <ThemedText style={styles.fieldLabel}>{props.label}</ThemedText>;
}

function statusLabel(status: TimeCapsule['status']) {
  return { draft: '草稿', sealed: '等待开启', opened: '已开启', archived: '已归档' }[status];
}

function inviteLabel(status: TimeCapsuleMember['inviteStatus']) {
  return { pending: '待回应', accepted: '已接受', declined: '已拒绝', exited: '已退出' }[status];
}

function notificationTypeLabel(type: string) {
  const map: Record<string, string> = {
    'capsule.sealed': '已封存',
    'capsule.opened': '已开启',
  };
  return map[type] ?? '状态更新';
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function addDuration(value: number, unit: 'month' | 'year') {
  const date = new Date();
  if (unit === 'month') date.setMonth(date.getMonth() + value);
  else date.setFullYear(date.getFullYear() + value);
  return date;
}

function resolveMediaURL(value: string) {
  if (/^https?:\/\//i.test(value)) return value;
  return `${getAPIBaseUrl()}${value.startsWith('/') ? '' : '/'}${value}`;
}

const styles = StyleSheet.create({
  page: {
    gap: 14,
    paddingTop: 12,
  },
  center: {
    alignItems: 'center',
    flex: 1,
    gap: 12,
    justifyContent: 'center',
    minHeight: 420,
  },
  centerText: {
    fontSize: 13,
  },
  stateIcon: {
    alignItems: 'center',
    borderRadius: 18,
    height: 58,
    justifyContent: 'center',
    width: 58,
  },
  stateTitle: {
    fontSize: 19,
    fontWeight: '900',
  },
  stateText: {
    fontSize: 12,
    lineHeight: 19,
    maxWidth: 260,
    textAlign: 'center',
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: 16,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  tabs: {
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
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
  tabLabel: {
    fontSize: 11,
    fontWeight: '800',
  },
  notice: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    padding: 10,
  },
  noticeText: {
    flex: 1,
    fontSize: 11,
    fontWeight: '700',
  },
  card: {
    gap: 10,
    padding: 14,
  },
  cardHint: {
    fontSize: 11,
    textAlign: 'center',
  },
  heroCard: {
    borderRadius: 20,
    padding: 16,
  },
  heroLight: {
    backgroundColor: '#151b3b',
  },
  heroDark: {
    backgroundColor: '#1d2730',
  },
  heroIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(232,163,61,0.16)',
    borderRadius: 12,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  heroTitle: {
    color: '#ffffff',
    fontSize: 19,
    fontWeight: '900',
    marginTop: 12,
  },
  heroSub: {
    fontSize: 11,
    lineHeight: 17,
    marginTop: 5,
  },
  heroStats: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
  },
  heroStat: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 10,
    flex: 1,
    paddingVertical: 8,
  },
  heroStatValue: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '900',
  },
  heroStatLabel: {
    color: 'rgba(255,255,255,0.68)',
    fontSize: 8,
    fontWeight: '700',
    marginTop: 2,
  },
  sectionTitle: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  sectionTitleText: {
    fontSize: 15,
    fontWeight: '900',
  },
  sectionMeta: {
    color: '#7483a2',
    fontSize: 9,
    fontWeight: '700',
  },
  listCard: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    padding: 12,
  },
  listIcon: {
    alignItems: 'center',
    borderRadius: 10,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  listCopy: {
    flex: 1,
  },
  listTitle: {
    fontSize: 12,
    fontWeight: '900',
  },
  listMeta: {
    fontSize: 9,
    marginTop: 3,
  },
  smallButton: {
    alignItems: 'center',
    borderRadius: 9,
    justifyContent: 'center',
    minHeight: 30,
    paddingHorizontal: 11,
  },
  smallButtonText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '900',
  },
  emptyCard: {
    alignItems: 'center',
    gap: 10,
    padding: 24,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '900',
  },
  emptyText: {
    fontSize: 11,
    lineHeight: 18,
    textAlign: 'center',
  },
  capsuleCard: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
    padding: 12,
  },
  capsuleIcon: {
    alignItems: 'center',
    borderRadius: 10,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  capsuleCopy: {
    flex: 1,
  },
  capsuleTitle: {
    fontSize: 12,
    fontWeight: '900',
  },
  capsuleMeta: {
    fontSize: 9,
    marginTop: 3,
  },
  formCard: {
    gap: 12,
    padding: 16,
  },
  segmented: {
    borderRadius: 12,
    flexDirection: 'row',
    gap: 4,
    padding: 3,
  },
  segButton: {
    alignItems: 'center',
    borderRadius: 9,
    flex: 1,
    flexDirection: 'row',
    gap: 5,
    justifyContent: 'center',
    minHeight: 36,
  },
  segLabel: {
    fontSize: 11,
    fontWeight: '800',
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '900',
    marginTop: 2,
  },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    fontSize: 12,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  textArea: {
    borderRadius: 12,
    borderWidth: 1,
    fontSize: 12,
    minHeight: 88,
    padding: 12,
    textAlignVertical: 'top',
  },
  ruleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  rulePill: {
    alignItems: 'center',
    borderColor: 'transparent',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    minHeight: 32,
    paddingHorizontal: 11,
  },
  ruleText: {
    fontSize: 10,
    fontWeight: '800',
  },
  presetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 30,
    paddingHorizontal: 11,
    justifyContent: 'center',
  },
  chipText: {
    fontSize: 10,
    fontWeight: '800',
  },
  hint: {
    fontSize: 10,
    lineHeight: 17,
  },
  sourceRow: {
    alignItems: 'center',
    borderColor: 'transparent',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 9,
    minHeight: 48,
    padding: 10,
  },
  sourceCopy: {
    flex: 1,
  },
  sourceTitle: {
    fontSize: 11,
    fontWeight: '900',
  },
  sourceMeta: {
    fontSize: 9,
    marginTop: 2,
  },
  friendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  friendPill: {
    alignItems: 'center',
    borderColor: 'transparent',
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 32,
    paddingHorizontal: 11,
  },
  friendText: {
    fontSize: 10,
    fontWeight: '800',
  },
  mediaRow: {
    flexDirection: 'row',
    gap: 8,
  },
  mediaTile: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    gap: 6,
    justifyContent: 'center',
    minHeight: 62,
  },
  mediaText: {
    fontSize: 10,
    fontWeight: '800',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 14,
    flex: 1,
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    minHeight: 46,
    paddingHorizontal: 12,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
  },
  secondaryButton: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 10,
  },
  secondaryText: {
    fontSize: 11,
    fontWeight: '900',
  },
  notificationCard: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
    padding: 12,
  },
  notificationDot: {
    borderRadius: 5,
    height: 9,
    width: 9,
  },
  notificationCopy: {
    flex: 1,
  },
  notificationTitle: {
    fontSize: 12,
    fontWeight: '900',
  },
  notificationMeta: {
    fontSize: 9,
    marginTop: 3,
  },
  detailCard: {
    borderRadius: 20,
    padding: 16,
  },
  detailTop: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  detailTitle: {
    color: '#ffffff',
    flex: 1,
    fontSize: 19,
    fontWeight: '900',
  },
  detailMeta: {
    fontSize: 10,
    lineHeight: 17,
    marginTop: 5,
  },
  closeButton: {
    alignItems: 'center',
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  memberRow: {
    alignItems: 'center',
    borderBottomColor: '#e6edf7',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 10,
    minHeight: 52,
  },
  memberAvatar: {
    alignItems: 'center',
    borderRadius: 999,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  memberAvatarText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '900',
  },
  memberCopy: {
    flex: 1,
  },
  memberName: {
    fontSize: 11,
    fontWeight: '900',
  },
  memberMeta: {
    fontSize: 9,
    marginTop: 2,
  },
  memberStatus: {
    fontSize: 9,
    fontWeight: '800',
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: '900',
  },
  lockedRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  lockedCopy: {
    flex: 1,
  },
  contentCard: {
    marginBottom: 8,
    padding: 12,
  },
  contentText: {
    fontSize: 12,
    lineHeight: 20,
  },
  contentImage: {
    borderRadius: 12,
    height: 180,
    width: '100%',
  },
  photoPlaceholder: {
    alignItems: 'center',
    borderRadius: 12,
    gap: 6,
    height: 120,
    justifyContent: 'center',
  },
  voiceRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  voiceName: {
    flex: 1,
    fontSize: 11,
    fontWeight: '800',
  },
  textButton: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    minHeight: 36,
  },
  dangerText: {
    fontSize: 11,
    fontWeight: '900',
  },
});
