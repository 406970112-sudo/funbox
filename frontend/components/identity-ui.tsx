import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useAppTheme } from '@/hooks/use-app-theme';
import { identityPresentation } from '@/lib/identity';
import type { UserRole } from '@/types/access';

export function IdentityPill({
  compact = false,
  onDark = false,
  role,
}: {
  compact?: boolean;
  onDark?: boolean;
  role: UserRole;
}) {
  const { colorScheme } = useAppTheme();
  const item = identityPresentation(role, colorScheme);
  const solidAdmin = !onDark && role === 'admin';
  const backgroundColor = solidAdmin ? '#151b3b' : `${item.color}1c`;
  const borderColor = solidAdmin ? '#151b3b' : `${item.color}55`;
  const textColor = solidAdmin ? '#ffffff' : item.color;
  const iconColor = role === 'admin' && !onDark ? '#c9f36a' : textColor;

  return (
    <View
      accessibilityLabel={`身份：${item.label}`}
      style={[styles.pill, compact && styles.pillCompact, { backgroundColor, borderColor }]}>
      <MaterialCommunityIcons name={item.icon} size={compact ? 9 : 12} color={iconColor} />
      <ThemedText style={[styles.pillText, compact && styles.pillTextCompact, { color: textColor }]}>
        {item.label}
      </ThemedText>
    </View>
  );
}

export function AvatarIdentityBadge({ role }: { role: UserRole }) {
  const item = identityPresentation(role, 'light');
  const backgroundColor =
    role === 'admin' ? '#c9f36a' : role === 'vip' ? '#e8a33d' : '#e8667a';
  const iconColor = role === 'admin' ? '#151b3b' : role === 'vip' ? '#5b3a08' : '#ffffff';

  return (
    <View
      accessibilityLabel={`身份：${item.label}`}
      style={[styles.avatarBadge, { backgroundColor }]}>
      <MaterialCommunityIcons name={item.icon} size={10} color={iconColor} />
    </View>
  );
}

export function IdentityCard({ onPress, role }: { onPress: () => void; role: UserRole }) {
  const { colorScheme, colors } = useAppTheme();
  const item = identityPresentation(role, colorScheme);
  const dark = colorScheme === 'dark';

  const palette =
    role === 'admin'
      ? {
          actionBackground: '#c9f36a',
          actionText: '#151b3b',
          background: '#151b3b',
          border: '#151b3b',
          iconBackground: 'rgba(201,243,106,0.14)',
          iconColor: '#c9f36a',
          subtitle: 'rgba(255,255,255,0.62)',
          title: '#ffffff',
        }
      : role === 'vip'
        ? dark
          ? {
              actionBackground: '#d99a31',
              actionText: '#2a1d05',
              background: '#2e2718',
              border: '#6b5426',
              iconBackground: 'rgba(242,193,78,0.18)',
              iconColor: '#f2c14e',
              subtitle: '#c9b27f',
              title: '#f2c14e',
            }
          : {
              actionBackground: '#d99a31',
              actionText: '#ffffff',
              background: '#fff7e8',
              border: '#edc989',
              iconBackground: '#f6d999',
              iconColor: '#7a5112',
              subtitle: '#8a6a3a',
              title: '#7a5112',
            }
        : role === 'svip'
          ? dark
            ? {
                actionBackground: '#d95b6f',
                actionText: '#ffffff',
                background: '#2c1a20',
                border: '#6b3543',
                iconBackground: 'rgba(255,139,163,0.18)',
                iconColor: '#ff8ba3',
                subtitle: '#c99aa2',
                title: '#ff8ba3',
              }
            : {
                actionBackground: '#d95b6f',
                actionText: '#ffffff',
                background: '#fff1f3',
                border: '#efaeb9',
                iconBackground: '#f3aebb',
                iconColor: '#6e2634',
                subtitle: '#8f5560',
                title: '#6e2634',
              }
          : {
              actionBackground: colors.surfaceMuted,
              actionText: colors.mutedText,
              background: colors.surface,
              border: colors.line,
              iconBackground: '#eef1f6',
              iconColor: item.color,
              subtitle: colors.mutedText,
              title: colors.text,
            };

  return (
    <Pressable
      accessibilityLabel={`${item.cardTitle}，${item.actionLabel}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: palette.background, borderColor: palette.border },
        pressed && styles.cardPressed,
      ]}>
      <View style={[styles.cardIcon, { backgroundColor: palette.iconBackground }]}>
        <MaterialCommunityIcons name={item.icon} size={21} color={palette.iconColor} />
      </View>
      <View style={styles.cardCopy}>
        <ThemedText style={[styles.cardTitle, { color: palette.title }]}>{item.cardTitle}</ThemedText>
        <ThemedText style={[styles.cardSubtitle, { color: palette.subtitle }]}>
          {item.cardSubtitle}
        </ThemedText>
      </View>
      <View style={[styles.cardAction, { backgroundColor: palette.actionBackground }]}>
        <ThemedText style={[styles.cardActionText, { color: palette.actionText }]}>
          {item.actionLabel}
        </ThemedText>
        <MaterialCommunityIcons name="chevron-right" size={13} color={palette.actionText} />
      </View>
    </Pressable>
  );
}

export function AdminIdentityChip({
  compact = false,
  username,
}: {
  compact?: boolean;
  username: string;
}) {
  return (
    <View
      accessibilityLabel={`管理员：${username}`}
      style={[styles.adminChip, compact && styles.adminChipCompact]}>
      <MaterialCommunityIcons name="shield-check-outline" size={16} color="#c9f36a" />
      {!compact ? <ThemedText style={styles.adminChipText}>管理员</ThemedText> : null}
      {!compact ? (
        <ThemedText numberOfLines={1} style={styles.adminChipUsername}>
          @{username}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 7,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    minHeight: 20,
    paddingHorizontal: 7,
  },
  pillText: {
    fontSize: 10,
    fontWeight: '900',
  },
  pillCompact: {
    borderRadius: 5,
    gap: 3,
    minHeight: 16,
    paddingHorizontal: 5,
  },
  pillTextCompact: {
    fontSize: 8,
  },
  avatarBadge: {
    alignItems: 'center',
    borderColor: '#ffffff',
    borderRadius: 11,
    borderWidth: 2,
    bottom: -4,
    height: 22,
    justifyContent: 'center',
    position: 'absolute',
    right: -4,
    width: 22,
  },
  card: {
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 80,
    padding: 14,
  },
  cardPressed: {
    opacity: 0.82,
  },
  cardIcon: {
    alignItems: 'center',
    borderRadius: 13,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  cardCopy: {
    flex: 1,
    minWidth: 0,
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: '900',
  },
  cardSubtitle: {
    fontSize: 10,
    lineHeight: 15,
    marginTop: 4,
  },
  cardAction: {
    alignItems: 'center',
    borderRadius: 9,
    flexDirection: 'row',
    gap: 4,
    minHeight: 30,
    paddingHorizontal: 10,
  },
  cardActionText: {
    fontSize: 10,
    fontWeight: '900',
  },
  adminChip: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#151b3b',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 6,
    minHeight: 34,
    paddingHorizontal: 10,
  },
  adminChipCompact: {
    justifyContent: 'center',
    paddingHorizontal: 0,
    width: 34,
  },
  adminChipText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '900',
  },
  adminChipUsername: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 9,
    fontWeight: '700',
    maxWidth: 120,
  },
});
