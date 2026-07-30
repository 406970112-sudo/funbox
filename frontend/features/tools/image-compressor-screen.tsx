import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useRef, useState, startTransition } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import {
  compressImage,
  downloadCompressedImagesAsZip,
  getImageCompressionErrorMessage,
  getImageCompressionStatus,
  releaseCompressedImage,
  saveCompressedImage,
} from '@/lib/image-compression';
import type {
  ImageCompressionAsset,
  ImageCompressionMode,
  ImageCompressionResult,
} from '@/types/image-compression';

const MAX_FILES = 20;
const MAX_FILE_BYTES = 5 << 20;

const palette = {
  amber: '#f1b643',
  background: '#eef4ff',
  coral: '#ff6b8f',
  ink: '#18233d',
  line: '#dce5f7',
  mint: '#1db991',
  muted: '#7483a2',
  navy: '#151b3b',
  primary: '#4b6bff',
  primarySoft: '#e3e9ff',
  surface: '#ffffff',
  surfaceMuted: '#edf2ff',
};

type QueueStatus = 'pending' | 'compressing' | 'done' | 'error';

type QueueItem = ImageCompressionAsset & {
  error?: string;
  progress: number;
  result?: ImageCompressionResult;
  status: QueueStatus;
};

export function ImageCompressorScreen() {
  const router = useRouter();
  const outputUris = useRef(new Set<string>());
  const [items, setItems] = useState<QueueItem[]>([]);
  const [mode, setMode] = useState<ImageCompressionMode>('smart');
  const [providerStatus, setProviderStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [message, setMessage] = useState('');
  const [downloadingAll, setDownloadingAll] = useState(false);

  useEffect(() => {
    let active = true;
    void getImageCompressionStatus()
      .then((status) => {
        if (active) setProviderStatus(status.available ? 'online' : 'offline');
      })
      .catch(() => {
        if (active) setProviderStatus('offline');
      });
    return () => {
      active = false;
      for (const uri of outputUris.current) {
        releaseCompressedImage({ uri } as ImageCompressionResult);
      }
    };
  }, []);

  const completedItems = items.filter(
    (item): item is QueueItem & { result: ImageCompressionResult } => item.status === 'done' && Boolean(item.result),
  );
  const processingCount = items.filter((item) => item.status === 'compressing' || item.status === 'pending').length;
  const completedOriginalSize = completedItems.reduce((total, item) => total + item.result.originalSize, 0);
  const originalSize = items.reduce((total, item) => total + (item.result?.originalSize || item.size), 0);
  const compressedSize = completedItems.reduce((total, item) => total + item.result.compressedSize, 0);
  const savedPercent =
    completedOriginalSize > 0
      ? Math.max(0, Math.round((1 - compressedSize / completedOriginalSize) * 100))
      : 0;

  async function pickImages() {
    setMessage('');
    if (items.length >= MAX_FILES) {
      setMessage(`单次最多处理 ${MAX_FILES} 张图片。`);
      return;
    }

    if (Platform.OS !== 'web') {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setMessage('需要相册权限才能选择图片。');
        return;
      }
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      allowsMultipleSelection: true,
      mediaTypes: ['images'],
      quality: 1,
      selectionLimit: MAX_FILES - items.length,
    });
    if (result.canceled || !result.assets?.length) return;

    const rejected: string[] = [];
    const nextItems = result.assets.flatMap((asset, index): QueueItem[] => {
      const fileName = asset.fileName || `image-${Date.now()}-${index + 1}.${extensionFromMime(asset.mimeType)}`;
      const mimeType = asset.mimeType || mimeFromFileName(fileName);
      const size = asset.fileSize || 0;
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
        rejected.push(`${fileName} 格式不支持`);
        return [];
      }
      if (size > MAX_FILE_BYTES) {
        rejected.push(`${fileName} 超过 5 MB`);
        return [];
      }
      return [
        {
          fileName,
          id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
          mimeType,
          progress: 0,
          size,
          status: 'pending',
          uri: asset.uri,
        },
      ];
    });

    if (rejected.length > 0) {
      setMessage(rejected.length === 1 ? rejected[0] : `${rejected.length} 张图片因格式或体积限制未加入。`);
    }
    if (nextItems.length === 0) return;

    setItems((current) => [...current, ...nextItems]);
    void processQueue(nextItems, mode);
  }

  async function processQueue(queue: QueueItem[], compressionMode: ImageCompressionMode) {
    let cursor = 0;
    async function worker() {
      while (cursor < queue.length) {
        const item = queue[cursor];
        cursor += 1;
        await processItem(item, compressionMode);
      }
    }
    await Promise.all(Array.from({ length: Math.min(2, queue.length) }, () => worker()));
  }

  async function processItem(item: QueueItem, compressionMode: ImageCompressionMode) {
    updateItem(item.id, { error: undefined, progress: 12, status: 'compressing' });
    const progressTimer = setInterval(() => {
      startTransition(() => {
        setItems((current) =>
          current.map((entry) =>
            entry.id === item.id && entry.status === 'compressing'
              ? { ...entry, progress: Math.min(88, entry.progress + 8) }
              : entry,
          ),
        );
      });
    }, 420);

    try {
      const result = await compressImage(item, compressionMode);
      outputUris.current.add(result.uri);
      updateItem(item.id, { progress: 100, result, status: 'done' });
    } catch (error) {
      updateItem(item.id, { error: getImageCompressionErrorMessage(error), progress: 0, status: 'error' });
    } finally {
      clearInterval(progressTimer);
    }
  }

  function updateItem(id: string, patch: Partial<QueueItem>) {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  async function handleSave(item: QueueItem & { result: ImageCompressionResult }) {
    setMessage('');
    try {
      await saveCompressedImage(item.result);
      setMessage(`${item.fileName} 已保存。`);
    } catch (error) {
      setMessage(getImageCompressionErrorMessage(error));
    }
  }

  async function handleDownloadAll() {
    if (completedItems.length === 0) return;
    setDownloadingAll(true);
    setMessage('');
    try {
      await downloadCompressedImagesAsZip(completedItems.map((item) => item.result));
      setMessage(`已打包 ${completedItems.length} 张图片。`);
    } catch (error) {
      setMessage(getImageCompressionErrorMessage(error));
    } finally {
      setDownloadingAll(false);
    }
  }

  function showHistory() {
    Alert.alert(
      '本次压缩记录',
      completedItems.length > 0
        ? `已完成 ${completedItems.length} 张，共节省 ${savedPercent}% 空间。`
        : '当前还没有已完成的压缩记录。',
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={[styles.scrollContent, items.length > 0 && styles.resultScrollContent]}
          showsVerticalScrollIndicator={false}>
          <View style={styles.content}>
            <View style={styles.topBar}>
              <Pressable
                accessibilityLabel="返回工具列表"
                accessibilityRole="button"
                onPress={() => router.back()}
                style={styles.iconButton}>
                <MaterialCommunityIcons name="arrow-left" size={22} color={palette.ink} />
              </Pressable>
              <ThemedText style={styles.pageTitle}>{items.length > 0 ? '压缩结果' : '图片压缩'}</ThemedText>
              <Pressable
                accessibilityRole="button"
                onPress={items.length > 0 ? () => void pickImages() : showHistory}
                style={styles.topAction}>
                <ThemedText style={styles.topActionText}>
                  {items.length > 0 ? '继续添加' : '记录'}
                </ThemedText>
              </Pressable>
            </View>

            {items.length === 0 ? (
              <UploadState
                mode={mode}
                onModeChange={setMode}
                onPick={() => void pickImages()}
                providerStatus={providerStatus}
              />
            ) : (
              <ResultState
                completedCount={completedItems.length}
                compressedSize={compressedSize}
                items={items}
                onRetry={(item) => void processItem(item, mode)}
                onSave={(item) => void handleSave(item)}
                originalSize={originalSize}
                processingCount={processingCount}
                savedPercent={savedPercent}
              />
            )}

            {message ? (
              <View style={styles.messageBar}>
                <MaterialCommunityIcons name="information-outline" size={17} color={palette.primary} />
                <ThemedText style={styles.messageText}>{message}</ThemedText>
              </View>
            ) : null}
          </View>
        </ScrollView>

        {items.length > 0 ? (
          <View style={styles.stickyAction}>
            <Pressable
              accessibilityRole="button"
              disabled={completedItems.length === 0 || downloadingAll}
              onPress={() => void handleDownloadAll()}
              style={({ pressed }) => [
                styles.downloadAllButton,
                { opacity: completedItems.length === 0 || downloadingAll || pressed ? 0.66 : 1 },
              ]}>
              {downloadingAll ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <MaterialCommunityIcons name="archive-arrow-down-outline" size={20} color="#ffffff" />
              )}
              <ThemedText style={styles.downloadAllText}>
                {downloadingAll ? '正在打包' : '打包下载全部图片'}
              </ThemedText>
            </Pressable>
          </View>
        ) : null}
      </SafeAreaView>
    </>
  );
}

