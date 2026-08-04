import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Redirect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useState, type ComponentProps } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/features/auth/auth-provider';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  getAuthErrorMessage,
  getPasswordRecoveryQuestion,
  resetPasswordWithRecoveryToken,
  verifyPasswordRecoveryAnswer,
} from '@/lib/auth-api';
import {
  isValidPassword,
  isValidPhoneAccount,
  isValidSecurityAnswer,
  normalizePhoneInput,
  SECURITY_ANSWER_MAX_LENGTH,
  SECURITY_QUESTIONS,
} from '@/lib/auth-validation';
import { MobileScreen } from '@/shared/ui/mobile-screen';

type AuthMode = 'login' | 'register' | 'recovery';
type RecoveryStep = 'account' | 'answer' | 'reset';

type FormMessage = {
  text: string;
  tone: 'error' | 'success';
};

const recoverySteps: { key: RecoveryStep; label: string }[] = [
  { key: 'account', label: '账号' },
  { key: 'answer', label: '密保' },
  { key: 'reset', label: '新密码' },
];

export function AuthScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ returnTo?: string }>();
  const { colors } = useAppTheme();
  const { register, signIn, status } = useAuth();
  const [mode, setMode] = useState<AuthMode>('login');
  const [recoveryStep, setRecoveryStep] = useState<RecoveryStep>('account');
  const [phone, setPhone] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmPasswordVisible, setConfirmPasswordVisible] = useState(false);
  const [securityQuestion, setSecurityQuestion] = useState('');
  const [securityAnswer, setSecurityAnswer] = useState('');
  const [questionMenuOpen, setQuestionMenuOpen] = useState(false);
  const [recoveryQuestion, setRecoveryQuestion] = useState('');
  const [recoveryToken, setRecoveryToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [newPasswordVisible, setNewPasswordVisible] = useState(false);
  const [newPasswordConfirmVisible, setNewPasswordConfirmVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<FormMessage | null>(null);
  const rawReturnTo =
    typeof params.returnTo === 'string' &&
    (params.returnTo.startsWith('/tools/') ||
      params.returnTo.startsWith('/profile/feedback') ||
      params.returnTo.startsWith('/admin'))
      ? params.returnTo
      : '/profile';
  const returnTo = rawReturnTo as unknown as Href;

  if (status === 'authenticated') {
    return <Redirect href={returnTo} />;
  }

  function showError(text: string) {
    setMessage({ text, tone: 'error' });
  }

  function validatePhone() {
    if (isValidPhoneAccount(phone)) return true;
    showError('请输入正确的 11 位中国大陆手机号。');
    return false;
  }

  function handlePhoneChange(value: string) {
    setPhone(normalizePhoneInput(value));
    if (message?.tone === 'error') setMessage(null);
  }

  async function handleAuthSubmit() {
    setMessage(null);
    if (!validatePhone()) return;

    if (mode === 'register') {
      if (!displayName.trim()) {
        showError('请输入昵称。');
        return;
      }
      if (!isValidPassword(password)) {
        showError('密码需为 8 至 72 个字符，并同时包含字母和数字。');
        return;
      }
      if (password !== confirmPassword) {
        showError('两次输入的密码不一致。');
        return;
      }
      if (!securityQuestion) {
        showError('请选择一个密保问题。');
        return;
      }
      if (!isValidSecurityAnswer(securityAnswer)) {
        showError(`密保答案需为 1 至 ${SECURITY_ANSWER_MAX_LENGTH} 个字符。`);
        return;
      }
    }

    setSubmitting(true);
    try {
      if (mode === 'register') {
        await register(phone, password, displayName, securityQuestion, securityAnswer);
      } else {
        await signIn(phone, password);
      }
      router.replace(returnTo);
    } catch (error) {
      showError(getAuthErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRecoveryAccount() {
    setMessage(null);
    if (!validatePhone()) return;

    setSubmitting(true);
    try {
      setRecoveryQuestion(await getPasswordRecoveryQuestion(phone));
      setRecoveryStep('answer');
    } catch (error) {
      showError(getAuthErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRecoveryAnswer() {
    setMessage(null);
    if (!isValidSecurityAnswer(securityAnswer)) {
      showError('请输入密保答案。');
      return;
    }

    setSubmitting(true);
    try {
      setRecoveryToken(await verifyPasswordRecoveryAnswer(phone, securityAnswer));
      setRecoveryStep('reset');
    } catch (error) {
      showError(getAuthErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRecoveryReset() {
    setMessage(null);
    if (!isValidPassword(newPassword)) {
      showError('密码需为 8 至 72 个字符，并同时包含字母和数字。');
      return;
    }
    if (newPassword !== newPasswordConfirm) {
      showError('两次输入的新密码不一致。');
      return;
    }

    setSubmitting(true);
    try {
      await resetPasswordWithRecoveryToken(recoveryToken, newPassword);
      setMode('login');
      resetRecoveryState();
      setPassword('');
      setMessage({ text: '密码已修改，请使用新密码登录。', tone: 'success' });
    } catch (error) {
      showError(getAuthErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  function resetRecoveryState() {
    setRecoveryStep('account');
    setRecoveryQuestion('');
    setRecoveryToken('');
    setSecurityAnswer('');
    setNewPassword('');
    setNewPasswordConfirm('');
    setNewPasswordVisible(false);
    setNewPasswordConfirmVisible(false);
  }

  function switchMode(nextMode: Exclude<AuthMode, 'recovery'>) {
    setMode(nextMode);
    setMessage(null);
    setPassword('');
    setConfirmPassword('');
    setSecurityAnswer('');
    setQuestionMenuOpen(false);
    resetRecoveryState();
  }

  function startRecovery() {
    setMode('recovery');
    setMessage(null);
    setPassword('');
    resetRecoveryState();
  }

  function handleBack() {
    if (mode !== 'recovery') {
      router.back();
      return;
    }
    setMessage(null);
    if (recoveryStep === 'reset') {
      setRecoveryStep('answer');
      setRecoveryToken('');
      return;
    }
    if (recoveryStep === 'answer') {
      setRecoveryStep('account');
      setSecurityAnswer('');
      return;
    }
    switchMode('login');
  }

  const heading = getHeading(mode, recoveryStep, phone);
  const submit = getSubmitContent(mode, recoveryStep);

  return (
    <MobileScreen contentContainerStyle={styles.pageContent}>
      <View style={styles.topBar}>
        <Pressable
          accessibilityLabel={mode === 'recovery' ? '返回上一步' : '返回'}
          accessibilityRole="button"
          onPress={handleBack}
          style={[styles.iconButton, { backgroundColor: colors.surface }]}>
          <MaterialCommunityIcons name="arrow-left" size={21} color={colors.text} />
        </Pressable>
        <View style={[styles.brandMark, { backgroundColor: colors.surface }]}>
          <MaterialCommunityIcons name="cube-outline" size={18} color={colors.primary} />
          <ThemedText style={[styles.brandMarkText, { color: colors.primary }]}>FunBox</ThemedText>
        </View>
      </View>

      <View style={styles.headingBlock}>
        <ThemedText style={styles.pageTitle}>{heading.title}</ThemedText>
        <ThemedText style={[styles.pageDescription, { color: colors.mutedText }]}>
          {heading.description}
        </ThemedText>
      </View>

      <View style={[styles.formPanel, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        {mode === 'recovery' ? (
          <RecoveryProgress currentStep={recoveryStep} />
        ) : (
          <View style={[styles.modeSwitch, { backgroundColor: colors.surfaceMuted }]}>
            {(['login', 'register'] as const).map((item) => {
              const selected = item === mode;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  key={item}
                  onPress={() => switchMode(item)}
                  style={[
                    styles.modeButton,
                    { backgroundColor: selected ? colors.hero : 'transparent' },
                  ]}>
                  <ThemedText
                    style={[
                      styles.modeButtonText,
                      { color: selected ? '#ffffff' : colors.mutedText },
                    ]}>
                    {item === 'login' ? '登录' : '注册'}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        )}

        <View style={styles.fields}>
          {mode === 'register' ? (
            <AccountField
              autoCapitalize="none"
              icon="account-outline"
              label="昵称"
              onChangeText={setDisplayName}
              placeholder="例如：Brynn"
              textContentType="nickname"
              value={displayName}
            />
          ) : null}

          {mode !== 'recovery' || recoveryStep === 'account' ? (
            <AccountField
              autoCapitalize="none"
              autoCorrect={false}
              icon="cellphone"
              keyboardType="phone-pad"
              label="手机号"
              maxLength={11}
              onChangeText={handlePhoneChange}
              placeholder="请输入 11 位手机号"
              textContentType="telephoneNumber"
              value={phone}
            />
          ) : null}

          {mode === 'login' ? (
            <>
              <SecretField
                label="密码"
                onChangeText={setPassword}
                onSubmitEditing={() => void handleAuthSubmit()}
                placeholder="请输入登录密码"
                textContentType="password"
                value={password}
                visible={passwordVisible}
                onToggleVisible={() => setPasswordVisible((visible) => !visible)}
              />
              <Pressable
                accessibilityRole="button"
                onPress={startRecovery}
                style={styles.forgotButton}>
                <MaterialCommunityIcons name="key-outline" size={16} color={colors.primary} />
                <ThemedText style={[styles.forgotButtonText, { color: colors.primary }]}>
                  忘记密码
                </ThemedText>
              </Pressable>
            </>
          ) : null}

          {mode === 'register' ? (
            <>
              <SecretField
                label="登录密码"
                onChangeText={setPassword}
                placeholder="至少 8 位，包含字母和数字"
                textContentType="newPassword"
                value={password}
                visible={passwordVisible}
                onToggleVisible={() => setPasswordVisible((visible) => !visible)}
              />
              <SecretField
                label="确认密码"
                onChangeText={setConfirmPassword}
                placeholder="再次输入登录密码"
                textContentType="newPassword"
                value={confirmPassword}
                visible={confirmPasswordVisible}
                onToggleVisible={() => setConfirmPasswordVisible((visible) => !visible)}
              />
              <SecurityQuestionField
                expanded={questionMenuOpen}
                onChange={(value) => {
                  setSecurityQuestion(value);
                  setQuestionMenuOpen(false);
                  setMessage(null);
                }}
                onToggle={() => setQuestionMenuOpen((open) => !open)}
                value={securityQuestion}
              />
              <AccountField
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect={false}
                icon="shield-key-outline"
                inputMode="text"
                label="密保答案"
                onChangeText={setSecurityAnswer}
                placeholder="支持中文，1 至 64 个字符"
                textContentType="none"
                value={securityAnswer}
              />
            </>
          ) : null}

          {mode === 'recovery' && recoveryStep === 'answer' ? (
            <>
              <View style={styles.recoveryQuestionBlock}>
                <MaterialCommunityIcons name="help-circle-outline" size={21} color={colors.primary} />
                <View style={styles.recoveryQuestionCopy}>
                  <ThemedText style={styles.fieldLabel}>密保问题</ThemedText>
                  <ThemedText style={[styles.recoveryQuestionText, { color: colors.text }]}>
                    {recoveryQuestion}
                  </ThemedText>
                </View>
              </View>
              <AccountField
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect={false}
                icon="shield-key-outline"
                inputMode="text"
                label="问题答案"
                onChangeText={setSecurityAnswer}
                onSubmitEditing={() => void handleRecoveryAnswer()}
                placeholder="请输入密保答案"
                textContentType="none"
                value={securityAnswer}
              />
              <View style={[styles.recoveryNotice, { backgroundColor: colors.surfaceMuted }]}>
                <MaterialCommunityIcons name="information-outline" size={18} color={colors.mutedText} />
                <ThemedText style={[styles.recoveryNoticeText, { color: colors.mutedText }]}>
                  连续输错 5 次后，账号将锁定 30 分钟。
                </ThemedText>
              </View>
            </>
          ) : null}

          {mode === 'recovery' && recoveryStep === 'reset' ? (
            <>
              <SecretField
                label="新密码"
                onChangeText={setNewPassword}
                placeholder="至少 8 位，包含字母和数字"
                textContentType="newPassword"
                value={newPassword}
                visible={newPasswordVisible}
                onToggleVisible={() => setNewPasswordVisible((visible) => !visible)}
              />
              <SecretField
                label="确认新密码"
                onChangeText={setNewPasswordConfirm}
                onSubmitEditing={() => void handleRecoveryReset()}
                placeholder="再次输入新密码"
                textContentType="newPassword"
                value={newPasswordConfirm}
                visible={newPasswordConfirmVisible}
                onToggleVisible={() => setNewPasswordConfirmVisible((visible) => !visible)}
              />
            </>
          ) : null}
        </View>

        {message ? <MessageRow message={message} /> : null}

        <Pressable
          accessibilityRole="button"
          disabled={submitting}
          onPress={() => {
            if (mode !== 'recovery') {
              void handleAuthSubmit();
            } else if (recoveryStep === 'account') {
              void handleRecoveryAccount();
            } else if (recoveryStep === 'answer') {
              void handleRecoveryAnswer();
            } else {
              void handleRecoveryReset();
            }
          }}
          style={({ pressed }) => [
            styles.submitButton,
            {
              backgroundColor: colors.hero,
              opacity: submitting || pressed ? 0.7 : 1,
            },
          ]}>
          {submitting ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <MaterialCommunityIcons name={submit.icon} size={20} color="#ffffff" />
          )}
          <ThemedText style={styles.submitText}>
            {submitting ? '正在处理' : submit.label}
          </ThemedText>
        </Pressable>
      </View>
    </MobileScreen>
  );
}

function getHeading(mode: AuthMode, recoveryStep: RecoveryStep, phone: string) {
  if (mode === 'login') {
    return { title: '登录 FunBox', description: '使用手机号继续管理你的个人空间。' };
  }
  if (mode === 'register') {
    return { title: '创建 FunBox 账号', description: '设置手机号、登录密码和密保问题。' };
  }
  if (recoveryStep === 'answer') {
    return {
      title: '回答密保问题',
      description: `账号 ${phone.slice(0, 3)}****${phone.slice(-4)}`,
    };
  }
  if (recoveryStep === 'reset') {
    return { title: '设置新密码', description: '身份已确认，本次操作将在 10 分钟内有效。' };
  }
  return { title: '找回密码', description: '先输入注册时使用的手机号。' };
}

function getSubmitContent(mode: AuthMode, recoveryStep: RecoveryStep) {
  if (mode === 'login') return { icon: 'login' as const, label: '登录' };
  if (mode === 'register') return { icon: 'account-plus-outline' as const, label: '创建账号' };
  if (recoveryStep === 'account') return { icon: 'arrow-right' as const, label: '下一步' };
  if (recoveryStep === 'answer') return { icon: 'shield-check-outline' as const, label: '确认身份' };
  return { icon: 'lock-reset' as const, label: '修改密码' };
}

type AccountFieldProps = ComponentProps<typeof TextInput> & {
  icon: ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
};

function AccountField({ icon, label, ...inputProps }: AccountFieldProps) {
  const { colors } = useAppTheme();

  return (
    <View style={styles.fieldGroup}>
      <ThemedText style={styles.fieldLabel}>{label}</ThemedText>
      <View
        style={[
          styles.inputShell,
          { backgroundColor: colors.surfaceMuted, borderColor: colors.line },
        ]}>
        <MaterialCommunityIcons name={icon} size={19} color={colors.mutedText} />
        <TextInput
          placeholderTextColor={colors.mutedText}
          selectionColor={colors.primary}
          style={[styles.input, { color: colors.text }]}
          {...inputProps}
        />
      </View>
    </View>
  );
}

type SecretFieldProps = Omit<AccountFieldProps, 'icon' | 'secureTextEntry'> & {
  icon?: ComponentProps<typeof MaterialCommunityIcons>['name'];
  onToggleVisible: () => void;
  visible: boolean;
};

function SecretField({
  icon = 'lock-outline',
  label,
  onToggleVisible,
  visible,
  ...inputProps
}: SecretFieldProps) {
  const { colors } = useAppTheme();

  return (
    <View style={styles.fieldGroup}>
      <ThemedText style={styles.fieldLabel}>{label}</ThemedText>
      <View
        style={[
          styles.inputShell,
          { backgroundColor: colors.surfaceMuted, borderColor: colors.line },
        ]}>
        <MaterialCommunityIcons name={icon} size={19} color={colors.mutedText} />
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          placeholderTextColor={colors.mutedText}
          secureTextEntry={!visible}
          selectionColor={colors.primary}
          style={[styles.input, { color: colors.text }]}
          {...inputProps}
        />
        <Pressable
          accessibilityLabel={visible ? `隐藏${label}` : `显示${label}`}
          accessibilityRole="button"
          onPress={onToggleVisible}
          style={styles.passwordToggle}>
          <MaterialCommunityIcons
            name={visible ? 'eye-off-outline' : 'eye-outline'}
            size={19}
            color={colors.mutedText}
          />
        </Pressable>
      </View>
    </View>
  );
}

type SecurityQuestionFieldProps = {
  expanded: boolean;
  onChange: (question: string) => void;
  onToggle: () => void;
  value: string;
};

function SecurityQuestionField({ expanded, onChange, onToggle, value }: SecurityQuestionFieldProps) {
  const { colors } = useAppTheme();

  return (
    <View style={styles.fieldGroup}>
      <ThemedText style={styles.fieldLabel}>密保问题</ThemedText>
      <Pressable
        accessibilityLabel="选择密保问题"
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={onToggle}
        style={[
          styles.inputShell,
          styles.questionField,
          { backgroundColor: colors.surfaceMuted, borderColor: colors.line },
        ]}>
        <MaterialCommunityIcons name="help-circle-outline" size={19} color={colors.mutedText} />
        <ThemedText
          numberOfLines={2}
          style={[styles.questionText, { color: value ? colors.text : colors.mutedText }]}>
          {value || '请选择一个问题'}
        </ThemedText>
        <MaterialCommunityIcons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={20}
          color={colors.mutedText}
        />
      </Pressable>

      {expanded ? (
        <View style={[styles.questionMenu, { borderColor: colors.line }]}>
          {SECURITY_QUESTIONS.map((question, index) => {
            const selected = question === value;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected }}
                key={question}
                onPress={() => onChange(question)}
                style={({ pressed }) => [
                  styles.questionOption,
                  {
                    backgroundColor: pressed || selected ? colors.surfaceMuted : colors.surface,
                    borderBottomColor: colors.line,
                    borderBottomWidth: index === SECURITY_QUESTIONS.length - 1 ? 0 : 1,
                  },
                ]}>
                <ThemedText style={styles.questionOptionText}>{question}</ThemedText>
                {selected ? (
                  <MaterialCommunityIcons name="check-circle" size={18} color={colors.primary} />
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

function RecoveryProgress({ currentStep }: { currentStep: RecoveryStep }) {
  const { colors } = useAppTheme();
  const currentIndex = recoverySteps.findIndex((step) => step.key === currentStep);

  return (
    <View accessibilityLabel="找回密码进度" style={styles.recoveryProgress}>
      {recoverySteps.map((step, index) => {
        const active = index <= currentIndex;
        return (
          <View key={step.key} style={styles.recoveryProgressStep}>
            <View
              style={[
                styles.recoveryStepDot,
                { backgroundColor: active ? colors.hero : colors.surfaceMuted },
              ]}>
              <ThemedText
                style={[
                  styles.recoveryStepNumber,
                  { color: active ? '#ffffff' : colors.mutedText },
                ]}>
                {index + 1}
              </ThemedText>
            </View>
            <ThemedText style={[styles.recoveryStepLabel, { color: colors.mutedText }]}>
              {step.label}
            </ThemedText>
          </View>
        );
      })}
    </View>
  );
}

function MessageRow({ message }: { message: FormMessage }) {
  const { colors } = useAppTheme();
  const success = message.tone === 'success';
  const foreground = success ? colors.success : '#d86f5b';

  return (
    <View style={[styles.messageRow, { backgroundColor: success ? '#1db99118' : '#d86f5b18' }]}>
      <MaterialCommunityIcons
        name={success ? 'check-circle-outline' : 'alert-circle-outline'}
        size={18}
        color={foreground}
      />
      <ThemedText style={[styles.messageText, { color: foreground }]}>{message.text}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  pageContent: {
    gap: 24,
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
  brandMark: {
    alignItems: 'center',
    borderRadius: 16,
    flexDirection: 'row',
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  brandMarkText: {
    fontSize: 12,
    fontWeight: '800',
  },
  headingBlock: {
    gap: 8,
  },
  pageTitle: {
    fontSize: 30,
    fontWeight: '800',
    lineHeight: 38,
  },
  pageDescription: {
    fontSize: 14,
    lineHeight: 21,
  },
  formPanel: {
    borderRadius: 26,
    borderWidth: 1,
    gap: 20,
    padding: 18,
  },
  modeSwitch: {
    borderRadius: 16,
    flexDirection: 'row',
    gap: 4,
    padding: 4,
  },
  modeButton: {
    alignItems: 'center',
    borderRadius: 12,
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  modeButtonText: {
    fontSize: 13,
    fontWeight: '800',
  },
  fields: {
    gap: 16,
  },
  fieldGroup: {
    gap: 8,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '800',
  },
  inputShell: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 52,
    paddingHorizontal: 14,
  },
  input: {
    flex: 1,
    fontSize: 14,
    minWidth: 0,
    paddingVertical: 12,
  },
  passwordToggle: {
    alignItems: 'center',
    height: 36,
    justifyContent: 'center',
    width: 34,
  },
  forgotButton: {
    alignItems: 'center',
    alignSelf: 'flex-end',
    flexDirection: 'row',
    gap: 5,
    minHeight: 30,
  },
  forgotButtonText: {
    fontSize: 13,
    fontWeight: '700',
  },
  questionField: {
    minHeight: 58,
  },
  questionText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  questionMenu: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  questionOption: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    minHeight: 52,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  questionOptionText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
  },
  recoveryProgress: {
    flexDirection: 'row',
  },
  recoveryProgressStep: {
    alignItems: 'center',
    flex: 1,
    gap: 6,
  },
  recoveryStepDot: {
    alignItems: 'center',
    borderRadius: 13,
    height: 26,
    justifyContent: 'center',
    width: 26,
  },
  recoveryStepNumber: {
    fontSize: 12,
    fontWeight: '800',
  },
  recoveryStepLabel: {
    fontSize: 11,
    fontWeight: '700',
  },
  recoveryQuestionBlock: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12,
  },
  recoveryQuestionCopy: {
    flex: 1,
    gap: 7,
  },
  recoveryQuestionText: {
    fontSize: 15,
    lineHeight: 23,
  },
  recoveryNotice: {
    alignItems: 'flex-start',
    borderRadius: 14,
    flexDirection: 'row',
    gap: 8,
    padding: 12,
  },
  recoveryNoticeText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
  messageRow: {
    alignItems: 'flex-start',
    borderRadius: 14,
    flexDirection: 'row',
    gap: 8,
    padding: 12,
  },
  messageText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
  submitButton: {
    alignItems: 'center',
    borderRadius: 18,
    flexDirection: 'row',
    gap: 9,
    justifyContent: 'center',
    minHeight: 54,
    paddingHorizontal: 18,
  },
  submitText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
});
