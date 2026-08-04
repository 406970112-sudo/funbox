import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useState, type ComponentProps } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { appLayout } from '@/constants/app-theme';
import { useAuth } from '@/features/auth/auth-provider';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  fetchPriceRadarSearch,
  getPriceRadarErrorMessage,
  submitPriceRadarReport,
} from '@/lib/price-radar-api';
import { PageErrorState } from '@/shared/ui/page-error-state';
import { PageLoadingFrame } from '@/shared/ui/page-loading-frame';
import type {
  PriceRadarAsset,
  PriceRadarOfficialPrice,
  PriceRadarReport,
  PriceRadarSearchResult,
  PriceRadarSourceStatus,
} from '@/types/price-radar';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];
type ThemeColors = ReturnType<typeof useAppTheme>['colors'];

const HERO = '#151b3b';
const BLUE = '#4b6bff';
const LIME = '#c9f36a';
const GREEN = '#24b36b';
const CORAL = '#ff5d6c';

const PROVINCES = [
  { code: '310000', label: '上海' },
  { code: '110000', label: '北京' },
  { code: '440000', label: '广东' },
  { code: '330000', label: '浙江' },
  { code: '320000', label: '江苏' },
  { code: '370000', label: '山东' },
  { code: '510000', label: '四川' },
  { code: '420000', label: '湖北' },
];

const STORE_TYPES = [
  { id: 'supermarket', label: '超市' },
  { id: 'wet_market', label: '菜市场' },
  { id: 'community_store', label: '社区店' },
  { id: 'other', label: '其他' },
];

const UNITS = ['元/500克', '元/公斤', '元/斤', '元/份'];

type ScreenView = 'home' | 'detail' | 'upload' | 'sources';

export function PriceRadarScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { accessToken, status: authStatus } = useAuth();
  const [view, setView] = useState<ScreenView>('home');
  const [query, setQuery] = useState('生菜');
  const [provinceCode, setProvinceCode] = useState('310000');
  const [result, setResult] = useState<PriceRadarSearchResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [assets, setAssets] = useState<PriceRadarAsset[]>([]);
  const [storeName, setStoreName] = useState('');
  const [storeType, setStoreType] = useState('wet_market');
  const [price, setPrice] = useState('');
  const [unit, setUnit] = useState('元/500克');
  const [purchaseDate, setPurchaseDate] = useState(todayString());

  async function handleSearch() {
    const trimmed = query.trim();
    if (!trimmed) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const next = await fetchPriceRadarSearch(trimmed, provinceCode);
      setResult(next);
      setView('detail');
    } catch (error) {
      setLoadError(getPriceRadarErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }

  async function handlePickImages() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const picked = await ImagePicker.launchImageLibraryAsync({
      allowsMultipleSelection: true,
      mediaTypes: ['images'],
      quality: 0.9,
      selectionLimit: 3 - assets.length,
    });
    if (picked.canceled || picked.assets.length === 0) return;
    const next = [...assets];
    for (const asset of picked.assets) {
      if (next.length >= 3) break;
      next.push({
        uri: asset.uri,
        fileName: asset.fileName ?? null,
        mimeType: asset.mimeType,
        fileSize: asset.fileSize,
      });
    }
    setAssets(next);
  }

  async function handleSubmitReport() {
    if (!accessToken) return;
    if (!result || !storeName.trim() || !price.trim() || !purchaseDate.trim()) return;
    setSubmitting(true);
    setSubmitted(false);
    try {
      await submitPriceRadarReport(
        accessToken,
        {
          productId: result.product.id,
          productName: result.product.name,
          storeName: storeName.trim(),
          storeType,
          price: Number(price),
          unit,
          purchaseDate: purchaseDate.trim(),
          address: '',
          latitude: 0,
          longitude: 0,
        },
        assets,
      );
      setSubmitted(true);
      setStoreName('');
      setPrice('');
      setAssets([]);
    } catch (error) {
      setLoadError(getPriceRadarErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  if (isLoading && !result) {
    return <PageLoadingFrame stateLabel="正在查真实菜价" title="菜价雷达" variant="panel" />;
  }

  if (loadError && !result && !isLoading) {
    return (
      <PageErrorState
        message={loadError}
        onRetry={() => void handleSearch()}
        title="菜价雷达"
      />
    );
  }

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.pageContent}>
      <View style={[styles.content, { maxWidth: appLayout.screenMaxWidth }]}>
        {view === 'home' ? (
          <HomeView
            colors={colors}
            query={query}
            setQuery={setQuery}
            provinceCode={provinceCode}
            setProvinceCode={setProvinceCode}
            onSearch={() => void handleSearch()}
            onSources={() => setView('sources')}
            onUpload={() => setView('upload')}
            result={result}
            onBack={() => router.back()}
          />
        ) : null}
        {view === 'detail' && result ? (
          <DetailView
            colors={colors}
            result={result}
            onBack={() => setView('home')}
            onUpload={() => setView('upload')}
            onSources={() => setView('sources')}
            onSearch={() => setView('home')}
          />
        ) : null}
        {view === 'upload' ? (
          <UploadView
            colors={colors}
            productName={result?.product.name ?? '生菜'}
            assets={assets}
            storeName={storeName}
            setStoreName={setStoreName}
            storeType={storeType}
            setStoreType={setStoreType}
            price={price}
            setPrice={setPrice}
            unit={unit}
            setUnit={setUnit}
            purchaseDate={purchaseDate}
            setPurchaseDate={setPurchaseDate}
            onPickImages={() => void handlePickImages()}
            onRemoveImage={(index) => setAssets((current) => current.filter((_, i) => i !== index))}
            submitting={submitting}
            submitted={submitted}
            onSubmit={() => void handleSubmitReport()}
            canSubmit={Boolean(accessToken)}
            authStatus={authStatus}
            onBack={() => setView(result ? 'detail' : 'home')}
            onAuth={() => router.push('/auth')}
          />
        ) : null}
        {view === 'sources' ? (
          <SourcesView
            colors={colors}
            sources={result?.sources ?? []}
            onBack={() => setView(result ? 'detail' : 'home')}
          />
        ) : null}
      </View>
    </ScrollView>
  );
}

