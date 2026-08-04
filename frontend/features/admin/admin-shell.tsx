import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { type Href, usePathname, useRouter } from 'expo-router';
import type { ComponentProps, PropsWithChildren } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AdminIdentityChip } from '@/components/identity-ui';
import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/features/auth/auth-provider';
import { useAppTheme } from '@/hooks/use-app-theme';

const ADMIN_DESKTOP_BREAKPOINT = 900;

type AdminPageKey =
  | 'blog'
  | 'feedback'
  | 'index'
  | 'membership'
  | 'moments'
  | 'permissions'
  | 'price-radar'
  | 'recommendations'
  | 'reading'
  | 'resource-search'
  | 'users';

type AdminNavItem = {
  icon: ComponentProps<typeof MaterialCommunityIcons>['name'];
  key: AdminPageKey;
  label: string;
  path: Href;
};

const NAV_SECTIONS: Array<{ items: AdminNavItem[]; title: string }> = [
  {
    title: '管理工具',
    items: [
      { key: 'index', icon: 'view-dashboard-outline', label: '后台首页', path: '/admin' },
      { key: 'users', icon: 'account-key-outline', label: '用户身份', path: '/admin/users' },
      { key: 'permissions', icon: 'key-outline', label: '入口权限', path: '/admin/permissions' },
      { key: 'feedback', icon: 'message-alert-outline', label: '问题反馈', path: '/admin/feedback' },
    ],
  },
  {
    title: '内容运营',
    items: [
      { key: 'recommendations', icon: 'star-circle-outline', label: '首页推荐', path: '/admin/recommendations' },
      { key: 'moments', icon: 'account-group-outline', label: '朋友圈管理', path: '/admin/moments' },
      { key: 'blog', icon: 'book-open-page-variant-outline', label: '博客管理', path: '/admin/blog' },
      { key: 'reading', icon: 'book-open-page-variant-outline', label: '阅读管理', path: '/admin/reading' },
      { key: 'resource-search', icon: 'database-search-outline', label: '资源搜索', path: '/admin/resource-search' },
      { key: 'price-radar', icon: 'basket-outline', label: '菜价核验', path: '/admin/price-radar' },
    ],
  },
  {
    title: '会员运营',
    items: [
      { key: 'membership', icon: 'qrcode', label: '会员收款', path: '/admin/membership' },
    ],
  },
];

const MOBILE_NAV_ITEMS: AdminNavItem[] = [
  { key: 'index', icon: 'view-dashboard-outline', label: '首页', path: '/admin' },
  { key: 'users', icon: 'account-key-outline', label: '用户', path: '/admin/users' },
  { key: 'permissions', icon: 'key-outline', label: '权限', path: '/admin/permissions' },
  { key: 'feedback', icon: 'message-alert-outline', label: '反馈', path: '/admin/feedback' },
  { key: 'recommendations', icon: 'star-circle-outline', label: '推荐', path: '/admin/recommendations' },
  { key: 'moments', icon: 'account-group-outline', label: '朋友圈', path: '/admin/moments' },
  { key: 'blog', icon: 'book-open-page-variant-outline', label: '博客', path: '/admin/blog' },
  { key: 'membership', icon: 'qrcode', label: '收款', path: '/admin/membership' },
  { key: 'reading', icon: 'book-open-page-variant-outline', label: '阅读', path: '/admin/reading' },
  { key: 'price-radar', icon: 'basket-outline', label: '菜价', path: '/admin/price-radar' },
];

