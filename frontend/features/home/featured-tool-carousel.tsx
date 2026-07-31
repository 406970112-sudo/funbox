import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  AppState,
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { appLayout } from '@/constants/app-theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import { getToolById } from '@/mocks/app-data';
import type { AppIconName, AppTool, ToolId } from '@/types/app';

const AUTO_PLAY_INTERVAL_MS = 5200;
const CARD_GAP = 10;
const NEXT_CARD_PEEK = 30;
const PAGE_HORIZONTAL_PADDING = 32;
const WAVEFORM_HEIGHTS = [20, 34, 50, 29, 66, 39, 54, 25];

type ArtworkKind = 'waveform' | 'image' | 'qr' | 'translate';

type FeaturedSlideConfig = {
  toolId: ToolId;
  title: string;
  description: string;
  backgroundColor: string;
  artwork: ArtworkKind;
  artworkIcon: AppIconName;
};

type FeaturedSlide = FeaturedSlideConfig & {
  tool: AppTool;
};

type FeaturedToolCarouselProps = {
  onToolPress: (tool: AppTool) => void;
  tools: AppTool[];
};

const FEATURED_SLIDE_CONFIGS: FeaturedSlideConfig[] = [
  {
    toolId: 'text-to-speech',
    title: '把灵感\n变成声音',
    description: '选择音色，即刻生成可试听语音',
    backgroundColor: '#17463d',
    artwork: 'waveform',
    artworkIcon: 'waveform',
  },
  {
    toolId: 'image-compressor',
    title: '体积更小\n画质依旧',
    description: '批量压缩 JPG、PNG 与 WebP',
    backgroundColor: '#335bce',
    artwork: 'image',
    artworkIcon: 'image-size-select-small',
  },
  {
    toolId: 'qr-code',
    title: '一码直达\n分享更快',
    description: '链接、文本与 Wi-Fi 均可生成',
    backgroundColor: '#e96d4d',
    artwork: 'qr',
    artworkIcon: 'qrcode',
  },
  {
    toolId: 'smart-translation',
    title: '自然表达\n不止直译',
    description: '按语境与风格生成多版本译文',
    backgroundColor: '#23705f',
    artwork: 'translate',
    artworkIcon: 'translate',
  },
];

const FEATURED_SLIDES = FEATURED_SLIDE_CONFIGS.flatMap<FeaturedSlide>((config) => {
  const tool = getToolById(config.toolId);
  return tool ? [{ ...config, tool }] : [];
});

function FeatureArtwork({ kind, icon }: { kind: ArtworkKind; icon: AppIconName }) {
  if (kind === 'waveform') {
    return (
      <View style={styles.waveform}>
        {WAVEFORM_HEIGHTS.map((height, index) => (
          <View
            key={`${height}-${index}`}
            style={[
              styles.waveformBar,
              {
                backgroundColor: index === 4 ? '#c9f36a' : 'rgba(255, 255, 255, 0.3)',
                height,
              },
            ]}
          />
        ))}
      </View>
    );
  }

  return (
    <View
      style={[
        styles.artworkFrame,
        kind === 'image' ? styles.imageArtworkFrame : null,
      ]}>
      <MaterialCommunityIcons name={icon} size={66} color="rgba(255, 255, 255, 0.34)" />
    </View>
  );
}

