import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/features/auth/auth-provider';
import { SocialAvatar, SocialEmptyState } from '@/features/social/social-ui';
import { useSocial } from '@/features/social/social-provider';
import { useAppTheme } from '@/hooks/use-app-theme';
import { MobileScreen } from '@/shared/ui/mobile-screen';
import type { Conversation } from '@/types/social';

export function MessagesScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { status } = useAuth();
  const { connectionStatus, conversations, error, friends, loading } = useSocial();
  const onlineFriends = friends.filter((friend) => friend.user.online).slice(0, 5);

  if (status !== 'authenticated') {
    return (
      <MobileScreen contentContainerStyle={styles.loggedOutPage}>
        <View style={styles.loggedOutHeader}>
          <ThemedText style={styles.pageTitle}>消息</ThemedText>
          <ThemedText style={[styles.pageMeta, { color: colors.mutedText }]}>好友与即时消息</ThemedText>
        </View>
        <SocialEmptyState
          action={
            <Pressable onPress={() => router.push('/auth')} style={styles.primaryButton}>
              <ThemedText style={styles.primaryButtonText}>登录 / 注册</ThemedText>
              <MaterialCommunityIcons name="arrow-right" size={17} color="#151b3b" />
            </Pressable>
          }
          description="登录后即可搜索好友，并在不同设备间同步消息。"
          icon="message-text-outline"
          title="登录后开始聊天"
        />
      </MobileScreen>
    );
  }

  return (
    <MobileScreen contentContainerStyle={styles.pageContent}>
      <View style={styles.topBar}>
        <View>
          <ThemedText style={styles.pageTitle}>消息</ThemedText>
          <ThemedText style={[styles.pageMeta, { color: colors.mutedText }]}>
            {onlineFriends.length} 位好友在线
            {connectionStatus === 'connected' ? '' : ' · 正在重连'}
          </ThemedText>
        </View>
        <View style={styles.topActions}>
          <Pressable
            accessibilityLabel="搜索好友"
            accessibilityRole="button"
            onPress={() => router.push('/social/add-friend')}
            style={[styles.iconButton, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <MaterialCommunityIcons name="magnify" size={21} color={colors.text} />
          </Pressable>
          <Pressable
            accessibilityLabel="添加好友"
            accessibilityRole="button"
            onPress={() => router.push('/social/add-friend')}
            style={styles.addButton}>
            <MaterialCommunityIcons name="account-plus-outline" size={20} color="#c9f36a" />
          </Pressable>
        </View>
      </View>

      <View style={styles.onlineStrip}>
        <View pointerEvents="none" style={styles.onlineAccent} />
        <View style={styles.onlineHeading}>
          <View style={styles.onlinePulse} />
          <ThemedText style={styles.onlineTitle}>现在在线</ThemedText>
        </View>
        {onlineFriends.length > 0 ? (
          <View style={styles.onlinePeople}>
            {onlineFriends.map((friend) => (
              <View key={friend.user.id} style={styles.onlinePerson}>
                <SocialAvatar showOnline size={42} user={friend.user} />
                <ThemedText numberOfLines={1} style={styles.onlineName}>
                  {friend.user.displayName}
                </ThemedText>
              </View>
            ))}
          </View>
        ) : (
          <ThemedText style={styles.onlineEmpty}>好友上线后会显示在这里</ThemedText>
        )}
      </View>

      <View style={[styles.conversationPanel, { backgroundColor: colors.surface }]}>
        <View style={styles.sectionHeading}>
          <ThemedText style={styles.sectionTitle}>最近消息</ThemedText>
          <ThemedText style={[styles.sectionMeta, { color: colors.mutedText }]}>全部已同步</ThemedText>
        </View>
        {loading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : conversations.length > 0 ? (
          <View>
            {conversations.map((conversation) => (
              <ConversationRow
                conversation={conversation}
                key={conversation.id}
                onPress={() =>
                  router.push({
                    pathname: '/social/chat/[conversationId]',
                    params: { conversationId: conversation.id },
                  })
                }
              />
            ))}
          </View>
        ) : (
          <SocialEmptyState
            action={
              <Pressable onPress={() => router.push('/social/add-friend')} style={styles.secondaryButton}>
                <MaterialCommunityIcons name="account-plus-outline" size={17} color={colors.primary} />
                <ThemedText style={[styles.secondaryButtonText, { color: colors.primary }]}>添加好友</ThemedText>
              </Pressable>
            }
            description="接受好友申请后，会自动建立一个安全的单聊会话。"
            icon="account-multiple-plus-outline"
            title="还没有会话"
          />
        )}
        {error ? <ThemedText style={styles.errorText}>{error}</ThemedText> : null}
      </View>
    </MobileScreen>
  );
}

function ConversationRow({ conversation, onPress }: { conversation: Conversation; onPress: () => void }) {
  const { colors } = useAppTheme();
  const lastMessage = conversation.lastMessage;
  return (
    <Pressable
      accessibilityLabel={`打开与${conversation.peer.displayName}的聊天`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.conversationRow,
        { borderBottomColor: colors.line, opacity: pressed ? 0.68 : 1 },
      ]}>
      <SocialAvatar showOnline size={48} user={conversation.peer} />
      <View style={styles.conversationCopy}>
        <ThemedText numberOfLines={1} style={styles.conversationName}>
          {conversation.peer.displayName}
        </ThemedText>
        <ThemedText
          numberOfLines={1}
          style={[
            styles.conversationPreview,
            { color: conversation.unreadCount > 0 ? colors.text : colors.mutedText },
            conversation.unreadCount > 0 && styles.unreadPreview,
          ]}>
          {lastMessage?.body || '你们已经是好友了，打个招呼吧'}
        </ThemedText>
      </View>
      <View style={styles.conversationSide}>
        <ThemedText style={[styles.conversationTime, { color: colors.mutedText }]}>
          {formatConversationTime(lastMessage?.createdAt || conversation.updatedAt)}
        </ThemedText>
        {conversation.unreadCount > 0 ? (
          <View style={styles.unreadBadge}>
            <ThemedText style={styles.unreadBadgeText}>
              {Math.min(conversation.unreadCount, 99)}
            </ThemedText>
          </View>
        ) : lastMessage?.read ? (
          <MaterialCommunityIcons name="check-all" size={16} color={colors.primary} />
        ) : null}
      </View>
    </Pressable>
  );
}

