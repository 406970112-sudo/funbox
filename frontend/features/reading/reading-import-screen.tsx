import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Buffer } from 'buffer';
import * as DocumentPicker from 'expo-document-picker';
import { useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { parseLocalReadingFile } from '@/lib/reading-local-import';
import { saveImportedLocalBook } from '@/lib/reading-local-storage';

import { IconButton, PrimaryButton, ReadingPage, readingColors } from './reading-ui';

export function ReadingImportScreen() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  async function chooseFile() {
    setError('');
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: false,
      type: ['text/plain', 'application/epub+zip', 'application/octet-stream'],
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    setFileName(asset.name);
    setBusy(true);
    setStatus('正在读取文件…');
    try {
      const response = await fetch(asset.uri);
      const bytes = new Uint8Array(await response.arrayBuffer());
      setStatus('正在识别编码与章节…');
      const parsed = parseLocalReadingFile(asset.name, bytes);
      setStatus(`已识别 ${parsed.chapters.length} 章，正在写入设备…`);
      const book = await saveImportedLocalBook(parsed);
      router.replace(`/reading/books/${book.id}` as Href);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : '文件导入失败，请重试。');
      setStatus('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ReadingPage>
      <View style={styles.topBar}><View style={styles.topBarInner}><IconButton accessibilityLabel="返回书架" icon="arrow-left" onPress={() => router.back()} /><Text style={styles.topTitle}>导入本地图书</Text><View style={styles.placeholder} /></View></View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.heading}><Text style={styles.eyebrow}>LOCAL LIBRARY</Text><Text style={styles.title}>把自己的书带进来</Text><Text style={styles.subtitle}>支持 TXT 与 EPUB。解析和正文都留在当前设备，不进入管理员后台，也不会上传到服务器。</Text></View>

        <Pressable accessibilityRole="button" disabled={busy} onPress={() => void chooseFile()} style={({ pressed }) => [styles.dropZone, busy && styles.disabled, pressed && styles.pressed]}>
          <View style={styles.fileIcon}><MaterialCommunityIcons name={busy ? 'book-sync-outline' : 'file-upload-outline'} size={34} color={readingColors.blue} /></View>
          <Text style={styles.dropTitle}>{busy ? status : '选择 TXT / EPUB 文件'}</Text>
          <Text style={styles.dropBody}>{fileName || '单个文件不超过 20 MB；EPUB 解压内容不超过 100 MB'}</Text>
          {!busy ? <PrimaryButton icon="folder-open-outline" onPress={() => void chooseFile()}>浏览文件</PrimaryButton> : null}
        </Pressable>

        {error ? <View style={styles.errorBox}><MaterialCommunityIcons name="alert-circle-outline" size={20} color="#c14656" /><Text style={styles.errorText}>{error}</Text></View> : null}

        <View style={styles.infoGrid}>
          <InfoItem icon="format-text" title="TXT 编码" body="自动识别 UTF-8、GB18030/GBK 与 UTF-16，并按章节标题切分。" />
          <InfoItem icon="book-open-variant" title="EPUB 目录" body="支持 EPUB 3 Navigation 与 EPUB 2 NCX，并按书脊顺序兜底。" />
          <InfoItem icon="cellphone-lock" title="仅在设备" body="本地图书、阅读进度和书签只保存于当前设备，退出账号也可继续阅读。" />
          <InfoItem icon="shield-check-outline" title="安全解析" body="限制文件大小、解压体积和条目数量，并拒绝不安全的压缩路径。" />
        </View>

        <View style={styles.notice}><MaterialCommunityIcons name="information-outline" size={18} color={readingColors.blue} /><Text style={styles.noticeText}>请只导入你有权阅读和保存的内容。本地导入不代表平台获得或验证该作品的传播授权。</Text></View>
      </ScrollView>
    </ReadingPage>
  );
}

function InfoItem({ body, icon, title }: { body: string; icon: React.ComponentProps<typeof MaterialCommunityIcons>['name']; title: string }) {
  return <View style={styles.infoItem}><View style={styles.infoIcon}><MaterialCommunityIcons name={icon} size={22} color={readingColors.blue} /></View><View style={styles.infoCopy}><Text style={styles.infoTitle}>{title}</Text><Text style={styles.infoBody}>{body}</Text></View></View>;
}

const styles = StyleSheet.create({
  content: { alignSelf: 'center', gap: 22, maxWidth: 760, padding: 28, width: '100%' },
  disabled: { opacity: 0.62 },
  dropBody: { color: readingColors.muted, fontSize: 12, lineHeight: 19, maxWidth: 420, textAlign: 'center' },
  dropTitle: { color: readingColors.ink, fontSize: 19, fontWeight: '900' },
  dropZone: { alignItems: 'center', backgroundColor: '#fff', borderColor: '#cbd3ed', borderRadius: 8, borderStyle: 'dashed', borderWidth: 1.5, gap: 12, justifyContent: 'center', minHeight: 270, padding: 28 },
  errorBox: { alignItems: 'center', backgroundColor: '#fff0f2', borderColor: '#f5c6cc', borderRadius: 7, borderWidth: 1, flexDirection: 'row', gap: 8, padding: 13 },
  errorText: { color: '#a33342', flex: 1, fontSize: 12, lineHeight: 18 },
  eyebrow: { color: readingColors.blue, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  fileIcon: { alignItems: 'center', backgroundColor: readingColors.blueSoft, borderRadius: 8, height: 68, justifyContent: 'center', width: 68 },
  heading: { gap: 7 },
  infoBody: { color: readingColors.muted, fontSize: 11, lineHeight: 18 },
  infoCopy: { flex: 1, gap: 3 },
  infoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  infoIcon: { alignItems: 'center', backgroundColor: readingColors.blueSoft, borderRadius: 6, height: 42, justifyContent: 'center', width: 42 },
  infoItem: { alignItems: 'flex-start', backgroundColor: '#fff', borderColor: readingColors.line, borderRadius: 7, borderWidth: 1, flexDirection: 'row', gap: 11, padding: 14, width: '48%' },
  infoTitle: { color: readingColors.ink, fontSize: 13, fontWeight: '900' },
  notice: { alignItems: 'flex-start', borderTopColor: readingColors.line, borderTopWidth: 1, flexDirection: 'row', gap: 8, paddingVertical: 16 },
  noticeText: { color: readingColors.muted, flex: 1, fontSize: 11, lineHeight: 18 },
  placeholder: { height: 38, width: 38 },
  pressed: { opacity: 0.75 },
  subtitle: { color: readingColors.muted, fontSize: 13, lineHeight: 21, maxWidth: 620 },
  title: { color: readingColors.ink, fontSize: 29, fontWeight: '900' },
  topBar: { backgroundColor: '#fff', borderBottomColor: readingColors.line, borderBottomWidth: 1 },
  topBarInner: { alignItems: 'center', alignSelf: 'center', flexDirection: 'row', justifyContent: 'space-between', maxWidth: 760, paddingHorizontal: 16, paddingVertical: 10, width: '100%' },
  topTitle: { color: readingColors.ink, fontSize: 14, fontWeight: '900' },
});
