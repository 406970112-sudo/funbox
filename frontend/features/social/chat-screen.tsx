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

import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/features/auth/auth-provider';
import { SocialAvatar, SocialEmptyState } from '@/features/social/social-ui';
import { useSocial } from '@/features/social/social-provider';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  createMessage,
  getSocialErrorMessage,
  listMessages,
  markConversationRead,
} from '@/lib/social-api';
import type { SocialMessage } from '@/types/social';

export function ChatScreen() {
  const router = useRouter();
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const { colors } = useAppTheme();
  const { accessToken, user } = useAuth();
  const { connectionStatus, conversations, lastEventSequence, refresh } = useSocial();
  const conversation = conversations.find((item) => item.id === conversationId);
  const listRef = useRef<FlatList<SocialMessage>>(null);
  const [error, setError] = useState('');
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<SocialMessage[]>([]);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!accessToken || !conversationId) return;
    let active = true;
    void (async () => {
      try {
        const nextMessages = await listMessages(accessToken, conversationId);
        if (!active) return;
        setMessages(nextMessages);
        setError('');
        await markConversationRead(accessToken, conversationId);
        if (active) void refresh();
      } catch (requestError) {
        if (active) setError(getSocialErrorMessage(requestError));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [accessToken, conversationId, lastEventSequence]);

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
            <ThemedText numberOfLines={1} style={styles.chatName}>
              {conversation.peer.displayName}
            </ThemedText>
            <View style={styles.presenceRow}>
              <View
                style={[
                  styles.presenceDot,
                  { backgroundColor: conversation.peer.online ? colors.success : colors.mutedText },
                ]}
              />
              <ThemedText
                style={[
                  styles.presenceText,
                  { color: conversation.peer.online ? colors.success : colors.mutedText },
                ]}>
                {conversation.peer.online ? '在线' : '离线'}
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
          <View style={[styles.composerAccessory, { backgroundColor: colors.surfaceMuted }]}>
            <MaterialCommunityIcons name="message-text-outline" size={18} color={colors.text} />
          </View>
          <TextInput
            accessibilityLabel="输入消息"
            multiline
            onChangeText={setInput}
            onSubmitEditing={() => {
              if (Platform.OS === 'web') void submitMessage();
            }}
            placeholder="输入消息..."
            placeholderTextColor={colors.mutedText}
            style={[
              styles.composerInput,
              { backgroundColor: colors.surfaceMuted, borderColor: colors.line, color: colors.text },
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
    fontSize: 14,
    fontWeight: '900',
    lineHeight: 19,
  },
  composer: {
    alignItems: 'flex-end',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 8,
    minHeight: 72,
    paddingBottom: 12,
    paddingHorizontal: 14,
    paddingTop: 10,
  },
  composerAccessory: {
    alignItems: 'center',
    borderRadius: 12,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  composerInput: {
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    maxHeight: 88,
    minHeight: 40,
    outlineStyle: 'none',
    paddingHorizontal: 12,
    paddingVertical: 9,
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
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  sendButtonDisabled: {
    opacity: 0.45,
  },
});
