import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useFocusEffect } from '@react-navigation/native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Redirect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/features/auth/auth-provider';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  getAdminMembershipSettings,
  getMembershipPaymentErrorMessage,
  removeAdminPaymentQR,
  updateAdminPaymentNote,
  uploadAdminPaymentQR,
} from '@/lib/membership-payment-api';
import { AppLoadingScreen } from '@/shared/ui/app-loading-screen';
import type {
  MembershipChange,
  MembershipSettings,
} from '@/types/membership';

type FormMessage = { text: string; tone: 'error' | 'success' };

export function AdminMembershipScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { colors } = useAppTheme();
  const { accessToken, status: authStatus, user } = useAuth();
  const [settings, setSettings] = useState<MembershipSettings | null>(null);
  const [changes, setChanges] = useState<MembershipChange[]>([]);
  const [noteDraft, setNoteDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [message, setMessage] = useState<FormMessage | null>(null);
  const isDesktop = width >= 900;

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setMessage(null);
    try {
      const result = await getAdminMembershipSettings(accessToken);
      setSettings(result.settings);
      setChanges(result.changes);
      setNoteDraft(result.settings.note);
    } catch (error) {
      setMessage({ text: getMembershipPaymentErrorMessage(error), tone: 'error' });
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (authStatus === 'loading') return <AppLoadingScreen />;
  if (authStatus !== 'authenticated' || user?.role !== 'admin' || !accessToken) {
    return <Redirect href="/profile" />;
  }
  const token = accessToken;

  async function handlePickQR() {
    setMessage(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setMessage({ text: '需要相册权限才能选择收款码。', tone: 'error' });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: false,
      mediaTypes: ['images'],
      quality: 0.9,
    });
    const asset = result.assets?.[0];
    if (result.canceled || !asset) return;

    setUploading(true);
    try {
      const updated = await uploadAdminPaymentQR(token, {
        fileName: asset.fileName,
        mimeType: asset.mimeType,
        uri: asset.uri,
      });
      setSettings(updated);
      setConfirmingRemove(false);
      setMessage({ text: '收款码已更新，用户端扫码页已生效。', tone: 'success' });
      await load();
    } catch (error) {
      setMessage({ text: getMembershipPaymentErrorMessage(error), tone: 'error' });
    } finally {
      setUploading(false);
    }
  }

  async function handleRemoveQR() {
    setMessage(null);
    setRemoving(true);
    try {
      const updated = await removeAdminPaymentQR(token);
      setSettings(updated);
      setConfirmingRemove(false);
      setMessage({ text: '收款码已移除，用户端将显示暂未配置。', tone: 'success' });
      await load();
    } catch (error) {
      setMessage({ text: getMembershipPaymentErrorMessage(error), tone: 'error' });
    } finally {
      setRemoving(false);
    }
  }

  async function handleSaveNote() {
    setMessage(null);
    setSaving(true);
    try {
      const updated = await updateAdminPaymentNote(token, noteDraft);
      setSettings(updated);
      setMessage({ text: '支付说明已保存。', tone: 'success' });
      await load();
    } catch (error) {
      setMessage({ text: getMembershipPaymentErrorMessage(error), tone: 'error' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView
      contentContainerStyle={[styles.scrollContent, { backgroundColor: colors.background }]}
      showsVerticalScrollIndicator={false}
      style={styles.root}>
      <View style={[styles.page, isDesktop && styles.pageDesktop]}>
        <View style={styles.titleRow}>
          <View style={styles.titleCopy}>
            <ThemedText style={styles.pageTitle}>会员收款设置</ThemedText>
            <ThemedText style={[styles.pageSubtitle, { color: colors.mutedText }]}>
              维护收款码与支付说明，人工开通闭环
            </ThemedText>
          </View>
          <View
            style={[
              styles.configBadge,
              {
                backgroundColor: settings?.enabled ? '#e9f7ee' : '#fdf2dd',
                borderColor: settings?.enabled ? '#b9e2c8' : '#f0d9a8',
              },
            ]}>
            <MaterialCommunityIcons
              name={settings?.enabled ? 'check-circle' : 'clock-alert-outline'}
              size={14}
              color={settings?.enabled ? '#2f8b55' : '#8a5b13'}
            />
            <ThemedText
              style={[
                styles.configBadgeText,
                { color: settings?.enabled ? '#2f8b55' : '#8a5b13' },
              ]}>
              {settings?.enabled ? '已配置 · 用户端可见' : '未配置 · 用户端显示空状态'}
            </ThemedText>
          </View>
        </View>

        <View style={[styles.summaryBand, { backgroundColor: colors.hero }]}>
          <SummaryItem icon="qrcode" label="收款码状态" value={settings?.enabled ? '已配置' : '未配置'} />
          <SummaryItem icon="diamond-stone" label="VIP 价格" value={`¥${formatPrice(settings?.vipPriceCents ?? 200)}/月`} />
          <SummaryItem icon="crown-outline" label="SVIP 价格" value={`¥${formatPrice(settings?.svipPriceCents ?? 500)}/月`} />
        </View>

        {message ? <MessageBar message={message} /> : null}

        {loading && !settings ? (
          <View style={[styles.statePanel, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <ActivityIndicator color={colors.primary} />
            <ThemedText style={[styles.stateText, { color: colors.mutedText }]}>
              正在读取会员收款配置...
            </ThemedText>
          </View>
        ) : (
          <>
            <View style={[styles.grid, isDesktop && styles.gridDesktop]}>
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.line }]}>
                <CardHead title="收款二维码" hint="JPG / PNG / WebP · ≤ 2MB" />
                {settings?.enabled && settings.qrUrl ? (
                  <Image
                    accessibilityLabel="当前收款二维码"
                    contentFit="contain"
                    source={{ uri: settings.qrUrl }}
                    style={[styles.qrPreview, { borderColor: colors.line }]}
                  />
                ) : (
                  <View style={[styles.qrEmpty, { borderColor: colors.line }]}>
                    <MaterialCommunityIcons name="qrcode" size={30} color={colors.mutedText} />
                    <ThemedText style={[styles.qrEmptyText, { color: colors.mutedText }]}>
                      尚未上传收款码
                    </ThemedText>
                  </View>
                )}
                {settings?.enabled ? (
                  <ThemedText style={[styles.qrMeta, { color: colors.mutedText }]}>
                    最近更新：
                    {settings.updatedByName || settings.updatedByUsername || '管理员'} ·{' '}
                    {formatDateTime(settings.updatedAt)}
                  </ThemedText>
                ) : null}
                {confirmingRemove ? (
                  <View style={[styles.confirmBox, { backgroundColor: '#d86f5b12', borderColor: '#d86f5b' }]}>
                    <ThemedText style={styles.confirmTitle}>确认移除收款码？</ThemedText>
                    <ThemedText style={[styles.confirmBody, { color: colors.mutedText }]}>
                      移除后，用户端扫码支付页将显示「收款码暂未配置」。
                    </ThemedText>
                    <View style={styles.actionRow}>
                      <Pressable
                        accessibilityRole="button"
                        disabled={removing}
                        onPress={() => setConfirmingRemove(false)}
                        style={[styles.secondaryButton, { borderColor: colors.line }]}>
                        <ThemedText style={styles.secondaryButtonText}>取消</ThemedText>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        disabled={removing}
                        onPress={() => void handleRemoveQR()}
                        style={[styles.dangerButton, { opacity: removing ? 0.6 : 1 }]}>
                        {removing ? (
                          <ActivityIndicator color="#ffffff" size="small" />
                        ) : (
                          <MaterialCommunityIcons name="trash-can-outline" size={15} color="#ffffff" />
                        )}
                        <ThemedText style={styles.dangerButtonText}>
                          {removing ? '正在移除' : '确认移除'}
                        </ThemedText>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <View style={styles.actionRow}>
                    <Pressable
                      accessibilityRole="button"
                      disabled={uploading}
                      onPress={() => void handlePickQR()}
                      style={({ pressed }) => [
                        styles.primaryButton,
                        { opacity: uploading || pressed ? 0.72 : 1 },
                      ]}>
                      {uploading ? (
                        <ActivityIndicator color="#ffffff" size="small" />
                      ) : (
                        <MaterialCommunityIcons name="upload" size={15} color="#ffffff" />
                      )}
                      <ThemedText style={styles.primaryButtonText}>
                        {uploading ? '正在上传' : settings?.enabled ? '更换收款码' : '上传收款码'}
                      </ThemedText>
                    </Pressable>
                    {settings?.enabled ? (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => setConfirmingRemove(true)}
                        style={[styles.secondaryButton, { borderColor: colors.line }]}>
                        <MaterialCommunityIcons name="trash-can-outline" size={15} color="#d86f5b" />
                        <ThemedText style={[styles.secondaryButtonText, { color: '#d86f5b' }]}>
                          移除
                        </ThemedText>
                      </Pressable>
                    ) : null}
                  </View>
                )}
              </View>

              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.line }]}>
                <CardHead title="支付说明与定价" hint="保存后用户端即时更新" />
                <ThemedText style={styles.fieldLabel}>转账备注要求</ThemedText>
                <TextInput
                  accessibilityLabel="转账备注要求"
                  maxLength={200}
                  multiline
                  onChangeText={setNoteDraft}
                  placeholder="输入转账备注要求"
                  placeholderTextColor={colors.mutedText}
                  selectionColor={colors.primary}
                  style={[
                    styles.noteInput,
                    {
                      backgroundColor: colors.surfaceMuted,
                      borderColor: colors.line,
                      color: colors.text,
                    },
                  ]}
                  textAlignVertical="top"
                  value={noteDraft}
                />
                <View style={[styles.priceList, { borderTopColor: colors.line }]}>
                  <PriceRow icon="diamond-stone" label="VIP 单月人工开通" price="¥2 / 月" tone="#e8a33d" />
                  <PriceRow icon="crown-outline" label="SVIP 单月人工开通" price="¥5 / 月" tone="#e8667a" />
                </View>
                <Pressable
                  accessibilityRole="button"
                  disabled={saving}
                  onPress={() => void handleSaveNote()}
                  style={({ pressed }) => [
                    styles.saveButton,
                    { backgroundColor: colors.hero, opacity: saving || pressed ? 0.72 : 1 },
                  ]}>
                  {saving ? (
                    <ActivityIndicator color="#ffffff" size="small" />
                  ) : (
                    <MaterialCommunityIcons name="content-save-outline" size={16} color="#ffffff" />
                  )}
                  <ThemedText style={styles.saveButtonText}>
                    {saving ? '正在保存' : '保存设置'}
                  </ThemedText>
                </Pressable>
              </View>
            </View>

            <View style={[styles.grid, isDesktop && styles.gridDesktop]}>
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.line }]}>
                <CardHead title="开通处理指引" hint="人工核销规范" />
                <GuideStep number={1} text="核对转账备注中的手机号与金额" />
                <GuideStep number={2} text="在用户身份中搜索该手机号" />
                <GuideStep number={3} text="调整身份并填写付款来源，留存审计" />
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push('/admin/users')}
                  style={({ pressed }) => [
                    styles.guideButton,
                    { backgroundColor: colors.primary, opacity: pressed ? 0.78 : 1 },
                  ]}>
                  <MaterialCommunityIcons name="account-key-outline" size={16} color="#ffffff" />
                  <ThemedText style={styles.guideButtonText}>前往用户身份开通</ThemedText>
                </Pressable>
              </View>

              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.line }]}>
                <CardHead title="配置变更记录" hint={`${changes.length} 条`} />
                {changes.length > 0 ? (
                  changes.slice(0, 4).map((change) => <ChangeRow change={change} key={change.id} />)
                ) : (
                  <View style={styles.changesEmpty}>
                    <MaterialCommunityIcons name="history" size={22} color={colors.mutedText} />
                    <ThemedText style={[styles.stateText, { color: colors.mutedText }]}>
                      暂无配置变更记录
                    </ThemedText>
                  </View>
                )}
              </View>
            </View>
          </>
        )}
      </View>
    </ScrollView>
  );
}

