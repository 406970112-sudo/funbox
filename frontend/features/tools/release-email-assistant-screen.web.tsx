import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter } from 'expo-router';
import { createElement, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useAppTheme } from '@/hooks/use-app-theme';
import { getEmailAgentAppUrl } from '@/lib/email-agent-app';

export function ReleaseEmailAssistantScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const [isLoading, setIsLoading] = useState(true);
  const appUrl = getEmailAgentAppUrl();

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.toolbar, { backgroundColor: colors.card, borderBottomColor: colors.line }]}>
        <Pressable
          accessibilityLabel="返回"
          onPress={() => router.back()}
          style={styles.iconButton}>
          <MaterialCommunityIcons name="arrow-left" size={22} color={colors.text} />
        </Pressable>
        <ThemedText numberOfLines={1} style={styles.title}>
          发版邮件助手
        </ThemedText>
        <Pressable
          accessibilityLabel="在新窗口打开"
          onPress={() => void Linking.openURL(appUrl)}
          style={styles.iconButton}>
          <MaterialCommunityIcons name="open-in-new" size={20} color={colors.text} />
        </Pressable>
      </View>

      <View style={styles.frameContainer}>
        {createElement('iframe', {
          allow: 'clipboard-read; clipboard-write',
          onLoad: () => setIsLoading(false),
          src: appUrl,
          style: styles.frame,
          title: '发版邮件助手',
        })}
        {isLoading ? (
          <View style={[styles.loading, { backgroundColor: colors.background }]}>
            <ActivityIndicator color={colors.primary} size="large" />
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    borderWidth: 0,
    height: '100%',
    width: '100%',
  },
  frameContainer: {
    flex: 1,
    position: 'relative',
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: 8,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  loading: {
    alignItems: 'center',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  screen: {
    flex: 1,
  },
  title: {
    flex: 1,
    fontSize: 17,
    fontWeight: '800',
    textAlign: 'center',
  },
  toolbar: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    minHeight: 56,
    paddingHorizontal: 8,
  },
});
