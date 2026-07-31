import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { SocialAvatar } from '@/features/social/social-ui';
import { useSocial } from '@/features/social/social-provider';
import { useAppTheme } from '@/hooks/use-app-theme';
import { getSocialErrorMessage } from '@/lib/social-api';
import { MobileScreen } from '@/shared/ui/mobile-screen';
import type { FriendRequest, SocialUser } from '@/types/social';

export function AddFriendScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const {
    friends,
    incomingRequests,
    outgoingRequests,
    respondToRequest,
    searchUsers,
    sendFriendRequest,
  } = useSocial();
  const [busyId, setBusyId] = useState('');
  const [feedback, setFeedback] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SocialUser[]>([]);
  const [searching, setSearching] = useState(false);
  const pendingActionsRef = useRef(new Set<string>());
  const pendingIncoming = incomingRequests.filter((request) => request.status === 'pending');
  const pendingOutgoing = outgoingRequests.filter((request) => request.status === 'pending');
  const friendIDs = new Set(friends.map((friend) => friend.user.id));
  const outgoingIDs = new Set(pendingOutgoing.map((request) => request.recipient.id));

  async function runSearch() {
    const normalized = query.trim();
    if (!normalized) {
      setResults([]);
      setFeedback('请输入账号或昵称。');
      return;
    }
    Keyboard.dismiss();
    setSearching(true);
    setFeedback('');
    try {
      const users = await searchUsers(normalized);
      setResults(users);
      if (users.length === 0) setFeedback('没有找到匹配的用户。');
    } catch (error) {
      setFeedback(getSocialErrorMessage(error));
    } finally {
      setSearching(false);
    }
  }

  async function addFriend(user: SocialUser) {
    if (pendingActionsRef.current.has(user.id)) return;
    pendingActionsRef.current.add(user.id);
    setBusyId(user.id);
    setFeedback('');
    try {
      await sendFriendRequest(user.id);
      setFeedback(`已向 ${user.displayName} 发送好友申请。`);
    } catch (error) {
      setFeedback(getSocialErrorMessage(error));
    } finally {
      pendingActionsRef.current.delete(user.id);
      setBusyId('');
    }
  }

  async function respond(request: FriendRequest, action: 'accept' | 'reject') {
    if (pendingActionsRef.current.has(request.id)) return;
    pendingActionsRef.current.add(request.id);
    setBusyId(request.id);
    setFeedback('');
    try {
      await respondToRequest(request.id, action);
      setFeedback(action === 'accept' ? `已添加 ${request.sender.displayName}。` : '已忽略该申请。');
    } catch (error) {
      setFeedback(getSocialErrorMessage(error));
    } finally {
      pendingActionsRef.current.delete(request.id);
      setBusyId('');
    }
  }

  return (
    <MobileScreen contentContainerStyle={styles.pageContent}>
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="返回"
          accessibilityRole="button"
          hitSlop={10}
          onPress={() => router.back()}
          style={styles.headerButton}>
          <MaterialCommunityIcons name="arrow-left" size={22} color={colors.text} />
        </Pressable>
        <ThemedText style={styles.headerTitle}>添加好友</ThemedText>
        <Pressable
          accessibilityLabel="打开二维码工具"
          accessibilityRole="button"
          onPress={() => router.push('/tools/qr-code')}
          style={[styles.qrButton, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <MaterialCommunityIcons name="qrcode-scan" size={19} color={colors.text} />
        </Pressable>
      </View>

      <View style={[styles.searchBox, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <MaterialCommunityIcons name="magnify" size={20} color={colors.mutedText} />
        <TextInput
          accessibilityLabel="搜索账号或昵称"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setQuery}
          onSubmitEditing={() => void runSearch()}
          placeholder="搜索账号或昵称"
          placeholderTextColor={colors.mutedText}
          returnKeyType="search"
          style={[styles.searchInput, { color: colors.text }]}
          value={query}
        />
        <Pressable
          accessibilityLabel="搜索"
          accessibilityRole="button"
          disabled={searching}
          onPress={() => void runSearch()}
          style={styles.searchButton}>
          {searching ? (
            <ActivityIndicator color="#c9f36a" size="small" />
          ) : (
            <MaterialCommunityIcons name="arrow-right" size={17} color="#c9f36a" />
          )}
        </Pressable>
      </View>

      {results.length > 0 ? (
        <View style={styles.results}>
          {results.map((user) => {
            const alreadyFriend = friendIDs.has(user.id);
            const requestSent = outgoingIDs.has(user.id);
            const disabled = alreadyFriend || requestSent || busyId === user.id;
            return (
              <View key={user.id} style={styles.searchResult}>
                <View pointerEvents="none" style={styles.resultAccent} />
                <SocialAvatar showOnline size={48} user={user} />
                <View style={styles.resultCopy}>
                  <ThemedText numberOfLines={1} style={styles.resultName}>
                    {user.displayName}
                  </ThemedText>
                  <ThemedText numberOfLines={1} style={styles.resultUsername}>
                    @{user.username}
                  </ThemedText>
                </View>
                <Pressable
                  accessibilityLabel={`添加${user.displayName}`}
                  accessibilityRole="button"
                  disabled={disabled}
                  onPress={() => void addFriend(user)}
                  style={[styles.resultAction, disabled && styles.resultActionDisabled]}>
                  {busyId === user.id ? (
                    <ActivityIndicator color="#151b3b" size="small" />
                  ) : (
                    <>
                      {!alreadyFriend && !requestSent ? (
                        <MaterialCommunityIcons name="account-plus-outline" size={15} color="#151b3b" />
                      ) : null}
                      <ThemedText style={styles.resultActionText}>
                        {alreadyFriend ? '已添加' : requestSent ? '已申请' : '添加'}
                      </ThemedText>
                    </>
                  )}
                </Pressable>
              </View>
            );
          })}
        </View>
      ) : null}

      {feedback ? (
        <View style={[styles.feedback, { backgroundColor: colors.surfaceMuted }]}>
          <MaterialCommunityIcons name="information-outline" size={16} color={colors.primary} />
          <ThemedText style={[styles.feedbackText, { color: colors.mutedText }]}>{feedback}</ThemedText>
        </View>
      ) : null}

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <ThemedText style={styles.sectionTitle}>新的好友申请</ThemedText>
          <View style={styles.requestCount}>
            <ThemedText style={styles.requestCountText}>{pendingIncoming.length}</ThemedText>
          </View>
        </View>
        <View style={[styles.requestList, { backgroundColor: colors.surface, borderTopColor: colors.line }]}>
          {pendingIncoming.length > 0 ? (
            pendingIncoming.map((request) => (
              <View key={request.id} style={[styles.requestRow, { borderBottomColor: colors.line }]}>
                <SocialAvatar showOnline size={44} user={request.sender} />
                <View style={styles.requestCopy}>
                  <ThemedText numberOfLines={1} style={styles.requestName}>
                    {request.sender.displayName}
                  </ThemedText>
                  <ThemedText style={[styles.requestNote, { color: colors.mutedText }]}>
                    @{request.sender.username}
                  </ThemedText>
                </View>
                <View style={styles.requestActions}>
                  <Pressable
                    disabled={busyId === request.id}
                    onPress={() => void respond(request, 'reject')}
                    style={[styles.requestButton, styles.ignoreButton, { backgroundColor: colors.surfaceMuted }]}>
                    <ThemedText style={[styles.requestButtonText, { color: colors.mutedText }]}>忽略</ThemedText>
                  </Pressable>
                  <Pressable
                    disabled={busyId === request.id}
                    onPress={() => void respond(request, 'accept')}
                    style={[styles.requestButton, styles.acceptButton]}>
                    {busyId === request.id ? (
                      <ActivityIndicator color="#ffffff" size="small" />
                    ) : (
                      <ThemedText style={[styles.requestButtonText, styles.acceptButtonText]}>接受</ThemedText>
                    )}
                  </Pressable>
                </View>
              </View>
            ))
          ) : (
            <ThemedText style={[styles.emptySection, { color: colors.mutedText }]}>暂无新的申请</ThemedText>
          )}
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <ThemedText style={styles.sectionTitle}>已发出的申请</ThemedText>
          <ThemedText style={[styles.sectionMeta, { color: colors.mutedText }]}>
            {pendingOutgoing.length} 条
          </ThemedText>
        </View>
        {pendingOutgoing.length > 0 ? (
          pendingOutgoing.map((request) => (
            <View key={request.id} style={[styles.sentRow, { borderBottomColor: colors.line }]}>
              <SocialAvatar size={40} user={request.recipient} />
              <View style={styles.requestCopy}>
                <ThemedText style={styles.requestName}>{request.recipient.displayName}</ThemedText>
                <ThemedText style={[styles.requestNote, { color: colors.mutedText }]}>
                  @{request.recipient.username}
                </ThemedText>
              </View>
              <ThemedText style={[styles.sentStatus, { color: colors.mutedText }]}>等待回应</ThemedText>
            </View>
          ))
        ) : (
          <ThemedText style={[styles.emptySection, { color: colors.mutedText }]}>暂无待处理申请</ThemedText>
        )}
      </View>
    </MobileScreen>
  );
}

const styles = StyleSheet.create({
  acceptButton: {
    backgroundColor: '#4b6bff',
  },
  acceptButtonText: {
    color: '#ffffff',
  },
  emptySection: {
    fontSize: 11,
    paddingVertical: 22,
    textAlign: 'center',
  },
  feedback: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  feedbackText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 17,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  headerButton: {
    alignItems: 'flex-start',
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '900',
  },
  ignoreButton: {},
  pageContent: {
    gap: 14,
    paddingTop: 12,
  },
  qrButton: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  requestActions: {
    flexDirection: 'row',
    gap: 6,
  },
  requestButton: {
    alignItems: 'center',
    borderRadius: 8,
    height: 30,
    justifyContent: 'center',
    minWidth: 46,
    paddingHorizontal: 10,
  },
  requestButtonText: {
    fontSize: 10,
    fontWeight: '800',
    lineHeight: 14,
  },
  requestCopy: {
    flex: 1,
    minWidth: 0,
  },
  requestCount: {
    alignItems: 'center',
    backgroundColor: '#ff6b8f',
    borderRadius: 10,
    height: 20,
    justifyContent: 'center',
    minWidth: 20,
  },
  requestCountText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '900',
  },
  requestList: {
    borderTopWidth: 1,
  },
  requestName: {
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
  },
  requestNote: {
    fontSize: 10,
    lineHeight: 15,
    marginTop: 2,
  },
  requestRow: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 10,
    minHeight: 78,
    paddingHorizontal: 4,
    paddingVertical: 12,
  },
  resultAccent: {
    backgroundColor: '#c9f36a',
    height: 6,
    left: 0,
    position: 'absolute',
    top: 0,
    width: 54,
  },
  resultAction: {
    alignItems: 'center',
    backgroundColor: '#c9f36a',
    borderRadius: 9,
    flexDirection: 'row',
    gap: 5,
    height: 32,
    justifyContent: 'center',
    minWidth: 64,
    paddingHorizontal: 10,
  },
  resultActionDisabled: {
    opacity: 0.62,
  },
  resultActionText: {
    color: '#151b3b',
    fontSize: 10,
    fontWeight: '900',
  },
  resultCopy: {
    flex: 1,
    minWidth: 0,
  },
  resultName: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '900',
    lineHeight: 19,
  },
  results: {
    gap: 8,
  },
  resultUsername: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 10,
    lineHeight: 15,
  },
  searchBox: {
    alignItems: 'center',
    borderRadius: 0,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 9,
    height: 50,
    paddingHorizontal: 12,
  },
  searchButton: {
    alignItems: 'center',
    backgroundColor: '#151b3b',
    borderRadius: 9,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  searchInput: {
    flex: 1,
    fontSize: 12,
    height: '100%',
    outlineStyle: 'none',
  } as never,
  searchResult: {
    alignItems: 'center',
    backgroundColor: '#151b3b',
    flexDirection: 'row',
    gap: 12,
    minHeight: 82,
    overflow: 'hidden',
    paddingHorizontal: 14,
    paddingVertical: 14,
    position: 'relative',
  },
  section: {
    marginTop: 6,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sectionMeta: {
    fontSize: 10,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '900',
  },
  sentRow: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 10,
    minHeight: 68,
    paddingHorizontal: 4,
  },
  sentStatus: {
    fontSize: 10,
    fontWeight: '700',
  },
});