function SummaryItem({ icon, label, value }: { icon: keyof typeof MaterialCommunityIcons.glyphMap; label: string; value: string }) {
  return (
    <View style={styles.summaryItem}>
      <View style={styles.summaryIcon}>
        <MaterialCommunityIcons name={icon} size={18} color="#c9f36a" />
      </View>
      <View>
        <ThemedText style={styles.summaryValue}>{value}</ThemedText>
        <ThemedText style={styles.summaryLabel}>{label}</ThemedText>
      </View>
    </View>
  );
}

function CardHead({ hint, title }: { hint: string; title: string }) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.cardHead}>
      <ThemedText style={styles.cardTitle}>{title}</ThemedText>
      <ThemedText style={[styles.cardHint, { color: colors.mutedText }]}>{hint}</ThemedText>
    </View>
  );
}

function PriceRow({ icon, label, price, tone }: { icon: keyof typeof MaterialCommunityIcons.glyphMap; label: string; price: string; tone: string }) {
  return (
    <View style={styles.priceRow}>
      <View style={[styles.priceTag, { backgroundColor: `${tone}1a` }]}>
        <MaterialCommunityIcons name={icon} size={12} color={tone} />
        <ThemedText style={[styles.priceTagText, { color: tone }]}>
          {label.startsWith('VIP') ? 'VIP' : 'SVIP'}
        </ThemedText>
      </View>
      <ThemedText style={[styles.priceCopy, { color: '#7483a2' }]}>{label}</ThemedText>
      <ThemedText style={styles.priceNum}>{price}</ThemedText>
    </View>
  );
}

