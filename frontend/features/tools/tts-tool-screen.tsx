import { useState } from 'react';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { DEFAULT_TTS_VOICE, TTS_VOICE_GROUPS, TTS_VOICE_OPTIONS } from '@/constants/tts-voices';
import { useAppTheme } from '@/hooks/use-app-theme';
import { getVoiceServerUrl, isVoiceServerLocked, synthesizeSpeech } from '@/lib/tts';
import { MobileScreen } from '@/shared/ui/mobile-screen';
import { PageHeader } from '@/shared/ui/page-header';
import { SurfaceCard } from '@/shared/ui/surface-card';
import { TTS_ENCODINGS, type SynthesisResult, type TTSEncoding } from '@/types/tts';

const TONE_PRESETS = [
  {
    label: '自然亲切',
    prompt: '请用自然、亲切、像朋友交流一样的语气播报。',
  },
  {
    label: '沉稳专业',
    prompt: '请用沉稳、克制、专业可信的语气播报。',
  },
  {
    label: '轻快有活力',
    prompt: '请用轻快、有活力、节奏明朗的语气播报。',
  },
  {
    label: '舒缓叙述',
    prompt: '请用舒缓、温柔、留有呼吸感的语气叙述。',
  },
] as const;

const MAX_TEXT_LENGTH = 5000;

