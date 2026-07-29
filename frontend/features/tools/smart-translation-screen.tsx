import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import {
  createInitialTranslationHistory,
  formatHistoryTime,
  getSceneLabel,
  getToneLabel,
  getTranslationLanguageLabel,
  LANGUAGE_OPTIONS,
  MAX_TRANSLATION_LENGTH,
  SAMPLE_TRANSLATION_TEXT,
  SCENE_OPTIONS,
  summarizeSource,
  TARGET_LANGUAGE_OPTIONS,
  TONE_OPTIONS,
  VERSION_OPTIONS,
} from '@/lib/smart-translation';
import { translateText } from '@/lib/translation-api';
import { useAppTheme } from '@/hooks/use-app-theme';
import { MobileScreen } from '@/shared/ui/mobile-screen';
import { PageHeader } from '@/shared/ui/page-header';
import { SurfaceCard } from '@/shared/ui/surface-card';
import type {
  ResolvedTranslationLanguage,
  TranslationDraft,
  TranslationHistoryItem,
  TranslationLanguage,
  TranslationScene,
  TranslationTone,
  TranslationVersionId,
} from '@/types/translation';

const QUICK_TOGGLE_OPTIONS = [
  { key: 'preserveFormat', label: '保留格式' },
  { key: 'bilingual', label: '双语对照' },
  { key: 'prioritizeTerms', label: '术语优先' },
] as const;

