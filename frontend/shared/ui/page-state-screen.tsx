import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter } from 'expo-router';
import type { PropsWithChildren, ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { appLayout } from '@/constants/app-theme';
import { useAppTheme } from '@/hooks/use-app-theme';

type PageStateScreenProps = PropsWithChildren<{
  onBack?: () => void;
  progress?: ReactNode;
  stateLabel: string;
  title: string;
}>;

export function PageStateScreen({
  children,
  onBack,
  progress,
  stateLabel,
  title,
}: PageStateScreenProps) {
  const router = useRouter();
  const { colors } = useAppTheme();

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={[styles.content, { maxWidth: appLayout.screenMaxWidth }]}>
        <View style={styles.header}>
          <Pressable
            accessibilityLabel="返回上一页"
            accessibilityRole="button"
            hitSlop={8}
            onPress={onBack ?? (() => router.back())}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
            <MaterialCommunityIcons name="arrow-left" size={22} color={colors.text} />
          </Pressable>
          <ThemedText numberOfLines={1} style={styles.title}>
            {title}
          </ThemedText>
          <ThemedText style={[styles.stateLabel, { color: colors.mutedText }]}>
            {stateLabel}
          </ThemedText>
        </View>
        {progress ? <View style={styles.progress}>{progress}</View> : null}
        {children}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  backButton: {
    alignItems: 'center',
    borderRadius: 999,
    height: 36,
    justifyContent: 'center',
    marginLeft: -8,
    width: 36,
  },
  content: {
    alignSelf: 'center',
    flex: 1,
    paddingHorizontal: 16,
    width: '100%',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    height: 52,
  },
  pressed: {
    opacity: 0.55,
  },
  progress: {
    height: 2,
    marginBottom: 14,
    marginTop: 2,
  },
  safeArea: {
    flex: 1,
  },
  stateLabel: {
    fontSize: 11,
    fontWeight: '700',
    maxWidth: 96,
    textAlign: 'right',
  },
  title: {
    flex: 1,
    fontSize: 17,
    fontWeight: '900',
  },
});
