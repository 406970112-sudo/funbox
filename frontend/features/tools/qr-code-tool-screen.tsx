import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter } from 'expo-router';
import {
  startTransition,
  useDeferredValue,
  useRef,
  useState,
  type ComponentProps,
} from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { ThemedText } from '@/components/themed-text';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  DEFAULT_QR_FIELDS,
  fileSafeQrName,
  validateQrContent,
  type QrContentFields,
  type QrContentType,
  type WifiSecurity,
} from '@/lib/qr-code';
import {
  captureQrPng,
  createQrSvg,
  createWebQrPng,
  downloadWebData,
  shareWebPng,
  writeNativeSvg,
  type QrExportFormat,
} from '@/lib/qr-export';
import { MobileScreen } from '@/shared/ui/mobile-screen';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];
type QrCornerStyle = 'rounded' | 'square';

type QrHistoryItem = {
  caption: string;
  color: string;
  cornerStyle: QrCornerStyle;
  fields: QrContentFields;
  id: string;
  savedAt: string;
  type: QrContentType;
};

const QR_BACKGROUND = '#ffffff';
const QR_MINT = '#eaf5ef';
const QR_CORAL = '#ef765f';
const EXPORT_SIZES = [512, 1024, 2048] as const;

const CONTENT_TYPES: {
  icon: IconName;
  id: QrContentType;
  label: string;
}[] = [
  { id: 'link', icon: 'link-variant', label: '链接' },
  { id: 'text', icon: 'text-box-outline', label: '文本' },
  { id: 'wifi', icon: 'wifi', label: 'Wi-Fi' },
  { id: 'contact', icon: 'card-account-details-outline', label: '名片' },
];

const QR_COLORS = [
  { color: '#173f3a', label: '墨绿' },
  { color: '#18233d', label: '深蓝' },
  { color: '#4b6bff', label: '亮蓝' },
  { color: '#d44d42', label: '朱红' },
] as const;

