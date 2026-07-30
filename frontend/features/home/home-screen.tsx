import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter } from 'expo-router';
import { type PropsWithChildren, useRef } from 'react';
import {
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useAppTheme } from '@/hooks/use-app-theme';
import { appTools, popularGames } from '@/mocks/app-data';
import { MobileScreen } from '@/shared/ui/mobile-screen';
import type { AppTool, GameItem } from '@/types/app';

const HERO_TOOL_ID = 'text-to-speech';
const HOME_TOOL_LIMIT = 6;
const HOME_TOOL_EXCLUSIONS = new Set<AppTool['id']>([
  'release-email-assistant',
  'live-stream-capture',
]);
const WAVEFORM_HEIGHTS = [18, 34, 48, 28, 58, 42, 66, 38, 52, 26, 44, 20];

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

function HeroTool({ tool, onPress }: { tool: AppTool; onPress: () => void }) {
  const { colorScheme } = useAppTheme();
  const backgroundColor = colorScheme === 'dark' ? '#173a35' : '#183f3a';

  return (
    <Pressable
      accessibilityHint={`打开${tool.name}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.heroCard,
        { backgroundColor },
        pressed && styles.heroPressed,
      ]}>
      <View style={styles.heroTexture}>
        <View style={styles.heroTextureLine} />
        <View style={[styles.heroTextureLine, styles.heroTextureLineMiddle]} />
        <View style={[styles.heroTextureLine, styles.heroTextureLineBottom]} />
      </View>

      <View style={styles.heroCopy}>
        <View style={styles.heroToolName}>
          <MaterialCommunityIcons name={tool.icon} size={18} color="#c9f36a" />
          <ThemedText style={styles.heroToolNameText}>{tool.name}</ThemedText>
        </View>
        <ThemedText style={styles.heroTitle}>把灵感{`\n`}变成声音</ThemedText>
        <ThemedText style={styles.heroDescription}>
          输入文字，选择音色，即刻生成可试听的语音
        </ThemedText>
        <View style={styles.heroAction}>
          <MaterialCommunityIcons name="arrow-top-right" size={21} color="#173a35" />
        </View>
      </View>

      <View style={styles.waveform}>
        {WAVEFORM_HEIGHTS.map((height, index) => (
          <View
            key={`${height}-${index}`}
            style={[
              styles.waveformBar,
              {
                backgroundColor: index === 6 ? '#c9f36a' : 'rgba(255, 255, 255, 0.34)',
                height,
              },
            ]}
          />
        ))}
      </View>
    </Pressable>
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
  const icon =
    game.id === 'gomoku' ? 'checkerboard' : game.id === 'tetris' ? 'view-grid-outline' : 'snake';

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
        <View style={[styles.gameIcon, { backgroundColor: game.accentColor }]}>
          <MaterialCommunityIcons name={icon} size={26} color="#ffffff" />
        </View>
        <MaterialCommunityIcons name="play-circle" size={24} color={game.accentColor} />
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
  const reveals = useRef(Array.from({ length: 4 }, () => new Animated.Value(1))).current;
  const heroTool = appTools.find((tool) => tool.id === HERO_TOOL_ID);
  const quickTools = appTools
    .filter((tool) => tool.status === 'available' && !HOME_TOOL_EXCLUSIONS.has(tool.id))
    .slice(0, HOME_TOOL_LIMIT);
  const playableGames = popularGames.filter((game) => game.status === 'playable').slice(0, 3);
  const availableToolCount = appTools.filter((tool) => tool.status === 'available').length;

  if (!heroTool) {
    return null;
  }

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
        <HeroTool tool={heroTool} onPress={() => router.push(heroTool.route)} />
      </Reveal>

      <Reveal progress={reveals[2]}>
        <View style={styles.section}>
          <SectionHeader
            title="常用工具"
            meta="高频能力，一步直达"
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
          <SectionHeader title="放松一下" meta="三款小游戏，随时开一局" />
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
    gap: 22,
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
  heroCard: {
    borderRadius: 24,
    minHeight: 228,
    overflow: 'hidden',
    padding: 20,
    position: 'relative',
  },
  heroPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.99 }],
  },
  heroTexture: {
    bottom: -12,
    height: 120,
    opacity: 0.42,
    position: 'absolute',
    pointerEvents: 'none',
    right: -28,
    transform: [{ rotate: '-12deg' }],
    width: 180,
  },
  heroTextureLine: {
    borderColor: 'rgba(255, 255, 255, 0.22)',
    borderRadius: 8,
    borderWidth: 1,
    height: 32,
    position: 'absolute',
    right: 0,
    top: 0,
    width: 170,
  },
  heroTextureLineMiddle: {
    right: 18,
    top: 38,
  },
  heroTextureLineBottom: {
    right: 36,
    top: 76,
  },
  heroCopy: {
    alignItems: 'flex-start',
    maxWidth: 230,
    zIndex: 2,
  },
  heroToolName: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
    marginBottom: 18,
  },
  heroToolNameText: {
    color: '#e8f4ef',
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 18,
  },
  heroTitle: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '900',
    lineHeight: 34,
  },
  heroDescription: {
    color: '#b9cec7',
    fontSize: 12,
    lineHeight: 19,
    marginTop: 8,
    maxWidth: 205,
  },
  heroAction: {
    alignItems: 'center',
    backgroundColor: '#c9f36a',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    marginTop: 18,
    width: 36,
  },
  waveform: {
    alignItems: 'center',
    bottom: 64,
    flexDirection: 'row',
    gap: 5,
    height: 72,
    position: 'absolute',
    pointerEvents: 'none',
    right: 17,
  },
  waveformBar: {
    borderRadius: 3,
    width: 4,
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
    minHeight: 124,
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
    flexDirection: 'row',
    height: 58,
    justifyContent: 'space-between',
    marginBottom: 10,
    paddingHorizontal: 10,
  },
  gameIcon: {
    alignItems: 'center',
    borderRadius: 11,
    height: 40,
    justifyContent: 'center',
    width: 40,
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
