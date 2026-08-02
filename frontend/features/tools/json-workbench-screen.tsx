import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import { useRouter } from 'expo-router';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { appLayout } from '@/constants/app-theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  convertJsonToFormat,
  convertTextToJson,
  DEFAULT_CLEAN_OPTIONS,
  DEFAULT_DIFF_OPTIONS,
  diffJson,
  diffTextLines,
  getByPath,
  mergeDiff,
  parseJsonInput,
  summarizeJson,
  type CleanOptions,
  type DiffItem,
  type DiffOptions,
  type InputFormat,
  type JsonSummary,
  type JsonValue,
  type OutputFormat,
} from '@/lib/json-workbench';
import {
  addWorkbenchSession,
  clearWorkbenchSessions,
  deleteWorkbenchSession,
  deleteWorkbenchTemplate,
  getWorkbenchSessions,
  getWorkbenchTemplates,
  saveWorkbenchTemplate,
  type WorkbenchSession,
  type WorkbenchTemplate,
} from '@/lib/json-workbench-storage';

import {
  COMPARE_A_SAMPLE,
  COMPARE_B_SAMPLE,
  CONVERT_SAMPLE,
  CSV_SAMPLE,
  REAL_DATA_NOTE,
} from './json-workbench-samples';

type WorkbenchTab = 'compare' | 'convert' | 'history' | 'templates';
type InputSource = 'file' | 'paste' | 'sample' | 'url';
type CompareMode = 'path' | 'semantic' | 'text';

const OUTPUT_FORMATS: OutputFormat[] = [
  'json',
  'yaml',
  'csv',
  'xml',
  'jsonl',
  'typescript',
  'schema',
  'sql',
];

const INPUT_FORMATS: InputFormat[] = ['json', 'yaml', 'csv', 'xml', 'toml'];

const FORMAT_LABELS: Record<OutputFormat, string> = {
  csv: 'CSV',
  json: 'JSON',
  jsonl: 'JSONL',
  schema: 'Schema',
  sql: 'SQL',
  typescript: 'TS',
  xml: 'XML',
  yaml: 'YAML',
};

