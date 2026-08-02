import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useAppTheme } from '@/hooks/use-app-theme';

import { PageStateScreen } from './page-state-screen';

type PageEmptyStateProps = {
  action?: ReactNode;
  description?: string;
  onBack?: () => void;
  title: string;
};

export function PageEmptyState({ action, description, onBack, title }: PageEmptyStateProps) {
  const { colors } = useAppTheme();

  return (
    <PageStateScreen onBack={onBack} stateLabel="暂无内容" title={title}>
      <View style={styles.center}>
        <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
          <ThemedText style={[styles.iconMark, { color: colors.primary }]}>空</ThemedText>
        </View>
        <ThemedText style={styles.emptyTitle}>暂无内容</ThemedText>
        <ThemedText style={[styles.emptyBody, { color: colors.mutedText }]}>
          {description || '这里还没有内容，先去创建第一条吧。'}
        </ThemedText>
        {action ? <View style={styles.action}>{action}</View> : null}
      </View>
    </PageStateScreen>
  );
}

const styles = StyleSheet.create({
  action: {
    marginTop: 20,
  },
  center: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingBottom: 96,
  },
  emptyBody: {
    fontSize: 12,
    lineHeight: 19,
    marginTop: 8,
    maxWidth: 260,
    textAlign: 'center',
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '900',
    marginTop: 16,
  },
  icon: {
    alignItems: 'center',
    borderRadius: 999,
    height: 62,
    justifyContent: 'center',
    width: 62,
  },
  iconMark: {
    fontSize: 22,
    fontWeight: '900',
  },
});
