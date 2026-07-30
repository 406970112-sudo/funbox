import { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { appLayout, appTheme } from '@/constants/app-theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type AppLoadingScreenProps = {
  error?: boolean;
  onRetry?: () => void;
};

export function AppLoadingScreen({ error = false, onRetry }: AppLoadingScreenProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = appTheme[colorScheme];
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (error) return;

    const animation = Animated.loop(
      Animated.timing(progress, {
        duration: 1_100,
        toValue: 1,
        useNativeDriver: true,
      }),
    );
    animation.start();
    return () => animation.stop();
  }, [error, progress]);

  const brandBackground = colorScheme === 'dark' ? '#c9f36a' : '#18211f';
  const brandColor = colorScheme === 'dark' ? '#173a35' : '#ffffff';

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={styles.pattern}>
        <View style={[styles.patternBand, { borderColor: colors.line }]} />
        <View style={[styles.patternBand, styles.patternBandOffset, { borderColor: colors.line }]} />
      </View>

      <View style={[styles.content, { maxWidth: appLayout.screenMaxWidth }]}>
        <View style={styles.brandLockup}>
          <View style={[styles.brandMark, { backgroundColor: brandBackground }]}>
            <Text style={[styles.brandLetter, { color: brandColor }]}>F</Text>
          </View>
          <View>
            <Text style={[styles.brandTitle, { color: colors.text }]}>FunBox</Text>
            <Text style={[styles.brandSubtitle, { color: colors.mutedText }]}>工具与游戏，随手即用</Text>
          </View>
        </View>

        <View style={[styles.loadingPanel, { backgroundColor: colors.hero }]}>
          <View style={styles.loadingHeader}>
            {error ? null : <ActivityIndicator color="#c9f36a" size="small" />}
            <Text style={styles.loadingEyebrow}>{error ? '加载失败' : '启动中'}</Text>
          </View>
          <Text style={styles.loadingTitle}>{error ? '资源没有加载完成' : '正在准备 FunBox'}</Text>
          <Text style={styles.loadingDescription}>
            {error ? '请检查网络连接后重新加载' : '正在加载图标与界面资源，请稍候'}
          </Text>

          {error ? (
            onRetry ? (
              <Pressable
                accessibilityRole="button"
                onPress={onRetry}
                style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}>
                <Text style={styles.retryButtonText}>重新加载</Text>
              </Pressable>
            ) : null
          ) : (
            <View style={styles.progressTrack}>
              <Animated.View
                style={[
                  styles.progressValue,
                  {
                    transform: [
                      {
                        translateX: progress.interpolate({
                          inputRange: [0, 1],
                          outputRange: [-72, 286],
                        }),
                      },
                    ],
                  },
                ]}
              />
            </View>
          )}
        </View>

        <View style={styles.skeletonGrid}>
          {[0, 1, 2, 3].map((item) => (
            <View
              key={item}
              style={[styles.skeletonTile, { backgroundColor: colors.surface, borderColor: colors.line }]}>
              <View style={[styles.skeletonIcon, { backgroundColor: colors.surfaceMuted }]} />
              <View style={[styles.skeletonLine, { backgroundColor: colors.line }]} />
              <View style={[styles.skeletonLine, styles.skeletonLineShort, { backgroundColor: colors.line }]} />
            </View>
          ))}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  brandLetter: {
    fontSize: 22,
    fontWeight: '900',
  },
  brandLockup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 11,
  },
  brandMark: {
    alignItems: 'center',
    borderRadius: 12,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  brandSubtitle: {
    fontSize: 11,
    lineHeight: 16,
  },
  brandTitle: {
    fontFamily: Platform.select({ android: 'serif', default: 'Georgia' }),
    fontSize: 24,
    fontWeight: '900',
    lineHeight: 27,
  },
  content: {
    alignSelf: 'center',
    flex: 1,
    gap: 22,
    justifyContent: 'center',
    paddingHorizontal: 16,
    width: '100%',
  },
  loadingDescription: {
    color: '#b9cec7',
    fontSize: 13,
    lineHeight: 20,
    marginTop: 8,
  },
  loadingEyebrow: {
    color: '#c9f36a',
    fontSize: 12,
    fontWeight: '800',
  },
  loadingHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  loadingPanel: {
    borderRadius: 8,
    minHeight: 190,
    overflow: 'hidden',
    padding: 22,
  },
  loadingTitle: {
    color: '#ffffff',
    fontSize: 25,
    fontWeight: '900',
    lineHeight: 32,
    marginTop: 20,
  },
  pattern: {
    height: 220,
    overflow: 'hidden',
    pointerEvents: 'none',
    position: 'absolute',
    right: 0,
    top: 0,
    width: 210,
  },
  patternBand: {
    borderRadius: 8,
    borderWidth: 1,
    height: 52,
    opacity: 0.7,
    position: 'absolute',
    right: -28,
    top: 42,
    transform: [{ rotate: '-16deg' }],
    width: 200,
  },
  patternBandOffset: {
    right: -52,
    top: 102,
  },
  pressed: {
    opacity: 0.72,
  },
  progressTrack: {
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderRadius: 3,
    height: 5,
    marginTop: 28,
    overflow: 'hidden',
  },
  progressValue: {
    backgroundColor: '#c9f36a',
    borderRadius: 3,
    height: '100%',
    width: 72,
  },
  retryButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#c9f36a',
    borderRadius: 8,
    justifyContent: 'center',
    marginTop: 24,
    minHeight: 42,
    paddingHorizontal: 16,
  },
  retryButtonText: {
    color: '#173a35',
    fontSize: 13,
    fontWeight: '800',
  },
  screen: {
    flex: 1,
  },
  skeletonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  skeletonIcon: {
    borderRadius: 8,
    height: 36,
    width: 36,
  },
  skeletonLine: {
    borderRadius: 3,
    height: 8,
    marginTop: 20,
    width: '72%',
  },
  skeletonLineShort: {
    height: 6,
    marginTop: 7,
    width: '48%',
  },
  skeletonTile: {
    borderRadius: 8,
    borderWidth: 1,
    flexBasis: '48%',
    flexGrow: 1,
    minHeight: 116,
    padding: 14,
  },
});
