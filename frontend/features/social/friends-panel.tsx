import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { RefObject } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SectionList,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { IdentityPill } from '@/components/identity-ui';
import { ThemedText } from '@/components/themed-text';
import { groupFriends } from '@/features/social/friend-list-model';
import { SocialAvatar, SocialEmptyState } from '@/features/social/social-ui';
import { useAppTheme } from '@/hooks/use-app-theme';
import type { Friend, SocialConnectionStatus } from '@/types/social';

type FriendListItem =
  | { friend: Friend; kind: 'friend' }
  | { kind: 'online-empty' };

type FriendSection = {
  count: number;
  data: FriendListItem[];
  online?: boolean;
  title: string;
};

type FriendsPanelProps = {
  actionError: string;
  connectionStatus: SocialConnectionStatus;
  error: string;
  friends: Friend[];
  loading: boolean;
  onAddFriend: () => void;
  onOpenFriend: (friend: Friend) => void;
  onQueryChange: (query: string) => void;
  onRetry: () => void;
  openingFriendId: string;
  query: string;
  searchInputRef: RefObject<TextInput | null>;
};

export function FriendsPanel({
  actionError,
  connectionStatus,
  error,
  friends,
  loading,
  onAddFriend,
  onOpenFriend,
  onQueryChange,
  onRetry,
  openingFriendId,
  query,
  searchInputRef,
}: FriendsPanelProps) {
  const { colors } = useAppTheme();
  const grouped = groupFriends(friends, query);
  const presenceIsFresh = connectionStatus === 'connected';
  const sections: FriendSection[] = presenceIsFresh
    ? [
        {
          count: grouped.online.length,
          data: grouped.online.length
            ? grouped.online.map((friend) => ({ friend, kind: 'friend' as const }))
            : [{ kind: 'online-empty' as const }],
          online: true,
          title: '在线',
        },
        {
          count: grouped.offline.length,
          data: grouped.offline.map((friend) => ({ friend, kind: 'friend' as const })),
          title: '离线',
        },
      ]
    : [
        {
          count: grouped.total,
          data: [...grouped.online, ...grouped.offline].map((friend) => ({
            friend,
            kind: 'friend' as const,
          })),
          title: '好友',
        },
      ];
  const hasNoFriends = !loading && !error && friends.length === 0;
  const hasNoResults = !loading && friends.length > 0 && grouped.total === 0;
  const showFullError = !loading && !!error && friends.length === 0;

  return (
    <SectionList
      accessibilityLabel="好友列表"
      contentContainerStyle={styles.listContent}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      keyExtractor={(item, index) =>
        item.kind === 'friend' ? item.friend.user.id : `online-empty-${index}`
      }
      ListHeaderComponent={
        <View style={styles.listHeader}>
          <View
            style={[
              styles.searchField,
              { backgroundColor: colors.surface, borderColor: colors.line },
            ]}>
            <MaterialCommunityIcons name="magnify" size={19} color={colors.mutedText} />
            <TextInput
              ref={searchInputRef}
              accessibilityLabel="搜索好友昵称或账号"
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={onQueryChange}
              placeholder="搜索好友昵称或账号"
              placeholderTextColor={colors.mutedText}
              returnKeyType="search"
              style={[styles.searchInput, { color: colors.text }]}
              value={query}
            />
            {query ? (
              <Pressable
                accessibilityLabel="清除好友搜索"
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => onQueryChange('')}
                style={styles.clearButton}>
                <MaterialCommunityIcons name="close-circle" size={18} color={colors.mutedText} />
              </Pressable>
            ) : null}
          </View>

          {!presenceIsFresh && friends.length > 0 ? (
            <View style={[styles.syncBanner, { backgroundColor: colors.primarySoft }]}>
              <MaterialCommunityIcons name="sync" size={17} color={colors.primary} />
              <ThemedText style={[styles.syncText, { color: colors.primary }]}>在线状态同步中</ThemedText>
            </View>
          ) : null}

          {error && friends.length > 0 ? (
            <Pressable
              accessibilityLabel="好友数据可能已更新，点击重试"
              accessibilityRole="button"
              onPress={onRetry}
              style={[styles.warningBanner, { borderColor: colors.line }]}>
              <MaterialCommunityIcons name="alert-circle-outline" size={17} color="#d86f5b" />
              <ThemedText style={[styles.warningText, { color: colors.mutedText }]}>数据可能已更新，点击重试</ThemedText>
            </Pressable>
          ) : null}

          {actionError ? <ThemedText style={styles.actionError}>{actionError}</ThemedText> : null}
        </View>
      }
      ListEmptyComponent={
        loading ? (
          <FriendSkeleton />
        ) : showFullError ? (
          <SocialEmptyState
            action={
              <Pressable onPress={onRetry} style={styles.secondaryButton}>
                <MaterialCommunityIcons name="refresh" size={17} color={colors.primary} />
                <ThemedText style={[styles.secondaryButtonText, { color: colors.primary }]}>重试</ThemedText>
              </Pressable>
            }
            description="请检查网络连接后重试。"
            icon="cloud-alert-outline"
            title="好友列表暂时无法同步"
          />
        ) : hasNoFriends ? (
          <SocialEmptyState
            action={
              <Pressable onPress={onAddFriend} style={styles.primaryButton}>
                <MaterialCommunityIcons name="account-plus-outline" size={17} color="#151b3b" />
                <ThemedText style={styles.primaryButtonText}>添加好友</ThemedText>
              </Pressable>
            }
            description="添加好友后，可以在这里查看在线状态并开始聊天。"
            icon="account-multiple-plus-outline"
            title="还没有好友"
          />
        ) : hasNoResults ? (
          <SocialEmptyState
            description="换个昵称或账号试试。"
            icon="account-search-outline"
            title="没有匹配的好友"
          />
        ) : null
      }
      renderItem={({ item }) =>
        item.kind === 'online-empty' ? (
          <View style={styles.onlineEmpty}>
            <View style={styles.onlineEmptyIcon}>
              <MaterialCommunityIcons name="weather-night" size={19} color="#c9f36a" />
            </View>
            <View style={styles.onlineEmptyCopy}>
              <ThemedText style={styles.onlineEmptyTitle}>暂无好友在线</ThemedText>
              <ThemedText style={styles.onlineEmptyText}>好友上线后会出现在这里</ThemedText>
            </View>
          </View>
        ) : (
          <FriendRow
            connectionStatus={connectionStatus}
            friend={item.friend}
            opening={openingFriendId === item.friend.user.id}
            onPress={() => onOpenFriend(item.friend)}
          />
        )
      }
      renderSectionHeader={({ section }) => (
        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitleRow}>
            <View
              style={[
                styles.statusDot,
                section.online && presenceIsFresh
                  ? styles.onlineDot
                  : { backgroundColor: colors.mutedText },
              ]}
            />
            <ThemedText style={styles.sectionTitle}>{section.title}</ThemedText>
          </View>
          <ThemedText style={[styles.sectionCount, { color: colors.mutedText }]}>
            {section.count}
          </ThemedText>
        </View>
      )}
      sections={loading || hasNoFriends || hasNoResults || showFullError ? [] : sections}
      showsVerticalScrollIndicator={false}
      stickySectionHeadersEnabled={false}
      style={styles.list}
    />
  );
}

