import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { IdentityPill } from '@/components/identity-ui';
import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/features/auth/auth-provider';
import { SocialAvatar, SocialEmptyState } from '@/features/social/social-ui';
import { useSocial } from '@/features/social/social-provider';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  createMessage,
  getSocialErrorMessage,
  listMessages,
} from '@/lib/social-api';
import type { SocialMessage } from '@/types/social';
import type { Conversation } from '@/types/social';

export function ChatScreen() {
  const router = useRouter();
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const { colors } = useAppTheme();
  const { accessToken, user } = useAuth();
  const { connectionStatus, conversations, lastEventSequence, markRead, refresh } = useSocial();
  const conversation = conversations.find((item) => item.id === conversationId);
  const listRef = useRef<FlatList<SocialMessage>>(null);
  const [error, setError] = useState('');
  const [input, setInput] = useState('');
  const [inputHeight, setInputHeight] = useState(44);
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<SocialMessage[]>([]);
  const [sending, setSending] = useState(false);
  const presenceIsFresh = connectionStatus === 'connected';
  const peerIsOnline = presenceIsFresh && conversation?.peer.online;

  useEffect(() => {
    if (!accessToken || !conversationId) return;
    let active = true;
    void (async () => {
      try {
        const nextMessages = await listMessages(accessToken, conversationId);
        if (!active) return;
        setMessages(nextMessages);
        setError('');
        await markRead(conversationId);
      } catch (requestError) {
        if (active) setError(getSocialErrorMessage(requestError));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [accessToken, conversationId, lastEventSequence, markRead]);

  useEffect(() => {
    if (!accessToken || !conversationId || connectionStatus === 'connected') return;

    const pollMessages = () => {
      void listMessages(accessToken, conversationId)
        .then((nextMessages) => {
          setMessages(nextMessages);
          setError('');
        })
        .catch((requestError) => setError(getSocialErrorMessage(requestError)));
    };
    const timer = setInterval(pollMessages, 4_000);
    return () => clearInterval(timer);
  }, [accessToken, connectionStatus, conversationId]);

  async function submitMessage() {
    const body = input.trim();
    if (!accessToken || !conversationId || !body || sending) return;
    setSending(true);
    setError('');
    try {
      const message = await createMessage(
        accessToken,
        conversationId,
        body,
        `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`,
      );
      setMessages((items) => (items.some((item) => item.id === message.id) ? items : [...items, message]));
      setInput('');
      setInputHeight(44);
      void refresh();
    } catch (requestError) {
      setError(getSocialErrorMessage(requestError));
    } finally {
      setSending(false);
    }
  }

  if (!conversation || !user) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
        <View style={styles.missingHeader}>
          <Pressable onPress={() => router.back()} style={styles.backButton}>
            <MaterialCommunityIcons name="arrow-left" size={22} color={colors.text} />
          </Pressable>
        </View>
        {loading ? (
          <ActivityIndicator color={colors.primary} style={styles.missingLoader} />
        ) : (
          <SocialEmptyState
            description="会话可能已被删除，或当前账号没有访问权限。"
            icon="message-alert-outline"
            title="无法打开会话"
          />
        )}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.screen, { backgroundColor: colors.surfaceMuted }]}>
        <View style={[styles.chatHeader, { backgroundColor: colors.surface, borderBottomColor: colors.line }]}>
          <Pressable
            accessibilityLabel="返回"
            accessibilityRole="button"
            hitSlop={10}
            onPress={() => router.back()}
            style={styles.backButton}>
            <MaterialCommunityIcons name="arrow-left" size={22} color={colors.text} />
          </Pressable>
          <SocialAvatar size={40} user={conversation.peer} />
          <View style={styles.headerCopy}>
            <View style={styles.headerNameRow}>
              <ThemedText numberOfLines={1} style={styles.chatName}>
                {conversation.peer.displayName}
              </ThemedText>
              {isPublicMemberRole(conversation.peer.role) ? (
                <IdentityPill compact role={conversation.peer.role} />
              ) : null}
            </View>
            <View style={styles.presenceRow}>
              <View
                style={[
                  styles.presenceDot,
                  { backgroundColor: peerIsOnline ? colors.success : colors.mutedText },
                ]}
              />
              <ThemedText
                style={[
                  styles.presenceText,
                  { color: peerIsOnline ? colors.success : colors.mutedText },
                ]}>
                {presenceIsFresh ? (conversation.peer.online ? '在线' : '离线') : '同步中'}
              </ThemedText>
            </View>
          </View>
          <Pressable
            accessibilityLabel="会话设置"
            accessibilityRole="button"
            onPress={() => void refresh()}
            style={[styles.moreButton, { borderColor: colors.line }]}>
            <MaterialCommunityIcons name="dots-horizontal" size={20} color={colors.text} />
          </Pressable>
        </View>

        {loading ? (
          <View style={styles.chatLoading}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <FlatList
            contentContainerStyle={styles.messageList}
            data={messages}
            keyExtractor={(item) => item.id}
            ListEmptyComponent={
              <SocialEmptyState
                description="你们已经是好友了，发送第一条消息吧。"
                icon="message-text-outline"
                title="开始聊天"
              />
            }
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            ref={listRef}
            renderItem={({ item, index }) => (
              <MessageBubble
                currentUserId={user.id}
                message={item}
                peer={conversation.peer}
                showDate={index === 0 || !isSameDay(messages[index - 1].createdAt, item.createdAt)}
              />
            )}
            showsVerticalScrollIndicator={false}
          />
        )}

        {error ? (
          <View style={styles.chatError}>
            <ThemedText style={styles.chatErrorText}>{error}</ThemedText>
          </View>
        ) : null}

        <View style={[styles.composer, { backgroundColor: colors.surface, borderTopColor: colors.line }]}>
          <TextInput
            accessibilityLabel="输入消息"
            multiline
            numberOfLines={1}
            onChangeText={setInput}
            onContentSizeChange={({ nativeEvent }) => {
              setInputHeight(Math.min(112, Math.max(44, nativeEvent.contentSize.height)));
            }}
            onSubmitEditing={() => {
              if (Platform.OS === 'web') void submitMessage();
            }}
            placeholder="输入消息..."
            placeholderTextColor={colors.mutedText}
            style={[
              styles.composerInput,
              { backgroundColor: colors.surfaceMuted, borderColor: colors.line, color: colors.text },
              { height: inputHeight, overflow: inputHeight >= 112 ? 'scroll' : 'hidden' },
            ]}
            value={input}
          />
          <Pressable
            accessibilityLabel="发送消息"
            accessibilityRole="button"
            disabled={!input.trim() || sending}
            onPress={() => void submitMessage()}
            style={[styles.sendButton, (!input.trim() || sending) && styles.sendButtonDisabled]}>
            {sending ? (
              <ActivityIndicator color="#ffffff" size="small" />
            ) : (
              <MaterialCommunityIcons name="send" size={18} color="#ffffff" />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function MessageBubble({
  currentUserId,
  message,
  peer,
  showDate,
}: {
  currentUserId: string;
  message: SocialMessage;
  peer: NonNullable<ReturnType<typeof useSocial>['conversations'][number]['peer']>;
  showDate: boolean;
}) {
  const mine = message.senderId === currentUserId;
  return (
    <>
      {showDate ? (
        <ThemedText style={styles.dateDivider}>
          {new Date(message.createdAt).toLocaleString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
            month: 'numeric',
            day: 'numeric',
          })}
        </ThemedText>
      ) : null}
      <View style={[styles.messageRow, mine && styles.messageRowMine]}>
        <SocialAvatar size={29} user={mine ? { ...peer, id: currentUserId, avatarUrl: '' } : peer} />
        <View style={[styles.bubbleStack, mine && styles.bubbleStackMine]}>
          <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubblePeer]}>
            <ThemedText style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{message.body}</ThemedText>
          </View>
          <View style={styles.messageMetaRow}>
            {mine ? (
              <MaterialCommunityIcons name="check-all" size={13} color="#4b6bff" />
            ) : null}
            <ThemedText style={styles.messageMeta}>
              {new Date(message.createdAt).toLocaleTimeString('zh-CN', {
                hour: '2-digit',
                minute: '2-digit',
              })}
              {mine ? (message.read ? ' · 已读' : ' · 已送达') : ''}
            </ThemedText>
          </View>
        </View>
      </View>
    </>
  );
}

function isSameDay(first: string, second: string) {
  return new Date(first).toDateString() === new Date(second).toDateString();
}

function isPublicMemberRole(role: Conversation['peer']['role']): role is 'vip' | 'svip' {
  return role === 'vip' || role === 'svip';
}

const styles = StyleSheet.create({
  backButton: {
    alignItems: 'flex-start',
    height: 40,
    justifyContent: 'center',
    width: 32,
  },
  bubble: {
    maxWidth: 270,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  bubbleMine: {
    backgroundColor: '#151b3b',
    borderBottomRightRadius: 5,
    borderRadius: 17,
  },
  bubblePeer: {
    backgroundColor: '#ffffff',
    borderBottomLeftRadius: 5,
    borderRadius: 17,
    shadowColor: '#495e85',
    shadowOffset: { height: 3, width: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 7,
  },
  bubbleStack: {
    alignItems: 'flex-start',
    gap: 4,
    maxWidth: '82%',
  },
  bubbleStackMine: {
    alignItems: 'flex-end',
  },
  bubbleText: {
    color: '#18233d',
    fontSize: 13,
    lineHeight: 21,
  },
  bubbleTextMine: {
    color: '#ffffff',
  },
  chatError: {
    alignItems: 'center',
    backgroundColor: '#d86f5b18',
    paddingHorizontal: 16,
    paddingVertical: 7,
  },
  chatErrorText: {
    color: '#d86f5b',
    fontSize: 10,
  },
  chatHeader: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 9,
    minHeight: 68,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  chatLoading: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  chatName: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '900',
    lineHeight: 19,
  },
  headerNameRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 5,
    minWidth: 0,
  },
  composer: {
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 10,
    minHeight: 68,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  composerInput: {
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    fontSize: 13,
    lineHeight: 20,
    maxHeight: 112,
    minHeight: 44,
    outlineStyle: 'none',
    paddingHorizontal: 14,
    paddingVertical: 11,
  } as never,
  dateDivider: {
    color: '#8996aa',
    fontSize: 9,
    lineHeight: 14,
    marginBottom: 3,
    marginTop: 3,
    textAlign: 'center',
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  messageList: {
    gap: 13,
    paddingBottom: 18,
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  messageMeta: {
    color: '#8996aa',
    fontSize: 9,
    lineHeight: 13,
  },
  messageMetaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 3,
  },
  messageRow: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: 7,
  },
  messageRowMine: {
    flexDirection: 'row-reverse',
  },
  missingHeader: {
    minHeight: 58,
    paddingHorizontal: 16,
  },
  missingLoader: {
    marginTop: 80,
  },
  moreButton: {
    alignItems: 'center',
    borderRadius: 13,
    borderWidth: 1,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  presenceDot: {
    borderRadius: 4,
    height: 7,
    width: 7,
  },
  presenceRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 5,
    marginTop: 2,
  },
  presenceText: {
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 14,
  },
  safeArea: {
    flex: 1,
  },
  screen: {
    alignSelf: 'center',
    flex: 1,
    maxWidth: 430,
    width: '100%',
  },
  sendButton: {
    alignItems: 'center',
    backgroundColor: '#4b6bff',
    borderRadius: 12,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  sendButtonDisabled: {
    opacity: 0.45,
  },
});