function FeaturedCard({
  slide,
  width,
  onPress,
}: {
  slide: FeaturedSlide;
  width: number;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityHint={`打开${slide.tool.name}`}
      accessibilityLabel={`${slide.tool.name}，${slide.title.replace('\n', '，')}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.featureCard,
        { backgroundColor: slide.backgroundColor, width },
        pressed ? styles.cardPressed : null,
      ]}
      testID={`featured-card-${slide.toolId}`}>
      <View style={styles.cardTexture}>
        <View style={styles.textureLine} />
        <View style={[styles.textureLine, styles.textureLineMiddle]} />
        <View style={[styles.textureLine, styles.textureLineBottom]} />
      </View>

      <View style={styles.featureCopy}>
        <View style={styles.featureTypeRow}>
          <MaterialCommunityIcons
            name={slide.tool.icon}
            size={17}
            color={slide.artwork === 'waveform' ? '#c9f36a' : 'rgba(255, 255, 255, 0.86)'}
          />
          <ThemedText style={styles.featureType}>{slide.tool.name}</ThemedText>
        </View>
        <ThemedText numberOfLines={2} style={styles.featureTitle}>
          {slide.title}
        </ThemedText>
        <ThemedText numberOfLines={2} style={styles.featureDescription}>
          {slide.description}
        </ThemedText>
      </View>

      <FeatureArtwork kind={slide.artwork} icon={slide.artworkIcon} />

      <View style={styles.featureAction}>
        <MaterialCommunityIcons name="arrow-top-right" size={20} color="#173a35" />
      </View>
    </Pressable>
  );
}

export function FeaturedToolCarousel({ onToolPress, tools }: FeaturedToolCarouselProps) {
  const { colors } = useAppTheme();
  const { width: windowWidth } = useWindowDimensions();
  const viewportWidth = Math.min(windowWidth, appLayout.screenMaxWidth) - PAGE_HORIZONTAL_PADDING;
  const cardWidth = Math.max(260, viewportWidth - CARD_GAP - NEXT_CARD_PEEK);
  const cardStep = cardWidth + CARD_GAP;
  const listRef = useRef<FlatList<FeaturedSlide>>(null);
  const activeIndexRef = useRef(0);
  const isInteractingRef = useRef(false);
  const lastInteractionAtRef = useRef(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [appIsActive, setAppIsActive] = useState(AppState.currentState !== 'background');
  const [reduceMotion, setReduceMotion] = useState(false);
  const visibleToolIDs = new Set(tools.map((tool) => tool.id));
  const featuredSlides = FEATURED_SLIDES.filter((slide) => visibleToolIDs.has(slide.toolId));

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    );

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setAppIsActive(state === 'active');
    });

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    listRef.current?.scrollToOffset({
      animated: false,
      offset: activeIndexRef.current * cardStep,
    });
  }, [cardStep]);

  useEffect(() => {
    if (reduceMotion || !appIsActive || featuredSlides.length < 2) {
      return;
    }

    const interval = setInterval(() => {
      const recentlyInteracted = Date.now() - lastInteractionAtRef.current < AUTO_PLAY_INTERVAL_MS;
      if (isInteractingRef.current || recentlyInteracted) {
        return;
      }

      const nextIndex = (activeIndexRef.current + 1) % featuredSlides.length;
      activeIndexRef.current = nextIndex;
      setActiveIndex(nextIndex);
      listRef.current?.scrollToOffset({
        animated: true,
        offset: nextIndex * cardStep,
      });
    }, AUTO_PLAY_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [appIsActive, cardStep, featuredSlides.length, reduceMotion]);

  function setCurrentSlide(index: number, animated: boolean) {
    const normalizedIndex = Math.max(0, Math.min(index, featuredSlides.length - 1));
    lastInteractionAtRef.current = Date.now();
    activeIndexRef.current = normalizedIndex;
    setActiveIndex(normalizedIndex);
    listRef.current?.scrollToOffset({
      animated: animated && !reduceMotion,
      offset: normalizedIndex * cardStep,
    });
  }

  function updateIndexFromScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const nextIndex = Math.round(event.nativeEvent.contentOffset.x / cardStep);
    const normalizedIndex = Math.max(0, Math.min(nextIndex, featuredSlides.length - 1));
    activeIndexRef.current = normalizedIndex;
    setActiveIndex(normalizedIndex);
    isInteractingRef.current = false;
  }

  if (featuredSlides.length === 0) {
    return null;
  }

  return (
    <View style={styles.carouselSection}>
      <View style={styles.carouselHeader}>
        <ThemedText style={styles.carouselTitle}>精选功能</ThemedText>
        <ThemedText style={[styles.carouselCount, { color: colors.mutedText }]}>
          {String(Math.min(activeIndex + 1, featuredSlides.length)).padStart(2, '0')} /{' '}
          {String(featuredSlides.length).padStart(2, '0')}
        </ThemedText>
      </View>

      <FlatList
        ref={listRef}
        accessibilityLabel="精选功能轮播"
        contentContainerStyle={styles.carouselContent}
        data={featuredSlides}
        decelerationRate="fast"
        disableIntervalMomentum
        extraData={cardWidth}
        getItemLayout={(_, index) => ({
          index,
          length: cardStep,
          offset: cardStep * index,
        })}
        horizontal
        keyExtractor={(slide) => slide.toolId}
        nestedScrollEnabled
        onMomentumScrollBegin={() => {
          isInteractingRef.current = true;
        }}
        onMomentumScrollEnd={updateIndexFromScroll}
        onScrollBeginDrag={() => {
          isInteractingRef.current = true;
          lastInteractionAtRef.current = Date.now();
        }}
        onScrollEndDrag={() => {
          isInteractingRef.current = false;
        }}
        renderItem={({ item, index }) => (
          <View
            style={[
              styles.cardSlot,
              {
                marginRight: index === featuredSlides.length - 1 ? 0 : CARD_GAP,
                width: cardWidth,
              },
            ]}>
            <FeaturedCard
              slide={item}
              width={cardWidth}
              onPress={() => onToolPress(item.tool)}
            />
          </View>
        )}
        showsHorizontalScrollIndicator={false}
        snapToAlignment="start"
        snapToInterval={cardStep}
        testID="featured-carousel"
      />

      <View accessibilityLabel="轮播分页" style={styles.pagination}>
        {featuredSlides.map((slide, index) => {
          const selected = index === activeIndex;
          return (
            <Pressable
              key={slide.toolId}
              accessibilityLabel={`显示第 ${index + 1} 个精选功能：${slide.tool.name}`}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              hitSlop={5}
              onPress={() => setCurrentSlide(index, true)}
              style={styles.paginationButton}
              testID={`featured-carousel-dot-${index + 1}`}>
              <View
                style={[
                  styles.paginationDot,
                  { backgroundColor: selected ? '#1f4e43' : colors.line },
                  selected ? styles.paginationDotActive : null,
                ]}
              />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  carouselSection: {
    gap: 0,
  },
  carouselHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  carouselTitle: {
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 18,
  },
  carouselCount: {
    fontSize: 10,
    fontWeight: '800',
    lineHeight: 16,
  },
  carouselContent: {
    paddingRight: NEXT_CARD_PEEK + CARD_GAP,
  },
  cardSlot: {
    height: 190,
  },
  featureCard: {
    borderRadius: 21,
    height: 190,
    overflow: 'hidden',
    padding: 18,
    position: 'relative',
  },
  cardPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.99 }],
  },
  cardTexture: {
    bottom: -4,
    height: 110,
    opacity: 0.38,
    pointerEvents: 'none',
    position: 'absolute',
    right: -52,
    transform: [{ rotate: '-12deg' }],
    width: 184,
  },
  textureLine: {
    borderColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 8,
    borderWidth: 1,
    height: 30,
    position: 'absolute',
    right: 0,
    top: 0,
    width: 174,
  },
  textureLineMiddle: {
    right: 18,
    top: 37,
  },
  textureLineBottom: {
    right: 36,
    top: 74,
  },
  featureCopy: {
    alignItems: 'flex-start',
    maxWidth: '68%',
    zIndex: 2,
  },
  featureTypeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
  },
  featureType: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 17,
  },
  featureTitle: {
    color: '#ffffff',
    fontSize: 27,
    fontWeight: '900',
    lineHeight: 31,
    marginTop: 16,
  },
  featureDescription: {
    color: 'rgba(255, 255, 255, 0.68)',
    fontSize: 11,
    lineHeight: 17,
    marginTop: 7,
  },
  featureAction: {
    alignItems: 'center',
    backgroundColor: '#c9f36a',
    borderRadius: 18,
    bottom: 18,
    height: 36,
    justifyContent: 'center',
    pointerEvents: 'none',
    position: 'absolute',
    right: 18,
    width: 36,
    zIndex: 3,
  },
  waveform: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 5,
    height: 72,
    pointerEvents: 'none',
    position: 'absolute',
    right: 19,
    top: 49,
  },
  waveformBar: {
    borderRadius: 3,
    width: 4,
  },
  artworkFrame: {
    alignItems: 'center',
    borderColor: 'rgba(255, 255, 255, 0.25)',
    borderRadius: 15,
    borderWidth: 2,
    height: 86,
    justifyContent: 'center',
    pointerEvents: 'none',
    position: 'absolute',
    right: 22,
    top: 40,
    width: 92,
  },
  imageArtworkFrame: {
    transform: [{ rotate: '4deg' }],
  },
  pagination: {
    alignItems: 'center',
    flexDirection: 'row',
    height: 28,
    justifyContent: 'center',
  },
  paginationButton: {
    alignItems: 'center',
    height: 20,
    justifyContent: 'center',
    width: 14,
  },
  paginationDot: {
    borderRadius: 3,
    height: 5,
    width: 5,
  },
  paginationDotActive: {
    width: 19,
  },
});
