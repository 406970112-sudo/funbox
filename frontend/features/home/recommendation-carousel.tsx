import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
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
import { useAuth } from '@/features/auth/auth-provider';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  getHomeRecommendations,
  recordHomeRecommendationEvent,
} from '@/lib/home-recommendation-api';
import type { HomeRecommendationItem } from '@/types/home-recommendation';

import {
  getNextCarouselStep,
  type CarouselDirection,
  type CarouselStep,
} from './featured-carousel-sequence';

const AUTO_PLAY_INTERVAL_MS = 5200;
const CARD_GAP = 10;
const NEXT_CARD_PEEK = 16;
const PAGE_HORIZONTAL_PADDING = 32;

type RecommendationCarouselProps = {
  onPress?: (item: HomeRecommendationItem) => void;
  visibleFeatureIDs?: ReadonlySet<string>;
};

export function RecommendationCarousel({
  onPress,
  visibleFeatureIDs,
}: RecommendationCarouselProps) {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { accessToken } = useAuth();
  const { width: windowWidth } = useWindowDimensions();
  const viewportWidth = Math.min(windowWidth, appLayout.screenMaxWidth) - PAGE_HORIZONTAL_PADDING;
  const cardWidth = Math.max(260, viewportWidth - CARD_GAP - NEXT_CARD_PEEK);
  const cardStep = cardWidth + CARD_GAP;

  const [items, setItems] = useState<HomeRecommendationItem[]>([]);
  const [source, setSource] = useState<'configured' | 'fallback' | ''>('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [reportedView, setReportedView] = useState(false);
  const reportedViewRef = useRef(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [appIsActive, setAppIsActive] = useState(AppState.currentState !== 'background');
  const [reduceMotion, setReduceMotion] = useState(false);
  const activeIndexRef = useRef(0);
  const autoPlayDirectionRef = useRef<CarouselDirection>(1);
  const isInteractingRef = useRef(false);
  const lastInteractionAtRef = useRef(0);
  const listRef = useRef<FlatList<HomeRecommendationItem>>(null);
  const slideKey = items.map((item) => item.featureId).join('|');

  useEffect(() => {
    let active = true;
    setStatus('loading');
    getHomeRecommendations(accessToken)
      .then((response) => {
        if (!active) return;
        const visibleItems = visibleFeatureIDs
          ? response.items.filter((item) => visibleFeatureIDs.has(item.featureId))
          : response.items;
        setItems(visibleItems);
        setSource(response.source);
        setStatus('ready');
      })
      .catch(() => {
        if (!active) return;
        setItems([]);
        setSource('');
        setStatus('error');
      });
    return () => {
      active = false;
    };
  }, [accessToken, visibleFeatureIDs]);

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
    autoPlayDirectionRef.current = 1;
    activeIndexRef.current = 0;
    setActiveIndex(0);
    listRef.current?.scrollToOffset({ animated: false, offset: 0 });
  }, [cardStep, items.length, slideKey]);

  useEffect(() => {
    if (reduceMotion || !appIsActive || items.length < 2) {
      return;
    }
    const interval = setInterval(() => {
      const recentlyInteracted =
        Date.now() - lastInteractionAtRef.current < AUTO_PLAY_INTERVAL_MS;
      if (isInteractingRef.current || recentlyInteracted) {
        return;
      }
      const nextStep: CarouselStep = getNextCarouselStep(
        activeIndexRef.current,
        autoPlayDirectionRef.current,
        items.length,
      );
      autoPlayDirectionRef.current = nextStep.direction;
      activeIndexRef.current = nextStep.index;
      setActiveIndex(nextStep.index);
      listRef.current?.scrollToOffset({
        animated: !reduceMotion,
        offset: nextStep.index * cardStep,
      });
    }, AUTO_PLAY_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [appIsActive, cardStep, items.length, reduceMotion]);

  const reportView = useCallback(() => {
    if (reportedViewRef.current || !accessToken || items.length === 0) return;
    reportedViewRef.current = true;
    setReportedView(true);
    void recordHomeRecommendationEvent(accessToken, {
      eventType: 'view',
      slotId: items[0].slotId,
    }).catch(() => {
      reportedViewRef.current = false;
      setReportedView(false);
    });
  }, [accessToken, items]);

  useEffect(() => {
    if (status === 'ready' && items.length > 0 && !reportedView) {
      reportView();
    }
  }, [items, reportedView, reportView, status]);

  function handlePress(item: HomeRecommendationItem) {
    if (onPress) {
      onPress(item);
      return;
    }
    if (accessToken) {
      void recordHomeRecommendationEvent(accessToken, {
        eventType: 'click',
        slotId: item.slotId,
      }).catch(() => undefined);
    }
    if (item.route) {
      router.push(item.route as never);
    }
  }

  function setCurrentSlide(index: number, animated: boolean) {
    const normalizedIndex = Math.max(0, Math.min(index, items.length - 1));
    lastInteractionAtRef.current = Date.now();
    if (normalizedIndex === 0) {
      autoPlayDirectionRef.current = 1;
    } else if (normalizedIndex === items.length - 1) {
      autoPlayDirectionRef.current = -1;
    }
    activeIndexRef.current = normalizedIndex;
    setActiveIndex(normalizedIndex);
    listRef.current?.scrollToOffset({
      animated: animated && !reduceMotion,
      offset: normalizedIndex * cardStep,
    });
  }

  function updateIndexFromScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const normalizedIndex = Math.max(
      0,
      Math.min(items.length - 1, Math.round(event.nativeEvent.contentOffset.x / cardStep)),
    );
    activeIndexRef.current = normalizedIndex;
    setActiveIndex(normalizedIndex);
    isInteractingRef.current = false;
  }

  if (status === 'loading') {
    return (
      <View style={styles.loadingState}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (status === 'error' || items.length === 0) {
    return null;
  }

  return (
    <View style={styles.carouselSection}>
      <View style={styles.carouselHeader}>
        <ThemedText style={styles.carouselTitle}>今日推荐</ThemedText>
        <ThemedText style={[styles.carouselCount, { color: colors.mutedText }]}>
          {String(Math.min(activeIndex + 1, items.length)).padStart(2, '0')} /{' '}
          {String(items.length).padStart(2, '0')}
        </ThemedText>
      </View>

      <FlatList
        ref={listRef}
        accessibilityLabel="今日推荐轮播"
        contentContainerStyle={styles.carouselContent}
        data={items}
        decelerationRate="fast"
        disableIntervalMomentum
        extraData={cardWidth}
        getItemLayout={(_, index) => ({
          index,
          length: cardStep,
          offset: cardStep * index,
        })}
        horizontal
        initialScrollIndex={0}
        keyExtractor={(item) => item.slotId || item.featureId}
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
                marginRight: index === items.length - 1 ? 0 : CARD_GAP,
                width: cardWidth,
              },
            ]}>
            <RecommendationCard
              item={item}
              onPress={() => handlePress(item)}
              width={cardWidth}
            />
          </View>
        )}
        showsHorizontalScrollIndicator={false}
        snapToAlignment="start"
        snapToInterval={cardStep}
        testID="home-recommendation-carousel"
      />

      {source === 'fallback' ? (
        <View style={styles.fallbackNote}>
          <ThemedText style={[styles.fallbackText, { color: colors.mutedText }]}>
            未配置推荐位，展示默认推荐
          </ThemedText>
        </View>
      ) : null}

      {items.length > 1 ? (
        <View accessibilityLabel="今日推荐轮播分页" style={styles.pagination}>
          {items.map((item, index) => {
            const selected = index === activeIndex;
            return (
              <Pressable
                key={item.slotId || item.featureId}
                accessibilityLabel={`显示第 ${index + 1} 个今日推荐：${item.name}`}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                hitSlop={8}
                onPress={() => setCurrentSlide(index, true)}
                style={styles.paginationButton}
                testID={`home-recommendation-dot-${index + 1}`}>
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
      ) : null}
    </View>
  );
}

function RecommendationCard({
  item,
  onPress,
  width,
}: {
  item: HomeRecommendationItem;
  onPress: () => void;
  width: number;
}) {
  return (
    <Pressable
      accessibilityHint={`打开${item.name}`}
      accessibilityLabel={`今日推荐：${item.name}，${item.description}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.featureCard,
        { backgroundColor: item.accentColor || '#123a33', width },
        pressed ? styles.cardPressed : null,
      ]}
      testID={`home-recommendation-card-${item.featureId}`}>
      <View style={styles.featureCopy}>
        <View style={styles.featureTypeRow}>
          <MaterialCommunityIcons
            name={item.icon}
            size={17}
            color="rgba(255, 255, 255, 0.92)"
          />
          <ThemedText style={styles.featureType}>
            {item.kind === 'game' ? '游戏' : '工具'}
          </ThemedText>
        </View>
        <ThemedText numberOfLines={1} style={styles.featureTitle}>
          {item.title}
        </ThemedText>
        <ThemedText numberOfLines={2} style={styles.featureDescription}>
          {item.description}
        </ThemedText>
        <View style={styles.featureAction}>
          <ThemedText style={styles.featureActionText}>{item.ctaLabel}</ThemedText>
          <MaterialCommunityIcons name="arrow-top-right" size={18} color="#173a35" />
        </View>
      </View>
      <View style={styles.artworkFrame}>
        <MaterialCommunityIcons name={item.icon} size={40} color="rgba(255, 255, 255, 0.9)" />
      </View>
    </Pressable>
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
    fontSize: 19,
    fontWeight: '900',
    lineHeight: 25,
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
    height: 172,
  },
  featureCard: {
    borderRadius: 21,
    height: 172,
    overflow: 'hidden',
    padding: 18,
    position: 'relative',
  },
  cardPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.99 }],
  },
  featureCopy: {
    maxWidth: '68%',
  },
  featureTypeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  featureType: {
    color: 'rgba(255, 255, 255, 0.86)',
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 17,
  },
  featureTitle: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '900',
    lineHeight: 28,
    marginTop: 12,
  },
  featureDescription: {
    color: 'rgba(255, 255, 255, 0.72)',
    fontSize: 11,
    lineHeight: 17,
    marginTop: 5,
  },
  featureAction: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#c9f36a',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 6,
    marginTop: 14,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  featureActionText: {
    color: '#16332c',
    fontSize: 12,
    fontWeight: '800',
  },
  artworkFrame: {
    alignItems: 'center',
    borderColor: 'rgba(201, 243, 106, 0.35)',
    borderRadius: 18,
    borderWidth: 1,
    height: 86,
    justifyContent: 'center',
    position: 'absolute',
    right: 18,
    top: 43,
    width: 86,
  },
  fallbackNote: {
    alignItems: 'center',
    paddingTop: 4,
  },
  fallbackText: {
    fontSize: 10,
    fontWeight: '700',
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
  loadingState: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 96,
  },
});