function UploadState({
  mode,
  onModeChange,
  onPick,
  providerStatus,
}: {
  mode: ImageCompressionMode;
  onModeChange: (mode: ImageCompressionMode) => void;
  onPick: () => void;
  providerStatus: 'checking' | 'online' | 'offline';
}) {
  return (
    <>
      <View style={styles.connectionRow}>
        <ThemedText style={styles.connectionLabel}>高质量图片瘦身</ThemedText>
        <View style={styles.connectionStatus}>
          {providerStatus === 'checking' ? (
            <ActivityIndicator color={palette.mint} size={10} />
          ) : (
            <View
              style={[
                styles.statusDot,
                providerStatus === 'offline' && { backgroundColor: palette.amber },
              ]}
            />
          )}
          <ThemedText
            style={[
              styles.connectionStatusText,
              providerStatus === 'offline' && { color: '#a66d00' },
            ]}>
            {providerStatus === 'checking'
              ? '正在连接'
              : providerStatus === 'online'
                ? 'TinyPNG 在线'
                : '服务未配置'}
          </ThemedText>
        </View>
      </View>

      <View style={styles.uploadStage}>
        <View style={[styles.decorativeLine, styles.decorativeLineTop]} />
        <View style={[styles.decorativeLine, styles.decorativeLineBottom]} />
        <View style={styles.uploadIcon}>
          <MaterialCommunityIcons name="image-multiple-outline" size={34} color="#b9c6ff" />
        </View>
        <ThemedText style={styles.uploadTitle}>添加需要压缩的图片</ThemedText>
        <ThemedText style={styles.uploadCopy}>
          支持 JPG、PNG、WebP{`\n`}单次最多 20 张，每张不超过 5 MB
        </ThemedText>
        <Pressable
          accessibilityRole="button"
          onPress={onPick}
          style={({ pressed }) => [styles.uploadButton, { opacity: pressed ? 0.82 : 1 }]}>
          <MaterialCommunityIcons name="plus" size={20} color="#ffffff" />
          <ThemedText style={styles.uploadButtonText}>选择图片</ThemedText>
        </Pressable>
      </View>

      <View style={styles.modeSection}>
        <View style={styles.sectionHeading}>
          <ThemedText style={styles.sectionTitle}>压缩策略</ThemedText>
          <ThemedText style={styles.sectionMeta}>上传前可调整</ThemedText>
        </View>
        <View style={styles.modeControl}>
          <ModeOption
            active={mode === 'smart'}
            label="智能压缩"
            onPress={() => onModeChange('smart')}
            subtitle="体积与画质平衡"
          />
          <ModeOption
            active={mode === 'quality'}
            label="优先画质"
            onPress={() => onModeChange('quality')}
            subtitle="保留更多细节"
          />
        </View>
      </View>

      <View style={styles.privacyNote}>
        <MaterialCommunityIcons name="lock-outline" size={19} color={palette.mint} />
        <ThemedText style={styles.privacyText}>
          图片经安全通道发送至 TinyPNG，压缩完成后不会在 FunBox 服务器留存文件。
        </ThemedText>
      </View>
    </>
  );
}

