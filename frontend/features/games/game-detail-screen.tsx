import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GomokuGameScreen } from '@/features/games/gomoku-game-screen';
import { SnakeGameScreen } from '@/features/games/snake-game-screen';
import { TetrisGameScreen } from '@/features/games/tetris-game-screen';
import { useAppTheme } from '@/hooks/use-app-theme';
import { getGameById } from '@/mocks/app-data';
import { MobileScreen } from '@/shared/ui/mobile-screen';
import { PageHeader } from '@/shared/ui/page-header';
import { SurfaceCard } from '@/shared/ui/surface-card';
import type { GameId } from '@/types/app';

export function GameDetailScreen() {
  const params = useLocalSearchParams<{ gameId: GameId }>();
  const game = getGameById(params.gameId);
  const router = useRouter();
  const { colors } = useAppTheme();

  if (game?.id === 'snake-brawl') {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <SnakeGameScreen />
      </>
    );
  }

  if (game?.id === 'gomoku') {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <GomokuGameScreen />
      </>
    );
  }

  if (game?.id === 'tetris') {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <TetrisGameScreen />
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <MobileScreen>
        <PageHeader
          eyebrow="Hot Game"
          title={game?.name ?? '未找到游戏'}
          subtitle={
            game
              ? '游戏详情页已经预留好结构，后续可以继续补玩法逻辑、成长系统和商业化内容。'
              : '当前路由没有匹配到对应游戏，请从首页的热门游戏区重新进入。'
          }
          rightSlot={
            <Pressable onPress={() => router.back()} style={styles.closeButton}>
              <MaterialCommunityIcons name="arrow-left" size={20} color={colors.text} />
            </Pressable>
          }
        />

        <SurfaceCard style={styles.placeholderCard}>
          <View style={styles.placeholderHeader}>
            <View
              style={[
                styles.dot,
                {
                  backgroundColor: game?.accentColor ?? colors.accent,
                },
              ]}
            />
            <ThemedText style={styles.placeholderTitle}>
              {game ? `${game.name} 正在排期中` : '游戏不存在'}
            </ThemedText>
          </View>
          <ThemedText style={[styles.placeholderBody, { color: colors.mutedText }]}>
            {game
              ? game.description
              : '请从首页进入已上线的热门游戏。目前“贪吃蛇大作战”已经可以直接开玩。'}
          </ThemedText>
          {game ? (
            <View style={[styles.statusChip, { backgroundColor: colors.surfaceMuted }]}>
              <ThemedText style={[styles.statusChipText, { color: game.accentColor }]}>
                {game.status === 'coming-soon' ? 'Coming Soon' : 'Playable'}
              </ThemedText>
            </View>
          ) : null}
        </SurfaceCard>
      </MobileScreen>
    </>
  );
}

const styles = StyleSheet.create({
  closeButton: {
    borderRadius: 999,
    padding: 8,
  },
  placeholderCard: {
    gap: 12,
    padding: 18,
  },
  placeholderHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  dot: {
    borderRadius: 999,
    height: 12,
    width: 12,
  },
  placeholderTitle: {
    fontSize: 18,
    fontWeight: '800',
  },
  placeholderBody: {
    fontSize: 14,
    lineHeight: 22,
  },
  statusChip: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  statusChipText: {
    fontSize: 12,
    fontWeight: '700',
  },
});
