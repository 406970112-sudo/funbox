import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { PropsWithChildren, ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import type { ReadingBook } from '@/types/reading';

export const readingColors = {
  blue: '#4968f2',
  blueSoft: '#eef1ff',
  canvas: '#f5f7fc',
  coral: '#ef6a7a',
  green: '#17a981',
  ink: '#141a33',
  line: '#e1e6f1',
  muted: '#75809b',
  paper: '#fffdf8',
  surface: '#ffffff',
};

const coverThemes = [
  { background: '#263454', accent: '#9fb8dc', pattern: 'weather-sunset' as const },
  { background: '#6d202c', accent: '#f1aa94', pattern: 'city-variant-outline' as const },
  { background: '#19202d', accent: '#8899b7', pattern: 'telescope' as const },
  { background: '#365046', accent: '#b7d0b9', pattern: 'forest-outline' as const },
  { background: '#714a2e', accent: '#efc491', pattern: 'bookshelf' as const },
];

export function ReadingPage({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  return <SafeAreaView style={[styles.page, style]}>{children}</SafeAreaView>;
}

export function ReadingBrand({ compact = false, inverse = false }: { compact?: boolean; inverse?: boolean }) {
  return (
    <View style={styles.brandRow}>
      <View style={[styles.brandMark, compact && styles.brandMarkCompact]}>
        <MaterialCommunityIcons name="book-open-page-variant-outline" size={compact ? 17 : 21} color="#fff" />
      </View>
      <View>
        <Text style={[styles.brandName, compact && styles.brandNameCompact, inverse && styles.brandNameInverse]}>Funbox 阅读</Text>
        {!compact ? <Text style={[styles.brandMeta, inverse && styles.brandMetaInverse]}>FREE READING</Text> : null}
      </View>
    </View>
  );
}

export function NovelCover({ book, compact = false }: { book: ReadingBook; compact?: boolean }) {
  const theme = coverThemes[hashString(book.id) % coverThemes.length];
  return (
    <View style={[styles.cover, { backgroundColor: theme.background }, compact && styles.coverCompact]}>
      <View style={[styles.coverRule, { backgroundColor: theme.accent }]} />
      <MaterialCommunityIcons name={theme.pattern} size={compact ? 24 : 40} color={theme.accent} />
      <View style={styles.coverTextWrap}>
        <Text numberOfLines={compact ? 2 : 3} style={[styles.coverTitle, compact && styles.coverTitleCompact]}>{book.title}</Text>
        <Text numberOfLines={1} style={[styles.coverAuthor, { color: theme.accent }]}>{book.author}</Text>
      </View>
      <Text style={[styles.coverImprint, { color: theme.accent }]}>FUNBOX READS</Text>
    </View>
  );
}

export function SourceBadge({ sourceType }: Pick<ReadingBook, 'sourceType'>) {
  const local = sourceType === 'local';
  return (
    <View style={[styles.sourceBadge, { backgroundColor: local ? '#e8f8f1' : readingColors.blueSoft }]}>
      <MaterialCommunityIcons name={local ? 'cellphone-arrow-down' : 'check-decagram-outline'} size={12} color={local ? readingColors.green : readingColors.blue} />
      <Text style={[styles.sourceBadgeText, { color: local ? readingColors.green : readingColors.blue }]}>{local ? '本地' : '正版'}</Text>
    </View>
  );
}

export function IconButton({
  accessibilityLabel,
  icon,
  onPress,
  selected = false,
}: {
  accessibilityLabel: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  onPress: () => void;
  selected?: boolean;
}) {
  return (
    <Pressable accessibilityLabel={accessibilityLabel} onPress={onPress} style={({ pressed }) => [styles.iconButton, selected && styles.iconButtonSelected, pressed && styles.pressed]}>
      <MaterialCommunityIcons name={icon} size={20} color={selected ? readingColors.blue : readingColors.ink} />
    </Pressable>
  );
}

export function PrimaryButton({ children, icon, onPress, disabled = false, secondary = false }: PropsWithChildren<{
  disabled?: boolean;
  icon?: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  onPress: () => void;
  secondary?: boolean;
}>) {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.primaryButton, secondary && styles.secondaryButton, disabled && styles.disabled, pressed && styles.pressed]}>
      {icon ? <MaterialCommunityIcons name={icon} size={17} color={secondary ? readingColors.ink : '#fff'} /> : null}
      <Text style={[styles.primaryButtonText, secondary && styles.secondaryButtonText]}>{children}</Text>
    </Pressable>
  );
}