function formatConversationTime(value: string) {
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
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
  conversationCopy: {
    flex: 1,
    minWidth: 0,
  },
  conversationName: {
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 20,
  },
  conversationPanel: {
    marginHorizontal: -16,
    minHeight: 350,
    paddingHorizontal: 20,
    paddingTop: 18,
  },
  conversationPreview: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 3,
  },
  conversationRow: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 12,
    minHeight: 76,
    paddingVertical: 11,
  },
  conversationSide: {
    alignItems: 'flex-end',
    gap: 8,
    minWidth: 44,
  },
  conversationTime: {
    fontSize: 10,
    lineHeight: 14,
  },
  errorText: {
    color: '#d86f5b',
    fontSize: 11,
    paddingBottom: 16,
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
  loadingState: {
    alignItems: 'center',
    minHeight: 220,
    paddingTop: 58,
  },
  loggedOutHeader: {
    marginBottom: 28,
  },
  loggedOutPage: {
    paddingTop: 18,
  },
  onlineAccent: {
    backgroundColor: '#ff6b8f',
    height: 92,
    position: 'absolute',
    right: -34,
    top: -46,
    transform: [{ rotate: '26deg' }],
    width: 58,
  },
  onlineEmpty: {
    color: 'rgba(255,255,255,0.62)',
    fontSize: 11,
    lineHeight: 44,
  },
  onlineHeading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
  },
  onlineName: {
    color: '#ffffff',
    fontSize: 10,
    maxWidth: 52,
    textAlign: 'center',
  },
  onlinePeople: {
    flexDirection: 'row',
    gap: 15,
    marginTop: 13,
  },
  onlinePerson: {
    alignItems: 'center',
    gap: 6,
    width: 48,
  },
  onlinePulse: {
    backgroundColor: '#c9f36a',
    borderRadius: 4,
    height: 7,
    width: 7,
  },
  onlineStrip: {
    backgroundColor: '#151b3b',
    minHeight: 116,
    overflow: 'hidden',
    paddingHorizontal: 17,
    paddingVertical: 14,
  },
  onlineTitle: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
  pageContent: {
    gap: 14,
    paddingTop: 14,
  },
  pageMeta: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 4,
  },
  pageTitle: {
    fontSize: 27,
    fontWeight: '900',
    lineHeight: 32,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#c9f36a',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  primaryButtonText: {
    color: '#151b3b',
    fontSize: 12,
    fontWeight: '800',
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
  sectionHeading: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sectionMeta: {
    fontSize: 10,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '900',
  },
  topActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 9,
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  unreadBadge: {
    alignItems: 'center',
    backgroundColor: '#ff6b8f',
    borderRadius: 10,
    height: 20,
    justifyContent: 'center',
    minWidth: 20,
    paddingHorizontal: 5,
  },
  unreadBadgeText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '900',
    lineHeight: 12,
  },
  unreadPreview: {
    fontWeight: '700',
  },
});