function HomeView({
  colors,
  query,
  setQuery,
  provinceCode,
  setProvinceCode,
  onSearch,
  onSources,
  onUpload,
  result,
  onBack,
}: {
  colors: ThemeColors;
  query: string;
  setQuery: (value: string) => void;
  provinceCode: string;
  setProvinceCode: (value: string) => void;
  onSearch: () => void;
  onSources: () => void;
  onUpload: () => void;
  result: PriceRadarSearchResult | null;
  onBack: () => void;
}) {
  return (
    <View style={styles.screen}>
      <TopBar colors={colors} title="菜价雷达" onBack={onBack} rightIcon="database-outline" onRight={onSources} />
      <View style={[styles.locationRow, { borderColor: colors.line }]}>
        <MaterialCommunityIcons name="map-marker-radius-outline" size={15} color={GREEN} />
        <ThemedText style={styles.locationText}>选择省份</ThemedText>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.provinceList}>
          {PROVINCES.map((province) => {
            const active = province.code === provinceCode;
            return (
              <Pressable
                key={province.code}
                accessibilityRole="button"
                onPress={() => setProvinceCode(province.code)}
                style={[
                  styles.provinceChip,
                  { borderColor: active ? GREEN : colors.line, backgroundColor: active ? '#e4f7ee' : colors.surface },
                ]}>
                <ThemedText style={[styles.provinceText, { color: active ? GREEN : colors.mutedText }]}>
                  {province.label}
                </ThemedText>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
      <View style={[styles.searchShell, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <MaterialCommunityIcons name="magnify" size={19} color={colors.mutedText} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={onSearch}
          placeholder="搜菜名，如 生菜、菠菜、土豆"
          placeholderTextColor={colors.mutedText}
          selectionColor={colors.primary}
          style={[styles.searchInput, { color: colors.text }]}
        />
        <Pressable
          accessibilityRole="button"
          onPress={onSearch}
          style={[styles.searchButton, { backgroundColor: HERO }]}>
          <ThemedText style={styles.searchButtonText}>查询</ThemedText>
        </Pressable>
      </View>
      <View style={styles.sourceStrip}>
        <View style={[styles.realChip, { backgroundColor: '#e4f7ee' }]}>
          <MaterialCommunityIcons name="check-decagram" size={13} color={GREEN} />
          <ThemedText style={[styles.realChipText, { color: GREEN }]}>真实数据</ThemedText>
        </View>
        <ThemedText style={[styles.sourceStripText, { color: colors.mutedText }]}>
          农业农村部信息中心 · 按日更新
        </ThemedText>
      </View>
      {result ? (
        <OfficialReferenceCard colors={colors} prices={result.officialReference} />
      ) : (
        <View style={[styles.heroCard, { backgroundColor: HERO }]}>
          <View style={styles.heroIcon}>
            <MaterialCommunityIcons name="shopping-outline" size={26} color={LIME} />
          </View>
          <ThemedText style={styles.heroTitle}>查真实菜价，不猜价</ThemedText>
          <ThemedText style={styles.heroBody}>
            官方批发参考来自农业农村部信息中心，附近报价只展示用户凭证与合作商户正式数据。
          </ThemedText>
          <Pressable accessibilityRole="button" onPress={onSearch} style={[styles.heroButton, { backgroundColor: LIME }]}>
            <MaterialCommunityIcons name="magnify" size={16} color={HERO} />
            <ThemedText style={styles.heroButtonText}>查询{query || '生菜'}</ThemedText>
          </Pressable>
        </View>
      )}
      <NearbyEmptyState colors={colors} onUpload={onUpload} />
      <View style={[styles.ruleCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <MaterialCommunityIcons name="shield-check-outline" size={17} color={GREEN} />
        <ThemedText style={[styles.ruleText, { color: colors.mutedText }]}>
          官方数据不可用时显示错误或 stale，不会回退演示数据。
        </ThemedText>
      </View>
    </View>
  );
}

function DetailView({
  colors,
  result,
  onBack,
  onUpload,
  onSources,
  onSearch,
}: {
  colors: ThemeColors;
  result: PriceRadarSearchResult;
  onBack: () => void;
  onUpload: () => void;
  onSources: () => void;
  onSearch: () => void;
}) {
  return (
    <View style={styles.screen}>
      <TopBar colors={colors} title={result.product.name} onBack={onBack} rightIcon="database-outline" onRight={onSources} />
      <View style={[styles.detailHero, { backgroundColor: HERO }]}>
        <View style={styles.detailKicker}>
          <MaterialCommunityIcons name="bank-outline" size={13} color={LIME} />
          <ThemedText style={styles.detailKickerText}>官方批发参考</ThemedText>
        </View>
        <ThemedText style={styles.detailTitle}>{result.product.name}</ThemedText>
        <ThemedText style={styles.detailAlias}>
          {result.product.category} · {result.product.subCategory} · 单位 {result.product.unit}
        </ThemedText>
        {result.officialReference[0] ? (
          <View style={styles.detailPriceRow}>
            <ThemedText style={styles.detailPrice}>{result.officialReference[0].price.toFixed(2)}</ThemedText>
            <ThemedText style={styles.detailPriceUnit}>{result.officialReference[0].unit}</ThemedText>
          </View>
        ) : null}
        <ThemedText style={styles.detailMeta}>
          {result.officialReference[0]?.capturedAt || '官方数据按日发布'} · 农业农村部信息中心
        </ThemedText>
      </View>
      <OfficialReferenceCard colors={colors} prices={result.officialReference} />
      <SectionHead colors={colors} title="附近用户报价" action="按距离排序" />
      {result.nearbyReports.length === 0 ? (
        <EmptyState
          colors={colors}
          icon="basket-outline"
          title="附近还没有用户凭证报价"
          body="用户上传小票并经核验后显示在这里，不填充演示价格"
          actionLabel="上传凭证"
          onAction={onUpload}
        />
      ) : (
        <View style={styles.reportList}>
          {result.nearbyReports.map((report) => (
            <ReportRow key={report.id} colors={colors} report={report} />
          ))}
        </View>
      )}
      <View style={styles.detailActions}>
        <Pressable
          accessibilityRole="button"
          onPress={onUpload}
          style={[styles.primaryButton, { backgroundColor: GREEN }]}>
          <MaterialCommunityIcons name="camera-outline" size={17} color="#ffffff" />
          <ThemedText style={styles.primaryButtonText}>上传凭证</ThemedText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onSearch}
          style={[styles.secondaryButton, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <MaterialCommunityIcons name="magnify" size={17} color={colors.text} />
          <ThemedText style={[styles.secondaryButtonText, { color: colors.text }]}>换个菜</ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

function OfficialReferenceCard({ colors, prices }: { colors: ThemeColors; prices: PriceRadarOfficialPrice[] }) {
  if (prices.length === 0) {
    return (
      <View style={[styles.officialCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <SectionLabel colors={colors} label="官方批发参考" />
        <ThemedText style={[styles.emptyOfficial, { color: colors.mutedText }]}>
          官方数据源暂未返回该地区价格，不展示估算值。
        </ThemedText>
      </View>
    );
  }
  return (
    <View style={[styles.officialCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <SectionLabel colors={colors} label="官方批发参考 · 元/公斤" />
      {prices.slice(0, 3).map((price, index) => (
        <View
          key={`${price.marketId}-${index}`}
          style={[styles.marketRow, index > 0 && { borderTopColor: colors.line, borderTopWidth: 1 }]}>
          <View style={styles.marketCopy}>
            <ThemedText style={styles.marketName}>{price.marketName || price.enterpriseName}</ThemedText>
            <ThemedText style={[styles.marketMeta, { color: colors.mutedText }]}>
              {price.capturedAt} · {price.source}
            </ThemedText>
          </View>
          <View style={styles.marketPrice}>
            <ThemedText style={[styles.marketPriceValue, { color: GREEN }]}>
              {price.price.toFixed(2)}
            </ThemedText>
            <ThemedText style={[styles.marketPriceUnit, { color: colors.mutedText }]}>
              {price.unit}
            </ThemedText>
          </View>
        </View>
      ))}
      <View style={[styles.sourceLine, { backgroundColor: colors.surfaceMuted }]}>
        <MaterialCommunityIcons name="database-outline" size={12} color={colors.mutedText} />
        <ThemedText style={[styles.sourceLineText, { color: colors.mutedText }]}>
          全国农产品批发市场价格信息系统
        </ThemedText>
      </View>
    </View>
  );
}

function UploadView({
  colors,
  productName,
  assets,
  storeName,
  setStoreName,
  storeType,
  setStoreType,
  price,
  setPrice,
  unit,
  setUnit,
  purchaseDate,
  setPurchaseDate,
  onPickImages,
  onRemoveImage,
  submitting,
  submitted,
  onSubmit,
  canSubmit,
  authStatus,
  onBack,
  onAuth,
}: {
  colors: ThemeColors;
  productName: string;
  assets: PriceRadarAsset[];
  storeName: string;
  setStoreName: (value: string) => void;
  storeType: string;
  setStoreType: (value: string) => void;
  price: string;
  setPrice: (value: string) => void;
  unit: string;
  setUnit: (value: string) => void;
  purchaseDate: string;
  setPurchaseDate: (value: string) => void;
  onPickImages: () => void;
  onRemoveImage: (index: number) => void;
  submitting: boolean;
  submitted: boolean;
  onSubmit: () => void;
  canSubmit: boolean;
  authStatus: string;
  onBack: () => void;
  onAuth: () => void;
}) {
  return (
    <View style={styles.screen}>
      <TopBar colors={colors} title="上传凭证" onBack={onBack} />
      <Pressable accessibilityRole="button" onPress={onPickImages} style={[styles.uploadZone, { borderColor: colors.primary }]}>
        <MaterialCommunityIcons name="camera-plus-outline" size={26} color={colors.primary} />
        <ThemedText style={styles.uploadTitle}>添加凭证照片</ThemedText>
        <ThemedText style={[styles.uploadSub, { color: colors.mutedText }]}>
          最多 3 张 · 相机 / 相册 · 请拍清晰原图
        </ThemedText>
      </Pressable>
      {assets.length > 0 ? (
        <View style={styles.imageGrid}>
          {assets.map((asset, index) => (
            <View key={`${asset.uri}-${index}`} style={styles.imageTile}>
              <Image source={{ uri: asset.uri }} style={styles.imagePreview} />
              <Pressable
                accessibilityLabel={`移除第 ${index + 1} 张图片`}
                accessibilityRole="button"
                onPress={() => onRemoveImage(index)}
                style={styles.removeImage}>
                <MaterialCommunityIcons name="close" size={13} color="#ffffff" />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      <View style={[styles.formCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <FormField label="商品名称" value={productName} />
        <FormInput label="商户名称" placeholder="输入市场或超市名称" value={storeName} onChangeText={setStoreName} colors={colors} />
        <View style={styles.formRow}>
          <ThemedText style={[styles.fieldLabel, { color: colors.mutedText }]}>商户类型</ThemedText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.unitChips}>
            {STORE_TYPES.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                onPress={() => setStoreType(item.id)}
                style={[
                  styles.unitChip,
                  {
                    backgroundColor: storeType === item.id ? '#e4f7ee' : colors.surfaceMuted,
                    borderColor: storeType === item.id ? GREEN : colors.line,
                  },
                ]}>
                <ThemedText style={[styles.unitChipText, { color: storeType === item.id ? GREEN : colors.mutedText }]}>
                  {item.label}
                </ThemedText>
              </Pressable>
            ))}
          </ScrollView>
        </View>
        <View style={styles.formRow}>
          <ThemedText style={[styles.fieldLabel, { color: colors.mutedText }]}>单价</ThemedText>
          <TextInput
            keyboardType="decimal-pad"
            placeholder="输入价格"
            placeholderTextColor={colors.mutedText}
            value={price}
            onChangeText={setPrice}
            style={[styles.formInput, { backgroundColor: colors.surfaceMuted, color: colors.text }]}
          />
        </View>
        <View style={styles.formRow}>
          <ThemedText style={[styles.fieldLabel, { color: colors.mutedText }]}>单位</ThemedText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.unitChips}>
            {UNITS.map((item) => (
              <Pressable
                key={item}
                accessibilityRole="button"
                onPress={() => setUnit(item)}
                style={[
                  styles.unitChip,
                  {
                    backgroundColor: unit === item ? '#e4f7ee' : colors.surfaceMuted,
                    borderColor: unit === item ? GREEN : colors.line,
                  },
                ]}>
                <ThemedText style={[styles.unitChipText, { color: unit === item ? GREEN : colors.mutedText }]}>
                  {item}
                </ThemedText>
              </Pressable>
            ))}
          </ScrollView>
        </View>
        <FormInput label="购买日期" placeholder="YYYY-MM-DD" value={purchaseDate} onChangeText={setPurchaseDate} colors={colors} />
      </View>
      <View style={[styles.ruleCard, { backgroundColor: '#fff5e6', borderColor: '#f7e1bd' }]}>
        <MaterialCommunityIcons name="shield-check-outline" size={17} color="#9a6418" />
        <ThemedText style={styles.ruleText}>
          提交后进入人工核验，核验前不会标记为已确认价；请上传真实原图凭证。
        </ThemedText>
      </View>
      {submitted ? (
        <View style={[styles.successCard, { backgroundColor: '#e4f7ee', borderColor: '#bfe9d1' }]}>
          <MaterialCommunityIcons name="check-circle-outline" size={18} color={GREEN} />
          <ThemedText style={[styles.successText, { color: GREEN }]}>凭证已提交，进入待核验队列。</ThemedText>
        </View>
      ) : null}
      {!canSubmit ? (
        <Pressable
          accessibilityRole="button"
          onPress={onAuth}
          style={[styles.primaryButton, { backgroundColor: HERO }]}>
          <MaterialCommunityIcons name="login-variant" size={17} color={LIME} />
          <ThemedText style={[styles.primaryButtonText, { color: LIME }]}>
            {authStatus === 'loading' ? '正在检查登录' : '登录后上传凭证'}
          </ThemedText>
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="button"
          disabled={submitting}
          onPress={onSubmit}
          style={[styles.primaryButton, { backgroundColor: GREEN, opacity: submitting ? 0.7 : 1 }]}>
          {submitting ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <MaterialCommunityIcons name="send-outline" size={17} color="#ffffff" />
          )}
          <ThemedText style={styles.primaryButtonText}>{submitting ? '正在提交' : '提交待核验'}</ThemedText>
        </Pressable>
      )}
    </View>
  );
}

function SourcesView({
  colors,
  sources,
  onBack,
}: {
  colors: ThemeColors;
  sources: PriceRadarSourceStatus[];
  onBack: () => void;
}) {
  return (
    <View style={styles.screen}>
      <TopBar colors={colors} title="数据来源与规则" onBack={onBack} />
      <View style={styles.sourcePrincipleRow}>
        <PrincipleCard icon="bank-outline" title="官方基准" body="批发/零售监测，保留来源与日期" />
        <PrincipleCard icon="store-outline" title="合作商户" body="正式授权接口才展示" />
        <PrincipleCard icon="receipt-text-outline" title="用户凭证" body="人工核验后进入公开列表" />
        <PrincipleCard icon="close-circle-outline" title="禁止 mock" body="数据缺失显示空态" />
      </View>
      <View style={[styles.sourceList, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        {sources.length > 0 ? (
          sources.map((source) => (
            <View key={source.id} style={[styles.sourceRow, { borderBottomColor: colors.line }]}>
              <View style={[styles.sourceIcon, { backgroundColor: colors.primarySoft }]}>
                <MaterialCommunityIcons name={sourceIcon(source.kind)} size={16} color={colors.primary} />
              </View>
              <View style={styles.sourceCopy}>
                <ThemedText style={styles.sourceName}>{source.name}</ThemedText>
                <ThemedText style={[styles.sourceDetail, { color: colors.mutedText }]}>{source.detail}</ThemedText>
              </View>
              <ThemedText style={[styles.sourceStatus, { color: GREEN }]}>{source.status}</ThemedText>
            </View>
          ))
        ) : (
          <ThemedText style={[styles.emptySource, { color: colors.mutedText }]}>
            数据来源状态将在首次查询后展示。
          </ThemedText>
        )}
      </View>
      <View style={[styles.noticeCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <MaterialCommunityIcons name="close-octagon-outline" size={18} color={CORAL} />
        <View style={styles.noticeCopy}>
          <ThemedText style={styles.noticeTitle}>无 mock 保障</ThemedText>
          <ThemedText style={[styles.noticeBody, { color: colors.mutedText }]}>
            任何数据源不可用时显示错误、重试或 stale 标记，绝不回退演示数据。
          </ThemedText>
        </View>
      </View>
    </View>
  );
}

function NearbyEmptyState({ colors, onUpload }: { colors: ThemeColors; onUpload: () => void }) {
  return (
    <View style={styles.section}>
      <SectionHead colors={colors} title="附近用户报价" action="按距离排序" />
      <View style={[styles.emptyCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <View style={[styles.emptyIcon, { backgroundColor: '#e4f7ee' }]}>
          <MaterialCommunityIcons name="basket-outline" size={22} color={GREEN} />
        </View>
        <ThemedText style={styles.emptyTitle}>附近还没有用户凭证报价</ThemedText>
        <ThemedText style={[styles.emptyBody, { color: colors.mutedText }]}>
          真实凭证经核验后显示在这里，不会填充演示价格
        </ThemedText>
        <Pressable
          accessibilityRole="button"
          onPress={onUpload}
          style={[styles.emptyButton, { backgroundColor: GREEN }]}>
          <MaterialCommunityIcons name="camera-outline" size={16} color="#ffffff" />
          <ThemedText style={styles.emptyButtonText}>上传凭证</ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

function ReportRow({ colors, report }: { colors: ThemeColors; report: PriceRadarReport }) {
  return (
    <View style={[styles.reportRow, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <View style={styles.reportIcon}>
        <MaterialCommunityIcons name="store-outline" size={18} color={GREEN} />
      </View>
      <View style={styles.reportCopy}>
        <ThemedText style={styles.reportName}>{report.storeName}</ThemedText>
        <ThemedText style={[styles.reportMeta, { color: colors.mutedText }]}>
          {report.purchaseDate} · {report.status === 'verified' ? '已核验' : '待核验'}
        </ThemedText>
      </View>
      <View style={styles.reportPrice}>
        <ThemedText style={[styles.reportPriceValue, { color: GREEN }]}>{report.price.toFixed(2)}</ThemedText>
        <ThemedText style={[styles.reportPriceUnit, { color: colors.mutedText }]}>{report.unit}</ThemedText>
      </View>
    </View>
  );
}

function PrincipleCard({ icon, title, body }: { icon: IconName; title: string; body: string }) {
  return (
    <View style={styles.principleCard}>
      <View style={styles.principleIcon}>
        <MaterialCommunityIcons name={icon} size={15} color={GREEN} />
      </View>
      <ThemedText style={styles.principleTitle}>{title}</ThemedText>
      <ThemedText style={styles.principleBody}>{body}</ThemedText>
    </View>
  );
}

function TopBar({
  colors,
  title,
  onBack,
  rightIcon,
  onRight,
}: {
  colors: ThemeColors;
  title: string;
  onBack: () => void;
  rightIcon?: IconName;
  onRight?: () => void;
}) {
  return (
    <View style={styles.topBar}>
      <Pressable
        accessibilityLabel="返回"
        accessibilityRole="button"
        onPress={onBack}
        style={[styles.topBarButton, { backgroundColor: colors.surface }]}>
        <MaterialCommunityIcons name="arrow-left" size={20} color={colors.text} />
      </Pressable>
      <View style={styles.topBarTitle}>
        <View style={[styles.topBarMark, { backgroundColor: GREEN }]}>
          <MaterialCommunityIcons name="basket-outline" size={15} color="#ffffff" />
        </View>
        <ThemedText style={styles.topBarText}>{title}</ThemedText>
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={onRight}
        style={[styles.topBarButton, { backgroundColor: colors.surface, opacity: rightIcon ? 1 : 0 }]}>
        {rightIcon ? <MaterialCommunityIcons name={rightIcon} size={19} color={colors.text} /> : null}
      </Pressable>
    </View>
  );
}

function SectionHead({ colors, title, action }: { colors: ThemeColors; title: string; action?: string }) {
  return (
    <View style={styles.sectionHead}>
      <ThemedText style={styles.sectionTitle}>{title}</ThemedText>
      {action ? <ThemedText style={[styles.sectionAction, { color: colors.mutedText }]}>{action}</ThemedText> : null}
    </View>
  );
}

function SectionLabel({ colors, label }: { colors: ThemeColors; label: string }) {
  return <ThemedText style={[styles.sectionLabel, { color: colors.mutedText }]}>{label}</ThemedText>;
}

function EmptyState({
  colors,
  icon,
  title,
  body,
  actionLabel,
  onAction,
}: {
  colors: ThemeColors;
  icon: IconName;
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={[styles.emptyCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <View style={[styles.emptyIcon, { backgroundColor: '#e4f7ee' }]}>
        <MaterialCommunityIcons name={icon} size={22} color={GREEN} />
      </View>
      <ThemedText style={styles.emptyTitle}>{title}</ThemedText>
      <ThemedText style={[styles.emptyBody, { color: colors.mutedText }]}>{body}</ThemedText>
      {actionLabel && onAction ? (
        <Pressable accessibilityRole="button" onPress={onAction} style={[styles.emptyButton, { backgroundColor: GREEN }]}>
          <MaterialCommunityIcons name="camera-outline" size={16} color="#ffffff" />
          <ThemedText style={styles.emptyButtonText}>{actionLabel}</ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

function FormField({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.formRow}>
      <ThemedText style={styles.fieldLabel}>{label}</ThemedText>
      <ThemedText style={styles.fieldValue}>{value}</ThemedText>
    </View>
  );
}

function FormInput({
  label,
  placeholder,
  value,
  onChangeText,
  colors,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChangeText: (value: string) => void;
  colors: ThemeColors;
}) {
  return (
    <View style={styles.formRow}>
      <ThemedText style={[styles.fieldLabel, { color: colors.mutedText }]}>{label}</ThemedText>
      <TextInput
        placeholder={placeholder}
        placeholderTextColor={colors.mutedText}
        value={value}
        onChangeText={onChangeText}
        style={[styles.formInput, { backgroundColor: colors.surfaceMuted, color: colors.text }]}
      />
    </View>
  );
}

function sourceIcon(kind: string): IconName {
  if (kind === 'user') return 'receipt-text-outline';
  if (kind === 'partner') return 'store-outline';
  return 'database-outline';
}

function todayString() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

const styles = StyleSheet.create({
  pageContent: {
    backgroundColor: 'transparent',
    paddingBottom: 40,
    paddingTop: 8,
  },
  content: {
    alignSelf: 'center',
    gap: 12,
    paddingHorizontal: 16,
    width: '100%',
  },
  screen: {
    gap: 12,
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    height: 52,
    justifyContent: 'space-between',
  },
  topBarButton: {
    alignItems: 'center',
    borderRadius: 10,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  topBarTitle: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  topBarMark: {
    alignItems: 'center',
    borderRadius: 9,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  topBarText: {
    fontSize: 17,
    fontWeight: '900',
  },
  locationRow: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 46,
    paddingHorizontal: 12,
  },
  locationText: {
    fontSize: 11,
    fontWeight: '800',
  },
  provinceList: {
    gap: 7,
    paddingRight: 4,
  },
  provinceChip: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    height: 28,
    justifyContent: 'center',
    paddingHorizontal: 11,
  },
  provinceText: {
    fontSize: 10,
    fontWeight: '800',
  },
  searchShell: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    height: 48,
    paddingHorizontal: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    minWidth: 0,
  },
  searchButton: {
    alignItems: 'center',
    borderRadius: 10,
    height: 34,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  searchButtonText: {
    color: LIME,
    fontSize: 11,
    fontWeight: '900',
  },
  sourceStrip: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  realChip: {
    alignItems: 'center',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 4,
    height: 24,
    paddingHorizontal: 9,
  },
  realChipText: {
    fontSize: 9,
    fontWeight: '900',
  },
  sourceStripText: {
    fontSize: 9,
    fontWeight: '700',
  },
  heroCard: {
    borderRadius: 14,
    padding: 16,
  },
  heroIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 10,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  heroTitle: {
    color: '#ffffff',
    fontSize: 19,
    fontWeight: '900',
    marginTop: 12,
  },
  heroBody: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 11,
    lineHeight: 18,
    marginTop: 6,
  },
  heroButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 10,
    flexDirection: 'row',
    gap: 6,
    height: 38,
    marginTop: 14,
    paddingHorizontal: 14,
  },
  heroButtonText: {
    color: HERO,
    fontSize: 11,
    fontWeight: '900',
  },
  officialCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 13,
  },
  sectionLabel: {
    fontSize: 9,
    fontWeight: '800',
    marginBottom: 8,
  },
  emptyOfficial: {
    fontSize: 10,
    lineHeight: 16,
  },
  marketRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 9,
  },
  marketCopy: {
    flex: 1,
    minWidth: 0,
  },
  marketName: {
    fontSize: 12,
    fontWeight: '900',
  },
  marketMeta: {
    fontSize: 8.5,
    fontWeight: '700',
    marginTop: 3,
  },
  marketPrice: {
    alignItems: 'flex-end',
  },
  marketPriceValue: {
    fontSize: 18,
    fontWeight: '900',
  },
  marketPriceUnit: {
    fontSize: 8.5,
    fontWeight: '700',
    marginTop: 1,
  },
  sourceLine: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 5,
    marginTop: 8,
    padding: 8,
  },
  sourceLineText: {
    fontSize: 8.5,
    fontWeight: '800',
  },
  section: {
    gap: 8,
  },
  sectionHead: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '900',
  },
  sectionAction: {
    fontSize: 9,
    fontWeight: '700',
  },
  emptyCard: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    padding: 22,
  },
  emptyIcon: {
    alignItems: 'center',
    borderRadius: 50,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  emptyTitle: {
    fontSize: 13,
    fontWeight: '900',
    marginTop: 10,
  },
  emptyBody: {
    fontSize: 10,
    lineHeight: 16,
    marginTop: 6,
    textAlign: 'center',
  },
  emptyButton: {
    alignItems: 'center',
    borderRadius: 10,
    flexDirection: 'row',
    gap: 6,
    height: 38,
    marginTop: 14,
    paddingHorizontal: 14,
  },
  emptyButtonText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '900',
  },
  ruleCard: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    padding: 12,
  },
  ruleText: {
    color: '#9a6418',
    flex: 1,
    fontSize: 9.5,
    lineHeight: 16,
  },
  detailHero: {
    borderRadius: 14,
    padding: 15,
  },
  detailKicker: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 5,
  },
  detailKickerText: {
    color: LIME,
    fontSize: 9,
    fontWeight: '900',
  },
  detailTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '900',
    marginTop: 8,
  },
  detailAlias: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 9,
    fontWeight: '700',
    marginTop: 3,
  },
  detailPriceRow: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: 7,
    marginTop: 10,
  },
  detailPrice: {
    color: '#ffffff',
    fontSize: 30,
    fontWeight: '900',
  },
  detailPriceUnit: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 10,
    fontWeight: '800',
  },
  detailMeta: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 8.5,
    fontWeight: '700',
    marginTop: 6,
  },
  detailActions: {
    flexDirection: 'row',
    gap: 8,
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 12,
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    height: 42,
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '900',
  },
  secondaryButton: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    height: 42,
    justifyContent: 'center',
  },
  secondaryButtonText: {
    fontSize: 12,
    fontWeight: '900',
  },
  reportList: {
    gap: 8,
  },
  reportRow: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    padding: 12,
  },
  reportIcon: {
    alignItems: 'center',
    backgroundColor: '#e4f7ee',
    borderRadius: 9,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  reportCopy: {
    flex: 1,
    minWidth: 0,
  },
  reportName: {
    fontSize: 12,
    fontWeight: '900',
  },
  reportMeta: {
    fontSize: 8.5,
    fontWeight: '700',
    marginTop: 3,
  },
  reportPrice: {
    alignItems: 'flex-end',
  },
  reportPriceValue: {
    fontSize: 16,
    fontWeight: '900',
  },
  reportPriceUnit: {
    fontSize: 8,
    fontWeight: '700',
    marginTop: 1,
  },
  uploadZone: {
    alignItems: 'center',
    borderRadius: 12,
    borderStyle: 'dashed',
    borderWidth: 1.5,
    justifyContent: 'center',
    padding: 24,
  },
  uploadTitle: {
    fontSize: 13,
    fontWeight: '900',
    marginTop: 8,
  },
  uploadSub: {
    fontSize: 9,
    fontWeight: '700',
    marginTop: 4,
  },
  imageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  imageTile: {
    borderRadius: 10,
    height: 84,
    overflow: 'hidden',
    position: 'relative',
    width: 84,
  },
  imagePreview: {
    height: '100%',
    width: '100%',
  },
  removeImage: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 50,
    height: 22,
    justifyContent: 'center',
    position: 'absolute',
    right: 5,
    top: 5,
    width: 22,
  },
  formCard: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 13,
  },
  formRow: {
    alignItems: 'center',
    borderBottomColor: 'rgba(0,0,0,0.04)',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 50,
    paddingVertical: 8,
  },
  fieldLabel: {
    flexBasis: 62,
    flexGrow: 0,
    flexShrink: 0,
    fontSize: 9.5,
    fontWeight: '800',
  },
  fieldValue: {
    flex: 1,
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'right',
  },
  formInput: {
    borderRadius: 9,
    flex: 1,
    fontSize: 11,
    fontWeight: '700',
    minHeight: 36,
    paddingHorizontal: 10,
  },
  unitChips: {
    flex: 1,
    gap: 6,
  },
  unitChip: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    height: 28,
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  unitChipText: {
    fontSize: 9,
    fontWeight: '800',
  },
  successCard: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    padding: 12,
  },
  successText: {
    flex: 1,
    fontSize: 10,
    fontWeight: '800',
  },
  sourcePrincipleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  principleCard: {
    backgroundColor: '#ffffff',
    borderColor: '#dce5f6',
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    width: '48%',
  },
  principleIcon: {
    alignItems: 'center',
    backgroundColor: '#e4f7ee',
    borderRadius: 8,
    height: 28,
    justifyContent: 'center',
    marginBottom: 7,
    width: 28,
  },
  principleTitle: {
    fontSize: 10,
    fontWeight: '900',
  },
  principleBody: {
    color: '#7483a2',
    fontSize: 8,
    lineHeight: 13,
    marginTop: 3,
  },
  sourceList: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  sourceRow: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 9,
    padding: 12,
  },
  sourceIcon: {
    alignItems: 'center',
    borderRadius: 8,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  sourceCopy: {
    flex: 1,
    minWidth: 0,
  },
  sourceName: {
    fontSize: 11,
    fontWeight: '900',
  },
  sourceDetail: {
    fontSize: 8.5,
    lineHeight: 14,
    marginTop: 3,
  },
  sourceStatus: {
    fontSize: 8.5,
    fontWeight: '900',
  },
  emptySource: {
    fontSize: 10,
    padding: 16,
    textAlign: 'center',
  },
  noticeCard: {
    alignItems: 'flex-start',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 9,
    padding: 12,
  },
  noticeCopy: {
    flex: 1,
  },
  noticeTitle: {
    fontSize: 11,
    fontWeight: '900',
  },
  noticeBody: {
    fontSize: 9,
    lineHeight: 15,
    marginTop: 4,
  },
});
