import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { SmartTranslationToolScreen } from '@/features/tools/smart-translation-screen';
import { ProductRecommendationScreen } from '@/features/tools/product-recommendation-screen';
import { FoodRecommendationScreen } from '@/features/tools/food-recommendation-screen';
import { CookingGuideScreen } from '@/features/tools/cooking-guide-screen';
import { PlantIdentifierScreen } from '@/features/tools/plant-identifier-screen';
import { AiNavigationScreen } from '@/features/tools/ai-navigation-screen';
import { TextToSpeechToolScreen } from '@/features/tools/tts-tool-screen';
import { QrCodeToolScreen } from '@/features/tools/qr-code-tool-screen';
import { ImageCompressorScreen } from '@/features/tools/image-compressor-screen';
import { HotNewsScreen } from '@/features/tools/hot-news-screen';
import { ResourceSearchScreen } from '@/features/tools/resource-search-screen';
import { LiveStreamCaptureScreen } from '@/features/tools/live-stream-capture-screen';
import { MarketRadarScreen } from '@/features/tools/market-radar-screen';
import { DoubleColorBallHubScreen } from '@/features/tools/double-color-ball-hub-screen';
import { DoubleColorBallHistoryScreen } from '@/features/tools/double-color-ball-history-screen';
import { DoubleColorBallLabScreen } from '@/features/tools/double-color-ball-lab-screen';
import { DoubleColorBallLabClassicScreen } from '@/features/tools/double-color-ball-lab-classic-screen';
import { DoubleColorBallScreen } from '@/features/tools/double-color-ball-screen';
import { ReleaseEmailAssistantScreen } from '@/features/tools/release-email-assistant-screen';
import { CardScoreScreen } from '@/features/tools/card-score/card-score-screen';
import { JsonWorkbenchScreen } from '@/features/tools/json-workbench-screen';
import { FocusScreen } from '@/features/focus/focus-screen';
import { DiaryScreen } from '@/features/diary/diary-screen';
import { MomentsFeedScreen } from '@/features/moments/moments-feed-screen';
import { ReadingHomeScreen } from '@/features/reading/reading-home-screen';
import { useAuth } from '@/features/auth/auth-provider';
import { ThemedText } from '@/components/themed-text';
import { useFeatureAccess } from '@/features/access/feature-access-provider';
import { getToolById, initialToolRoles } from '@/mocks/app-data';
import { identityPresentation } from '@/lib/identity';
import { useAppTheme } from '@/hooks/use-app-theme';
import { MobileScreen } from '@/shared/ui/mobile-screen';
import { PageHeader } from '@/shared/ui/page-header';
import { SurfaceCard } from '@/shared/ui/surface-card';
import { AppLoadingScreen } from '@/shared/ui/app-loading-screen';
import { recordStoredRecentUsage } from '@/lib/recent-usage-storage';
import { recordStoredToolUsage } from '@/lib/tool-usage-storage';
import type { ToolId } from '@/types/app';

