import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { type PropsWithChildren, useCallback, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { appLayout } from '@/constants/app-theme';
import { useFeatureAccess } from '@/features/access/feature-access-provider';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  DEFAULT_COMMON_TOOL_IDS,
  FEATURED_CANDIDATE_TOOL_IDS,
  HOME_COMMON_TOOL_LIMIT,
  getFeaturedToolIds,
} from '@/lib/home-tool-selection';
import { getStoredToolUsage } from '@/lib/tool-usage-storage';
import { getCommonToolIds, type ToolUsageStat } from '@/lib/tool-usage';
import { MobileScreen } from '@/shared/ui/mobile-screen';
import type { AppTool, GameItem } from '@/types/app';

import { FeaturedToolCarousel } from './featured-tool-carousel';
import { GameArtwork } from './game-artwork';

const GAME_LIST_GAP = 10;
const GAME_CARD_WIDTH_RATIO = 0.29;
const BOTTOM_EXTRA_PADDING = 16;

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
          accessibilityLabel="打开全部工具"
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
      accessibilityLabel={`打开${tool.name}`}
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
      <View style={[styles.toolIcon, { backgroundColor: `${tool.accentColor}18` }]}>
        <MaterialCommunityIcons name={tool.icon} size={22} color={tool.accentColor} />
      </View>
      <ThemedText numberOfLines={2} style={styles.toolTitle}>
        {tool.name}
      </ThemedText>
    </Pressable>
  );
}

function GameTile({
  game,
  onPress,
  width,
}: {
  game: GameItem;
  onPress: () => void;
  width: number;
}) {
  const { colors } = useAppTheme();

  return (
    <Pressable
      accessibilityLabel={`打开${game.name}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.gameTile,
        { backgroundColor: colors.surface, borderColor: colors.line, width },
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
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const { visibleGames, visibleTools } = useFeatureAccess();
  const reveals = useRef(Array.from({ length: 4 }, () => new Animated.Value(1))).current;
  const [toolUsage, setToolUsage] = useState<ToolUsageStat[]>([]);
  const availableTools = visibleTools.filter((tool) => tool.status === 'available');
  const availableToolIDs = availableTools.map((tool) => tool.id);
  const commonToolIDs = getCommonToolIds(
    availableToolIDs,
    toolUsage,
    DEFAULT_COMMON_TOOL_IDS,
    HOME_COMMON_TOOL_LIMIT,
  );
  const commonTools = commonToolIDs.flatMap((toolId) => {
    const tool = availableTools.find((candidate) => candidate.id === toolId);
    return tool ? [tool] : [];
  });
  const featuredToolIDs = getFeaturedToolIds(
    availableToolIDs,
    commonToolIDs,
    FEATURED_CANDIDATE_TOOL_IDS,
  );
  const featuredTools = featuredToolIDs.flatMap((toolId) => {
    const tool = availableTools.find((candidate) => candidate.id === toolId);
    return tool ? [tool] : [];
  });
  const playableGames = visibleGames.slice(0, 5);
  const availableToolCount = availableTools.length;
  const contentWidth = Math.min(windowWidth, appLayout.screenMaxWidth) - 32;
  const gameCardWidth = Math.round(contentWidth * GAME_CARD_WIDTH_RATIO);
  const bottomPadding = appLayout.tabBarHeight + insets.bottom + BOTTOM_EXTRA_PADDING;

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
    <MobileScreen
      contentContainerStyle={styles.pageContent}
      scrollContentStyle={{ paddingBottom: bottomPadding }}>
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
        <View style={styles.section}>
          <SectionHeader
            title="常用工具"
            meta="高频能力，一步直达"
            onPress={() => router.push('/tools')}
          />
          <View style={styles.toolGrid}>
            {commonTools.map((tool) => (
              <ToolTile key={tool.id} tool={tool} onPress={() => router.push(tool.route)} />
            ))}
          </View>
        </View>
      </Reveal>

      {featuredTools.length > 0 ? (
        <Reveal progress={reveals[2]}>
          <FeaturedToolCarousel
            tools={featuredTools}
            onToolPress={(tool) => router.push(tool.route)}
          />
        </Reveal>
      ) : null}

      {playableGames.length > 0 ? (
        <Reveal progress={reveals[3]}>
          <View style={styles.section}>
            <SectionHeader
              title="放松一下"
              meta={`${playableGames.length} 款小游戏，随时开一局`}
            />
            <FlatList
              contentContainerStyle={styles.gameListContent}
              data={playableGames}
              horizontal
              ItemSeparatorComponent={() => <View style={styles.gameSeparator} />}
              keyExtractor={(game) => game.id}
              nestedScrollEnabled
              renderItem={({ item }) => (
                <GameTile
                  game={item}
                  width={gameCardWidth}
                  onPress={() => router.push(item.route)}
                />
              )}
              showsHorizontalScrollIndicator={false}
              style={styles.gameList}
            />
          </View>
        </Reveal>
      ) : null}
    </MobileScreen>
  );
}

const styles = StyleSheet.create({
  pageContent: {
    gap: 26,
    paddingTop: 16,
  },
  backgroundPattern: {
    height: 104,
    overflow: 'hidden',
    pointerEvents: 'none',
    position: 'absolute',
    right: -16,
    top: -8,
    width: 170,
  },
  patternBand: {
    borderRadius: 8,
    borderWidth: 1,
    height: 48,
    opacity: 0.5,
    position: 'absolute',
    right: -34,
    top: 6,
    transform: [{ rotate: '-16deg' }],
    width: 184,
  },
  patternBandOffset: {
    right: -58,
    top: 52,
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 48,
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
    marginTop: 4,
  },
  sectionAction: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 5,
    minHeight: 44,
    paddingLeft: 12,
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
    gap: 8,
    minHeight: 96,
    minWidth: 0,
    padding: 10,
  },
  toolIcon: {
    alignItems: 'center',
    borderRadius: 12,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  toolTitle: {
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 18,
  },
  gameList: {
    flexGrow: 0,
  },
  gameListContent: {
    paddingRight: 8,
  },
  gameSeparator: {
    width: GAME_LIST_GAP,
  },
  gameTile: {
    borderRadius: 16,
    borderWidth: 1,
    gap: 6,
    padding: 10,
  },
  gameVisual: {
    alignItems: 'center',
    borderRadius: 12,
    height: 64,
    justifyContent: 'center',
    overflow: 'hidden',
    paddingHorizontal: 6,
  },
  gameArtwork: {
    height: 48,
    width: '100%',
  },
  gameTitle: {
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 18,
  },
  gameGenre: {
    fontSize: 11,
    lineHeight: 15,
    marginTop: 2,
  },
  pressed: {
    opacity: 0.72,
  },
});
