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
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

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
  description: string;
  role: UserRole;
}> = [
  { color: '#7483a2', description: '基础注册用户', icon: 'account-outline', label: '普通会员', role: 'normal' },
  { color: '#4b6bff', description: 'VIP 身份用户', icon: 'diamond-stone', label: 'VIP', role: 'vip' },
  { color: '#e8667a', description: '高级会员用户', icon: 'crown-outline', label: 'SVIP', role: 'svip' },
  { color: '#151b3b', description: '始终可以访问', icon: 'shield-check-outline', label: '管理员', role: 'admin' },
];

const PERMISSIONS_DESKTOP_BREAKPOINT = 900;

type FormMessage = {
  text: string;
  tone: 'error' | 'success';
};

export function AdminPermissionsScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { width } = useWindowDimensions();
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
  const selectedFeature =
    filteredFeatures.find((feature) => feature.id === expandedFeatureID) ??
    filteredFeatures[0] ??
    null;

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

  if (width >= PERMISSIONS_DESKTOP_BREAKPOINT) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
        <View style={styles.desktopPage}>
          <View style={styles.topBar}>
            <Pressable
              accessibilityLabel="返回管理后台"
              accessibilityRole="button"
              onPress={() => router.back()}
              style={[styles.iconButton, { backgroundColor: colors.surface }]}>
              <MaterialCommunityIcons name="arrow-left" size={20} color={colors.text} />
            </Pressable>
            <View style={styles.topBarCopy}>
              <ThemedText style={styles.pageTitle}>入口权限</ThemedText>
              <ThemedText style={[styles.pageSubtitle, { color: colors.mutedText }]}>管理后台 · 功能入口可见性</ThemedText>
            </View>
            <View style={[styles.adminMark, { backgroundColor: colors.hero }]}>
              <MaterialCommunityIcons name="shield-crown-outline" size={19} color="#c9f36a" />
            </View>
          </View>

          <View style={[styles.summaryBand, styles.desktopSummaryBand, { backgroundColor: colors.hero }]}>
            <SummaryItem label="功能入口" value={features.length} />
            <View style={styles.summaryDivider} />
            <SummaryItem label="身份受限" value={restrictedCount} />
            <View style={styles.summaryDivider} />
            <SummaryItem label="用户特批" value={grantCount} />
          </View>

          <View style={[styles.policyRow, styles.desktopPolicyRow, { backgroundColor: colors.primarySoft }]}>
            <MaterialCommunityIcons name="shield-lock-outline" size={18} color={colors.primary} />
            <ThemedText style={[styles.policyText, { color: colors.primary }]}>新入口默认仅管理员可见</ThemedText>
            <ThemedText style={[styles.resultCount, { color: colors.mutedText }]}>显示 {filteredFeatures.length} / {features.length}</ThemedText>
          </View>

          {message ? <MessageRow message={message} /> : null}

          <View style={[styles.desktopWorkspace, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <View style={[styles.desktopFeaturePane, { borderRightColor: colors.line }]}>
              <View style={styles.desktopPaneHeading}>
                <View>
                  <ThemedText style={styles.desktopPaneTitle}>功能入口</ThemedText>
                  <ThemedText style={[styles.desktopPaneMeta, { color: colors.mutedText }]}>按名称或分类筛选</ThemedText>
                </View>
                <View style={[styles.countBadge, { backgroundColor: colors.surfaceMuted }]}>
                  <ThemedText style={[styles.countBadgeText, { color: colors.mutedText }]}>{filteredFeatures.length}</ThemedText>
                </View>
              </View>

              <SearchField colors={colors} onChangeText={setSearch} value={search} desktop />

              <ScrollView
                contentContainerStyle={styles.desktopFeatureList}
                showsVerticalScrollIndicator={false}
                style={styles.desktopFeatureScroll}>
                {filteredFeatures.length > 0 ? (
                  filteredFeatures.map((feature) => (
                    <DesktopFeatureRow
                      feature={feature}
                      key={feature.id}
                      onPress={() => {
                        setExpandedFeatureID(feature.id);
                        setGrantUsername('');
                        setMessage(null);
                      }}
                      saving={savingFeatureID === feature.id}
                      selected={selectedFeature?.id === feature.id}
                    />
                  ))
                ) : (
                  <EmptySearchState />
                )}
              </ScrollView>
            </View>

            <View style={styles.desktopEditorPane}>
              {selectedFeature ? (
                <>
                  <DesktopEditorHeader
                    feature={selectedFeature}
                    saving={savingFeatureID === selectedFeature.id}
                  />
                  <ScrollView
                    contentContainerStyle={styles.desktopEditorContent}
                    showsVerticalScrollIndicator={false}
                    style={styles.desktopEditorScroll}>
                    <FeaturePermissionEditor
                      desktop
                      feature={selectedFeature}
                      grantUsername={grantUsername}
                      onAddGrant={() => addGrant(selectedFeature)}
                      onChangeGrantUsername={(value) => setGrantUsername(normalizePhoneInput(value))}
                      onRemoveGrant={(username) => void setGrant(selectedFeature, username, false)}
                      onToggleRole={(role) => void toggleRole(selectedFeature, role)}
                      saving={savingFeatureID === selectedFeature.id}
                    />
                  </ScrollView>
                </>
              ) : (
                <EmptySearchState detail />
              )}
            </View>
          </View>
        </View>
      </SafeAreaView>
    );
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

      <SearchField colors={colors} onChangeText={setSearch} value={search} />

      {message ? <MessageRow message={message} /> : null}

      <View style={styles.featureList}>
        {filteredFeatures.length > 0 ? (
          filteredFeatures.map((feature) => (
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
          ))
        ) : (
          <EmptySearchState />
        )}
      </View>
    </MobileScreen>
  );
}

