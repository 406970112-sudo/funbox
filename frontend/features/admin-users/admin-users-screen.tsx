import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import { Redirect, useRouter } from 'expo-router';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/features/auth/auth-provider';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  AdminUsersAPIError,
  getAdminUser,
  getAdminUsersErrorMessage,
  listAdminUserRoleChanges,
  listAdminUsers,
  updateAdminUserRole,
} from '@/lib/admin-users-api';
import { rolePresentation } from '@/lib/admin-users';
import { AppLoadingScreen } from '@/shared/ui/app-loading-screen';
import type { UserRole } from '@/types/access';
import type {
  AdminUserDetail,
  AdminUserRoleChange,
  AdminUserSummary,
} from '@/types/admin-user';

const pageSize = 20;
const assignableRoles = ['normal', 'vip', 'svip'] as const;
type AssignableRole = (typeof assignableRoles)[number];
type FormMessage = { text: string; tone: 'error' | 'success' };

export function AdminUsersScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { colors } = useAppTheme();
  const { accessToken, status: authStatus, user } = useAuth();
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim());
  const [roleFilter, setRoleFilter] = useState<UserRole | ''>('');
  const [offset, setOffset] = useState(0);
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [listLoading, setListLoading] = useState(true);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [changes, setChanges] = useState<AdminUserRoleChange[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [draftRole, setDraftRole] = useState<AssignableRole>('normal');
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<FormMessage | null>(null);
  const isDesktop = width >= 900;

  useEffect(() => {
    setOffset(0);
  }, [deferredSearch, roleFilter]);

  useEffect(() => {
    if (authStatus !== 'authenticated' || user?.role !== 'admin' || !accessToken) {
      setListLoading(false);
      return;
    }
    let active = true;
    setListLoading(true);
    setMessage(null);
    void listAdminUsers(accessToken, {
      limit: pageSize,
      offset,
      query: deferredSearch,
      role: roleFilter,
    })
      .then((result) => {
        if (!active) return;
        setUsers(result.users);
        setTotal(result.total);
      })
      .catch((error) => {
        if (active) setMessage({ text: getAdminUsersErrorMessage(error), tone: 'error' });
      })
      .finally(() => {
        if (active) setListLoading(false);
      });
    return () => {
      active = false;
    };
  }, [accessToken, authStatus, deferredSearch, offset, roleFilter, user?.role]);

  useEffect(() => {
    if (!accessToken || !selectedUserId) {
      setDetail(null);
      setChanges([]);
      return;
    }
    let active = true;
    setDetailLoading(true);
    setConfirming(false);
    setMessage(null);
    void Promise.all([
      getAdminUser(accessToken, selectedUserId),
      listAdminUserRoleChanges(accessToken, selectedUserId),
    ])
      .then(([nextDetail, history]) => {
        if (!active) return;
        setDetail(nextDetail);
        setDraftRole(nextDetail.role === 'admin' ? 'normal' : nextDetail.role);
        setReason('');
        setChanges(history.changes);
      })
      .catch((error) => {
        if (active) setMessage({ text: getAdminUsersErrorMessage(error), tone: 'error' });
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => {
      active = false;
    };
  }, [accessToken, selectedUserId]);

  const pageVipCount = useMemo(() => users.filter((account) => account.role === 'vip').length, [users]);
  const pageSvipCount = useMemo(() => users.filter((account) => account.role === 'svip').length, [users]);

  if (authStatus === 'loading') return <AppLoadingScreen />;
  if (authStatus !== 'authenticated' || user?.role !== 'admin' || !accessToken) {
    return <Redirect href="/profile" />;
  }
  const adminToken = accessToken;

  async function refreshSelectedUser() {
    if (!selectedUserId) return;
    const [nextDetail, history] = await Promise.all([
      getAdminUser(adminToken, selectedUserId),
      listAdminUserRoleChanges(adminToken, selectedUserId),
    ]);
    setDetail(nextDetail);
    setDraftRole(nextDetail.role === 'admin' ? 'normal' : nextDetail.role);
    setChanges(history.changes);
  }

  async function saveRole() {
    if (!detail || detail.role === 'admin' || saving || draftRole === detail.role) return;
    setSaving(true);
    setMessage(null);
    try {
      const result = await updateAdminUserRole(
        adminToken,
        detail.id,
        detail.role,
        draftRole,
        reason,
      );
      setDetail(result.user);
      setUsers((current) => current.map((item) => (
        item.id === result.user.id ? { ...item, role: result.user.role, updatedAt: result.user.updatedAt } : item
      )));
      setReason('');
      setConfirming(false);
      const history = await listAdminUserRoleChanges(adminToken, detail.id);
      setChanges(history.changes);
      setMessage({ text: result.changed ? '用户身份已更新并写入审计记录。' : '该用户已是目标身份。', tone: 'success' });
    } catch (error) {
      if (error instanceof AdminUsersAPIError && error.code === 'role_changed') {
        await refreshSelectedUser().catch(() => undefined);
      }
      setMessage({ text: getAdminUsersErrorMessage(error), tone: 'error' });
      setConfirming(false);
    } finally {
      setSaving(false);
    }
  }

  const editor = (
    <UserEditor
      changes={changes}
      confirming={confirming}
      detail={detail}
      draftRole={draftRole}
      loading={detailLoading}
      message={message}
      reason={reason}
      saving={saving}
      onCancelConfirm={() => setConfirming(false)}
      onChangeReason={setReason}
      onChangeRole={(role) => {
        setDraftRole(role);
        setConfirming(false);
        setMessage(null);
      }}
      onClose={() => setSelectedUserId(null)}
      onConfirm={() => setConfirming(true)}
      onSave={() => void saveRole()}
    />
  );

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={styles.appFrame}>
        {isDesktop ? <AdminRail onBack={() => router.push('/admin')} onNavigate={(path) => router.push(path)} /> : null}
        <View style={styles.workspace}>
          <View style={[styles.desktopHeader, { backgroundColor: colors.surface, borderBottomColor: colors.line }]}>
            {!isDesktop ? (
              <Pressable accessibilityLabel="返回" onPress={() => router.back()} style={styles.headerIconButton}>
                <MaterialCommunityIcons name="arrow-left" size={21} color={colors.text} />
              </Pressable>
            ) : null}
            <View style={styles.headerCopy}>
              <ThemedText style={styles.headerEyebrow}>管理后台 / 用户管理</ThemedText>
              <ThemedText style={styles.headerTitle}>用户身份</ThemedText>
            </View>
            <View style={[styles.adminBadge, { backgroundColor: colors.hero }]}>
              <MaterialCommunityIcons name="shield-crown-outline" size={18} color="#c9f36a" />
              {isDesktop ? <ThemedText style={styles.adminBadgeText}>管理员</ThemedText> : null}
            </View>
          </View>

          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={styles.titleRow}>
              <View style={styles.titleCopy}>
                <ThemedText style={styles.pageTitle}>管理用户身份</ThemedText>
                <ThemedText style={[styles.pageSubtitle, { color: colors.mutedText }]}>查询用户、调整普通用户 / VIP / SVIP，并保留完整变更记录</ThemedText>
              </View>
              <View style={[styles.policyBadge, { backgroundColor: colors.primarySoft }]}>
                <MaterialCommunityIcons name="shield-lock-outline" size={16} color={colors.primary} />
                <ThemedText style={[styles.policyBadgeText, { color: colors.primary }]}>管理员身份受保护</ThemedText>
              </View>
            </View>

            <View style={[styles.summaryBand, { backgroundColor: colors.hero }]}>
              <SummaryItem icon="account-group-outline" label="匹配用户" value={total} />
              <SummaryItem icon="diamond-stone" label="本页 VIP" value={pageVipCount} />
              <SummaryItem icon="crown-outline" label="本页 SVIP" value={pageSvipCount} />
            </View>

            <View style={styles.toolbar}>
              <View style={[styles.searchShell, { backgroundColor: colors.surface, borderColor: colors.line }]}>
                <MaterialCommunityIcons name="magnify" size={19} color={colors.mutedText} />
                <TextInput
                  accessibilityLabel="搜索用户"
                  onChangeText={setSearch}
                  placeholder="搜索昵称或手机号"
                  placeholderTextColor={colors.mutedText}
                  selectionColor={colors.primary}
                  style={[styles.searchInput, { color: colors.text }]}
                  value={search}
                />
                {search ? (
                  <Pressable accessibilityLabel="清空搜索" onPress={() => setSearch('')}>
                    <MaterialCommunityIcons name="close-circle" size={18} color={colors.mutedText} />
                  </Pressable>
                ) : null}
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
                {(['', 'normal', 'vip', 'svip', 'admin'] as const).map((role) => (
                  <FilterButton key={role || 'all'} role={role} selected={roleFilter === role} onPress={() => setRoleFilter(role)} />
                ))}
              </ScrollView>
            </View>

            {message && !selectedUserId ? <MessageBar message={message} /> : null}
            <UserTable
              desktop={isDesktop}
              loading={listLoading}
              selectedUserId={selectedUserId}
              users={users}
              onSelect={setSelectedUserId}
            />
            <Pagination
              hasNext={offset + pageSize < total}
              offset={offset}
              total={total}
              onNext={() => setOffset((current) => current + pageSize)}
              onPrevious={() => setOffset((current) => Math.max(0, current - pageSize))}
            />
          </ScrollView>
        </View>
        {isDesktop && selectedUserId ? (
          <View style={[styles.desktopDrawer, { backgroundColor: colors.surface, borderLeftColor: colors.line }]}>{editor}</View>
        ) : null}
      </View>
      {!isDesktop ? (
        <Modal animationType="slide" transparent visible={Boolean(selectedUserId)} onRequestClose={() => setSelectedUserId(null)}>
          <View style={styles.modalRoot}>
            <Pressable accessibilityLabel="关闭身份编辑" onPress={() => setSelectedUserId(null)} style={styles.modalBackdrop} />
            <View style={[styles.mobileSheet, { backgroundColor: colors.surface }]}>{editor}</View>
          </View>
        </Modal>
      ) : null}
    </SafeAreaView>
  );
}

function AdminRail({ onBack, onNavigate }: { onBack: () => void; onNavigate: (path: '/admin/permissions' | '/admin/feedback') => void }) {
  return (
    <View style={styles.rail}>
      <Pressable accessibilityRole="button" onPress={onBack} style={styles.brandRow}>
        <View style={styles.brandMark}><ThemedText style={styles.brandMarkText}>F</ThemedText></View>
        <ThemedText style={styles.brandText}>FunBox</ThemedText>
      </Pressable>
      <ThemedText style={styles.railSection}>管理工具</ThemedText>
      <View style={styles.railNav}>
        <RailItem active icon="account-key-outline" label="用户身份" onPress={() => undefined} />
        <RailItem icon="key-outline" label="入口权限" onPress={() => onNavigate('/admin/permissions')} />
        <RailItem icon="message-alert-outline" label="问题反馈" onPress={() => onNavigate('/admin/feedback')} />
      </View>
      <View style={styles.railFooter}>
        <MaterialCommunityIcons name="shield-check-outline" size={17} color="#c9f36a" />
        <ThemedText style={styles.railFooterText}>管理员控制台</ThemedText>
      </View>
    </View>
  );
}

function RailItem({ active = false, icon, label, onPress }: { active?: boolean; icon: keyof typeof MaterialCommunityIcons.glyphMap; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.railItem, active && styles.railItemActive]}>
      <MaterialCommunityIcons name={icon} size={19} color={active ? '#c9f36a' : '#a7b1d1'} />
      <ThemedText style={[styles.railItemText, active && styles.railItemTextActive]}>{label}</ThemedText>
    </Pressable>
  );
}