export function ReadingEmpty({ icon, title, body, action }: { action?: ReactNode; body: string; icon: React.ComponentProps<typeof MaterialCommunityIcons>['name']; title: string }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}><MaterialCommunityIcons name={icon} size={28} color={readingColors.blue} /></View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
      {action ? <View style={styles.emptyAction}>{action}</View> : null}
    </View>
  );
}

export function ReadingLoading({ label = '正在整理书页…' }: { label?: string }) {
  return <View style={styles.loading}><ActivityIndicator color={readingColors.blue} /><Text style={styles.loadingText}>{label}</Text></View>;
}

function hashString(value: string) {
  let result = 0;
  for (let index = 0; index < value.length; index += 1) result = (result * 31 + value.charCodeAt(index)) >>> 0;
  return result;
}

const styles = StyleSheet.create({
  brandMark: { alignItems: 'center', backgroundColor: readingColors.blue, borderRadius: 7, height: 38, justifyContent: 'center', width: 38 },
  brandMarkCompact: { height: 31, width: 31 },
  brandMeta: { color: readingColors.blue, fontSize: 9, fontWeight: '800', letterSpacing: 0.8, marginTop: 1 },
  brandMetaInverse: { color: '#aebcff' },
  brandName: { color: readingColors.ink, fontSize: 16, fontWeight: '900' },
  brandNameCompact: { fontSize: 14 },
  brandNameInverse: { color: '#fff' },
  brandRow: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  cover: { borderRadius: 6, height: 208, justifyContent: 'space-between', overflow: 'hidden', padding: 14, width: 142 },
  coverAuthor: { fontSize: 10, fontWeight: '700', marginTop: 5 },
  coverCompact: { height: 112, padding: 9, width: 76 },
  coverImprint: { fontSize: 7, fontWeight: '900', letterSpacing: 0.8 },
  coverRule: { height: 3, position: 'absolute', right: -15, top: 22, transform: [{ rotate: '-38deg' }], width: 82 },
  coverTextWrap: { gap: 1 },
  coverTitle: { color: '#fff', fontSize: 18, fontWeight: '900', lineHeight: 23 },
  coverTitleCompact: { fontSize: 12, lineHeight: 16 },
  disabled: { opacity: 0.5 },
  empty: { alignItems: 'center', gap: 10, justifyContent: 'center', paddingHorizontal: 30, paddingVertical: 44 },
  emptyAction: { alignSelf: 'center' },
  emptyBody: { color: readingColors.muted, fontSize: 13, lineHeight: 20, maxWidth: 340, textAlign: 'center' },
  emptyIcon: { alignItems: 'center', backgroundColor: readingColors.blueSoft, borderRadius: 8, height: 54, justifyContent: 'center', width: 54 },
  emptyTitle: { color: readingColors.ink, fontSize: 17, fontWeight: '900' },
  iconButton: { alignItems: 'center', backgroundColor: '#fff', borderColor: readingColors.line, borderRadius: 7, borderWidth: 1, height: 38, justifyContent: 'center', width: 38 },
  iconButtonSelected: { backgroundColor: readingColors.blueSoft, borderColor: '#cbd3ff' },
  loading: { alignItems: 'center', gap: 12, justifyContent: 'center', paddingVertical: 60 },
  loadingText: { color: readingColors.muted, fontSize: 13 },
  page: { backgroundColor: readingColors.canvas, flex: 1 },
  pressed: { opacity: 0.72 },
  primaryButton: { alignItems: 'center', alignSelf: 'flex-start', backgroundColor: readingColors.blue, borderRadius: 7, flexDirection: 'row', gap: 7, justifyContent: 'center', minHeight: 40, paddingHorizontal: 16 },
  primaryButtonText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  secondaryButton: { backgroundColor: '#fff', borderColor: readingColors.line, borderWidth: 1 },
  secondaryButtonText: { color: readingColors.ink },
  sourceBadge: { alignItems: 'center', borderRadius: 4, flexDirection: 'row', gap: 3, paddingHorizontal: 6, paddingVertical: 4 },
  sourceBadgeText: { fontSize: 9, fontWeight: '900' },
});