const PAGE_META: Record<AdminPageKey, { breadcrumb: string; subtitle: string; title: string }> = {
  blog: {
    breadcrumb: '内容运营',
    subtitle: '查看真实文章、报告记录并下架违规内容',
    title: '博客管理',
  },
  index: {
    breadcrumb: '工作台',
    subtitle: '后台各模块统一在此管理',
    title: '管理控制台',
  },
  users: {
    breadcrumb: '用户与权限',
    subtitle: '查询用户并调整普通用户 / VIP / SVIP 身份',
    title: '用户身份',
  },
  permissions: {
    breadcrumb: '用户与权限',
    subtitle: '管理功能与游戏入口的角色可见性与用户特批',
    title: '入口权限',
  },
  feedback: {
    breadcrumb: '内容运营',
    subtitle: '查看用户提交的文字与图片',
    title: '问题反馈',
  },
  recommendations: {
    breadcrumb: '内容运营',
    subtitle: '配置首页今日推荐、排期与真实效果数据',
    title: '首页推荐管理',
  },
  moments: {
    breadcrumb: '内容运营',
    subtitle: '查看真实动态、举报记录并下架违规内容',
    title: '朋友圈管理',
  },
  membership: {
    breadcrumb: '会员运营',
    subtitle: '维护收款码与支付说明，人工开通闭环',
    title: '会员收款',
  },
  reading: {
    breadcrumb: '内容运营',
    subtitle: '导入、发布与隐藏阅读内容',
    title: '阅读管理',
  },
  'price-radar': {
    breadcrumb: '内容运营',
    subtitle: '核验用户上传的菜价凭证并处理结构化异议',
    title: '菜价核验',
  },
  'resource-search': {
    breadcrumb: '内容运营',
    subtitle: '配置用户端真实使用的搜索站点与接入方式',
    title: '资源搜索',
  },
};

