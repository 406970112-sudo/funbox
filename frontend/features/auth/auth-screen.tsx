import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/features/auth/auth-provider';
import { useAppTheme } from '@/hooks/use-app-theme';
import { getAuthErrorMessage } from '@/lib/auth-api';
import { MobileScreen } from '@/shared/ui/mobile-screen';

type AuthMode = 'login' | 'register';

export function AuthScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { register, signIn, status } = useAuth();
  const [mode, setMode] = useState<AuthMode>('login');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  if (status === 'authenticated') {
    return <Redirect href="/profile" />;
  }

  async function handleSubmit() {
    setErrorMessage('');
    setSubmitting(true);
    try {
      if (mode === 'register') {
        await register(username, password, displayName);
      } else {
        await signIn(username, password);
      }
      router.replace('/profile');
    } catch (error) {
      setErrorMessage(getAuthErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  function switchMode(nextMode: AuthMode) {
    setMode(nextMode);
    setErrorMessage('');
  }

  return (
    <MobileScreen contentContainerStyle={styles.pageContent}>
      <View style={styles.topBar}>
        <Pressable
          accessibilityLabel="返回"
          accessibilityRole="button"
          onPress={() => router.back()}
          style={[styles.iconButton, { backgroundColor: colors.surface }]}>
          <MaterialCommunityIcons name="arrow-left" size={21} color={colors.text} />
        </Pressable>
        <View style={[styles.brandMark, { backgroundColor: colors.surface }]}>
          <MaterialCommunityIcons name="cube-outline" size={18} color={colors.primary} />
          <ThemedText style={[styles.brandMarkText, { color: colors.primary }]}>FunBox</ThemedText>
        </View>
      </View>

      <View style={styles.headingBlock}>
        <ThemedText style={styles.pageTitle}>
          {mode === 'login' ? '登录 FunBox' : '创建 FunBox 账号'}
        </ThemedText>
        <ThemedText style={[styles.pageDescription, { color: colors.mutedText }]}>
          {mode === 'login' ? '继续管理你的昵称、头像与个人空间。' : '一个账号即可保存个人资料。'}
        </ThemedText>
      </View>

      <View style={[styles.formPanel, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <View style={[styles.modeSwitch, { backgroundColor: colors.surfaceMuted }]}>
          {(['login', 'register'] as const).map((item) => {
            const selected = item === mode;
            return (
              <Pressable
                accessibilityRole="button"
                key={item}
                onPress={() => switchMode(item)}
                style={[
                  styles.modeButton,
                  { backgroundColor: selected ? colors.hero : 'transparent' },
                ]}>
                <ThemedText
                  style={[styles.modeButtonText, { color: selected ? '#ffffff' : colors.mutedText }]}>
                  {item === 'login' ? '登录' : '注册'}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.fields}>
          {mode === 'register' ? (
            <AccountField
              autoCapitalize="none"
              icon="account-outline"
              label="昵称"
              onChangeText={setDisplayName}
              placeholder="例如：Brynn"
              value={displayName}
            />
          ) : null}
          <AccountField
            autoCapitalize="none"
            autoCorrect={false}
            icon="at"
            label="账号"
            onChangeText={setUsername}
            placeholder="3–32 位英文、数字或 . _ -"
            textContentType="username"
            value={username}
          />
          <View style={styles.fieldGroup}>
            <ThemedText style={styles.fieldLabel}>密码</ThemedText>
            <View
              style={[
                styles.inputShell,
                { backgroundColor: colors.surfaceMuted, borderColor: colors.line },
              ]}>
              <MaterialCommunityIcons name="lock-outline" size={19} color={colors.mutedText} />
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setPassword}
                onSubmitEditing={() => void handleSubmit()}
                placeholder="至少 8 个字符"
                placeholderTextColor={colors.mutedText}
                returnKeyType="done"
                secureTextEntry={!passwordVisible}
                selectionColor={colors.primary}
                style={[styles.input, { color: colors.text }]}
                textContentType={mode === 'login' ? 'password' : 'newPassword'}
                value={password}
              />
              <Pressable
                accessibilityLabel={passwordVisible ? '隐藏密码' : '显示密码'}
                accessibilityRole="button"
                onPress={() => setPasswordVisible((visible) => !visible)}
                style={styles.passwordToggle}>
                <MaterialCommunityIcons
                  name={passwordVisible ? 'eye-off-outline' : 'eye-outline'}
                  size={19}
                  color={colors.mutedText}
                />
              </Pressable>
            </View>
          </View>
        </View>

        {errorMessage ? (
          <View style={[styles.messageRow, { backgroundColor: '#d86f5b18' }]}>
            <MaterialCommunityIcons name="alert-circle-outline" size={18} color="#d86f5b" />
            <ThemedText style={styles.errorText}>{errorMessage}</ThemedText>
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          disabled={submitting}
          onPress={() => void handleSubmit()}
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
            <MaterialCommunityIcons
              name={mode === 'login' ? 'login' : 'account-plus-outline'}
              size={20}
              color="#ffffff"
            />
          )}
          <ThemedText style={styles.submitText}>
            {submitting ? '正在处理' : mode === 'login' ? '登录' : '创建账号'}
          </ThemedText>
        </Pressable>
      </View>
    </MobileScreen>
  );
}

type AccountFieldProps = React.ComponentProps<typeof TextInput> & {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
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
  messageRow: {
    alignItems: 'flex-start',
    borderRadius: 14,
    flexDirection: 'row',
    gap: 8,
    padding: 12,
  },
  errorText: {
    color: '#d86f5b',
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
