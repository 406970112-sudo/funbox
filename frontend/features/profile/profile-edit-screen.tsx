import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Redirect, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/features/auth/auth-provider';
import { useAppTheme } from '@/hooks/use-app-theme';
import { getAuthErrorMessage } from '@/lib/auth-api';
import { MobileScreen } from '@/shared/ui/mobile-screen';

export function ProfileEditScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { status, updateBirthday, updateDisplayName, uploadAvatar, user } = useAuth();
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [birthday, setBirthday] = useState(user?.birthday ?? '');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [messageKind, setMessageKind] = useState<'error' | 'success'>('success');

  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName);
      setBirthday(user.birthday);
    }
  }, [user]);

  if (status === 'anonymous') {
    return <Redirect href="/auth" />;
  }

  if (status === 'loading' || !user) {
    return <AccountLoadingScreen />;
  }

  async function handleAvatarPick() {
    setMessage('');
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setMessageKind('error');
      setMessage('需要相册权限才能选择头像。');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      aspect: [1, 1],
      mediaTypes: ['images'],
      quality: 0.85,
    });
    const asset = result.assets?.[0];
    if (result.canceled || !asset) return;

    setUploading(true);
    try {
      await uploadAvatar({ fileName: asset.fileName, mimeType: asset.mimeType, uri: asset.uri });
      setMessageKind('success');
      setMessage('头像已更新。');
    } catch (error) {
      setMessageKind('error');
      setMessage(getAuthErrorMessage(error));
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    setMessage('');
    setSaving(true);
    try {
      if (displayName !== user?.displayName) await updateDisplayName(displayName);
      if (birthday !== user?.birthday) await updateBirthday(birthday);
      setMessageKind('success');
      setMessage('资料已保存。');
    } catch (error) {
      setMessageKind('error');
      setMessage(getAuthErrorMessage(error));
    } finally {
      setSaving(false);
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
        <ThemedText style={styles.topBarTitle}>编辑资料</ThemedText>
        <View style={styles.iconButtonSpacer} />
      </View>

      <View style={styles.avatarSection}>
        <View style={[styles.avatarFrame, { backgroundColor: colors.hero, borderColor: colors.line }]}>
          {user.avatarUrl ? (
            <Image contentFit="cover" source={{ uri: user.avatarUrl }} style={styles.avatarImage} />
          ) : (
            <MaterialCommunityIcons name="account" size={44} color="#ffffff" />
          )}
        </View>
        <Pressable
          accessibilityRole="button"
          disabled={uploading}
          onPress={() => void handleAvatarPick()}
          style={({ pressed }) => [
            styles.avatarButton,
            {
              backgroundColor: colors.surface,
              borderColor: colors.line,
              opacity: uploading || pressed ? 0.7 : 1,
            },
          ]}>
          {uploading ? (
            <ActivityIndicator color={colors.primary} size="small" />
          ) : (
            <MaterialCommunityIcons name="image-edit-outline" size={19} color={colors.primary} />
          )}
          <ThemedText style={[styles.avatarButtonText, { color: colors.primary }]}>
            {uploading ? '正在上传' : '更换头像'}
          </ThemedText>
        </Pressable>
      </View>

      <View style={[styles.formPanel, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <View style={styles.fieldGroup}>
          <ThemedText style={styles.fieldLabel}>账号</ThemedText>
          <View style={[styles.readonlyField, { backgroundColor: colors.surfaceMuted }]}>
            <MaterialCommunityIcons name="at" size={19} color={colors.mutedText} />
            <ThemedText style={[styles.readonlyText, { color: colors.mutedText }]}>
              {user.username}
            </ThemedText>
          </View>
        </View>

        <View style={styles.fieldGroup}>
          <ThemedText style={styles.fieldLabel}>昵称</ThemedText>
          <View
            style={[
              styles.inputShell,
              { backgroundColor: colors.surfaceMuted, borderColor: colors.line },
            ]}>
            <MaterialCommunityIcons name="account-outline" size={19} color={colors.mutedText} />
            <TextInput
              autoCapitalize="none"
              maxLength={32}
              onChangeText={setDisplayName}
              onSubmitEditing={() => void handleSave()}
              placeholder="输入昵称"
              placeholderTextColor={colors.mutedText}
              returnKeyType="done"
              selectionColor={colors.primary}
              style={[styles.input, { color: colors.text }]}
              value={displayName}
            />
          </View>
        </View>

        <View style={styles.fieldGroup}>
          <ThemedText style={styles.fieldLabel}>生日</ThemedText>
          <View
            style={[
              styles.inputShell,
              { backgroundColor: colors.surfaceMuted, borderColor: colors.line },
            ]}>
            <MaterialCommunityIcons name="cake-variant-outline" size={19} color={colors.mutedText} />
            <TextInput
              autoCapitalize="none"
              maxLength={10}
              onChangeText={setBirthday}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.mutedText}
              selectionColor={colors.primary}
              style={[styles.input, { color: colors.text }]}
              value={birthday}
            />
          </View>
          <ThemedText style={[styles.fieldHint, { color: colors.mutedText }]}>
            用于时间胶囊的"明年生日"开启条件。
          </ThemedText>
        </View>

        {message ? (
          <View
            style={[
              styles.messageRow,
              { backgroundColor: messageKind === 'success' ? '#1db99118' : '#d86f5b18' },
            ]}>
            <MaterialCommunityIcons
              name={messageKind === 'success' ? 'check-circle-outline' : 'alert-circle-outline'}
              size={18}
              color={messageKind === 'success' ? colors.success : '#d86f5b'}
            />
            <ThemedText
              style={[
                styles.messageText,
                { color: messageKind === 'success' ? colors.success : '#d86f5b' },
              ]}>
              {message}
            </ThemedText>
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          disabled={saving}
          onPress={() => void handleSave()}
          style={({ pressed }) => [
            styles.submitButton,
            { backgroundColor: colors.hero, opacity: saving || pressed ? 0.7 : 1 },
          ]}>
          {saving ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <MaterialCommunityIcons name="content-save-outline" size={20} color="#ffffff" />
          )}
          <ThemedText style={styles.submitText}>{saving ? '正在保存' : '保存资料'}</ThemedText>
        </Pressable>
      </View>
    </MobileScreen>
  );
}

function AccountLoadingScreen() {
  const { colors } = useAppTheme();
  return (
    <MobileScreen contentContainerStyle={styles.loadingScreen}>
      <ActivityIndicator color={colors.primary} />
      <ThemedText style={[styles.loadingText, { color: colors.mutedText }]}>正在读取账户</ThemedText>
    </MobileScreen>
  );
}

const styles = StyleSheet.create({
  pageContent: {
    gap: 24,
    paddingTop: 14,
  },
  loadingScreen: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 420,
  },
  loadingText: {
    fontSize: 13,
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
  avatarSection: {
    alignItems: 'center',
    gap: 14,
  },
  avatarFrame: {
    alignItems: 'center',
    borderRadius: 30,
    borderWidth: 3,
    height: 104,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 104,
  },
  avatarImage: {
    height: '100%',
    width: '100%',
  },
  avatarButton: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 42,
    paddingHorizontal: 14,
  },
  avatarButtonText: {
    fontSize: 13,
    fontWeight: '800',
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
  fieldHint: {
    fontSize: 11,
    lineHeight: 17,
  },
  readonlyField: {
    alignItems: 'center',
    borderRadius: 16,
    flexDirection: 'row',
    gap: 10,
    minHeight: 52,
    paddingHorizontal: 14,
  },
  readonlyText: {
    fontSize: 14,
    fontWeight: '700',
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
    alignItems: 'center',
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