type SearchFieldProps = {
  colors: ReturnType<typeof useAppTheme>['colors'];
  desktop?: boolean;
  onChangeText: (value: string) => void;
  value: string;
};

function SearchField({ colors, desktop = false, onChangeText, value }: SearchFieldProps) {
  return (
    <View
      style={[
        styles.searchShell,
        desktop ? styles.desktopSearchShell : null,
        { backgroundColor: colors.surface, borderColor: colors.line },
      ]}>
      <MaterialCommunityIcons name="magnify" size={19} color={colors.mutedText} />
      <TextInput
        accessibilityLabel="搜索功能名称或分类"
        onChangeText={onChangeText}
        placeholder="搜索功能名称或分类"
        placeholderTextColor={colors.mutedText}
        selectionColor={colors.primary}
        style={[styles.searchInput, { color: colors.text }]}
        value={value}
      />
      {value ? (
        <Pressable
          accessibilityLabel="清空搜索"
          accessibilityRole="button"
          onPress={() => onChangeText('')}
          style={styles.clearSearchButton}>
          <MaterialCommunityIcons name="close-circle" size={18} color={colors.mutedText} />
        </Pressable>
      ) : null}
    </View>
  );
}

type DesktopFeatureRowProps = {
  feature: ManagedFeature;
  onPress: () => void;
  saving: boolean;
  selected: boolean;
};

function DesktopFeatureRow({ feature, onPress, saving, selected }: DesktopFeatureRowProps) {
  const { colors } = useAppTheme();
  const tool = getToolById(feature.id);
  const accentColor = tool?.accentColor ?? colors.primary;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.desktopFeatureRow,
        {
          backgroundColor: selected ? colors.primarySoft : colors.surface,
          borderBottomColor: colors.line,
          borderLeftColor: selected ? colors.primary : 'transparent',
          opacity: pressed ? 0.76 : 1,
        },
      ]}>
      <View style={[styles.desktopFeatureIcon, { backgroundColor: `${accentColor}18` }]}>
        <MaterialCommunityIcons name={tool?.icon ?? 'puzzle-outline'} size={20} color={accentColor} />
      </View>
      <View style={styles.featureCopy}>
        <ThemedText numberOfLines={1} style={styles.desktopFeatureName}>{feature.name}</ThemedText>
        <ThemedText numberOfLines={1} style={[styles.desktopFeatureMeta, { color: colors.mutedText }]}>
          {feature.category} · {feature.roles.length} 个身份 · {feature.grantCount} 个特批
        </ThemedText>
      </View>
      {saving ? (
        <ActivityIndicator color={colors.primary} size="small" />
      ) : (
        <MaterialCommunityIcons
          name="chevron-right"
          size={20}
          color={selected ? colors.primary : colors.mutedText}
        />
      )}
    </Pressable>
  );
}

