import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import { Redirect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/features/auth/auth-provider';
import { useAppTheme } from '@/hooks/use-app-theme';
import { maskUsername } from '@/lib/admin-users';
import {
  getMembershipPaymentErrorMessage,
  getMembershipPaymentInfo,
} from '@/lib/membership-payment-api';
import {
  formatPriceCents,
  membershipPlanForTier,
  membershipPlanName,
} from '@/lib/membership-payment-model';
import { AppLoadingScreen } from '@/shared/ui/app-loading-screen';
import { MobileScreen } from '@/shared/ui/mobile-screen';
import type { MembershipPaymentInfo, MembershipPlan } from '@/types/membership';

export function MembershipPaymentScreen() {
  const params = useLocalSearchParams<{ tier?: string }>();
  const router = useRouter();
  const { colorScheme, colors } = useAppTheme();
  const { accessToken, refreshUser, status, user } = useAuth();
  const [paymentInfo, setPaymentInfo] = useState<MembershipPaymentInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const tier = params.tier === 'svip' ? 'svip' : 'vip';
  const dark = colorScheme === 'dark';
  const planColor = tier === 'svip' ? (dark ? '#ff8ba3' : '#e8667a') : (dark ? '#f2c14e' : '#e8a33d');
  const plan = membershipPlanForTier(tier, paymentInfo?.plans ?? []);
  const planName = membershipPlanName(tier);
  const isMember = user?.role === 'vip' || user?.role === 'svip';

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError('');
    try {
      setPaymentInfo(await getMembershipPaymentInfo(accessToken));
    } catch (loadError) {
      setError(getMembershipPaymentErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  if (status === 'loading') {
    return <AppLoadingScreen />;
  }
  if (status !== 'authenticated' || !user || !accessToken) {
    return <Redirect href="/auth" />;
  }

  if (user.role === 'svip' || user.role === 'admin') {
    return (
      <MobileScreen contentContainerStyle={styles.pageContent}>
        <TopBar subtitle={planName} title="扫码支付" onBack={() => router.back()} />
        <View style={[styles.statePanel, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <View style={[styles.stateIcon, { backgroundColor: colors.primarySoft }]}>
            <MaterialCommunityIcons
              name={user.role === 'svip' ? 'crown-outline' : 'shield-check-outline'}
              size={30}
              color={colors.primary}
            />
          </View>
          <ThemedText style={styles.stateTitle}>
            {user.role === 'svip' ? '已开通全部会员等级' : '管理员账号无需开通会员'}
          </ThemedText>
          <ThemedText style={[styles.stateBody, { color: colors.mutedText }]}>
            {user.role === 'svip'
              ? '你的 SVIP 权益已全部生效，回到会员中心查看身份与权益。'
              : '当前账号拥有后台管理权限，不参与会员购买流程。'}
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/profile/membership' as Href)}
            style={({ pressed }) => [
              styles.primaryAction,
              { backgroundColor: colors.hero, opacity: pressed ? 0.78 : 1 },
            ]}>
            <ThemedText style={styles.primaryActionText}>返回会员中心</ThemedText>
          </Pressable>
        </View>
      </MobileScreen>
    );
  }

  if (loading && !paymentInfo) {
    return (
      <MobileScreen contentContainerStyle={styles.pageContent}>
        <TopBar subtitle={planName} title="扫码支付" onBack={() => router.back()} />
        <View style={styles.loadingPanel}>
          <ActivityIndicator color={colors.primary} />
          <ThemedText style={[styles.loadingText, { color: colors.mutedText }]}>
            正在读取收款信息
          </ThemedText>
        </View>
      </MobileScreen>
    );
  }

  if (error && !paymentInfo) {
    return (
      <MobileScreen contentContainerStyle={styles.pageContent}>
        <TopBar subtitle={planName} title="扫码支付" onBack={() => router.back()} />
        <View style={[styles.statePanel, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <View style={[styles.stateIcon, { backgroundColor: '#d86f5b18' }]}>
            <MaterialCommunityIcons name="alert-circle-outline" size={30} color="#d86f5b" />
          </View>
          <ThemedText style={styles.stateTitle}>收款信息加载失败</ThemedText>
          <ThemedText style={[styles.stateBody, { color: colors.mutedText }]}>{error}</ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={() => void load()}
            style={({ pressed }) => [
              styles.primaryAction,
              { backgroundColor: colors.hero, opacity: pressed ? 0.78 : 1 },
            ]}>
            <ThemedText style={styles.primaryActionText}>重新加载</ThemedText>
          </Pressable>
        </View>
      </MobileScreen>
    );
  }

  if (paymentInfo && !paymentInfo.enabled) {
    return (
      <MobileScreen contentContainerStyle={styles.pageContent}>
        <TopBar subtitle={planName} title="扫码支付" onBack={() => router.back()} />
        <OrderCard plan={plan} planColor={planColor} />
        <View style={[styles.emptyQR, { borderColor: colors.line }]}>
          <MaterialCommunityIcons name="qrcode" size={30} color={colors.mutedText} />
          <ThemedText style={styles.emptyQRTitle}>收款码暂未配置</ThemedText>
          <ThemedText style={[styles.emptyQRBody, { color: colors.mutedText }]}>
            请联系管理员配置收款码后重试，本页不会展示任何占位二维码。
          </ThemedText>
        </View>
        <View style={[styles.primaryAction, styles.primaryActionDisabled, { backgroundColor: colors.surfaceMuted }]}>
          <ThemedText style={[styles.primaryActionText, { color: colors.mutedText }]}>
            我已支付，等待开通
          </ThemedText>
        </View>
        <ContactAdminLink />
        <Disclaimer />
      </MobileScreen>
    );
  }

  if (submitted) {
    return (
      <MobileScreen contentContainerStyle={styles.pageContent}>
        <TopBar subtitle={planName} title="开通申请" onBack={() => router.back()} />
        {isMember ? (
          <View style={[styles.waitHero, { backgroundColor: '#1db991' }]}>
            <View style={styles.waitIcon}>
              <MaterialCommunityIcons name="check" size={22} color="#ffffff" />
            </View>
            <ThemedText style={styles.waitTitle}>会员已开通</ThemedText>
            <ThemedText style={styles.waitSub}>身份已更新为{user?.role === 'vip' ? ' VIP' : ' SVIP'}，权益已生效。</ThemedText>
          </View>
        ) : (
          <View style={[styles.waitHero, { backgroundColor: colors.hero }]}>
            <View style={styles.waitIcon}>
              <MaterialCommunityIcons name="timer-sand" size={22} color="#c9f36a" />
            </View>
            <ThemedText style={styles.waitTitle}>开通申请已提交</ThemedText>
            <ThemedText style={styles.waitSub}>
              请等待管理员核实转账并手动开通，通常 24 小时内完成。
            </ThemedText>
          </View>
        )}
        <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <StepRow done label="扫码支付" detail={`微信 / 支付宝支付 ¥${formatPriceCents(plan.priceCents)}`} />
          <StepRow done label="备注手机号" detail={maskUsername(user.username)} />
          <StepRow
            current={!isMember}
            done={isMember}
            label="管理员核实开通"
            detail={isMember ? '身份已生效' : '人工核对转账备注'}
          />
        </View>
        <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <View style={styles.noticeRow}>
            <View style={[styles.noticeIcon, { backgroundColor: colors.primarySoft }]}>
              <MaterialCommunityIcons name="bell-ring-outline" size={18} color={colors.primary} />
            </View>
            <View style={styles.noticeCopy}>
              <ThemedText style={styles.noticeTitle}>开通成功后会提醒你</ThemedText>
              <ThemedText style={[styles.noticeBody, { color: colors.mutedText }]}>
                身份更新后，前台与会员中心自动刷新。
              </ThemedText>
            </View>
          </View>
        </View>
        <Pressable
          accessibilityRole="button"
          disabled={refreshing || isMember}
          onPress={() => void handleRefresh()}
          style={({ pressed }) => [
            styles.primaryAction,
            { backgroundColor: colors.hero, opacity: refreshing || pressed ? 0.72 : 1 },
          ]}>
          {refreshing ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <MaterialCommunityIcons name="refresh" size={18} color="#ffffff" />
          )}
          <ThemedText style={styles.primaryActionText}>
            {isMember ? '返回会员中心' : refreshing ? '正在刷新' : '刷新开通状态'}
          </ThemedText>
        </Pressable>
        <ContactAdminLink />
        <Disclaimer text="如超过 24 小时未开通，请通过问题反馈提交付款截图与手机号，管理员会优先核实。" />
      </MobileScreen>
    );
  }

  return (
    <MobileScreen contentContainerStyle={styles.pageContent}>
      <TopBar subtitle={`${planName} · ¥${formatPriceCents(plan.priceCents)}`} title="扫码支付" onBack={() => router.back()} />
      <OrderCard plan={plan} planColor={planColor} />
      <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <ThemedText style={styles.qrTitle}>扫描下方二维码付款</ThemedText>
        <ThemedText style={[styles.qrSub, { color: colors.mutedText }]}>
          收款码由管理员配置 · 仅登录用户可见
        </ThemedText>
        {paymentInfo?.qrUrl ? (
          <Image
            accessibilityLabel="收款二维码"
            contentFit="contain"
            source={{ uri: paymentInfo.qrUrl }}
            style={[styles.qrImage, { borderColor: colors.line }]}
          />
        ) : null}
        <View style={styles.qrAmount}>
          <ThemedText style={[styles.qrYen, { color: planColor }]}>¥</ThemedText>
          <ThemedText style={[styles.qrNum, { color: planColor }]}>
            {formatPriceCents(plan.priceCents)}
          </ThemedText>
        </View>
      </View>
      <View style={[styles.noteStrip, { backgroundColor: '#fff8ec', borderColor: '#f0d9a8' }]}>
        <MaterialCommunityIcons name="message-outline" size={17} color="#8a5b13" />
        <View style={styles.noticeCopy}>
          <ThemedText style={styles.noteTitle}>转账备注填写注册手机号</ThemedText>
          <ThemedText style={styles.noteBody}>
            请备注 {maskUsername(user.username)}，管理员凭备注核对并手动开通，请勿关闭本页。
          </ThemedText>
        </View>
      </View>
      <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <StepRow number={1} label="扫码支付" detail={`微信或支付宝扫码支付 ¥${formatPriceCents(plan.priceCents)}`} />
        <StepRow number={2} label="备注手机号" detail="转账时填写注册手机号" />
        <StepRow number={3} label="等待开通" detail="管理员核实后手动开通" />
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={() => setSubmitted(true)}
        style={({ pressed }) => [
          styles.primaryAction,
          { backgroundColor: planColor, opacity: pressed ? 0.78 : 1 },
        ]}>
        <MaterialCommunityIcons name="check" size={18} color="#ffffff" />
        <ThemedText style={styles.primaryActionText}>我已支付，等待开通</ThemedText>
      </Pressable>
      <ContactAdminLink />
      <Disclaimer />
    </MobileScreen>
  );

  async function handleRefresh() {
    if (!accessToken || isMember) return;
    setRefreshing(true);
    try {
      await refreshUser();
      await load();
    } finally {
      setRefreshing(false);
    }
  }
}

function TopBar({
  onBack,
  subtitle,
  title,
}: {
  onBack: () => void;
  subtitle: string;
  title: string;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.topBar}>
      <Pressable
        accessibilityLabel="返回"
        accessibilityRole="button"
        onPress={onBack}
        style={[styles.iconButton, { backgroundColor: colors.surface }]}>
        <MaterialCommunityIcons name="arrow-left" size={21} color={colors.text} />
      </Pressable>
      <View style={styles.topBarCopy}>
        <ThemedText style={styles.pageTitle}>{title}</ThemedText>
        <ThemedText style={[styles.pageSubtitle, { color: colors.mutedText }]}>
          {subtitle}
        </ThemedText>
      </View>
      <View style={styles.iconButtonSpacer} />
    </View>
  );
}

function OrderCard({ plan, planColor }: { plan: MembershipPlan; planColor: string }) {
  const { colors } = useAppTheme();
  const name = membershipPlanName(plan.tier);
  return (
    <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <View style={styles.orderRow}>
        <View style={[styles.orderIcon, { backgroundColor: `${planColor}1f` }]}>
          <MaterialCommunityIcons
            name={plan.tier === 'svip' ? 'crown-outline' : 'diamond-stone'}
            size={20}
            color={planColor}
          />
        </View>
        <View style={styles.orderCopy}>
          <ThemedText style={styles.orderName}>{name}</ThemedText>
          <ThemedText style={[styles.orderDesc, { color: colors.mutedText }]}>
            单月购买 · 人工开通
          </ThemedText>
        </View>
        <ThemedText style={[styles.orderPrice, { color: planColor }]}>
          ¥{formatPriceCents(plan.priceCents)}
        </ThemedText>
      </View>
    </View>
  );
}

function StepRow({
  current = false,
  detail,
  done = false,
  label,
  number,
}: {
  current?: boolean;
  detail: string;
  done?: boolean;
  label: string;
  number?: number;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.stepRow, { borderTopColor: colors.line }]}>
      <View
        style={[
          styles.stepNum,
          {
            backgroundColor: done ? '#1db991' : current ? colors.primary : colors.surfaceMuted,
          },
        ]}>
        {done ? (
          <MaterialCommunityIcons name="check" size={11} color="#ffffff" />
        ) : (
          <ThemedText style={[styles.stepNumText, { color: current ? '#ffffff' : colors.mutedText }]}>
            {number ?? ''}
          </ThemedText>
        )}
      </View>
      <View style={styles.stepCopy}>
        <ThemedText style={styles.stepName}>{label}</ThemedText>
        <ThemedText style={[styles.stepDesc, { color: colors.mutedText }]}>{detail}</ThemedText>
      </View>
      {done ? (
        <ThemedText style={[styles.stepState, { color: '#1db991' }]}>已完成</ThemedText>
      ) : current ? (
        <ThemedText style={[styles.stepState, { color: colors.primary }]}>进行中</ThemedText>
      ) : null}
    </View>
  );
}

function ContactAdminLink() {
  const router = useRouter();
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push('/profile/feedback' as Href)}
      style={styles.linkRow}>
      <MaterialCommunityIcons name="headset" size={14} color={colors.primary} />
      <ThemedText style={[styles.linkText, { color: colors.primary }]}>
        联系管理员 · 上传付款截图
      </ThemedText>
    </Pressable>
  );
}

function Disclaimer({ text }: { text?: string }) {
  const { colors } = useAppTheme();
  return (
    <ThemedText style={[styles.disclaimer, { color: colors.mutedText }]}>
      {text ??
        '人工开通非自动到账，管理员核实后手动调整身份，通常 24 小时内完成。'}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  pageContent: {
    gap: 16,
    paddingTop: 14,
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: 16,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  iconButtonSpacer: {
    height: 42,
    width: 42,
  },
  topBarCopy: {
    flex: 1,
    marginLeft: 10,
  },
  pageTitle: {
    fontSize: 18,
    fontWeight: '900',
  },
  pageSubtitle: {
    fontSize: 10,
    fontWeight: '700',
    marginTop: 3,
  },
  panel: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
  },
  orderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 11,
  },
  orderIcon: {
    alignItems: 'center',
    borderRadius: 11,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  orderCopy: {
    flex: 1,
    minWidth: 0,
  },
  orderName: {
    fontSize: 13,
    fontWeight: '900',
  },
  orderDesc: {
    fontSize: 9,
    fontWeight: '600',
    marginTop: 3,
  },
  orderPrice: {
    fontSize: 18,
    fontWeight: '900',
  },
  qrTitle: {
    fontSize: 13,
    fontWeight: '900',
    textAlign: 'center',
  },
  qrSub: {
    fontSize: 9,
    fontWeight: '600',
    marginTop: 4,
    textAlign: 'center',
  },
  qrImage: {
    alignSelf: 'center',
    borderRadius: 14,
    borderWidth: 1,
    height: 196,
    marginTop: 14,
    width: 196,
  },
  qrAmount: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: 4,
    justifyContent: 'center',
    marginTop: 12,
  },
  qrYen: {
    fontSize: 13,
    fontWeight: '900',
  },
  qrNum: {
    fontSize: 26,
    fontWeight: '900',
  },
  noteStrip: {
    alignItems: 'flex-start',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 9,
    padding: 12,
  },
  noteTitle: {
    fontSize: 11,
    fontWeight: '900',
  },
  noteBody: {
    color: '#6d5a32',
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 16,
    marginTop: 4,
  },
  stepRow: {
    alignItems: 'center',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 48,
    paddingVertical: 8,
  },
  stepNum: {
    alignItems: 'center',
    borderRadius: 11,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  stepNumText: {
    fontSize: 9,
    fontWeight: '900',
  },
  stepCopy: {
    flex: 1,
    minWidth: 0,
  },
  stepName: {
    fontSize: 11,
    fontWeight: '900',
  },
  stepDesc: {
    fontSize: 9,
    fontWeight: '600',
    marginTop: 3,
  },
  stepState: {
    fontSize: 9,
    fontWeight: '900',
  },
  primaryAction: {
    alignItems: 'center',
    borderRadius: 14,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 50,
    paddingHorizontal: 16,
  },
  primaryActionDisabled: {
    opacity: 0.6,
  },
  primaryActionText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '900',
  },
  linkRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 5,
    justifyContent: 'center',
    minHeight: 36,
  },
  linkText: {
    fontSize: 11,
    fontWeight: '800',
  },
  disclaimer: {
    fontSize: 9,
    fontWeight: '600',
    lineHeight: 15,
    textAlign: 'center',
  },
  loadingPanel: {
    alignItems: 'center',
    gap: 10,
    justifyContent: 'center',
    minHeight: 300,
  },
  loadingText: {
    fontSize: 12,
    fontWeight: '700',
  },
  statePanel: {
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1,
    gap: 10,
    marginTop: 40,
    padding: 24,
  },
  stateIcon: {
    alignItems: 'center',
    borderRadius: 22,
    height: 60,
    justifyContent: 'center',
    width: 60,
  },
  stateTitle: {
    fontSize: 17,
    fontWeight: '900',
    marginTop: 4,
    textAlign: 'center',
  },
  stateBody: {
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 19,
    textAlign: 'center',
  },
  emptyQR: {
    alignItems: 'center',
    borderRadius: 18,
    borderStyle: 'dashed',
    borderWidth: 1,
    gap: 8,
    justifyContent: 'center',
    minHeight: 190,
    padding: 18,
  },
  emptyQRTitle: {
    fontSize: 13,
    fontWeight: '900',
  },
  emptyQRBody: {
    fontSize: 10,
    fontWeight: '600',
    lineHeight: 16,
    textAlign: 'center',
  },
  waitHero: {
    borderRadius: 18,
    padding: 17,
  },
  waitIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderRadius: 12,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  waitTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '900',
    marginTop: 12,
  },
  waitSub: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 10,
    fontWeight: '600',
    lineHeight: 16,
    marginTop: 5,
  },
  noticeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  noticeIcon: {
    alignItems: 'center',
    borderRadius: 10,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  noticeCopy: {
    flex: 1,
    minWidth: 0,
  },
  noticeTitle: {
    fontSize: 11,
    fontWeight: '900',
  },
  noticeBody: {
    fontSize: 9,
    fontWeight: '600',
    marginTop: 3,
  },
});
