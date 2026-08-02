import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/features/auth/auth-provider';
import {
  createMoment,
  getMomentErrorMessage,
  listMomentAttachmentOptions,
} from '@/lib/moments-api';
import { useAppTheme } from '@/hooks/use-app-theme';
import { MobileScreen } from '@/shared/ui/mobile-screen';
import type {
  MomentAttachmentInput,
  MomentAttachmentOption,
  MomentImageAsset,
} from '@/types/moments';

export function MomentCreateScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { accessToken } = useAuth();
  const [body, setBody] = useState('');
  const [images, setImages] = useState<MomentImageAsset[]>([]);
  const [visibility, setVisibility] = useState<'friends' | 'self'>('friends');
  const [attachment, setAttachment] = useState<MomentAttachmentInput | null>(null);
  const [attachmentOptions, setAttachmentOptions] = useState<MomentAttachmentOption[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState('');

  useFocusEffect(
    useCallback(() => {
      if (!accessToken) return;
      void listMomentAttachmentOptions(accessToken).then(setAttachmentOptions).catch(() => {
        setAttachmentOptions([]);
      });
    }, [accessToken]),
  );

  async function pickImages() {
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsMultipleSelection: true,
      mediaTypes: ['images'],
      quality: 0.9,
      selectionLimit: 9 - images.length,
    });
    if (result.canceled) return;
    const picked = result.assets.map((asset) => ({
      fileName: asset.fileName || `moment-${Date.now()}.jpg`,
      mimeType: asset.mimeType || 'image/jpeg',
      uri: asset.uri,
    }));
    setImages((current) => [...current, ...picked].slice(0, 9));
  }

  async function publish() {
    if (!accessToken) return;
    if (!body.trim()) {
      setError('动态内容需要 1-500 个字符。');
      return;
    }
    setPublishing(true);
    setError('');
    try {
      await createMoment(accessToken, {
        attachment,
        body: body.trim(),
        images,
        visibility,
      });
      router.back();
    } catch (caught) {
      setError(getMomentErrorMessage(caught));
    } finally {
      setPublishing(false);
    }
  }

  return (
    <MobileScreen contentContainerStyle={styles.page}>
      <View style={styles.topBar}>
        <Pressable
          accessibilityLabel="返回"
          accessibilityRole="button"
          onPress={() => router.back()}
          style={[styles.iconButton, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <MaterialCommunityIcons name="close" size={20} color={colors.text} />
        </Pressable>
        <ThemedText style={styles.pageTitle}>发布动态</ThemedText>
        <Pressable
          accessibilityLabel="发布动态"
          accessibilityRole="button"
          disabled={publishing}
          onPress={() => void publish()}
          style={[styles.publishButton, publishing && styles.pressed]}>
          {publishing ? (
            <ActivityIndicator color="#ffffff" size="small" />
          ) : (
            <MaterialCommunityIcons name="send" size={17} color="#ffffff" />
          )}
          <ThemedText style={styles.publishButtonText}>发布</ThemedText>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <View style={[styles.editor, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <TextInput
            multiline
            maxLength={500}
            onChangeText={setBody}
            placeholder="分享此刻..."
            placeholderTextColor={colors.mutedText}
            style={[styles.editorInput, { color: colors.text }]}
            value={body}
          />
          <View style={[styles.editorFooter, { borderTopColor: colors.line }]}>
            <ThemedText style={[styles.charCount, { color: colors.mutedText }]}>
              {body.length}/500
            </ThemedText>
            <Pressable
              accessibilityLabel="选择图片"
              accessibilityRole="button"
              onPress={() => void pickImages()}
              style={styles.addImageButton}>
              <MaterialCommunityIcons name="image-plus" size={19} color={colors.primary} />
            </Pressable>
          </View>
        </View>

        {images.length > 0 ? (
          <View style={styles.imageGrid}>
            {images.map((asset, index) => (
              <View key={`${asset.uri}-${index}`} style={styles.imageCell}>
                <Image contentFit="cover" source={{ uri: asset.uri }} style={styles.imagePreview} />
                <Pressable
                  accessibilityLabel="移除图片"
                  accessibilityRole="button"
                  onPress={() => setImages((items) => items.filter((_, itemIndex) => itemIndex !== index))}
                  style={styles.removeImage}>
                  <MaterialCommunityIcons name="close" size={13} color="#ffffff" />
                </Pressable>
              </View>
            ))}
            {images.length < 9 ? (
              <Pressable
                accessibilityLabel="继续添加图片"
                accessibilityRole="button"
                onPress={() => void pickImages()}
                style={[styles.imageCell, styles.addCell, { borderColor: colors.line }]}>
                <MaterialCommunityIcons name="plus" size={22} color={colors.primary} />
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <View style={[styles.settingCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <View style={styles.settingTitleRow}>
            <MaterialCommunityIcons name="eye-outline" size={17} color={colors.primary} />
            <ThemedText style={styles.settingTitle}>谁可以看</ThemedText>
          </View>
          <View style={[styles.segmented, { backgroundColor: colors.surfaceMuted }]}>
            <VisibilityButton
              active={visibility === 'friends'}
              label="仅好友可见"
              onPress={() => setVisibility('friends')}
            />
            <VisibilityButton
              active={visibility === 'self'}
              label="仅自己可见"
              onPress={() => setVisibility('self')}
            />
          </View>
        </View>

        {attachmentOptions.length > 0 ? (
          <View style={styles.attachmentSection}>
            <View style={styles.settingTitleRow}>
              <MaterialCommunityIcons name="trophy-outline" size={17} color="#24b36b" />
              <ThemedText style={styles.settingTitle}>附加真实战绩</ThemedText>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.attachmentRow}>
                {attachmentOptions.slice(0, 10).map((option) => (
                  <Pressable
                    accessibilityRole="button"
                    key={option.refId}
                    onPress={() =>
                      setAttachment(
                        attachment?.refId === option.refId
                          ? null
                          : { refId: option.refId, source: option.source, type: 'game_result' },
                      )
                    }
                    style={[
                      styles.attachmentOption,
                      {
                        backgroundColor: colors.surface,
                        borderColor: attachment?.refId === option.refId ? colors.primary : colors.line,
                      },
                    ]}>
                    <MaterialCommunityIcons
                      name={attachment?.refId === option.refId ? 'check-circle' : 'trophy-outline'}
                      size={16}
                      color={attachment?.refId === option.refId ? colors.primary : '#24b36b'}
                    />
                    <View style={styles.attachmentOptionCopy}>
                      <ThemedText numberOfLines={1} style={styles.attachmentOptionTitle}>
                        {option.title}
                      </ThemedText>
                      <ThemedText style={[styles.attachmentOptionResult, { color: colors.mutedText }]}>
                        {option.result}
                      </ThemedText>
                    </View>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          </View>
        ) : null}

        {error ? <ThemedText style={styles.errorText}>{error}</ThemedText> : null}
      </ScrollView>
    </MobileScreen>
  );
}

function VisibilityButton({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.visibilityButton, active && { backgroundColor: colors.surface }]}>
      <ThemedText style={[styles.visibilityText, active && { color: colors.text, fontWeight: '800' }]}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  addCell: {
    alignItems: 'center',
    borderStyle: 'dashed',
    borderWidth: 1,
    justifyContent: 'center',
  },
  addImageButton: {
    alignItems: 'center',
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  attachmentOption: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    minWidth: 190,
    padding: 11,
  },
  attachmentOptionCopy: {
    flex: 1,
    minWidth: 0,
  },
  attachmentOptionResult: {
    fontSize: 10,
    marginTop: 2,
  },
  attachmentOptionTitle: {
    fontSize: 12,
    fontWeight: '800',
  },
  attachmentRow: {
    flexDirection: 'row',
    gap: 9,
    paddingRight: 14,
  },
  attachmentSection: {
    gap: 10,
    marginTop: 16,
  },
  charCount: {
    fontSize: 10.5,
  },
  editor: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
  },
  editorFooter: {
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 8,
  },
  editorInput: {
    fontSize: 14,
    lineHeight: 22,
    minHeight: 110,
    textAlignVertical: 'top',
  },
  errorText: {
    color: '#d86f5b',
    fontSize: 12,
    marginTop: 12,
    textAlign: 'center',
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  imageCell: {
    aspectRatio: 1,
    borderRadius: 10,
    flexBasis: '30%',
    flexGrow: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  imageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: 14,
  },
  imagePreview: {
    height: '100%',
    width: '100%',
  },
  page: {
    paddingTop: 14,
  },
  pageTitle: {
    fontSize: 17,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.7,
  },
  publishButton: {
    alignItems: 'center',
    backgroundColor: '#4b6bff',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 6,
    minHeight: 38,
    paddingHorizontal: 13,
  },
  publishButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  removeImage: {
    alignItems: 'center',
    backgroundColor: 'rgba(10,14,30,0.66)',
    borderRadius: 10,
    height: 20,
    justifyContent: 'center',
    position: 'absolute',
    right: 4,
    top: 4,
    width: 20,
  },
  scrollContent: {
    paddingBottom: 40,
    paddingTop: 16,
  },
  segmented: {
    borderRadius: 10,
    flexDirection: 'row',
    gap: 4,
    marginTop: 10,
    padding: 4,
  },
  settingCard: {
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 16,
    padding: 14,
  },
  settingTitle: {
    fontSize: 13,
    fontWeight: '800',
  },
  settingTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  visibilityButton: {
    alignItems: 'center',
    borderRadius: 8,
    flex: 1,
    height: 32,
    justifyContent: 'center',
  },
  visibilityText: {
    color: '#7483a2',
    fontSize: 12,
    fontWeight: '700',
  },
});