function ModeOption({
  active,
  label,
  onPress,
  subtitle,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
  subtitle: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.modeOption, active && styles.modeOptionActive]}>
      <ThemedText style={[styles.modeLabel, active && styles.modeLabelActive]}>{label}</ThemedText>
      <ThemedText style={[styles.modeSubtitle, active && styles.modeLabelActive]}>{subtitle}</ThemedText>
    </Pressable>
  );
}

function ResultState({
  completedCount,
  compressedSize,
  items,
  onRetry,
  onSave,
  originalSize,
  processingCount,
  savedPercent,
}: {
  completedCount: number;
  compressedSize: number;
  items: QueueItem[];
  onRetry: (item: QueueItem) => void;
  onSave: (item: QueueItem & { result: ImageCompressionResult }) => void;
  originalSize: number;
  processingCount: number;
  savedPercent: number;
}) {
  return (
    <>
      <View style={styles.summaryBand}>
        <View style={[styles.decorativeLine, styles.summaryLine]} />
        <View style={styles.summaryTop}>
          <View>
            <ThemedText style={styles.summaryKicker}>本次共节省</ThemedText>
            <ThemedText style={styles.summaryValue}>
              {savedPercent}<ThemedText style={styles.summaryUnit}>%</ThemedText>
            </ThemedText>
          </View>
          <View
            style={[
              styles.summaryCheck,
              processingCount === 0 && completedCount !== items.length && styles.summaryWarning,
            ]}>
            {processingCount > 0 ? (
              <ActivityIndicator color="#173a35" />
            ) : completedCount === items.length ? (
              <MaterialCommunityIcons name="check" size={25} color="#173a35" />
            ) : (
              <MaterialCommunityIcons name="alert-outline" size={23} color="#805900" />
            )}
          </View>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryStats}>
          <SummaryStat label="原始体积" value={formatBytes(originalSize)} />
          <SummaryStat label="压缩后" value={formatBytes(compressedSize)} bordered />
          <SummaryStat label="图片数" value={`${items.length} 张`} bordered />
        </View>
      </View>

      <View style={styles.filesSection}>
        <View style={styles.sectionHeading}>
          <ThemedText style={styles.sectionTitle}>文件列表</ThemedText>
          <ThemedText style={styles.sectionMeta}>
            {completedCount} 张完成{processingCount > 0 ? ` · ${processingCount} 张处理中` : ''}
          </ThemedText>
        </View>
        <View style={styles.fileList}>
          {items.map((item) => (
            <FileRow item={item} key={item.id} onRetry={onRetry} onSave={onSave} />
          ))}
        </View>
      </View>
    </>
  );
}

