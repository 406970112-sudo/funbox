import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useAppTheme } from '@/hooks/use-app-theme';
import { MobileScreen } from '@/shared/ui/mobile-screen';

export function HomeScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();

  return (
    <MobileScreen contentContainerStyle={styles.pageContent}>
      <View pointerEvents="none" style={styles.backgroundLayer}>
        <View style={[styles.backgroundOrbLarge, { backgroundColor: '#d8e4ff' }]} />
        <View style={[styles.backgroundOrbSmall, { backgroundColor: '#ffd8e8' }]} />
      </View>

      <View style={styles.topBar}>
        <View>
          <ThemedText style={styles.brandTitle}>FunBox</ThemedText>
          <ThemedText style={[styles.brandSubtitle, { color: colors.mutedText }]}>
            文字转语音工具
          </ThemedText>
        </View>
      </View>

      <Pressable
        onPress={() => router.push('/tools/text-to-speech')}
        style={[styles.toolCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <View style={[styles.toolIconWrap, { backgroundColor: `${colors.primary}18` }]}>
          <MaterialCommunityIcons name="waveform" size={24} color={colors.primary} />
        </View>
        <View style={styles.toolCopy}>
          <ThemedText style={styles.toolTitle}>文字转语音</ThemedText>
          <ThemedText numberOfLines={1} style={[styles.toolDescription, { color: colors.mutedText }]}>
            输入文字，生成可预览的语音文件
          </ThemedText>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={24} color={colors.mutedText} />
      </Pressable>

      <Pressable
        onPress={() => router.push('/tools/release-email-assistant')}
        style={[styles.toolCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <View style={[styles.toolIconWrap, { backgroundColor: '#8b5cf618' }]}>
          <MaterialCommunityIcons name="email-newsletter" size={24} color="#8b5cf6" />
        </View>
        <View style={styles.toolCopy}>
          <ThemedText style={styles.toolTitle}>发版邮件助手</ThemedText>
          <ThemedText numberOfLines={1} style={[styles.toolDescription, { color: colors.mutedText }]}>
            生成发版通知邮件和收件人列表
          </ThemedText>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={24} color={colors.mutedText} />
      </Pressable>

      <View style={styles.sectionHeader}>
        <ThemedText style={styles.sectionTitle}>小游戏</ThemedText>
        <ThemedText style={[styles.sectionMeta, { color: colors.mutedText }]}>人机挑战</ThemedText>
      </View>

      <Pressable
        onPress={() => router.push('/games/gomoku')}
        style={[styles.toolCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <View style={[styles.toolIconWrap, { backgroundColor: '#cf794a18' }]}>
          <MaterialCommunityIcons name="checkerboard" size={25} color="#cf794a" />
        </View>
        <View style={styles.toolCopy}>
          <ThemedText style={styles.toolTitle}>五子棋人机对战</ThemedText>
          <ThemedText numberOfLines={1} style={[styles.toolDescription, { color: colors.mutedText }]}>
            三档难度，支持悔棋与随时重开
          </ThemedText>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={24} color={colors.mutedText} />
      </Pressable>
    </MobileScreen>
  );
}

const styles = StyleSheet.create({
  pageContent: {
    gap: 12,
    paddingTop: 14,
  },
  backgroundLayer: {
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  backgroundOrbLarge: {
    borderRadius: 999,
    height: 220,
    opacity: 0.5,
    position: 'absolute',
    right: -90,
    top: -70,
    width: 220,
  },
  backgroundOrbSmall: {
    borderRadius: 999,
    height: 140,
    left: -54,
    opacity: 0.7,
    position: 'absolute',
    top: 220,
    width: 140,
  },
  topBar: {
    marginBottom: 4,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
  },
  sectionMeta: {
    fontSize: 12,
    fontWeight: '700',
  },
  brandTitle: {
    fontSize: 24,
    fontWeight: '800',
  },
  brandSubtitle: {
    fontSize: 12,
    marginTop: 4,
  },
  toolCard: {
    alignItems: 'center',
    borderRadius: 22,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 86,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  toolIconWrap: {
    alignItems: 'center',
    borderRadius: 18,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  toolCopy: {
    flex: 1,
  },
  toolTitle: {
    fontSize: 17,
    fontWeight: '800',
  },
  toolDescription: {
    fontSize: 12,
    marginTop: 5,
  },
});
