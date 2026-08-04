import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  type StyleProp,
  type ImageStyle,
  TextInput,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useAppTheme } from '@/hooks/use-app-theme';
import { getAPIBaseUrl, resolveAvatarURL } from '@/lib/auth-api';
import {
  feedbackImageSource,
  getFeedbackErrorMessage,
  resolveFeedback,
} from '@/lib/feedback-api';
import {
  feedbackCategoryLabel,
  feedbackKindLabel,
  feedbackStatusLabel,
} from '@/lib/feedback-model';
import type { FeedbackSubmission } from '@/types/feedback';

type AdminFeedbackDetailProps = {
  adminToken: string;
  item: FeedbackSubmission;
  onBack?: () => void;
};

export function AdminFeedbackDetail({
  adminToken,
  item,
  onBack,
}: AdminFeedbackDetailProps) {
  const { colors } = useAppTheme();
  const [adminReply, setAdminReply] = useState(item.adminReply ?? '');
  const [message, setMessage] = useState<{ text: string; tone: 'error' | 'success' } | null>(null);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [status, setStatus] = useState(item.status);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setAdminReply(item.adminReply ?? '');
    setMessage(null);
    setPreviewPath(null);
    setStatus(item.status);
  }, [item.id, item.adminReply, item.status]);

  async function handleStartProcessing() {
    setMessage(null);
    setSubmitting(true);
    try {
      const response = await resolveFeedback(adminToken, item.id, { status: 'processing' });
      setStatus(response.item.status);
      setMessage({ text: '已标记为处理中。', tone: 'success' });
    } catch (error) {
      setMessage({ text: getFeedbackErrorMessage(error), tone: 'error' });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResolve() {
    setMessage(null);
    setSubmitting(true);
    try {
      const response = await resolveFeedback(adminToken, item.id, {
        reply: adminReply,
        status: 'resolved',
      });
      setAdminReply(response.item.adminReply ?? '');
      setStatus(response.item.status);
      setMessage({ text: '处理结果已提交，用户消息中心已收到通知。', tone: 'success' });
    } catch (error) {
      setMessage({ text: getFeedbackErrorMessage(error), tone: 'error' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      style={styles.detailScroll}
      contentContainerStyle={styles.detailContent}>
      {onBack ? (
        <Pressable
          accessibilityLabel="返回反馈列表"
          accessibilityRole="button"
          onPress={onBack}
          style={[styles.backButton, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <MaterialCommunityIcons name="arrow-left" size={19} color={colors.text} />
          <ThemedText style={styles.backButtonText}>返回列表</ThemedText>
        </Pressable>
      ) : null}

      <View style={[styles.userCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <View style={[styles.avatarWrap, { backgroundColor: colors.surfaceMuted }]}>
          {item.user.avatarUrl ? (
            <Image
              contentFit="cover"
              source={{ uri: resolveAvatarURL(item.user.avatarUrl) }}
              style={styles.avatarImage}
            />
          ) : (
            <MaterialCommunityIcons name="account" size={26} color={colors.mutedText} />
          )}
        </View>
        <View style={styles.userCopy}>
          <ThemedText style={styles.userName}>{item.user.displayName}</ThemedText>
          <ThemedText style={[styles.userMeta, { color: colors.mutedText }]}>
            @{item.user.username} · {formatFeedbackTime(item.createdAt)}
          </ThemedText>
        </View>
      </View>

      <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <View style={styles.badgeRow}>
          <AdminBadge
            color={item.kind === 'feature_request' ? '#6b5adb' : '#d86f5b'}
            label={feedbackKindLabel(item.kind)}
          />
          <AdminBadge
            color={
              status === 'resolved'
                ? '#1db991'
                : status === 'processing'
                  ? colors.primary
                  : '#c76a2a'
            }
            label={feedbackStatusLabel(status)}
          />
        </View>
        {item.kind === 'feature_request' ? (
          <>
            <ThemedText style={styles.detailTitle}>{item.title || '功能建议'}</ThemedText>
            <ThemedText style={[styles.userMeta, { color: colors.mutedText }]}>
              {feedbackCategoryLabel(item.category)}
            </ThemedText>
          </>
        ) : null}
      </View>

      <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <ThemedText style={styles.sectionLabel}>
          {item.kind === 'feature_request' ? '功能描述' : '问题描述'}
        </ThemedText>
        <ThemedText style={styles.descriptionText}>{item.description}</ThemedText>
      </View>

      {item.images.length > 0 ? (
        <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <View style={styles.sectionHeader}>
            <ThemedText style={styles.sectionLabel}>
              {item.kind === 'feature_request' ? '设计图' : '截图'}
            </ThemedText>
            <ThemedText style={[styles.imageCount, { color: colors.mutedText }]}>
              {item.images.length} 张
            </ThemedText>
          </View>
          <View style={styles.imageGrid}>
            {item.images.map((image) => (
              <Pressable
                accessibilityLabel={`查看反馈截图 ${image.id}`}
                accessibilityRole="button"
                key={image.id}
                onPress={() => setPreviewPath(image.path)}
                style={({ pressed }) => [styles.imageTile, { opacity: pressed ? 0.78 : 1 }]}>
                <FeedbackImage adminToken={adminToken} path={image.path} />
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <View style={styles.sectionHeader}>
          <ThemedText style={styles.sectionLabel}>处理结果</ThemedText>
          <ThemedText style={[styles.imageCount, { color: colors.mutedText }]}>
            10-1000 字
          </ThemedText>
        </View>
        <TextInput
          accessibilityLabel="处理结果输入"
          editable={!submitting}
          maxLength={1000}
          multiline
          onChangeText={setAdminReply}
          placeholder="填写给用户的处理结果，提交后用户会在消息中心看到"
          placeholderTextColor={colors.mutedText}
          style={[
            styles.replyInput,
            {
              backgroundColor: colors.surfaceMuted,
              borderColor: colors.line,
              color: colors.text,
            },
          ]}
          textAlignVertical="top"
          value={adminReply}
        />
        {message ? (
          <View
            style={[
              styles.messageRow,
              {
                backgroundColor: message.tone === 'success' ? '#1db99118' : '#d86f5b18',
              },
            ]}>
            <MaterialCommunityIcons
              name={message.tone === 'success' ? 'check-circle-outline' : 'alert-circle-outline'}
              size={17}
              color={message.tone === 'success' ? colors.success : '#d86f5b'}
            />
            <ThemedText
              style={[
                styles.messageText,
                { color: message.tone === 'success' ? colors.success : '#d86f5b' },
              ]}>
              {message.text}
            </ThemedText>
          </View>
        ) : null}
        <View style={styles.actionRow}>
          <Pressable
            accessibilityRole="button"
            disabled={submitting || status === 'resolved'}
            onPress={() => void handleStartProcessing()}
            style={({ pressed }) => [
              styles.actionButton,
              styles.secondaryAction,
              {
                backgroundColor: colors.primarySoft,
                opacity: submitting || status === 'resolved' || pressed ? 0.68 : 1,
              },
            ]}>
            {submitting ? (
              <ActivityIndicator color={colors.primary} size="small" />
            ) : (
              <MaterialCommunityIcons name="play-circle-outline" size={18} color={colors.primary} />
            )}
            <ThemedText style={[styles.actionButtonText, { color: colors.primary }]}>
              开始处理
            </ThemedText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={submitting}
            onPress={() => void handleResolve()}
            style={({ pressed }) => [
              styles.actionButton,
              {
                backgroundColor: colors.hero,
                opacity: submitting || pressed ? 0.68 : 1,
              },
            ]}>
            {submitting ? (
              <ActivityIndicator color="#c9f36a" size="small" />
            ) : (
              <MaterialCommunityIcons name="send-outline" size={18} color="#c9f36a" />
            )}
            <ThemedText style={styles.primaryActionText}>提交处理结果</ThemedText>
          </Pressable>
        </View>
      </View>

      <Modal
        animationType="fade"
        onRequestClose={() => setPreviewPath(null)}
        transparent
        visible={previewPath !== null}>
        <View style={styles.previewModal}>
          <View style={styles.previewTopBar}>
            <Pressable
              accessibilityLabel="关闭图片预览"
              accessibilityRole="button"
              onPress={() => setPreviewPath(null)}
              style={styles.previewClose}>
              <MaterialCommunityIcons name="close" size={22} color="#ffffff" />
            </Pressable>
          </View>
          {previewPath ? (
            <FeedbackImage adminToken={adminToken} contain path={previewPath} />
          ) : null}
        </View>
      </Modal>
    </ScrollView>
  );
}

function AdminBadge({ color, label }: { color: string; label: string }) {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.adminBadge, { backgroundColor: `${color}18` }]}>
      <ThemedText style={[styles.adminBadgeText, { color }]}>{label}</ThemedText>
    </View>
  );
}

function FeedbackImage({
  adminToken,
  contain = false,
  path,
}: {
  adminToken: string;
  contain?: boolean;
  path: string;
}) {
  const { colors } = useAppTheme();
  const [webURI, setWebURI] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let active = true;
    let objectURL: string | null = null;
    void fetch(`${getAPIBaseUrl()}${path}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    })
      .then((response) => {
        if (!response.ok) throw new Error('feedback image request failed');
        return response.blob();
      })
      .then((blob) => {
        objectURL = URL.createObjectURL(blob);
        if (active) setWebURI(objectURL);
      })
      .catch(() => {
        if (active) setWebURI(null);
      });
    return () => {
      active = false;
      if (objectURL) URL.revokeObjectURL(objectURL);
    };
  }, [adminToken, path]);

  if (Platform.OS === 'web') {
    return (
      <Image
        contentFit={contain ? 'contain' : 'cover'}
        source={webURI ? { uri: webURI } : undefined}
        style={contain ? styles.previewImage : styles.thumbnailImage}
      />
    );
  }
  return (
    <Image
      contentFit={contain ? 'contain' : 'cover'}
      source={feedbackImageSource(adminToken, path)}
      style={contain ? styles.previewImage : styles.thumbnailImage}
    />
  );
}

function formatFeedbackTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const styles = StyleSheet.create({
  detailScroll: {
    flex: 1,
  },
  detailContent: {
    gap: 14,
    padding: 16,
  },
  backButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 7,
    minHeight: 40,
    paddingHorizontal: 12,
  },
  backButtonText: {
    fontSize: 13,
    fontWeight: '800',
  },
  userCard: {
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    padding: 14,
  },
  avatarWrap: {
    alignItems: 'center',
    borderRadius: 16,
    height: 52,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 52,
  },
  avatarImage: {
    height: '100%',
    width: '100%',
  },
  userCopy: {
    flex: 1,
    gap: 4,
  },
  userName: {
    fontSize: 15,
    fontWeight: '800',
  },
  userMeta: {
    fontSize: 12,
  },
  sectionCard: {
    borderRadius: 18,
    borderWidth: 1,
    gap: 12,
    padding: 16,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '800',
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  adminBadge: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  adminBadgeText: {
    fontSize: 10.5,
    fontWeight: '800',
  },
  detailTitle: {
    fontSize: 20,
    fontWeight: '900',
  },
  imageCount: {
    fontSize: 12,
  },
  descriptionText: {
    fontSize: 14,
    lineHeight: 23,
  },
  imageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  imageTile: {
    borderRadius: 14,
    height: 112,
    overflow: 'hidden',
    width: 112,
  },
  thumbnailImage: {
    height: '100%',
    width: '100%',
  },
  previewModal: {
    backgroundColor: 'rgba(8,10,14,0.96)',
    flex: 1,
  },
  previewTopBar: {
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingTop: 54,
  },
  previewClose: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  previewImage: {
    flex: 1,
    width: '100%',
  },
  replyInput: {
    borderRadius: 14,
    borderWidth: 1,
    fontSize: 14,
    lineHeight: 21,
    minHeight: 112,
    padding: 12,
  },
  messageRow: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  messageText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  actionButton: {
    alignItems: 'center',
    borderRadius: 14,
    flex: 1,
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    minHeight: 46,
  },
  secondaryAction: {
    flex: 0.8,
  },
  actionButtonText: {
    fontSize: 13,
    fontWeight: '800',
  },
  primaryActionText: {
    color: '#c9f36a',
    fontSize: 13,
    fontWeight: '800',
  },
});
