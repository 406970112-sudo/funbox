import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/features/auth/auth-provider';
import { useAppTheme } from '@/hooks/use-app-theme';
import { getAuthErrorMessage } from '@/lib/auth-api';
import { MobileScreen } from '@/shared/ui/mobile-screen';

export function ProfileSecurityScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { changePassword, status } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState(false);

  if (status === 'anonymous') {
    return <Redirect href="/auth" />;
  }

  async function handleSubmit() {
    setMessage('');
    setSuccess(false);
    if (newPassword !== confirmPassword) {
      setMessage('两次输入的新密码不一致。');
      return;
    }

    setSubmitting(true);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSuccess(true);
      setMessage('密码已更新，旧登录令牌已失效。');
    } catch (error) {
      setMessage(getAuthErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <MobileScreen contentContainerStyle={styles.pageContent}>
      <View style={styles.topBar}>
        <Pressable
          accessibilityLabel="返回个人中心"
          accessibilityRole="button"
          onPress={() => router.back()}
          style={[styles.iconButton, { backgroundColor: colors.surface }]}>
          <MaterialCommunityIcons name="arrow-left" size={21} color={colors.text} />
        </Pressable>
        <ThemedText style={styles.topBarTitle}>账户安全</ThemedText>
        <View style={styles.iconButtonSpacer} />
      </View>

      <View style={styles.headingBlock}>
        <ThemedText style={styles.pageTitle}>修改密码</ThemedText>
        <ThemedText style={[styles.pageDescription, { color: colors.mutedText }]}>
          更新后，之前签发的登录令牌会立即失效。
        </ThemedText>
      </View>

      <View style={[styles.formPanel, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <PasswordField label="当前密码" onChangeText={setCurrentPassword} value={currentPassword} />
        <PasswordField label="新密码" onChangeText={setNewPassword} value={newPassword} />
        <PasswordField
          label="确认新密码"
          onChangeText={setConfirmPassword}
          onSubmitEditing={() => void handleSubmit()}
          value={confirmPassword}
        />

        {message ? (
          <View
            style={[
              styles.messageRow,
              { backgroundColor: success ? '#1db99118' : '#d86f5b18' },
            ]}>
            <MaterialCommunityIcons
              name={success ? 'check-circle-outline' : 'alert-circle-outline'}
              size={18}
              color={success ? colors.success : '#d86f5b'}
            />
            <ThemedText
              style={[styles.messageText, { color: success ? colors.success : '#d86f5b' }]}>
              {message}
            </ThemedText>
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          disabled={submitting}
          onPress={() => void handleSubmit()}
          style={({ pressed }) => [
            styles.submitButton,
            { backgroundColor: colors.hero, opacity: submitting || pressed ? 0.7 : 1 },
          ]}>
          {submitting ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <MaterialCommunityIcons name="shield-key-outline" size={20} color="#ffffff" />
          )}
          <ThemedText style={styles.submitText}>{submitting ? '正在更新' : '更新密码'}</ThemedText>
        </Pressable>
      </View>
    </MobileScreen>
  );
}

type PasswordFieldProps = React.ComponentProps<typeof TextInput> & {
  label: string;
};

function PasswordField({ label, ...inputProps }: PasswordFieldProps) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.fieldGroup}>
      <ThemedText style={styles.fieldLabel}>{label}</ThemedText>
      <View
        style={[
          styles.inputShell,
          { backgroundColor: colors.surfaceMuted, borderColor: colors.line },
        ]}>
        <MaterialCommunityIcons name="lock-outline" size={19} color={colors.mutedText} />
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="至少 8 个字符"
          placeholderTextColor={colors.mutedText}
          returnKeyType="done"
          secureTextEntry
          selectionColor={colors.primary}
          style={[styles.input, { color: colors.text }]}
          textContentType="newPassword"
          {...inputProps}
        />
      </View>
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
  topBarTitle: {
    fontSize: 18,
    fontWeight: '800',
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
  headingBlock: {
    gap: 8,
  },
  pageTitle: {
    fontSize: 28,
    fontWeight: '800',
    lineHeight: 36,
  },
  pageDescription: {
    fontSize: 14,
    lineHeight: 21,
  },
  formPanel: {
    borderRadius: 26,
    borderWidth: 1,
    gap: 18,
    padding: 18,
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
