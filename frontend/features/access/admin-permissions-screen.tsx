import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Redirect, useRouter } from 'expo-router';
import {
  startTransition,
  type ComponentProps,
  useDeferredValue,
  useEffect,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useFeatureAccess } from '@/features/access/feature-access-provider';
import { useAuth } from '@/features/auth/auth-provider';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  getAccessErrorMessage,
  getManagedFeatures,
  updateManagedFeatureGrant,
  updateManagedFeatureRoles,
} from '@/lib/access-api';
import { isValidPhoneAccount, normalizePhoneInput } from '@/lib/auth-validation';
import { getToolById } from '@/mocks/app-data';
import { AppLoadingScreen } from '@/shared/ui/app-loading-screen';
import { MobileScreen } from '@/shared/ui/mobile-screen';
import type { ManagedFeature, UserRole } from '@/types/access';

const configurableRoles: Array<{
  color: string;
  icon: ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  role: UserRole;
}> = [
  { color: '#7483a2', icon: 'account-outline', label: '普通会员', role: 'normal' },
  { color: '#4b6bff', icon: 'diamond-stone', label: 'VIP', role: 'vip' },
  { color: '#e8667a', icon: 'crown-outline', label: 'SVIP', role: 'svip' },
  { color: '#151b3b', icon: 'shield-check-outline', label: '管理员', role: 'admin' },
];

type FormMessage = {
  text: string;
  tone: 'error' | 'success';
};