function SummaryStat({ bordered, label, value }: { bordered?: boolean; label: string; value: string }) {
  return (
    <View style={[styles.summaryStat, bordered && styles.summaryStatBorder]}>
      <ThemedText style={styles.summaryStatLabel}>{label}</ThemedText>
      <ThemedText style={styles.summaryStatValue}>{value}</ThemedText>
    </View>
  );
}

function FileRow({
  item,
  onRetry,
  onSave,
}: {
  item: QueueItem;
  onRetry: (item: QueueItem) => void;
  onSave: (item: QueueItem & { result: ImageCompressionResult }) => void;
}) {
  const saving = item.result
    ? Math.max(0, Math.round((1 - item.result.compressedSize / item.result.originalSize) * 100))
    : 0;

  return (
    <View style={styles.fileRow}>
      <Image contentFit="cover" source={{ uri: item.uri }} style={styles.fileThumb} />
      <View style={styles.fileInfo}>
        <ThemedText numberOfLines={1} style={styles.fileName}>{item.fileName}</ThemedText>
        {item.status === 'done' && item.result ? (
          <View style={styles.fileSizeLine}>
            <ThemedText style={styles.fileMeta}>{formatBytes(item.result.originalSize)}</ThemedText>
            <MaterialCommunityIcons name="arrow-right" size={13} color="#9aa6c1" />
            <ThemedText style={styles.fileMeta}>{formatBytes(item.result.compressedSize)}</ThemedText>
            <ThemedText style={styles.saving}>省 {saving}%</ThemedText>
          </View>
        ) : item.status === 'error' ? (
          <ThemedText numberOfLines={1} style={styles.errorText}>{item.error}</ThemedText>
        ) : (
          <>
            <ThemedText style={styles.processingText}>
              {item.status === 'pending' ? '等待压缩' : `正在压缩 ${item.progress}%`}
            </ThemedText>
            <View style={styles.progressTrack}>
              <View style={[styles.progressValue, { width: `${item.progress}%` }]} />
            </View>
          </>
        )}
      </View>
      <Pressable
        accessibilityLabel={item.status === 'done' ? `下载 ${item.fileName}` : `重试 ${item.fileName}`}
        accessibilityRole="button"
        disabled={item.status === 'compressing' || item.status === 'pending'}
        onPress={() => {
          if (item.status === 'done' && item.result) onSave(item as QueueItem & { result: ImageCompressionResult });
          if (item.status === 'error') onRetry(item);
        }}
        style={[
          styles.fileAction,
          item.status !== 'done' && { backgroundColor: '#fff6e3' },
        ]}>
        {item.status === 'done' ? (
          <MaterialCommunityIcons name="download" size={19} color={palette.primary} />
        ) : item.status === 'error' ? (
          <MaterialCommunityIcons name="reload" size={19} color={palette.amber} />
        ) : (
          <ActivityIndicator color={palette.amber} size="small" />
        )}
      </Pressable>
    </View>
  );
}