export function AdminShell({ children }: PropsWithChildren) {
  const router = useRouter();
  const pathname = usePathname();
  const { colors } = useAppTheme();
  const { width } = useWindowDimensions();
  const { user } = useAuth();
  const isDesktop = width >= ADMIN_DESKTOP_BREAKPOINT;
  const activeKey = adminPageKey(pathname);
  const meta = PAGE_META[activeKey];

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={styles.frame}>
        {isDesktop ? (
          <View style={styles.sidebar}>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/admin')}
              style={styles.brandRow}>
              <View style={styles.brandMark}>
                <ThemedText style={styles.brandMarkText}>F</ThemedText>
              </View>
              <View>
                <ThemedText style={styles.brandName}>FunBox</ThemedText>
                <Text style={styles.brandSub}>管理后台</Text>
              </View>
            </Pressable>

            {NAV_SECTIONS.map((section) => (
              <View key={section.title}>
                <Text style={styles.navSection}>{section.title}</Text>
                <View style={styles.navGroup}>
                  {section.items.map((item) => {
                    const active = item.key === activeKey;
                    return (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        key={item.key}
                        onPress={() => router.push(item.path)}
                        style={[styles.navItem, active && styles.navItemActive]}>
                        <MaterialCommunityIcons
                          name={item.icon}
                          size={19}
                          color={active ? '#c9f36a' : '#a7b1d1'}
                        />
                        <Text style={[styles.navItemText, active && styles.navItemTextActive]}>
                          {item.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}

            <View style={styles.sidebarFooter}>
              <AdminIdentityChip compact username={user?.username ?? 'admin'} />
              <Pressable
                accessibilityRole="button"
                onPress={() => router.replace('/profile')}
                style={styles.backLink}>
                <MaterialCommunityIcons name="arrow-left" size={16} color="#a7b1d1" />
                <Text style={styles.backLinkText}>返回 FunBox</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        <View style={styles.column}>
          <View
            style={[
              styles.topbar,
              { backgroundColor: colors.surface, borderBottomColor: colors.line },
            ]}>
            {!isDesktop ? (
              <Pressable
                accessibilityLabel="返回"
                accessibilityRole="button"
                onPress={() => router.back()}
                style={[styles.iconButton, { backgroundColor: colors.surfaceMuted }]}>
                <MaterialCommunityIcons name="arrow-left" size={20} color={colors.text} />
              </Pressable>
            ) : null}
            <View style={styles.topbarCopy}>
              <View style={styles.breadcrumbRow}>
                <Text style={[styles.breadcrumbText, { color: colors.mutedText }]}>管理后台</Text>
                <MaterialCommunityIcons
                  name="chevron-right"
                  size={12}
                  color={colors.mutedText}
                />
                <Text style={[styles.breadcrumbText, { color: colors.mutedText }]}>
                  {meta.breadcrumb}
                </Text>
              </View>
              <ThemedText style={styles.topbarTitle}>{meta.title}</ThemedText>
              {isDesktop ? (
                <ThemedText style={[styles.topbarSubtitle, { color: colors.mutedText }]}>
                  {meta.subtitle}
                </ThemedText>
              ) : null}
            </View>
            <View style={styles.topbarActions}>
              {isDesktop ? (
                <Pressable
                  accessibilityLabel="通知"
                  accessibilityRole="button"
                  style={[styles.iconButton, { backgroundColor: colors.surfaceMuted }]}>
                  <MaterialCommunityIcons name="bell-outline" size={18} color={colors.text} />
                </Pressable>
              ) : null}
              <AdminIdentityChip compact={!isDesktop} username={user?.username ?? 'admin'} />
            </View>
          </View>

          <View style={styles.content}>{children}</View>
        </View>

        {!isDesktop ? (
          <View
            style={[
              styles.bottomNav,
              { backgroundColor: colors.surface, borderTopColor: colors.line },
            ]}>
            {MOBILE_NAV_ITEMS.map((item) => {
              const active = item.key === activeKey;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  key={item.key}
                  onPress={() => router.push(item.path)}
                  style={styles.bottomNavItem}>
                  <MaterialCommunityIcons
                    name={item.icon}
                    size={21}
                    color={active ? colors.primary : colors.mutedText}
                  />
                  <Text
                    style={[
                      styles.bottomNavLabel,
                      { color: active ? colors.primary : colors.mutedText },
                    ]}>
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

function adminPageKey(pathname: string): AdminPageKey {
  if (pathname === '/admin' || pathname === '/admin/') return 'index';
  const segment = pathname.split('/').filter(Boolean)[1];
  if (
    segment === 'users' ||
    segment === 'permissions' ||
    segment === 'feedback' ||
    segment === 'membership' ||
    segment === 'recommendations' ||
    segment === 'reading' ||
    segment === 'resource-search' ||
    segment === 'price-radar'
  ) {
    return segment;
  }
  return 'index';
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  frame: {
    flex: 1,
    flexDirection: 'row',
    minHeight: 0,
  },
  sidebar: {
    backgroundColor: '#141b39',
    flexDirection: 'column',
    paddingHorizontal: 14,
    paddingVertical: 18,
    width: 216,
  },
  brandRow: {
    alignItems: 'center',
    borderBottomColor: 'rgba(255,255,255,0.08)',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
    minHeight: 54,
    paddingHorizontal: 6,
  },
  brandMark: {
    alignItems: 'center',
    backgroundColor: '#c9f36a',
    borderRadius: 8,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  brandMarkText: {
    color: '#141b39',
    fontSize: 17,
    fontWeight: '900',
  },
  brandName: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '900',
  },
  brandSub: {
    color: '#8a94b5',
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
  },
  navSection: {
    color: '#66739a',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
    marginBottom: 7,
    marginTop: 18,
    paddingHorizontal: 10,
    textTransform: 'uppercase',
  },
  navGroup: {
    gap: 4,
  },
  navItem: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 10,
    minHeight: 42,
    paddingHorizontal: 10,
  },
  navItemActive: {
    backgroundColor: 'rgba(201,243,106,0.12)',
  },
  navItemText: {
    color: '#a7b1d1',
    fontSize: 13,
    fontWeight: '700',
  },
  navItemTextActive: {
    color: '#ffffff',
    fontWeight: '900',
  },
  sidebarFooter: {
    borderTopColor: 'rgba(255,255,255,0.08)',
    borderTopWidth: 1,
    gap: 8,
    marginTop: 'auto',
    paddingTop: 14,
  },
  backLink: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 9,
    minHeight: 36,
    paddingHorizontal: 8,
  },
  backLinkText: {
    color: '#a7b1d1',
    fontSize: 12,
    fontWeight: '700',
  },
  column: {
    flex: 1,
    flexDirection: 'column',
    minWidth: 0,
  },
  topbar: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 62,
    paddingHorizontal: 18,
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: 11,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  topbarCopy: {
    flex: 1,
    minWidth: 0,
  },
  breadcrumbRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 5,
  },
  breadcrumbText: {
    fontSize: 10,
    fontWeight: '700',
  },
  topbarTitle: {
    fontSize: 17,
    fontWeight: '900',
    marginTop: 3,
  },
  topbarSubtitle: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  topbarActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  content: {
    flex: 1,
    minHeight: 0,
  },
  bottomNav: {
    borderTopWidth: 1,
    flexDirection: 'row',
    paddingBottom: 6,
    paddingTop: 8,
  },
  bottomNavItem: {
    alignItems: 'center',
    flex: 1,
    gap: 3,
    minHeight: 52,
    paddingHorizontal: 2,
  },
  bottomNavLabel: {
    fontSize: 10,
    fontWeight: '800',
  },
});