export function AdminPermissionsScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { accessToken, status: authStatus, user } = useAuth();
  const { refresh: refreshVisibleTools } = useFeatureAccess();
  const [features, setFeatures] = useState<ManagedFeature[]>([]);
  const [expandedFeatureID, setExpandedFeatureID] = useState<string | null>(null);
  const [grantUsername, setGrantUsername] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingFeatureID, setSavingFeatureID] = useState<string | null>(null);
  const [message, setMessage] = useState<FormMessage | null>(null);
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());

  useEffect(() => {
    if (authStatus !== 'authenticated' || user?.role !== 'admin' || !accessToken) {
      setLoading(false);
      return;
    }
    let active = true;
    void getManagedFeatures(accessToken)
      .then((result) => {
        if (!active) return;
        setFeatures(result);
        setExpandedFeatureID(result[0]?.id ?? null);
      })
      .catch((error) => {
        if (active) setMessage({ text: getAccessErrorMessage(error), tone: 'error' });
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [accessToken, authStatus, user?.role]);

  if (authStatus === 'loading' || loading) {
    return <AppLoadingScreen />;
  }
  if (authStatus !== 'authenticated' || user?.role !== 'admin' || !accessToken) {
    return <Redirect href="/profile" />;
  }
  const adminToken = accessToken;

  const filteredFeatures = features.filter((feature) => {
    if (!deferredSearch) return true;
    return `${feature.name} ${feature.category}`.toLowerCase().includes(deferredSearch);
  });
  const restrictedCount = features.filter((feature) => feature.roles.length < 4).length;
  const grantCount = features.reduce((total, feature) => total + feature.grantCount, 0);

  function applyFeatures(nextFeatures: ManagedFeature[], successMessage: string) {
    startTransition(() => setFeatures(nextFeatures));
    refreshVisibleTools();
    setMessage({ text: successMessage, tone: 'success' });
  }

  async function toggleRole(feature: ManagedFeature, role: UserRole) {
    if (role === 'admin' || savingFeatureID) return;
    setMessage(null);
    setSavingFeatureID(feature.id);
    const roles = feature.roles.includes(role)
      ? feature.roles.filter((candidate) => candidate !== role)
      : [...feature.roles, role];
    try {
      const nextFeatures = await updateManagedFeatureRoles(adminToken, feature.id, roles);
      applyFeatures(nextFeatures, `${feature.name}的身份权限已更新。`);
    } catch (error) {
      setMessage({ text: getAccessErrorMessage(error), tone: 'error' });
    } finally {
      setSavingFeatureID(null);
    }
  }

  async function setGrant(feature: ManagedFeature, username: string, granted: boolean) {
    if (savingFeatureID) return;
    setMessage(null);
    setSavingFeatureID(feature.id);
    try {
      const nextFeatures = await updateManagedFeatureGrant(
        adminToken,
        feature.id,
        username,
        granted,
      );
      applyFeatures(nextFeatures, granted ? '已添加用户特批。' : '已移除用户特批。');
      if (granted) setGrantUsername('');
    } catch (error) {
      setMessage({ text: getAccessErrorMessage(error), tone: 'error' });
    } finally {
      setSavingFeatureID(null);
    }
  }

  function addGrant(feature: ManagedFeature) {
    if (!isValidPhoneAccount(grantUsername)) {
      setMessage({ text: '请输入正确的 11 位用户手机号。', tone: 'error' });
      return;
    }
    void setGrant(feature, grantUsername, true);
  }

  return (
    <MobileScreen contentContainerStyle={styles.pageContent}>
      <View style={styles.topBar}>
        <Pressable
          accessibilityLabel="返回"
          accessibilityRole="button"
          onPress={() => router.back()}
          style={[styles.iconButton, { backgroundColor: colors.surface }]}>
          <MaterialCommunityIcons name="arrow-left" size={20} color={colors.text} />
        </Pressable>
        <View style={styles.topBarCopy}>
          <ThemedText style={styles.pageTitle}>入口权限</ThemedText>
          <ThemedText style={[styles.pageSubtitle, { color: colors.mutedText }]}>管理后台</ThemedText>
        </View>
        <View style={[styles.adminMark, { backgroundColor: colors.hero }]}>
          <MaterialCommunityIcons name="shield-crown-outline" size={19} color="#c9f36a" />
        </View>
      </View>

      <View style={[styles.summaryBand, { backgroundColor: colors.hero }]}>
        <SummaryItem label="功能入口" value={features.length} />
        <View style={styles.summaryDivider} />
        <SummaryItem label="身份受限" value={restrictedCount} />
        <View style={styles.summaryDivider} />
        <SummaryItem label="用户特批" value={grantCount} />
      </View>

      <View style={[styles.policyRow, { backgroundColor: colors.primarySoft }]}>
        <MaterialCommunityIcons name="shield-lock-outline" size={18} color={colors.primary} />
        <ThemedText style={[styles.policyText, { color: colors.primary }]}>新入口默认仅管理员可见</ThemedText>
      </View>

      <View
        style={[
          styles.searchShell,
          { backgroundColor: colors.surface, borderColor: colors.line },
        ]}>
        <MaterialCommunityIcons name="magnify" size={19} color={colors.mutedText} />
        <TextInput
          onChangeText={setSearch}
          placeholder="搜索功能名称或分类"
          placeholderTextColor={colors.mutedText}
          selectionColor={colors.primary}
          style={[styles.searchInput, { color: colors.text }]}
          value={search}
        />
      </View>

      {message ? <MessageRow message={message} /> : null}

      <View style={styles.featureList}>
        {filteredFeatures.map((feature) => (
          <FeaturePermissionCard
            expanded={expandedFeatureID === feature.id}
            feature={feature}
            grantUsername={expandedFeatureID === feature.id ? grantUsername : ''}
            key={feature.id}
            saving={savingFeatureID === feature.id}
            onAddGrant={() => addGrant(feature)}
            onChangeGrantUsername={(value) => setGrantUsername(normalizePhoneInput(value))}
            onRemoveGrant={(username) => void setGrant(feature, username, false)}
            onToggleExpanded={() => {
              setExpandedFeatureID((current) => (current === feature.id ? null : feature.id));
              setGrantUsername('');
              setMessage(null);
            }}
            onToggleRole={(role) => void toggleRole(feature, role)}
          />
        ))}
      </View>
    </MobileScreen>
  );
}

type FeaturePermissionCardProps = {
  expanded: boolean;
  feature: ManagedFeature;
  grantUsername: string;
  onAddGrant: () => void;
  onChangeGrantUsername: (value: string) => void;
  onRemoveGrant: (username: string) => void;
  onToggleExpanded: () => void;
  onToggleRole: (role: UserRole) => void;
  saving: boolean;
};

function FeaturePermissionCard({
  expanded,
  feature,
  grantUsername,
  onAddGrant,
  onChangeGrantUsername,
  onRemoveGrant,
  onToggleExpanded,
  onToggleRole,
  saving,
}: FeaturePermissionCardProps) {
  const { colors } = useAppTheme();
  const tool = getToolById(feature.id);
  const accentColor = tool?.accentColor ?? colors.primary;

  return (
    <View style={[styles.featureCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={onToggleExpanded}
        style={styles.featureHeader}>
        <View style={[styles.featureIcon, { backgroundColor: `${accentColor}18` }]}>
          <MaterialCommunityIcons
            name={tool?.icon ?? 'puzzle-outline'}
            size={21}
            color={accentColor}
          />
        </View>
        <View style={styles.featureCopy}>
          <ThemedText numberOfLines={1} style={styles.featureName}>{feature.name}</ThemedText>
          <ThemedText style={[styles.featureMeta, { color: colors.mutedText }]}>
            {feature.category} · {feature.roles.length} 个身份 · {feature.grantCount} 个特批
          </ThemedText>
        </View>
        {saving ? (
          <ActivityIndicator color={colors.primary} size="small" />
        ) : (
          <MaterialCommunityIcons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={22}
            color={colors.mutedText}
          />
        )}
      </Pressable>

      {expanded ? (
        <View style={[styles.featureEditor, { borderTopColor: colors.line }]}>
          <ThemedText style={styles.editorLabel}>展示身份</ThemedText>
          <View style={styles.roleGrid}>
            {configurableRoles.map((item) => {
              const selected = feature.roles.includes(item.role);
              const locked = item.role === 'admin';
              return (
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected, disabled: locked || saving }}
                  disabled={locked || saving}
                  key={item.role}
                  onPress={() => onToggleRole(item.role)}
                  style={[
                    styles.roleButton,
                    {
                      backgroundColor: selected ? `${item.color}18` : colors.surfaceMuted,
                      borderColor: selected ? item.color : colors.line,
                    },
                  ]}>
                  <MaterialCommunityIcons name={item.icon} size={17} color={item.color} />
                  <ThemedText style={[styles.roleLabel, { color: selected ? item.color : colors.mutedText }]}>
                    {item.label}
                  </ThemedText>
                  <MaterialCommunityIcons
                    name={locked ? 'lock-outline' : selected ? 'check-circle' : 'circle-outline'}
                    size={15}
                    color={selected ? item.color : colors.mutedText}
                  />
                </Pressable>
              );
            })}
          </View>

          <View style={styles.grantHeading}>
            <ThemedText style={styles.editorLabel}>用户特批</ThemedText>
            <ThemedText style={[styles.grantCount, { color: colors.mutedText }]}>
              {feature.grantCount} 人
            </ThemedText>
          </View>
          <View style={[styles.grantInputRow, { backgroundColor: colors.surfaceMuted }]}>
            <MaterialCommunityIcons name="cellphone" size={18} color={colors.mutedText} />
            <TextInput
              editable={!saving}
              keyboardType="phone-pad"
              maxLength={11}
              onChangeText={onChangeGrantUsername}
              placeholder="输入用户手机号"
              placeholderTextColor={colors.mutedText}
              selectionColor={colors.primary}
              style={[styles.grantInput, { color: colors.text }]}
              value={grantUsername}
            />
            <Pressable
              accessibilityLabel="添加用户特批"
              accessibilityRole="button"
              disabled={saving}
              onPress={onAddGrant}
              style={[styles.addGrantButton, { backgroundColor: colors.primary }]}>
              <MaterialCommunityIcons name="account-plus-outline" size={18} color="#ffffff" />
            </Pressable>
          </View>

          {feature.grants.map((grant) => (
            <View key={grant.username} style={[styles.grantRow, { borderBottomColor: colors.line }]}>
              <View style={[styles.grantAvatar, { backgroundColor: colors.primarySoft }]}>
                <ThemedText style={[styles.grantAvatarText, { color: colors.primary }]}>
                  {grant.displayName.slice(0, 1).toUpperCase()}
                </ThemedText>
              </View>
              <View style={styles.grantCopy}>
                <ThemedText style={styles.grantName}>{grant.displayName}</ThemedText>
                <ThemedText style={[styles.grantMeta, { color: colors.mutedText }]}>
                  {grant.username} · {roleLabel(grant.role)}
                </ThemedText>
              </View>
              <Pressable
                accessibilityLabel={`移除${grant.displayName}的特批`}
                accessibilityRole="button"
                disabled={saving}
                onPress={() => onRemoveGrant(grant.username)}
                style={styles.removeGrantButton}>
                <MaterialCommunityIcons name="close" size={18} color={colors.mutedText} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function SummaryItem({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.summaryItem}>
      <ThemedText style={styles.summaryValue}>{value}</ThemedText>
      <ThemedText style={styles.summaryLabel}>{label}</ThemedText>
    </View>
  );
}

function MessageRow({ message }: { message: FormMessage }) {
  const { colors } = useAppTheme();
  const success = message.tone === 'success';
  const foreground = success ? colors.success : '#d86f5b';
  return (
    <View style={[styles.messageRow, { backgroundColor: `${foreground}16` }]}>
      <MaterialCommunityIcons
        name={success ? 'check-circle-outline' : 'alert-circle-outline'}
        size={18}
        color={foreground}
      />
      <ThemedText style={[styles.messageText, { color: foreground }]}>{message.text}</ThemedText>
    </View>
  );
}

function roleLabel(role: UserRole) {
  return configurableRoles.find((item) => item.role === role)?.label ?? role;
}

const styles = StyleSheet.create({
  pageContent: { gap: 14, paddingTop: 12 },
  topBar: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  iconButton: { alignItems: 'center', borderRadius: 14, height: 42, justifyContent: 'center', width: 42 },
  topBarCopy: { flex: 1 },
  pageTitle: { fontSize: 23, fontWeight: '900', lineHeight: 28 },
  pageSubtitle: { fontSize: 11, marginTop: 2 },
  adminMark: { alignItems: 'center', borderRadius: 14, height: 42, justifyContent: 'center', width: 42 },
  summaryBand: { alignItems: 'center', borderRadius: 22, flexDirection: 'row', minHeight: 91, padding: 16 },
  summaryItem: { alignItems: 'center', flex: 1, gap: 5 },
  summaryValue: { color: '#ffffff', fontSize: 23, fontWeight: '900' },
  summaryLabel: { color: 'rgba(255,255,255,0.62)', fontSize: 10, fontWeight: '700' },
  summaryDivider: { backgroundColor: 'rgba(255,255,255,0.16)', height: 34, width: 1 },
  policyRow: { alignItems: 'center', borderRadius: 14, flexDirection: 'row', gap: 8, padding: 12 },
  policyText: { flex: 1, fontSize: 12, fontWeight: '800' },
  searchShell: { alignItems: 'center', borderRadius: 16, borderWidth: 1, flexDirection: 'row', gap: 9, minHeight: 50, paddingHorizontal: 14 },
  searchInput: { flex: 1, fontSize: 14, minWidth: 0, paddingVertical: 11 },
  messageRow: { alignItems: 'flex-start', borderRadius: 14, flexDirection: 'row', gap: 8, padding: 12 },
  messageText: { flex: 1, fontSize: 12, lineHeight: 18 },
  featureList: { gap: 10 },
  featureCard: { borderRadius: 18, borderWidth: 1, overflow: 'hidden' },
  featureHeader: { alignItems: 'center', flexDirection: 'row', gap: 11, minHeight: 72, padding: 13 },
  featureIcon: { alignItems: 'center', borderRadius: 13, height: 42, justifyContent: 'center', width: 42 },
  featureCopy: { flex: 1, minWidth: 0 },
  featureName: { fontSize: 14, fontWeight: '900' },
  featureMeta: { fontSize: 10, marginTop: 5 },
  featureEditor: { borderTopWidth: 1, gap: 12, padding: 13 },
  editorLabel: { fontSize: 12, fontWeight: '900' },
  roleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  roleButton: { alignItems: 'center', borderRadius: 12, borderWidth: 1, flexBasis: '47%', flexDirection: 'row', flexGrow: 1, gap: 6, minHeight: 42, paddingHorizontal: 9 },
  roleLabel: { flex: 1, fontSize: 11, fontWeight: '800' },
  grantHeading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  grantCount: { fontSize: 10, fontWeight: '700' },
  grantInputRow: { alignItems: 'center', borderRadius: 13, flexDirection: 'row', gap: 7, minHeight: 46, paddingLeft: 11, paddingRight: 5 },
  grantInput: { flex: 1, fontSize: 13, minWidth: 0, paddingVertical: 10 },
  addGrantButton: { alignItems: 'center', borderRadius: 10, height: 36, justifyContent: 'center', width: 36 },
  grantRow: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', gap: 9, minHeight: 52 },
  grantAvatar: { alignItems: 'center', borderRadius: 13, height: 30, justifyContent: 'center', width: 30 },
  grantAvatarText: { fontSize: 11, fontWeight: '900' },
  grantCopy: { flex: 1, minWidth: 0 },
  grantName: { fontSize: 11, fontWeight: '800' },
  grantMeta: { fontSize: 9, marginTop: 3 },
  removeGrantButton: { alignItems: 'center', height: 34, justifyContent: 'center', width: 34 },
});