export function TextToSpeechToolScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const [serverUrl, setServerUrl] = useState(getVoiceServerUrl());
  const [voiceType, setVoiceType] = useState(DEFAULT_TTS_VOICE);
  const [encoding, setEncoding] = useState<TTSEncoding>('wav');
  const [contextText, setContextText] = useState<string>(TONE_PRESETS[0].prompt);
  const [text, setText] = useState('欢迎来到 FunBox，这里可以把内容工具和轻量能力统一装进移动端。');
  const [useTagParser, setUseTagParser] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [resultDetailsOpen, setResultDetailsOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState('等待生成');
  const [errorMessage, setErrorMessage] = useState('');
  const [result, setResult] = useState<SynthesisResult | null>(null);

  const selectedVoice =
    TTS_VOICE_OPTIONS.find((voice) => voice.value === voiceType) ?? TTS_VOICE_OPTIONS[0];
  const selectedPreset = TONE_PRESETS.find((preset) => preset.prompt === contextText)?.label;
  const trimmedText = text.trim();

  async function handleSubmit() {
    const trimmedServerUrl = serverUrl.trim();

    if (!trimmedText) {
      setErrorMessage('请先输入需要转换的文本。');
      setStatus('缺少文本');
      return;
    }

    if (!trimmedServerUrl) {
      setAdvancedOpen(true);
      setErrorMessage('请在高级设置中填写语音服务地址。');
      setStatus('缺少服务地址');
      return;
    }

    setSubmitting(true);
    setStatus('正在生成音频...');
    setErrorMessage('');
    setResult(null);

    try {
      const synthesisResult = await synthesizeSpeech(
        {
          context_text: contextText,
          encoding,
          text: trimmedText,
          use_tag_parser: useTagParser,
          voice_type: voiceType,
        },
        trimmedServerUrl
      );

      setResult(synthesisResult);
      setResultDetailsOpen(false);
      setStatus('生成完成');
    } catch (error) {
      const message = error instanceof Error ? error.message : '生成失败';
      setErrorMessage(message);
      setStatus('生成失败');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <MobileScreen contentContainerStyle={styles.screenContent}>
        <PageHeader
          title="文字转语音"
          subtitle="让每段文字，都更接近你想要的声音。"
          rightSlot={
            <Pressable
              accessibilityLabel="返回"
              accessibilityRole="button"
              onPress={() => router.back()}
              style={styles.iconButton}>
              <MaterialCommunityIcons name="arrow-left" size={21} color={colors.text} />
            </Pressable>
          }
        />

        <View style={[styles.voiceStage, { backgroundColor: colors.hero }]}>
          <StepHeading inverse number="01" title="选择音色" />
          <Pressable
            accessibilityHint="打开全部音色列表"
            accessibilityRole="button"
            onPress={() => setPickerVisible(true)}
            style={styles.voiceSelector}>
            <View style={styles.voiceIcon}>
              <MaterialCommunityIcons name="account-voice" size={28} color="#ffffff" />
            </View>
            <View style={styles.voiceCopy}>
              <ThemedText style={styles.voiceName}>{selectedVoice.label}</ThemedText>
              <ThemedText style={styles.voiceMeta}>
                {selectedVoice.group} · {selectedVoice.language}
              </ThemedText>
              <ThemedText numberOfLines={2} style={styles.voiceCapability}>
                {selectedVoice.capabilities}
              </ThemedText>
            </View>
            <View style={styles.voiceChevron}>
              <MaterialCommunityIcons name="chevron-right" size={22} color="#ffffff" />
            </View>
          </Pressable>
        </View>

        <SurfaceCard style={styles.editorCard}>
          <View style={styles.editorSection}>
            <StepHeading number="02" title="设定语气" />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.presetRow}>
              {TONE_PRESETS.map((preset) => {
                const selected = preset.label === selectedPreset;

                return (
                  <Pressable
                    accessibilityRole="button"
                    key={preset.label}
                    onPress={() => setContextText(preset.prompt)}
                    style={[
                      styles.presetChip,
                      {
                        backgroundColor: selected ? colors.primarySoft : colors.surface,
                        borderColor: selected ? colors.primary : colors.line,
                      },
                    ]}>
                    {selected ? (
                      <MaterialCommunityIcons name="check" size={15} color={colors.primary} />
                    ) : null}
                    <ThemedText
                      style={[
                        styles.presetText,
                        { color: selected ? colors.primary : colors.text },
                      ]}>
                      {preset.label}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </ScrollView>
            <TextInput
              accessibilityLabel="语气提示词"
              multiline
              onChangeText={setContextText}
              placeholder="描述语速、情绪或表达方式"
              placeholderTextColor={colors.mutedText}
              selectionColor={colors.primary}
              style={[
                styles.toneInput,
                {
                  backgroundColor: colors.surfaceMuted,
                  color: colors.text,
                },
              ]}
              textAlignVertical="top"
              value={contextText}
            />
          </View>

          <View style={[styles.sectionDivider, { backgroundColor: colors.line }]} />

          <View style={styles.editorSection}>
            <StepHeading meta={`${text.length} / ${MAX_TEXT_LENGTH}`} number="03" title="输入文本" />
            <TextInput
              accessibilityLabel="需要转换的文本"
              maxLength={MAX_TEXT_LENGTH}
              multiline
              onChangeText={setText}
              placeholder="在这里输入要转换为语音的内容"
              placeholderTextColor={colors.mutedText}
              selectionColor={colors.primary}
              style={[
                styles.textInput,
                {
                  borderColor: colors.line,
                  color: colors.text,
                },
              ]}
              textAlignVertical="top"
              value={text}
            />
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={() => setAdvancedOpen((value) => !value)}
            style={[styles.disclosure, { borderTopColor: colors.line }]}>
            <View
              style={[
                styles.disclosureIcon,
                { backgroundColor: colors.surfaceMuted },
              ]}>
              <MaterialCommunityIcons name="tune-variant" size={19} color={colors.primary} />
            </View>
            <View style={styles.disclosureCopy}>
              <ThemedText style={styles.disclosureTitle}>高级设置</ThemedText>
              <ThemedText style={[styles.disclosureMeta, { color: colors.mutedText }]}>
                {encoding.toUpperCase()} · 标签解析{useTagParser ? '开启' : '关闭'}
              </ThemedText>
            </View>
            <MaterialCommunityIcons
              name={advancedOpen ? 'chevron-up' : 'chevron-down'}
              size={22}
              color={colors.mutedText}
            />
          </Pressable>

          {advancedOpen ? (
            <View style={[styles.advancedBody, { borderTopColor: colors.line }]}>
              <View style={styles.field}>
                <ThemedText style={styles.fieldLabel}>输出格式</ThemedText>
                <View style={[styles.segmentedControl, { backgroundColor: colors.surfaceMuted }]}>
                  {TTS_ENCODINGS.map((item) => {
                    const selected = item === encoding;

                    return (
                      <Pressable
                        accessibilityRole="button"
                        key={item}
                        onPress={() => setEncoding(item)}
                        style={[
                          styles.segment,
                          { backgroundColor: selected ? colors.primary : 'transparent' },
                        ]}>
                        <ThemedText
                          style={[
                            styles.segmentText,
                            { color: selected ? '#ffffff' : colors.mutedText },
                          ]}>
                          {item.toUpperCase()}
                        </ThemedText>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View style={styles.switchRow}>
                <View style={styles.switchCopy}>
                  <ThemedText style={styles.fieldLabel}>标签解析</ThemedText>
                  <ThemedText style={[styles.fieldHint, { color: colors.mutedText }]}>
                    识别文本中的停顿与语气标签
                  </ThemedText>
                </View>
                <Switch
                  accessibilityLabel="标签解析"
                  onValueChange={setUseTagParser}
                  thumbColor="#ffffff"
                  trackColor={{ false: colors.line, true: colors.primary }}
                  value={useTagParser}
                />
              </View>

              <View style={styles.field}>
                <ThemedText style={styles.fieldLabel}>语音服务地址</ThemedText>
                <TextInput
                  accessibilityLabel="语音服务地址"
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!isVoiceServerLocked()}
                  onChangeText={setServerUrl}
                  placeholder="https://api.example.com"
                  placeholderTextColor={colors.mutedText}
                  selectionColor={colors.primary}
                  style={[
                    styles.serverInput,
                    {
                      backgroundColor: colors.surfaceMuted,
                      color: colors.text,
                      opacity: isVoiceServerLocked() ? 0.65 : 1,
                    },
                  ]}
                  value={serverUrl}
                />
                {isVoiceServerLocked() ? (
                  <ThemedText style={[styles.fieldHint, { color: colors.mutedText }]}>
                    当前地址由应用环境统一管理
                  </ThemedText>
                ) : null}
              </View>
            </View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            disabled={submitting || !trimmedText}
            onPress={() => void handleSubmit()}
            style={[
              styles.submitButton,
              {
                backgroundColor: colors.hero,
                opacity: submitting || !trimmedText ? 0.55 : 1,
              },
            ]}>
            {submitting ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <MaterialCommunityIcons name="waveform" size={22} color="#ffffff" />
            )}
            <ThemedText style={styles.submitText}>
              {submitting ? '正在生成' : '生成语音'}
            </ThemedText>
          </Pressable>
        </SurfaceCard>

        {submitting ? (
          <SurfaceCard style={styles.progressCard}>
            <View style={[styles.statusIcon, { backgroundColor: colors.primarySoft }]}>
              <ActivityIndicator color={colors.primary} size="small" />
            </View>
            <View style={styles.statusCopy}>
              <ThemedText style={styles.statusTitle}>正在合成声音</ThemedText>
              <ThemedText style={[styles.statusDescription, { color: colors.mutedText }]}>
                {selectedVoice.label} · {encoding.toUpperCase()}
              </ThemedText>
            </View>
          </SurfaceCard>
        ) : null}

        {errorMessage ? (
          <SurfaceCard style={[styles.errorCard, { borderColor: '#d86f5b' }]}>
            <MaterialCommunityIcons name="alert-circle-outline" size={22} color="#d86f5b" />
            <View style={styles.statusCopy}>
              <ThemedText style={styles.statusTitle}>{status}</ThemedText>
              <ThemedText style={styles.errorText}>{errorMessage}</ThemedText>
            </View>
          </SurfaceCard>
        ) : null}

        {result ? (
          <SurfaceCard style={styles.resultCard}>
            <View style={styles.resultHeader}>
              <View style={[styles.statusIcon, { backgroundColor: '#daf6ed' }]}>
                <MaterialCommunityIcons name="check" size={21} color="#168e70" />
              </View>
              <View style={styles.statusCopy}>
                <ThemedText style={styles.resultTitle}>语音已生成</ThemedText>
                <ThemedText style={[styles.statusDescription, { color: colors.mutedText }]}>
                  {selectedVoice.label} · {encoding.toUpperCase()}
                </ThemedText>
              </View>
            </View>

            <Pressable
              accessibilityHint="使用系统播放器打开生成的音频"
              accessibilityRole="button"
              onPress={() => void Linking.openURL(result.audioUrl)}
              style={[styles.listenButton, { backgroundColor: colors.primarySoft }]}>
              <View style={[styles.playIcon, { backgroundColor: colors.primary }]}>
                <MaterialCommunityIcons name="play" size={21} color="#ffffff" />
              </View>
              <View style={styles.statusCopy}>
                <ThemedText style={[styles.listenTitle, { color: colors.primary }]}>试听音频</ThemedText>
                <ThemedText style={[styles.listenMeta, { color: colors.mutedText }]}>
                  在系统播放器中打开
                </ThemedText>
              </View>
              <MaterialCommunityIcons name="open-in-new" size={18} color={colors.primary} />
            </Pressable>

            <Pressable
              accessibilityRole="button"
              onPress={() => setResultDetailsOpen((value) => !value)}
              style={[styles.resultDisclosure, { borderTopColor: colors.line }]}>
              <ThemedText style={styles.resultDisclosureText}>文件详情</ThemedText>
              <MaterialCommunityIcons
                name={resultDetailsOpen ? 'chevron-up' : 'chevron-down'}
                size={21}
                color={colors.mutedText}
              />
            </Pressable>

            {resultDetailsOpen ? (
              <View style={styles.detailList}>
                <DetailRow label="文件名" value={result.fileName} />
                <DetailRow label="保存位置" value={result.filePath} />
                <DetailRow label="资源 ID" value={result.resourceId} />
                <DetailRow label="音频地址" value={result.audioUrl} />
              </View>
            ) : null}
          </SurfaceCard>
        ) : null}
      </MobileScreen>

      <Modal
        animationType="slide"
        onRequestClose={() => setPickerVisible(false)}
        transparent
        visible={pickerVisible}>
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.line,
              },
            ]}>
            <View style={styles.modalHeader}>
              <View style={styles.modalTitleBlock}>
                <ThemedText style={styles.modalTitle}>选择音色</ThemedText>
                <ThemedText style={[styles.modalSubtitle, { color: colors.mutedText }]}>
                  当前使用 {selectedVoice.label}
                </ThemedText>
              </View>
              <Pressable
                accessibilityLabel="关闭音色列表"
                accessibilityRole="button"
                onPress={() => setPickerVisible(false)}
                style={[styles.modalCloseButton, { backgroundColor: colors.surfaceMuted }]}>
                <MaterialCommunityIcons name="close" size={21} color={colors.text} />
              </Pressable>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.modalContent}>
              {TTS_VOICE_GROUPS.map((group) => (
                <View key={group} style={styles.voiceGroup}>
                  <ThemedText style={[styles.voiceGroupTitle, { color: colors.mutedText }]}>
                    {group}
                  </ThemedText>
                  {TTS_VOICE_OPTIONS.filter((voice) => voice.group === group).map((voice) => {
                    const selected = voice.value === voiceType;

                    return (
                      <Pressable
                        accessibilityRole="button"
                        key={voice.value}
                        onPress={() => {
                          setVoiceType(voice.value);
                          setPickerVisible(false);
                        }}
                        style={[
                          styles.voiceOption,
                          {
                            backgroundColor: selected ? colors.primarySoft : colors.surface,
                            borderColor: selected ? colors.primary : colors.line,
                          },
                        ]}>
                        <View
                          style={[
                            styles.voiceOptionIcon,
                            {
                              backgroundColor: selected ? colors.primary : colors.surfaceMuted,
                            },
                          ]}>
                          <MaterialCommunityIcons
                            name="account-voice"
                            size={20}
                            color={selected ? '#ffffff' : colors.mutedText}
                          />
                        </View>
                        <View style={styles.voiceOptionCopy}>
                          <ThemedText style={styles.voiceOptionTitle}>{voice.label}</ThemedText>
                          <ThemedText style={[styles.voiceOptionText, { color: colors.mutedText }]}>
                            {voice.language} · {voice.capabilities}
                          </ThemedText>
                        </View>
                        {selected ? (
                          <MaterialCommunityIcons
                            name="check-circle"
                            size={21}
                            color={colors.primary}
                          />
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

type StepHeadingProps = {
  inverse?: boolean;
  meta?: string;
  number: string;
  title: string;
};

function StepHeading({ inverse = false, meta, number, title }: StepHeadingProps) {
  const { colors } = useAppTheme();
  const titleColor = inverse ? '#ffffff' : colors.text;
  const mutedColor = inverse ? 'rgba(255,255,255,0.58)' : colors.mutedText;

  return (
    <View style={styles.stepHeading}>
      <ThemedText style={[styles.stepNumber, { color: mutedColor }]}>{number}</ThemedText>
      <ThemedText style={[styles.stepTitle, { color: titleColor }]}>{title}</ThemedText>
      {meta ? (
        <ThemedText style={[styles.stepMeta, { color: mutedColor }]}>{meta}</ThemedText>
      ) : null}
    </View>
  );
}

type DetailRowProps = {
  label: string;
  value: string;
};

function DetailRow({ label, value }: DetailRowProps) {
  const { colors } = useAppTheme();

  return (
    <View style={styles.detailRow}>
      <ThemedText style={[styles.detailLabel, { color: colors.mutedText }]}>{label}</ThemedText>
      <ThemedText selectable style={styles.detailValue}>
        {value}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  screenContent: {
    gap: 14,
  },
  iconButton: {
    alignItems: 'center',
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  voiceStage: {
    borderRadius: 28,
    gap: 16,
    padding: 20,
  },
  stepHeading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 9,
  },
  stepNumber: {
    fontSize: 12,
    fontWeight: '800',
  },
  stepTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '800',
  },
  stepMeta: {
    fontSize: 12,
    fontWeight: '700',
  },
  voiceSelector: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderColor: 'rgba(255,255,255,0.15)',
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 13,
    padding: 15,
  },
  voiceIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 16,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  voiceCopy: {
    flex: 1,
    gap: 2,
  },
  voiceName: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 25,
  },
  voiceMeta: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 12,
    fontWeight: '700',
  },
  voiceCapability: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 13,
    lineHeight: 19,
  },
  voiceChevron: {
    alignItems: 'center',
    height: 32,
    justifyContent: 'center',
    width: 24,
  },
  editorCard: {
    gap: 18,
    padding: 18,
  },
  editorSection: {
    gap: 12,
  },
  sectionDivider: {
    height: 1,
    width: '100%',
  },
  presetRow: {
    gap: 8,
    paddingRight: 4,
  },
  presetChip: {
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  presetText: {
    fontSize: 12,
    fontWeight: '700',
  },
  toneInput: {
    borderRadius: 16,
    fontSize: 14,
    lineHeight: 21,
    minHeight: 88,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  textInput: {
    borderRadius: 18,
    borderWidth: 1,
    fontSize: 16,
    lineHeight: 25,
    minHeight: 210,
    paddingHorizontal: 15,
    paddingVertical: 14,
  },
  disclosure: {
    alignItems: 'center',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 11,
    paddingTop: 16,
  },
  disclosureIcon: {
    alignItems: 'center',
    borderRadius: 14,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  disclosureCopy: {
    flex: 1,
    gap: 1,
  },
  disclosureTitle: {
    fontSize: 14,
    fontWeight: '800',
  },
  disclosureMeta: {
    fontSize: 11,
    lineHeight: 16,
  },
  advancedBody: {
    borderTopWidth: 1,
    gap: 18,
    paddingTop: 18,
  },
  field: {
    gap: 8,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '800',
  },
  fieldHint: {
    fontSize: 12,
    lineHeight: 18,
  },
  segmentedControl: {
    borderRadius: 16,
    flexDirection: 'row',
    gap: 4,
    padding: 4,
  },
  segment: {
    alignItems: 'center',
    borderRadius: 12,
    flex: 1,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  segmentText: {
    fontSize: 12,
    fontWeight: '800',
  },
  switchRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  switchCopy: {
    flex: 1,
    gap: 2,
  },
  serverInput: {
    borderRadius: 16,
    fontSize: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  submitButton: {
    alignItems: 'center',
    borderRadius: 18,
    flexDirection: 'row',
    gap: 9,
    justifyContent: 'center',
    minHeight: 54,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  submitText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  progressCard: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    padding: 16,
  },
  statusIcon: {
    alignItems: 'center',
    borderRadius: 15,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  statusCopy: {
    flex: 1,
    gap: 2,
  },
  statusTitle: {
    fontSize: 15,
    fontWeight: '800',
  },
  statusDescription: {
    fontSize: 12,
    lineHeight: 18,
  },
  errorCard: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 11,
    padding: 16,
  },
  errorText: {
    color: '#d86f5b',
    fontSize: 13,
    lineHeight: 20,
  },
  resultCard: {
    gap: 14,
    padding: 18,
  },
  resultHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  resultTitle: {
    fontSize: 17,
    fontWeight: '800',
  },
  listenButton: {
    alignItems: 'center',
    borderRadius: 18,
    flexDirection: 'row',
    gap: 11,
    padding: 13,
  },
  playIcon: {
    alignItems: 'center',
    borderRadius: 15,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  listenTitle: {
    fontSize: 14,
    fontWeight: '800',
  },
  listenMeta: {
    fontSize: 11,
    lineHeight: 16,
  },
  resultDisclosure: {
    alignItems: 'center',
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 13,
  },
  resultDisclosureText: {
    fontSize: 13,
    fontWeight: '700',
  },
  detailList: {
    gap: 12,
  },
  detailRow: {
    gap: 3,
  },
  detailLabel: {
    fontSize: 11,
    fontWeight: '700',
  },
  detailValue: {
    fontSize: 12,
    lineHeight: 18,
  },
  modalOverlay: {
    backgroundColor: 'rgba(0,0,0,0.4)',
    flex: 1,
    justifyContent: 'flex-end',
    padding: 10,
  },
  modalCard: {
    borderRadius: 26,
    borderWidth: 1,
    gap: 16,
    maxHeight: '88%',
    padding: 18,
  },
  modalHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  modalTitleBlock: {
    flex: 1,
    gap: 2,
  },
  modalTitle: {
    fontSize: 19,
    fontWeight: '800',
  },
  modalSubtitle: {
    fontSize: 12,
    lineHeight: 18,
  },
  modalCloseButton: {
    alignItems: 'center',
    borderRadius: 15,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  modalContent: {
    gap: 20,
    paddingBottom: 12,
  },
  voiceGroup: {
    gap: 9,
  },
  voiceGroupTitle: {
    fontSize: 12,
    fontWeight: '800',
    paddingHorizontal: 2,
  },
  voiceOption: {
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 11,
    minHeight: 68,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  voiceOptionIcon: {
    alignItems: 'center',
    borderRadius: 14,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  voiceOptionCopy: {
    flex: 1,
    gap: 2,
  },
  voiceOptionTitle: {
    fontSize: 14,
    fontWeight: '800',
  },
  voiceOptionText: {
    fontSize: 11,
    lineHeight: 17,
  },
});
