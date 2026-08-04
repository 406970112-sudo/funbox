import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/features/auth/auth-provider';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  decidePriceRadarObjection,
  decidePriceRadarReport,
  getPriceRadarErrorMessage,
  listAdminPriceReviews,
} from '@/lib/price-radar-api';
import { AppLoadingScreen } from '@/shared/ui/app-loading-screen';
import type { PriceRadarObjection, PriceRadarReport } from '@/types/price-radar';

export function AdminPriceRadarScreen() {
  const { colors } = useAppTheme();
  const { accessToken, status, user } = useAuth();
  const adminToken =
    status === 'authenticated' && user?.role === 'admin' && accessToken ? accessToken : null;
  const [tab, setTab] = useState<'reports' | 'objections'>('reports');
  const [reports, setReports] = useState<PriceRadarReport[]>([]);
  const [objections, setObjections] = useState<PriceRadarObjection[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyID, setBusyID] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function load() {
    if (!adminToken) return;
    setLoading(true);
    setError('');
    try {
      const page = await listAdminPriceReviews(adminToken);
      setReports(page.reports);
      setObjections(page.objections);
    } catch (loadError) {
      setError(getPriceRadarErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminToken]);

  async function decideReport(report: PriceRadarReport, action: 'approve' | 'reject') {
    if (!adminToken) return;
    setBusyID(report.id);
    setError('');
    try {
      await decidePriceRadarReport(adminToken, report.id, action, action === 'approve' ? '凭证与价格一致' : '凭证无法核验');
      await load();
    } catch (decisionError) {
      setError(getPriceRadarErrorMessage(decisionError));
    } finally {
      setBusyID(null);
    }
  }

  async function decideObjection(objection: PriceRadarObjection, action: 'support' | 'keep') {
    if (!adminToken) return;
    setBusyID(objection.id);
    setError('');
    try {
      await decidePriceRadarObjection(
        adminToken,
        objection.id,
        action,
        action === 'support' ? '异议成立，记录已下线' : '异议不成立，原记录维持',
      );
      await load();
    } catch (decisionError) {
      setError(getPriceRadarErrorMessage(decisionError));
    } finally {
      setBusyID(null);
    }
  }

  if (status === 'loading' || !user) {
    return <AppLoadingScreen />;
  }
  if (status !== 'authenticated' || user.role !== 'admin' || !adminToken) {
    return <Redirect href="/profile" />;
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <View style={styles.tabs}>
        <Pressable
          accessibilityRole="button"
          onPress={() => setTab('reports')}
          style={[styles.tab, tab === 'reports' && { backgroundColor: colors.primarySoft }]}>
          <ThemedText style={[styles.tabText, { color: tab === 'reports' ? colors.primary : colors.mutedText }]}>
            待核验报价
          </ThemedText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => setTab('objections')}
          style={[styles.tab, tab === 'objections' && { backgroundColor: colors.primarySoft }]}>
          <ThemedText style={[styles.tabText, { color: tab === 'objections' ? colors.primary : colors.mutedText }]}>
            待核验异议
          </ThemedText>
        </Pressable>
      </View>
      {error ? (
        <View style={[styles.errorCard, { backgroundColor: '#fff0f4', borderColor: '#ffd3df' }]}>
          <ThemedText style={styles.errorText}>{error}</ThemedText>
        </View>
      ) : null}
      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.primary} />
          <ThemedText style={[styles.centerText, { color: colors.mutedText }]}>正在加载待核验队列</ThemedText>
        </View>
      ) : tab === 'reports' ? (
        reports.length === 0 ? (
          <EmptyAdminState colors={colors} title="当前没有待核验凭证" body="用户提交后自动进入此队列，不填充演示记录" />
        ) : (
          <View style={styles.list}>
            {reports.map((report) => (
              <View key={report.id} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.line }]}>
                <View style={styles.cardHead}>
                  <View style={styles.cardTitle}>
                    <ThemedText style={styles.cardName}>{report.productName} · {report.storeName}</ThemedText>
                    <ThemedText style={[styles.cardMeta, { color: colors.mutedText }]}>
                      {report.price.toFixed(2)} {report.unit} · {report.purchaseDate}
                    </ThemedText>
                  </View>
                  <View style={[styles.pendingChip, { backgroundColor: '#fff5e6' }]}>
                    <ThemedText style={styles.pendingText}>待核验</ThemedText>
                  </View>
                </View>
                <View style={styles.actions}>
                  <Pressable
                    accessibilityRole="button"
                    disabled={busyID === report.id}
                    onPress={() => void decideReport(report, 'approve')}
                    style={[styles.actionButton, { backgroundColor: '#24b36b' }]}>
                    <ThemedText style={styles.actionText}>通过</ThemedText>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    disabled={busyID === report.id}
                    onPress={() => void decideReport(report, 'reject')}
                    style={[styles.actionButton, { backgroundColor: '#ff5d6c' }]}>
                    <ThemedText style={styles.actionText}>驳回</ThemedText>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        )
      ) : objections.length === 0 ? (
        <EmptyAdminState colors={colors} title="当前没有待核验异议" body="用户提交的异议会出现在这里" />
      ) : (
        <View style={styles.list}>
          {objections.map((objection) => (
            <View key={objection.id} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.line }]}>
              <View style={styles.cardHead}>
                <View style={styles.cardTitle}>
                  <ThemedText style={styles.cardName}>{objection.reason}</ThemedText>
                  <ThemedText style={[styles.cardMeta, { color: colors.mutedText }]}>
                    {objection.body || '用户未填写补充说明'}
                  </ThemedText>
                </View>
                <View style={[styles.pendingChip, { backgroundColor: '#fff5e6' }]}>
                  <ThemedText style={styles.pendingText}>待处理</ThemedText>
                </View>
              </View>
              <View style={styles.actions}>
                <Pressable
                  accessibilityRole="button"
                  disabled={busyID === objection.id}
                  onPress={() => void decideObjection(objection, 'support')}
                  style={[styles.actionButton, { backgroundColor: '#ff5d6c' }]}>
                  <ThemedText style={styles.actionText}>支持异议</ThemedText>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={busyID === objection.id}
                  onPress={() => void decideObjection(objection, 'keep')}
                  style={[styles.actionButton, { backgroundColor: '#24b36b' }]}>
                  <ThemedText style={styles.actionText}>维持原记录</ThemedText>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function EmptyAdminState({
  colors,
  title,
  body,
}: {
  colors: ReturnType<typeof useAppTheme>['colors'];
  title: string;
  body: string;
}) {
  return (
    <View style={[styles.empty, { backgroundColor: colors.surfaceMuted, borderColor: colors.line }]}>
      <MaterialCommunityIcons name="inbox-outline" size={30} color={colors.mutedText} />
      <ThemedText style={styles.emptyTitle}>{title}</ThemedText>
      <ThemedText style={[styles.emptyBody, { color: colors.mutedText }]}>{body}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  content: {
    gap: 12,
    padding: 16,
  },
  tabs: {
    flexDirection: 'row',
    gap: 8,
  },
  tab: {
    alignItems: 'center',
    borderRadius: 10,
    height: 36,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  tabText: {
    fontSize: 12,
    fontWeight: '900',
  },
  errorCard: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
  },
  errorText: {
    color: '#d6455d',
    fontSize: 11,
    fontWeight: '700',
  },
  centerState: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: 60,
  },
  centerText: {
    fontSize: 11,
    fontWeight: '700',
  },
  list: {
    gap: 10,
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  cardHead: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
  },
  cardTitle: {
    flex: 1,
    minWidth: 0,
  },
  cardName: {
    fontSize: 13,
    fontWeight: '900',
  },
  cardMeta: {
    fontSize: 10,
    marginTop: 5,
  },
  pendingChip: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  pendingText: {
    color: '#9a6418',
    fontSize: 9,
    fontWeight: '900',
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  actionButton: {
    alignItems: 'center',
    borderRadius: 9,
    flex: 1,
    height: 36,
    justifyContent: 'center',
  },
  actionText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '900',
  },
  empty: {
    alignItems: 'center',
    borderRadius: 12,
    borderStyle: 'dashed',
    borderWidth: 1,
    padding: 40,
  },
  emptyTitle: {
    fontSize: 13,
    fontWeight: '900',
    marginTop: 12,
  },
  emptyBody: {
    fontSize: 10,
    marginTop: 6,
    textAlign: 'center',
  },
});