function SummaryItem({ icon, label, value }: { icon: keyof typeof MaterialCommunityIcons.glyphMap; label: string; value: number }) {
  return (
    <View style={styles.summaryItem}>
      <View style={styles.summaryIcon}><MaterialCommunityIcons name={icon} size={18} color="#c9f36a" /></View>
      <View><ThemedText style={styles.summaryValue}>{value}</ThemedText><ThemedText style={styles.summaryLabel}>{label}</ThemedText></View>
    </View>
  );
}

function FilterButton({ onPress, role, selected }: { onPress: () => void; role: UserRole | ''; selected: boolean }) {
  const { colors } = useAppTheme();
  const item = role ? rolePresentation(role) : { color: colors.primary, icon: 'account-multiple-outline' as const, label: '全部' };
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={[styles.filterButton, { backgroundColor: selected ? `${item.color}18` : colors.surface, borderColor: selected ? item.color : colors.line }]}>
      <MaterialCommunityIcons name={item.icon} size={15} color={selected ? item.color : colors.mutedText} />
      <ThemedText style={[styles.filterText, { color: selected ? item.color : colors.mutedText }]}>{item.label}</ThemedText>
    </Pressable>
  );
}

function UserTable({ desktop, loading, onSelect, selectedUserId, users }: { desktop: boolean; loading: boolean; onSelect: (id: string) => void; selectedUserId: string | null; users: AdminUserSummary[] }) {
  const { colors } = useAppTheme();
  if (loading) return <View style={[styles.statePanel, { backgroundColor: colors.surface, borderColor: colors.line }]}><ActivityIndicator color={colors.primary} /><ThemedText style={[styles.stateText, { color: colors.mutedText }]}>正在加载用户...</ThemedText></View>;
  if (!users.length) return <View style={[styles.statePanel, { backgroundColor: colors.surface, borderColor: colors.line }]}><MaterialCommunityIcons name="account-search-outline" size={30} color={colors.mutedText} /><ThemedText style={styles.emptyTitle}>没有匹配的用户</ThemedText><ThemedText style={[styles.stateText, { color: colors.mutedText }]}>调整关键词或身份筛选后再试</ThemedText></View>;
  return (
    <View style={[styles.table, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      {desktop ? <View style={[styles.tableHeader, { backgroundColor: colors.surfaceMuted }]}><ThemedText style={[styles.columnUser, styles.columnLabel]}>用户</ThemedText><ThemedText style={[styles.columnPhone, styles.columnLabel]}>手机号</ThemedText><ThemedText style={[styles.columnRole, styles.columnLabel]}>身份</ThemedText><ThemedText style={[styles.columnDate, styles.columnLabel]}>更新时间</ThemedText><View style={styles.columnAction} /></View> : null}
      {users.map((account) => <UserRow account={account} desktop={desktop} key={account.id} selected={account.id === selectedUserId} onPress={() => onSelect(account.id)} />)}
    </View>
  );
}

function UserRow({ account, desktop, onPress, selected }: { account: AdminUserSummary; desktop: boolean; onPress: () => void; selected: boolean }) {
  const { colors } = useAppTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.userRow, !desktop && styles.userRowMobile, { borderTopColor: colors.line, backgroundColor: selected ? colors.primarySoft : pressed ? colors.surfaceMuted : colors.surface }]}>
      <View style={[styles.columnUser, styles.userIdentity]}><UserAvatar account={account} /><View style={styles.userCopy}><ThemedText numberOfLines={1} style={styles.userName}>{account.displayName}</ThemedText>{!desktop ? <ThemedText style={[styles.userPhone, { color: colors.mutedText }]}>{account.maskedUsername}</ThemedText> : <ThemedText numberOfLines={1} style={[styles.userId, { color: colors.mutedText }]}>ID {account.id.slice(0, 8)}</ThemedText>}</View></View>
      {desktop ? <ThemedText style={[styles.columnPhone, styles.cellText]}>{account.maskedUsername}</ThemedText> : null}
      <View style={desktop ? styles.columnRole : styles.mobileRole}><RoleBadge role={account.role} /></View>
      {desktop ? <ThemedText style={[styles.columnDate, styles.cellText, { color: colors.mutedText }]}>{formatDate(account.updatedAt)}</ThemedText> : null}
      <View style={styles.columnAction}><MaterialCommunityIcons name="chevron-right" size={20} color={colors.mutedText} /></View>
    </Pressable>
  );
}

