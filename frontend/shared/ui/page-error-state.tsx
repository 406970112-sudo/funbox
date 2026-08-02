import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useAppTheme } from '@/hooks/use-app-theme';

import { PageStateScreen } from './page-state-screen';

type PageErrorStateProps = {
  message?: string;
  onBack?: () => void;
  onRetry?: () => void;
  title: string;
};

export function PageErrorState({ message, onBack, onRetry, title }: PageErrorStateProps) {
  const { colors } = useAppTheme();

  return (
    <PageStateScreen onBack={onBack} stateLabel="加载失败" title={title}>
      <View style={styles.center}>
        <View style={[styles.icon, { backgroundColor: '#fff0f4' }]}>
          <MaterialCommunityIcons name="alert-circle-outline" size={30} color="#d6455d" />
        </View>
        <ThemedText style={styles.errorTitle}>加载失败</ThemedText>
        <ThemedText style={[styles.errorBody, { color: colors.mutedText }]}>
          {message || '数据暂时没有取到，请检查网络后重试。'}
        </ThemedText>
        <View style={styles.actions}>
          {onRetry ? (
            <Pressable
              accessibilityLabel="重试加载"
              accessibilityRole="button"
              onPress={onRetry}
              style={({ pressed }) => [
                styles.retryButton,
                { backgroundColor: colors.primary },
                pressed && styles.pressed,
              ]}>
              <MaterialCommunityIcons name="refresh" size={17} color="#ffffff" />
              <ThemedText style={styles.retryText}>重试</ThemedText>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityLabel="返回首页"
            accessibilityRole="button"
            onPress={() => onBack?.()}
            style={({ pressed }) => [styles.homeButton, { borderColor: colors.line }, pressed && styles.pressed]}>
            <MaterialCommunityIcons name="home-outline" size={17} color={colors.text} />
            <ThemedText style={styles.homeText}>返回首页</ThemedText>
          </Pressable>
        </View>
      </View>
    </PageStateScreen>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 22,
  },
  center: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingBottom: 96,
  },
  errorBody: {
    fontSize: 12,
    lineHeight: 19,
    marginTop: 8,
    maxWidth: 260,
    textAlign: 'center',
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '900',
    marginTop: 16,
  },
  homeButton: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    height: 46,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  homeText: {
    fontSize: 12,
    fontWeight: '900',
  },
  icon: {
    alignItems: 'center',
    borderRadius: 999,
    height: 62,
    justifyContent: 'center',
    width: 62,
  },
  pressed: {
    opacity: 0.6,
  },
  retryButton: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 6,
    height: 46,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  retryText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '900',
  },
});
