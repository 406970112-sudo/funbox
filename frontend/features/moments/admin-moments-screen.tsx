import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/features/auth/auth-provider';
import { SocialAvatar } from '@/features/social/social-ui';
import { adminHideMoment, adminListMoments } from '@/lib/moments-api';
import { useAppTheme } from '@/hooks/use-app-theme';
import { MobileScreen } from '@/shared/ui/mobile-screen';
import type { AdminMoment } from '@/types/moments';

export function AdminMomentsScreen() {
  const { colors } = useAppTheme();
  const { accessToken } = useAuth();
  const [moments, setMoments] = useState<AdminMoment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const page = await adminListMoments(accessToken);
      setMoments(page.moments);
      setError('');
    } catch {
      setError('朋友圈内容暂时无法加载。');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function hide(momentId: string) {
    if (!accessToken) return;
    try {
      await adminHideMoment(accessToken, momentId);
      setMoments((items) => items.filter((item) => item.id !== momentId));
    } catch {
      setError('下架失败，请稍后重试。');
    }
  }

  return (
    <MobileScreen contentContainerStyle={styles.page}>
      <View style={styles.topBar}>
        <View>
          <ThemedText style={styles.pageTitle}>朋友圈管理</ThemedText>
          <ThemedText style={[styles.pageMeta, { color: colors.mutedText }]}>
            真实动态与举报记录
          </ThemedText>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => void load()}
          style={[styles.refreshButton, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <MaterialCommunityIcons name="refresh" size={18} color={colors.text} />
          <ThemedText style={styles.refreshText}>刷新</ThemedText>
        </Pressable>
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
            <View style={styles.emptyState}>
              <MaterialCommunityIcons name="image-off-outline" size={26} color={colors.mutedText} />
              <ThemedText style={[styles.emptyText, { color: colors.mutedText }]}>
                暂无待管理动态
              </ThemedText>
            </View>
          )
        }
        renderItem={({ item }) => (
          <View style={[styles.momentRow, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <SocialAvatar size={38} user={item.author} />
            <View style={styles.momentCopy}>
              <View style={styles.momentTitleRow}>
                <ThemedText numberOfLines={1} style={styles.momentAuthor}>
                  {item.author.displayName}
                </ThemedText>
                {item.reportCount > 0 ? (
                  <View style={styles.reportBadge}>
                    <ThemedText style={styles.reportBadgeText}>{item.reportCount} 举报</ThemedText>
                  </View>
                ) : null}
              </View>
              <ThemedText numberOfLines={2} style={styles.momentBody}>
                {item.body}
              </ThemedText>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => void hide(item.id)}
              style={styles.hideButton}>
              <ThemedText style={styles.hideButtonText}>下架</ThemedText>
            </Pressable>
          </View>
        )}
        showsVerticalScrollIndicator={false}
      />
      {error ? <ThemedText style={styles.errorText}>{error}</ThemedText> : null}
    </MobileScreen>
  );
}

const styles = StyleSheet.create({
  emptyState: {
    alignItems: 'center',
    gap: 10,
    paddingTop: 90,
  },
  emptyText: {
    fontSize: 13,
  },
  errorText: {
    color: '#d86f5b',
    fontSize: 11,
    paddingVertical: 12,
    textAlign: 'center',
  },
  hideButton: {
    backgroundColor: '#ffe9ef',
    borderRadius: 9,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  hideButtonText: {
    color: '#d86f5b',
    fontSize: 11,
    fontWeight: '800',
  },
  listContent: {
    paddingTop: 14,
  },
  loadingState: {
    alignItems: 'center',
    paddingTop: 90,
  },
  momentAuthor: {
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '800',
  },
  momentBody: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 5,
  },
  momentCopy: {
    flex: 1,
    minWidth: 0,
  },
  momentRow: {
    alignItems: 'center',
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    marginBottom: 9,
    padding: 11,
  },
  momentTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
    minWidth: 0,
  },
  page: {
    paddingTop: 14,
  },
  pageMeta: {
    fontSize: 12,
    marginTop: 4,
  },
  pageTitle: {
    fontSize: 20,
    fontWeight: '800',
  },
  refreshButton: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    minHeight: 38,
    paddingHorizontal: 12,
  },
  refreshText: {
    fontSize: 12,
    fontWeight: '700',
  },
  reportBadge: {
    backgroundColor: '#ffe9ef',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  reportBadgeText: {
    color: '#d86f5b',
    fontSize: 9,
    fontWeight: '800',
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