export function JsonWorkbenchScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const [tab, setTab] = useState<WorkbenchTab>('convert');

  const [inputSource, setInputSource] = useState<InputSource>('sample');
  const [inputFormat, setInputFormat] = useState<InputFormat>('json');
  const [inputText, setInputText] = useState(CONVERT_SAMPLE.text);
  const [urlText, setUrlText] = useState('');
  const [fileName, setFileName] = useState('');
  const [outputFormat, setOutputFormat] = useState<OutputFormat>('yaml');
  const [cleanOptions, setCleanOptions] = useState<CleanOptions>(DEFAULT_CLEAN_OPTIONS);
  const [outputText, setOutputText] = useState('');
  const [convertError, setConvertError] = useState('');
  const [summary, setSummary] = useState<JsonSummary | null>(null);
  const [lastRunMs, setLastRunMs] = useState(0);
  const [busy, setBusy] = useState(false);
  const [copyMessage, setCopyMessage] = useState('');

  const [compareA, setCompareA] = useState(COMPARE_A_SAMPLE.text);
  const [compareB, setCompareB] = useState(COMPARE_B_SAMPLE.text);
  const [compareMode, setCompareMode] = useState<CompareMode>('semantic');
  const [compareOptions, setCompareOptions] = useState<DiffOptions>(DEFAULT_DIFF_OPTIONS);
  const [singlePath, setSinglePath] = useState('version');
  const [diffItems, setDiffItems] = useState<DiffItem[]>([]);
  const [diffStats, setDiffStats] = useState({ added: 0, modified: 0, removed: 0, unchanged: 0 });
  const [textDiffLines, setTextDiffLines] = useState<{ text: string; type: 'added' | 'removed' | 'same' }[]>([]);
  const [singlePathResult, setSinglePathResult] = useState('');
  const [compareError, setCompareError] = useState('');
  const [compareOutput, setCompareOutput] = useState('');

  const [sessions, setSessions] = useState<WorkbenchSession[]>([]);
  const [templates, setTemplates] = useState<WorkbenchTemplate[]>([]);
  const [storageMessage, setStorageMessage] = useState('');

  const runRef = useRef(0);

  const loadHistory = useCallback(async () => {
    const [storedSessions, storedTemplates] = await Promise.all([
      getWorkbenchSessions(),
      getWorkbenchTemplates(),
    ]);
    setSessions(storedSessions);
    setTemplates(storedTemplates);
  }, []);

  useEffect(() => {
    if (tab === 'history' || tab === 'templates') {
      void loadHistory();
    }
  }, [loadHistory, tab]);

  useEffect(() => {
    if (!copyMessage) return;
    const timer = setTimeout(() => setCopyMessage(''), 1600);
    return () => clearTimeout(timer);
  }, [copyMessage]);

  async function copyText(text: string) {
    await Clipboard.setStringAsync(text);
    setCopyMessage('已复制');
  }

  async function pickFile() {
    setConvertError('');
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: false,
      type: ['application/json', 'text/plain', 'application/x-yaml', 'text/yaml'],
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    setFileName(asset.name);
    setBusy(true);
    try {
      const response = await fetch(asset.uri);
      const text = await response.text();
      setInputText(text);
    } catch {
      setConvertError('文件读取失败，请重试。');
    } finally {
      setBusy(false);
    }
  }

  async function fetchUrl() {
    if (!urlText.trim()) {
      setConvertError('请输入需要抓取的 HTTPS JSON 地址。');
      return;
    }
    setBusy(true);
    setConvertError('');
    try {
      const response = await fetch(urlText.trim(), {
        headers: { Accept: 'application/json, text/plain, */*' },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      setInputText(await response.text());
      setInputSource('paste');
    } catch {
      setConvertError('无法直接访问该地址，请粘贴内容。');
    } finally {
      setBusy(false);
    }
  }

  function loadSample(kind: 'convert' | 'csv') {
    const sample = kind === 'convert' ? CONVERT_SAMPLE : CSV_SAMPLE;
    setInputText(sample.text);
    setInputFormat('json');
    setOutputFormat(kind === 'convert' ? 'yaml' : 'csv');
    setInputSource('sample');
    setConvertError('');
  }

  function runConvert() {
    const requestID = ++runRef.current;
    setConvertError('');
    setOutputText('');
    const startedAt = Date.now();
    try {
      let value: JsonValue;
      if (inputFormat === 'json') {
        const parsed = parseJsonInput(inputText);
        if (!parsed.ok) {
          setConvertError(`第 ${parsed.error.line} 行第 ${parsed.error.column} 列：${parsed.error.message}`);
          return;
        }
        value = parsed.value;
      } else {
        value = convertTextToJson(inputText, inputFormat);
      }
      const nextOutput = convertJsonToFormat(value, outputFormat, cleanOptions);
      if (requestID !== runRef.current) return;
      setOutputText(nextOutput);
      setSummary(summarizeJson(value));
      setLastRunMs(Date.now() - startedAt);
      setConvertError('');
      void addWorkbenchSession({
        createdAt: Date.now(),
        id: `convert-${Date.now()}`,
        inputText,
        kind: 'convert',
        options: { ...cleanOptions, inputFormat },
        outputFormat,
        outputText: nextOutput.slice(0, 1200),
        title: `JSON → ${FORMAT_LABELS[outputFormat]}`,
      });
    } catch (error) {
      if (requestID === runRef.current) {
        setConvertError(error instanceof Error ? error.message : '转换失败，请检查输入内容。');
      }
    }
  }

  function runCompare() {
    setCompareError('');
    setCompareOutput('');
    setSinglePathResult('');
    if (compareMode === 'text') {
      setTextDiffLines(diffTextLines(compareA, compareB));
      return;
    }

    try {
      const aResult = parseJsonInput(compareA);
      const bResult = parseJsonInput(compareB);
      if (!aResult.ok || !bResult.ok) {
        setCompareError('A/B 均为合法 JSON 后才能对比。');
        return;
      }
      if (compareMode === 'path') {
        const aValue = getByPath(aResult.value, singlePath);
        const bValue = getByPath(bResult.value, singlePath);
        setSinglePathResult(
          `A: ${JSON.stringify(aValue ?? null, null, 2)}\n\nB: ${JSON.stringify(bValue ?? null, null, 2)}`,
        );
        return;
      }
      const result = diffJson(aResult.value, bResult.value, compareOptions);
      setDiffItems(result.changes);
      setDiffStats({
        added: result.added,
        modified: result.modified,
        removed: result.removed,
        unchanged: result.unchanged,
      });
      void addWorkbenchSession({
        createdAt: Date.now(),
        id: `compare-${Date.now()}`,
        inputBText: compareB,
        inputText: compareA,
        kind: 'compare',
        options: { ...compareOptions, compareMode },
        title: 'TypeScript v5.4.5 ↔ v5.6.3',
      });
    } catch (error) {
      setCompareError(error instanceof Error ? error.message : '对比失败，请检查输入内容。');
    }
  }

  function buildDiffSummary(): string {
    const lines = [
      '# JSON 对比摘要',
      `- 修改：${diffStats.modified}`,
      `- 新增：${diffStats.added}`,
      `- 删除：${diffStats.removed}`,
      '',
    ];
    diffItems.slice(0, 80).forEach((item) => {
      const before = item.before === undefined ? '—' : JSON.stringify(item.before);
      const after = item.after === undefined ? '—' : JSON.stringify(item.after);
      lines.push(`- [${item.type}] ${item.path}: ${before} → ${after}`);
    });
    return lines.join('\n');
  }

  function mergeAsB() {
    try {
      const aResult = parseJsonInput(compareA);
      const bResult = parseJsonInput(compareB);
      if (!aResult.ok || !bResult.ok) {
        setCompareError('A/B 均为合法 JSON 后才能合并。');
        return;
      }
      const merged = mergeDiff(aResult.value, bResult.value, diffItems, 'b');
      setCompareOutput(JSON.stringify(merged, null, 2));
    } catch (error) {
      setCompareError(error instanceof Error ? error.message : '合并失败。');
    }
  }

  async function saveCurrentTemplate() {
    const template: WorkbenchTemplate = {
      createdAt: Date.now(),
      id: `template-${Date.now()}`,
      kind: 'convert',
      name: `JSON → ${FORMAT_LABELS[outputFormat]} 模板`,
      options: { ...cleanOptions, inputFormat, outputFormat },
    };
    const next = await saveWorkbenchTemplate(template);
    setTemplates(next);
    setStorageMessage('模板已保存');
    setTimeout(() => setStorageMessage(''), 1600);
  }

  async function removeSession(id: string) {
    setSessions(await deleteWorkbenchSession(id));
  }

  async function removeTemplate(id: string) {
    setTemplates(await deleteWorkbenchTemplate(id));
  }

  async function replaySession(session: WorkbenchSession) {
    if (session.kind === 'convert') {
      setInputText(session.inputText);
      setInputFormat((session.options.inputFormat as InputFormat) ?? 'json');
      setOutputFormat((session.options.outputFormat as OutputFormat) ?? 'json');
      setCleanOptions({ ...DEFAULT_CLEAN_OPTIONS, ...(session.options as Partial<CleanOptions>) });
      setTab('convert');
      return;
    }
    setCompareA(session.inputText);
    setCompareB(session.inputBText ?? session.inputText);
    setCompareOptions({
      ...DEFAULT_DIFF_OPTIONS,
      ...(session.options as Partial<DiffOptions>),
    });
    setTab('compare');
  }

  function applyTemplate(template: WorkbenchTemplate) {
    if (template.kind === 'compare') {
      setCompareOptions({ ...DEFAULT_DIFF_OPTIONS, ...(template.options as Partial<DiffOptions>) });
      setTab('compare');
      return;
    }
    setCleanOptions({ ...DEFAULT_CLEAN_OPTIONS, ...(template.options as Partial<CleanOptions>) });
    setOutputFormat((template.options.outputFormat as OutputFormat) ?? 'json');
    setInputFormat((template.options.inputFormat as InputFormat) ?? 'json');
    setTab('convert');
  }

  const contentContainer = useMemo(
    () => (wide ? styles.contentWide : styles.contentMobile),
    [wide],
  );

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <View style={[styles.content, contentContainer]}>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <ThemedText style={[styles.eyebrow, { color: colors.primary }]}>JSON WORKBENCH</ThemedText>
              <ThemedText style={styles.title}>JSON 工作台</ThemedText>
              <ThemedText style={[styles.subtitle, { color: colors.mutedText }]}>
                转换 · 对比 · 全部本地处理
              </ThemedText>
            </View>
            <Pressable
              accessibilityLabel="返回"
              accessibilityRole="button"
              onPress={() => router.back()}
              style={[styles.backButton, { backgroundColor: colors.surface, borderColor: colors.line }]}>
              <MaterialCommunityIcons name="arrow-left" size={20} color={colors.text} />
            </Pressable>
          </View>

          <View style={[styles.tabRow, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            {(
              [
                ['convert', '转换', 'swap-horizontal'],
                ['compare', '对比', 'compare'],
                ['history', '历史', 'history'],
                ['templates', '模板', 'bookmark-outline'],
              ] as [WorkbenchTab, string, ComponentProps<typeof MaterialCommunityIcons>['name']][]
            ).map(([id, label, icon]) => (
              <Pressable
                key={id}
                accessibilityRole="tab"
                onPress={() => setTab(id)}
                style={({ pressed }) => [
                  styles.tabButton,
                  tab === id && { backgroundColor: colors.primary },
                  pressed && styles.pressed,
                ]}>
                <MaterialCommunityIcons
                  color={tab === id ? '#ffffff' : colors.mutedText}
                  name={icon}
                  size={15}
                />
                <ThemedText style={[styles.tabText, tab === id && { color: '#ffffff' }]}>
                  {label}
                </ThemedText>
              </Pressable>
            ))}
          </View>

          {tab === 'convert' ? (
            <ConvertPanel
              busy={busy}
              cleanOptions={cleanOptions}
              colors={colors}
              copyMessage={copyMessage}
              errorText={convertError}
              fileName={fileName}
              inputFormat={inputFormat}
              inputSource={inputSource}
              inputText={inputText}
              lastRunMs={lastRunMs}
              onCopy={() => void copyText(outputText)}
              onFetchUrl={() => void fetchUrl()}
              onInputFormatChange={setInputFormat}
              onInputSourceChange={setInputSource}
              onInputTextChange={setInputText}
              onLoadSample={loadSample}
              onOutputFormatChange={setOutputFormat}
              onPickFile={() => void pickFile()}
              onRun={runConvert}
              onSaveTemplate={() => void saveCurrentTemplate()}
              onSetCleanOptions={setCleanOptions}
              onUrlTextChange={setUrlText}
              outputFormat={outputFormat}
              outputText={outputText}
              summary={summary}
              urlText={urlText}
              wide={wide}
            />
          ) : null}

          {tab === 'compare' ? (
            <ComparePanel
              colors={colors}
              compareA={compareA}
              compareB={compareB}
              compareError={compareError}
              compareMode={compareMode}
              compareOptions={compareOptions}
              compareOutput={compareOutput}
              diffItems={diffItems}
              diffStats={diffStats}
              onCompareAChange={setCompareA}
              onCompareBChange={setCompareB}
              onCopySummary={() => void copyText(buildDiffSummary())}
              onLoadA={() => setCompareA(COMPARE_A_SAMPLE.text)}
              onLoadB={() => setCompareB(COMPARE_B_SAMPLE.text)}
              onMergeAsB={mergeAsB}
              onModeChange={setCompareMode}
              onOptionsChange={setCompareOptions}
              onPathChange={setSinglePath}
              onRun={runCompare}
              singlePath={singlePath}
              singlePathResult={singlePathResult}
              textDiffLines={textDiffLines}
              wide={wide}
            />
          ) : null}

          {tab === 'history' ? (
            <HistoryPanel
              colors={colors}
              onClear={() => {
                void clearWorkbenchSessions().then(() => setSessions([]));
              }}
              onDelete={removeSession}
              onReplay={replaySession}
              sessions={sessions}
            />
          ) : null}

          {tab === 'templates' ? (
            <TemplatesPanel
              colors={colors}
              message={storageMessage}
              onApply={applyTemplate}
              onDelete={removeTemplate}
              templates={templates}
            />
          ) : null}

          <View style={[styles.realNote, { backgroundColor: colors.surfaceMuted }]}>
            <MaterialCommunityIcons name="database-check-outline" size={16} color={colors.success} />
            <ThemedText style={[styles.realNoteText, { color: colors.mutedText }]}>
              {REAL_DATA_NOTE}
            </ThemedText>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

type ThemeColors = ReturnType<typeof useAppTheme>['colors'];

function ConvertPanel(props: {
  busy: boolean;
  cleanOptions: CleanOptions;
  colors: ThemeColors;
  copyMessage: string;
  errorText: string;
  fileName: string;
  inputFormat: InputFormat;
  inputSource: InputSource;
  inputText: string;
  lastRunMs: number;
  onCopy: () => void;
  onFetchUrl: () => void;
  onInputFormatChange: (format: InputFormat) => void;
  onInputSourceChange: (source: InputSource) => void;
  onInputTextChange: (text: string) => void;
  onLoadSample: (kind: 'convert' | 'csv') => void;
  onOutputFormatChange: (format: OutputFormat) => void;
  onPickFile: () => void;
  onRun: () => void;
  onSaveTemplate: () => void;
  onSetCleanOptions: (options: CleanOptions) => void;
  onUrlTextChange: (text: string) => void;
  outputFormat: OutputFormat;
  outputText: string;
  summary: JsonSummary | null;
  urlText: string;
  wide: boolean;
}) {
  const { colors } = useAppTheme();

  return (
    <View style={[styles.section, props.wide && styles.sectionWide]}>
      <View style={props.wide ? styles.wideItem : undefined}>
        <PanelCard colors={colors} title="输入" trailing={props.inputSource === 'sample' ? '真实数据' : '本地处理'}>
          <View style={styles.segRow}>
            {(
              [
                ['paste', '粘贴'],
                ['file', '文件'],
                ['url', 'URL'],
                ['sample', '真实示例'],
              ] as [InputSource, string][]
            ).map(([id, label]) => (
              <Chip
                active={props.inputSource === id}
                key={id}
                label={label}
                onPress={() => props.onInputSourceChange(id)}
              />
            ))}
          </View>

          {props.inputSource === 'sample' ? (
            <View style={styles.sampleRow}>
              <Pressable
                onPress={() => props.onLoadSample('convert')}
                style={[styles.sampleButton, { backgroundColor: colors.primarySoft }]}>
                <ThemedText style={[styles.sampleText, { color: colors.primary }]}>
                  TypeScript package.json → YAML
                </ThemedText>
              </Pressable>
              <Pressable
                onPress={() => props.onLoadSample('csv')}
                style={[styles.sampleButton, { backgroundColor: colors.surfaceMuted }]}>
                <ThemedText style={[styles.sampleText, { color: colors.mutedText }]}>
                  Open-Meteo 上海 → CSV
                </ThemedText>
              </Pressable>
            </View>
          ) : null}

          {props.inputSource === 'file' ? (
            <Pressable
              onPress={props.onPickFile}
              style={[styles.dropZone, { backgroundColor: colors.surfaceMuted, borderColor: colors.line }]}>
              <MaterialCommunityIcons name="file-upload-outline" size={24} color={colors.primary} />
              <ThemedText style={styles.dropTitle}>
                {props.fileName || '选择 JSON / YAML / CSV / XML / TOML 文件'}
              </ThemedText>
              <ThemedText style={[styles.dropBody, { color: colors.mutedText }]}>
                单文件不超过 10 MB，读取后仅保存在本机内存
              </ThemedText>
            </Pressable>
          ) : null}

          {props.inputSource === 'url' ? (
            <View style={styles.urlRow}>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={props.onUrlTextChange}
                placeholder="https://example.com/data.json"
                placeholderTextColor={colors.mutedText}
                style={[
                  styles.urlInput,
                  { backgroundColor: colors.surfaceMuted, borderColor: colors.line, color: colors.text },
                ]}
                value={props.urlText}
              />
              <Pressable onPress={props.onFetchUrl} style={[styles.fetchButton, { backgroundColor: colors.primary }]}>
                {props.busy ? (
                  <ActivityIndicator color="#ffffff" size="small" />
                ) : (
                  <ThemedText style={styles.fetchText}>抓取</ThemedText>
                )}
              </Pressable>
            </View>
          ) : null}

          {props.inputSource === 'paste' || props.inputSource === 'url' || props.inputSource === 'sample' ? (
            <CodeInput
              colors={colors}
              onChangeText={props.onInputTextChange}
              placeholder="粘贴 JSON、YAML、CSV、XML 或 TOML"
              value={props.inputText}
            />
          ) : null}

          <View style={styles.labelRow}>
            <ThemedText style={[styles.label, { color: colors.mutedText }]}>输入格式</ThemedText>
          </View>
          <View style={styles.segRow}>
            {INPUT_FORMATS.map((format) => (
              <Chip
                active={props.inputFormat === format}
                key={format}
                label={format.toUpperCase()}
                onPress={() => props.onInputFormatChange(format)}
              />
            ))}
          </View>
        </PanelCard>
      </View>

      <View style={props.wide ? styles.wideItem : undefined}>
        <PanelCard colors={colors} title="处理与输出" trailing={`${props.outputText.length} 字符`}>
          <View style={styles.optionGrid}>
            <ToggleChip
              active={props.cleanOptions.sortKeys}
              colors={colors}
              label="键排序"
              onToggle={(value) => props.onSetCleanOptions({ ...props.cleanOptions, sortKeys: value })}
            />
            <ToggleChip
              active={props.cleanOptions.dedupeArrays}
              colors={colors}
              label="数组去重"
              onToggle={(value) => props.onSetCleanOptions({ ...props.cleanOptions, dedupeArrays: value })}
            />
            <ToggleChip
              active={props.cleanOptions.ignoreEmpty}
              colors={colors}
              label="忽略空值"
              onToggle={(value) => props.onSetCleanOptions({ ...props.cleanOptions, ignoreEmpty: value })}
            />
            <ToggleChip
              active={props.cleanOptions.maskSensitive}
              colors={colors}
              label="敏感遮蔽"
              onToggle={(value) => props.onSetCleanOptions({ ...props.cleanOptions, maskSensitive: value })}
            />
          </View>

          <View style={styles.labelRow}>
            <ThemedText style={[styles.label, { color: colors.mutedText }]}>键名规范</ThemedText>
          </View>
          <View style={styles.segRow}>
            {(
              [
                ['none', '保持'],
                ['camel', '驼峰'],
                ['snake', '下划线'],
                ['kebab', '短横线'],
              ] as [CleanOptions['keyCase'], string][]
            ).map(([value, label]) => (
              <Chip
                active={props.cleanOptions.keyCase === value}
                key={value}
                label={label}
                onPress={() => props.onSetCleanOptions({ ...props.cleanOptions, keyCase: value })}
              />
            ))}
          </View>

          <View style={styles.labelRow}>
            <ThemedText style={[styles.label, { color: colors.mutedText }]}>输出格式</ThemedText>
          </View>
          <View style={styles.formatGrid}>
            {OUTPUT_FORMATS.map((format) => (
              <Chip
                active={props.outputFormat === format}
                key={format}
                label={FORMAT_LABELS[format]}
                onPress={() => props.onOutputFormatChange(format)}
              />
            ))}
          </View>

          <View style={styles.actionRow}>
            <Pressable onPress={props.onRun} style={[styles.primaryButton, { backgroundColor: colors.primary }]}>
              <MaterialCommunityIcons name="play" size={16} color="#ffffff" />
              <ThemedText style={styles.primaryButtonText}>转换</ThemedText>
            </Pressable>
            <Pressable onPress={props.onCopy} style={[styles.secondaryButton, { backgroundColor: colors.surfaceMuted }]}>
              <MaterialCommunityIcons name="content-copy" size={15} color={colors.text} />
              <ThemedText style={styles.secondaryButtonText}>{props.copyMessage || '复制输出'}</ThemedText>
            </Pressable>
            <Pressable
              onPress={props.onSaveTemplate}
              style={[styles.secondaryButton, { backgroundColor: colors.surfaceMuted }]}>
              <MaterialCommunityIcons name="bookmark-plus-outline" size={15} color={colors.text} />
              <ThemedText style={styles.secondaryButtonText}>存模板</ThemedText>
            </Pressable>
          </View>

          <CodeOutput colors={colors} text={props.outputText || '转换结果将在这里显示'} />

          {props.errorText ? (
            <View style={[styles.errorBox, { backgroundColor: '#ffecee' }]}>
              <MaterialCommunityIcons name="alert-circle-outline" size={16} color="#c14656" />
              <ThemedText style={styles.errorText}>{props.errorText}</ThemedText>
            </View>
          ) : null}

          {props.summary ? (
            <ThemedText style={[styles.statsText, { color: colors.mutedText }]}>
              节点 {props.summary.nodes} · 深度 {props.summary.depth} · {props.summary.bytes} 字节 · 耗时{' '}
              {props.lastRunMs} ms
            </ThemedText>
          ) : null}
        </PanelCard>
      </View>
    </View>
  );
}

function ComparePanel(props: {
  colors: ThemeColors;
  compareA: string;
  compareB: string;
  compareError: string;
  compareMode: CompareMode;
  compareOptions: DiffOptions;
  compareOutput: string;
  diffItems: DiffItem[];
  diffStats: { added: number; modified: number; removed: number; unchanged: number };
  onCompareAChange: (text: string) => void;
  onCompareBChange: (text: string) => void;
  onCopySummary: () => void;
  onLoadA: () => void;
  onLoadB: () => void;
  onMergeAsB: () => void;
  onModeChange: (mode: CompareMode) => void;
  onOptionsChange: (options: DiffOptions) => void;
  onPathChange: (path: string) => void;
  onRun: () => void;
  singlePath: string;
  singlePathResult: string;
  textDiffLines: { text: string; type: 'added' | 'removed' | 'same' }[];
  wide: boolean;
}) {
  const { colors } = useAppTheme();
  const updateOption = (patch: Partial<DiffOptions>) =>
    props.onOptionsChange({ ...props.compareOptions, ...patch });

  return (
    <View style={[styles.section, props.wide && styles.sectionWide]}>
      <View style={props.wide ? styles.wideItem : undefined}>
        <PanelCard colors={colors} title="A / B 输入" trailing="真实数据 · v5.4.5 ↔ v5.6.3">
          <View style={styles.compareSampleRow}>
            <Pressable onPress={props.onLoadA} style={[styles.sampleButton, { backgroundColor: colors.primarySoft }]}>
              <ThemedText style={[styles.sampleText, { color: colors.primary }]}>载入 v5.4.5</ThemedText>
            </Pressable>
            <Pressable onPress={props.onLoadB} style={[styles.sampleButton, { backgroundColor: colors.surfaceMuted }]}>
              <ThemedText style={[styles.sampleText, { color: colors.mutedText }]}>载入 v5.6.3</ThemedText>
            </Pressable>
          </View>
          <CodeInput
            colors={colors}
            onChangeText={props.onCompareAChange}
            placeholder="A：粘贴 JSON"
            value={props.compareA}
          />
          <CodeInput
            colors={colors}
            onChangeText={props.onCompareBChange}
            placeholder="B：粘贴 JSON"
            value={props.compareB}
          />
        </PanelCard>
      </View>

      <View style={props.wide ? styles.wideItem : undefined}>
        <PanelCard colors={colors} title="对比配置" trailing="语义优先">
          <View style={styles.segRow}>
            {(
              [
                ['semantic', '语义树'],
                ['text', '文本'],
                ['path', '单路径'],
              ] as [CompareMode, string][]
            ).map(([id, label]) => (
              <Chip
                active={props.compareMode === id}
                key={id}
                label={label}
                onPress={() => props.onModeChange(id)}
              />
            ))}
          </View>

          <View style={styles.optionGrid}>
            <ToggleChip
              active={props.compareOptions.ignoreKeyOrder}
              colors={colors}
              label="忽略键顺序"
              onToggle={(value) => updateOption({ ignoreKeyOrder: value })}
            />
            <ToggleChip
              active={props.compareOptions.ignoreEmpty}
              colors={colors}
              label="忽略空值"
              onToggle={(value) => updateOption({ ignoreEmpty: value })}
            />
            <ToggleChip
              active={!props.compareOptions.caseSensitive}
              colors={colors}
              label="忽略大小写"
              onToggle={(value) => updateOption({ caseSensitive: !value })}
            />
            <ToggleChip
              active={props.compareOptions.numericPrecision === 'numeric'}
              colors={colors}
              label="数字忽略尾零"
              onToggle={(value) => updateOption({ numericPrecision: value ? 'numeric' : 'exact' })}
            />
          </View>

          <View style={styles.labelRow}>
            <ThemedText style={[styles.label, { color: colors.mutedText }]}>数组策略</ThemedText>
          </View>
          <View style={styles.segRow}>
            <Chip
              active={props.compareOptions.arrayMode === 'index'}
              label="按索引"
              onPress={() => updateOption({ arrayMode: 'index' })}
            />
            <Chip
              active={props.compareOptions.arrayMode === 'unique'}
              label="按唯一键"
              onPress={() => updateOption({ arrayMode: 'unique' })}
            />
            {props.compareOptions.arrayMode === 'unique' ? (
              <TextInput
                onChangeText={(value) => updateOption({ uniqueKey: value })}
                placeholder="唯一键，如 id"
                placeholderTextColor={colors.mutedText}
                style={[
                  styles.uniqueKeyInput,
                  { backgroundColor: colors.surfaceMuted, borderColor: colors.line, color: colors.text },
                ]}
                value={props.compareOptions.uniqueKey ?? ''}
              />
            ) : null}
          </View>

          {props.compareMode === 'path' ? (
            <TextInput
              autoCapitalize="none"
              onChangeText={props.onPathChange}
              placeholder="单路径，如 version 或 data.items[0].name"
              placeholderTextColor={colors.mutedText}
              style={[
                styles.urlInput,
                { backgroundColor: colors.surfaceMuted, borderColor: colors.line, color: colors.text },
              ]}
              value={props.singlePath}
            />
          ) : null}

          <Pressable onPress={props.onRun} style={[styles.primaryButton, { backgroundColor: colors.primary }]}>
            <MaterialCommunityIcons name="compare" size={16} color="#ffffff" />
            <ThemedText style={styles.primaryButtonText}>开始对比</ThemedText>
          </Pressable>

          {props.compareError ? (
            <View style={[styles.errorBox, { backgroundColor: '#ffecee' }]}>
              <MaterialCommunityIcons name="alert-circle-outline" size={16} color="#c14656" />
              <ThemedText style={styles.errorText}>{props.compareError}</ThemedText>
            </View>
          ) : null}
        </PanelCard>
      </View>

      <View style={props.wide ? styles.wideItem : undefined}>
        <PanelCard
          colors={colors}
          title="对比结果"
          trailing={
            props.compareMode === 'semantic'
              ? `修改 ${props.diffStats.modified} · 新增 ${props.diffStats.added} · 删除 ${props.diffStats.removed}`
              : ''
          }>
          <View style={styles.statRow}>
            <StatChip colors={colors} label="修改" value={props.diffStats.modified} />
            <StatChip colors={colors} label="新增" value={props.diffStats.added} />
            <StatChip colors={colors} label="删除" value={props.diffStats.removed} />
            <StatChip colors={colors} label="无变化" value={props.diffStats.unchanged} />
          </View>

          {props.compareMode === 'text' ? (
            <View style={[styles.diffList, { borderColor: colors.line }]}>
              {props.textDiffLines.slice(0, 120).map((line, index) => (
                <ThemedText
                  key={`${index}-${line.type}`}
                  style={[
                    styles.diffLine,
                    {
                      color: line.type === 'same' ? colors.mutedText : colors.text,
                      backgroundColor:
                        line.type === 'added' ? '#e4f7ee' : line.type === 'removed' ? '#ffecee' : 'transparent',
                    },
                  ]}>
                  {line.text}
                </ThemedText>
              ))}
            </View>
          ) : null}

          {props.compareMode === 'path' ? (
            <CodeOutput colors={colors} text={props.singlePathResult || '选择路径后点击“开始对比”'} />
          ) : null}

          {props.compareMode === 'semantic' ? (
            <View style={[styles.diffList, { borderColor: colors.line }]}>
              {props.diffItems.slice(0, 40).map((item, index) => (
                <View key={`${item.path}-${index}`} style={styles.diffRow}>
                  <View
                    style={[
                      styles.diffType,
                      {
                        backgroundColor:
                          item.type === 'added' ? '#e4f7ee' : item.type === 'removed' ? '#ffecee' : '#fff3e0',
                      },
                    ]}>
                    <ThemedText
                      style={[
                        styles.diffTypeText,
                        {
                          color:
                            item.type === 'added' ? '#147a56' : item.type === 'removed' ? '#c14656' : '#9a6210',
                        },
                      ]}>
                      {item.type === 'added' ? '新增' : item.type === 'removed' ? '删除' : '修改'}
                    </ThemedText>
                  </View>
                  <View style={styles.diffCopy}>
                    <ThemedText numberOfLines={1} style={styles.diffPath}>
                      {item.path}
                    </ThemedText>
                    <ThemedText numberOfLines={1} style={[styles.diffValues, { color: colors.mutedText }]}>
                      {JSON.stringify(item.before ?? null)} → {JSON.stringify(item.after ?? null)}
                    </ThemedText>
                  </View>
                </View>
              ))}
              {props.diffItems.length === 0 ? (
                <ThemedText style={[styles.emptyText, { color: colors.mutedText }]}>
                  点击“开始对比”后在这里查看差异
                </ThemedText>
              ) : null}
            </View>
          ) : null}

          <View style={styles.actionRow}>
            <Pressable
              onPress={props.onCopySummary}
              style={[styles.secondaryButton, { backgroundColor: colors.surfaceMuted }]}>
              <MaterialCommunityIcons name="file-download-outline" size={15} color={colors.text} />
              <ThemedText style={styles.secondaryButtonText}>复制摘要</ThemedText>
            </Pressable>
            <Pressable onPress={props.onMergeAsB} style={[styles.secondaryButton, { backgroundColor: colors.surfaceMuted }]}>
            <MaterialCommunityIcons name="source-merge" size={15} color={colors.text} />
              <ThemedText style={styles.secondaryButtonText}>合并为 B</ThemedText>
            </Pressable>
          </View>

          {props.compareOutput ? <CodeOutput colors={colors} text={props.compareOutput} /> : null}
        </PanelCard>
      </View>
    </View>
  );
}

function HistoryPanel(props: {
  colors: ThemeColors;
  onClear: () => void;
  onDelete: (id: string) => Promise<void>;
  onReplay: (session: WorkbenchSession) => Promise<void>;
  sessions: WorkbenchSession[];
}) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.section}>
      <PanelCard
        colors={colors}
        title="最近会话"
        trailing={
          props.sessions.length > 0 ? (
            <Pressable onPress={props.onClear}>
              <ThemedText style={[styles.clearText, { color: '#c14656' }]}>清空</ThemedText>
            </Pressable>
          ) : undefined
        }>
        {props.sessions.length === 0 ? (
          <ThemedText style={[styles.emptyText, { color: colors.mutedText }]}>
            还没有历史记录，转换或对比会自动保存。
          </ThemedText>
        ) : null}
        {props.sessions.slice(0, 40).map((session) => (
          <View key={session.id} style={[styles.sessionRow, { borderColor: colors.line }]}>
            <View style={[styles.sessionIcon, { backgroundColor: colors.primarySoft }]}>
              <MaterialCommunityIcons
                color={colors.primary}
                name={session.kind === 'convert' ? 'swap-horizontal' : 'compare'}
                size={18}
              />
            </View>
            <View style={styles.sessionCopy}>
              <ThemedText numberOfLines={1} style={styles.sessionTitle}>
                {session.title}
              </ThemedText>
              <ThemedText style={[styles.sessionMeta, { color: colors.mutedText }]}>
                {new Date(session.createdAt).toLocaleString()} · {session.kind === 'convert' ? '转换' : '对比'}
              </ThemedText>
            </View>
            <Pressable
              onPress={() => void props.onReplay(session)}
              style={[styles.sessionAction, { backgroundColor: colors.surfaceMuted }]}>
              <ThemedText style={[styles.sessionActionText, { color: colors.primary }]}>回放</ThemedText>
            </Pressable>
            <Pressable onPress={() => void props.onDelete(session.id)} style={styles.deleteButton}>
              <MaterialCommunityIcons name="delete-outline" size={18} color={colors.mutedText} />
            </Pressable>
          </View>
        ))}
      </PanelCard>
    </View>
  );
}

function TemplatesPanel(props: {
  colors: ThemeColors;
  message: string;
  onApply: (template: WorkbenchTemplate) => void;
  onDelete: (id: string) => Promise<void>;
  templates: WorkbenchTemplate[];
}) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.section}>
      <PanelCard colors={colors} title="我的模板" trailing={props.message}>
        {props.templates.length === 0 ? (
          <ThemedText style={[styles.emptyText, { color: colors.mutedText }]}>
            暂无模板，转换后点击“存模板”即可保存配置。
          </ThemedText>
        ) : null}
        {props.templates.map((template) => (
          <View key={template.id} style={[styles.sessionRow, { borderColor: colors.line }]}>
            <View style={[styles.sessionIcon, { backgroundColor: colors.surfaceMuted }]}>
              <MaterialCommunityIcons color={colors.primary} name="bookmark-outline" size={18} />
            </View>
            <View style={styles.sessionCopy}>
              <ThemedText numberOfLines={1} style={styles.sessionTitle}>
                {template.name}
              </ThemedText>
              <ThemedText style={[styles.sessionMeta, { color: colors.mutedText }]}>
                {new Date(template.createdAt).toLocaleString()}
              </ThemedText>
            </View>
            <Pressable
              onPress={() => props.onApply(template)}
              style={[styles.sessionAction, { backgroundColor: colors.surfaceMuted }]}>
              <ThemedText style={[styles.sessionActionText, { color: colors.primary }]}>使用</ThemedText>
            </Pressable>
            <Pressable onPress={() => void props.onDelete(template.id)} style={styles.deleteButton}>
              <MaterialCommunityIcons name="delete-outline" size={18} color={colors.mutedText} />
            </Pressable>
          </View>
        ))}
      </PanelCard>
    </View>
  );
}