function UserAvatar({ account }: { account: Pick<AdminUserSummary, 'avatarUrl' | 'displayName'> }) {
  const { colors } = useAppTheme();
  if (account.avatarUrl) return <Image source={{ uri: account.avatarUrl }} style={styles.avatar} contentFit="cover" />;
  return <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: colors.primarySoft }]}><ThemedText style={[styles.avatarText, { color: colors.primary }]}>{account.displayName.slice(0, 1).toUpperCase()}</ThemedText></View>;
}

function RoleBadge({ role }: { role: UserRole }) {
  const item = rolePresentation(role);
  return <View style={[styles.roleBadge, { backgroundColor: `${item.color}16` }]}><MaterialCommunityIcons name={item.icon} size={14} color={item.color} /><ThemedText style={[styles.roleBadgeText, { color: item.color }]}>{item.label}</ThemedText></View>;
}

function Pagination({ hasNext, offset, onNext, onPrevious, total }: { hasNext: boolean; offset: number; onNext: () => void; onPrevious: () => void; total: number }) {
  const { colors } = useAppTheme();
  if (total <= pageSize) return null;
  return <View style={styles.pagination}><ThemedText style={[styles.paginationText, { color: colors.mutedText }]}>第 {Math.floor(offset / pageSize) + 1} 页，共 {Math.ceil(total / pageSize)} 页</ThemedText><View style={styles.paginationActions}><PageButton disabled={offset === 0} icon="chevron-left" label="上一页" onPress={onPrevious} /><PageButton disabled={!hasNext} icon="chevron-right" label="下一页" onPress={onNext} /></View></View>;
}

