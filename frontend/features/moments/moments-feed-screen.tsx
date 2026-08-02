import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/features/auth/auth-provider';
import {
  deleteMoment,
  getMomentErrorMessage,
  likeMoment,
  listMomentFeed,
  reportMoment,
  unlikeMoment,
  updateMomentVisibility,
} from '@/lib/moments-api';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  applyMomentLike,
  removeMomentById,
  replaceMomentById,
} from '@/lib/moments-model';
import { MobileScreen } from '@/shared/ui/mobile-screen';
import type { Moment } from '@/types/moments';

import { MomentCard, MomentsEmptyState } from './moment-ui';

type MomentMenuAction = {
  destructive?: boolean;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  onPress: () => void;
};

export function MomentsFeedScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { accessToken, status } = useAuth();
  const [moments, setMoments] = useState<Moment[]>([]);
  const [nextCursor, setNextCursor] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [scope, setScope] = useState<'' | 'mine'>('');
  const [menuMoment, setMenuMoment] = useState<Moment | null>(null);

  const loadFeed = useCallback(
    async (token: string, next: string, mode: '' | 'mine', replace: boolean) => {
      try {
        const page = await listMomentFeed(token, { cursor: next, scope: mode });
        setMoments((items) => (replace ? page.moments : [...items, ...page.moments]));
        setNextCursor(page.nextCursor);
        setError('');
        return true;
      } catch (caught) {
        setError(getMomentErrorMessage(caught));
        return false;
      }
    },
    [],
  );

  useFocusEffect(
    useCallback(() => {
      if (status !== 'authenticated' || !accessToken) {
        setLoading(false);
        return;
      }
      setLoading(true);
      void loadFeed(accessToken, '', scope, true).finally(() => setLoading(false));
    }, [accessToken, scope, status, loadFeed]),
  );

  const refresh = useCallback(async () => {
    if (!accessToken) return;
    setRefreshing(true);
    await loadFeed(accessToken, '', scope, true);
    setRefreshing(false);
  }, [accessToken, scope, loadFeed]);

  const loadMore = useCallback(async () => {
    if (!accessToken || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    await loadFeed(accessToken, nextCursor, scope, false);
    setLoadingMore(false);
  }, [accessToken, loadFeed, loadingMore, nextCursor, scope]);

  const toggleLike = useCallback(
    async (moment: Moment) => {
      if (!accessToken) return;
      const next = !moment.likedByMe;
      setMoments((items) =>
        items.map((item) => (item.id === moment.id ? applyMomentLike(item, next) : item)),
      );
      try {
        if (next) {
          await likeMoment(accessToken, moment.id);
        } else {
          await unlikeMoment(accessToken, moment.id);
        }
      } catch {
        await refresh();
      }
    },
    [accessToken, refresh],
  );

  const runMenuAction = useCallback(
    async (moment: Moment, action: MomentMenuAction['label']) => {
      if (!accessToken) return;
      setMenuMoment(null);
      try {
        if (action === '删除动态') {
          await deleteMoment(accessToken, moment.id);
          setMoments((items) => removeMomentById(items, moment.id));
        } else if (action === '举报') {
          await reportMoment(accessToken, moment.id, '内容不合适');
        } else if (action === '仅自己可见') {
          const updated = await updateMomentVisibility(accessToken, moment.id, 'self');
          replaceMoment(updated);
        } else if (action === '仅好友可见') {
          const updated = await updateMomentVisibility(accessToken, moment.id, 'friends');
          replaceMoment(updated);
        }
      } catch (caught) {
        setError(getMomentErrorMessage(caught));
      }
    },
    [accessToken],
  );

  const menuActions = useMemo<MomentMenuAction[]>(() => {
    if (!menuMoment) return [];
    const actions: MomentMenuAction[] = [];
    if (menuMoment.canDelete) {
      actions.push({
        icon: menuMoment.visibility === 'self' ? 'account-group-outline' : 'account-lock-outline',
        label: menuMoment.visibility === 'self' ? '仅好友可见' : '仅自己可见',
        onPress: () => void runMenuAction(menuMoment, menuMoment.visibility === 'self' ? '仅好友可见' : '仅自己可见'),
      });
      actions.push({
        destructive: true,
        icon: 'delete-outline',
        label: '删除动态',
        onPress: () => void runMenuAction(menuMoment, '删除动态'),
      });
    }
    actions.push({
      icon: 'flag-outline',
      label: '举报',
      onPress: () => void runMenuAction(menuMoment, '举报'),
    });
    return actions;
  }, [menuMoment, runMenuAction]);

  function replaceMoment(updated: Moment) {
    setMoments((items) => replaceMomentById(items, updated));
  }

  if (status !== 'authenticated') {
    return (
      <MobileScreen contentContainerStyle={styles.page}>
        <View style={styles.topBar}>
          <ThemedText style={styles.pageTitle}>朋友圈</ThemedText>
          <ThemedText style={[styles.pageMeta, { color: colors.mutedText }]}>好友动态</ThemedText>
        </View>
        <MomentsEmptyState
          action={
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/auth')}
              style={styles.primaryButton}>
              <ThemedText style={styles.primaryButtonText}>登录 / 注册</ThemedText>
              <MaterialCommunityIcons name="arrow-right" size={17} color="#151b3b" />
            </Pressable>
          }
          description="登录后即可发布真实动态，并看到好友的点赞与评论。"
          icon="account-heart-outline"
          title="登录后开始朋友圈"
        />
      </MobileScreen>
    );
  }

  return (
    <MobileScreen contentContainerStyle={styles.page}>
      <View style={styles.topBar}>
        <View>
          <ThemedText style={styles.pageTitle}>朋友圈</ThemedText>
          <ThemedText style={[styles.pageMeta, { color: colors.mutedText }]}>
            好友动态 · 真实时间线
          </ThemedText>
        </View>
        <View style={styles.topActions}>
          <Pressable
            accessibilityLabel="发布动态"
            accessibilityRole="button"
            onPress={() => router.push('/moments/create')}
            style={styles.addButton}>
            <MaterialCommunityIcons name="plus" size={21} color="#c9f36a" />
          </Pressable>
          <Pressable
            accessibilityLabel="互动通知"
            accessibilityRole="button"
            onPress={() => router.push('/moments/notifications')}
            style={[styles.iconButton, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <MaterialCommunityIcons name="bell-outline" size={20} color={colors.text} />
          </Pressable>
        </View>
      </View>

      <Pressable
        accessibilityLabel="发布动态"
        accessibilityRole="button"
        onPress={() => router.push('/moments/create')}
        style={[styles.composer, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <ThemedText style={[styles.composerText, { color: colors.mutedText }]}>
          分享此刻...
        </ThemedText>
        <MaterialCommunityIcons name="image-plus" size={19} color={colors.primary} />
      </Pressable>

      <View style={[styles.segmented, { backgroundColor: colors.surfaceMuted }]}>
        <SegButton
          active={scope === ''}
          label="全部"
          onPress={() => setScope('')}
        />
        <SegButton
          active={scope === 'mine'}
          label="我的"
          onPress={() => setScope('mine')}
        />
      </View>

      <FlatList
        contentContainerStyle={styles.listContent}
        data={moments}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          loading ? (
            <View style={styles.loadingState}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : (
            <MomentsEmptyState
              description={
                scope === 'mine'
                  ? '你还没有发布动态，发布后会显示在这里。'
                  : '还没有好友动态，发布第一条或添加好友后即可看到真实内容。'
              }
              icon={scope === 'mine' ? 'image-text' : 'account-group-outline'}
              title={scope === 'mine' ? '还没有我的动态' : '还没有好友动态'}
            />
          )
        }
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
        onRefresh={refresh}
        refreshing={refreshing}
        renderItem={({ item }) => (
          <MomentCard
            moment={item}
            onCommentPress={() =>
              router.push({ pathname: '/moments/[momentId]', params: { momentId: item.id } })
            }
            onLikePress={() => void toggleLike(item)}
            onMorePress={() => setMenuMoment(item)}
            onOpen={() =>
              router.push({ pathname: '/moments/[momentId]', params: { momentId: item.id } })
            }
          />
        )}
        showsVerticalScrollIndicator={false}
      />
      {loadingMore ? (
        <ActivityIndicator color={colors.primary} style={styles.loadMore} />
      ) : null}
      {error ? <ThemedText style={styles.errorText}>{error}</ThemedText> : null}

      <Modal
        animationType="fade"
        onRequestClose={() => setMenuMoment(null)}
        transparent
        visible={menuMoment !== null}>
        <Pressable
          accessibilityLabel="关闭菜单"
          onPress={() => setMenuMoment(null)}
          style={styles.scrim}
        />
        <View style={styles.sheetWrap}>
          <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
            {menuActions.map((action) => (
              <Pressable
                accessibilityRole="button"
                key={action.label}
                onPress={action.onPress}
                style={({ pressed }) => [
                  styles.sheetAction,
                  pressed && styles.pressed,
                ]}>
                <MaterialCommunityIcons
                  name={action.icon}
                  size={19}
                  color={action.destructive ? '#d86f5b' : colors.text}
                />
                <ThemedText
                  style={[
                    styles.sheetActionText,
                    action.destructive ? { color: '#d86f5b' } : null,
                  ]}>
                  {action.label}
                </ThemedText>
              </Pressable>
            ))}
          </View>
        </View>
      </Modal>
    </MobileScreen>
  );
}

function SegButton({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.segButton, active && { backgroundColor: colors.surface }]}>
      <ThemedText style={[styles.segText, active && { color: colors.text, fontWeight: '800' }]}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  addButton: {
    alignItems: 'center',
    backgroundColor: '#151b3b',
    borderRadius: 14,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  composer: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
    minHeight: 48,
    paddingHorizontal: 14,
  },
  composerText: {
    flex: 1,
    fontSize: 13,
  },
  errorText: {
    color: '#d86f5b',
    fontSize: 11,
    paddingVertical: 10,
    textAlign: 'center',
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  listContent: {
    flexGrow: 1,
    paddingTop: 12,
  },
  loadMore: {
    paddingVertical: 12,
  },
  loadingState: {
    alignItems: 'center',
    paddingTop: 80,
  },
  page: {
    paddingTop: 14,
  },
  pageMeta: {
    fontSize: 12,
    marginTop: 4,
  },
  pageTitle: {
    fontSize: 24,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.72,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 14,
    flexDirection: 'row',
    gap: 7,
    marginTop: 6,
    minHeight: 42,
    paddingHorizontal: 16,
  },
  primaryButtonText: {
    fontSize: 13,
    fontWeight: '800',
  },
  scrim: {
    backgroundColor: 'rgba(10,14,30,0.42)',
    flex: 1,
  },
  segButton: {
    alignItems: 'center',
    borderRadius: 8,
    flex: 1,
    height: 30,
    justifyContent: 'center',
  },
  segText: {
    color: '#7483a2',
    fontSize: 12,
    fontWeight: '700',
  },
  segmented: {
    borderRadius: 10,
    flexDirection: 'row',
    gap: 4,
    padding: 4,
  },
  sheet: {
    borderRadius: 18,
    overflow: 'hidden',
    paddingVertical: 6,
  },
  sheetAction: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    minHeight: 50,
    paddingHorizontal: 16,
  },
  sheetActionText: {
    fontSize: 14,
    fontWeight: '700',
  },
  sheetWrap: {
    bottom: 0,
    left: 0,
    padding: 14,
    position: 'absolute',
    right: 0,
  },
  topActions: {
    flexDirection: 'row',
    gap: 8,
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
});
