import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/features/auth/auth-provider';
import { useAppTheme } from '@/hooks/use-app-theme';
import { getAPIBaseUrl } from '@/lib/auth-api';
import {
  feedbackCategoryLabel,
  feedbackKindLabel,
  feedbackStatusLabel,
} from '@/lib/feedback-model';
import {
  feedbackImageSource,
  getFeedback,
  getFeedbackErrorMessage,
  markFeedbackNotificationsRead,
} from '@/lib/feedback-api';
import { AppLoadingScreen } from '@/shared/ui/app-loading-screen';
import { MobileScreen } from '@/shared/ui/mobile-screen';
import type { FeedbackImage, FeedbackSubmission } from '@/types/feedback';

export function FeedbackResultScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { accessToken, status, user } = useAuth();
  const [error, setError] = useState('');
  const [item, setItem] = useState<FeedbackSubmission | null>(null);

  useEffect(() => {
    if (!accessToken || !id) return;
    let active = true;
    void (async () => {
      try {
        const response = await getFeedback(accessToken, id);
        if (!active) return;
        setItem(response.item);
        setError('');
        if (!response.item.read) {
          await markFeedbackNotificationsRead(accessToken, [response.item.id]);
        }
      } catch (requestError) {
        if (active) setError(getFeedbackErrorMessage(requestError));
      }
    })();
    return () => {
      active = false;
    };
  }, [accessToken, id]);

  if (status === 'loading' || !user) {
    return <AppLoadingScreen />;
  }
  if (status !== 'authenticated' || !accessToken) {
    return <Redirect href="/auth" />;
  }

  return (
    <MobileScreen contentContainerStyle={styles.pageContent}>
      <View style={styles.topBar}>
        <Pressable
          accessibilityLabel="返回"
          accessibilityRole="button"
          onPress={() => router.back()}
          style={[styles.iconButton, { backgroundColor: colors.surface }]}>
          <MaterialCommunityIcons name="arrow-left" size={21} color={colors.text} />
        </Pressable>
        <ThemedText style={styles.topBarTitle}>反馈结果</ThemedText>
        <View style={styles.iconButtonSpacer} />
      </View>

      {error ? (
        <View style={styles.centerState}>
          <MaterialCommunityIcons name="alert-circle-outline" size={30} color="#d86f5b" />
          <ThemedText style={[styles.stateText, { color: colors.mutedText }]}>{error}</ThemedText>
        </View>
      ) : !item ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <>
          <View style={[styles.metaCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <View style={styles.metaRow}>
              <Badge color="#6b5adb" label={feedbackKindLabel(item.kind)} />
              <Badge
                color={item.status === 'resolved' ? '#1db991' : '#4b6bff'}
                label={feedbackStatusLabel(item.status)}
              />
            </View>
            <ThemedText style={styles.title}>
              {item.kind === 'feature_request' ? item.title : '问题反馈'}
            </ThemedText>
            <ThemedText style={[styles.meta, { color: colors.mutedText }]}>
              {formatFeedbackTime(item.createdAt)}
              {item.category ? ` · ${feedbackCategoryLabel(item.category)}` : ''}
            </ThemedText>
          </View>

          <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <ThemedText style={styles.sectionLabel}>我的描述</ThemedText>
            <ThemedText style={styles.description}>{item.description}</ThemedText>
          </View>

          {item.images.length > 0 ? (
            <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
              <View style={styles.sectionHeader}>
                <ThemedText style={styles.sectionLabel}>{item.kind === 'feature_request' ? '设计图' : '截图'}</ThemedText>
                <ThemedText style={[styles.meta, { color: colors.mutedText }]}>{item.images.length} 张</ThemedText>
              </View>
              <View style={styles.imageGrid}>
                {item.images.map((image) => (
                  <FeedbackImageBox
                    image={image}
                    key={image.id}
                    token={accessToken}
                  />
                ))}
              </View>
            </View>
          ) : null}

          <View style={[styles.resultCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <View style={styles.resultHead}>
              <View style={[styles.resultIcon, { backgroundColor: '#e8f6f1' }]}>
                <MaterialCommunityIcons name="check-circle-outline" size={22} color="#1db991" />
              </View>
              <View style={styles.resultCopy}>
                <ThemedText style={styles.sectionLabel}>处理结果</ThemedText>
                <ThemedText style={[styles.meta, { color: colors.mutedText }]}>
                  {item.replyUpdatedAt ? formatFeedbackTime(item.replyUpdatedAt) : '已处理'}
                </ThemedText>
              </View>
            </View>
            <ThemedText style={styles.replyText}>
              {item.adminReply || '管理员还没有填写处理结果。'}
            </ThemedText>
          </View>
        </>
      )}
    </MobileScreen>
  );
}

function Badge({ color, label }: { color: string; label: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: `${color}18` }]}>
      <ThemedText style={[styles.badgeText, { color }]}>{label}</ThemedText>
    </View>
  );
}

function FeedbackImageBox({ image, token }: { image: FeedbackImage; token: string }) {
  const [webURI, setWebURI] = useState<string | null>(null);
  const { colors } = useAppTheme();

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let active = true;
    let objectURL: string | null = null;
    void fetch(`${getAPIBaseUrl()}${image.path}`, {
      headers: { Authorization: `Bearer ${token}` },
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
  }, [image.path, token]);

  const source =
    Platform.OS === 'web'
      ? webURI
        ? { uri: webURI }
        : undefined
      : feedbackImageSource(token, image.path);

  return (
    <View style={[styles.imageTile, { backgroundColor: colors.surfaceMuted, borderColor: colors.line }]}>
      <Image contentFit="cover" source={source} style={styles.imagePreview} />
    </View>
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
  pageContent: {
    gap: 16,
    paddingTop: 14,
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  topBarTitle: {
    fontSize: 18,
    fontWeight: '800',
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: 16,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  iconButtonSpacer: {
    height: 42,
    width: 42,
  },
  centerState: {
    alignItems: 'center',
    gap: 12,
    justifyContent: 'center',
    minHeight: 260,
  },
  stateText: {
    fontSize: 13,
    textAlign: 'center',
  },
  metaCard: {
    borderRadius: 18,
    borderWidth: 1,
    gap: 10,
    padding: 16,
  },
  metaRow: {
    flexDirection: 'row',
    gap: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: '900',
  },
  meta: {
    fontSize: 12,
  },
  sectionCard: {
    borderRadius: 18,
    borderWidth: 1,
    gap: 10,
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
  description: {
    fontSize: 14,
    lineHeight: 22,
  },
  imageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  imageTile: {
    borderRadius: 14,
    borderWidth: 1,
    height: 96,
    overflow: 'hidden',
    width: 96,
  },
  imagePreview: {
    height: '100%',
    width: '100%',
  },
  resultCard: {
    borderRadius: 18,
    borderWidth: 1,
    gap: 12,
    padding: 16,
  },
  resultHead: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  resultIcon: {
    alignItems: 'center',
    borderRadius: 12,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  resultCopy: {
    flex: 1,
    gap: 3,
  },
  replyText: {
    fontSize: 14,
    lineHeight: 22,
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  badgeText: {
    fontSize: 10.5,
    fontWeight: '800',
  },
});
