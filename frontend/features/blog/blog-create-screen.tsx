import AsyncStorage from '@react-native-async-storage/async-storage';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
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
  createBlogPost,
  getBlogErrorMessage,
  getBlogPost,
  updateBlogPost,
} from '@/lib/blog-api';
import { useAppTheme } from '@/hooks/use-app-theme';
import { MobileScreen } from '@/shared/ui/mobile-screen';
import type { BlogCoverAsset, BlogVisibility } from '@/types/blog';

import { BlogVisibilitySegmented } from './blog-ui';

const DRAFT_KEY = 'funbox.blog.draft.v1';

type Draft = {
  body: string;
  cover?: BlogCoverAsset | null;
  summary: string;
  title: string;
  visibility: BlogVisibility;
};

export function BlogCreateScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { accessToken } = useAuth();
  const params = useLocalSearchParams<{ postId?: string }>();
  const postId = params.postId;
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [body, setBody] = useState('');
  const [cover, setCover] = useState<BlogCoverAsset | null>(null);
  const [visibility, setVisibility] = useState<BlogVisibility>('public');
  const [loadingPost, setLoadingPost] = useState(Boolean(postId));
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState('');
  const [savedDraft, setSavedDraft] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (postId) {
        if (!accessToken) return;
        setLoadingPost(true);
        void getBlogPost(accessToken, postId)
          .then((post) => {
            setTitle(post.title);
            setSummary(post.summary);
            setBody(post.body);
            setVisibility(post.visibility);
            setCover(post.coverUrl ? { uri: post.coverUrl } : null);
            setError('');
          })
          .catch((caught) => setError(getBlogErrorMessage(caught)))
          .finally(() => setLoadingPost(false));
        return;
      }
      void AsyncStorage.getItem(DRAFT_KEY)
        .then((raw) => {
          if (!raw) return;
          const draft = JSON.parse(raw) as Draft;
          setTitle(draft.title ?? '');
          setSummary(draft.summary ?? '');
          setBody(draft.body ?? '');
          setVisibility(draft.visibility ?? 'public');
          if (draft.cover) setCover(draft.cover);
        })
        .catch(() => {});
    }, [accessToken, postId]),
  );

  useEffect(() => {
    if (postId || publishing) return;
    const timer = setTimeout(() => {
      const draft: Draft = { body, cover, summary, title, visibility };
      void AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
        .then(() => setSavedDraft(true))
        .catch(() => {});
    }, 600);
    return () => clearTimeout(timer);
  }, [body, cover, postId, publishing, summary, title, visibility]);

  async function pickCover() {
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsMultipleSelection: false,
      mediaTypes: ['images'],
      quality: 0.85,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    setCover({
      fileName: asset.fileName || `blog-cover-${Date.now()}.jpg`,
      mimeType: asset.mimeType || 'image/jpeg',
      uri: asset.uri,
    });
  }

  async function publish() {
    if (!accessToken) return;
    if (!title.trim()) {
      setError('标题需要 1-80 个字符。');
      return;
    }
    if (!body.trim()) {
      setError('正文需要 1-10000 个字符。');
      return;
    }
    setPublishing(true);
    setError('');
    try {
      if (postId) {
        await updateBlogPost(accessToken, postId, {
          body: body.trim(),
          summary: summary.trim(),
          title: title.trim(),
          visibility,
        });
      } else {
        await createBlogPost(accessToken, {
          body: body.trim(),
          cover,
          summary: summary.trim(),
          title: title.trim(),
          visibility,
        });
        await AsyncStorage.removeItem(DRAFT_KEY).catch(() => {});
      }
      router.back();
    } catch (caught) {
      setError(getBlogErrorMessage(caught));
    } finally {
      setPublishing(false);
    }
  }

  if (loadingPost) {
    return (
      <MobileScreen contentContainerStyle={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </MobileScreen>
    );
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
        <ThemedText style={styles.pageTitle}>{postId ? '编辑文章' : '写文章'}</ThemedText>
        <Pressable
          accessibilityLabel={postId ? '保存修改' : '发布'}
          accessibilityRole="button"
          disabled={publishing}
          onPress={() => void publish()}
          style={[styles.publishButton, publishing && styles.pressed]}>
          {publishing ? (
            <ActivityIndicator color="#ffffff" size="small" />
          ) : (
            <MaterialCommunityIcons name="send" size={16} color="#ffffff" />
          )}
          <ThemedText style={styles.publishButtonText}>{postId ? '保存' : '发布'}</ThemedText>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <View style={[styles.editor, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <TextInput
            maxLength={80}
            onChangeText={setTitle}
            placeholder="标题（1-80 字）"
            placeholderTextColor={colors.mutedText}
            style={[styles.titleInput, { color: colors.text }]}
            value={title}
          />
          <View style={[styles.editorDivider, { backgroundColor: colors.line }]} />
          <TextInput
            maxLength={300}
            onChangeText={setSummary}
            placeholder="摘要（0-300 字，可选）"
            placeholderTextColor={colors.mutedText}
            style={[styles.summaryInput, { color: colors.text }]}
            value={summary}
          />
          <View style={[styles.editorDivider, { backgroundColor: colors.line }]} />
          <TextInput
            maxLength={10000}
            multiline
            onChangeText={setBody}
            placeholder="正文（1-10000 字，纯文本，保留换行）"
            placeholderTextColor={colors.mutedText}
            style={[styles.bodyInput, { color: colors.text }]}
            textAlignVertical="top"
            value={body}
          />
          <View style={[styles.editorFooter, { borderTopColor: colors.line }]}>
            <View style={styles.draftRow}>
              <MaterialCommunityIcons
                name={savedDraft ? 'cloud-check-outline' : 'cloud-outline'}
                size={15}
                color={colors.mutedText}
              />
              <ThemedText style={[styles.draftText, { color: colors.mutedText }]}>
                {postId ? '修改仅在发布后生效' : savedDraft ? '草稿已自动保存' : '自动保存草稿'}
              </ThemedText>
            </View>
            <ThemedText style={[styles.charCount, { color: colors.mutedText }]}>
              {body.length}/10000
            </ThemedText>
          </View>
        </View>

        <ThemedText style={[styles.sectionLabel, { color: colors.mutedText }]}>封面</ThemedText>
        <View style={styles.coverRow}>
          {cover ? (
            <View style={styles.coverCell}>
              <Image contentFit="cover" source={{ uri: cover.uri }} style={styles.coverPreview} />
              <Pressable
                accessibilityLabel="移除封面"
                accessibilityRole="button"
                onPress={() => setCover(null)}
                style={styles.removeCover}>
                <MaterialCommunityIcons name="close" size={13} color="#ffffff" />
              </Pressable>
            </View>
          ) : null}
          <Pressable
            accessibilityLabel="选择封面"
            accessibilityRole="button"
            onPress={() => void pickCover()}
            style={[styles.addCover, { borderColor: colors.line, backgroundColor: colors.surface }]}>
            <MaterialCommunityIcons name="image-plus" size={22} color={colors.primary} />
            <ThemedText style={[styles.addCoverText, { color: colors.mutedText }]}>
              添加封面
            </ThemedText>
          </Pressable>
        </View>

        <View style={[styles.settingCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <View style={styles.settingTitleRow}>
            <MaterialCommunityIcons name="eye-outline" size={17} color={colors.primary} />
            <ThemedText style={styles.settingTitle}>谁可以看</ThemedText>
          </View>
          <BlogVisibilitySegmented onChange={setVisibility} value={visibility} />
          <ThemedText style={[styles.settingNote, { color: colors.mutedText }]}>
            发布后可在“我的博客”中随时修改可见范围。
          </ThemedText>
        </View>
      </ScrollView>
      {error ? <ThemedText style={styles.errorText}>{error}</ThemedText> : null}
    </MobileScreen>
  );
}

const styles = StyleSheet.create({
  addCover: {
    alignItems: 'center',
    borderStyle: 'dashed',
    borderWidth: 1,
    borderRadius: 12,
    gap: 7,
    height: 96,
    justifyContent: 'center',
    width: 96,
  },
  addCoverText: {
    fontSize: 10,
  },
  bodyInput: {
    fontSize: 13,
    lineHeight: 21,
    minHeight: 180,
    padding: 0,
  },
  center: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  charCount: {
    fontSize: 10,
  },
  coverCell: {
    borderRadius: 12,
    height: 96,
    overflow: 'hidden',
    position: 'relative',
    width: 96,
  },
  coverPreview: {
    height: '100%',
    width: '100%',
  },
  coverRow: {
    flexDirection: 'row',
    gap: 10,
  },
  draftRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 5,
  },
  draftText: {
    fontSize: 10,
  },
  editor: {
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 16,
    padding: 14,
  },
  editorDivider: {
    height: 1,
    marginVertical: 10,
  },
  editorFooter: {
    alignItems: 'center',
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 10,
  },
  errorText: {
    color: '#d86f5b',
    fontSize: 11,
    paddingVertical: 12,
    textAlign: 'center',
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  page: {
    flex: 1,
  },
  pageTitle: {
    fontSize: 17,
    fontWeight: '900',
  },
  pressed: {
    opacity: 0.7,
  },
  publishButton: {
    alignItems: 'center',
    backgroundColor: '#4b6bff',
    borderRadius: 11,
    flexDirection: 'row',
    gap: 6,
    height: 38,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  publishButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },
  removeCover: {
    alignItems: 'center',
    backgroundColor: 'rgba(21, 27, 59, 0.72)',
    borderRadius: 999,
    height: 22,
    justifyContent: 'center',
    position: 'absolute',
    right: 6,
    top: 6,
    width: 22,
  },
  scrollContent: {
    paddingBottom: 28,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 9,
  },
  settingCard: {
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 16,
    padding: 13,
  },
  settingNote: {
    fontSize: 10,
    lineHeight: 16,
    marginTop: 9,
  },
  settingTitle: {
    fontSize: 12,
    fontWeight: '800',
  },
  settingTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
    marginBottom: 10,
  },
  summaryInput: {
    fontSize: 12,
    padding: 0,
  },
  titleInput: {
    fontSize: 15,
    fontWeight: '800',
    padding: 0,
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 14,
    paddingTop: 6,
  },
});