function DesktopEditorHeader({ feature, saving }: { feature: ManagedFeature; saving: boolean }) {
  const { colors } = useAppTheme();
  const tool = getToolById(feature.id);
  const accentColor = tool?.accentColor ?? colors.primary;

  return (
    <View style={[styles.desktopEditorHeader, { borderBottomColor: colors.line }]}>
      <View style={[styles.desktopEditorIcon, { backgroundColor: `${accentColor}18` }]}>
        <MaterialCommunityIcons name={tool?.icon ?? 'puzzle-outline'} size={23} color={accentColor} />
      </View>
      <View style={styles.desktopEditorTitleCopy}>
        <ThemedText numberOfLines={1} style={styles.desktopEditorTitle}>{feature.name}</ThemedText>
        <ThemedText style={[styles.desktopEditorMeta, { color: colors.mutedText }]}>
          {feature.category} · {feature.roles.length} 个身份可见
        </ThemedText>
      </View>
      <View style={[styles.statusBadge, { backgroundColor: colors.primarySoft }]}>
        {saving ? (
          <ActivityIndicator color={colors.primary} size="small" />
        ) : (
          <MaterialCommunityIcons name="check-circle" size={15} color={colors.primary} />
        )}
        <ThemedText style={[styles.statusBadgeText, { color: colors.primary }]}>
          {saving ? '保存中' : '已配置'}
        </ThemedText>
      </View>
    </View>
  );
}

function EmptySearchState({ detail = false }: { detail?: boolean }) {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.emptySearchState, detail ? styles.emptySearchDetail : null]}>
      <View style={[styles.emptySearchIcon, { backgroundColor: colors.surfaceMuted }]}>
        <MaterialCommunityIcons name="text-search" size={25} color={colors.mutedText} />
      </View>
      <ThemedText style={[styles.emptySearchText, { color: colors.mutedText }]}>没有匹配的功能入口</ThemedText>
    </View>
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
          <FeaturePermissionEditor
            feature={feature}
            grantUsername={grantUsername}
            onAddGrant={onAddGrant}
            onChangeGrantUsername={onChangeGrantUsername}
            onRemoveGrant={onRemoveGrant}
            onToggleRole={onToggleRole}
            saving={saving}
          />
        </View>
      ) : null}
    </View>
  );
}

type FeaturePermissionEditorProps = {
  desktop?: boolean;
  feature: ManagedFeature;
  grantUsername: string;
  onAddGrant: () => void;
  onChangeGrantUsername: (value: string) => void;
  onRemoveGrant: (username: string) => void;
  onToggleRole: (role: UserRole) => void;
  saving: boolean;
};

