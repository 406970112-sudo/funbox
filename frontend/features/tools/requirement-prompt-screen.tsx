import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { useAppTheme } from '@/hooks/use-app-theme';
import { buildRequirementPrompt } from '@/lib/requirement-prompt';
import { MobileScreen } from '@/shared/ui/mobile-screen';
import { PageHeader } from '@/shared/ui/page-header';
import { SurfaceCard } from '@/shared/ui/surface-card';

type CopyStatus = 'idle' | 'success' | 'error';

export function RequirementPromptScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const [requirement, setRequirement] = useState('');
  const [copyStatus, setCopyStatus] = useState<CopyStatus>('idle');
  const outputText = buildRequirementPrompt(requirement);

  useEffect(() => {
    if (copyStatus === 'idle') return;

    const timer = setTimeout(() => setCopyStatus('idle'), 1800);
    return () => clearTimeout(timer);
  }, [copyStatus]);

  async function handleCopy() {
    try {
      await Clipboard.setStringAsync(outputText);
      setCopyStatus('success');
    } catch {
      setCopyStatus('error');
    }
  }

  const copyLabel = copyStatus === 'success'
    ? '已复制'
    : copyStatus === 'error'
      ? '复制失败，请重试'
      : '立即复制';
  const copyColor = copyStatus === 'error' ? colors.accent : colors.primary;

  return (
    <MobileScreen contentContainerStyle={styles.screen}>
      <PageHeader
        eyebrow="AI"
        rightSlot={
          <Pressable
            accessibilityLabel="返回工具列表"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => router.back()}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
            <MaterialCommunityIcons name="arrow-left" size={20} color={colors.text} />
          </Pressable>
        }
        subtitle="输入本次需求，生成一份可直接交给开发或 AI 的标准化方案提示。"
        title="需求方案模板"
      />

      <SurfaceCard style={styles.inputCard}>
        <View style={styles.cardHeader}>
          <View style={styles.cardTitleRow}>
            <View style={[styles.iconBadge, { backgroundColor: colors.primarySoft }]}>
              <MaterialCommunityIcons name="text-box-edit-outline" size={19} color={colors.primary} />
            </View>
            <ThemedText style={styles.cardTitle}>输入需求</ThemedText>
          </View>
          <ThemedText style={[styles.counter, { color: colors.mutedText }]}>
            {requirement.length} 字
          </ThemedText>
        </View>
        <TextInput
          accessibilityLabel="需求输入框"
          multiline
          onChangeText={(value) => {
            setRequirement(value);
            setCopyStatus('idle');
          }}
          placeholder="在这里输入具体需求，例如：新增一个支持批量导出的数据列表页……"
          placeholderTextColor={colors.mutedText}
          selectionColor={colors.primary}
          style={[
            styles.input,
            {
              backgroundColor: colors.surfaceMuted,
              borderColor: colors.line,
              color: colors.text,
            },
          ]}
          textAlignVertical="top"
          value={requirement}
        />
      </SurfaceCard>

      <View style={styles.connector}>
        <MaterialCommunityIcons name="arrow-down" size={19} color={colors.mutedText} />
        <ThemedText style={[styles.connectorLabel, { color: colors.mutedText }]}>实时生成完整模板</ThemedText>
      </View>

      <SurfaceCard style={styles.outputCard}>
        <View style={styles.cardHeader}>
          <View style={styles.cardTitleRow}>
            <View style={[styles.iconBadge, { backgroundColor: `${colors.accent}20` }]}>
              <MaterialCommunityIcons name="file-document-outline" size={19} color={colors.accent} />
            </View>
            <ThemedText style={styles.cardTitle}>生成结果</ThemedText>
          </View>
          <ThemedText style={[styles.fixedLabel, { color: colors.success }]}>固定模板</ThemedText>
        </View>

        <View style={[styles.outputBox, { backgroundColor: colors.surfaceMuted, borderColor: colors.line }]}>
          <ThemedText selectable style={styles.outputText}>
            {outputText}
          </ThemedText>
        </View>

        <Pressable
          accessibilityLabel={copyLabel}
          accessibilityRole="button"
          onPress={() => void handleCopy()}
          testID="requirement-prompt-copy"
          style={({ pressed }) => [
            styles.copyButton,
            { backgroundColor: colors.hero },
            pressed && styles.pressed,
          ]}>
          <MaterialCommunityIcons
            name={copyStatus === 'success' ? 'check' : 'content-copy'}
            size={17}
            color="#c9f36a"
          />
          <ThemedText style={styles.copyButtonText}>{copyLabel}</ThemedText>
        </Pressable>
      </SurfaceCard>
    </MobileScreen>
  );
}

const styles = StyleSheet.create({
  screen: {
    gap: 12,
    paddingTop: 8,
  },
  backButton: {
    alignItems: 'center',
    borderRadius: 999,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cardTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 9,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  counter: {
    fontSize: 11,
    fontWeight: '700',
  },
  fixedLabel: {
    fontSize: 11,
    fontWeight: '800',
  },
  iconBadge: {
    alignItems: 'center',
    borderRadius: 12,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  input: {
    borderRadius: 16,
    borderWidth: 1,
    fontSize: 14,
    lineHeight: 21,
    minHeight: 142,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  inputCard: {
    gap: 13,
    padding: 14,
  },
  connector: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
  },
  connectorLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  outputCard: {
    gap: 13,
    padding: 14,
  },
  outputBox: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
  },
  outputText: {
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 20,
  },
  copyButton: {
    alignItems: 'center',
    borderRadius: 16,
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    minHeight: 46,
    paddingHorizontal: 14,
  },
  copyButtonText: {
    color: '#c9f36a',
    fontSize: 13,
    fontWeight: '900',
  },
  pressed: {
    opacity: 0.72,
  },
});
