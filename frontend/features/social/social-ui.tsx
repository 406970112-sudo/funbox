import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import type { SocialUser } from '@/types/social';

const avatarColors = ['#ff8aaa', '#5b7cff', '#9a71dc', '#f4a24f', '#35bca8'];

type SocialAvatarProps = {
  showOnline?: boolean;
  size?: number;
  user: SocialUser;
};

export function SocialAvatar({ showOnline = false, size = 48, user }: SocialAvatarProps) {
  const backgroundColor = avatarColors[hashUser(user.id) % avatarColors.length];
  const iconSize = Math.round(size * 0.5);

  return (
    <View style={{ height: size, width: size }}>
      <View style={[styles.avatar, { backgroundColor, borderRadius: size / 2, height: size, width: size }]}>
        {user.avatarUrl ? (
          <Image contentFit="cover" source={{ uri: user.avatarUrl }} style={styles.avatarImage} />
        ) : (
          <MaterialCommunityIcons name="account" size={iconSize} color="#ffffff" />
        )}
      </View>
      {showOnline && user.online ? <View style={styles.onlineDot} /> : null}
    </View>
  );
}

type SocialEmptyStateProps = {
  action?: React.ReactNode;
  description: string;
  icon: ComponentProps<typeof MaterialCommunityIcons>['name'];
  title: string;
};

export function SocialEmptyState({ action, description, icon, title }: SocialEmptyStateProps) {
  return (
    <View style={styles.emptyState}>
      <View style={styles.emptyIcon}>
        <MaterialCommunityIcons name={icon} size={25} color="#4b6bff" />
      </View>
      <ThemedText style={styles.emptyTitle}>{title}</ThemedText>
      <ThemedText style={styles.emptyDescription}>{description}</ThemedText>
      {action}
    </View>
  );
}

function hashUser(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    height: '100%',
    width: '100%',
  },
  emptyDescription: {
    color: '#7483a2',
    fontSize: 12,
    lineHeight: 19,
    maxWidth: 260,
    textAlign: 'center',
  },
  emptyIcon: {
    alignItems: 'center',
    backgroundColor: '#e7ecff',
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  emptyState: {
    alignItems: 'center',
    gap: 8,
    justifyContent: 'center',
    minHeight: 210,
    paddingHorizontal: 24,
    paddingVertical: 28,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '800',
    marginTop: 4,
  },
  onlineDot: {
    backgroundColor: '#1db991',
    borderColor: '#ffffff',
    borderRadius: 6,
    borderWidth: 2,
    bottom: 0,
    height: 12,
    position: 'absolute',
    right: 0,
    width: 12,
  },
});
