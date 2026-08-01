import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { type PropsWithChildren, useCallback, useRef, useState } from 'react';
import {
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useFeatureAccess } from '@/features/access/feature-access-provider';
import { useAppTheme } from '@/hooks/use-app-theme';
import { getStoredToolUsage } from '@/lib/tool-usage-storage';
import { getCommonToolIds, type ToolUsageStat } from '@/lib/tool-usage';
import { popularGames } from '@/mocks/app-data';
import { MobileScreen } from '@/shared/ui/mobile-screen';
import type { AppTool, GameItem } from '@/types/app';

import { FeaturedToolCarousel } from './featured-tool-carousel';
import { GameArtwork } from './game-artwork';

const HOME_TOOL_LIMIT = 6;
const DEFAULT_COMMON_TOOL_IDS: AppTool['id'][] = [
  'text-to-speech',
  'image-compressor',
  'qr-code',
  'smart-translation',
];
const HOME_TOOL_EXCLUSIONS = new Set<AppTool['id']>([
  'release-email-assistant',
  'live-stream-capture',
]);
type SectionHeaderProps = {
  title: string;
  meta: string;
  onPress?: () => void;
};

function Reveal({ children, progress }: PropsWithChildren<{ progress: Animated.Value }>) {
  return (
    <Animated.View
      style={{
        opacity: progress,
        transform: [
          {
            translateY: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [14, 0],
            }),
          },
        ],
      }}>
      {children}
    </Animated.View>
  );
}

function SectionHeader({ title, meta, onPress }: SectionHeaderProps) {
  const { colors } = useAppTheme();

  return (
    <View style={styles.sectionHeader}>
      <View>
        <ThemedText style={styles.sectionTitle}>{title}</ThemedText>
        <ThemedText style={[styles.sectionMeta, { color: colors.mutedText }]}>{meta}</ThemedText>
      </View>
      {onPress ? (
        <Pressable
          accessibilityRole="button"
          hitSlop={10}
          onPress={onPress}
          style={({ pressed }) => [styles.sectionAction, pressed && styles.pressed]}>
          <ThemedText style={[styles.sectionActionText, { color: colors.text }]}>全部</ThemedText>
          <MaterialCommunityIcons name="arrow-right" size={17} color={colors.text} />
        </Pressable>
      ) : null}
    </View>
  );
}

function ToolTile({ tool, onPress }: { tool: AppTool; onPress: () => void }) {
  const { colors } = useAppTheme();

  return (
    <Pressable
      accessibilityHint={`打开${tool.name}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.toolTile,
        {
          backgroundColor: colors.surface,
          borderColor: colors.line,
        },
        pressed && styles.pressed,
      ]}>
      <View style={styles.toolTileTop}>
        <View style={[styles.toolIcon, { backgroundColor: `${tool.accentColor}18` }]}>
          <MaterialCommunityIcons name={tool.icon} size={22} color={tool.accentColor} />
        </View>
        <MaterialCommunityIcons name="arrow-top-right" size={17} color={colors.mutedText} />
      </View>
      <View>
        <ThemedText numberOfLines={2} style={styles.toolTitle}>
          {tool.name}
        </ThemedText>
        <ThemedText
          numberOfLines={1}
          style={[styles.toolTagline, { color: colors.mutedText }]}>
          {tool.tagline}
        </ThemedText>
      </View>
    </Pressable>
  );
}

function GameTile({ game, onPress }: { game: GameItem; onPress: () => void }) {
  const { colors } = useAppTheme();

  return (
    <Pressable
      accessibilityHint={`开始${game.name}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.gameTile,
        { backgroundColor: colors.surface, borderColor: colors.line },
        pressed && styles.pressed,
      ]}>
      <View style={[styles.gameVisual, { backgroundColor: `${game.accentColor}1c` }]}>
        <View style={styles.gameArtwork}>
          <GameArtwork
            accentColor={game.accentColor}
            contrastColor={colors.text}
            gameId={game.id}
            mutedColor={colors.mutedText}
          />
        </View>
      </View>
      <ThemedText numberOfLines={1} style={styles.gameTitle}>
        {game.name}
      </ThemedText>
      <ThemedText numberOfLines={1} style={[styles.gameGenre, { color: colors.mutedText }]}>
        {game.genre}
      </ThemedText>
    </Pressable>
  );
}