function FeaturePermissionEditor({
  desktop = false,
  feature,
  grantUsername,
  onAddGrant,
  onChangeGrantUsername,
  onRemoveGrant,
  onToggleRole,
  saving,
}: FeaturePermissionEditorProps) {
  const { colors } = useAppTheme();

  return (
    <>
      <View
        style={[
          styles.permissionSection,
          desktop ? styles.desktopPermissionSection : null,
          desktop ? { borderBottomColor: colors.line } : null,
        ]}>
        <View style={styles.sectionHeading}>
          <ThemedText style={[styles.editorLabel, desktop ? styles.desktopEditorLabel : null]}>
            默认身份权限
          </ThemedText>
          {desktop ? (
            <ThemedText style={[styles.sectionHint, { color: colors.mutedText }]}>勾选后展示入口</ThemedText>
          ) : null}
        </View>
        <View style={[styles.roleGrid, desktop ? styles.desktopRoleGrid : null]}>
          {configurableRoles.map((item) => {
            const selected = feature.roles.includes(item.role);
            const locked = item.role === 'admin';
            const roleColor = locked ? colors.text : item.color;
            return (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected, disabled: locked || saving }}
                disabled={locked || saving}
                key={item.role}
                onPress={() => onToggleRole(item.role)}
                style={[
                  styles.roleButton,
                  desktop ? styles.desktopRoleButton : null,
                  {
                    backgroundColor: selected ? `${roleColor}18` : colors.surfaceMuted,
                    borderColor: selected ? roleColor : colors.line,
                  },
                ]}>
                <View style={[styles.roleIcon, desktop ? styles.desktopRoleIcon : null]}>
                  <MaterialCommunityIcons name={item.icon} size={desktop ? 19 : 17} color={roleColor} />
                </View>
                <View style={styles.roleCopy}>
                  <ThemedText
                    style={[
                      styles.roleLabel,
                      desktop ? styles.desktopRoleLabel : null,
                      { color: selected ? roleColor : colors.mutedText },
                    ]}>
                    {item.label}
                  </ThemedText>
                  {desktop ? (
                    <ThemedText style={[styles.roleDescription, { color: colors.mutedText }]}>
                      {item.description}
                    </ThemedText>
                  ) : null}
                </View>
                <MaterialCommunityIcons
                  name={locked ? 'lock-outline' : selected ? 'check-circle' : 'circle-outline'}
                  size={desktop ? 18 : 15}
                  color={selected ? roleColor : colors.mutedText}
                />
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={[styles.permissionSection, desktop ? styles.desktopGrantSection : null]}>
        <View style={styles.grantHeading}>
          <View>
            <ThemedText style={[styles.editorLabel, desktop ? styles.desktopEditorLabel : null]}>
              用户特批
            </ThemedText>
            {desktop ? (
              <ThemedText style={[styles.sectionHint, styles.grantHint, { color: colors.mutedText }]}>
                单独允许指定用户访问
              </ThemedText>
            ) : null}
          </View>
          <ThemedText style={[styles.grantCount, desktop ? styles.desktopGrantCount : null, { color: colors.mutedText }]}>
            {feature.grantCount} 人
          </ThemedText>
        </View>
        <View
          style={[
            styles.grantInputRow,
            desktop ? styles.desktopGrantInputRow : null,
            { backgroundColor: colors.surfaceMuted },
          ]}>
          <MaterialCommunityIcons name="cellphone" size={18} color={colors.mutedText} />
          <TextInput
            accessibilityLabel="用户手机号"
            editable={!saving}
            keyboardType="phone-pad"
            maxLength={11}
            onChangeText={onChangeGrantUsername}
            placeholder="输入用户手机号"
            placeholderTextColor={colors.mutedText}
            selectionColor={colors.primary}
            style={[styles.grantInput, desktop ? styles.desktopGrantInput : null, { color: colors.text }]}
            value={grantUsername}
          />
          <Pressable
            accessibilityLabel="添加用户特批"
            accessibilityRole="button"
            disabled={saving}
            onPress={onAddGrant}
            style={({ pressed }) => [
              styles.addGrantButton,
              desktop ? styles.desktopAddGrantButton : null,
              { backgroundColor: colors.primary, opacity: saving || pressed ? 0.7 : 1 },
            ]}>
            <MaterialCommunityIcons name="account-plus-outline" size={18} color="#ffffff" />
            {desktop ? <ThemedText style={styles.desktopAddGrantText}>添加特批</ThemedText> : null}
          </Pressable>
        </View>

        {feature.grants.length > 0 ? (
          <View style={desktop ? styles.desktopGrantList : null}>
            {feature.grants.map((grant) => (
              <View
                key={grant.username}
                style={[
                  styles.grantRow,
                  desktop ? styles.desktopGrantRow : null,
                  { borderBottomColor: colors.line },
                ]}>
                <View style={[styles.grantAvatar, desktop ? styles.desktopGrantAvatar : null, { backgroundColor: colors.primarySoft }]}>
                  <ThemedText style={[styles.grantAvatarText, { color: colors.primary }]}>
                    {grant.displayName.slice(0, 1).toUpperCase()}
                  </ThemedText>
                </View>
                <View style={styles.grantCopy}>
                  <ThemedText style={[styles.grantName, desktop ? styles.desktopGrantName : null]}>{grant.displayName}</ThemedText>
                  <ThemedText style={[styles.grantMeta, desktop ? styles.desktopGrantMeta : null, { color: colors.mutedText }]}>
                    {grant.username} · {roleLabel(grant.role)}
                  </ThemedText>
                </View>
                <Pressable
                  accessibilityLabel={`移除${grant.displayName}的特批`}
                  accessibilityRole="button"
                  disabled={saving}
                  onPress={() => onRemoveGrant(grant.username)}
                  style={({ pressed }) => [
                    styles.removeGrantButton,
                    desktop ? styles.desktopRemoveGrantButton : null,
                    { opacity: saving || pressed ? 0.55 : 1 },
                  ]}>
                  <MaterialCommunityIcons name="close" size={18} color={colors.mutedText} />
                </Pressable>
              </View>
            ))}
          </View>
        ) : (
          <View style={[styles.emptyGrantRow, desktop ? styles.desktopEmptyGrantRow : null]}>
            <MaterialCommunityIcons name="account-outline" size={20} color={colors.mutedText} />
            <ThemedText style={[styles.emptyGrantText, { color: colors.mutedText }]}>暂无用户特批</ThemedText>
          </View>
        )}
      </View>
    </>
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
  safeArea: { flex: 1 },
  pageContent: { gap: 14, paddingTop: 12 },
  desktopPage: { alignSelf: 'center', flex: 1, gap: 14, maxWidth: 1280, minHeight: 0, padding: 20, width: '100%' },
  topBar: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  iconButton: { alignItems: 'center', borderRadius: 14, height: 42, justifyContent: 'center', width: 42 },
  topBarCopy: { flex: 1 },
  pageTitle: { fontSize: 23, fontWeight: '900', lineHeight: 28 },
  pageSubtitle: { fontSize: 11, marginTop: 2 },
  adminMark: { alignItems: 'center', borderRadius: 14, height: 42, justifyContent: 'center', width: 42 },
  summaryBand: { alignItems: 'center', borderRadius: 22, flexDirection: 'row', minHeight: 91, padding: 16 },
  desktopSummaryBand: { borderRadius: 8, minHeight: 88 },
  summaryItem: { alignItems: 'center', flex: 1, gap: 5 },
  summaryValue: { color: '#ffffff', fontSize: 23, fontWeight: '900' },
  summaryLabel: { color: 'rgba(255,255,255,0.62)', fontSize: 10, fontWeight: '700' },
  summaryDivider: { backgroundColor: 'rgba(255,255,255,0.16)', height: 34, width: 1 },
  policyRow: { alignItems: 'center', borderRadius: 14, flexDirection: 'row', gap: 8, padding: 12 },
  desktopPolicyRow: { borderRadius: 8, minHeight: 44, paddingHorizontal: 14, paddingVertical: 10 },
  policyText: { flex: 1, fontSize: 12, fontWeight: '800' },
  resultCount: { fontSize: 11, fontWeight: '700' },
  searchShell: { alignItems: 'center', borderRadius: 16, borderWidth: 1, flexDirection: 'row', gap: 9, minHeight: 50, paddingHorizontal: 14 },
  desktopSearchShell: { borderRadius: 8, marginHorizontal: 14, minHeight: 44 },
  searchInput: { flex: 1, fontSize: 14, minWidth: 0, paddingVertical: 11 },
  clearSearchButton: { alignItems: 'center', height: 30, justifyContent: 'center', width: 30 },
  messageRow: { alignItems: 'flex-start', borderRadius: 14, flexDirection: 'row', gap: 8, padding: 12 },
  messageText: { flex: 1, fontSize: 12, lineHeight: 18 },
  desktopWorkspace: { borderRadius: 8, borderWidth: 1, flex: 1, flexDirection: 'row', minHeight: 0, overflow: 'hidden' },
  desktopFeaturePane: { borderRightWidth: 1, minHeight: 0, width: 360 },
  desktopPaneHeading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', minHeight: 68, paddingHorizontal: 16 },
  desktopPaneTitle: { fontSize: 15, fontWeight: '900' },
  desktopPaneMeta: { fontSize: 11, marginTop: 4 },
  countBadge: { alignItems: 'center', borderRadius: 12, justifyContent: 'center', minHeight: 24, minWidth: 28, paddingHorizontal: 7 },
  countBadgeText: { fontSize: 11, fontWeight: '900' },
  desktopFeatureScroll: { flex: 1, marginTop: 10 },
  desktopFeatureList: { paddingBottom: 10 },
  desktopFeatureRow: { alignItems: 'center', borderBottomWidth: 1, borderLeftWidth: 3, flexDirection: 'row', gap: 11, minHeight: 66, paddingHorizontal: 13 },
  desktopFeatureIcon: { alignItems: 'center', borderRadius: 8, height: 38, justifyContent: 'center', width: 38 },
  desktopFeatureName: { fontSize: 13, fontWeight: '900' },
  desktopFeatureMeta: { fontSize: 10, marginTop: 4 },
  desktopEditorPane: { flex: 1, minHeight: 0, minWidth: 0 },
  desktopEditorHeader: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', gap: 12, minHeight: 82, paddingHorizontal: 20 },
  desktopEditorIcon: { alignItems: 'center', borderRadius: 8, height: 46, justifyContent: 'center', width: 46 },
  desktopEditorTitleCopy: { flex: 1, minWidth: 0 },
  desktopEditorTitle: { fontSize: 18, fontWeight: '900' },
  desktopEditorMeta: { fontSize: 11, marginTop: 5 },
  statusBadge: { alignItems: 'center', borderRadius: 14, flexDirection: 'row', gap: 5, minHeight: 30, paddingHorizontal: 10 },
  statusBadgeText: { fontSize: 11, fontWeight: '900' },
  desktopEditorScroll: { flex: 1 },
  desktopEditorContent: { padding: 20 },
  featureList: { gap: 10 },
  featureCard: { borderRadius: 18, borderWidth: 1, overflow: 'hidden' },
  featureHeader: { alignItems: 'center', flexDirection: 'row', gap: 11, minHeight: 72, padding: 13 },
  featureIcon: { alignItems: 'center', borderRadius: 13, height: 42, justifyContent: 'center', width: 42 },
  featureCopy: { flex: 1, minWidth: 0 },
  featureName: { fontSize: 14, fontWeight: '900' },
  featureMeta: { fontSize: 10, marginTop: 5 },
  featureEditor: { borderTopWidth: 1, gap: 12, padding: 13 },
  permissionSection: { gap: 12 },
  desktopPermissionSection: { borderBottomWidth: 1, gap: 16, paddingBottom: 22 },
  desktopGrantSection: { gap: 16, paddingTop: 22 },
  sectionHeading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  editorLabel: { fontSize: 12, fontWeight: '900' },
  desktopEditorLabel: { fontSize: 14 },
  sectionHint: { fontSize: 11 },
  grantHint: { marginTop: 5 },
  roleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  roleButton: { alignItems: 'center', borderRadius: 12, borderWidth: 1, flexBasis: '47%', flexDirection: 'row', flexGrow: 1, gap: 6, minHeight: 42, paddingHorizontal: 9 },
  desktopRoleGrid: { gap: 10 },
  desktopRoleButton: { borderRadius: 8, flexBasis: '48%', gap: 10, minHeight: 64, paddingHorizontal: 14 },
  roleIcon: { alignItems: 'center', justifyContent: 'center' },
  desktopRoleIcon: { height: 28, width: 28 },
  roleCopy: { flex: 1, minWidth: 0 },
  roleLabel: { fontSize: 11, fontWeight: '800' },
  desktopRoleLabel: { fontSize: 13 },
  roleDescription: { fontSize: 10, marginTop: 4 },
  grantHeading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  grantCount: { fontSize: 10, fontWeight: '700' },
  desktopGrantCount: { fontSize: 11 },
  grantInputRow: { alignItems: 'center', borderRadius: 13, flexDirection: 'row', gap: 7, minHeight: 46, paddingLeft: 11, paddingRight: 5 },
  desktopGrantInputRow: { borderRadius: 8, minHeight: 52, paddingLeft: 14, paddingRight: 6 },
  grantInput: { flex: 1, fontSize: 13, minWidth: 0, paddingVertical: 10 },
  desktopGrantInput: { fontSize: 14 },
  addGrantButton: { alignItems: 'center', borderRadius: 10, height: 36, justifyContent: 'center', width: 36 },
  desktopAddGrantButton: { borderRadius: 7, flexDirection: 'row', gap: 7, height: 40, width: 112 },
  desktopAddGrantText: { color: '#ffffff', fontSize: 12, fontWeight: '900' },
  desktopGrantList: { marginTop: 2 },
  grantRow: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', gap: 9, minHeight: 52 },
  desktopGrantRow: { gap: 11, minHeight: 64 },
  grantAvatar: { alignItems: 'center', borderRadius: 13, height: 30, justifyContent: 'center', width: 30 },
  desktopGrantAvatar: { borderRadius: 8, height: 36, width: 36 },
  grantAvatarText: { fontSize: 11, fontWeight: '900' },
  grantCopy: { flex: 1, minWidth: 0 },
  grantName: { fontSize: 11, fontWeight: '800' },
  desktopGrantName: { fontSize: 13 },
  grantMeta: { fontSize: 9, marginTop: 3 },
  desktopGrantMeta: { fontSize: 10, marginTop: 4 },
  removeGrantButton: { alignItems: 'center', height: 34, justifyContent: 'center', width: 34 },
  desktopRemoveGrantButton: { borderRadius: 7, height: 36, width: 36 },
  emptyGrantRow: { alignItems: 'center', flexDirection: 'row', gap: 8, justifyContent: 'center', minHeight: 48 },
  desktopEmptyGrantRow: { justifyContent: 'flex-start', minHeight: 56 },
  emptyGrantText: { fontSize: 11 },
  emptySearchState: { alignItems: 'center', gap: 10, justifyContent: 'center', padding: 30 },
  emptySearchDetail: { flex: 1 },
  emptySearchIcon: { alignItems: 'center', borderRadius: 8, height: 48, justifyContent: 'center', width: 48 },
  emptySearchText: { fontSize: 12, fontWeight: '700', textAlign: 'center' },
});
