import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { SmartTranslationToolScreen } from '@/features/tools/smart-translation-screen';
import { AiNavigationScreen } from '@/features/tools/ai-navigation-screen';
import { TextToSpeechToolScreen } from '@/features/tools/tts-tool-screen';
import { QrCodeToolScreen } from '@/features/tools/qr-code-tool-screen';
import { ImageCompressorScreen } from '@/features/tools/image-compressor-screen';
import { ResourceSearchScreen } from '@/features/tools/resource-search-screen';
import { LiveStreamCaptureScreen } from '@/features/tools/live-stream-capture-screen';
import { MarketRadarScreen } from '@/features/tools/market-radar-screen';
import { ReleaseEmailAssistantScreen } from '@/features/tools/release-email-assistant-screen';
import { CardScoreScreen } from '@/features/tools/card-score/card-score-screen';
import { ThemedText } from '@/components/themed-text';
import { useFeatureAccess } from '@/features/access/feature-access-provider';
import { getToolById } from '@/mocks/app-data';
import { useAppTheme } from '@/hooks/use-app-theme';
import { MobileScreen } from '@/shared/ui/mobile-screen';
import { PageHeader } from '@/shared/ui/page-header';
import { SurfaceCard } from '@/shared/ui/surface-card';
import { AppLoadingScreen } from '@/shared/ui/app-loading-screen';
import type { ToolId } from '@/types/app';

export function ToolDetailScreen() {
  const params = useLocalSearchParams<{ toolId: ToolId }>();
  const tool = getToolById(params.toolId);
  const router = useRouter();
  const { colors } = useAppTheme();
  const { canAccessTool, status } = useFeatureAccess();

  if (status === 'loading') {
    return <AppLoadingScreen />;
  }

  if (tool && !canAccessTool(tool.id)) {
    return (
      <MobileScreen>
        <PageHeader
          title="暂无访问权限"
          subtitle="此功能入口尚未对当前身份开放，请联系管理员调整权限。"
          rightSlot={
            <Pressable onPress={() => router.back()} style={styles.closeButton}>
              <MaterialCommunityIcons name="arrow-left" size={20} color={colors.text} />
            </Pressable>
          }
        />
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