export function HomeScreen() {
  const router = useRouter();
  const { colors, colorScheme } = useAppTheme();
  const { visibleTools } = useFeatureAccess();
  const reveals = useRef(Array.from({ length: 4 }, () => new Animated.Value(1))).current;
  const [toolUsage, setToolUsage] = useState<ToolUsageStat[]>([]);
  const availableTools = visibleTools.filter((tool) => tool.status === 'available');
  const commonToolIDs = getCommonToolIds(
    availableTools.map((tool) => tool.id),
    toolUsage,
    DEFAULT_COMMON_TOOL_IDS,
  );
  const commonToolIDSet = new Set(commonToolIDs);
  const commonTools = commonToolIDs.flatMap((toolId) => {
    const tool = availableTools.find((candidate) => candidate.id === toolId);
    return tool ? [tool] : [];
  });
  const quickTools = visibleTools
    .filter(
      (tool) =>
        tool.status === 'available' &&
        !HOME_TOOL_EXCLUSIONS.has(tool.id) &&
        !commonToolIDSet.has(tool.id),
    )
    .slice(0, HOME_TOOL_LIMIT);
  const playableGames = popularGames.filter((game) => game.status === 'playable').slice(0, 4);
  const availableToolCount = visibleTools.filter((tool) => tool.status === 'available').length;

  useFocusEffect(
    useCallback(() => {
      let active = true;

      void getStoredToolUsage().then((items) => {
        if (active) setToolUsage(items);
      });

      return () => {
        active = false;
      };
    }, []),
  );

  return (
    <MobileScreen contentContainerStyle={styles.pageContent}>
      <View style={styles.backgroundPattern}>
        <View style={[styles.patternBand, { borderColor: colors.line }]} />
        <View style={[styles.patternBand, styles.patternBandOffset, { borderColor: colors.line }]} />
      </View>

      <Reveal progress={reveals[0]}>
        <View style={styles.topBar}>
          <View style={styles.brandLockup}>
            <View
              style={[
                styles.brandMark,
                { backgroundColor: colorScheme === 'dark' ? '#c9f36a' : '#18211f' },
              ]}>
              <MaterialCommunityIcons
                name="cube-outline"
                size={21}
                color={colorScheme === 'dark' ? '#173a35' : '#ffffff'}
              />
            </View>
            <View>
              <ThemedText style={styles.brandTitle}>FunBox</ThemedText>
              <ThemedText style={[styles.brandSubtitle, { color: colors.mutedText }]}>
                工具与游戏，随手即用
              </ThemedText>
            </View>
          </View>
          <ThemedText style={[styles.libraryCount, { color: colors.mutedText }]}>
            {availableToolCount} 个工具
          </ThemedText>
        </View>
      </Reveal>

      <Reveal progress={reveals[1]}>
        <FeaturedToolCarousel
          tools={commonTools}
          onToolPress={(tool) => router.push(tool.route)}
        />
      </Reveal>

      <Reveal progress={reveals[2]}>
        <View style={styles.section}>
          <SectionHeader
            title="更多工具"
            meta="更多能力，按需取用"
            onPress={() => router.push('/tools')}
          />
          <View style={styles.toolGrid}>
            {quickTools.map((tool) => (
              <ToolTile key={tool.id} tool={tool} onPress={() => router.push(tool.route)} />
            ))}
          </View>
        </View>
      </Reveal>

      <Reveal progress={reveals[3]}>
        <View style={styles.section}>
          <SectionHeader title="放松一下" meta="四款小游戏，随时开一局" />
          <View style={styles.gameGrid}>
            {playableGames.map((game) => (
              <GameTile key={game.id} game={game} onPress={() => router.push(game.route)} />
            ))}
          </View>
        </View>
      </Reveal>
    </MobileScreen>
  );
}

const styles = StyleSheet.create({
  pageContent: {
    gap: 18,
    paddingTop: 16,
  },
  backgroundPattern: {
    height: 170,
    overflow: 'hidden',
    position: 'absolute',
    pointerEvents: 'none',
    right: -16,
    top: -12,
    width: 180,
  },
  patternBand: {
    borderRadius: 8,
    borderWidth: 1,
    height: 52,
    opacity: 0.6,
    position: 'absolute',
    right: -32,
    top: 22,
    transform: [{ rotate: '-16deg' }],
    width: 190,
  },
  patternBandOffset: {
    right: -54,
    top: 78,
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 44,
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
  brandTitle: {
    fontFamily: Platform.select({ android: 'serif', default: 'Georgia' }),
    fontSize: 24,
    fontWeight: '900',
    lineHeight: 27,
  },
  brandSubtitle: {
    fontSize: 11,
    lineHeight: 16,
  },
  libraryCount: {
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 16,
  },
  section: {
    gap: 13,
  },
  sectionHeader: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontSize: 19,
    fontWeight: '900',
    lineHeight: 25,
  },
  sectionMeta: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 1,
  },
  sectionAction: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 5,
    minHeight: 32,
    paddingLeft: 10,
  },
  sectionActionText: {
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 18,
  },
  toolGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  toolTile: {
    borderRadius: 16,
    borderWidth: 1,
    flexBasis: '31%',
    flexGrow: 1,
    justifyContent: 'space-between',
    minHeight: 130,
    minWidth: 0,
    padding: 12,
  },
  toolTileTop: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  toolIcon: {
    alignItems: 'center',
    borderRadius: 12,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  toolTitle: {
    fontSize: 14,
    fontWeight: '900',
    lineHeight: 19,
    minHeight: 19,
  },
  toolTagline: {
    fontSize: 10,
    lineHeight: 14,
    marginTop: 2,
  },
  gameGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  gameTile: {
    borderRadius: 18,
    borderWidth: 1,
    flex: 1,
    minWidth: 0,
    padding: 12,
  },
  gameVisual: {
    alignItems: 'center',
    borderRadius: 13,
    height: 58,
    justifyContent: 'center',
    marginBottom: 10,
    overflow: 'hidden',
    paddingHorizontal: 8,
  },
  gameArtwork: {
    height: 48,
    width: 64,
  },
  gameTitle: {
    fontSize: 14,
    fontWeight: '900',
    lineHeight: 20,
  },
  gameGenre: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
  },
  pressed: {
    opacity: 0.72,
  },
});