export function ToolDetailScreen() {
  const params = useLocalSearchParams<{ toolId: ToolId }>();
  const tool = getToolById(params.toolId);
  const router = useRouter();
  const { colors } = useAppTheme();
  const { status: authStatus, user } = useAuth();
  const { canAccessTool, status } = useFeatureAccess();
  const toolId = tool?.id;
  const toolStatus = tool?.status;
  const toolIsAccessible = toolId ? canAccessTool(toolId) : false;
  const recordedToolIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (
      !toolId ||
      toolStatus !== 'available' ||
      !toolIsAccessible ||
      recordedToolIdRef.current === toolId
    ) return;

    recordedToolIdRef.current = toolId;
    const usedAt = Date.now();

    void recordStoredRecentUsage({
      itemId: toolId,
      kind: 'tool',
      usedAt,
    });
    void recordStoredToolUsage(toolId, usedAt);
  }, [toolId, toolIsAccessible, toolStatus]);

  if (status === 'loading') {
    return <AppLoadingScreen />;
  }

  if (tool && !canAccessTool(tool.id)) {
    const requiredMemberRoles = (initialToolRoles.get(tool.id) ?? []).filter(
      (role) => role === 'vip' || role === 'svip',
    );
    const requiredLabel =
      requiredMemberRoles.length > 0
        ? requiredMemberRoles.map((role) => identityPresentation(role).label).join(' / ')
        : '管理员';
    return (
      <MobileScreen>
        <PageHeader
          title="暂无访问权限"
          subtitle="此功能需要会员身份，升级后即可解锁。"
          rightSlot={
            <Pressable onPress={() => router.back()} style={styles.closeButton}>
              <MaterialCommunityIcons name="arrow-left" size={20} color={colors.text} />
            </Pressable>
          }
        />
        <View
          style={[
            styles.noticeCard,
            { backgroundColor: colors.surface, borderColor: colors.line },
          ]}>
          <View style={[styles.noticeIcon, { backgroundColor: colors.primarySoft }]}>
            <MaterialCommunityIcons name="lock-outline" size={26} color={colors.primary} />
          </View>
          <ThemedText style={styles.noticeTitle}>该功能需要{requiredLabel}身份</ThemedText>
          <ThemedText style={[styles.noticeBody, { color: colors.mutedText }]}>
            {authStatus === 'authenticated'
              ? `当前身份为${identityPresentation(user?.role ?? 'normal').label}，升级后即可使用此功能。`
              : '登录并开通会员后即可使用此功能。'}
          </ThemedText>
          {requiredMemberRoles.length > 0 ? (
            <View style={styles.noticeRoleRow}>
              {requiredMemberRoles.map((role) => {
                const item = identityPresentation(role);
                return (
                  <View
                    key={role}
                    style={[
                      styles.noticeRolePill,
                      { backgroundColor: `${item.color}18`, borderColor: `${item.color}55` },
                    ]}>
                    <MaterialCommunityIcons name={item.icon} size={12} color={item.color} />
                    <ThemedText style={[styles.noticeRoleText, { color: item.color }]}>
                      {item.label}
                    </ThemedText>
                  </View>
                );
              })}
            </View>
          ) : null}
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push(authStatus === 'authenticated' ? '/profile/membership' : '/auth')}
            style={[styles.noticeButton, { backgroundColor: colors.hero }]}>
            <ThemedText style={styles.noticeButtonText}>
              {authStatus === 'authenticated' ? '查看权益' : '登录 / 注册'}
            </ThemedText>
            <MaterialCommunityIcons name="arrow-right" size={17} color="#c9f36a" />
          </Pressable>
        </View>
      </MobileScreen>
    );
  }

  if (tool?.id === 'text-to-speech') {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <TextToSpeechToolScreen />
      </>
    );
  }

  if (tool?.id === 'qr-code') {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <QrCodeToolScreen />
      </>
    );
  }

  if (tool?.id === 'image-compressor') {
    return <ImageCompressorScreen />;
  }

  if (tool?.id === 'resource-search') {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <ResourceSearchScreen />
      </>
    );
  }

  if (tool?.id === 'hot-news') {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <HotNewsScreen />
      </>
    );
  }

  if (tool?.id === 'ai-navigation') {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <AiNavigationScreen />
      </>
    );
  }

  if (tool?.id === 'release-email-assistant') {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <ReleaseEmailAssistantScreen />
      </>
    );
  }

  if (tool?.id === 'smart-translation') {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <SmartTranslationToolScreen />
      </>
    );
  }

  if (tool?.id === 'moments') {
    return <MomentsFeedScreen />;
  }

  if (tool?.id === 'product-recommendation') {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <ProductRecommendationScreen />
      </>
    );
  }

  if (tool?.id === 'food-recommendation') {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <FoodRecommendationScreen />
      </>
    );
  }

  if (tool?.id === 'cooking-guide') {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <CookingGuideScreen />
      </>
    );
  }

  if (tool?.id === 'plant-identifier') {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <PlantIdentifierScreen />
      </>
    );
  }

  if (tool?.id === 'live-stream-capture') {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <LiveStreamCaptureScreen />
      </>
    );
  }

  if (tool?.id === 'market-radar') {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <MarketRadarScreen />
      </>
    );
  }

  if (tool?.id === 'card-score') {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <CardScoreScreen />
      </>
    );
  }

  if (tool?.id === 'focus-plan') {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <FocusScreen />
      </>
    );
  }

  if (tool?.id === 'diary') {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <DiaryScreen />
      </>
    );
  }

  if (tool?.id === 'json-workbench') {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <JsonWorkbenchScreen />
      </>
    );
  }

  if (tool?.id === 'double-color-ball') {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <DoubleColorBallScreen />
      </>
    );
  }

  if (tool?.id === 'double-color-ball-hub') {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <DoubleColorBallHubScreen />
      </>
    );
  }

  if (tool?.id === 'double-color-ball-history') {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <DoubleColorBallHistoryScreen />
      </>
    );
  }

  if (tool?.id === 'double-color-ball-lab') {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <DoubleColorBallLabScreen />
      </>
    );
  }

  if (tool?.id === 'double-color-ball-lab-classic') {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <DoubleColorBallLabClassicScreen />
      </>
    );
  }

  if (tool?.id === 'free-reading') {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <ReadingHomeScreen />
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <MobileScreen>
        <PageHeader
          eyebrow="Tool Detail"
          title={tool?.name ?? '未找到工具'}
          subtitle={
            tool
              ? '页面骨架已经接好，后续只需要按相同模式继续补表单、接口和状态管理。'
              : '当前路由没有匹配到对应工具，请从工具页重新进入。'
          }
          rightSlot={
            <Pressable onPress={() => router.back()} style={styles.closeButton}>
              <MaterialCommunityIcons name="arrow-left" size={20} color={colors.text} />
            </Pressable>
          }
        />

        <SurfaceCard style={styles.placeholderCard}>
          <ThemedText style={styles.placeholderTitle}>
            {tool ? `${tool.name} 正在接入中` : '工具不存在'}
          </ThemedText>
          <ThemedText style={[styles.placeholderBody, { color: colors.mutedText }]}>
            {tool
              ? `${tool.description} 当前先保留详情路由、视觉骨架和扩展位，后续可以直接补业务能力。`
              : '请从底部导航进入工具页，再选择一个可用模块。'}
          </ThemedText>
          {tool ? (
            <View style={[styles.statusChip, { backgroundColor: colors.surfaceMuted }]}>
              <ThemedText style={{ color: tool.accentColor }}>{tool.status}</ThemedText>
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
  noticeBody: {
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  noticeButton: {
    alignItems: 'center',
    alignSelf: 'stretch',
    borderRadius: 14,
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 14,
  },
  noticeButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  noticeCard: {
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1,
    gap: 12,
    padding: 20,
  },
  noticeIcon: {
    alignItems: 'center',
    borderRadius: 16,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  noticeRolePill: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 5,
    minHeight: 28,
    paddingHorizontal: 10,
  },
  noticeRoleRow: {
    flexDirection: 'row',
    gap: 8,
  },
  noticeRoleText: {
    fontSize: 11,
    fontWeight: '900',
  },
  noticeTitle: {
    fontSize: 18,
    fontWeight: '900',
  },
  placeholderCard: {
    gap: 12,
    padding: 18,
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
});