function PageButton({ disabled, icon, label, onPress }: { disabled: boolean; icon: 'chevron-left' | 'chevron-right'; label: string; onPress: () => void }) {
  const { colors } = useAppTheme();
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.pageButton, { backgroundColor: colors.surface, borderColor: colors.line, opacity: disabled ? 0.42 : 1 }]}><MaterialCommunityIcons name={icon} size={17} color={colors.text} /><ThemedText style={styles.pageButtonText}>{label}</ThemedText></Pressable>;
}

function UserEditor({ changes, confirming, detail, draftRole, loading, message, onCancelConfirm, onChangeReason, onChangeRole, onClose, onConfirm, onSave, reason, saving }: { changes: AdminUserRoleChange[]; confirming: boolean; detail: AdminUserDetail | null; draftRole: AssignableRole; loading: boolean; message: FormMessage | null; onCancelConfirm: () => void; onChangeReason: (value: string) => void; onChangeRole: (role: AssignableRole) => void; onClose: () => void; onConfirm: () => void; onSave: () => void; reason: string; saving: boolean }) {
  const { colors } = useAppTheme();
  if (loading || !detail) return <View style={styles.drawerLoading}><ActivityIndicator color={colors.primary} /><ThemedText style={[styles.stateText, { color: colors.mutedText }]}>正在读取用户详情...</ThemedText></View>;
  const protectedAdmin = detail.role === 'admin';
  const changed = !protectedAdmin && draftRole !== detail.role;
  const downgrade = changed && roleRank(draftRole) < roleRank(detail.role);
  return (
    <View style={styles.editorRoot}>
      <View style={[styles.drawerHeader, { borderBottomColor: colors.line }]}><View><ThemedText style={styles.drawerTitle}>调整用户身份</ThemedText><ThemedText style={[styles.drawerSubtitle, { color: colors.mutedText }]}>用户详情与变更记录</ThemedText></View><Pressable accessibilityLabel="关闭" onPress={onClose} style={styles.closeButton}><MaterialCommunityIcons name="close" size={21} color={colors.text} /></Pressable></View>
      <ScrollView contentContainerStyle={styles.editorScroll} showsVerticalScrollIndicator={false}>
        <View style={styles.profileRow}><UserAvatar account={detail} /><View style={styles.profileCopy}><ThemedText style={styles.profileName}>{detail.displayName}</ThemedText><ThemedText style={[styles.profilePhone, { color: colors.mutedText }]}>{detail.username}</ThemedText></View><RoleBadge role={detail.role} /></View>
        <View style={[styles.metaStrip, { backgroundColor: colors.surfaceMuted }]}><MetaItem label="用户 ID" value={detail.id.slice(0, 12)} /><MetaItem label="注册时间" value={formatDate(detail.createdAt)} /></View>
        {protectedAdmin ? <View style={[styles.notice, { backgroundColor: '#151b3b10' }]}><MaterialCommunityIcons name="shield-lock-outline" size={19} color={colors.hero} /><ThemedText style={[styles.noticeText, { color: colors.hero }]}>管理员身份由系统保护，不能在用户身份页面调整。</ThemedText></View> : <><View style={styles.formSection}><ThemedText style={styles.sectionLabel}>目标身份</ThemedText><View style={styles.roleOptions}>{assignableRoles.map((role) => <RoleOption key={role} role={role} selected={draftRole === role} onPress={() => onChangeRole(role)} />)}</View></View><View style={styles.formSection}><View style={styles.reasonHeading}><ThemedText style={styles.sectionLabel}>调整原因</ThemedText><ThemedText style={[styles.reasonCount, { color: colors.mutedText }]}>{reason.length}/100</ThemedText></View><TextInput accessibilityLabel="调整原因" maxLength={100} multiline onChangeText={onChangeReason} placeholder="选填，建议记录工单号或业务原因" placeholderTextColor={colors.mutedText} selectionColor={colors.primary} style={[styles.reasonInput, { backgroundColor: colors.surfaceMuted, borderColor: colors.line, color: colors.text }]} textAlignVertical="top" value={reason} /></View>{downgrade ? <View style={[styles.notice, { backgroundColor: '#e8667a12' }]}><MaterialCommunityIcons name="alert-outline" size={19} color="#e8667a" /><ThemedText style={[styles.noticeText, { color: '#b34f61' }]}>这是降级操作，用户可能立即失去对应功能权限。</ThemedText></View> : null}{message ? <MessageBar message={message} /> : null}{confirming ? <View style={[styles.confirmBox, { borderColor: colors.primary, backgroundColor: colors.primarySoft }]}><ThemedText style={styles.confirmTitle}>确认身份调整</ThemedText><ThemedText style={[styles.confirmBody, { color: colors.mutedText }]}>将 {detail.displayName} 从“{rolePresentation(detail.role).label}”调整为“{rolePresentation(draftRole).label}”？</ThemedText><View style={styles.confirmActions}><Pressable accessibilityRole="button" onPress={onCancelConfirm} style={[styles.secondaryButton, { borderColor: colors.line }]}><ThemedText style={styles.secondaryButtonText}>取消</ThemedText></Pressable><Pressable accessibilityRole="button" disabled={saving} onPress={onSave} style={[styles.primaryButton, { backgroundColor: colors.primary }]}>{saving ? <ActivityIndicator color="#fff" size="small" /> : <><MaterialCommunityIcons name="check" size={18} color="#fff" /><ThemedText style={styles.primaryButtonText}>确认变更</ThemedText></>}</Pressable></View></View> : <Pressable accessibilityRole="button" disabled={!changed} onPress={onConfirm} style={[styles.saveButton, { backgroundColor: colors.primary, opacity: changed ? 1 : 0.44 }]}><MaterialCommunityIcons name="account-convert-outline" size={19} color="#fff" /><ThemedText style={styles.saveButtonText}>确认调整</ThemedText></Pressable>}</>}
        <View style={[styles.auditSection, { borderTopColor: colors.line }]}><View style={styles.auditHeading}><ThemedText style={styles.sectionLabel}>变更记录</ThemedText><ThemedText style={[styles.auditCount, { color: colors.mutedText }]}>{changes.length} 条</ThemedText></View>{changes.length ? changes.map((change) => <AuditRow change={change} key={change.id} />) : <View style={styles.auditEmpty}><MaterialCommunityIcons name="history" size={22} color={colors.mutedText} /><ThemedText style={[styles.stateText, { color: colors.mutedText }]}>暂无身份变更记录</ThemedText></View>}</View>
      </ScrollView>
    </View>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) { const { colors } = useAppTheme(); return <View style={styles.metaItem}><ThemedText style={[styles.metaLabel, { color: colors.mutedText }]}>{label}</ThemedText><ThemedText numberOfLines={1} style={styles.metaValue}>{value}</ThemedText></View>; }
function RoleOption({ onPress, role, selected }: { onPress: () => void; role: AssignableRole; selected: boolean }) { const { colors } = useAppTheme(); const item = rolePresentation(role); return <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected }} onPress={onPress} style={[styles.roleOption, { backgroundColor: selected ? `${item.color}16` : colors.surface, borderColor: selected ? item.color : colors.line }]}><MaterialCommunityIcons name={item.icon} size={18} color={item.color} /><ThemedText style={[styles.roleOptionText, { color: selected ? item.color : colors.text }]}>{item.label}</ThemedText><MaterialCommunityIcons name={selected ? 'radiobox-marked' : 'radiobox-blank'} size={17} color={selected ? item.color : colors.mutedText} /></Pressable>; }
function AuditRow({ change }: { change: AdminUserRoleChange }) { const { colors } = useAppTheme(); return <View style={[styles.auditRow, { borderTopColor: colors.line }]}><View style={[styles.auditDot, { backgroundColor: rolePresentation(change.toRole).color }]} /><View style={styles.auditCopy}><View style={styles.auditRoles}><ThemedText style={styles.auditRoleText}>{rolePresentation(change.fromRole).label}</ThemedText><MaterialCommunityIcons name="arrow-right" size={14} color={colors.mutedText} /><ThemedText style={styles.auditRoleText}>{rolePresentation(change.toRole).label}</ThemedText></View><ThemedText style={[styles.auditMeta, { color: colors.mutedText }]}>{change.operatorDisplayName} · {formatDateTime(change.createdAt)}</ThemedText>{change.reason ? <ThemedText style={[styles.auditReason, { color: colors.mutedText }]}>原因：{change.reason}</ThemedText> : null}</View></View>; }
function MessageBar({ message }: { message: FormMessage }) { const { colors } = useAppTheme(); const tone = message.tone === 'success' ? colors.success : '#d86f5b'; return <View style={[styles.messageBar, { backgroundColor: `${tone}14` }]}><MaterialCommunityIcons name={message.tone === 'success' ? 'check-circle-outline' : 'alert-circle-outline'} size={17} color={tone} /><ThemedText style={[styles.messageText, { color: tone }]}>{message.text}</ThemedText></View>; }
function roleRank(role: UserRole) { return ({ admin: 3, normal: 0, svip: 2, vip: 1 } as const)[role]; }
function formatDate(value: string) { return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(new Date(value)); }
function formatDateTime(value: string) { return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)); }

