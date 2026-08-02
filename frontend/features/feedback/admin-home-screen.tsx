import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Redirect, useRouter } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/features/auth/auth-provider';
import { useAppTheme } from '@/hooks/use-app-theme';
import { AppLoadingScreen } from '@/shared/ui/app-loading-screen';

const ADMIN_DESKTOP_BREAKPOINT = 900;

type AdminEntryProps = {
  description: string;
  desktop?: boolean;
  icon: ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  onPress: () => void;
  tone: string;
};

export function AdminHomeScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { width } = useWindowDimensions();
  const { status, user } = useAuth();
  const isDesktop = width >= ADMIN_DESKTOP_BREAKPOINT;

  if (status === 'loading' || !user) {
    return <AppLoadingScreen />;
  }
  if (status !== 'authenticated' || user.role !== 'admin') {
    return <Redirect href="/profile" />;
  }

  return (
    <ScrollView
      contentContainerStyle={[styles.scrollContent, { backgroundColor: colors.background }]}
      showsVerticalScrollIndicator={false}
      style={styles.root}>
      <View style={[styles.page, isDesktop && styles.pageDesktop]}>
        <View style={[styles.heroBand, { backgroundColor: colors.hero }]}>
          <View pointerEvents="none" style={styles.heroAccent} />
          <ThemedText style={styles.heroTitle}>管理控制台</ThemedText>
          <ThemedText style={styles.heroBody}>查看入口权限与用户提交的内容</ThemedText>
        </View>

        <View style={[styles.entryList, isDesktop && styles.entryListDesktop]}>
          <AdminEntry
            description="查询用户并调整普通用户 / VIP / SVIP 身份"
            desktop={isDesktop}
            icon="account-key-outline"
            label="用户身份"
            onPress={() => router.push('/admin/users')}
            tone="#1db991"
          />
          <AdminEntry
            description="管理功能与游戏入口的角色可见性与用户特批"
            desktop={isDesktop}
            icon="key-outline"
            label="入口权限"
            onPress={() => router.push('/admin/permissions')}
            tone="#4b6bff"
          />
          <AdminEntry
            description="查看用户提交的文字与图片"
            desktop={isDesktop}
            icon="message-alert-outline"
            label="问题反馈"
            onPress={() => router.push('/admin/feedback')}
            tone="#e8667a"
          />
          <AdminEntry
            description="查看真实动态、举报记录并下架违规内容"
            desktop={isDesktop}
            icon="account-group-outline"
            label="朋友圈管理"
            onPress={() => router.push('/admin/moments')}
            tone="#4b6bff"
          />
          <AdminEntry
            description="上传收款码并维护会员支付说明"
            desktop={isDesktop}
            icon="qrcode"
            label="会员收款"
            onPress={() => router.push('/admin/membership')}
            tone="#e8a33d"
          />
        </View>
      </View>
    </ScrollView>
  );
}

function AdminEntry({ description, desktop = false, icon, label, onPress, tone }: AdminEntryProps) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.entryCard,
        desktop && styles.entryCardDesktop,
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
  root: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  page: {
    alignSelf: 'center',
    gap: 20,
    maxWidth: 430,
    padding: 16,
    width: '100%',
  },
  pageDesktop: {
    maxWidth: 1080,
    padding: 24,
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
  entryListDesktop: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
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
  entryCardDesktop: {
    flexBasis: '31%',
    flexGrow: 1,
    minWidth: 280,
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