export function QrCodeToolScreen() {
  const router = useRouter();
  const { colors, colorScheme } = useAppTheme();
  const { width } = useWindowDimensions();
  const qrCaptureRef = useRef<View>(null);
  const [contentType, setContentType] = useState<QrContentType>('link');
  const [fields, setFields] = useState<QrContentFields>({ ...DEFAULT_QR_FIELDS });
  const [qrColor, setQrColor] = useState<string>(QR_COLORS[0].color);
  const [cornerStyle, setCornerStyle] = useState<QrCornerStyle>('rounded');
  const [exportVisible, setExportVisible] = useState(false);
  const [historyVisible, setHistoryVisible] = useState(false);
  const [exportFormat, setExportFormat] = useState<QrExportFormat>('png');
  const [exportSize, setExportSize] = useState<(typeof EXPORT_SIZES)[number]>(1024);
  const [transparentBackground, setTransparentBackground] = useState(false);
  const [history, setHistory] = useState<QrHistoryItem[]>([]);
  const [busyAction, setBusyAction] = useState<'save' | 'share' | null>(null);
  const [feedback, setFeedback] = useState('');
  const validation = validateQrContent(contentType, fields);
  const deferredPayload = useDeferredValue(validation.payload);
  const qrValue = deferredPayload || 'https://funbox.app';
  const previewPending = deferredPayload !== validation.payload;
  const qrSize = Math.max(176, Math.min(218, width - 132));
  const qrPaperRadius = cornerStyle === 'rounded' ? 22 : 6;
  const previewBackground = colorScheme === 'dark' ? '#17302c' : QR_MINT;
  const previewMetaColor = colorScheme === 'dark' ? '#9bcfc1' : '#51746b';

  function updateField<Key extends keyof QrContentFields>(
    key: Key,
    value: QrContentFields[Key],
  ) {
    setFields((current) => ({ ...current, [key]: value }));
    setFeedback('');
  }

  function selectContentType(nextType: QrContentType) {
    startTransition(() => {
      setContentType(nextType);
      setFeedback('');
    });
  }

  function openExport() {
    if (validation.error) {
      setFeedback(validation.error);
      return;
    }

    setFeedback('');
    setExportVisible(true);
  }

  function addHistoryItem() {
    const item: QrHistoryItem = {
      caption: validation.caption,
      color: qrColor,
      cornerStyle,
      fields: { ...fields },
      id: `${contentType}-${validation.payload}`,
      savedAt: new Date().toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
      }),
      type: contentType,
    };

    setHistory((current) => [item, ...current.filter((entry) => entry.id !== item.id)].slice(0, 5));
  }

  function restoreHistoryItem(item: QrHistoryItem) {
    startTransition(() => {
      setContentType(item.type);
      setFields({ ...item.fields });
      setQrColor(item.color);
      setCornerStyle(item.cornerStyle);
      setFeedback('已恢复历史二维码。');
      setHistoryVisible(false);
    });
  }

  async function handleSave() {
    await runExportAction('save', async () => {
      const baseName = fileSafeQrName(validation.caption);

      if (exportFormat === 'svg') {
        const svg = await createCurrentSvg();
        const fileName = `${baseName}.svg`;

        if (Platform.OS === 'web') {
          downloadWebData(svg, fileName, 'image/svg+xml');
          return 'SVG 文件已导出。';
        }

        const fileUri = await writeNativeSvg(svg, fileName);
        await shareNativeFile(fileUri, 'image/svg+xml', 'public.svg');
        return 'SVG 文件已生成，可选择保存位置。';
      }

      const pngUri = await createCurrentPng();
      const fileName = `${baseName}.png`;

      if (Platform.OS === 'web') {
        downloadWebData(pngUri, fileName, 'image/png');
        return 'PNG 图片已下载。';
      }

      const MediaLibrary = await import('expo-media-library');
      const permission = await MediaLibrary.requestPermissionsAsync(true, ['photo']);

      if (!permission.granted) {
        throw new Error('没有相册写入权限，请在系统设置中允许后重试。');
      }

      await MediaLibrary.createAssetAsync(pngUri);
      return '二维码已保存到相册。';
    });
  }

  async function handleShare() {
    await runExportAction('share', async () => {
      const baseName = fileSafeQrName(validation.caption);

      if (exportFormat === 'svg') {
        const svg = await createCurrentSvg();
        const fileName = `${baseName}.svg`;

        if (Platform.OS === 'web') {
          downloadWebData(svg, fileName, 'image/svg+xml');
          return '当前浏览器不支持直接分享 SVG，文件已下载。';
        }

        const fileUri = await writeNativeSvg(svg, fileName);
        await shareNativeFile(fileUri, 'image/svg+xml', 'public.svg');
        return '已打开系统分享面板。';
      }

      const pngUri = await createCurrentPng();
      const fileName = `${baseName}.png`;

      if (Platform.OS === 'web') {
        const result = await shareWebPng(pngUri, fileName);
        return result === 'shared' ? '已打开系统分享面板。' : '浏览器不支持分享，图片已下载。';
      }

      await shareNativeFile(pngUri, 'image/png', 'public.png');
      return '已打开系统分享面板。';
    });
  }

  async function runExportAction(
    action: 'save' | 'share',
    task: () => Promise<string>,
  ) {
    if (validation.error || busyAction) {
      return;
    }

    setBusyAction(action);
    setFeedback('');

    try {
      const message = await task();
      addHistoryItem();
      setFeedback(message);
    } catch (error) {
      const errorName = error instanceof Error ? error.name : '';
      setFeedback(
        errorName === 'AbortError'
          ? '已取消分享。'
          : error instanceof Error
            ? error.message
            : '导出失败，请稍后重试。',
      );
    } finally {
      setBusyAction(null);
    }
  }

  function createCurrentSvg() {
    return createQrSvg({
      backgroundColor: QR_BACKGROUND,
      color: qrColor,
      payload: validation.payload,
      size: exportSize,
      transparent: transparentBackground,
    });
  }

  function createCurrentPng() {
    if (Platform.OS !== 'web') {
      return captureQrPng(qrCaptureRef, exportSize);
    }

    return createWebQrPng({
      backgroundColor: QR_BACKGROUND,
      color: qrColor,
      payload: validation.payload,
      rounded: cornerStyle === 'rounded',
      size: exportSize,
      transparent: transparentBackground,
    });
  }

  async function shareNativeFile(fileUri: string, mimeType: string, UTI: string) {
    const Sharing = await import('expo-sharing');

    if (!(await Sharing.isAvailableAsync())) {
      throw new Error('当前设备不支持系统分享。');
    }

    await Sharing.shareAsync(fileUri, {
      UTI,
      dialogTitle: '分享二维码',
      mimeType,
    });
  }

  return (
    <>
      <MobileScreen contentContainerStyle={styles.screenContent}>
        <View style={styles.topBar}>
          <Pressable
            accessibilityLabel="返回"
            accessibilityRole="button"
            onPress={() => router.back()}
            style={({ pressed }) => [
              styles.iconButton,
              { backgroundColor: pressed ? colors.surfaceMuted : 'transparent' },
            ]}>
            <MaterialCommunityIcons name="arrow-left" size={21} color={colors.text} />
          </Pressable>
          <ThemedText style={styles.pageTitle}>二维码生成器</ThemedText>
          <Pressable
            accessibilityLabel="查看历史二维码"
            accessibilityRole="button"
            onPress={() => setHistoryVisible(true)}
            style={styles.historyButton}>
            <ThemedText style={[styles.historyButtonText, { color: colors.primary }]}>历史</ThemedText>
          </Pressable>
        </View>

        <View
          accessibilityRole="tablist"
          style={[styles.typeTabs, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          {CONTENT_TYPES.map((item) => {
            const selected = contentType === item.id;

            return (
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                key={item.id}
                onPress={() => selectContentType(item.id)}
                style={[
                  styles.typeTab,
                  { backgroundColor: selected ? colors.hero : 'transparent' },
                ]}>
                <MaterialCommunityIcons
                  name={item.icon}
                  size={18}
                  color={selected ? '#ffffff' : colors.mutedText}
                />
                <ThemedText
                  numberOfLines={1}
                  style={[styles.typeTabText, { color: selected ? '#ffffff' : colors.mutedText }]}>
                  {item.label}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>

        <View
          style={[
            styles.previewStage,
            { backgroundColor: previewBackground, borderColor: `${qrColor}22` },
          ]}>
          <View style={styles.previewHeader}>
            <ThemedText style={styles.previewTitle}>实时预览</ThemedText>
            <View style={styles.previewStatus}>
              {previewPending ? (
                <ActivityIndicator color={previewMetaColor} size="small" />
              ) : (
                <View
                  style={[
                    styles.statusDot,
                    { backgroundColor: validation.error ? QR_CORAL : '#2ab28a' },
                  ]}
                />
              )}
              <ThemedText style={[styles.previewStatusText, { color: previewMetaColor }]}>
                {previewPending ? '正在更新' : validation.error ? '等待内容' : '内容有效'}
              </ThemedText>
            </View>
          </View>

          <View
            collapsable={false}
            ref={qrCaptureRef}
            style={[
              styles.qrPaper,
              {
                backgroundColor: transparentBackground ? 'transparent' : QR_BACKGROUND,
                borderRadius: qrPaperRadius,
                height: qrSize + 28,
                width: qrSize + 28,
              },
            ]}>
            <QRCode
              backgroundColor={transparentBackground ? 'transparent' : QR_BACKGROUND}
              color={validation.error ? colors.tabInactive : qrColor}
              ecl="H"
              quietZone={8}
              size={qrSize}
              value={qrValue}
            />
            <View
              pointerEvents="none"
              style={[
                styles.qrLogo,
                { borderRadius: cornerStyle === 'rounded' ? 13 : 5 },
              ]}>
              <ThemedText style={styles.qrLogoText}>F</ThemedText>
            </View>
          </View>
          <ThemedText numberOfLines={1} style={[styles.previewCaption, { color: previewMetaColor }]}>
            {validation.caption}
          </ThemedText>
        </View>

        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <ContentFields
            fields={fields}
            onChange={updateField}
            type={contentType}
          />
          {validation.error ? (
            <View style={styles.errorRow}>
              <MaterialCommunityIcons name="alert-circle-outline" size={16} color={QR_CORAL} />
              <ThemedText style={styles.errorText}>{validation.error}</ThemedText>
            </View>
          ) : null}
        </View>

        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <View style={styles.sectionHeading}>
            <ThemedText style={styles.sectionTitle}>二维码样式</ThemedText>
            <ThemedText style={[styles.sectionMeta, { color: colors.mutedText }]}>高容错</ThemedText>
          </View>
          <View style={styles.styleRow}>
            <View style={styles.swatchRow}>
              {QR_COLORS.map((item) => {
                const selected = item.color === qrColor;

                return (
                  <Pressable
                    accessibilityLabel={item.label}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    key={item.color}
                    onPress={() => startTransition(() => setQrColor(item.color))}
                    style={[
                      styles.swatch,
                      {
                        backgroundColor: item.color,
                        borderColor: selected ? colors.text : colors.surface,
                      },
                    ]}>
                    {selected ? <MaterialCommunityIcons name="check" size={15} color="#ffffff" /> : null}
                  </Pressable>
                );
              })}
            </View>
            <View style={[styles.cornerControl, { backgroundColor: colors.surfaceMuted }]}>
              {(['square', 'rounded'] as const).map((item) => {
                const selected = item === cornerStyle;

                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    key={item}
                    onPress={() => setCornerStyle(item)}
                    style={[
                      styles.cornerOption,
                      { backgroundColor: selected ? colors.surface : 'transparent' },
                    ]}>
                    <ThemedText
                      style={[
                        styles.cornerOptionText,
                        { color: selected ? colors.text : colors.mutedText },
                      ]}>
                      {item === 'square' ? '方角' : '圆角'}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>

        {feedback ? (
          <View
            accessibilityLiveRegion="polite"
            style={[
              styles.feedbackBar,
              { backgroundColor: colors.primarySoft, borderColor: `${colors.primary}33` },
            ]}>
            <MaterialCommunityIcons name="information-outline" size={18} color={colors.primary} />
            <ThemedText style={[styles.feedbackText, { color: colors.primary }]}>{feedback}</ThemedText>
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          disabled={Boolean(validation.error)}
          onPress={openExport}
          style={[
            styles.primaryButton,
            {
              backgroundColor: colors.primary,
              opacity: validation.error ? 0.46 : 1,
              shadowColor: colors.primary,
            },
          ]}>
          <MaterialCommunityIcons name="download" size={20} color="#ffffff" />
          <ThemedText style={styles.primaryButtonText}>导出二维码</ThemedText>
        </Pressable>
      </MobileScreen>

      <ExportSheet
        busyAction={busyAction}
        caption={validation.caption}
        color={qrColor}
        exportFormat={exportFormat}
        exportSize={exportSize}
        onClose={() => setExportVisible(false)}
        onFormatChange={setExportFormat}
        onSave={() => void handleSave()}
        onShare={() => void handleShare()}
        onSizeChange={setExportSize}
        onTransparentChange={setTransparentBackground}
        payload={qrValue}
        transparent={transparentBackground}
        visible={exportVisible}
      />

      <HistorySheet
        history={history}
        onClose={() => setHistoryVisible(false)}
        onSelect={restoreHistoryItem}
        visible={historyVisible}
      />
    </>
  );
}

function ContentFields({
  fields,
  onChange,
  type,
}: {
  fields: QrContentFields;
  onChange: <Key extends keyof QrContentFields>(
    key: Key,
    value: QrContentFields[Key],
  ) => void;
  type: QrContentType;
}) {
  const { colors } = useAppTheme();

  if (type === 'link') {
    return (
      <>
        <FieldHeading hint="自动补全 HTTPS" title="输入链接" />
        <QrTextField
          icon="web"
          keyboardType="url"
          onChangeText={(value) => onChange('link', value)}
          placeholder="https://example.com"
          value={fields.link}
        />
      </>
    );
  }

  if (type === 'text') {
    return (
      <>
        <FieldHeading hint={`${fields.text.length} / 800`} title="输入文本" />
        <TextInput
          accessibilityLabel="二维码文本内容"
          maxLength={800}
          multiline
          onChangeText={(value) => onChange('text', value)}
          placeholder="输入需要放入二维码的文字"
          placeholderTextColor={colors.mutedText}
          selectionColor={colors.primary}
          style={[
            styles.multilineInput,
            { backgroundColor: colors.surfaceMuted, color: colors.text },
          ]}
          textAlignVertical="top"
          value={fields.text}
        />
      </>
    );
  }

  if (type === 'wifi') {
    return (
      <>
        <FieldHeading hint="扫码后可直接连接" title="Wi-Fi 信息" />
        <QrTextField
          icon="wifi"
          onChangeText={(value) => onChange('wifiSsid', value)}
          placeholder="网络名称"
          value={fields.wifiSsid}
        />
        <QrTextField
          icon="lock-outline"
          onChangeText={(value) => onChange('wifiPassword', value)}
          placeholder={fields.wifiSecurity === 'nopass' ? '开放网络无需密码' : '网络密码'}
          secureTextEntry={fields.wifiSecurity !== 'nopass'}
          value={fields.wifiPassword}
        />
        <View style={[styles.securityControl, { backgroundColor: colors.surfaceMuted }]}>
          {(['WPA', 'WEP', 'nopass'] as WifiSecurity[]).map((security) => {
            const selected = fields.wifiSecurity === security;

            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected }}
                key={security}
                onPress={() => onChange('wifiSecurity', security)}
                style={[
                  styles.securityOption,
                  { backgroundColor: selected ? colors.primary : 'transparent' },
                ]}>
                <ThemedText
                  style={[
                    styles.securityText,
                    { color: selected ? '#ffffff' : colors.mutedText },
                  ]}>
                  {security === 'nopass' ? '开放' : security}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.switchRow}>
          <View style={styles.switchCopy}>
            <ThemedText style={styles.switchTitle}>隐藏网络</ThemedText>
            <ThemedText style={[styles.switchHint, { color: colors.mutedText }]}>SSID 不公开广播</ThemedText>
          </View>
          <Switch
            accessibilityLabel="隐藏网络"
            onValueChange={(value) => onChange('wifiHidden', value)}
            thumbColor="#ffffff"
            trackColor={{ false: colors.line, true: colors.primary }}
            value={fields.wifiHidden}
          />
        </View>
      </>
    );
  }

  return (
    <>
      <FieldHeading hint="手机号和邮箱至少一项" title="联系人名片" />
      <QrTextField
        icon="account-outline"
        onChangeText={(value) => onChange('contactName', value)}
        placeholder="姓名"
        value={fields.contactName}
      />
      <QrTextField
        icon="phone-outline"
        keyboardType="phone-pad"
        onChangeText={(value) => onChange('contactPhone', value)}
        placeholder="手机号"
        value={fields.contactPhone}
      />
      <QrTextField
        autoCapitalize="none"
        icon="email-outline"
        keyboardType="email-address"
        onChangeText={(value) => onChange('contactEmail', value)}
        placeholder="邮箱"
        value={fields.contactEmail}
      />
    </>
  );
}

function FieldHeading({ hint, title }: { hint: string; title: string }) {
  const { colors } = useAppTheme();

  return (
    <View style={styles.sectionHeading}>
      <ThemedText style={styles.sectionTitle}>{title}</ThemedText>
      <ThemedText style={[styles.sectionMeta, { color: colors.mutedText }]}>{hint}</ThemedText>
    </View>
  );
}

function QrTextField({
  icon,
  ...inputProps
}: ComponentProps<typeof TextInput> & { icon: IconName }) {
  const { colors } = useAppTheme();

  return (
    <View style={[styles.textField, { backgroundColor: colors.surfaceMuted }]}>
      <MaterialCommunityIcons name={icon} size={18} color={colors.primary} />
      <TextInput
        autoCapitalize="none"
        placeholderTextColor={colors.mutedText}
        selectionColor={colors.primary}
        style={[styles.textInput, { color: colors.text }]}
        {...inputProps}
      />
    </View>
  );
}

function ExportSheet({
  busyAction,
  caption,
  color,
  exportFormat,
  exportSize,
  onClose,
  onFormatChange,
  onSave,
  onShare,
  onSizeChange,
  onTransparentChange,
  payload,
  transparent,
  visible,
}: {
  busyAction: 'save' | 'share' | null;
  caption: string;
  color: string;
  exportFormat: QrExportFormat;
  exportSize: (typeof EXPORT_SIZES)[number];
  onClose: () => void;
  onFormatChange: (format: QrExportFormat) => void;
  onSave: () => void;
  onShare: () => void;
  onSizeChange: (size: (typeof EXPORT_SIZES)[number]) => void;
  onTransparentChange: (value: boolean) => void;
  payload: string;
  transparent: boolean;
  visible: boolean;
}) {
  const { colors } = useAppTheme();
  const fileName = `${fileSafeQrName(caption)}.${exportFormat}`;

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.modalRoot}>
        <Pressable accessibilityLabel="关闭导出面板" onPress={onClose} style={styles.modalScrim} />
        <View style={[styles.exportSheet, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <View style={[styles.sheetHandle, { backgroundColor: colors.line }]} />
          <View style={styles.sheetHeader}>
            <View style={styles.sheetTitleBlock}>
              <ThemedText style={styles.sheetTitle}>导出二维码</ThemedText>
              <ThemedText style={[styles.sheetSubtitle, { color: colors.mutedText }]}>
                选择适合使用场景的文件规格
              </ThemedText>
            </View>
            <Pressable
              accessibilityLabel="关闭"
              accessibilityRole="button"
              onPress={onClose}
              style={[styles.sheetClose, { backgroundColor: colors.surfaceMuted }]}>
              <MaterialCommunityIcons name="close" size={20} color={colors.text} />
            </Pressable>
          </View>

          <View style={[styles.exportPreview, { backgroundColor: QR_MINT }]}>
            <View style={styles.exportQr}>
              <QRCode backgroundColor="#ffffff" color={color} ecl="H" quietZone={3} size={62} value={payload} />
            </View>
            <View style={styles.exportFileCopy}>
              <ThemedText numberOfLines={1} style={styles.exportFileName}>{fileName}</ThemedText>
              <ThemedText style={styles.exportFileMeta}>{exportSize}px · 高容错</ThemedText>
            </View>
            <MaterialCommunityIcons name="check-decagram-outline" size={21} color="#249578" />
          </View>

          <View style={styles.sheetSection}>
            <ThemedText style={styles.sheetLabel}>文件格式</ThemedText>
            <View style={[styles.formatControl, { backgroundColor: colors.surfaceMuted }]}>
              {(['png', 'svg'] as QrExportFormat[]).map((format) => {
                const selected = exportFormat === format;

                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    key={format}
                    onPress={() => onFormatChange(format)}
                    style={[
                      styles.formatOption,
                      { backgroundColor: selected ? colors.surface : 'transparent' },
                    ]}>
                    <ThemedText
                      style={[
                        styles.formatOptionText,
                        { color: selected ? colors.primary : colors.mutedText },
                      ]}>
                      {format === 'png' ? 'PNG 图片' : 'SVG 矢量'}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.sheetSection}>
            <ThemedText style={styles.sheetLabel}>导出尺寸</ThemedText>
            <View style={[styles.sizeControl, { backgroundColor: colors.surfaceMuted }]}>
              {EXPORT_SIZES.map((size) => {
                const selected = exportSize === size;

                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    key={size}
                    onPress={() => onSizeChange(size)}
                    style={[
                      styles.sizeOption,
                      { backgroundColor: selected ? colors.primary : 'transparent' },
                    ]}>
                    <ThemedText
                      style={[
                        styles.sizeOptionText,
                        { color: selected ? '#ffffff' : colors.mutedText },
                      ]}>
                      {size}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={[styles.settingRow, { borderColor: colors.line }]}>
            <View style={styles.switchCopy}>
              <ThemedText style={styles.switchTitle}>透明背景</ThemedText>
              <ThemedText style={[styles.switchHint, { color: colors.mutedText }]}>
                PNG 保留中心标识，SVG 输出纯矢量模块
              </ThemedText>
            </View>
            <Switch
              accessibilityLabel="透明背景"
              onValueChange={onTransparentChange}
              thumbColor="#ffffff"
              trackColor={{ false: colors.line, true: colors.primary }}
              value={transparent}
            />
          </View>

          <View style={styles.sheetActions}>
            <Pressable
              accessibilityRole="button"
              disabled={Boolean(busyAction)}
              onPress={onSave}
              style={[styles.saveButton, { backgroundColor: colors.primary }]}>
              {busyAction === 'save' ? (
                <ActivityIndicator color="#ffffff" size="small" />
              ) : (
                <MaterialCommunityIcons name="download-box-outline" size={20} color="#ffffff" />
              )}
              <ThemedText style={styles.saveButtonText}>
                {Platform.OS !== 'web' && exportFormat === 'png' ? '保存到相册' : '导出文件'}
              </ThemedText>
            </Pressable>
            <Pressable
              accessibilityLabel="分享二维码"
              accessibilityRole="button"
              disabled={Boolean(busyAction)}
              onPress={onShare}
              style={[styles.shareButton, { backgroundColor: colors.primarySoft }]}>
              {busyAction === 'share' ? (
                <ActivityIndicator color={colors.primary} size="small" />
              ) : (
                <MaterialCommunityIcons name="share-variant-outline" size={21} color={colors.primary} />
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function HistorySheet({
  history,
  onClose,
  onSelect,
  visible,
}: {
  history: QrHistoryItem[];
  onClose: () => void;
  onSelect: (item: QrHistoryItem) => void;
  visible: boolean;
}) {
  const { colors } = useAppTheme();

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.modalRoot}>
        <Pressable accessibilityLabel="关闭历史记录" onPress={onClose} style={styles.modalScrim} />
        <View style={[styles.historySheet, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <View style={[styles.sheetHandle, { backgroundColor: colors.line }]} />
          <View style={styles.sheetHeader}>
            <View style={styles.sheetTitleBlock}>
              <ThemedText style={styles.sheetTitle}>本次生成记录</ThemedText>
              <ThemedText style={[styles.sheetSubtitle, { color: colors.mutedText }]}>
                保存或分享后会记录最近 5 条
              </ThemedText>
            </View>
            <Pressable
              accessibilityLabel="关闭"
              accessibilityRole="button"
              onPress={onClose}
              style={[styles.sheetClose, { backgroundColor: colors.surfaceMuted }]}>
              <MaterialCommunityIcons name="close" size={20} color={colors.text} />
            </Pressable>
          </View>

          {history.length ? (
            <ScrollView contentContainerStyle={styles.historyList} showsVerticalScrollIndicator={false}>
              {history.map((item) => {
                const typeLabel = CONTENT_TYPES.find((entry) => entry.id === item.type)?.label ?? '内容';

                return (
                  <Pressable
                    accessibilityRole="button"
                    key={item.id}
                    onPress={() => onSelect(item)}
                    style={[styles.historyRow, { borderColor: colors.line }]}>
                    <View style={[styles.historyIcon, { backgroundColor: `${item.color}18` }]}>
                      <MaterialCommunityIcons name="qrcode" size={22} color={item.color} />
                    </View>
                    <View style={styles.historyCopy}>
                      <ThemedText numberOfLines={1} style={styles.historyTitle}>{item.caption}</ThemedText>
                      <ThemedText style={[styles.historyMeta, { color: colors.mutedText }]}>
                        {typeLabel} · {item.savedAt}
                      </ThemedText>
                    </View>
                    <MaterialCommunityIcons name="chevron-right" size={20} color={colors.mutedText} />
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : (
            <View style={styles.emptyHistory}>
              <View style={[styles.emptyHistoryIcon, { backgroundColor: colors.surfaceMuted }]}>
                <MaterialCommunityIcons name="history" size={30} color={colors.mutedText} />
              </View>
              <ThemedText style={styles.emptyHistoryTitle}>还没有生成记录</ThemedText>
              <ThemedText style={[styles.emptyHistoryText, { color: colors.mutedText }]}>
                成功保存或分享二维码后，可以从这里快速恢复内容和样式。
              </ThemedText>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screenContent: {
    gap: 12,
    paddingHorizontal: 0,
    paddingTop: 4,
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    marginHorizontal: 14,
    minHeight: 48,
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: 14,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  pageTitle: {
    flex: 1,
    fontSize: 19,
    fontWeight: '800',
    lineHeight: 25,
    textAlign: 'center',
  },
  historyButton: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    minHeight: 38,
    width: 38,
  },
  historyButtonText: {
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 18,
  },
  typeTabs: {
    borderRadius: 17,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 3,
    marginHorizontal: 16,
    padding: 4,
  },
  typeTab: {
    alignItems: 'center',
    borderRadius: 13,
    flex: 1,
    gap: 3,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 3,
  },
  typeTabText: {
    fontSize: 10,
    fontWeight: '800',
    lineHeight: 14,
  },
  previewStage: {
    alignItems: 'center',
    borderRadius: 25,
    borderWidth: 1,
    marginHorizontal: 16,
    minHeight: 310,
    padding: 16,
  },
  previewHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
  },
  previewTitle: {
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
  },
  previewStatus: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    minHeight: 20,
  },
  statusDot: {
    borderRadius: 999,
    height: 7,
    width: 7,
  },
  previewStatusText: {
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 15,
  },
  qrPaper: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    position: 'relative',
    shadowColor: '#214b40',
    shadowOffset: { height: 12, width: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
  },
  qrLogo: {
    alignItems: 'center',
    backgroundColor: QR_CORAL,
    borderColor: '#ffffff',
    borderWidth: 4,
    height: 40,
    justifyContent: 'center',
    left: '50%',
    marginLeft: -20,
    marginTop: -20,
    position: 'absolute',
    top: '50%',
    width: 40,
  },
  qrLogoText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '900',
    lineHeight: 20,
  },
  previewCaption: {
    fontSize: 10,
    lineHeight: 15,
    marginTop: 9,
    maxWidth: '90%',
  },
  section: {
    borderRadius: 19,
    borderWidth: 1,
    gap: 10,
    marginHorizontal: 16,
    padding: 14,
  },
  sectionHeading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
  },
  sectionTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
  },
  sectionMeta: {
    fontSize: 10,
    lineHeight: 15,
  },
  textField: {
    alignItems: 'center',
    borderRadius: 14,
    flexDirection: 'row',
    gap: 9,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  textInput: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    minHeight: 42,
    paddingVertical: 9,
  },
  multilineInput: {
    borderRadius: 14,
    fontSize: 13,
    lineHeight: 20,
    minHeight: 90,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  errorRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 7,
  },
  errorText: {
    color: QR_CORAL,
    flex: 1,
    fontSize: 11,
    lineHeight: 17,
  },
  securityControl: {
    borderRadius: 13,
    flexDirection: 'row',
    gap: 3,
    padding: 3,
  },
  securityOption: {
    alignItems: 'center',
    borderRadius: 10,
    flex: 1,
    justifyContent: 'center',
    minHeight: 34,
  },
  securityText: {
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 16,
  },
  switchRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    minHeight: 42,
  },
  switchCopy: {
    flex: 1,
    gap: 1,
  },
  switchTitle: {
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 17,
  },
  switchHint: {
    fontSize: 10,
    lineHeight: 15,
  },
  styleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
  },
  swatchRow: {
    flexDirection: 'row',
    gap: 8,
  },
  swatch: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 3,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  cornerControl: {
    borderRadius: 12,
    flexDirection: 'row',
    gap: 2,
    padding: 3,
  },
  cornerOption: {
    alignItems: 'center',
    borderRadius: 9,
    justifyContent: 'center',
    minHeight: 30,
    paddingHorizontal: 11,
  },
  cornerOptionText: {
    fontSize: 10,
    fontWeight: '800',
    lineHeight: 15,
  },
  feedbackBar: {
    alignItems: 'flex-start',
    borderRadius: 15,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    marginHorizontal: 16,
    padding: 11,
  },
  feedbackText: {
    flex: 1,
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 17,
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 18,
    elevation: 3,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    marginHorizontal: 16,
    minHeight: 54,
    paddingHorizontal: 18,
    shadowOffset: { height: 12, width: 0 },
    shadowOpacity: 0.24,
    shadowRadius: 22,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 20,
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(12, 20, 36, 0.58)',
  },
  exportSheet: {
    alignSelf: 'center',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    gap: 16,
    maxWidth: 430,
    paddingBottom: 28,
    paddingHorizontal: 18,
    paddingTop: 9,
    width: '100%',
  },
  historySheet: {
    alignSelf: 'center',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    gap: 16,
    maxHeight: '78%',
    maxWidth: 430,
    minHeight: 340,
    paddingBottom: 28,
    paddingHorizontal: 18,
    paddingTop: 9,
    width: '100%',
  },
  sheetHandle: {
    alignSelf: 'center',
    borderRadius: 999,
    height: 4,
    width: 42,
  },
  sheetHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  sheetTitleBlock: {
    flex: 1,
    gap: 2,
  },
  sheetTitle: {
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 26,
  },
  sheetSubtitle: {
    fontSize: 11,
    lineHeight: 16,
  },
  sheetClose: {
    alignItems: 'center',
    borderRadius: 14,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  exportPreview: {
    alignItems: 'center',
    borderRadius: 18,
    flexDirection: 'row',
    gap: 12,
    padding: 11,
  },
  exportQr: {
    backgroundColor: '#ffffff',
    borderRadius: 11,
    padding: 6,
  },
  exportFileCopy: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  exportFileName: {
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 17,
  },
  exportFileMeta: {
    color: '#51746b',
    fontSize: 9,
    lineHeight: 14,
  },
  sheetSection: {
    gap: 8,
  },
  sheetLabel: {
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 17,
  },
  formatControl: {
    borderRadius: 14,
    flexDirection: 'row',
    gap: 3,
    padding: 3,
  },
  formatOption: {
    alignItems: 'center',
    borderRadius: 11,
    flex: 1,
    justifyContent: 'center',
    minHeight: 38,
  },
  formatOptionText: {
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 16,
  },
  sizeControl: {
    borderRadius: 14,
    flexDirection: 'row',
    gap: 3,
    padding: 3,
  },
  sizeOption: {
    alignItems: 'center',
    borderRadius: 11,
    flex: 1,
    justifyContent: 'center',
    minHeight: 36,
  },
  sizeOptionText: {
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 16,
  },
  settingRow: {
    alignItems: 'center',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    minHeight: 56,
    paddingTop: 12,
  },
  sheetActions: {
    flexDirection: 'row',
    gap: 9,
  },
  saveButton: {
    alignItems: 'center',
    borderRadius: 16,
    flex: 1,
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    minHeight: 52,
  },
  saveButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
  },
  shareButton: {
    alignItems: 'center',
    borderRadius: 16,
    justifyContent: 'center',
    minHeight: 52,
    width: 52,
  },
  historyList: {
    gap: 9,
  },
  historyRow: {
    alignItems: 'center',
    borderRadius: 17,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 11,
    minHeight: 68,
    padding: 11,
  },
  historyIcon: {
    alignItems: 'center',
    borderRadius: 13,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  historyCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  historyTitle: {
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
  },
  historyMeta: {
    fontSize: 10,
    lineHeight: 15,
  },
  emptyHistory: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    minHeight: 230,
    paddingHorizontal: 28,
  },
  emptyHistoryIcon: {
    alignItems: 'center',
    borderRadius: 18,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  emptyHistoryTitle: {
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 21,
    marginTop: 13,
  },
  emptyHistoryText: {
    fontSize: 11,
    lineHeight: 17,
    marginTop: 5,
    textAlign: 'center',
  },
});