const styles = StyleSheet.create({
  safeArea: { flex: 1 }, appFrame: { flex: 1, flexDirection: 'row' }, workspace: { flex: 1, minWidth: 0 },
  rail: { backgroundColor: '#151b3b', padding: 18, width: 196 }, brandRow: { alignItems: 'center', flexDirection: 'row', gap: 10, minHeight: 48 }, brandMark: { alignItems: 'center', backgroundColor: '#c9f36a', borderRadius: 8, height: 32, justifyContent: 'center', width: 32 }, brandMarkText: { color: '#151b3b', fontSize: 17, fontWeight: '900' }, brandText: { color: '#fff', fontSize: 17, fontWeight: '900' }, railSection: { color: '#7380a8', fontSize: 10, fontWeight: '800', marginBottom: 8, marginTop: 28, textTransform: 'uppercase' }, railNav: { gap: 5 }, railItem: { alignItems: 'center', borderRadius: 7, flexDirection: 'row', gap: 10, minHeight: 42, paddingHorizontal: 10 }, railItemActive: { backgroundColor: 'rgba(201,243,106,0.10)' }, railItemText: { color: '#a7b1d1', fontSize: 12, fontWeight: '700' }, railItemTextActive: { color: '#fff' }, railFooter: { alignItems: 'center', borderTopColor: 'rgba(255,255,255,0.08)', borderTopWidth: 1, bottom: 20, flexDirection: 'row', gap: 8, left: 18, paddingTop: 15, position: 'absolute', right: 18 }, railFooterText: { color: '#a7b1d1', fontSize: 10, fontWeight: '700' },
  desktopHeader: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', minHeight: 68, paddingHorizontal: 24 }, headerIconButton: { alignItems: 'center', height: 40, justifyContent: 'center', marginRight: 8, width: 40 }, headerCopy: { flex: 1 }, headerEyebrow: { color: '#7483a2', fontSize: 9, fontWeight: '700' }, headerTitle: { fontSize: 16, fontWeight: '900', marginTop: 2 }, adminBadge: { alignItems: 'center', borderRadius: 7, flexDirection: 'row', gap: 7, minHeight: 34, paddingHorizontal: 10 }, adminBadgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  content: { alignSelf: 'center', gap: 16, maxWidth: 1180, padding: 24, width: '100%' }, titleRow: { alignItems: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between' }, titleCopy: { flex: 1, minWidth: 240 }, pageTitle: { fontSize: 24, fontWeight: '900', lineHeight: 30 }, pageSubtitle: { fontSize: 12, lineHeight: 18, marginTop: 4 }, policyBadge: { alignItems: 'center', borderRadius: 7, flexDirection: 'row', gap: 7, minHeight: 34, paddingHorizontal: 11 }, policyBadgeText: { fontSize: 10, fontWeight: '800' },
  summaryBand: { borderRadius: 8, flexDirection: 'row', minHeight: 88, overflow: 'hidden', padding: 16 }, summaryItem: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 11, minWidth: 0, paddingHorizontal: 10 }, summaryIcon: { alignItems: 'center', backgroundColor: 'rgba(201,243,106,0.10)', borderRadius: 7, height: 38, justifyContent: 'center', width: 38 }, summaryValue: { color: '#fff', fontSize: 20, fontWeight: '900', lineHeight: 24 }, summaryLabel: { color: '#aab4d2', fontSize: 9, fontWeight: '700', marginTop: 2 },
  toolbar: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, searchShell: { alignItems: 'center', borderRadius: 7, borderWidth: 1, flexDirection: 'row', gap: 8, minHeight: 42, minWidth: 250, paddingHorizontal: 12 }, searchInput: { flex: 1, fontSize: 12, minWidth: 0, paddingVertical: 8 }, filters: { gap: 7 }, filterButton: { alignItems: 'center', borderRadius: 7, borderWidth: 1, flexDirection: 'row', gap: 5, minHeight: 36, paddingHorizontal: 10 }, filterText: { fontSize: 10, fontWeight: '800' },
  table: { borderRadius: 8, borderWidth: 1, overflow: 'hidden' }, tableHeader: { alignItems: 'center', flexDirection: 'row', minHeight: 38, paddingHorizontal: 14 }, columnLabel: { color: '#7483a2', fontSize: 9, fontWeight: '800' }, userRow: { alignItems: 'center', borderTopWidth: 1, flexDirection: 'row', minHeight: 67, paddingHorizontal: 14 }, userRowMobile: { borderTopWidth: 1, minHeight: 76, paddingHorizontal: 12 }, columnUser: { flex: 2.1, minWidth: 0 }, columnPhone: { flex: 1.25, minWidth: 105 }, columnRole: { flex: 1.1, minWidth: 98 }, columnDate: { flex: 1.1, minWidth: 100 }, columnAction: { alignItems: 'flex-end', width: 30 }, userIdentity: { alignItems: 'center', flexDirection: 'row', gap: 10 }, avatar: { borderRadius: 18, height: 36, width: 36 }, avatarFallback: { alignItems: 'center', justifyContent: 'center' }, avatarText: { fontSize: 13, fontWeight: '900' }, userCopy: { flex: 1, minWidth: 0 }, userName: { fontSize: 12, fontWeight: '900' }, userId: { fontSize: 8, marginTop: 3 }, userPhone: { fontSize: 10, marginTop: 4 }, cellText: { fontSize: 10 }, mobileRole: { marginLeft: 'auto', marginRight: 8 }, roleBadge: { alignItems: 'center', alignSelf: 'flex-start', borderRadius: 6, flexDirection: 'row', gap: 4, minHeight: 26, paddingHorizontal: 7 }, roleBadgeText: { fontSize: 9, fontWeight: '900' },
  statePanel: { alignItems: 'center', borderRadius: 8, borderWidth: 1, gap: 8, justifyContent: 'center', minHeight: 180, padding: 22 }, stateText: { fontSize: 11, textAlign: 'center' }, emptyTitle: { fontSize: 14, fontWeight: '900' }, pagination: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }, paginationText: { fontSize: 10 }, paginationActions: { flexDirection: 'row', gap: 8 }, pageButton: { alignItems: 'center', borderRadius: 7, borderWidth: 1, flexDirection: 'row', gap: 4, minHeight: 34, paddingHorizontal: 9 }, pageButtonText: { fontSize: 10, fontWeight: '800' },
  desktopDrawer: { borderLeftWidth: 1, width: 408 }, editorRoot: { flex: 1 }, drawerHeader: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', minHeight: 68, paddingHorizontal: 18 }, drawerTitle: { fontSize: 15, fontWeight: '900' }, drawerSubtitle: { fontSize: 9, marginTop: 2 }, closeButton: { alignItems: 'center', height: 36, justifyContent: 'center', width: 36 }, drawerLoading: { alignItems: 'center', flex: 1, gap: 9, justifyContent: 'center' }, editorScroll: { gap: 16, padding: 18, paddingBottom: 36 }, profileRow: { alignItems: 'center', flexDirection: 'row', gap: 10 }, profileCopy: { flex: 1, minWidth: 0 }, profileName: { fontSize: 14, fontWeight: '900' }, profilePhone: { fontSize: 10, marginTop: 3 }, metaStrip: { borderRadius: 7, flexDirection: 'row', gap: 14, padding: 11 }, metaItem: { flex: 1, minWidth: 0 }, metaLabel: { fontSize: 8, fontWeight: '700' }, metaValue: { fontSize: 10, fontWeight: '800', marginTop: 3 }, formSection: { gap: 8 }, sectionLabel: { fontSize: 11, fontWeight: '900' }, roleOptions: { flexDirection: 'row', gap: 6 }, roleOption: { alignItems: 'center', borderRadius: 7, borderWidth: 1, flex: 1, flexDirection: 'row', gap: 5, minHeight: 40, paddingHorizontal: 7 }, roleOptionText: { flex: 1, fontSize: 9, fontWeight: '900' }, reasonHeading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }, reasonCount: { fontSize: 9 }, reasonInput: { borderRadius: 7, borderWidth: 1, fontSize: 11, minHeight: 76, padding: 10 }, notice: { alignItems: 'flex-start', borderRadius: 7, flexDirection: 'row', gap: 8, padding: 11 }, noticeText: { flex: 1, fontSize: 10, fontWeight: '700', lineHeight: 16 }, saveButton: { alignItems: 'center', borderRadius: 7, flexDirection: 'row', gap: 7, justifyContent: 'center', minHeight: 42 }, saveButtonText: { color: '#fff', fontSize: 11, fontWeight: '900' }, confirmBox: { borderRadius: 7, borderWidth: 1, gap: 7, padding: 11 }, confirmTitle: { fontSize: 11, fontWeight: '900' }, confirmBody: { fontSize: 10, lineHeight: 15 }, confirmActions: { flexDirection: 'row', gap: 7, justifyContent: 'flex-end', marginTop: 3 }, secondaryButton: { alignItems: 'center', borderRadius: 6, borderWidth: 1, justifyContent: 'center', minHeight: 34, paddingHorizontal: 13 }, secondaryButtonText: { fontSize: 10, fontWeight: '800' }, primaryButton: { alignItems: 'center', borderRadius: 6, flexDirection: 'row', gap: 5, justifyContent: 'center', minHeight: 34, minWidth: 92, paddingHorizontal: 12 }, primaryButtonText: { color: '#fff', fontSize: 10, fontWeight: '900' },
  auditSection: { borderTopWidth: 1, gap: 8, paddingTop: 15 }, auditHeading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }, auditCount: { fontSize: 9 }, auditRow: { alignItems: 'flex-start', borderTopWidth: 1, flexDirection: 'row', gap: 9, paddingVertical: 10 }, auditDot: { borderRadius: 4, height: 8, marginTop: 4, width: 8 }, auditCopy: { flex: 1, minWidth: 0 }, auditRoles: { alignItems: 'center', flexDirection: 'row', gap: 5 }, auditRoleText: { fontSize: 10, fontWeight: '900' }, auditMeta: { fontSize: 8, marginTop: 4 }, auditReason: { fontSize: 9, lineHeight: 14, marginTop: 4 }, auditEmpty: { alignItems: 'center', gap: 7, paddingVertical: 18 }, messageBar: { alignItems: 'flex-start', borderRadius: 7, flexDirection: 'row', gap: 7, padding: 10 }, messageText: { flex: 1, fontSize: 10, fontWeight: '700', lineHeight: 15 },
  modalRoot: { flex: 1, justifyContent: 'flex-end' }, modalBackdrop: { backgroundColor: 'rgba(15,19,23,0.42)', flex: 1 }, mobileSheet: { borderTopLeftRadius: 16, borderTopRightRadius: 16, height: '86%', overflow: 'hidden' },
});
