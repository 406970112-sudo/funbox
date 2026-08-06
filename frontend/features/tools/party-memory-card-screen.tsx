import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useAuth } from '@/features/auth/auth-provider';
import { MobileScreen } from '@/shared/ui/mobile-screen';
import { PageHeader } from '@/shared/ui/page-header';
import { PageLoadingFrame } from '@/shared/ui/page-loading-frame';
import { SurfaceCard } from '@/shared/ui/surface-card';
import { listFriends } from '@/lib/social-api';
import {
  addPartyAgainVote,
  addPartyParticipant,
  addPartyVenueNote,
  createPartyDish,
  createPartyMemoryCard,
  deletePartyMemoryCard,
  deletePartyMemoryCardPhoto,
  deletePartyDish,
  deletePartyVenueNote,
  downloadPartyMemoryCardExport,
  fetchPartyMemoryCard,
  fetchPartyMemoryCards,
  fetchPartyMemoryCardSummary,
  fetchPartyNextPrep,
  getPartyMemoryCardErrorMessage,
  partyMemoryCardImageSource,
  partyMemoryCardMediaURL,
  removePartyParticipant,
  updatePartyMemoryCard,
  uploadPartyMemoryCardPhoto,
  votePartyDish,
} from '@/lib/party-memory-card-api';
import {
  activityActionLabel,
  againVoteLabel,
  buildParticipantClientId,
  centsToYuan,
  currentPartyDateValue,
  dishRatingLabel,
  dishVoteSummary,
  formatAmount,
  formatPartyDate,
  hostLabel,
  hostTypeLabel,
  participantInitial,
  topDishes,
  validateCardBasics,
  venueDimensionLabel,
  yuanToCents,
} from '@/lib/party-memory-card';
import type { Friend } from '@/types/social';
import type {
  PartyAgainVoteValue,
  PartyCard,
  PartyCardDetail,
  PartyCardInput,
  PartyDish,
  PartyDishRating,
  PartyNextPrep,
  PartyParticipant,
  PartyParticipantInput,
  PartyPhoto,
  PartySummary,
  PartyVenueDimension,
  PartyVenueNoteInput,
} from '@/types/party-memory-card';

type Tab = 'cards' | 'prep';

export function PartyMemoryCardScreen() {
  const router = useRouter();
  const { accessToken, status: authStatus } = useAuth();
  const { colors } = useAppTheme();
  const [tab, setTab] = useState<Tab>('cards');
  const [summary, setSummary] = useState<PartySummary | null>(null);
  const [cards, setCards] = useState<PartyCard[]>([]);
  const [nextPrep, setNextPrep] = useState<PartyNextPrep | null>(null);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [hostFilter, setHostFilter] = useState('');
  const [photoFilter, setPhotoFilter] = useState(false);
  const [againFilter, setAgainFilter] = useState('');
  const [sort, setSort] = useState('recent');
  const [detail, setDetail] = useState<PartyCardDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingDetail, setEditingDetail] = useState<PartyCardDetail | null>(null);

  const refreshAll = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const [summaryData, cardData, prepData, friendData] = await Promise.all([
        fetchPartyMemoryCardSummary(accessToken),
        fetchPartyMemoryCards(accessToken),
        fetchPartyNextPrep(accessToken),
        listFriends(accessToken),
      ]);
      setSummary(summaryData);
      setCards(cardData);
      setNextPrep(prepData);
      setFriends(friendData);
      setLoading(false);
    } catch (nextError) {
      setError(getPartyMemoryCardErrorMessage(nextError));
      setLoading(false);
    }
  }, [accessToken]);

  const loadCards = useCallback(async () => {
    if (!accessToken) return;
    try {
      const nextCards = await fetchPartyMemoryCards(accessToken, {
        q: search.trim() || undefined,
        hostType: hostFilter || undefined,
        hasPhoto: photoFilter ? 'true' : undefined,
        again: againFilter || undefined,
        sort,
      });
      setCards(nextCards);
      setError(null);
    } catch (nextError) {
      setError(getPartyMemoryCardErrorMessage(nextError));
    }
  }, [accessToken, search, hostFilter, photoFilter, againFilter, sort]);

  useEffect(() => {
    if (accessToken) void refreshAll();
  }, [accessToken, refreshAll]);

  useEffect(() => {
    if (!accessToken) return;
    const timer = setTimeout(() => void loadCards(), search ? 250 : 0);
    return () => clearTimeout(timer);
  }, [accessToken, loadCards, search]);

  async function runMutation(action: () => Promise<unknown>, success?: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      if (success) setMessage(success);
      await refreshAll();
    } catch (nextError) {
      setError(getPartyMemoryCardErrorMessage(nextError));
    } finally {
      setBusy(false);
    }
  }

  async function openDetail(cardId: string) {
    if (!accessToken) return;
    setBusy(true);
    setError(null);
    try {
      const nextDetail = await fetchPartyMemoryCard(accessToken, cardId);
      setDetail(nextDetail);
      setDetailOpen(true);
    } catch (nextError) {
      setError(getPartyMemoryCardErrorMessage(nextError));
    } finally {
      setBusy(false);
    }
  }

  if (authStatus === 'loading') {
    return <PageLoadingFrame title="聚会记忆卡" variant="workbench" />;
  }

  if (!accessToken) {
    return (
      <MobileScreen>
        <PageHeader
          title="聚会记忆卡"
          subtitle="一场聚会，一张真实记忆卡"
          rightSlot={
            <Pressable onPress={() => router.push('/auth')} style={[styles.iconButton, { backgroundColor: colors.surface, borderColor: colors.line }]}>
              <MaterialCommunityIcons name="login" size={18} color={colors.primary} />
            </Pressable>
          }
        />
        <SurfaceCard style={styles.noticeCard}>
          <View style={[styles.noticeIcon, { backgroundColor: colors.primarySoft }]}>
            <MaterialCommunityIcons name="party-popper" size={28} color={colors.primary} />
          </View>
          <ThemedText style={styles.noticeTitle}>登录后使用真实数据</ThemedText>
          <ThemedText style={[styles.noticeBody, { color: colors.mutedText }]}>
            聚会、照片、账单、菜品和评价只保存在当前账号下。
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/auth')}
            style={[styles.primaryButton, { backgroundColor: colors.hero }]}>
            <ThemedText style={styles.primaryButtonText}>登录 / 注册</ThemedText>
            <MaterialCommunityIcons name="arrow-right" size={17} color="#c9f36a" />
          </Pressable>
        </SurfaceCard>
      </MobileScreen>
    );
  }

  return (
    <MobileScreen scrollContentStyle={styles.pageContent}>
      <PageHeader
        title="聚会记忆卡"
        subtitle="真实聚会、真实账单、真实下次准备"
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
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="记录聚会"
              onPress={() => {
                setEditingDetail(null);
                setFormOpen(true);
              }}
              style={[styles.iconButton, { backgroundColor: colors.hero, borderColor: colors.hero }]}>
              <MaterialCommunityIcons name="plus" size={19} color="#c9f36a" />
            </Pressable>
          </View>
        }
      />

      <View style={styles.quickStats}>
        <StatCard icon="party-popper" label="次聚会" value={summary?.totalCards ?? 0} color={colors.primary} colors={colors} />
        <StatCard icon="camera-outline" label="张照片" value={summary?.totalPhotos ?? 0} color={colors.accent} colors={colors} />
        <StatCard icon="wallet-outline" label="累计" value={centsToYuan(summary?.totalAmountCents ?? 0)} color={colors.success} colors={colors} />
      </View>

      <View style={[styles.tabs, { backgroundColor: colors.surfaceMuted, borderColor: colors.line }]}>
        <Pressable
          accessibilityRole="button"
          onPress={() => setTab('cards')}
          style={[styles.tabButton, tab === 'cards' && { backgroundColor: colors.surface }]}>
          <MaterialCommunityIcons name="party-popper" size={17} color={tab === 'cards' ? colors.primary : colors.mutedText} />
          <ThemedText style={[styles.tabLabel, { color: tab === 'cards' ? colors.text : colors.mutedText }]}>聚会卡</ThemedText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => setTab('prep')}
          style={[styles.tabButton, tab === 'prep' && { backgroundColor: colors.surface }]}>
          <MaterialCommunityIcons name="calendar-heart" size={17} color={tab === 'prep' ? colors.primary : colors.mutedText} />
          <ThemedText style={[styles.tabLabel, { color: tab === 'prep' ? colors.text : colors.mutedText }]}>下次聚餐</ThemedText>
        </Pressable>
      </View>

      {message ? (
        <View style={[styles.messageBanner, { backgroundColor: colors.success + '18' }]}>
          <MaterialCommunityIcons name="check-circle-outline" size={15} color={colors.success} />
          <ThemedText style={[styles.messageText, { color: colors.success }]}>{message}</ThemedText>
        </View>
      ) : null}
      {error ? (
        <View style={[styles.messageBanner, { backgroundColor: colors.accent + '18' }]}>
          <MaterialCommunityIcons name="alert-circle-outline" size={15} color={colors.accent} />
          <ThemedText style={[styles.messageText, { color: colors.accent }]}>{error}</ThemedText>
        </View>
      ) : null}

      {loading ? (
        <SurfaceCard style={styles.loadingCard}>
          <ActivityIndicator color={colors.primary} />
          <ThemedText style={[styles.loadingText, { color: colors.mutedText }]}>正在读取真实数据</ThemedText>
        </SurfaceCard>
      ) : tab === 'cards' ? (
        <CardsTab
          cards={cards}
          summary={summary}
          search={search}
          hostFilter={hostFilter}
          photoFilter={photoFilter}
          againFilter={againFilter}
          sort={sort}
          colors={colors}
          busy={busy}
          onSearch={setSearch}
          onHostFilter={setHostFilter}
          onPhotoFilter={setPhotoFilter}
          onAgainFilter={setAgainFilter}
          onSort={setSort}
          onOpenCard={(cardId) => void openDetail(cardId)}
          onOpenCreate={() => {
            setEditingDetail(null);
            setFormOpen(true);
          }}
          onExport={(format) =>
            void runMutation(async () => {
              await downloadPartyMemoryCardExport(accessToken, format);
            }, `已导出 ${format === 'csv' ? 'CSV' : 'JSON'} 真实数据`)
          }
        />
      ) : (
        <PrepTab
          prep={nextPrep}
          colors={colors}
          onOpenCard={(cardId) => void openDetail(cardId)}
          onOpenCreate={() => {
            setEditingDetail(null);
            setFormOpen(true);
          }}
        />
      )}

      <CardFormModal
        open={formOpen}
        detail={editingDetail}
        friends={friends}
        accessToken={accessToken}
        colors={colors}
        onClose={() => setFormOpen(false)}
        onSaved={async () => {
          setFormOpen(false);
          setEditingDetail(null);
          await refreshAll();
        }}
      />
      <DetailModal
        open={detailOpen}
        detail={detail}
        accessToken={accessToken}
        colors={colors}
        onClose={() => setDetailOpen(false)}
        onEdit={() => {
          if (!detail) return;
          setEditingDetail(detail);
          setDetailOpen(false);
          setFormOpen(true);
        }}
        onDelete={() => {
          if (!detail) return;
          Alert.alert('删除记忆卡', '删除后这张真实记忆卡不再出现在列表中。', [
            { text: '取消', style: 'cancel' },
            {
              text: '删除',
              style: 'destructive',
              onPress: () => {
                void runMutation(async () => {
                  await deletePartyMemoryCard(accessToken, detail.id);
                  setDetailOpen(false);
                  setDetail(null);
                }, '记忆卡已删除');
              },
            },
          ]);
        }}
        onSaved={async () => {
          if (!detail) return;
          const nextDetail = await fetchPartyMemoryCard(accessToken, detail.id);
          setDetail(nextDetail);
          await refreshAll();
        }}
      />
    </MobileScreen>
  );
}

