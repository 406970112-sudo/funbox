import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  type StyleProp,
  type ImageStyle,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useAppTheme } from '@/hooks/use-app-theme';
import { getAPIBaseUrl, resolveAvatarURL } from '@/lib/auth-api';
import { feedbackImageSource } from '@/lib/feedback-api';
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
  const [previewPath, setPreviewPath] = useState<string | null>(null);

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
        <ThemedText style={styles.sectionLabel}>问题描述</ThemedText>
        <ThemedText style={styles.descriptionText}>{item.description}</ThemedText>
      </View>

      {item.images.length > 0 ? (
        <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <View style={styles.sectionHeader}>
            <ThemedText style={styles.sectionLabel}>截图</ThemedText>
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
});