function formatBytes(bytes: number) {
  if (!bytes) return '0 KB';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function mimeFromFileName(fileName: string) {
  const extension = fileName.split('.').pop()?.toLowerCase();
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  return 'image/jpeg';
}

function extensionFromMime(mimeType?: string | null) {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  return 'jpg';
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: palette.background, flex: 1 },
  scrollContent: { paddingBottom: 36 },
  resultScrollContent: { paddingBottom: 112 },
  content: { alignSelf: 'center', paddingHorizontal: 15, width: '100%', maxWidth: 430 },
  topBar: { alignItems: 'center', flexDirection: 'row', minHeight: 54 },
  iconButton: { alignItems: 'center', height: 38, justifyContent: 'center', width: 42 },
  pageTitle: { color: palette.ink, flex: 1, fontSize: 19, fontWeight: '900', lineHeight: 25, textAlign: 'center' },
  topAction: { alignItems: 'flex-end', justifyContent: 'center', minHeight: 38, width: 64 },
  topActionText: { color: palette.primary, fontSize: 11, fontWeight: '800' },
  connectionRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12, marginHorizontal: 2, marginTop: 6 },
  connectionLabel: { color: palette.muted, fontSize: 10, fontWeight: '700' },
  connectionStatus: { alignItems: 'center', flexDirection: 'row', gap: 6, minHeight: 20 },
  connectionStatusText: { color: '#16876c', fontSize: 10, fontWeight: '800' },
  statusDot: { backgroundColor: palette.mint, borderRadius: 99, height: 7, width: 7 },
  uploadStage: { alignItems: 'center', backgroundColor: palette.navy, borderRadius: 22, minHeight: 300, overflow: 'hidden', paddingHorizontal: 22, paddingTop: 35, position: 'relative' },
  decorativeLine: { borderColor: 'rgba(121,151,255,0.34)', borderRadius: 8, borderWidth: 1, height: 50, position: 'absolute', transform: [{ rotate: '-13deg' }], width: 220 },
  decorativeLineTop: { right: -76, top: 22 },
  decorativeLineBottom: { bottom: 7, left: -92 },
  uploadIcon: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.10)', borderColor: 'rgba(255,255,255,0.15)', borderRadius: 18, borderWidth: 1, height: 72, justifyContent: 'center', width: 72 },
  uploadTitle: { color: '#ffffff', fontSize: 21, fontWeight: '900', lineHeight: 29, marginTop: 19 },
  uploadCopy: { color: '#aeb8d9', fontSize: 11, fontWeight: '600', lineHeight: 19, marginTop: 6, textAlign: 'center' },
  uploadButton: { alignItems: 'center', backgroundColor: palette.coral, borderRadius: 15, flexDirection: 'row', gap: 8, justifyContent: 'center', marginTop: 21, minHeight: 48, paddingHorizontal: 23 },
  uploadButtonText: { color: '#ffffff', fontSize: 13, fontWeight: '900' },
  modeSection: { marginTop: 17 },
  sectionHeading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10, marginHorizontal: 2 },
  sectionTitle: { color: palette.ink, fontSize: 13, fontWeight: '900' },
  sectionMeta: { color: palette.muted, fontSize: 9, fontWeight: '700' },
  modeControl: { backgroundColor: palette.surface, borderColor: palette.line, borderRadius: 17, borderWidth: 1, flexDirection: 'row', gap: 4, padding: 4 },
  modeOption: { alignItems: 'center', borderRadius: 13, flex: 1, gap: 2, justifyContent: 'center', minHeight: 58 },
  modeOptionActive: { backgroundColor: palette.primarySoft },
  modeLabel: { color: palette.muted, fontSize: 11, fontWeight: '900' },
  modeSubtitle: { color: palette.muted, fontSize: 8, fontWeight: '600' },
  modeLabelActive: { color: '#344fc9' },
  privacyNote: { alignItems: 'flex-start', backgroundColor: 'rgba(255,255,255,0.66)', borderColor: palette.line, borderRadius: 15, borderWidth: 1, flexDirection: 'row', gap: 9, marginTop: 13, paddingHorizontal: 12, paddingVertical: 11 },
  privacyText: { color: palette.muted, flex: 1, fontSize: 9, fontWeight: '600', lineHeight: 15 },
  summaryBand: { backgroundColor: palette.navy, borderRadius: 22, marginTop: 6, overflow: 'hidden', padding: 20, position: 'relative' },
  summaryLine: { right: -44, top: 31, width: 190 },
  summaryTop: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between' },
  summaryKicker: { color: '#aeb8d9', fontSize: 10, fontWeight: '700' },
  summaryValue: { color: '#ffffff', fontSize: 44, fontWeight: '900', lineHeight: 50, marginTop: 4 },
  summaryUnit: { color: '#c9f36a', fontSize: 20, fontWeight: '900' },
  summaryCheck: { alignItems: 'center', backgroundColor: '#c9f36a', borderRadius: 15, height: 46, justifyContent: 'center', width: 46 },
  summaryWarning: { backgroundColor: '#ffe6ac' },
  summaryDivider: { backgroundColor: 'rgba(255,255,255,0.10)', height: 1, marginBottom: 15, marginTop: 10 },
  summaryStats: { flexDirection: 'row' },
  summaryStat: { flex: 1, gap: 6, paddingHorizontal: 2 },
  summaryStatBorder: { borderColor: 'rgba(255,255,255,0.12)', borderLeftWidth: 1, paddingLeft: 16 },
  summaryStatLabel: { color: '#9aa7cc', fontSize: 8, fontWeight: '600' },
  summaryStatValue: { color: '#ffffff', fontSize: 11, fontWeight: '900' },
  filesSection: { marginTop: 30 },
  fileList: { gap: 9 },
  fileRow: { alignItems: 'center', backgroundColor: palette.surface, borderColor: palette.line, borderRadius: 17, borderWidth: 1, flexDirection: 'row', gap: 12, minHeight: 82, padding: 10 },
  fileThumb: { borderRadius: 12, height: 58, width: 58 },
  fileInfo: { flex: 1, minWidth: 0 },
  fileName: { color: palette.ink, fontSize: 11, fontWeight: '900' },
  fileSizeLine: { alignItems: 'center', flexDirection: 'row', gap: 5, marginTop: 7 },
  fileMeta: { color: palette.muted, fontSize: 8, fontWeight: '600' },
  saving: { color: '#16876c', fontSize: 9, fontWeight: '900', marginLeft: 4 },
  processingText: { color: palette.muted, fontSize: 8, fontWeight: '700', marginTop: 7 },
  errorText: { color: '#c24762', fontSize: 8, fontWeight: '700', marginTop: 7 },
  progressTrack: { backgroundColor: '#e9eef9', borderRadius: 4, height: 4, marginTop: 8, overflow: 'hidden' },
  progressValue: { backgroundColor: palette.amber, borderRadius: 4, height: 4 },
  fileAction: { alignItems: 'center', backgroundColor: palette.surfaceMuted, borderRadius: 11, height: 36, justifyContent: 'center', width: 36 },
  messageBar: { alignItems: 'flex-start', backgroundColor: palette.surface, borderColor: palette.line, borderRadius: 14, borderWidth: 1, flexDirection: 'row', gap: 8, marginTop: 13, padding: 11 },
  messageText: { color: palette.muted, flex: 1, fontSize: 10, fontWeight: '700', lineHeight: 16 },
  stickyAction: { backgroundColor: palette.background, bottom: 0, left: 0, paddingBottom: 16, paddingHorizontal: 15, paddingTop: 10, position: 'absolute', right: 0 },
  downloadAllButton: { alignItems: 'center', alignSelf: 'center', backgroundColor: palette.primary, borderRadius: 17, flexDirection: 'row', gap: 9, justifyContent: 'center', maxWidth: 400, minHeight: 54, width: '100%' },
  downloadAllText: { color: '#ffffff', fontSize: 13, fontWeight: '900' },
});
