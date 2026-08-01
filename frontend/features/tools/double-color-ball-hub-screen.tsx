import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { appLayout } from '@/constants/app-theme';
import { useAppTheme } from '@/hooks/use-app-theme';

import { getDoubleColorBallHubPalette } from './double-color-ball-hub-theme';

const BLUE = '#3785ff';
const CORAL = '#ff5f72';
const INDIGO = '#151b3b';

export function DoubleColorBallHubScreen() {
  const router = useRouter();
  const { colorScheme, colors } = useAppTheme();
  const dark = colorScheme === 'dark';
  const pageSurface = dark ? colors.background : '#f7f9fe';
  const cardPalette = getDoubleColorBallHubPalette(colorScheme);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <View style={[styles.screenShell, { backgroundColor: pageSurface }]}>
        <View style={[styles.header, { borderBottomColor: colors.line }]}>
          <Pressable
            accessibilityLabel="返回上一页"
            accessibilityRole="button"
            hitSlop={10}
            onPress={() => router.back()}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
            <MaterialCommunityIcons name="chevron-left" size={29} color={colors.text} />
          </Pressable>
          <ThemedText style={styles.headerTitle}>双色球</ThemedText>
          <View style={styles.headerSlot} />
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}>
          <View style={styles.hero}>
            <ThemedText style={styles.heroMeta}>统一入口 · 二级选择</ThemedText>
            <ThemedText style={styles.heroTitle}>选择要进入的功能</ThemedText>
            <ThemedText style={styles.heroSub}>
              首页和工具列表只保留一个双色球入口，后续新功能也从这里进入。
            </ThemedText>
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/tools/double-color-ball')}
            style={({ pressed }) => [
              styles.choiceCard,
              {
                backgroundColor: cardPalette.reference.background,
                borderColor: cardPalette.reference.border,
              },
              pressed && styles.pressed,
            ]}>
            <View style={styles.choiceHead}>
              <View
                style={[
                  styles.choiceIcon,
                  { backgroundColor: cardPalette.reference.iconBackground },
                ]}>
                <MaterialCommunityIcons name="chart-bell-curve-cumulative" size={22} color={CORAL} />
              </View>
              <View style={styles.choiceCopy}>
                <ThemedText style={styles.choiceTitle}>双色球概率参考</ThemedText>
                <ThemedText style={[styles.choiceSubtitle, { color: colors.mutedText }]}>
                  历史冷热、结构与五组参考号
                </ThemedText>
              </View>
            </View>
            <View style={[styles.choiceAction, { backgroundColor: colors.surfaceMuted }]}>
              <ThemedText style={[styles.choiceActionText, { color: colors.mutedText }]}>
                进入概率参考
              </ThemedText>
              <MaterialCommunityIcons name="arrow-right" size={16} color={colors.mutedText} />
            </View>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/tools/double-color-ball-lab')}
            style={({ pressed }) => [
              styles.choiceCard,
              {
                backgroundColor: cardPalette.labV2.background,
                borderColor: cardPalette.labV2.border,
              },
              pressed && styles.pressed,
            ]}>
            <View style={styles.choiceHead}>
              <View
                style={[
                  styles.choiceIcon,
                  { backgroundColor: cardPalette.labV2.iconBackground },
                ]}>
                <MaterialCommunityIcons name="flask-outline" size={22} color={BLUE} />
              </View>
              <View style={styles.choiceCopy}>
                <ThemedText style={styles.choiceTitle}>双色球计划实验室 V2</ThemedText>
                <ThemedText style={[styles.choiceSubtitle, { color: colors.mutedText }]}>
                  随机 / 概率 / 概率权重 · 1000 期
                </ThemedText>
              </View>
            </View>
            <View style={[styles.choiceAction, styles.choiceActionNew]}>
              <ThemedText style={[styles.choiceActionText, { color: '#ffffff' }]}>
                进入计划实验室 V2
              </ThemedText>
              <MaterialCommunityIcons name="arrow-right" size={16} color="#ffffff" />
            </View>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/tools/double-color-ball-lab-classic')}
            style={({ pressed }) => [
              styles.choiceCard,
              {
                backgroundColor: cardPalette.labV1.background,
                borderColor: cardPalette.labV1.border,
              },
              pressed && styles.pressed,
            ]}>
            <View style={styles.choiceHead}>
              <View
                style={[
                  styles.choiceIcon,
                  { backgroundColor: cardPalette.labV1.iconBackground },
                ]}>
                <MaterialCommunityIcons name="flask-outline" size={22} color="#a76a00" />
              </View>
              <View style={styles.choiceCopy}>
                <ThemedText style={styles.choiceTitle}>双色球计划实验室 V1</ThemedText>
                <ThemedText style={[styles.choiceSubtitle, { color: colors.mutedText }]}>
                  低频优先 / 时间加权 / 正态拟合
                </ThemedText>
              </View>
            </View>
            <View style={[styles.choiceAction, styles.choiceActionClassic]}>
              <ThemedText style={[styles.choiceActionText, { color: '#ffffff' }]}>
                进入经典实验室
              </ThemedText>
              <MaterialCommunityIcons name="arrow-right" size={16} color="#ffffff" />
            </View>
          </Pressable>

          <View style={[styles.notePanel, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <MaterialCommunityIcons name="information-outline" size={16} color={BLUE} />
            <ThemedText style={[styles.noteText, { color: colors.mutedText }]}>
              三个功能都使用中国福彩网官方历史开奖，开奖是独立随机事件，均不提供中奖保证。
            </ThemedText>
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  choiceAction: { alignItems: 'center', borderRadius: 8, flexDirection: 'row', gap: 6, height: 36, justifyContent: 'center', marginTop: 12 },
  choiceActionClassic: { backgroundColor: '#a76a00' },
  choiceActionNew: { backgroundColor: '#4b6bff' },
  choiceActionText: { fontSize: 10, fontWeight: '900', lineHeight: 15 },
  choiceCard: { borderRadius: 12, borderWidth: 1, marginTop: 12, padding: 14 },
  choiceCopy: { flex: 1, minWidth: 0 },
  choiceHead: { alignItems: 'center', flexDirection: 'row', gap: 11 },
  choiceIcon: { alignItems: 'center', borderRadius: 10, height: 42, justifyContent: 'center', width: 42 },
  choiceSubtitle: { fontSize: 10, lineHeight: 15, marginTop: 3 },
  choiceTitle: { fontSize: 14, fontWeight: '900', lineHeight: 19 },
  header: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', height: 57, justifyContent: 'space-between', paddingHorizontal: 12 },
  headerSlot: { height: 34, width: 34 },
  headerTitle: { fontSize: 16, fontWeight: '900', lineHeight: 22 },
  hero: { backgroundColor: INDIGO, borderRadius: 12, marginTop: 12, padding: 18 },
  heroMeta: { color: '#aab5d6', fontSize: 9, fontWeight: '800', lineHeight: 14 },
  heroSub: { color: '#b7c2df', fontSize: 10, lineHeight: 16, marginTop: 5 },
  heroTitle: { color: '#ffffff', fontSize: 24, fontWeight: '900', lineHeight: 30, marginTop: 6 },
  iconButton: { alignItems: 'center', height: 38, justifyContent: 'center', width: 38 },
  notePanel: { alignItems: 'flex-start', borderRadius: 8, borderWidth: 1, flexDirection: 'row', gap: 8, marginTop: 12, padding: 11 },
  noteText: { flex: 1, fontSize: 9, lineHeight: 15 },
  pressed: { opacity: 0.76 },
  safeArea: { flex: 1 },
  screenShell: { alignSelf: 'center', flex: 1, maxWidth: appLayout.screenMaxWidth, overflow: 'hidden', width: '100%' },
  scrollContent: { paddingBottom: 24, paddingHorizontal: 14, paddingTop: 8 },
});
