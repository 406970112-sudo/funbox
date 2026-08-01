import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/features/auth/auth-provider';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  getFeedbackErrorMessage,
  submitFeedback,
} from '@/lib/feedback-api';
import {
  FEEDBACK_IMAGE_TYPES,
  FEEDBACK_MAX_DESCRIPTION,
  FEEDBACK_MAX_IMAGE_BYTES,
  FEEDBACK_MAX_IMAGES,
  validateFeedback,
} from '@/lib/feedback-model';
import { AppLoadingScreen } from '@/shared/ui/app-loading-screen';
import { MobileScreen } from '@/shared/ui/mobile-screen';
import type { FeedbackAsset } from '@/types/feedback';

type FormMessage = {
  text: string;
  tone: 'error' | 'success';
};

export function FeedbackSubmitScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { accessToken, status, user } = useAuth();
  const [assets, setAssets] = useState<FeedbackAsset[]>([]);
  const [description, setDescription] = useState('');
  const [message, setMessage] = useState<FormMessage | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  if (status === 'loading' || !user) {
    return <AppLoadingScreen />;
  }
  if (status === 'anonymous' || !accessToken) {
    return <Redirect href="/auth" />;
  }
  const token = accessToken;

  async function handlePickImages() {
    setMessage(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setMessage({ text: '需要相册权限才能选择图片。', tone: 'error' });
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      allowsMultipleSelection: true,
      mediaTypes: ['images'],
      quality: 0.9,
      selectionLimit: FEEDBACK_MAX_IMAGES - assets.length,
    });
    if (result.canceled || result.assets.length === 0) return;

    const nextAssets = [...assets];
    for (const asset of result.assets) {
      if (nextAssets.length >= FEEDBACK_MAX_IMAGES) {
        setMessage({ text: '最多只能上传 3 张图片。', tone: 'error' });
        break;
      }
      const candidate: FeedbackAsset = {
        fileName: asset.fileName ?? null,
        fileSize: asset.fileSize,
        mimeType: asset.mimeType,
        uri: asset.uri,
      };
      if (candidate.mimeType && !FEEDBACK_IMAGE_TYPES.has(candidate.mimeType)) {
        setMessage({ text: '图片仅支持 JPG、PNG 或 WebP 格式。', tone: 'error' });
        continue;
      }
      if (candidate.fileSize != null && candidate.fileSize > FEEDBACK_MAX_IMAGE_BYTES) {
        setMessage({ text: '单张图片不能超过 5 MB。', tone: 'error' });
        continue;
      }
      nextAssets.push(candidate);
    }
    setAssets(nextAssets);
  }

  async function handleSubmit() {
    setMessage(null);
    const validation = validateFeedback(description, assets);
    if (validation.error || !validation.description) {
      setMessage({ text: '问题描述需要填写 10 到 1000 个字符。', tone: 'error' });
      return;
    }
    setSubmitting(true);
    try {
      await submitFeedback(token, validation.description, assets);
      setSubmitted(true);
      setDescription('');
      setAssets([]);
    } catch (error) {
      setMessage({ text: getFeedbackErrorMessage(error), tone: 'error' });
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <MobileScreen contentContainerStyle={styles.pageContent}>
        <View style={[styles.successPanel, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <View style={[styles.successIcon, { backgroundColor: colors.primarySoft }]}>
            <MaterialCommunityIcons name="check-circle-outline" size={44} color={colors.success} />
          </View>
          <ThemedText style={styles.successTitle}>反馈已提交</ThemedText>
          <ThemedText style={[styles.successBody, { color: colors.mutedText }]}>
            我们已收到你的问题描述和图片。
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.replace('/profile')}
            style={({ pressed }) => [
              styles.successButton,
              { backgroundColor: colors.hero, opacity: pressed ? 0.75 : 1 },
            ]}>
            <MaterialCommunityIcons name="account-outline" size={19} color="#ffffff" />
            <ThemedText style={styles.successButtonText}>返回我的</ThemedText>
          </Pressable>
        </View>
      </MobileScreen>
    );
  }

  return (
    <MobileScreen contentContainerStyle={styles.pageContent}>
      <View style={styles.topBar}>
        <Pressable
          accessibilityLabel="返回我的"
          accessibilityRole="button"
          onPress={() => router.back()}
          style={[styles.iconButton, { backgroundColor: colors.surface }]}>
          <MaterialCommunityIcons name="arrow-left" size={21} color={colors.text} />
        </Pressable>
        <ThemedText style={styles.topBarTitle}>问题反馈</ThemedText>
        <View style={styles.iconButtonSpacer} />
      </View>

      <View style={[styles.formPanel, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <View style={styles.fieldGroup}>
          <View style={styles.fieldHeader}>
            <ThemedText style={styles.fieldLabel}>问题描述</ThemedText>
            <ThemedText style={[styles.fieldCount, { color: colors.mutedText }]}>
              {Array.from(description).length}/{FEEDBACK_MAX_DESCRIPTION}
            </ThemedText>
          </View>
          <TextInput
            maxLength={FEEDBACK_MAX_DESCRIPTION}
            multiline
            onChangeText={setDescription}
            placeholder="描述你遇到的问题"
            placeholderTextColor={colors.mutedText}
            selectionColor={colors.primary}
            style={[
              styles.descriptionInput,
              {
                backgroundColor: colors.surfaceMuted,
                borderColor: colors.line,
                color: colors.text,
              },
            ]}
            textAlignVertical="top"
            value={description}
          />
        </View>

        <View style={styles.fieldGroup}>
          <ThemedText style={styles.fieldLabel}>截图</ThemedText>
          <View style={styles.imageGrid}>
            {assets.map((asset, index) => (
              <View key={`${asset.uri}-${index}`} style={styles.imageTile}>
                <Image contentFit="cover" source={{ uri: asset.uri }} style={styles.imagePreview} />
                <Pressable
                  accessibilityLabel={`移除第 ${index + 1} 张图片`}
                  accessibilityRole="button"
                  onPress={() => setAssets((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                  style={styles.removeImageButton}>
                  <MaterialCommunityIcons name="close" size={15} color="#ffffff" />
                </Pressable>
              </View>
            ))}
            {assets.length < FEEDBACK_MAX_IMAGES ? (
              <Pressable
                accessibilityLabel="选择图片"
                accessibilityRole="button"
                onPress={() => void handlePickImages()}
                style={({ pressed }) => [
                  styles.addImageTile,
                  {
                    backgroundColor: colors.surfaceMuted,
                    borderColor: colors.line,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}>
                <MaterialCommunityIcons name="image-plus" size={26} color={colors.primary} />
              </Pressable>
            ) : null}
          </View>
        </View>

        {message ? (
          <View
            style={[
              styles.messageRow,
              { backgroundColor: message.tone === 'success' ? '#1db99118' : '#d86f5b18' },
            ]}>
            <MaterialCommunityIcons
              name={message.tone === 'success' ? 'check-circle-outline' : 'alert-circle-outline'}
              size={18}
              color={message.tone === 'success' ? colors.success : '#d86f5b'}
            />
            <ThemedText
              style={[
                styles.messageText,
                { color: message.tone === 'success' ? colors.success : '#d86f5b' },
              ]}>
              {message.text}
            </ThemedText>
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          disabled={submitting}
          onPress={() => void handleSubmit()}
          style={({ pressed }) => [
            styles.submitButton,
            { backgroundColor: colors.hero, opacity: submitting || pressed ? 0.72 : 1 },
          ]}>
          {submitting ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <MaterialCommunityIcons name="send-outline" size={19} color="#ffffff" />
          )}
          <ThemedText style={styles.submitText}>
            {submitting ? '正在提交' : '提交反馈'}
          </ThemedText>
        </Pressable>
      </View>
    </MobileScreen>
  );
}

const styles = StyleSheet.create({
  pageContent: {
    gap: 20,
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
  formPanel: {
    borderRadius: 20,
    borderWidth: 1,
    gap: 20,
    padding: 16,
  },
  fieldGroup: {
    gap: 10,
  },
  fieldHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '800',
  },
  fieldCount: {
    fontSize: 12,
  },
  descriptionInput: {
    borderRadius: 16,
    borderWidth: 1,
    fontSize: 15,
    lineHeight: 22,
    minHeight: 148,
    padding: 14,
  },
  imageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  imageTile: {
    borderRadius: 14,
    height: 96,
    overflow: 'hidden',
    position: 'relative',
    width: 96,
  },
  imagePreview: {
    height: '100%',
    width: '100%',
  },
  removeImageButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(15,19,23,0.72)',
    borderRadius: 12,
    height: 24,
    justifyContent: 'center',
    position: 'absolute',
    right: 6,
    top: 6,
    width: 24,
  },
  addImageTile: {
    alignItems: 'center',
    borderRadius: 14,
    borderStyle: 'dashed',
    borderWidth: 1,
    height: 96,
    justifyContent: 'center',
    width: 96,
  },
  messageRow: {
    alignItems: 'center',
    borderRadius: 14,
    flexDirection: 'row',
    gap: 9,
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  messageText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
  },
  submitButton: {
    alignItems: 'center',
    borderRadius: 16,
    flexDirection: 'row',
    gap: 9,
    justifyContent: 'center',
    minHeight: 52,
  },
  submitText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  successPanel: {
    alignItems: 'center',
    borderRadius: 24,
    borderWidth: 1,
    gap: 12,
    marginTop: 64,
    padding: 28,
  },
  successIcon: {
    alignItems: 'center',
    borderRadius: 30,
    height: 76,
    justifyContent: 'center',
    width: 76,
  },
  successTitle: {
    fontSize: 20,
    fontWeight: '800',
    marginTop: 6,
  },
  successBody: {
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  successButton: {
    alignItems: 'center',
    borderRadius: 16,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    marginTop: 8,
    minHeight: 48,
    paddingHorizontal: 18,
  },
  successButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
});