function PanelCard(props: {
  children: ReactNode;
  colors: ThemeColors;
  title: string;
  trailing?: ReactNode;
}) {
  return (
    <View style={[styles.card, { backgroundColor: props.colors.surface, borderColor: props.colors.line }]}>
      <View style={styles.cardHeader}>
        <ThemedText style={styles.cardTitle}>{props.title}</ThemedText>
        {props.trailing ? (
          <ThemedText style={[styles.cardTrailing, { color: props.colors.mutedText }]}>
            {props.trailing}
          </ThemedText>
        ) : null}
      </View>
      <View style={styles.cardBody}>{props.children}</View>
    </View>
  );
}

function Chip(props: { active: boolean; label: string; onPress: () => void }) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: props.active ? colors.primary : colors.surfaceMuted,
          borderColor: props.active ? colors.primary : colors.line,
        },
        pressed && styles.pressed,
      ]}>
      <ThemedText style={[styles.chipText, { color: props.active ? '#ffffff' : colors.text }]}>
        {props.label}
      </ThemedText>
    </Pressable>
  );
}

function ToggleChip(props: {
  active: boolean;
  colors: ThemeColors;
  label: string;
  onToggle: (value: boolean) => void;
}) {
  return (
    <Pressable
      onPress={() => props.onToggle(!props.active)}
      style={[
        styles.toggleChip,
        {
          backgroundColor: props.active ? props.colors.primarySoft : props.colors.surfaceMuted,
          borderColor: props.active ? props.colors.primary : props.colors.line,
        },
      ]}>
      <MaterialCommunityIcons
        color={props.active ? props.colors.primary : props.colors.mutedText}
        name={props.active ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'}
        size={16}
      />
      <ThemedText
        style={[
          styles.toggleText,
          { color: props.active ? props.colors.primary : props.colors.text },
        ]}>
        {props.label}
      </ThemedText>
    </Pressable>
  );
}

function StatChip(props: { colors: ThemeColors; label: string; value: number }) {
  return (
    <View style={[styles.statChip, { backgroundColor: props.colors.surfaceMuted }]}>
      <ThemedText style={[styles.statValue, { color: props.colors.primary }]}>{props.value}</ThemedText>
      <ThemedText style={[styles.statLabel, { color: props.colors.mutedText }]}>{props.label}</ThemedText>
    </View>
  );
}

function CodeInput(props: {
  colors: ThemeColors;
  onChangeText: (text: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <TextInput
      autoCapitalize="none"
      autoCorrect={false}
      multiline
      onChangeText={props.onChangeText}
      placeholder={props.placeholder}
      placeholderTextColor={props.colors.mutedText}
      style={[
        styles.codeInput,
        {
          backgroundColor: props.colors.surfaceMuted,
          borderColor: props.colors.line,
          color: props.colors.text,
        },
      ]}
      textAlignVertical="top"
      value={props.value}
    />
  );
}

function CodeOutput(props: { colors: ThemeColors; text: string }) {
  return (
    <TextInput
      editable={false}
      multiline
      style={[
        styles.codeOutput,
        {
          backgroundColor: props.colors.surfaceMuted,
          borderColor: props.colors.line,
          color: props.colors.text,
        },
      ]}
      textAlignVertical="top"
      value={props.text}
    />
  );
}

const styles = StyleSheet.create({
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  backButton: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    gap: 0,
    overflow: 'hidden',
  },
  cardBody: {
    gap: 10,
    padding: 14,
  },
  cardHeader: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '800',
  },
  cardTrailing: {
    fontSize: 11,
  },
  chip: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 30,
    paddingHorizontal: 11,
  },
  chipText: {
    fontSize: 11,
    fontWeight: '700',
  },
  clearText: {
    fontSize: 12,
    fontWeight: '700',
  },
  codeInput: {
    borderRadius: 14,
    borderWidth: 1,
    fontFamily: 'monospace',
    fontSize: 11,
    lineHeight: 17,
    maxHeight: 180,
    minHeight: 120,
    padding: 10,
  },
  codeOutput: {
    borderRadius: 14,
    borderWidth: 1,
    fontFamily: 'monospace',
    fontSize: 11,
    lineHeight: 17,
    marginTop: 12,
    minHeight: 150,
    padding: 10,
  },
  compareSampleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  content: {
    alignSelf: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingTop: 12,
    width: '100%',
  },
  contentMobile: {
    maxWidth: appLayout.screenMaxWidth,
  },
  contentWide: {
    maxWidth: 1200,
  },
  deleteButton: {
    alignItems: 'center',
    height: 36,
    justifyContent: 'center',
    width: 34,
  },
  diffCopy: {
    flex: 1,
    minWidth: 0,
  },
  diffLine: {
    fontFamily: 'monospace',
    fontSize: 10,
    lineHeight: 16,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  diffList: {
    borderWidth: 1,
    borderRadius: 14,
    marginTop: 10,
    maxHeight: 300,
    overflow: 'hidden',
  },
  diffPath: {
    fontSize: 11,
    fontWeight: '700',
  },
  diffRow: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  diffType: {
    alignItems: 'center',
    borderRadius: 6,
    justifyContent: 'center',
    minHeight: 22,
    minWidth: 38,
    paddingHorizontal: 6,
  },
  diffTypeText: {
    fontSize: 9,
    fontWeight: '900',
  },
  diffValues: {
    fontFamily: 'monospace',
    fontSize: 9.5,
    marginTop: 2,
  },
  dropBody: {
    fontSize: 11,
    marginTop: 2,
  },
  dropTitle: {
    fontSize: 13,
    fontWeight: '800',
    marginTop: 6,
  },
  dropZone: {
    alignItems: 'center',
    borderRadius: 16,
    borderStyle: 'dashed',
    borderWidth: 1,
    padding: 18,
  },
  emptyText: {
    fontSize: 12,
    lineHeight: 18,
    paddingVertical: 8,
  },
  errorBox: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
    padding: 10,
  },
  errorText: {
    color: '#c14656',
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  fetchButton: {
    alignItems: 'center',
    borderRadius: 12,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: 14,
  },
  fetchText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },
  formatGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  headerCopy: {
    flex: 1,
    gap: 3,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
  },
  labelRow: {
    marginTop: 4,
  },
  optionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pressed: {
    opacity: 0.8,
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: 16,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },
  realNote: {
    alignItems: 'center',
    borderRadius: 14,
    flexDirection: 'row',
    gap: 8,
    padding: 12,
  },
  realNoteText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 17,
  },
  safeArea: {
    flex: 1,
  },
  sampleButton: {
    borderRadius: 10,
    flexShrink: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  sampleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  sampleText: {
    fontSize: 11,
    fontWeight: '700',
  },
  scroll: {
    paddingBottom: 36,
  },
  secondaryButton: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minHeight: 38,
    paddingHorizontal: 13,
  },
  secondaryButtonText: {
    fontSize: 11,
    fontWeight: '800',
  },
  section: {
    gap: 14,
  },
  sectionWide: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  segRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  sessionAction: {
    alignItems: 'center',
    borderRadius: 9,
    justifyContent: 'center',
    minHeight: 30,
    paddingHorizontal: 10,
  },
  sessionActionText: {
    fontSize: 10,
    fontWeight: '900',
  },
  sessionCopy: {
    flex: 1,
    minWidth: 0,
  },
  sessionIcon: {
    alignItems: 'center',
    borderRadius: 11,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  sessionMeta: {
    fontSize: 10,
    marginTop: 2,
  },
  sessionRow: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 10,
  },
  sessionTitle: {
    fontSize: 13,
    fontWeight: '800',
  },
  statChip: {
    alignItems: 'center',
    borderRadius: 12,
    flex: 1,
    minWidth: 64,
    paddingVertical: 9,
  },
  statLabel: {
    fontSize: 10,
    marginTop: 2,
  },
  statRow: {
    flexDirection: 'row',
    gap: 8,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '900',
  },
  statsText: {
    fontSize: 10,
    marginTop: 8,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 19,
  },
  tabButton: {
    alignItems: 'center',
    borderRadius: 12,
    flex: 1,
    flexDirection: 'row',
    gap: 5,
    justifyContent: 'center',
    minHeight: 40,
  },
  tabRow: {
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    padding: 4,
  },
  tabText: {
    fontSize: 12,
    fontWeight: '800',
  },
  title: {
    fontSize: 26,
    fontWeight: '900',
    lineHeight: 32,
  },
  toggleChip: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  toggleText: {
    fontSize: 11,
    fontWeight: '700',
  },
  uniqueKeyInput: {
    borderRadius: 10,
    borderWidth: 1,
    fontSize: 11,
    minHeight: 34,
    minWidth: 120,
    paddingHorizontal: 10,
  },
  urlInput: {
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    fontSize: 12,
    minHeight: 42,
    paddingHorizontal: 12,
  },
  urlRow: {
    flexDirection: 'row',
    gap: 8,
  },
  wideItem: {
    flexBasis: 360,
    flexGrow: 1,
    minWidth: 320,
  },
});