export function SmartTranslationToolScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { width } = useWindowDimensions();
  const isWideLayout = width >= 900;
  const [sourceText, setSourceText] = useState(SAMPLE_TRANSLATION_TEXT);
  const [sourceLanguage, setSourceLanguage] = useState<TranslationLanguage>('auto');
  const [targetLanguage, setTargetLanguage] = useState<ResolvedTranslationLanguage>('en');
  const [scene, setScene] = useState<TranslationScene>('business');
  const [tone, setTone] = useState<TranslationTone>('formal');
  const [preserveFormat, setPreserveFormat] = useState(true);
  const [bilingual, setBilingual] = useState(true);
  const [prioritizeTerms, setPrioritizeTerms] = useState(true);
  const [activeVersionId, setActiveVersionId] = useState<TranslationVersionId>('standard');
  const [showExplanation, setShowExplanation] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState('已加载翻译工作台，可以直接开始翻译。');
  const [draft, setDraft] = useState<TranslationDraft | null>(null);
  const [history, setHistory] = useState<TranslationHistoryItem[]>(createInitialTranslationHistory);
  const [currentRecordId, setCurrentRecordId] = useState<string | null>(null);
  const [languagePicker, setLanguagePicker] = useState<'source' | 'target' | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const activeVersion = draft?.versions.find((version) => version.id === activeVersionId) ?? null;
  const currentRecord = history.find((item) => item.id === currentRecordId) ?? null;
  const currentLength = sourceText.trim().length;
  const detectedLanguage =
    sourceLanguage === 'auto' ? draft?.detectedLanguage ?? inferLanguage(sourceText) : sourceLanguage;

  async function handleTranslate(regenerate = false) {
    const trimmed = sourceText.trim();

    if (!trimmed) {
      setStatusMessage('请先输入需要翻译的文本。');
      return;
    }

    if (trimmed.length > MAX_TRANSLATION_LENGTH) {
      setStatusMessage(`当前文本超过 ${MAX_TRANSLATION_LENGTH} 字，请先分段翻译。`);
      return;
    }

    setSubmitting(true);
    setShowExplanation(false);
    setStatusMessage('正在理解语境并生成多版本译文...');

    await wait(250);

    let nextDraft: TranslationDraft;
    try {
      nextDraft = await translateText({
        sourceText: trimmed,
        sourceLanguage,
        targetLanguage,
        scene,
        tone,
        preserveFormat,
        bilingual,
        prioritizeTerms,
      });
    } catch (error) {
      setSubmitting(false);
      setStatusMessage(error instanceof Error ? error.message : '翻译失败，请稍后重试。');
      return;
    }

    const nextRecord: TranslationHistoryItem = {
      id: `translation-${Date.now()}`,
      sourcePreview: summarizeSource(trimmed),
      sourceText: trimmed,
      sourceLanguage,
      targetLanguage,
      scene,
      tone,
      createdAt: new Date().toISOString(),
      favorite: currentRecord?.favorite ?? false,
      draft: nextDraft,
    };

    setDraft(nextDraft);
    setActiveVersionId('standard');
    setCurrentRecordId(nextRecord.id);
    setHistory((previous) => [nextRecord, ...previous.filter((item) => item.id !== currentRecordId)].slice(0, 6));
    setSubmitting(false);
    setStatusMessage(regenerate ? '已基于当前设置重新生成译文。' : '翻译完成，可切换不同版本继续比较。');
  }

  function handleSwapLanguages() {
    setLanguagePicker(null);

    if (sourceLanguage === 'auto') {
      setSourceLanguage(targetLanguage);
      setTargetLanguage((detectedLanguage === 'auto' ? 'zh' : detectedLanguage) as ResolvedTranslationLanguage);
      setStatusMessage('已将自动检测改为当前目标语言，方便继续反向翻译。');
      return;
    }

    setSourceLanguage(targetLanguage);
    setTargetLanguage(sourceLanguage);
    setStatusMessage('已交换源语言和目标语言。');
  }

  function handleClear() {
    setSourceText('');
    setDraft(null);
    setShowExplanation(false);
    setCurrentRecordId(null);
    setStatusMessage('输入区已清空。');
  }

  function handleLoadSample() {
    setSourceText(SAMPLE_TRANSLATION_TEXT);
    setStatusMessage('已填充一段商务邮件示例，可直接体验多版本输出。');
  }

  async function handlePaste() {
    const clipboard = getClipboardApi();

    if (!clipboard?.readText) {
      setStatusMessage('当前平台没有可用的系统剪贴板读取能力。');
      return;
    }

    try {
      const text = await clipboard.readText();

      if (!text.trim()) {
        setStatusMessage('剪贴板为空。');
        return;
      }

      setSourceText(text);
      setStatusMessage('已从剪贴板粘贴文本。');
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '读取剪贴板失败。');
    }
  }

  async function handleCopy() {
    if (!activeVersion?.text) {
      setStatusMessage('当前还没有可复制的译文。');
      return;
    }

    const clipboard = getClipboardApi();

    if (!clipboard?.writeText) {
      if (Platform.OS !== 'web') {
        Alert.alert('当前平台提示', '当前运行环境没有注入系统剪贴板，请长按结果区文本手动复制。');
      }

      setStatusMessage('当前环境不支持按钮直接复制，请长按文本复制。');
      return;
    }

    try {
      await clipboard.writeText(activeVersion.text);
      setStatusMessage('译文已复制到剪贴板。');
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '复制失败。');
    }
  }

  function handleToggleFavorite(recordId: string | null) {
    if (!recordId) {
      setStatusMessage('请先生成一条翻译结果，再执行收藏。');
      return;
    }

    setHistory((previous) =>
      previous.map((item) => (item.id === recordId ? { ...item, favorite: !item.favorite } : item))
    );
    setStatusMessage('已更新收藏状态。');
  }

  function handleReuseHistory(record: TranslationHistoryItem) {
    setSourceText(record.sourceText);
    setSourceLanguage(record.sourceLanguage);
    setTargetLanguage(record.targetLanguage);
    setScene(record.scene);
    setTone(record.tone);
    setDraft(record.draft);
    setActiveVersionId('standard');
    setShowExplanation(false);
    setCurrentRecordId(record.id);
    setShowHistory(false);
    setStatusMessage('已加载历史翻译记录，可继续修改后重新生成。');
  }

  function handleDeleteHistory(recordId: string) {
    setHistory((previous) => previous.filter((item) => item.id !== recordId));

    if (currentRecordId === recordId) {
      setCurrentRecordId(null);
    }

    setStatusMessage('已删除该条历史记录。');
  }

  return (
    <MobileScreen contentContainerStyle={styles.pageContent}>
      <PageHeader
        title="智能翻译"
        subtitle={`${getTranslationLanguageLabel(detectedLanguage)} → ${getTranslationLanguageLabel(
          targetLanguage
        )} · ${getSceneLabel(scene)} · ${getToneLabel(tone)}`}
        rightSlot={
          <View style={styles.headerActions}>
            <ToolIconButton
              accessibilityLabel={`历史记录，共 ${history.length} 条`}
              icon="history"
              onPress={() => setShowHistory(true)}
            />
            <ToolIconButton accessibilityLabel="返回" icon="arrow-left" onPress={() => router.back()} />
          </View>
        }
      />

      <View
        style={[
          styles.languageBar,
          isWideLayout ? styles.languageBarWide : styles.languageBarStacked,
          { backgroundColor: colors.surface, borderColor: colors.line },
        ]}>
        <View style={styles.languageControls}>
          <LanguageButton
            expanded={languagePicker === 'source'}
            label="源语言"
            value={getTranslationLanguageLabel(sourceLanguage)}
            onPress={() => setLanguagePicker((current) => (current === 'source' ? null : 'source'))}
          />
          <ToolIconButton accessibilityLabel="交换语言" icon="swap-horizontal" onPress={handleSwapLanguages} />
          <LanguageButton
            expanded={languagePicker === 'target'}
            label="目标语言"
            value={getTranslationLanguageLabel(targetLanguage)}
            onPress={() => setLanguagePicker((current) => (current === 'target' ? null : 'target'))}
          />
        </View>

        <Pressable
          accessibilityLabel="打开翻译偏好"
          accessibilityRole="button"
          onPress={() => setShowSettings(true)}
          style={[styles.settingsSummary, { borderColor: colors.line, backgroundColor: colors.surfaceMuted }]}>
          <MaterialCommunityIcons name="tune-variant" size={18} color={colors.accent} />
          <View style={styles.settingsSummaryCopy}>
            <ThemedText style={styles.settingsSummaryTitle}>翻译偏好</ThemedText>
            <ThemedText style={[styles.settingsSummaryMeta, { color: colors.mutedText }]} numberOfLines={1}>
              {getSceneLabel(scene)} · {getToneLabel(tone)}
            </ThemedText>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={18} color={colors.mutedText} />
        </Pressable>
      </View>

      {languagePicker ? (
        <View style={[styles.languageMenu, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <View style={styles.languageMenuHeader}>
            <ThemedText style={styles.languageMenuTitle}>
              {languagePicker === 'source' ? '选择源语言' : '选择目标语言'}
            </ThemedText>
            <ToolIconButton accessibilityLabel="关闭语言选择" icon="close" onPress={() => setLanguagePicker(null)} />
          </View>
          <View style={styles.wrapRow}>
            {(languagePicker === 'source' ? LANGUAGE_OPTIONS : TARGET_LANGUAGE_OPTIONS).map((language) => (
              <SelectorChip
                key={language.id}
                label={language.label}
                selected={
                  languagePicker === 'source'
                    ? sourceLanguage === language.id
                    : targetLanguage === language.id
                }
                onPress={() => {
                  if (languagePicker === 'source') {
                    setSourceLanguage(language.id as TranslationLanguage);
                  } else {
                    setTargetLanguage(language.id as ResolvedTranslationLanguage);
                  }
                  setLanguagePicker(null);
                }}
              />
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.statusLine}>
        <MaterialCommunityIcons
          name={draft ? 'check-circle-outline' : 'circle-slice-8'}
          size={16}
          color={draft ? colors.success : colors.accent}
        />
        <ThemedText style={[styles.statusText, { color: colors.mutedText }]}>{statusMessage}</ThemedText>
      </View>

      <View style={[styles.workspaceGrid, isWideLayout ? styles.workspaceGridWide : styles.workspaceGridStacked]}>
        <SurfaceCard
          style={[
            styles.workspacePanel,
            isWideLayout ? styles.workspacePanelWide : null,
            { borderTopColor: colors.primary },
          ]}>
          <View style={styles.panelHeader}>
            <View style={styles.panelTitleRow}>
              <View style={[styles.panelIcon, { backgroundColor: colors.primarySoft }]}>
                <MaterialCommunityIcons name="text-box-edit-outline" size={19} color={colors.primary} />
              </View>
              <ThemedText style={styles.panelTitle}>原文</ThemedText>
            </View>
            <ThemedText style={[styles.panelMeta, { color: colors.mutedText }]}>
              {currentLength}/{MAX_TRANSLATION_LENGTH}
            </ThemedText>
          </View>

          <TextInput
            accessibilityLabel="原文输入"
            multiline
            onChangeText={setSourceText}
            placeholder="输入或粘贴需要翻译的文本"
            placeholderTextColor={colors.mutedText}
            style={[
              styles.input,
              { backgroundColor: colors.background, borderColor: colors.line, color: colors.text },
            ]}
            textAlignVertical="top"
            value={sourceText}
          />

          <View style={styles.actionRow}>
            <ActionButton icon="content-paste" label="粘贴" onPress={handlePaste} />
            <ActionButton icon="lightbulb-on-outline" label="示例" onPress={handleLoadSample} />
            <ActionButton icon="delete-outline" label="清空" onPress={handleClear} />
          </View>

          <View style={styles.detectLine}>
            <MaterialCommunityIcons name="auto-fix" size={16} color={colors.success} />
            <ThemedText style={[styles.detectText, { color: colors.mutedText }]}>
              {getTranslationLanguageLabel(detectedLanguage)} · {getSceneLabel(scene)} · {getToneLabel(tone)}
            </ThemedText>
          </View>

          <Pressable
            accessibilityLabel="开始翻译"
            accessibilityRole="button"
            disabled={submitting}
            onPress={() => void handleTranslate(false)}
            style={[styles.primaryButton, { backgroundColor: colors.accent, opacity: submitting ? 0.72 : 1 }]}>
            {submitting ? (
              <ActivityIndicator color={colors.hero} />
            ) : (
              <>
                <MaterialCommunityIcons name="translate" size={19} color={colors.hero} />
                <ThemedText style={[styles.primaryButtonText, { color: colors.hero }]}>开始翻译</ThemedText>
              </>
            )}
          </Pressable>
        </SurfaceCard>

        <SurfaceCard
          style={[
            styles.workspacePanel,
            isWideLayout ? styles.workspacePanelWide : null,
            { borderTopColor: colors.success },
          ]}>
          <View style={styles.panelHeader}>
            <View style={styles.panelTitleRow}>
              <View style={[styles.panelIcon, { backgroundColor: 'rgba(124,200,171,0.14)' }]}>
                <MaterialCommunityIcons name="text-box-check-outline" size={19} color={colors.success} />
              </View>
              <ThemedText style={styles.panelTitle}>译文</ThemedText>
            </View>
            <ThemedText style={[styles.panelMeta, { color: draft ? colors.success : colors.mutedText }]}>
              {draft ? '已生成' : '等待输入'}
            </ThemedText>
          </View>

          {submitting ? (
            <View style={styles.loadingState}>
              <ActivityIndicator color={colors.primary} />
              <ThemedText style={[styles.loadingTitle, { color: colors.mutedText }]}>正在生成多版本译文</ThemedText>
              <View style={[styles.skeleton, { backgroundColor: colors.surfaceMuted }]} />
              <View style={[styles.skeletonShort, { backgroundColor: colors.surfaceMuted }]} />
              <View style={[styles.skeletonTall, { backgroundColor: colors.surfaceMuted }]} />
            </View>
          ) : null}

          {!submitting && !draft ? (
            <View style={styles.emptyState}>
              <View style={[styles.emptyIcon, { backgroundColor: colors.surfaceMuted }]}>
                <MaterialCommunityIcons name="translate" size={28} color={colors.mutedText} />
              </View>
              <ThemedText style={styles.emptyTitle}>译文将在这里显示</ThemedText>
              <ThemedText style={[styles.emptyBody, { color: colors.mutedText }]}>
                {getTranslationLanguageLabel(targetLanguage)} · {getSceneLabel(scene)} · {getToneLabel(tone)}
              </ThemedText>
            </View>
          ) : null}

          {!submitting && draft ? (
            <>
              <View style={[styles.versionRow, { backgroundColor: colors.surfaceMuted }]}>
                {VERSION_OPTIONS.map((version) => (
                  <Pressable
                    accessibilityRole="button"
                    key={version.id}
                    onPress={() => setActiveVersionId(version.id)}
                    style={[
                      styles.versionChip,
                      {
                        backgroundColor: activeVersionId === version.id ? colors.surface : 'transparent',
                        borderColor: activeVersionId === version.id ? colors.line : 'transparent',
                      },
                    ]}>
                    <ThemedText
                      style={[
                        styles.versionTitle,
                        { color: activeVersionId === version.id ? colors.text : colors.mutedText },
                      ]}>
                      {version.label}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>

              {bilingual ? (
                <View style={[styles.parallelBlock, isWideLayout ? styles.parallelBlockWide : null]}>
                  <View
                    style={[
                      styles.parallelColumn,
                      isWideLayout ? styles.parallelColumnWide : null,
                      { borderColor: colors.line },
                    ]}>
                    <ThemedText style={[styles.parallelLabel, { color: colors.mutedText }]}>原文</ThemedText>
                    <ThemedText style={[styles.parallelText, { color: colors.mutedText }]}>{sourceText.trim()}</ThemedText>
                  </View>
                  <View
                    style={[
                      styles.parallelColumn,
                      isWideLayout ? styles.parallelColumnWide : null,
                      { borderColor: colors.line },
                    ]}>
                    <ThemedText style={[styles.parallelLabel, { color: colors.success }]}>译文</ThemedText>
                    <ThemedText style={styles.parallelText}>{activeVersion?.text}</ThemedText>
                  </View>
                </View>
              ) : (
                <View style={[styles.translationCard, { borderColor: colors.line }]}>
                  <ThemedText style={styles.translationText}>{activeVersion?.text}</ThemedText>
                </View>
              )}

              <View style={styles.actionRow}>
                <ActionButton icon="content-copy" label="复制" onPress={handleCopy} />
                <ActionButton
                  icon={currentRecord?.favorite ? 'star' : 'star-outline'}
                  label={currentRecord?.favorite ? '已收藏' : '收藏'}
                  onPress={() => handleToggleFavorite(currentRecordId)}
                />
                <ActionButton icon="refresh" label="重新生成" onPress={() => void handleTranslate(true)} />
                <ActionButton
                  icon={showExplanation ? 'chevron-up' : 'chevron-down'}
                  label={showExplanation ? '收起解释' : '翻译解释'}
                  onPress={() => setShowExplanation((value) => !value)}
                />
              </View>

              {showExplanation ? (
                <View style={[styles.explanationSection, { borderTopColor: colors.line }]}>
                  <ThemedText style={styles.explanationTitle}>翻译解释</ThemedText>
                  {draft.explanation.rationale.map((item) => (
                    <ThemedText key={item} style={[styles.explanationText, { color: colors.mutedText }]}>
                      • {item}
                    </ThemedText>
                  ))}

                  {draft.explanation.terminology.length ? (
                    <View style={styles.glossaryBlock}>
                      <ThemedText style={styles.glossaryTitle}>术语提示</ThemedText>
                      {draft.explanation.terminology.map((item) => (
                        <View key={`${item.source}-${item.target}`} style={styles.glossaryItem}>
                          <ThemedText style={styles.glossaryPair}>
                            {item.source} → {item.target}
                          </ThemedText>
                          <ThemedText style={[styles.glossaryReason, { color: colors.mutedText }]}>
                            {item.reason}
                          </ThemedText>
                        </View>
                      ))}
                    </View>
                  ) : null}

                  <View style={styles.glossaryBlock}>
                    <ThemedText style={styles.glossaryTitle}>版本建议</ThemedText>
                    {draft.explanation.alternatives.map((item) => (
                      <ThemedText key={item} style={[styles.explanationText, { color: colors.mutedText }]}>
                        • {item}
                      </ThemedText>
                    ))}
                  </View>
                </View>
              ) : null}
            </>
          ) : null}
        </SurfaceCard>
      </View>

      <Modal
        animationType="slide"
        onRequestClose={() => setShowSettings(false)}
        transparent
        visible={showSettings}>
        <View style={styles.modalRoot}>
          <Pressable
            accessibilityLabel="关闭翻译偏好"
            accessibilityRole="button"
            onPress={() => setShowSettings(false)}
            style={styles.modalBackdrop}
          />
          <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <View style={styles.sheetHeader}>
              <View style={styles.sheetHeaderCopy}>
                <ThemedText style={styles.sheetTitle}>翻译偏好</ThemedText>
                <ThemedText style={[styles.sheetMeta, { color: colors.mutedText }]}>
                  {getSceneLabel(scene)} · {getToneLabel(tone)}
                </ThemedText>
              </View>
              <ToolIconButton accessibilityLabel="关闭" icon="close" onPress={() => setShowSettings(false)} />
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheetContent}>
              <View style={styles.settingBlock}>
                <ThemedText style={styles.settingTitle}>翻译场景</ThemedText>
                <View style={styles.wrapRow}>
                  {SCENE_OPTIONS.map((item) => (
                    <SelectorChip
                      key={item.id}
                      label={item.label}
                      selected={scene === item.id}
                      onPress={() => setScene(item.id)}
                    />
                  ))}
                </View>
              </View>

              <View style={styles.settingBlock}>
                <ThemedText style={styles.settingTitle}>表达风格</ThemedText>
                <View style={styles.wrapRow}>
                  {TONE_OPTIONS.map((item) => (
                    <SelectorChip
                      key={item.id}
                      label={item.label}
                      selected={tone === item.id}
                      onPress={() => setTone(item.id)}
                    />
                  ))}
                </View>
              </View>

              <View style={[styles.toggleList, { borderTopColor: colors.line }]}>
                {QUICK_TOGGLE_OPTIONS.map((option) => (
                  <ToggleRow
                    key={option.key}
                    label={option.label}
                    value={
                      option.key === 'preserveFormat'
                        ? preserveFormat
                        : option.key === 'bilingual'
                          ? bilingual
                          : prioritizeTerms
                    }
                    onPress={() => {
                      if (option.key === 'preserveFormat') setPreserveFormat((value) => !value);
                      if (option.key === 'bilingual') setBilingual((value) => !value);
                      if (option.key === 'prioritizeTerms') setPrioritizeTerms((value) => !value);
                    }}
                  />
                ))}
              </View>
            </ScrollView>

            <Pressable
              accessibilityRole="button"
              onPress={() => setShowSettings(false)}
              style={[styles.sheetPrimaryButton, { backgroundColor: colors.primary }]}>
              <MaterialCommunityIcons name="check" size={18} color={colors.hero} />
              <ThemedText style={[styles.sheetPrimaryButtonText, { color: colors.hero }]}>应用设置</ThemedText>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="slide"
        onRequestClose={() => setShowHistory(false)}
        transparent
        visible={showHistory}>
        <View style={styles.modalRoot}>
          <Pressable
            accessibilityLabel="关闭历史记录"
            accessibilityRole="button"
            onPress={() => setShowHistory(false)}
            style={styles.modalBackdrop}
          />
          <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <View style={styles.sheetHeader}>
              <View style={styles.sheetHeaderCopy}>
                <ThemedText style={styles.sheetTitle}>历史记录</ThemedText>
                <ThemedText style={[styles.sheetMeta, { color: colors.mutedText }]}>{history.length} 条</ThemedText>
              </View>
              <ToolIconButton accessibilityLabel="关闭" icon="close" onPress={() => setShowHistory(false)} />
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.historyList}>
              {history.map((item) => (
                <View key={item.id} style={[styles.historyRow, { borderTopColor: colors.line }]}>
                  <Pressable
                    accessibilityLabel={`加载历史翻译：${item.sourcePreview}`}
                    accessibilityRole="button"
                    onPress={() => handleReuseHistory(item)}
                    style={styles.historyMain}>
                    <View style={styles.historyCopy}>
                      <ThemedText style={styles.historyTitle} numberOfLines={2}>
                        {item.sourcePreview}
                      </ThemedText>
                      <ThemedText style={[styles.historyMeta, { color: colors.mutedText }]}>
                        {getTranslationLanguageLabel(item.draft.detectedLanguage)} →{' '}
                        {getTranslationLanguageLabel(item.targetLanguage)} · {getSceneLabel(item.scene)} ·{' '}
                        {formatHistoryTime(item.createdAt)}
                      </ThemedText>
                    </View>
                    <MaterialCommunityIcons name="chevron-right" size={20} color={colors.mutedText} />
                  </Pressable>
                  <View style={styles.historyActions}>
                    <ToolIconButton
                      accessibilityLabel={item.favorite ? '取消收藏' : '收藏'}
                      icon={item.favorite ? 'star' : 'star-outline'}
                      onPress={() => handleToggleFavorite(item.id)}
                      tone={item.favorite ? colors.accent : colors.primary}
                    />
                    <ToolIconButton
                      accessibilityLabel="删除"
                      icon="trash-can-outline"
                      onPress={() => handleDeleteHistory(item.id)}
                      tone="#e98888"
                    />
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </MobileScreen>
  );
}

type SelectorChipProps = {
  label: string;
  selected: boolean;
  onPress: () => void;
};

function SelectorChip({ label, selected, onPress }: SelectorChipProps) {
  const { colors } = useAppTheme();

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[
        styles.selectorChip,
        {
          backgroundColor: selected ? colors.primarySoft : colors.surface,
          borderColor: selected ? colors.primary : colors.line,
        },
      ]}>
      <ThemedText style={{ color: selected ? colors.primary : colors.text, fontWeight: '700' }}>{label}</ThemedText>
    </Pressable>
  );
}

type LanguageButtonProps = {
  expanded: boolean;
  label: string;
  value: string;
  onPress: () => void;
};

function LanguageButton({ expanded, label, value, onPress }: LanguageButtonProps) {
  const { colors } = useAppTheme();

  return (
    <Pressable
      accessibilityLabel={`${label}：${value}`}
      accessibilityRole="button"
      onPress={onPress}
      style={[
        styles.languageButton,
        {
          backgroundColor: expanded ? colors.primarySoft : colors.surface,
          borderColor: expanded ? colors.primary : colors.line,
        },
      ]}>
      <View style={styles.languageButtonCopy}>
        <ThemedText style={[styles.languageButtonLabel, { color: colors.mutedText }]}>{label}</ThemedText>
        <ThemedText style={[styles.languageButtonValue, { color: expanded ? colors.primary : colors.text }]}>
          {value}
        </ThemedText>
      </View>
      <MaterialCommunityIcons
        name={expanded ? 'chevron-up' : 'chevron-down'}
        size={18}
        color={expanded ? colors.primary : colors.mutedText}
      />
    </Pressable>
  );
}

type ToggleRowProps = {
  label: string;
  value: boolean;
  onPress: () => void;
};

function ToggleRow({ label, value, onPress }: ToggleRowProps) {
  const { colors } = useAppTheme();

  return (
    <Pressable
      accessibilityLabel={`${label}：${value ? '已开启' : '未开启'}`}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: value }}
      onPress={onPress}
      style={styles.toggleRow}>
      <ThemedText style={styles.toggleRowLabel}>{label}</ThemedText>
      <View
        style={[
          styles.toggleTrack,
          { backgroundColor: value ? colors.primary : colors.surfaceMuted, borderColor: value ? colors.primary : colors.line },
        ]}>
        <View
          style={[
            styles.toggleThumb,
            { alignSelf: value ? 'flex-end' : 'flex-start', backgroundColor: value ? colors.hero : colors.mutedText },
          ]}
        />
      </View>
    </Pressable>
  );
}

type ToolIconButtonProps = {
  accessibilityLabel: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  onPress: () => void;
  tone?: string;
};

function ToolIconButton({ accessibilityLabel, icon, onPress, tone }: ToolIconButtonProps) {
  const { colors } = useAppTheme();

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      hitSlop={6}
      onPress={onPress}
      style={[styles.iconButton, { backgroundColor: colors.surfaceMuted, borderColor: colors.line }]}>
      <MaterialCommunityIcons name={icon} size={19} color={tone ?? colors.primary} />
    </Pressable>
  );
}

type ActionButtonProps = {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  onPress: () => void;
};

function ActionButton({ icon, label, onPress }: ActionButtonProps) {
  const { colors } = useAppTheme();

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.actionButton, { borderColor: colors.line }]}>
      <MaterialCommunityIcons name={icon} size={16} color={colors.primary} />
      <ThemedText style={[styles.actionButtonText, { color: colors.text }]}>{label}</ThemedText>
    </Pressable>
  );
}

function inferLanguage(text: string): ResolvedTranslationLanguage | 'auto' {
  const trimmed = text.trim();

  if (!trimmed) {
    return 'auto';
  }

  if (/[\u4e00-\u9fff]/.test(trimmed)) {
    return 'zh';
  }

  if (/[ぁ-んァ-ヶ]/.test(trimmed)) {
    return 'ja';
  }

  if (/[가-힣]/.test(trimmed)) {
    return 'ko';
  }

  return 'en';
}

function getClipboardApi() {
  if (typeof globalThis === 'undefined') {
    return null;
  }

  const maybeNavigator = (globalThis as { navigator?: { clipboard?: ClipboardLike } }).navigator;
  return maybeNavigator?.clipboard ?? null;
}

function wait(duration: number) {
  return new Promise((resolve) => setTimeout(resolve, duration));
}

type ClipboardLike = {
  readText?: () => Promise<string>;
  writeText?: (text: string) => Promise<void>;
};

const styles = StyleSheet.create({
  pageContent: {
    gap: 14,
    maxWidth: 1180,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  languageBar: {
    borderRadius: 18,
    borderWidth: 1,
    gap: 10,
    padding: 10,
  },
  languageBarWide: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  languageBarStacked: {
    flexDirection: 'column',
  },
  languageControls: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    minWidth: 0,
  },
  languageButton: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
    minHeight: 58,
    minWidth: 0,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  languageButtonCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  languageButtonLabel: {
    fontSize: 11,
    lineHeight: 15,
  },
  languageButtonValue: {
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 20,
  },
  settingsSummary: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  settingsSummaryCopy: {
    flex: 1,
    gap: 1,
    minWidth: 0,
  },
  settingsSummaryTitle: {
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
  },
  settingsSummaryMeta: {
    fontSize: 11,
    lineHeight: 16,
  },
  languageMenu: {
    borderRadius: 16,
    borderWidth: 1,
    gap: 14,
    padding: 16,
  },
  languageMenuHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  languageMenuTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  selectorChip: {
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 38,
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  statusLine: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
    minHeight: 20,
    paddingHorizontal: 2,
  },
  statusText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
  workspaceGrid: {
    gap: 14,
    width: '100%',
  },
  workspaceGridWide: {
    alignItems: 'stretch',
    flexDirection: 'row',
  },
  workspaceGridStacked: {
    flexDirection: 'column',
  },
  workspacePanel: {
    borderRadius: 20,
    borderTopWidth: 3,
    gap: 14,
    minWidth: 0,
    padding: 20,
  },
  workspacePanelWide: {
    flex: 1,
    minHeight: 560,
  },
  panelHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 34,
  },
  panelTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 9,
  },
  panelIcon: {
    alignItems: 'center',
    borderRadius: 8,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  panelTitle: {
    fontSize: 17,
    fontWeight: '800',
    lineHeight: 22,
  },
  panelMeta: {
    fontSize: 12,
    fontWeight: '700',
  },
  input: {
    borderRadius: 14,
    borderWidth: 1,
    fontSize: 16,
    lineHeight: 25,
    minHeight: 210,
    paddingHorizontal: 16,
    paddingVertical: 15,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  actionButton: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 7,
    minHeight: 38,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  actionButtonText: {
    fontSize: 13,
    fontWeight: '700',
  },
  detectLine: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
    minHeight: 18,
  },
  detectText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '800',
  },
  loadingState: {
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 22,
  },
  loadingTitle: {
    fontSize: 14,
  },
  skeleton: {
    borderRadius: 6,
    height: 14,
    width: '82%',
  },
  skeletonShort: {
    borderRadius: 6,
    height: 14,
    width: '56%',
  },
  skeletonTall: {
    borderRadius: 10,
    height: 120,
    width: '100%',
  },
  emptyState: {
    alignItems: 'center',
    gap: 8,
    justifyContent: 'center',
    minHeight: 270,
    padding: 24,
  },
  emptyIcon: {
    alignItems: 'center',
    borderRadius: 10,
    height: 52,
    justifyContent: 'center',
    marginBottom: 4,
    width: 52,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  emptyBody: {
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  versionRow: {
    borderRadius: 10,
    flexDirection: 'row',
    gap: 4,
    padding: 4,
  },
  versionChip: {
    alignItems: 'center',
    borderRadius: 7,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 38,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  versionTitle: {
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
  },
  translationCard: {
    borderRadius: 12,
    borderWidth: 1,
    minHeight: 244,
    padding: 18,
  },
  translationText: {
    fontSize: 16,
    lineHeight: 26,
  },
  parallelBlock: {
    gap: 10,
  },
  parallelBlockWide: {
    flexDirection: 'row',
  },
  parallelColumn: {
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
    minHeight: 190,
    minWidth: 0,
    padding: 16,
  },
  parallelColumnWide: {
    flex: 1,
  },
  parallelLabel: {
    fontSize: 12,
    fontWeight: '800',
  },
  parallelText: {
    fontSize: 15,
    lineHeight: 24,
  },
  explanationSection: {
    borderTopWidth: 1,
    gap: 10,
    paddingTop: 16,
  },
  explanationTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  explanationText: {
    fontSize: 13,
    lineHeight: 20,
  },
  glossaryBlock: {
    gap: 8,
    marginTop: 4,
  },
  glossaryTitle: {
    fontSize: 14,
    fontWeight: '800',
  },
  glossaryItem: {
    gap: 4,
  },
  glossaryPair: {
    fontSize: 13,
    fontWeight: '700',
  },
  glossaryReason: {
    fontSize: 12,
    lineHeight: 18,
  },
  modalRoot: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.58)',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    gap: 16,
    maxHeight: '88%',
    maxWidth: 640,
    paddingBottom: 20,
    paddingHorizontal: 20,
    paddingTop: 18,
    width: '100%',
  },
  sheetHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  sheetHeaderCopy: {
    flex: 1,
    gap: 2,
  },
  sheetTitle: {
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 26,
  },
  sheetMeta: {
    fontSize: 12,
    lineHeight: 18,
  },
  sheetContent: {
    gap: 22,
    paddingBottom: 4,
  },
  settingBlock: {
    gap: 10,
  },
  settingTitle: {
    fontSize: 14,
    fontWeight: '800',
  },
  wrapRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  toggleList: {
    borderTopWidth: 1,
  },
  toggleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 52,
  },
  toggleRowLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
  },
  toggleTrack: {
    borderRadius: 12,
    borderWidth: 1,
    height: 24,
    justifyContent: 'center',
    paddingHorizontal: 2,
    width: 42,
  },
  toggleThumb: {
    borderRadius: 9,
    height: 18,
    width: 18,
  },
  sheetPrimaryButton: {
    alignItems: 'center',
    borderRadius: 10,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 48,
  },
  sheetPrimaryButtonText: {
    fontSize: 14,
    fontWeight: '800',
  },
  historyList: {
    paddingBottom: 8,
  },
  historyRow: {
    alignItems: 'center',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 82,
    paddingVertical: 12,
  },
  historyMain: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    minWidth: 0,
  },
  historyCopy: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  historyTitle: {
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 20,
  },
  historyMeta: {
    fontSize: 11,
    lineHeight: 18,
  },
  historyActions: {
    flexDirection: 'row',
    gap: 6,
  },
});
