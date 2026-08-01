import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Redirect, useRouter } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/features/auth/auth-provider';
import { useAppTheme } from '@/hooks/use-app-theme';
import { AppLoadingScreen } from '@/shared/ui/app-loading-screen';
import { MobileScreen } from '@/shared/ui/mobile-screen';

type AdminEntryProps = {
  description: string;
  icon: ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  onPress: () => void;
  tone: string;
};

export function AdminHomeScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { status, user } = useAuth();

  if (status === 'loading' || !user) {
    return <AppLoadingScreen />;
  }
  if (status !== 'authenticated' || user.role !== 'admin') {
    return <Redirect href="/profile" />;
  }

  return (
    <MobileScreen contentContainerStyle={styles.pageContent}>
      <View style={styles.topBar}>
        <Pressable
          accessibilityLabel="返回我的"
          accessibilityRole="button"
          onPress={() => router.back()}
          style={[styles.iconButton, { backgroundColor: colors.surface }]}>
          <MaterialCommunityIcons name="arrow-left" size={20} color={colors.text} />
        </Pressable>
        <View style={styles.topBarCopy}>
          <ThemedText style={styles.pageTitle}>管理后台</ThemedText>
          <ThemedText style={[styles.pageSubtitle, { color: colors.mutedText }]}>
            FunBox 管理
          </ThemedText>
        </View>
        <View style={[styles.adminMark, { backgroundColor: colors.hero }]}>
          <MaterialCommunityIcons name="shield-crown-outline" size={19} color="#c9f36a" />
        </View>
      </View>

      <View style={[styles.heroBand, { backgroundColor: colors.hero }]}>
        <View pointerEvents="none" style={styles.heroAccent} />
        <ThemedText style={styles.heroTitle}>管理控制台</ThemedText>
        <ThemedText style={styles.heroBody}>查看入口权限与用户提交的内容</ThemedText>
      </View>

      <View style={styles.entryList}>
        <AdminEntry
          description="管理功能入口的角色与用户特批"
          icon="key-outline"
          label="入口权限"
          onPress={() => router.push('/admin/permissions')}
          tone="#4b6bff"
        />
        <AdminEntry
          description="查看用户提交的文字与图片"
          icon="message-alert-outline"
          label="问题反馈"
          onPress={() => router.push('/admin/feedback')}
          tone="#e8667a"
        />
      </View>
    </MobileScreen>
  );
}

function AdminEntry({ description, icon, label, onPress, tone }: AdminEntryProps) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.entryCard,
        {
          backgroundColor: colors.surface,
          borderColor: colors.line,
          opacity: pressed ? 0.74 : 1,
        },
      ]}>
      <View style={[styles.entryIcon, { backgroundColor: `${tone}18` }]}>
        <MaterialCommunityIcons name={icon} size={25} color={tone} />
      </View>
      <View style={styles.entryCopy}>
        <ThemedText style={styles.entryLabel}>{label}</ThemedText>
        <ThemedText style={[styles.entryDescription, { color: colors.mutedText }]}>
          {description}
        </ThemedText>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={22} color={colors.mutedText} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pageContent: {
    gap: 20,
    paddingTop: 14,
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  topBarCopy: {
    flex: 1,
    marginLeft: 10,
  },
  pageTitle: {
    fontSize: 18,
    fontWeight: '800',
  },
  pageSubtitle: {
    fontSize: 12,
    marginTop: 3,
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: 16,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  adminMark: {
    alignItems: 'center',
    borderRadius: 15,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  heroBand: {
    borderRadius: 24,
    overflow: 'hidden',
    padding: 22,
    position: 'relative',
  },
  heroAccent: {
    backgroundColor: 'rgba(201,243,106,0.12)',
    borderRadius: 20,
    height: 120,
    position: 'absolute',
    right: -24,
    top: -42,
    transform: [{ rotate: '16deg' }],
    width: 84,
  },
  heroTitle: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '800',
  },
  heroBody: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 13,
    marginTop: 8,
  },
  entryList: {
    gap: 12,
  },
  entryCard: {
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 13,
    minHeight: 84,
    padding: 14,
  },
  entryIcon: {
    alignItems: 'center',
    borderRadius: 16,
    height: 50,
    justifyContent: 'center',
    width: 50,
  },
  entryCopy: {
    flex: 1,
    gap: 5,
  },
  entryLabel: {
    fontSize: 15,
    fontWeight: '800',
  },
  entryDescription: {
    fontSize: 12,
    lineHeight: 18,
  },
});