function FriendRow({
  connectionStatus,
  friend,
  onPress,
  opening,
}: {
  connectionStatus: SocialConnectionStatus;
  friend: Friend;
  onPress: () => void;
  opening: boolean;
}) {
  const { colors } = useAppTheme();
  const presenceIsFresh = connectionStatus === 'connected';
  const status = presenceIsFresh ? (friend.user.online ? '在线' : '离线') : '同步中';
  const statusColor = presenceIsFresh && friend.user.online ? colors.success : colors.mutedText;

  return (
    <Pressable
      accessibilityLabel={`打开与${friend.user.displayName}的聊天，${status}`}
      accessibilityRole="button"
      disabled={opening}
      onPress={onPress}
      style={({ pressed }) => [
        styles.friendRow,
        { borderBottomColor: colors.line, opacity: pressed ? 0.68 : 1 },
      ]}>
      <SocialAvatar showOnline={presenceIsFresh} size={48} user={friend.user} />
      <View style={styles.friendCopy}>
        <View style={styles.friendNameRow}>
          <ThemedText numberOfLines={1} style={styles.friendName}>
            {friend.user.displayName}
          </ThemedText>
          {isPublicMemberRole(friend.user.role) ? (
            <IdentityPill compact role={friend.user.role} />
          ) : null}
        </View>
        <View style={styles.friendStatusRow}>
          <View style={[styles.rowStatusDot, { backgroundColor: statusColor }]} />
          <ThemedText style={[styles.friendStatus, { color: statusColor }]}>{status}</ThemedText>
        </View>
      </View>
      <View style={styles.messageAction}>
        {opening ? (
          <ActivityIndicator color={colors.primary} size="small" />
        ) : (
          <MaterialCommunityIcons name="message-outline" size={21} color={colors.primary} />
        )}
      </View>
    </Pressable>
  );
}

