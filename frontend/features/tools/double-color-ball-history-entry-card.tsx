import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useAppTheme } from '@/hooks/use-app-theme';

const GREEN = '#20ad78';

type Props = {
  onPress: () => void;
};

export function DoubleColorBallHistoryEntryCard({ onPress }: Props) {
  const { colorScheme, colors } = useAppTheme();
  const dark = colorScheme === 'dark';

  return (
    <Pressable
      accessibilityHint="按期号或日期查询往期开奖结果"
      accessibilityLabel="历史开奖记录"
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: dark ? colors.surface : '#f4fbf8',
          borderColor: dark ? colors.line : '#bfe8d8',
        },
        pressed && styles.pressed,
      ]}>
      <View style={styles.head}>
        <View style={[styles.icon, { backgroundColor: dark ? '#17362c' : '#e2f6ee' }]}>
          <MaterialCommunityIcons name="calendar-search" size={22} color={GREEN} />
        </View>
        <View style={styles.copy}>
          <View style={styles.titleRow}>
            <ThemedText style={styles.title}>历史开奖记录</ThemedText>
            <View style={[styles.badge, { backgroundColor: dark ? '#17362c' : '#dcf8ed' }]}>
              <ThemedText style={styles.badgeText}>查询</ThemedText>
            </View>
          </View>
          <ThemedText style={[styles.subtitle, { color: colors.mutedText }]}>
            按期号或日期核对官方开奖号码
          </ThemedText>
        </View>
      </View>
      <View style={styles.action}>
        <ThemedText style={styles.actionText}>查看历史开奖</ThemedText>
        <MaterialCommunityIcons name="arrow-right" size={16} color="#ffffff" />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  action: {
    alignItems: 'center',
    backgroundColor: GREEN,
    borderRadius: 8,
    flexDirection: 'row',
    gap: 6,
    height: 36,
    justifyContent: 'center',
    marginTop: 12,
  },
  actionText: { color: '#ffffff', fontSize: 10, fontWeight: '900', lineHeight: 15 },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  badgeText: { color: GREEN, fontSize: 9, fontWeight: '900', lineHeight: 12 },
  card: { borderRadius: 12, borderWidth: 1, marginTop: 12, padding: 14 },
  copy: { flex: 1, minWidth: 0 },
  head: { alignItems: 'center', flexDirection: 'row', gap: 11 },
  icon: { alignItems: 'center', borderRadius: 10, height: 42, justifyContent: 'center', width: 42 },
  pressed: { opacity: 0.76 },
  subtitle: { fontSize: 10, lineHeight: 15, marginTop: 3 },
  title: { flexShrink: 1, fontSize: 14, fontWeight: '900', lineHeight: 19 },
  titleRow: { alignItems: 'center', flexDirection: 'row', gap: 8, justifyContent: 'space-between' },
});