function StatCard(props: {
  icon: string;
  label: string;
  value: string | number;
  color: string;
  colors: ReturnType<typeof useAppTheme>['colors'];
}) {
  return (
    <SurfaceCard style={styles.statCard}>
      <MaterialCommunityIcons name={props.icon as never} size={17} color={props.color} />
      <ThemedText style={styles.statValue}>{props.value}</ThemedText>
      <ThemedText style={[styles.statLabel, { color: props.colors.mutedText }]}>{props.label}</ThemedText>
    </SurfaceCard>
  );
}

function CardsTab(props: {
  cards: PartyCard[];
  summary: PartySummary | null;
  search: string;
  hostFilter: string;
  photoFilter: boolean;
  againFilter: string;
  sort: string;
  colors: ReturnType<typeof useAppTheme>['colors'];
  busy: boolean;
  onSearch: (value: string) => void;
  onHostFilter: (value: string) => void;
  onPhotoFilter: (value: boolean) => void;
  onAgainFilter: (value: string) => void;
  onSort: (value: string) => void;
  onOpenCard: (cardId: string) => void;
  onOpenCreate: () => void;
  onExport: (format: 'csv' | 'json') => void;
}) {
  const { cards, search, colors } = props;
  const filtered = Boolean(search || props.hostFilter || props.photoFilter || props.againFilter);
  return (
    <>
      <View style={[styles.searchField, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <MaterialCommunityIcons name="magnify" size={18} color={colors.primary} />
        <TextInput
          value={search}
          onChangeText={props.onSearch}
          placeholder="搜索餐厅、参与人、菜名或印象"
          placeholderTextColor={colors.mutedText}
          style={[styles.searchInput, { color: colors.text }]}
        />
        {search ? (
          <Pressable onPress={() => props.onSearch('')} style={styles.clearSearch}>
            <MaterialCommunityIcons name="close-circle" size={17} color={colors.mutedText} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.sectionBlock}>
        <SectionTitle title="筛选" meta="真实字段" />
        <View style={styles.chipWrap}>
          <FilterPill label="全部请客" active={props.hostFilter === ''} onPress={() => props.onHostFilter('')} colors={colors} />
          <FilterPill label="成员请客" active={props.hostFilter === 'member'} onPress={() => props.onHostFilter(props.hostFilter === 'member' ? '' : 'member')} colors={colors} />
          <FilterPill label="AA" active={props.hostFilter === 'aa'} onPress={() => props.onHostFilter(props.hostFilter === 'aa' ? '' : 'aa')} colors={colors} />
          <FilterPill label="有照片" icon="camera-outline" active={props.photoFilter} onPress={() => props.onPhotoFilter(!props.photoFilter)} colors={colors} />
          <FilterPill label="想去" active={props.againFilter === 'want'} onPress={() => props.onAgainFilter(props.againFilter === 'want' ? '' : 'want')} colors={colors} />
        </View>
      </View>

      <View style={styles.sectionBlock}>
        <SectionTitle title="排序" meta="最近一次 / 最早 / 金额 / 照片" />
        <View style={styles.chipWrap}>
          {[
            { value: 'recent', label: '最近一次' },
            { value: 'oldest', label: '最早一次' },
            { value: 'amount', label: '消费最高' },
            { value: 'photos', label: '照片最多' },
          ].map((option) => (
            <FilterPill
              key={option.value}
              label={option.label}
              active={props.sort === option.value}
              onPress={() => props.onSort(option.value)}
              colors={colors}
            />
          ))}
        </View>
      </View>

      {cards.length === 0 ? (
        <SurfaceCard style={styles.emptyCard}>
          <View style={[styles.emptyIcon, { backgroundColor: colors.primarySoft }]}>
            <MaterialCommunityIcons name={filtered ? 'magnify-close' : 'party-popper'} size={30} color={colors.primary} />
          </View>
          <ThemedText style={styles.emptyTitle}>{filtered ? '没有找到匹配记忆卡' : '还没有聚会记忆卡'}</ThemedText>
          <ThemedText style={[styles.emptyBody, { color: colors.mutedText }]}>
            {filtered ? '清除筛选或搜索词后查看真实记录。' : '从一场真实聚会开始记录，不预置任何演示数据。'}
          </ThemedText>
          {!filtered ? (
            <Pressable accessibilityRole="button" onPress={props.onOpenCreate} style={[styles.primaryButton, { backgroundColor: colors.hero }]}>
              <ThemedText style={styles.primaryButtonText}>记录第一场聚会</ThemedText>
              <MaterialCommunityIcons name="plus" size={17} color="#c9f36a" />
            </Pressable>
          ) : null}
        </SurfaceCard>
      ) : (
        <View style={styles.cardList}>
          {cards.map((card) => (
            <PartyCardRow key={card.id} card={card} colors={colors} onPress={() => props.onOpenCard(card.id)} />
          ))}
        </View>
      )}

      <View style={styles.exportRow}>
        <Pressable accessibilityRole="button" onPress={() => props.onExport('csv')} style={[styles.exportButton, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <MaterialCommunityIcons name="file-delimited-outline" size={16} color={colors.primary} />
          <ThemedText style={[styles.exportText, { color: colors.text }]}>导出 CSV</ThemedText>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => props.onExport('json')} style={[styles.exportButton, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <MaterialCommunityIcons name="code-json" size={16} color={colors.primary} />
          <ThemedText style={[styles.exportText, { color: colors.text }]}>导出 JSON</ThemedText>
        </Pressable>
      </View>
      {props.busy ? <ThemedText style={[styles.busyText, { color: colors.mutedText }]}>正在同步真实数据...</ThemedText> : null}
    </>
  );
}

function PartyCardRow(props: { card: PartyCard; colors: ReturnType<typeof useAppTheme>['colors']; onPress: () => void }) {
  const { card, colors } = props;
  return (
    <Pressable accessibilityRole="button" onPress={props.onPress} style={[styles.cardRow, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <View style={[styles.cardRowIcon, { backgroundColor: `${colors.accent}18` }]}>
        <MaterialCommunityIcons name="party-popper" size={20} color={colors.accent} />
      </View>
      <View style={styles.cardRowCopy}>
        <ThemedText style={styles.cardRowTitle}>{card.venueName}</ThemedText>
        <ThemedText style={[styles.cardRowMeta, { color: colors.mutedText }]}>
          {formatPartyDate(card.partyDate)} · {hostLabel(card)}
        </ThemedText>
        <ThemedText style={[styles.cardRowMeta, { color: colors.mutedText }]}>
          {card.participantCount} 人 · {card.photoCount} 张照片 · {card.dishCount} 道菜
        </ThemedText>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={18} color={colors.mutedText} />
    </Pressable>
  );
}

function PrepTab(props: {
  prep: PartyNextPrep | null;
  colors: ReturnType<typeof useAppTheme>['colors'];
  onOpenCard: (cardId: string) => void;
  onOpenCreate: () => void;
}) {
  const { prep, colors } = props;
  if (!prep?.hasPrevious || !prep.card) {
    return (
      <SurfaceCard style={styles.emptyCard}>
        <View style={[styles.emptyIcon, { backgroundColor: colors.primarySoft }]}>
          <MaterialCommunityIcons name="calendar-heart" size={30} color={colors.primary} />
        </View>
        <ThemedText style={styles.emptyTitle}>还没有真实聚会记录</ThemedText>
        <ThemedText style={[styles.emptyBody, { color: colors.mutedText }]}>
          先记录一场真实聚会，下次准备页会引用最近一次卡片。
        </ThemedText>
        <Pressable accessibilityRole="button" onPress={props.onOpenCreate} style={[styles.primaryButton, { backgroundColor: colors.hero }]}>
          <ThemedText style={styles.primaryButtonText}>记录第一场聚会</ThemedText>
          <MaterialCommunityIcons name="plus" size={17} color="#c9f36a" />
        </Pressable>
      </SurfaceCard>
    );
  }
  const card = prep.card;
  const votes = card.againVotes ?? { want: 0, neutral: 0, not: 0 };
  return (
    <>
      <SurfaceCard style={styles.prepCard}>
        <View style={[styles.prepIcon, { backgroundColor: colors.accent + '18' }]}>
          <MaterialCommunityIcons name="party-popper" size={22} color={colors.accent} />
        </View>
        <View style={styles.prepCopy}>
          <ThemedText style={styles.prepTitle}>{card.venueName} · {formatPartyDate(card.partyDate)}</ThemedText>
          <ThemedText style={[styles.prepMeta, { color: colors.mutedText }]}>最近一次真实聚会 · {hostLabel(card)}</ThemedText>
        </View>
        <Pressable accessibilityRole="button" onPress={() => props.onOpenCard(card.id)} style={styles.prepAction}>
          <MaterialCommunityIcons name="chevron-right" size={18} color={colors.primary} />
        </Pressable>
      </SurfaceCard>

      <View style={styles.sectionBlock}>
        <SectionTitle title="上次请客" meta="真实记录" />
        <FactRow icon="crown" color={colors.accent} title={hostLabel(card)} subtitle={card.hostType === 'aa' ? '上次 AA 分摊，本次可自由选择' : '本次可以换一位真实参与人'} />
      </View>

      <View style={styles.sectionBlock}>
        <SectionTitle title="餐厅事实" meta="真实印象" />
        {prep.venueNotes && prep.venueNotes.length > 0 ? (
          prep.venueNotes.slice(0, 4).map((note) => (
            <FactRow
              key={note.id}
              icon="map-marker-check-outline"
              color={colors.primary}
              title={`${venueDimensionLabel(note.dimension)}：${note.content}`}
              subtitle={`${note.participantName} 的真实记录`}
            />
          ))
        ) : (
          <FactRow icon="map-marker-question-outline" color={colors.mutedText} title="暂无真实印象" subtitle="这张记忆卡还没有补充停车、口味或环境记录" />
        )}
      </View>

      <View style={styles.sectionBlock}>
        <SectionTitle title="菜品参考" meta="真实好评排序" />
        {prep.dishes && prep.dishes.length > 0 ? (
          prep.dishes.map((dish) => (
            <FactRow
              key={dish.id}
              icon="silverware-fork-knife"
              color={colors.primary}
              title={`${dish.name} · ${dishVoteSummary(dish)}`}
              subtitle={dish.priceCents != null ? `价格 ¥${centsToYuan(dish.priceCents)}` : '未记录价格'}
            />
          ))
        ) : (
          <FactRow icon="silverware-fork-knife" color={colors.mutedText} title="暂无菜品评价" subtitle="还没有人记录这道菜的真实评价" />
        )}
      </View>

      <View style={styles.sectionBlock}>
        <SectionTitle title="大家还想来吗" meta="真实投票" />
        <View style={styles.voteRow}>
          <VoteBox value={votes.want ?? 0} label="想去" color={colors.success} colors={colors} />
          <VoteBox value={votes.neutral ?? 0} label="一般" color={colors.primary} colors={colors} />
          <VoteBox value={votes.not ?? 0} label="不想去" color={colors.accent} colors={colors} />
        </View>
      </View>

      <Pressable accessibilityRole="button" onPress={props.onOpenCreate} style={[styles.primaryButton, { backgroundColor: colors.hero, marginTop: 12 }]}>
        <ThemedText style={styles.primaryButtonText}>发起新聚会</ThemedText>
        <MaterialCommunityIcons name="plus" size={17} color="#c9f36a" />
      </Pressable>
    </>
  );
}

function FactRow(props: { icon: string; color: string; title: string; subtitle: string }) {
  const { colors } = useAppTheme();
  return (
    <SurfaceCard style={styles.factRow}>
      <View style={[styles.factIcon, { backgroundColor: props.color + '18' }]}>
        <MaterialCommunityIcons name={props.icon as never} size={16} color={props.color} />
      </View>
      <View style={styles.factCopy}>
        <ThemedText style={styles.factTitle}>{props.title}</ThemedText>
        <ThemedText style={[styles.factMeta, { color: colors.mutedText }]}>{props.subtitle}</ThemedText>
      </View>
    </SurfaceCard>
  );
}

function VoteBox(props: { value: number; label: string; color: string; colors: ReturnType<typeof useAppTheme>['colors'] }) {
  return (
    <SurfaceCard style={styles.voteBox}>
      <ThemedText style={[styles.voteValue, { color: props.color }]}>{props.value}</ThemedText>
      <ThemedText style={[styles.voteLabel, { color: props.colors.mutedText }]}>{props.label}</ThemedText>
    </SurfaceCard>
  );
}

function SectionTitle(props: { title: string; meta: string }) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.sectionTitleRow}>
      <ThemedText style={styles.sectionTitle}>{props.title}</ThemedText>
      <ThemedText style={[styles.sectionMeta, { color: colors.mutedText }]}>{props.meta}</ThemedText>
    </View>
  );
}

function FilterPill(props: {
  label: string;
  active: boolean;
  icon?: string;
  colors: ReturnType<typeof useAppTheme>['colors'];
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={props.onPress}
      style={[
        styles.filterPill,
        {
          backgroundColor: props.active ? props.colors.primary : props.colors.surface,
          borderColor: props.active ? props.colors.primary : props.colors.line,
        },
      ]}>
      {props.icon ? <MaterialCommunityIcons name={props.icon as never} size={13} color={props.active ? '#ffffff' : props.colors.primary} /> : null}
      <ThemedText style={[styles.filterPillText, { color: props.active ? '#ffffff' : props.colors.text }]}>{props.label}</ThemedText>
    </Pressable>
  );
}

function CardFormModal(props: {
  open: boolean;
  detail: PartyCardDetail | null;
  friends: Friend[];
  accessToken: string;
  colors: ReturnType<typeof useAppTheme>['colors'];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [partyDate, setPartyDate] = useState(currentPartyDateValue());
  const [venueName, setVenueName] = useState('');
  const [venueAddress, setVenueAddress] = useState('');
  const [hostType, setHostType] = useState<'member' | 'aa' | 'other'>('member');
  const [hostParticipantId, setHostParticipantId] = useState('');
  const [expenseVisibility, setExpenseVisibility] = useState<'owner' | 'participants'>('participants');
  const [shareMode, setShareMode] = useState<'private' | 'shared'>('private');
  const [totalYuan, setTotalYuan] = useState('');
  const [participantName, setParticipantName] = useState('');
  const [participants, setParticipants] = useState<PartyParticipantInput[]>([]);
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.open) return;
    setTitle(props.detail?.title ?? '');
    setPartyDate(props.detail ? formatEditableDate(props.detail.partyDate) : currentPartyDateValue());
    setVenueName(props.detail?.venueName ?? '');
    setVenueAddress(props.detail?.venueAddress ?? '');
    setHostType(props.detail?.hostType ?? 'member');
    setHostParticipantId(props.detail?.hostParticipantId ?? '');
    setExpenseVisibility(props.detail?.expenseVisibility ?? 'participants');
    setShareMode(props.detail?.shareMode ?? 'private');
    setTotalYuan(props.detail?.totalAmountCents != null ? centsToYuan(props.detail.totalAmountCents) : '');
    setParticipantName('');
    setLocalError(null);
    if (props.detail) {
      setParticipants(
        props.detail.participants.map((participant) => ({
          clientId: participant.id,
          userId: participant.userId,
          name: participant.name,
        })),
      );
    } else {
      const creatorId = user?.id ? `user:${user.id}` : '';
      setParticipants([
        {
          clientId: buildParticipantClientId(),
          userId: user?.id,
          name: user?.displayName ?? user?.username ?? '我',
        },
        {
          clientId: buildParticipantClientId(),
          name: '',
        },
      ]);
    }
  }, [props.open, props.detail, user]);

  function addManualParticipant() {
    const name = participantName.trim();
    if (!name) return;
    setParticipants((current) => [
      ...current.filter((item) => item.name.trim()),
      { clientId: buildParticipantClientId(), name },
    ]);
    setParticipantName('');
  }

  function addFriend(friend: Friend) {
    if (participants.some((item) => item.userId === friend.user.id)) return;
    setParticipants((current) => [
      ...current.filter((item) => item.name.trim() || item.userId),
      {
        clientId: buildParticipantClientId(),
        userId: friend.user.id,
        name: friend.user.displayName || friend.user.username,
      },
    ]);
  }

  function removeParticipant(index: number) {
    setParticipants((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  async function save() {
    const totalAmountCents = yuanToCents(totalYuan);
    if (totalYuan.trim() && totalAmountCents == null) {
      setLocalError('请填写正确的金额。');
      return;
    }
    const validParticipants = participants.filter((participant) => participant.name.trim());
    const input: PartyCardInput = {
      title,
      partyDate,
      venueName,
      venueAddress,
      hostType,
      hostParticipantId,
      totalAmountCents,
      expenseVisibility,
      shareMode,
      participants: validParticipants,
    };
    const validation = validateCardBasics(input);
    if (validation) {
      setLocalError(validation);
      return;
    }
    setSaving(true);
    setLocalError(null);
    try {
      if (props.detail) {
        await updatePartyMemoryCard(props.accessToken, props.detail.id, input);
      } else {
        await createPartyMemoryCard(props.accessToken, input);
      }
      await props.onSaved();
    } catch (nextError) {
      setLocalError(getPartyMemoryCardErrorMessage(nextError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={props.open} animationType="slide" transparent onRequestClose={props.onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
        <View style={[styles.modalCard, { backgroundColor: props.colors.surface }]}>
          <View style={styles.modalHeader}>
            <Pressable onPress={props.onClose} style={styles.iconButtonPlain}>
              <MaterialCommunityIcons name="close" size={20} color={props.colors.text} />
            </Pressable>
            <ThemedText style={styles.modalTitle}>{props.detail ? '编辑记忆卡' : '记录一场聚会'}</ThemedText>
            <Pressable onPress={() => void save()} style={styles.saveTextButton} disabled={saving}>
              <ThemedText style={[styles.saveText, { color: props.colors.primary }]}>{saving ? '保存中' : '保存'}</ThemedText>
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.formContent}>
            {localError ? (
              <View style={[styles.localError, { backgroundColor: props.colors.accent + '18' }]}>
                <MaterialCommunityIcons name="alert-circle-outline" size={15} color={props.colors.accent} />
                <ThemedText style={[styles.localErrorText, { color: props.colors.accent }]}>{localError}</ThemedText>
              </View>
            ) : null}
            <FormLabel>聚会主题（可选）</FormLabel>
            <TextInput value={title} onChangeText={setTitle} placeholder="例如 8月老友聚餐" placeholderTextColor={props.colors.mutedText} style={[styles.input, { backgroundColor: props.colors.surfaceMuted, borderColor: props.colors.line, color: props.colors.text }]} />
            <FormLabel>聚会日期</FormLabel>
            <TextInput value={partyDate} onChangeText={setPartyDate} placeholder="2026-08-06 20:30" placeholderTextColor={props.colors.mutedText} style={[styles.input, { backgroundColor: props.colors.surfaceMuted, borderColor: props.colors.line, color: props.colors.text }]} />
            <FormLabel>餐厅 / 地点</FormLabel>
            <TextInput value={venueName} onChangeText={setVenueName} placeholder="真实餐厅或地点名称" placeholderTextColor={props.colors.mutedText} style={[styles.input, { backgroundColor: props.colors.surfaceMuted, borderColor: props.colors.line, color: props.colors.text }]} />
            <FormLabel>地址（可选）</FormLabel>
            <TextInput value={venueAddress} onChangeText={setVenueAddress} placeholder="真实地址" placeholderTextColor={props.colors.mutedText} style={[styles.input, { backgroundColor: props.colors.surfaceMuted, borderColor: props.colors.line, color: props.colors.text }]} />

            <FormLabel>参与人</FormLabel>
            <View style={styles.participantInputRow}>
              <TextInput
                value={participantName}
                onChangeText={setParticipantName}
                placeholder="输入真实姓名或昵称"
                placeholderTextColor={props.colors.mutedText}
                style={[styles.input, { flex: 1, backgroundColor: props.colors.surfaceMuted, borderColor: props.colors.line, color: props.colors.text }]}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="添加参与人"
                onPress={addManualParticipant}
                style={[styles.smallPrimaryButton, { backgroundColor: props.colors.primary }]}>
                <MaterialCommunityIcons name="plus" size={17} color="#ffffff" />
              </Pressable>
            </View>
            {props.friends.length > 0 ? (
              <View style={styles.friendChips}>
                {props.friends.map((friend) => (
                  <FilterPill
                    key={friend.user.id}
                    label={friend.user.displayName || friend.user.username}
                    active={participants.some((item) => item.userId === friend.user.id)}
                    icon="account"
                    colors={props.colors}
                    onPress={() => addFriend(friend)}
                  />
                ))}
              </View>
            ) : null}
            <View style={styles.participantChips}>
              {participants.filter((item) => item.name.trim()).map((participant, index) => (
                <View key={participant.clientId ?? index} style={[styles.participantChip, { backgroundColor: props.colors.surfaceMuted, borderColor: props.colors.line }]}>
                  <MaterialCommunityIcons name={participant.userId ? 'account-check' : 'account-outline'} size={14} color={props.colors.primary} />
                  <ThemedText style={[styles.participantChipText, { color: props.colors.text }]}>{participant.name}</ThemedText>
                  <Pressable onPress={() => removeParticipant(index)}>
                    <MaterialCommunityIcons name="close-circle" size={15} color={props.colors.accent} />
                  </Pressable>
                </View>
              ))}
            </View>

            <FormLabel>谁请客</FormLabel>
            <View style={styles.segmentRow}>
              {(['member', 'aa', 'other'] as const).map((type) => (
                <Pressable
                  key={type}
                  onPress={() => setHostType(type)}
                  style={[
                    styles.segment,
                    { backgroundColor: hostType === type ? props.colors.primary : props.colors.surfaceMuted, borderColor: hostType === type ? props.colors.primary : props.colors.line },
                  ]}>
                  <ThemedText style={[styles.segmentText, { color: hostType === type ? '#ffffff' : props.colors.text }]}>{hostTypeLabel(type)}</ThemedText>
                </Pressable>
              ))}
            </View>
            {hostType === 'member' ? (
              <View style={styles.chipWrap}>
                {participants.filter((item) => item.name.trim()).map((participant, index) => (
                  <FilterPill
                    key={participant.clientId ?? index}
                    label={participant.name}
                    active={hostParticipantId === participant.clientId}
                    colors={props.colors}
                    onPress={() => setHostParticipantId(participant.clientId ?? '')}
                  />
                ))}
              </View>
            ) : null}

            <FormLabel>总费用（元，可选）</FormLabel>
            <TextInput
              value={totalYuan}
              onChangeText={setTotalYuan}
              keyboardType="decimal-pad"
              placeholder="例如 486"
              placeholderTextColor={props.colors.mutedText}
              style={[styles.input, { backgroundColor: props.colors.surfaceMuted, borderColor: props.colors.line, color: props.colors.text }]}
            />

            <FormLabel>费用可见性</FormLabel>
            <View style={styles.segmentRow}>
              <Pressable onPress={() => setExpenseVisibility('participants')} style={[styles.segment, { backgroundColor: expenseVisibility === 'participants' ? props.colors.primary : props.colors.surfaceMuted, borderColor: props.colors.line }]}>
                <ThemedText style={[styles.segmentText, { color: expenseVisibility === 'participants' ? '#ffffff' : props.colors.text }]}>参与人可见</ThemedText>
              </Pressable>
              <Pressable onPress={() => setExpenseVisibility('owner')} style={[styles.segment, { backgroundColor: expenseVisibility === 'owner' ? props.colors.primary : props.colors.surfaceMuted, borderColor: props.colors.line }]}>
                <ThemedText style={[styles.segmentText, { color: expenseVisibility === 'owner' ? '#ffffff' : props.colors.text }]}>仅创建人</ThemedText>
              </Pressable>
            </View>

            <FormLabel>协作模式</FormLabel>
            <View style={styles.segmentRow}>
              <Pressable onPress={() => setShareMode('shared')} style={[styles.segment, { backgroundColor: shareMode === 'shared' ? props.colors.primary : props.colors.surfaceMuted, borderColor: props.colors.line }]}>
                <ThemedText style={[styles.segmentText, { color: shareMode === 'shared' ? '#ffffff' : props.colors.text }]}>共享给参与人</ThemedText>
              </Pressable>
              <Pressable onPress={() => setShareMode('private')} style={[styles.segment, { backgroundColor: shareMode === 'private' ? props.colors.primary : props.colors.surfaceMuted, borderColor: props.colors.line }]}>
                <ThemedText style={[styles.segmentText, { color: shareMode === 'private' ? '#ffffff' : props.colors.text }]}>仅自己</ThemedText>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function DetailModal(props: {
  open: boolean;
  detail: PartyCardDetail | null;
  accessToken: string;
  colors: ReturnType<typeof useAppTheme>['colors'];
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onSaved: () => Promise<void>;
}) {
  const [dishOpen, setDishOpen] = useState(false);
  const [dishName, setDishName] = useState('');
  const [dishPrice, setDishPrice] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteDimension, setNoteDimension] = useState<PartyVenueDimension>('parking');
  const [noteContent, setNoteContent] = useState('');
  const [busyAction, setBusyAction] = useState(false);

  useEffect(() => {
    setDishOpen(false);
    setNoteOpen(false);
  }, [props.open]);

  async function run(action: () => Promise<unknown>) {
    if (busyAction || !props.detail) return;
    setBusyAction(true);
    try {
      await action();
      await props.onSaved();
    } catch (nextError) {
      Alert.alert('操作失败', getPartyMemoryCardErrorMessage(nextError));
    } finally {
      setBusyAction(false);
    }
  }

  async function pickPhoto(cover = false) {
    if (!props.detail) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    await run(async () => {
      await uploadPartyMemoryCardPhoto(props.accessToken, props.detail!.id, {
        uri: asset.uri,
        name: asset.fileName ?? 'party-photo.jpg',
        type: asset.mimeType ?? 'image/jpeg',
      }, { cover });
    });
  }

  async function saveDish() {
    if (!props.detail) return;
    const name = dishName.trim();
    if (!name) return;
    const priceCents = yuanToCents(dishPrice);
    if (dishPrice.trim() && priceCents == null) {
      Alert.alert('金额格式不正确', '请填写正确的菜品价格。');
      return;
    }
    await run(async () => {
      await createPartyDish(props.accessToken, props.detail!.id, { name, priceCents });
    });
    setDishName('');
    setDishPrice('');
    setDishOpen(false);
  }

  async function saveNote() {
    if (!props.detail) return;
    const input: PartyVenueNoteInput = { dimension: noteDimension, content: noteContent.trim() };
    if (!input.content) return;
    await run(async () => {
      await addPartyVenueNote(props.accessToken, props.detail!.id, input);
    });
    setNoteContent('');
    setNoteOpen(false);
  }

  if (!props.detail) return null;
  const detail = props.detail;
  const votes = detail.againVotes ?? { want: 0, neutral: 0, not: 0 };
  const dimensions: PartyVenueDimension[] = ['parking', 'taste', 'ambience', 'service', 'location', 'other'];

  return (
    <Modal visible={props.open} animationType="slide" transparent onRequestClose={props.onClose}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.modalCard, { backgroundColor: props.colors.surface }]}>
          <View style={styles.modalHeader}>
            <Pressable onPress={props.onClose} style={styles.iconButtonPlain}>
              <MaterialCommunityIcons name="close" size={20} color={props.colors.text} />
            </Pressable>
            <ThemedText style={styles.modalTitle}>{detail.venueName}</ThemedText>
            <View style={styles.headerActions}>
              {detail.canEdit ? (
                <Pressable onPress={props.onEdit} style={styles.iconButtonPlain}>
                  <MaterialCommunityIcons name="pencil-outline" size={18} color={props.colors.primary} />
                </Pressable>
              ) : null}
              {detail.canEdit ? (
                <Pressable onPress={props.onDelete} style={styles.iconButtonPlain}>
                  <MaterialCommunityIcons name="trash-can-outline" size={18} color={props.colors.accent} />
                </Pressable>
              ) : null}
            </View>
          </View>
          <ScrollView contentContainerStyle={styles.detailContent}>
            <SurfaceCard style={styles.detailHero}>
              <ThemedText style={styles.detailVenue}>{detail.venueName}</ThemedText>
              <ThemedText style={[styles.detailMeta, { color: props.colors.mutedText }]}>
                {formatPartyDate(detail.partyDate)} · {detail.venueAddress || '未记录地址'}
              </ThemedText>
              <View style={styles.detailHeroChips}>
                <HeroChip icon="account-group-outline" text={`${detail.participantCount} 人`} color={props.colors.primary} colors={props.colors} />
                <HeroChip icon="camera-outline" text={`${detail.photoCount} 张照片`} color={props.colors.accent} colors={props.colors} />
                <HeroChip icon="crown-outline" text={hostLabel(detail)} color={props.colors.success} colors={props.colors} />
              </View>
            </SurfaceCard>

            <View style={styles.sectionBlock}>
              <SectionTitle title="参与人" meta={detail.canEdit ? '可添加 / 移除' : '真实成员'} />
              {detail.participants.map((participant) => (
                <View key={participant.id} style={[styles.participantRow, { backgroundColor: props.colors.surfaceMuted, borderColor: props.colors.line }]}>
                  <View style={[styles.avatar, { backgroundColor: `${props.colors.primary}18` }]}>
                    <ThemedText style={[styles.avatarText, { color: props.colors.primary }]}>{participantInitial(participant.name)}</ThemedText>
                  </View>
                  <View style={styles.participantCopy}>
                    <ThemedText style={styles.participantName}>{participant.name}</ThemedText>
                    <ThemedText style={[styles.participantMeta, { color: props.colors.mutedText }]}>
                      {participant.kind === 'friend' ? '真实好友' : '手动输入'} · {participant.inviteStatus === 'joined' ? '已参与' : participant.inviteStatus === 'pending' ? '待接受' : '已拒绝'}
                    </ThemedText>
                  </View>
                  {detail.canEdit ? (
                    <Pressable
                      onPress={() =>
                        Alert.alert('移除参与人', `确定移除“${participant.name}”吗？`, [
                          { text: '取消', style: 'cancel' },
                          {
                            text: '移除',
                            style: 'destructive',
                            onPress: () =>
                              void run(async () => {
                                await removePartyParticipant(props.accessToken, detail.id, participant.id);
                              }),
                          },
                        ])
                      }
                      style={styles.iconButtonPlain}>
                      <MaterialCommunityIcons name="close-circle-outline" size={17} color={props.colors.accent} />
                    </Pressable>
                  ) : null}
                </View>
              ))}
            </View>

            <View style={styles.sectionBlock}>
              <SectionTitle title="真实照片" meta={`${detail.photos.length} 张 · 最多 30 张`} />
              {detail.photos.length > 0 ? (
                <View style={styles.photoGrid}>
                  {detail.photos.map((photo) => (
                    <View key={photo.id} style={styles.photoTile}>
                      <PartyPhotoImage imageUrl={photo.fileUrl} token={props.accessToken} style={styles.photoImage} />
                      {detail.canCollaborate || photo.userId === detail.ownerUserId ? (
                        <Pressable
                          onPress={() =>
                            Alert.alert('删除照片', '删除这张真实照片吗？', [
                              { text: '取消', style: 'cancel' },
                              {
                                text: '删除',
                                style: 'destructive',
                                onPress: () =>
                                  void run(async () => {
                                    await deletePartyMemoryCardPhoto(props.accessToken, detail.id, photo.id);
                                  }),
                              },
                            ])
                          }
                          style={styles.photoDelete}>
                          <MaterialCommunityIcons name="close" size={12} color="#ffffff" />
                        </Pressable>
                      ) : null}
                    </View>
                  ))}
                </View>
              ) : (
                <ThemedText style={[styles.emptyInline, { color: props.colors.mutedText }]}>暂无照片</ThemedText>
              )}
              {detail.canCollaborate ? (
                <Pressable onPress={() => void pickPhoto(false)} style={[styles.addButton, { borderColor: props.colors.line, backgroundColor: props.colors.surfaceMuted }]}>
                  <MaterialCommunityIcons name="camera-plus-outline" size={17} color={props.colors.primary} />
                  <ThemedText style={[styles.addButtonText, { color: props.colors.primary }]}>上传真实照片</ThemedText>
                </Pressable>
              ) : null}
            </View>

            <View style={styles.sectionBlock}>
              <SectionTitle title="点的菜" meta="真实菜名与评价" />
              {detail.dishes.length > 0 ? (
                detail.dishes.map((dish) => (
                  <DishRow
                    key={dish.id}
                    dish={dish}
                    colors={props.colors}
                    canVote={detail.canCollaborate}
                    onVote={(rating) =>
                      void run(async () => {
                        await votePartyDish(props.accessToken, detail.id, dish.id, { rating });
                      })
                    }
                    onDelete={
                      detail.canEdit || dish.createdByUserId === detail.ownerUserId
                        ? () =>
                            Alert.alert('删除菜品', `删除“${dish.name}”吗？`, [
                              { text: '取消', style: 'cancel' },
                              {
                                text: '删除',
                                style: 'destructive',
                                onPress: () =>
                                  void run(async () => {
                                    await deletePartyDish(props.accessToken, detail.id, dish.id);
                                  }),
                              },
                            ])
                        : undefined
                    }
                  />
                ))
              ) : (
                <ThemedText style={[styles.emptyInline, { color: props.colors.mutedText }]}>暂无菜品</ThemedText>
              )}
              {detail.canCollaborate ? (
                <Pressable onPress={() => setDishOpen(true)} style={[styles.addButton, { borderColor: props.colors.line, backgroundColor: props.colors.surfaceMuted }]}>
                  <MaterialCommunityIcons name="silverware-fork-knife" size={17} color={props.colors.primary} />
                  <ThemedText style={[styles.addButtonText, { color: props.colors.primary }]}>添加真实菜品</ThemedText>
                </Pressable>
              ) : null}
            </View>

            <View style={styles.sectionBlock}>
              <SectionTitle title="账单" meta={detail.totalAmountCents != null ? '真实金额' : '暂无账单'} />
              <SurfaceCard style={styles.expenseCard}>
                <View>
                  <ThemedText style={[styles.expenseLabel, { color: props.colors.mutedText }]}>总费用</ThemedText>
                  <ThemedText style={styles.expenseAmount}>{formatAmount(detail.totalAmountCents)}</ThemedText>
                </View>
                <View style={styles.expenseMeta}>
                  <ThemedText style={[styles.expenseHost, { color: props.colors.primary }]}>{hostLabel(detail)}</ThemedText>
                  <ThemedText style={[styles.expenseNote, { color: props.colors.mutedText }]}>
                    {detail.totalAmountCents != null && detail.participantCount > 0 && detail.hostType === 'aa'
                      ? `${detail.participantCount} 人 · 人均 ¥${centsToYuan(Math.round(detail.totalAmountCents / detail.participantCount))}`
                      : `${detail.participantCount} 位真实参与人`}
                  </ThemedText>
                </View>
              </SurfaceCard>
            </View>

            <View style={styles.sectionBlock}>
              <SectionTitle title="餐厅印象" meta="停车 / 口味 / 环境 / 服务" />
              {detail.venueNotes.length > 0 ? (
                detail.venueNotes.map((note) => (
                  <View key={note.id} style={[styles.noteRow, { backgroundColor: props.colors.surfaceMuted, borderColor: props.colors.line }]}>
                    <View style={styles.noteIcon}>
                      <MaterialCommunityIcons name="map-marker-check-outline" size={15} color={props.colors.primary} />
                    </View>
                    <View style={styles.noteCopy}>
                      <ThemedText style={styles.noteTitle}>{venueDimensionLabel(note.dimension)}：{note.content}</ThemedText>
                      <ThemedText style={[styles.noteMeta, { color: props.colors.mutedText }]}>{note.participantName}</ThemedText>
                    </View>
                    {detail.canEdit ? (
                      <Pressable
                        onPress={() =>
                          Alert.alert('删除印象', '删除这条真实印象吗？', [
                            { text: '取消', style: 'cancel' },
                            {
                              text: '删除',
                              style: 'destructive',
                              onPress: () =>
                                void run(async () => {
                                  await deletePartyVenueNote(props.accessToken, detail.id, note.id);
                                }),
                            },
                          ])
                        }
                        style={styles.iconButtonPlain}>
                        <MaterialCommunityIcons name="close-circle-outline" size={16} color={props.colors.accent} />
                      </Pressable>
                    ) : null}
                  </View>
                ))
              ) : (
                <ThemedText style={[styles.emptyInline, { color: props.colors.mutedText }]}>暂无真实印象</ThemedText>
              )}
              {detail.canCollaborate ? (
                <Pressable onPress={() => setNoteOpen(true)} style={[styles.addButton, { borderColor: props.colors.line, backgroundColor: props.colors.surfaceMuted }]}>
                  <MaterialCommunityIcons name="note-plus-outline" size={17} color={props.colors.primary} />
                  <ThemedText style={[styles.addButtonText, { color: props.colors.primary }]}>补充真实印象</ThemedText>
                </Pressable>
              ) : null}
            </View>

            <View style={styles.sectionBlock}>
              <SectionTitle title="下次还想去吗" meta="一人一票" />
              <View style={styles.voteRow}>
                {(['want', 'neutral', 'not'] as const).map((vote) => (
                  <Pressable
                    key={vote}
                    onPress={() =>
                      detail.canCollaborate
                        ? void run(async () => {
                            await addPartyAgainVote(props.accessToken, detail.id, { vote });
                          })
                        : undefined
                    }
                    style={[
                      styles.voteBox,
                      {
                        backgroundColor: votes[vote] > 0 ? `${vote === 'want' ? props.colors.success : vote === 'neutral' ? props.colors.primary : props.colors.accent}18` : props.colors.surfaceMuted,
                        borderColor: props.colors.line,
                      },
                    ]}>
                    <ThemedText style={[styles.voteValue, { color: vote === 'want' ? props.colors.success : vote === 'neutral' ? props.colors.primary : props.colors.accent }]}>{votes[vote] ?? 0}</ThemedText>
                    <ThemedText style={[styles.voteLabel, { color: props.colors.mutedText }]}>{againVoteLabel(vote)}</ThemedText>
                  </Pressable>
                ))}
              </View>
            </View>

            <View style={styles.sectionBlock}>
              <SectionTitle title="真实动态" meta="仅展示实际发生的操作" />
              {detail.activities.length > 0 ? (
                detail.activities.slice(0, 8).map((event) => (
                  <View key={event.id} style={[styles.activityRow, { backgroundColor: props.colors.surfaceMuted, borderColor: props.colors.line }]}>
                    <MaterialCommunityIcons name="message-processing-outline" size={15} color={props.colors.primary} />
                    <View style={styles.activityCopy}>
                      <ThemedText style={styles.activityTitle}>{activityActionLabel(event.action)}</ThemedText>
                      <ThemedText style={[styles.activityMeta, { color: props.colors.mutedText }]}>{formatPartyDate(event.createdAt)}</ThemedText>
                    </View>
                  </View>
                ))
              ) : (
                <ThemedText style={[styles.emptyInline, { color: props.colors.mutedText }]}>暂无动态</ThemedText>
              )}
            </View>
          </ScrollView>
        </View>
      </View>

      <Modal visible={dishOpen} transparent animationType="fade">
        <View style={styles.inlineModalBackdrop}>
          <View style={[styles.inlineModal, { backgroundColor: props.colors.surface }]}>
            <ThemedText style={styles.modalTitle}>添加真实菜品</ThemedText>
            <TextInput value={dishName} onChangeText={setDishName} placeholder="菜名" placeholderTextColor={props.colors.mutedText} style={[styles.input, { backgroundColor: props.colors.surfaceMuted, borderColor: props.colors.line, color: props.colors.text }]} />
            <TextInput value={dishPrice} onChangeText={setDishPrice} keyboardType="decimal-pad" placeholder="价格（元，可选）" placeholderTextColor={props.colors.mutedText} style={[styles.input, { backgroundColor: props.colors.surfaceMuted, borderColor: props.colors.line, color: props.colors.text }]} />
            <View style={styles.modalActions}>
              <Pressable onPress={() => setDishOpen(false)} style={[styles.secondaryButton, { borderColor: props.colors.line }]}>
                <ThemedText style={[styles.secondaryButtonText, { color: props.colors.text }]}>取消</ThemedText>
              </Pressable>
              <Pressable onPress={() => void saveDish()} style={[styles.primaryButton, { backgroundColor: props.colors.primary }]}>
                <ThemedText style={styles.primaryButtonText}>保存</ThemedText>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={noteOpen} transparent animationType="fade">
        <View style={styles.inlineModalBackdrop}>
          <View style={[styles.inlineModal, { backgroundColor: props.colors.surface }]}>
            <ThemedText style={styles.modalTitle}>补充真实印象</ThemedText>
            <View style={styles.chipWrap}>
              {dimensions.map((dimension) => (
                <FilterPill
                  key={dimension}
                  label={venueDimensionLabel(dimension)}
                  active={noteDimension === dimension}
                  colors={props.colors}
                  onPress={() => setNoteDimension(dimension)}
                />
              ))}
            </View>
            <TextInput value={noteContent} onChangeText={setNoteContent} placeholder="例如 停车不方便，绕了两圈" placeholderTextColor={props.colors.mutedText} multiline style={[styles.input, { minHeight: 76, backgroundColor: props.colors.surfaceMuted, borderColor: props.colors.line, color: props.colors.text, textAlignVertical: 'top' }]} />
            <View style={styles.modalActions}>
              <Pressable onPress={() => setNoteOpen(false)} style={[styles.secondaryButton, { borderColor: props.colors.line }]}>
                <ThemedText style={[styles.secondaryButtonText, { color: props.colors.text }]}>取消</ThemedText>
              </Pressable>
              <Pressable onPress={() => void saveNote()} style={[styles.primaryButton, { backgroundColor: props.colors.primary }]}>
                <ThemedText style={styles.primaryButtonText}>保存</ThemedText>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </Modal>
  );
}

function DishRow(props: {
  dish: PartyDish;
  colors: ReturnType<typeof useAppTheme>['colors'];
  canVote: boolean;
  onVote: (rating: PartyDishRating) => void;
  onDelete?: () => void;
}) {
  const { dish, colors } = props;
  return (
    <SurfaceCard style={styles.dishRow}>
      <View style={[styles.dishIcon, { backgroundColor: colors.primarySoft }]}>
        <MaterialCommunityIcons name="silverware-fork-knife" size={16} color={colors.primary} />
      </View>
      <View style={styles.dishCopy}>
        <ThemedText style={styles.dishName}>{dish.name}</ThemedText>
        <ThemedText style={[styles.dishMeta, { color: colors.mutedText }]}>
          {dishVoteSummary(dish)} · {dish.priceCents != null ? `¥${centsToYuan(dish.priceCents)}` : '未记录价格'}
        </ThemedText>
        {props.canVote ? (
          <View style={styles.ratingRow}>
            {(['like', 'ok', 'no'] as const).map((rating) => (
              <Pressable key={rating} onPress={() => props.onVote(rating)} style={[styles.ratingPill, { backgroundColor: `${colors.primary}12`, borderColor: colors.line }]}>
                <ThemedText style={[styles.ratingPillText, { color: colors.primary }]}>{dishRatingLabel(rating)}</ThemedText>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
      {props.onDelete ? (
        <Pressable onPress={props.onDelete} style={styles.iconButtonPlain}>
          <MaterialCommunityIcons name="close-circle-outline" size={16} color={colors.accent} />
        </Pressable>
      ) : null}
    </SurfaceCard>
  );
}

function PartyPhotoImage(props: { imageUrl: string; token: string; style: object }) {
  const [webURI, setWebURI] = useState<string | null>(null);
  useEffect(() => {
    if (Platform.OS !== 'web' || !props.imageUrl) return;
    let active = true;
    let objectURL: string | null = null;
    void fetch(partyMemoryCardMediaURL(props.imageUrl), {
      headers: { Authorization: `Bearer ${props.token}` },
    })
      .then((response) => {
        if (!response.ok) throw new Error('party image request failed');
        return response.blob();
      })
      .then((blob) => {
        objectURL = URL.createObjectURL(blob);
        if (active) setWebURI(objectURL);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      if (objectURL) URL.revokeObjectURL(objectURL);
    };
  }, [props.imageUrl, props.token]);
  if (Platform.OS === 'web' && webURI) {
    return <Image source={{ uri: webURI }} style={props.style} contentFit="cover" />;
  }
  return <Image source={partyMemoryCardImageSource(props.token, props.imageUrl)} style={props.style} contentFit="cover" />;
}

function HeroChip(props: { icon: string; text: string; color: string; colors: ReturnType<typeof useAppTheme>['colors'] }) {
  return (
    <View style={[styles.heroChip, { backgroundColor: props.color + '18' }]}>
      <MaterialCommunityIcons name={props.icon as never} size={12} color={props.color} />
      <ThemedText style={[styles.heroChipText, { color: props.color }]}>{props.text}</ThemedText>
    </View>
  );
}

function FormLabel(props: { children: string }) {
  const { colors } = useAppTheme();
  return <ThemedText style={[styles.formLabel, { color: colors.mutedText }]}>{props.children}</ThemedText>;
}

function formatEditableDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (num: number) => String(num).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const styles = StyleSheet.create({
  pageContent: { paddingBottom: 24 },
  headerActions: { flexDirection: 'row', gap: 8 },
  iconButton: {
    alignItems: 'center',
    borderRadius: 11,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  iconButtonPlain: { alignItems: 'center', height: 30, justifyContent: 'center', width: 30 },
  noticeCard: { alignItems: 'center', padding: 20 },
  noticeIcon: {
    alignItems: 'center',
    borderRadius: 14,
    height: 52,
    justifyContent: 'center',
    marginBottom: 12,
    width: 52,
  },
  noticeTitle: { fontSize: 16, fontWeight: '800' },
  noticeBody: { fontSize: 12, lineHeight: 20, marginBottom: 16, marginTop: 8, textAlign: 'center' },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 11,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: 16,
  },
  primaryButtonText: { color: '#c9f36a', fontSize: 13, fontWeight: '900' },
  secondaryButton: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 40,
  },
  secondaryButtonText: { fontSize: 12, fontWeight: '800' },
  quickStats: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  statCard: { alignItems: 'center', flex: 1, padding: 10 },
  statValue: { fontSize: 17, fontWeight: '900', marginTop: 5 },
  statLabel: { fontSize: 9, fontWeight: '700', marginTop: 1 },
  tabs: {
    borderRadius: 12,
    flexDirection: 'row',
    gap: 4,
    marginBottom: 12,
    padding: 4,
  },
  tabButton: {
    alignItems: 'center',
    borderRadius: 9,
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    paddingVertical: 9,
  },
  tabLabel: { fontSize: 12, fontWeight: '900' },
  messageBanner: {
    alignItems: 'center',
    borderRadius: 10,
    flexDirection: 'row',
    gap: 7,
    marginBottom: 10,
    padding: 10,
  },
  messageText: { flex: 1, fontSize: 11, fontWeight: '700' },
  loadingCard: { alignItems: 'center', gap: 10, padding: 22 },
  loadingText: { fontSize: 11, fontWeight: '700' },
  searchField: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    height: 44,
    marginBottom: 12,
    paddingHorizontal: 12,
  },
  searchInput: { flex: 1, fontSize: 12, fontWeight: '700' },
  clearSearch: { padding: 2 },
  sectionBlock: { marginBottom: 14 },
  sectionTitleRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  sectionTitle: { fontSize: 13, fontWeight: '900' },
  sectionMeta: { fontSize: 9, fontWeight: '700' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  filterPill: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    minHeight: 32,
    paddingHorizontal: 11,
  },
  filterPillText: { fontSize: 10, fontWeight: '800' },
  emptyCard: { alignItems: 'center', padding: 24 },
  emptyIcon: {
    alignItems: 'center',
    borderRadius: 16,
    height: 64,
    justifyContent: 'center',
    marginBottom: 12,
    width: 64,
  },
  emptyTitle: { fontSize: 15, fontWeight: '900' },
  emptyBody: { fontSize: 11, lineHeight: 18, marginBottom: 14, marginTop: 6, textAlign: 'center' },
  cardList: { gap: 9 },
  cardRow: {
    alignItems: 'center',
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    padding: 11,
  },
  cardRowIcon: {
    alignItems: 'center',
    borderRadius: 11,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  cardRowCopy: { flex: 1 },
  cardRowTitle: { fontSize: 13, fontWeight: '900' },
  cardRowMeta: { fontSize: 9, lineHeight: 15, marginTop: 2 },
  exportRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  exportButton: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minHeight: 38,
  },
  exportText: { fontSize: 10, fontWeight: '800' },
  busyText: { fontSize: 9, fontWeight: '700', marginTop: 8, textAlign: 'center' },
  prepCard: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
    padding: 12,
  },
  prepIcon: {
    alignItems: 'center',
    borderRadius: 12,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  prepCopy: { flex: 1 },
  prepTitle: { fontSize: 13, fontWeight: '900' },
  prepMeta: { fontSize: 9, marginTop: 3 },
  prepAction: { padding: 4 },
  factRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    marginBottom: 7,
    padding: 10,
  },
  factIcon: {
    alignItems: 'center',
    borderRadius: 10,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  factCopy: { flex: 1 },
  factTitle: { fontSize: 11, fontWeight: '900' },
  factMeta: { fontSize: 9, marginTop: 2 },
  voteRow: { flexDirection: 'row', gap: 8 },
  voteBox: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    padding: 10,
  },
  voteValue: { fontSize: 17, fontWeight: '900' },
  voteLabel: { fontSize: 9, fontWeight: '800', marginTop: 2 },
  modalBackdrop: {
    backgroundColor: 'rgba(9,17,38,0.48)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalCard: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '92%',
    paddingBottom: 10,
  },
  modalHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  modalTitle: { fontSize: 15, fontWeight: '900' },
  saveTextButton: { minWidth: 44 },
  saveText: { fontSize: 12, fontWeight: '900', textAlign: 'right' },
  formContent: { gap: 9, paddingBottom: 30, paddingHorizontal: 16 },
  detailContent: { paddingBottom: 30, paddingHorizontal: 16 },
  formLabel: { fontSize: 10, fontWeight: '900', marginTop: 3 },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    fontSize: 12,
    fontWeight: '700',
    minHeight: 42,
    paddingHorizontal: 11,
  },
  localError: {
    alignItems: 'center',
    borderRadius: 10,
    flexDirection: 'row',
    gap: 7,
    padding: 9,
  },
  localErrorText: { flex: 1, fontSize: 10, fontWeight: '700' },
  participantInputRow: { flexDirection: 'row', gap: 8 },
  smallPrimaryButton: {
    alignItems: 'center',
    borderRadius: 10,
    justifyContent: 'center',
    width: 42,
  },
  friendChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 2 },
  participantChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  participantChip: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 5,
    minHeight: 30,
    paddingHorizontal: 9,
  },
  participantChipText: { fontSize: 9, fontWeight: '800' },
  segmentRow: { flexDirection: 'row', gap: 7 },
  segment: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 38,
  },
  segmentText: { fontSize: 10, fontWeight: '900' },
  detailHero: { marginBottom: 14, padding: 14 },
  detailVenue: { fontSize: 18, fontWeight: '900' },
  detailMeta: { fontSize: 10, marginTop: 4 },
  detailHeroChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  heroChip: {
    alignItems: 'center',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 4,
    minHeight: 26,
    paddingHorizontal: 9,
  },
  heroChipText: { fontSize: 9, fontWeight: '900' },
  participantRow: {
    alignItems: 'center',
    borderRadius: 11,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 9,
    marginBottom: 7,
    padding: 9,
  },
  avatar: {
    alignItems: 'center',
    borderRadius: 20,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  avatarText: { fontSize: 11, fontWeight: '900' },
  participantCopy: { flex: 1 },
  participantName: { fontSize: 11, fontWeight: '900' },
  participantMeta: { fontSize: 9, marginTop: 2 },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  photoTile: {
    borderRadius: 11,
    height: 92,
    overflow: 'hidden',
    position: 'relative',
    width: '31%',
  },
  photoImage: { height: '100%', width: '100%' },
  photoDelete: {
    alignItems: 'center',
    backgroundColor: 'rgba(9,17,38,0.62)',
    borderRadius: 9,
    height: 18,
    justifyContent: 'center',
    position: 'absolute',
    right: 4,
    top: 4,
    width: 18,
  },
  emptyInline: { fontSize: 10, fontWeight: '700', paddingVertical: 8 },
  addButton: {
    alignItems: 'center',
    borderRadius: 10,
    borderStyle: 'dashed',
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    marginTop: 8,
    minHeight: 38,
  },
  addButtonText: { fontSize: 10, fontWeight: '900' },
  dishRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 9,
    marginBottom: 7,
    padding: 10,
  },
  dishIcon: {
    alignItems: 'center',
    borderRadius: 10,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  dishCopy: { flex: 1 },
  dishName: { fontSize: 11, fontWeight: '900' },
  dishMeta: { fontSize: 9, marginTop: 2 },
  ratingRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 6 },
  ratingPill: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 25,
    paddingHorizontal: 8,
  },
  ratingPillText: { fontSize: 8, fontWeight: '900' },
  expenseCard: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 12,
  },
  expenseLabel: { fontSize: 9, fontWeight: '800' },
  expenseAmount: { fontSize: 19, fontWeight: '900', marginTop: 2 },
  expenseMeta: { alignItems: 'flex-end' },
  expenseHost: { fontSize: 11, fontWeight: '900' },
  expenseNote: { fontSize: 9, marginTop: 2 },
  noteRow: {
    alignItems: 'center',
    borderRadius: 11,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 9,
    marginBottom: 7,
    padding: 9,
  },
  noteIcon: { alignItems: 'center', height: 28, justifyContent: 'center', width: 28 },
  noteCopy: { flex: 1 },
  noteTitle: { fontSize: 10, fontWeight: '900' },
  noteMeta: { fontSize: 8, marginTop: 2 },
  activityRow: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    marginBottom: 6,
    padding: 8,
  },
  activityCopy: { flex: 1 },
  activityTitle: { fontSize: 10, fontWeight: '900' },
  activityMeta: { fontSize: 8, marginTop: 1 },
  inlineModalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(9,17,38,0.44)',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  inlineModal: {
    borderRadius: 16,
    gap: 10,
    padding: 16,
    width: '100%',
  },
  modalActions: { flexDirection: 'row', gap: 9, marginTop: 4 },
});