function FriendSkeleton() {
  const { colors } = useAppTheme();
  return (
    <View accessibilityLabel="正在加载好友列表" style={styles.skeletonList}>
      {[0, 1, 2].map((item) => (
        <View key={item} style={[styles.skeletonRow, { borderBottomColor: colors.line }]}>
          <View style={[styles.skeletonAvatar, { backgroundColor: colors.surfaceMuted }]} />
          <View style={styles.skeletonCopy}>
            <View style={[styles.skeletonName, { backgroundColor: colors.surfaceMuted }]} />
            <View style={[styles.skeletonStatus, { backgroundColor: colors.surfaceMuted }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

function isPublicMemberRole(role: Friend['user']['role']): role is 'vip' | 'svip' {
  return role === 'vip' || role === 'svip';
}

const styles = StyleSheet.create({
  actionError: {
    color: '#d86f5b',
    fontSize: 11,
    lineHeight: 17,
    textAlign: 'center',
  },
  clearButton: {
    alignItems: 'center',
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  friendCopy: {
    flex: 1,
    minWidth: 0,
  },
  friendName: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 20,
  },
  friendNameRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    minWidth: 0,
  },
  friendRow: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 12,
    minHeight: 76,
    paddingVertical: 11,
  },
  friendStatus: {
    fontSize: 11,
    lineHeight: 16,
  },
  friendStatusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    marginTop: 3,
  },
  list: {
    flex: 1,
  },
  listContent: {
    flexGrow: 1,
    paddingBottom: 36,
    paddingHorizontal: 20,
  },
  listHeader: {
    gap: 10,
    paddingBottom: 8,
    paddingTop: 14,
  },
  messageAction: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  onlineDot: {
    backgroundColor: '#c9f36a',
  },
  onlineEmpty: {
    alignItems: 'center',
    backgroundColor: '#151b3b',
    flexDirection: 'row',
    gap: 12,
    minHeight: 74,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  onlineEmptyCopy: {
    flex: 1,
  },
  onlineEmptyIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(201,243,106,0.1)',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  onlineEmptyText: {
    color: 'rgba(255,255,255,0.62)',
    fontSize: 11,
    lineHeight: 17,
    marginTop: 3,
  },
  onlineEmptyTitle: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#c9f36a',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 7,
    marginTop: 10,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  primaryButtonText: {
    color: '#151b3b',
    fontSize: 12,
    fontWeight: '800',
  },
  rowStatusDot: {
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  searchField: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    height: 46,
    paddingLeft: 13,
  },
  searchInput: {
    flex: 1,
    fontSize: 12,
    height: '100%',
    minWidth: 0,
    paddingHorizontal: 10,
  },
  secondaryButton: {
    alignItems: 'center',
    borderColor: '#dde6fb',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 7,
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  secondaryButtonText: {
    fontSize: 11,
    fontWeight: '800',
  },
  sectionCount: {
    fontSize: 10,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 42,
    paddingTop: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '900',
  },
  sectionTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  skeletonAvatar: {
    borderRadius: 24,
    height: 48,
    width: 48,
  },
  skeletonCopy: {
    flex: 1,
    gap: 8,
  },
  skeletonList: {
    paddingTop: 20,
  },
  skeletonName: {
    borderRadius: 4,
    height: 14,
    width: '38%',
  },
  skeletonRow: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 12,
    minHeight: 76,
  },
  skeletonStatus: {
    borderRadius: 4,
    height: 10,
    width: '22%',
  },
  statusDot: {
    borderRadius: 4,
    height: 7,
    width: 7,
  },
  syncBanner: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    minHeight: 38,
    paddingHorizontal: 12,
  },
  syncText: {
    fontSize: 11,
    fontWeight: '700',
  },
  warningBanner: {
    alignItems: 'center',
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 38,
    paddingHorizontal: 12,
  },
  warningText: {
    fontSize: 11,
    fontWeight: '700',
  },
});