function GuideStep({ number, text }: { number: number; text: string }) {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.guideStep, { borderTopColor: colors.line }]}>
      <View style={[styles.guideNum, { backgroundColor: colors.surfaceMuted }]}>
        <ThemedText style={[styles.guideNumText, { color: colors.mutedText }]}>{number}</ThemedText>
      </View>
      <ThemedText style={styles.guideText}>{text}</ThemedText>
    </View>
  );
}

function ChangeRow({ change }: { change: MembershipChange }) {
  const { colors } = useAppTheme();
  const tone = change.action === 'qr_remove' ? '#e8667a' : change.action === 'note_update' ? '#e8a33d' : '#4568f2';
  return (
    <View style={[styles.changeRow, { borderTopColor: colors.line }]}>
      <View style={[styles.changeDot, { backgroundColor: tone }]} />
      <View style={styles.changeCopy}>
        <ThemedText style={styles.changeTitle}>{change.detail}</ThemedText>
        <ThemedText style={[styles.changeMeta, { color: colors.mutedText }]}>
          {change.operatorDisplayName || change.operatorUsername} · {formatDateTime(change.createdAt)}
        </ThemedText>
      </View>
    </View>
  );
}

function MessageBar({ message }: { message: FormMessage }) {
  const { colors } = useAppTheme();
  const tone = message.tone === 'success' ? colors.success : '#d86f5b';
  return (
    <View style={[styles.messageBar, { backgroundColor: `${tone}14` }]}>
      <MaterialCommunityIcons
        name={message.tone === 'success' ? 'check-circle-outline' : 'alert-circle-outline'}
        size={17}
        color={tone}
      />
      <ThemedText style={[styles.messageText, { color: tone }]}>{message.text}</ThemedText>
    </View>
  );
}

function formatPrice(priceCents: number) {
  return (priceCents / 100).toFixed(0);
}

function formatDateTime(value: string) {
  if (!value) return '';
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  page: {
    alignSelf: 'center',
    gap: 16,
    maxWidth: 1080,
    padding: 24,
    width: '100%',
  },
  pageDesktop: {},
  titleRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'space-between',
  },
  titleCopy: { flex: 1, minWidth: 240 },
  pageTitle: { fontSize: 24, fontWeight: '900', lineHeight: 30 },
  pageSubtitle: { fontSize: 12, lineHeight: 18, marginTop: 4 },
  configBadge: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    minHeight: 34,
    paddingHorizontal: 11,
  },
  configBadgeText: { fontSize: 10, fontWeight: '800' },
  summaryBand: {
    borderRadius: 8,
    flexDirection: 'row',
    minHeight: 88,
    padding: 16,
  },
  summaryItem: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 11,
    minWidth: 0,
    paddingHorizontal: 10,
  },
  summaryIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(201,243,106,0.10)',
    borderRadius: 7,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  summaryValue: { color: '#ffffff', fontSize: 17, fontWeight: '900', lineHeight: 22 },
  summaryLabel: { color: '#aab4d2', fontSize: 9, fontWeight: '700', marginTop: 2 },
  grid: { gap: 14 },
  gridDesktop: { flexDirection: 'row' },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    minWidth: 0,
    padding: 15,
  },
  cardHead: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cardTitle: { fontSize: 13, fontWeight: '900' },
  cardHint: { fontSize: 8, fontWeight: '600' },
  qrPreview: {
    alignSelf: 'center',
    borderRadius: 12,
    borderWidth: 1,
    height: 190,
    marginTop: 14,
    width: 190,
  },
  qrEmpty: {
    alignItems: 'center',
    borderStyle: 'dashed',
    borderWidth: 1,
    gap: 8,
    justifyContent: 'center',
    marginTop: 14,
    minHeight: 190,
  },
  qrEmptyText: { fontSize: 11, fontWeight: '700' },
  qrMeta: { fontSize: 9, fontWeight: '600', marginTop: 12, textAlign: 'center' },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#4568f2',
    borderRadius: 7,
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    height: 36,
    justifyContent: 'center',
  },
  primaryButtonText: { color: '#ffffff', fontSize: 10, fontWeight: '900' },
  secondaryButton: {
    alignItems: 'center',
    borderRadius: 7,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 5,
    height: 36,
    justifyContent: 'center',
    paddingHorizontal: 13,
  },
  secondaryButtonText: { fontSize: 10, fontWeight: '900' },
  dangerButton: {
    alignItems: 'center',
    backgroundColor: '#d86f5b',
    borderRadius: 7,
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    height: 36,
    justifyContent: 'center',
  },
  dangerButtonText: { color: '#ffffff', fontSize: 10, fontWeight: '900' },
  confirmBox: {
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    marginTop: 12,
    padding: 11,
  },
  confirmTitle: { fontSize: 11, fontWeight: '900' },
  confirmBody: { fontSize: 10, fontWeight: '600', lineHeight: 15 },
  fieldLabel: { color: '#7483a2', fontSize: 9, fontWeight: '800', marginTop: 14 },
  noteInput: {
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 11,
    lineHeight: 17,
    marginTop: 7,
    minHeight: 72,
    padding: 10,
  },
  priceList: {
    borderTopWidth: 1,
    marginTop: 12,
    paddingTop: 8,
  },
  priceRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    minHeight: 36,
  },
  priceTag: {
    alignItems: 'center',
    borderRadius: 6,
    flexDirection: 'row',
    gap: 4,
    height: 24,
    paddingHorizontal: 7,
  },
  priceTagText: { fontSize: 9, fontWeight: '900' },
  priceCopy: { flex: 1, fontSize: 9, fontWeight: '700' },
  priceNum: { fontSize: 12, fontWeight: '800' },
  saveButton: {
    alignItems: 'center',
    borderRadius: 7,
    flexDirection: 'row',
    gap: 6,
    height: 38,
    justifyContent: 'center',
    marginTop: 14,
  },
  saveButtonText: { color: '#ffffff', fontSize: 11, fontWeight: '900' },
  guideStep: {
    alignItems: 'center',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 9,
    minHeight: 40,
  },
  guideNum: {
    alignItems: 'center',
    borderRadius: 11,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  guideNumText: { fontSize: 9, fontWeight: '900' },
  guideText: { flex: 1, fontSize: 10, fontWeight: '700' },
  guideButton: {
    alignItems: 'center',
    borderRadius: 7,
    flexDirection: 'row',
    gap: 6,
    height: 38,
    justifyContent: 'center',
    marginTop: 12,
  },
  guideButtonText: { color: '#ffffff', fontSize: 11, fontWeight: '900' },
  changeRow: {
    alignItems: 'flex-start',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 9,
    minHeight: 48,
    paddingVertical: 9,
  },
  changeDot: { borderRadius: 4, height: 8, marginTop: 5, width: 8 },
  changeCopy: { flex: 1, minWidth: 0 },
  changeTitle: { fontSize: 10, fontWeight: '900' },
  changeMeta: { fontSize: 8, fontWeight: '600', marginTop: 4 },
  changesEmpty: {
    alignItems: 'center',
    gap: 7,
    paddingVertical: 20,
  },
  statePanel: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    gap: 9,
    justifyContent: 'center',
    minHeight: 180,
  },
  stateText: { fontSize: 11, fontWeight: '700', textAlign: 'center' },
  messageBar: {
    alignItems: 'flex-start',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 7,
    padding: 10,
  },
  messageText: { flex: 1, fontSize: 10, fontWeight: '700', lineHeight: 15 },
});
