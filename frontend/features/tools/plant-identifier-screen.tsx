import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Clipboard from 'expo-clipboard';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/features/auth/auth-provider';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  clearPlantHistory,
  deletePlantHistory,
  fetchPlantCommonPlants,
  fetchPlantHistory,
  fetchPlantSources,
  fetchPlantSpecies,
  getPlantIdentifierErrorMessage,
  identifyPlantImage,
  submitPlantFeedback,
  type PlantPhotoAsset,
} from '@/lib/plant-identifier-api';
import { MobileScreen } from '@/shared/ui/mobile-screen';
import { SurfaceCard } from '@/shared/ui/surface-card';
import type {
  CommonPlant,
  IdentificationResult,
  PlantHistoryItem,
  PlantSourceEntry,
  SpeciesDetail,
} from '@/types/plant-identifier';

type ScreenMode = 'home' | 'camera' | 'results' | 'detail' | 'history' | 'sources';

const GREEN = '#24b36b';
const GREEN_SOFT = '#e5f7ee';
const BLUE = '#4b6bff';
const BLUE_SOFT = '#e7ecff';
const NAVY = '#151b3b';
const LIME = '#c9f36a';
const CORAL = '#ff6b8f';
const WARM = '#fff8e6';
const DARK = '#101426';

const SOURCE_LABELS: Record<string, string> = {
  plantnet: 'PlantNet 识别',
  gbif: 'GBIF 分类',
  inaturalist: 'iNaturalist 图片与观察',
  wikipedia: 'Wikipedia 描述',
  wikimedia: 'Wikimedia 图片',
};

export function PlantIdentifierScreen() {
  const { colors } = useAppTheme();
  const { accessToken, status: authStatus } = useAuth();
  const [mode, setMode] = useState<ScreenMode>('home');
  const [photo, setPhoto] = useState<PlantPhotoAsset | null>(null);
  const [result, setResult] = useState<IdentificationResult | null>(null);
  const [detail, setDetail] = useState<SpeciesDetail | null>(null);
  const [commonPlants, setCommonPlants] = useState<CommonPlant[]>([]);
  const [history, setHistory] = useState<PlantHistoryItem[]>([]);
  const [sources, setSources] = useState<PlantSourceEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackKind, setFeedbackKind] = useState<'wrong_match' | 'wrong_info' | 'image_issue'>('wrong_match');
  const [feedbackNote, setFeedbackNote] = useState('');
  const [favoriteKeys, setFavoriteKeys] = useState<Set<number>>(new Set());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    void loadHomeData();
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (authStatus === 'authenticated' && accessToken) {
      void loadHistory();
    }
  }, [authStatus, accessToken]);

  async function loadHomeData() {
    setLoading(true);
    try {
      const [plants, sourceItems] = await Promise.all([
        fetchPlantCommonPlants(),
        fetchPlantSources(),
      ]);
      if (!mountedRef.current) return;
      setCommonPlants(plants.items);
      setSources(sourceItems.items);
      setMessage(null);
    } catch (error) {
      if (mountedRef.current) {
        setMessage(getPlantIdentifierErrorMessage(error));
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  async function loadHistory() {
    if (!accessToken) return;
    try {
      const items = await fetchPlantHistory(accessToken);
      if (mountedRef.current) setHistory(items);
    } catch {
      // History is optional when the server is temporarily unavailable.
    }
  }

  const analyzePhoto = useCallback(
    async (asset: PlantPhotoAsset) => {
      setPhoto(asset);
      setLoading(true);
      setMessage(null);
      try {
        const identification = await identifyPlantImage(asset, accessToken);
        if (!mountedRef.current) return;
        setResult(identification);
        setMode('results');
        if (authStatus === 'authenticated') void loadHistory();
      } catch (error) {
        if (mountedRef.current) {
          setMessage(getPlantIdentifierErrorMessage(error));
          setMode('camera');
        }
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [accessToken, authStatus],
  );

  async function openDetail(match: IdentificationResult['matches'][number]) {
    setLoading(true);
    setMessage(null);
    try {
      const species = await fetchPlantSpecies(
        match.gbifKey,
        {
          scientificName: match.scientificName,
          commonName: match.commonNameZh,
          family: match.family,
          genus: match.genus,
        },
        accessToken,
      );
      if (!mountedRef.current) return;
      setDetail(species);
      setMode('detail');
    } catch (error) {
      if (mountedRef.current) {
        setMessage(getPlantIdentifierErrorMessage(error));
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  async function openCommonPlant(plant: CommonPlant) {
    setLoading(true);
    try {
      const species = await fetchPlantSpecies(
        plant.gbifKey,
        { scientificName: plant.scientificName, commonName: plant.nameZh },
        accessToken,
      );
      if (!mountedRef.current) return;
      setDetail(species);
      setMode('detail');
    } catch (error) {
      if (mountedRef.current) {
        setMessage(getPlantIdentifierErrorMessage(error));
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  function toggleFavorite(gbifKey: number) {
    setFavoriteKeys((current) => {
      const next = new Set(current);
      if (next.has(gbifKey)) {
        next.delete(gbifKey);
        Alert.alert('已取消收藏', '该物种已从本地收藏中移除。');
      } else {
        next.add(gbifKey);
        Alert.alert('已收藏', '该物种已加入本地收藏，方便下次查看。');
      }
      return next;
    });
  }

  async function shareDetail() {
    if (!detail) return;
    const text = `${detail.commonNames[0] || detail.scientificName}（${detail.scientificName}）\n${detail.summary?.text?.slice(0, 120) || ''}\n${detail.summary?.url || ''}`;
    try {
      await Clipboard.setStringAsync(text);
      Alert.alert('已复制', '物种资料已复制到剪贴板，可粘贴分享。');
    } catch {
      Alert.alert('分享失败', '暂时无法复制资料。');
    }
  }

  async function submitFeedback() {
    if (!result) return;
    try {
      await submitPlantFeedback(
        { identificationId: result.identificationId, kind: feedbackKind, note: feedbackNote.trim() },
        accessToken,
      );
      setFeedbackOpen(false);
      setFeedbackNote('');
      Alert.alert('已收到', '感谢反馈，我们会尽快核对。');
    } catch (error) {
      Alert.alert('提交失败', getPlantIdentifierErrorMessage(error));
    }
  }

  async function handleDeleteHistory(item: PlantHistoryItem) {
    if (!accessToken) return;
    try {
      await deletePlantHistory(accessToken, item.id);
      setHistory((current) => current.filter((entry) => entry.id !== item.id));
    } catch (error) {
      Alert.alert('删除失败', getPlantIdentifierErrorMessage(error));
    }
  }

  async function handleClearHistory() {
    if (!accessToken || history.length === 0) return;
    Alert.alert('清空识别历史', '清空后无法恢复，确定继续吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '清空',
        style: 'destructive',
        onPress: () => {
          void clearPlantHistory(accessToken)
            .then(() => setHistory([]))
            .catch((error) => Alert.alert('清空失败', getPlantIdentifierErrorMessage(error)));
        },
      },
    ]);
  }

  if (mode === 'camera') {
    return (
      <PlantCameraScreen
        onClose={() => {
          setMode('home');
          setMessage(null);
        }}
        onPhoto={analyzePhoto}
        onMessage={setMessage}
      />
    );
  }

  return (
    <>
      <MobileScreen>
        {mode === 'home' ? (
          <HomeContent
            colors={colors}
            commonPlants={commonPlants}
            history={history}
            loading={loading}
            message={message}
            onOpenCommon={openCommonPlant}
            onOpenHistory={() => setMode('history')}
            onOpenSources={() => setMode('sources')}
            onStartCamera={() => setMode('camera')}
            onPhoto={analyzePhoto}
          />
        ) : null}

        {mode === 'results' && result ? (
          <ResultsContent
            colors={colors}
            loading={loading}
            message={message}
            photo={photo}
            result={result}
            onBack={() => {
              setMode('home');
              setResult(null);
              setPhoto(null);
            }}
            onOpenDetail={(match) => void openDetail(match)}
            onRetake={() => setMode('camera')}
            onFeedback={() => setFeedbackOpen(true)}
          />
        ) : null}

        {mode === 'detail' && detail ? (
          <DetailContent
            colors={colors}
            detail={detail}
            favorite={favoriteKeys.has(detail.gbifKey)}
            onBack={() => setMode(result ? 'results' : 'home')}
            onFavorite={() => toggleFavorite(detail.gbifKey)}
            onShare={() => void shareDetail()}
            onFeedback={() => setFeedbackOpen(true)}
          />
        ) : null}

        {mode === 'history' ? (
          <HistoryContent
            colors={colors}
            history={history}
            onBack={() => setMode('home')}
            onDelete={(item) => void handleDeleteHistory(item)}
            onClear={() => void handleClearHistory()}
            onIdentify={() => setMode('camera')}
          />
        ) : null}

        {mode === 'sources' ? (
          <SourcesContent
            colors={colors}
            sources={sources}
            onBack={() => setMode('home')}
          />
        ) : null}
      </MobileScreen>

      <FeedbackModal
        colors={colors}
        kind={feedbackKind}
        note={feedbackNote}
        visible={feedbackOpen}
        onKindChange={setFeedbackKind}
        onNoteChange={setFeedbackNote}
        onClose={() => setFeedbackOpen(false)}
        onSubmit={() => void submitFeedback()}
      />
    </>
  );
}

function HomeContent({
  colors,
  commonPlants,
  history,
  loading,
  message,
  onOpenCommon,
  onOpenHistory,
  onOpenSources,
  onStartCamera,
  onPhoto,
}: {
  colors: ReturnType<typeof useAppTheme>['colors'];
  commonPlants: CommonPlant[];
  history: PlantHistoryItem[];
  loading: boolean;
  message: string | null;
  onOpenCommon: (plant: CommonPlant) => void;
  onOpenHistory: () => void;
  onOpenSources: () => void;
  onStartCamera: () => void;
  onPhoto: (asset: PlantPhotoAsset) => void;
}) {
  async function pickFromAlbum() {
    if (Platform.OS !== 'web') {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('需要相册权限', '请在系统设置中开启相册权限后重试。');
        return;
      }
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.9,
      selectionLimit: 1,
    });
    if (picked.canceled || !picked.assets?.length) return;
    const asset = picked.assets[0];
    onPhoto({
      uri: asset.uri,
      mimeType: asset.mimeType,
      fileName: asset.fileName,
    });
  }

  return (
    <>
      <View style={styles.pageHeaderRow}>
        <View style={styles.pageTitleBlock}>
          <View style={[styles.brandMark, { backgroundColor: GREEN }]}>
            <MaterialCommunityIcons name="sprout-outline" size={18} color="#ffffff" />
          </View>
          <View>
            <ThemedText style={styles.pageTitle}>识花草</ThemedText>
            <ThemedText style={[styles.pageSubtitle, { color: colors.mutedText }]}>
              拍一张，认识眼前的植物
            </ThemedText>
          </View>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            accessibilityLabel="识别历史"
            accessibilityRole="button"
            onPress={onOpenHistory}
            style={[styles.iconButton, { backgroundColor: colors.surfaceMuted }]}>
            <MaterialCommunityIcons name="history" size={18} color={colors.text} />
          </Pressable>
          <Pressable
            accessibilityLabel="数据来源"
            accessibilityRole="button"
            onPress={onOpenSources}
            style={[styles.iconButton, { backgroundColor: colors.surfaceMuted }]}>
            <MaterialCommunityIcons name="information-outline" size={18} color={colors.text} />
          </Pressable>
        </View>
      </View>

      {message ? (
        <View style={[styles.messageBanner, { backgroundColor: colors.surfaceMuted, borderColor: colors.line }]}>
          <MaterialCommunityIcons name="alert-circle-outline" size={16} color={CORAL} />
          <ThemedText style={[styles.messageText, { color: colors.mutedText }]}>{message}</ThemedText>
        </View>
      ) : null}

      <SurfaceCard style={[styles.heroCard, { backgroundColor: NAVY }]}>
        <View style={styles.heroCopy}>
          <View style={styles.liveBadge}>
            <MaterialCommunityIcons name="check-decagram" size={13} color={LIME} />
            <ThemedText style={styles.liveBadgeText}>真实数据识别</ThemedText>
          </View>
          <ThemedText style={styles.heroTitle}>拍一张，认识眼前的植物</ThemedText>
          <ThemedText style={styles.heroBody}>
            名称、科属、常见描述与食用提示，均来自真实数据源。
          </ThemedText>
          <View style={styles.heroActions}>
            <Pressable
              accessibilityRole="button"
              onPress={onStartCamera}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
              <MaterialCommunityIcons name="camera" size={17} color={NAVY} />
              <ThemedText style={styles.primaryButtonText}>扫一扫识别</ThemedText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => void pickFromAlbum()}
              style={({ pressed }) => [styles.ghostButton, pressed && styles.pressed]}>
              <MaterialCommunityIcons name="image-outline" size={17} color="#ffffff" />
              <ThemedText style={styles.ghostButtonText}>从相册选择</ThemedText>
            </Pressable>
          </View>
        </View>
        {commonPlants[0] ? (
          <Image
            source={{ uri: commonPlants[0].imageUrl }}
            style={styles.heroImage}
            contentFit="cover"
          />
        ) : null}
      </SurfaceCard>

      <View style={styles.sourceChips}>
        <View style={[styles.liveChip, { backgroundColor: GREEN_SOFT }]}>
          <MaterialCommunityIcons name="circle-small" size={14} color={GREEN} />
          <ThemedText style={[styles.liveChipText, { color: GREEN }]}>真实数据</ThemedText>
        </View>
        {['PlantNet', 'GBIF', 'iNaturalist', 'Wikipedia'].map((name) => (
          <View key={name} style={[styles.sourceChip, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <ThemedText style={[styles.sourceChipText, { color: colors.mutedText }]}>{name}</ThemedText>
          </View>
        ))}
      </View>

      {history.length > 0 ? (
        <View>
          <SectionHeading title="最近识别" action="查看全部" onAction={onOpenHistory} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.recentRow}>
            {history.slice(0, 4).map((item) => (
              <View
                key={item.id}
                style={[styles.recentCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
                <View style={styles.recentThumb}>
                  <MaterialCommunityIcons name="sprout" size={20} color={GREEN} />
                </View>
                <View style={styles.recentCopy}>
                  <ThemedText style={styles.recentName}>{item.commonNameZh || item.scientificName}</ThemedText>
                  <ThemedText style={[styles.recentMeta, { color: colors.mutedText }]}>
                    {Math.round(item.score * 100)}% 匹配
                  </ThemedText>
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      ) : null}

      <View>
        <SectionHeading title="常见植物" action="真实图源" />
        <View style={styles.commonGrid}>
          {commonPlants.map((plant) => (
            <Pressable
              key={plant.gbifKey}
              accessibilityRole="button"
              onPress={() => onOpenCommon(plant)}
              style={({ pressed }) => [
                styles.commonCard,
                { backgroundColor: colors.surface, borderColor: colors.line },
                pressed && styles.pressed,
              ]}>
              <Image source={{ uri: plant.imageUrl }} style={styles.commonImage} contentFit="cover" />
              <View style={styles.commonCopy}>
                <ThemedText style={styles.commonName}>{plant.nameZh}</ThemedText>
                <ThemedText style={[styles.commonMeta, { color: colors.mutedText }]}>
                  {plant.familyZh} · {plant.scientificName}
                </ThemedText>
              </View>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={[styles.disclaimer, { backgroundColor: WARM, borderColor: '#f3dfae' }]}>
        <MaterialCommunityIcons name="information-outline" size={15} color="#8a6d1f" />
        <ThemedText style={styles.disclaimerText}>
          识别结果仅供参考，请勿据此采食或药用。食用/毒性信息请以权威来源为准。
        </ThemedText>
      </View>

      {loading ? <ActivityIndicator color={GREEN} style={styles.inlineLoader} /> : null}
    </>
  );
}

function PlantCameraScreen({
  onClose,
  onPhoto,
  onMessage,
}: {
  onClose: () => void;
  onPhoto: (asset: PlantPhotoAsset) => void;
  onMessage: (message: string | null) => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const cameraRef = useRef<CameraView>(null);
  const granted = permission?.granted === true;
  const denied = permission != null && !permission.granted && !permission.canAskAgain;

  async function takePhoto() {
    onMessage(null);
    try {
      const picture = await cameraRef.current?.takePictureAsync({ quality: 0.8 });
      if (!picture) return;
      const uri = picture.uri;
      const extension = uri.split('.').pop()?.toLowerCase() || 'jpg';
      const mimeType = extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg';
      onPhoto({ uri, mimeType, fileName: `plant-${Date.now()}.${extension}` });
    } catch {
      onMessage('拍照失败，请重试或从相册选择照片。');
    }
  }

  async function pickFromAlbum() {
    onMessage(null);
    if (Platform.OS !== 'web') {
      const mediaPermission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!mediaPermission.granted) {
        onMessage('需要相册权限才能选择照片。');
        return;
      }
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.9,
      selectionLimit: 1,
    });
    if (picked.canceled || !picked.assets?.length) return;
    const asset = picked.assets[0];
    onPhoto({ uri: asset.uri, mimeType: asset.mimeType, fileName: asset.fileName });
  }

  return (
    <SafeAreaView style={styles.cameraRoot}>
      <View style={styles.cameraTop}>
        <Pressable
          accessibilityLabel="返回"
          accessibilityRole="button"
          onPress={onClose}
          style={styles.cameraIconButton}>
          <MaterialCommunityIcons name="chevron-left" size={22} color="#ffffff" />
        </Pressable>
        <View style={styles.cameraHint}>
          <MaterialCommunityIcons name="scan-helper" size={14} color={LIME} />
          <ThemedText style={styles.cameraHintText}>把叶片和花放进取景框，尽量拍清晰</ThemedText>
        </View>
        <Pressable
          accessibilityLabel="手电筒"
          accessibilityRole="button"
          onPress={() => setTorch((value) => !value)}
          style={styles.cameraIconButton}>
          <MaterialCommunityIcons name={torch ? 'flashlight' : 'flashlight-off'} size={20} color="#ffffff" />
        </Pressable>
      </View>

      <View style={styles.cameraShell}>
        {granted ? (
          <CameraView ref={cameraRef} active enableTorch={torch} facing="back" style={styles.camera} />
        ) : (
          <View style={styles.cameraCenterState}>
            <MaterialCommunityIcons
              name={denied ? 'camera-off-outline' : 'camera-plus-outline'}
              size={38}
              color="#ffffff"
            />
            <ThemedText style={styles.cameraStateText}>
              {denied ? '相机权限未开启，可在系统设置中开启后重试' : '需要相机权限才能拍摄识别'}
            </ThemedText>
            {!denied ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => void requestPermission()}
                style={styles.permissionButton}>
                <ThemedText style={styles.permissionButtonText}>开启相机权限</ThemedText>
              </Pressable>
            ) : null}
          </View>
        )}
        <View pointerEvents="none" style={styles.viewfinder}>
          <View style={[styles.corner, styles.cornerTL]} />
          <View style={[styles.corner, styles.cornerTR]} />
          <View style={[styles.corner, styles.cornerBL]} />
          <View style={[styles.corner, styles.cornerBR]} />
        </View>
      </View>

      <ThemedText style={styles.cameraSourceText}>识别服务 PlantNet · 图片仅用于本次识别</ThemedText>
      <View style={styles.cameraControls}>
        <Pressable
          accessibilityLabel="从相册选择"
          accessibilityRole="button"
          onPress={() => void pickFromAlbum()}
          style={styles.galleryButton}>
          <MaterialCommunityIcons name="image-multiple-outline" size={22} color="#ffffff" />
        </Pressable>
        <Pressable
          accessibilityLabel="拍照"
          accessibilityRole="button"
          onPress={() => void takePhoto()}
          style={styles.shutterButton}
        />
        <View style={styles.galleryButton} />
      </View>
    </SafeAreaView>
  );
}

function ResultsContent({
  colors,
  loading,
  message,
  photo,
  result,
  onBack,
  onOpenDetail,
  onRetake,
  onFeedback,
}: {
  colors: ReturnType<typeof useAppTheme>['colors'];
  loading: boolean;
  message: string | null;
  photo: PlantPhotoAsset | null;
  result: IdentificationResult;
  onBack: () => void;
  onOpenDetail: (match: IdentificationResult['matches'][number]) => void;
  onRetake: () => void;
  onFeedback: () => void;
}) {
  const top = result.matches[0];
  const topScore = top ? Math.round(top.score * 100) : 0;

  return (
    <>
      <View style={styles.resultsHeader}>
        <Pressable
          accessibilityLabel="返回"
          accessibilityRole="button"
          onPress={onBack}
          style={[styles.iconButton, { backgroundColor: colors.surfaceMuted }]}>
          <MaterialCommunityIcons name="chevron-left" size={20} color={colors.text} />
        </Pressable>
        <ThemedText style={styles.resultsTitle}>识别结果</ThemedText>
        <View style={styles.resultsHeaderSpacer} />
      </View>

      {photo ? <Image source={{ uri: photo.uri }} style={styles.photoPreview} contentFit="cover" /> : null}

      <View style={styles.resultsStatus}>
        <View style={[styles.statusBadge, { backgroundColor: GREEN_SOFT }]}>
          <MaterialCommunityIcons name="check-circle-outline" size={15} color={GREEN} />
          <ThemedText style={[styles.statusBadgeText, { color: GREEN }]}>识别完成</ThemedText>
        </View>
        <ThemedText style={[styles.scoreText, { color: colors.mutedText }]}>
          Top1 置信度 <ThemedText style={{ color: GREEN, fontWeight: '800' }}>{topScore}%</ThemedText>
        </ThemedText>
      </View>

      {top ? (
        <SurfaceCard style={styles.matchCard}>
          <View style={styles.matchRow}>
            <View style={styles.matchIcon}>
              <MaterialCommunityIcons name="sprout" size={22} color={GREEN} />
            </View>
            <View style={styles.matchCopy}>
              <ThemedText style={styles.matchName}>{top.commonNameZh || top.scientificName}</ThemedText>
              <ThemedText style={[styles.matchSci, { color: colors.mutedText }]}>{top.scientificName}</ThemedText>
              <View style={styles.matchTags}>
                {top.familyZh ? (
                  <View style={[styles.matchTag, { backgroundColor: BLUE_SOFT }]}>
                    <ThemedText style={[styles.matchTagText, { color: BLUE }]}>{top.familyZh}</ThemedText>
                  </View>
                ) : null}
                {top.genus ? (
                  <View style={[styles.matchTag, { backgroundColor: colors.surfaceMuted }]}>
                    <ThemedText style={[styles.matchTagText, { color: colors.mutedText }]}>{top.genus}</ThemedText>
                  </View>
                ) : null}
              </View>
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => onOpenDetail(top)}
            style={styles.detailLink}>
            <ThemedText style={[styles.detailLinkText, { color: GREEN }]}>查看完整资料</ThemedText>
            <MaterialCommunityIcons name="arrow-right" size={15} color={GREEN} />
          </Pressable>
        </SurfaceCard>
      ) : null}

      <View>
        <SectionHeading title="候选物种" />
        {result.matches.map((match) => (
          <Pressable
            key={`${match.gbifKey}-${match.rank}`}
            accessibilityRole="button"
            onPress={() => onOpenDetail(match)}
            style={({ pressed }) => [
              styles.candidateRow,
              { backgroundColor: colors.surface, borderColor: colors.line },
              pressed && styles.pressed,
            ]}>
            <View style={[styles.rankBadge, { backgroundColor: colors.surfaceMuted }]}>
              <ThemedText style={[styles.rankText, { color: colors.mutedText }]}>{match.rank}</ThemedText>
            </View>
            <View style={styles.candidateCopy}>
              <ThemedText style={styles.candidateName}>{match.commonNameZh || match.scientificName}</ThemedText>
              <ThemedText style={[styles.candidateMeta, { color: colors.mutedText }]}>
                {match.scientificName} · {match.familyZh || match.family}
              </ThemedText>
            </View>
            <ThemedText style={[styles.candidateScore, { color: GREEN }]}>
              {Math.round(match.score * 100)}%
            </ThemedText>
          </Pressable>
        ))}
      </View>

      <View style={styles.resultsActions}>
        <Pressable
          accessibilityRole="button"
          onPress={onRetake}
          style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
          <MaterialCommunityIcons name="camera" size={17} color={NAVY} />
          <ThemedText style={styles.primaryButtonText}>重新拍摄</ThemedText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onFeedback}
          style={({ pressed }) => [
            styles.secondaryButton,
            { backgroundColor: colors.surface, borderColor: colors.line },
            pressed && styles.pressed,
          ]}>
          <MaterialCommunityIcons name="flag-outline" size={17} color={colors.text} />
          <ThemedText style={[styles.secondaryButtonText, { color: colors.text }]}>识别不对？纠错</ThemedText>
        </Pressable>
      </View>

      {message ? (
        <View style={[styles.messageBanner, { backgroundColor: colors.surfaceMuted, borderColor: colors.line }]}>
          <MaterialCommunityIcons name="alert-circle-outline" size={16} color={CORAL} />
          <ThemedText style={[styles.messageText, { color: colors.mutedText }]}>{message}</ThemedText>
        </View>
      ) : null}

      <ThemedText style={[styles.dataNote, { color: colors.mutedText }]}>
        PlantNet · score {top?.score?.toFixed(2) ?? '-'} · 实时聚合
      </ThemedText>
      {loading ? <ActivityIndicator color={GREEN} style={styles.inlineLoader} /> : null}
    </>
  );
}

function DetailContent({
  colors,
  detail,
  favorite,
  onBack,
  onFavorite,
  onShare,
  onFeedback,
}: {
  colors: ReturnType<typeof useAppTheme>['colors'];
  detail: SpeciesDetail;
  favorite: boolean;
  onBack: () => void;
  onFavorite: () => void;
  onShare: () => void;
  onFeedback: () => void;
}) {
  const primaryName = detail.commonNames[0] || detail.scientificName;
  const heroImage = detail.images[0];
  const safety = detail.safety;

  return (
    <>
      <View style={styles.detailHeroWrap}>
        {heroImage ? (
          <Image source={{ uri: heroImage.url }} style={styles.detailHero} contentFit="cover" />
        ) : (
          <View style={[styles.detailHero, styles.detailHeroPlaceholder, { backgroundColor: GREEN_SOFT }]}>
            <MaterialCommunityIcons name="sprout-outline" size={52} color={GREEN} />
          </View>
        )}
        <View style={styles.detailTopActions}>
          <Pressable
            accessibilityLabel="返回"
            accessibilityRole="button"
            onPress={onBack}
            style={styles.detailIconButton}>
            <MaterialCommunityIcons name="chevron-left" size={20} color="#ffffff" />
          </Pressable>
          <Pressable
            accessibilityLabel={favorite ? '取消收藏' : '收藏'}
            accessibilityRole="button"
            onPress={onFavorite}
            style={styles.detailIconButton}>
            <MaterialCommunityIcons
              name={favorite ? 'bookmark' : 'bookmark-outline'}
              size={19}
              color={favorite ? LIME : '#ffffff'}
            />
          </Pressable>
          <Pressable
            accessibilityLabel="分享"
            accessibilityRole="button"
            onPress={onShare}
            style={styles.detailIconButton}>
            <MaterialCommunityIcons name="share-variant-outline" size={19} color="#ffffff" />
          </Pressable>
        </View>
        {heroImage ? (
          <View style={styles.imageCredit}>
            <ThemedText style={styles.imageCreditText}>
              {heroImage.credit || SOURCE_LABELS[heroImage.source] || heroImage.source}
            </ThemedText>
          </View>
        ) : null}
      </View>

      <View style={styles.nameBlock}>
        <ThemedText style={styles.detailName}>{primaryName}</ThemedText>
        <ThemedText style={[styles.detailSci, { color: colors.mutedText }]}>{detail.scientificName}</ThemedText>
        {detail.commonNames.length > 1 ? (
          <View style={styles.aliasRow}>
            {detail.commonNames.slice(1, 6).map((alias) => (
              <View key={alias} style={[styles.aliasChip, { backgroundColor: colors.surface, borderColor: colors.line }]}>
                <ThemedText style={[styles.aliasText, { color: colors.mutedText }]}>{alias}</ThemedText>
              </View>
            ))}
          </View>
        ) : null}
      </View>

      <View style={styles.taxonGrid}>
        <TaxonCell colors={colors} label="科" value={detail.classification.familyZh || detail.classification.family || '暂无'} />
        <TaxonCell colors={colors} label="属" value={detail.classification.genus || '暂无'} />
        <TaxonCell colors={colors} label="目" value={detail.classification.order || '暂无'} />
        <TaxonCell colors={colors} label="纲" value={detail.classification.class || '暂无'} />
      </View>

      <View style={[styles.safetyCard, { backgroundColor: GREEN_SOFT, borderColor: '#bfe9d1' }]}>
        <View style={styles.safetyHead}>
          <View style={[styles.safetyIcon, { backgroundColor: GREEN }]}>
            <MaterialCommunityIcons name="food-apple-outline" size={15} color="#ffffff" />
          </View>
          <ThemedText style={styles.safetyTitle}>可食用性</ThemedText>
          <ThemedText style={[styles.safetyState, { color: GREEN }]}>
            {safety.state === 'edible' ? '有来源' : safety.state === 'poisonous' ? '谨慎' : '暂无'}
          </ThemedText>
        </View>
        <ThemedText style={styles.safetyQuote}>{safety.quote || safety.note}</ThemedText>
        {safety.source ? (
          <View style={styles.safetySourceRow}>
            <MaterialCommunityIcons name="open-in-new" size={13} color={GREEN} />
            <ThemedText style={[styles.safetySourceText, { color: GREEN }]}>
              Wikipedia · {safety.checkedAt.slice(0, 10)} 快照
            </ThemedText>
          </View>
        ) : null}
      </View>

      {detail.summary ? (
        <SurfaceCard style={styles.descCard}>
          <View style={styles.sectionTitleRow}>
            <MaterialCommunityIcons name="format-align-left" size={16} color={BLUE} />
            <ThemedText style={styles.sectionTitle}>常见描述</ThemedText>
          </View>
          <ThemedText style={[styles.descText, { color: colors.mutedText }]}>
            {detail.summary.text.length > 260
              ? `${detail.summary.text.slice(0, 260)}…`
              : detail.summary.text}
          </ThemedText>
          {detail.summary ? (
            <Pressable
              accessibilityRole="link"
              onPress={() => void Linking.openURL(detail.summary?.url ?? '')}
              style={styles.sourceLinkRow}>
              <ThemedText style={[styles.sourceLinkText, { color: BLUE }]}>查看词条原文</ThemedText>
              <MaterialCommunityIcons name="arrow-up-right" size={14} color={BLUE} />
            </Pressable>
          ) : null}
        </SurfaceCard>
      ) : null}

      {detail.observations ? (
        <View style={[styles.distribRow, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <View style={[styles.distribIcon, { backgroundColor: BLUE_SOFT }]}>
            <MaterialCommunityIcons name="map-marker-outline" size={18} color={BLUE} />
          </View>
          <View style={styles.distribCopy}>
            <ThemedText style={styles.distribTitle}>全球观察统计</ThemedText>
            <ThemedText style={[styles.distribMeta, { color: colors.mutedText }]}>
              iNaturalist · {detail.observations.count.toLocaleString()} 条 · {detail.observations.fetchedAt.slice(0, 10)} 快照
            </ThemedText>
          </View>
        </View>
      ) : null}

      <View>
        <SectionHeading title="数据来源" />
        {detail.images[0] ? (
          <SourceLine colors={colors} source={SOURCE_LABELS[detail.images[0].source] || detail.images[0].source} label="图片" />
        ) : null}
        <SourceLine colors={colors} source="GBIF" label="分类" />
        {detail.summary ? <SourceLine colors={colors} source="Wikipedia" label="描述" /> : null}
        {detail.observations ? <SourceLine colors={colors} source="iNaturalist" label="观察" /> : null}
      </View>

      <View style={styles.detailActions}>
        <Pressable
          accessibilityRole="button"
          onPress={onFavorite}
          style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
          <MaterialCommunityIcons name={favorite ? 'bookmark' : 'bookmark-outline'} size={17} color={NAVY} />
          <ThemedText style={styles.primaryButtonText}>{favorite ? '已收藏' : '收藏'}</ThemedText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onFeedback}
          style={({ pressed }) => [
            styles.secondaryButton,
            { backgroundColor: colors.surface, borderColor: colors.line },
            pressed && styles.pressed,
          ]}>
          <MaterialCommunityIcons name="flag-outline" size={17} color={colors.text} />
          <ThemedText style={[styles.secondaryButtonText, { color: colors.text }]}>纠错</ThemedText>
        </Pressable>
      </View>

      <View style={[styles.disclaimer, { backgroundColor: WARM, borderColor: '#f3dfae' }]}>
        <MaterialCommunityIcons name="information-outline" size={15} color="#8a6d1f" />
        <ThemedText style={styles.disclaimerText}>{detail.disclaimer}</ThemedText>
      </View>
    </>
  );
}

function TaxonCell({
  colors,
  label,
  value,
}: {
  colors: ReturnType<typeof useAppTheme>['colors'];
  label: string;
  value: string;
}) {
  return (
    <View style={[styles.taxonCell, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <ThemedText style={[styles.taxonLabel, { color: colors.mutedText }]}>{label}</ThemedText>
      <ThemedText style={styles.taxonValue}>{value}</ThemedText>
    </View>
  );
}

function SourceLine({
  colors,
  source,
  label,
}: {
  colors: ReturnType<typeof useAppTheme>['colors'];
  source: string;
  label: string;
}) {
  return (
    <View style={[styles.sourceLine, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <View style={[styles.sourceIcon, { backgroundColor: BLUE_SOFT }]}>
        <MaterialCommunityIcons name="database-outline" size={15} color={BLUE} />
      </View>
      <View style={styles.sourceLineCopy}>
        <ThemedText style={styles.sourceLineName}>{source}</ThemedText>
        <ThemedText style={[styles.sourceLineMeta, { color: colors.mutedText }]}>{label}</ThemedText>
      </View>
      <ThemedText style={[styles.sourceLineState, { color: GREEN }]}>已校验</ThemedText>
    </View>
  );
}

function HistoryContent({
  colors,
  history,
  onBack,
  onDelete,
  onClear,
  onIdentify,
}: {
  colors: ReturnType<typeof useAppTheme>['colors'];
  history: PlantHistoryItem[];
  onBack: () => void;
  onDelete: (item: PlantHistoryItem) => void;
  onClear: () => void;
  onIdentify: () => void;
}) {
  return (
    <>
      <View style={styles.resultsHeader}>
        <Pressable
          accessibilityLabel="返回"
          accessibilityRole="button"
          onPress={onBack}
          style={[styles.iconButton, { backgroundColor: colors.surfaceMuted }]}>
          <MaterialCommunityIcons name="chevron-left" size={20} color={colors.text} />
        </Pressable>
        <ThemedText style={styles.resultsTitle}>识别历史</ThemedText>
        <View style={styles.resultsHeaderSpacer} />
      </View>

      <View style={styles.historyMetaRow}>
        <ThemedText style={[styles.historyMetaLabel, { color: colors.mutedText }]}>
          最近 {history.length} 条 · 登录后自动保存
        </ThemedText>
        {history.length > 0 ? (
          <Pressable accessibilityRole="button" onPress={onClear}>
            <ThemedText style={styles.clearText}>清空</ThemedText>
          </Pressable>
        ) : null}
      </View>

      {history.length === 0 ? (
        <View style={[styles.historyEmpty, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <View style={[styles.emptyIcon, { backgroundColor: GREEN_SOFT }]}>
            <MaterialCommunityIcons name="sprout-outline" size={28} color={GREEN} />
          </View>
          <ThemedText style={styles.emptyTitle}>还没有识别记录</ThemedText>
          <ThemedText style={[styles.emptyBody, { color: colors.mutedText }]}>
            拍一棵植物，记录会保存在这里。
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={onIdentify}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
            <MaterialCommunityIcons name="camera" size={17} color={NAVY} />
            <ThemedText style={styles.primaryButtonText}>去识别</ThemedText>
          </Pressable>
        </View>
      ) : (
        history.map((item) => (
          <View key={item.id} style={[styles.historyRow, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <View style={styles.historyThumb}>
              <MaterialCommunityIcons name="sprout" size={22} color={GREEN} />
            </View>
            <View style={styles.historyCopy}>
              <ThemedText style={styles.historyName}>{item.commonNameZh || item.scientificName}</ThemedText>
              <ThemedText style={[styles.historyMeta, { color: colors.mutedText }]}>
                {item.createdAt.slice(0, 16).replace('T', ' ')} · {item.scientificName}
              </ThemedText>
            </View>
            <View style={styles.historyRight}>
              <ThemedText style={[styles.historyScore, { color: GREEN }]}>
                {Math.round(item.score * 100)}%
              </ThemedText>
              <Pressable
                accessibilityLabel="删除记录"
                accessibilityRole="button"
                onPress={() => onDelete(item)}
                style={styles.deleteButton}>
                <MaterialCommunityIcons name="delete-outline" size={17} color={CORAL} />
              </Pressable>
            </View>
          </View>
        ))
      )}
    </>
  );
}

function SourcesContent({
  colors,
  sources,
  onBack,
}: {
  colors: ReturnType<typeof useAppTheme>['colors'];
  sources: PlantSourceEntry[];
  onBack: () => void;
}) {
  return (
    <>
      <View style={styles.resultsHeader}>
        <Pressable
          accessibilityLabel="返回"
          accessibilityRole="button"
          onPress={onBack}
          style={[styles.iconButton, { backgroundColor: colors.surfaceMuted }]}>
          <MaterialCommunityIcons name="chevron-left" size={20} color={colors.text} />
        </Pressable>
        <ThemedText style={styles.resultsTitle}>数据来源</ThemedText>
        <View style={styles.resultsHeaderSpacer} />
      </View>

      <View style={[styles.privacyCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <View style={styles.sectionTitleRow}>
          <MaterialCommunityIcons name="shield-lock-outline" size={16} color={GREEN} />
          <ThemedText style={styles.sectionTitle}>隐私说明</ThemedText>
        </View>
        <ThemedText style={[styles.privacyText, { color: colors.mutedText }]}>
          照片仅用于本次识别，服务端不长期保存原图；每个字段都标注来源与抓取时间。
        </ThemedText>
      </View>

      {sources.map((source) => (
        <SurfaceCard key={source.id} style={styles.sourceCard}>
          <View style={styles.sourceCardHead}>
            <View style={[styles.sourceCardIcon, { backgroundColor: BLUE_SOFT }]}>
              <MaterialCommunityIcons name="database-outline" size={18} color={BLUE} />
            </View>
            <View style={styles.sourceCardCopy}>
              <ThemedText style={styles.sourceCardName}>{source.name}</ThemedText>
              <ThemedText style={[styles.sourceCardMeta, { color: colors.mutedText }]}>
                {source.needsKey ? '需要服务端密钥' : '公开接口'}
              </ThemedText>
            </View>
          </View>
          <ThemedText style={[styles.sourceCardBody, { color: colors.mutedText }]}>{source.purpose}</ThemedText>
          <Pressable
            accessibilityRole="link"
            onPress={() => void Linking.openURL(source.documentUrl)}
            style={styles.sourceLinkRow}>
            <ThemedText style={[styles.sourceLinkText, { color: BLUE }]}>查看接口文档</ThemedText>
            <MaterialCommunityIcons name="arrow-up-right" size={14} color={BLUE} />
          </Pressable>
        </SurfaceCard>
      ))}
    </>
  );
}

function FeedbackModal({
  colors,
  kind,
  note,
  visible,
  onKindChange,
  onNoteChange,
  onClose,
  onSubmit,
}: {
  colors: ReturnType<typeof useAppTheme>['colors'];
  kind: 'wrong_match' | 'wrong_info' | 'image_issue';
  note: string;
  visible: boolean;
  onKindChange: (kind: 'wrong_match' | 'wrong_info' | 'image_issue') => void;
  onNoteChange: (note: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const kinds: { key: 'wrong_match' | 'wrong_info' | 'image_issue'; label: string }[] = [
    { key: 'wrong_match', label: '识别结果不对' },
    { key: 'wrong_info', label: '资料有误' },
    { key: 'image_issue', label: '图片问题' },
  ];
  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.modalSheet, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <View style={styles.modalHandle} />
          <ThemedText style={styles.modalTitle}>纠错反馈</ThemedText>
          <View style={styles.kindRow}>
            {kinds.map((item) => (
              <Pressable
                key={item.key}
                accessibilityRole="button"
                onPress={() => onKindChange(item.key)}
                style={[
                  styles.kindPill,
                  { backgroundColor: colors.surfaceMuted },
                  kind === item.key && { backgroundColor: GREEN_SOFT, borderColor: GREEN },
                ]}>
                <ThemedText
                  style={[styles.kindText, { color: colors.mutedText }, kind === item.key && { color: GREEN }]}>
                  {item.label}
                </ThemedText>
              </Pressable>
            ))}
          </View>
          <TextInput
            value={note}
            onChangeText={onNoteChange}
            placeholder="补充说明（选填）"
            placeholderTextColor={colors.mutedText}
            multiline
            maxLength={300}
            style={[
              styles.noteInput,
              { backgroundColor: colors.surfaceMuted, borderColor: colors.line, color: colors.text },
            ]}
          />
          <View style={styles.modalActions}>
            <Pressable
              accessibilityRole="button"
              onPress={onClose}
              style={[styles.secondaryButton, { backgroundColor: colors.surfaceMuted, borderColor: colors.line }]}>
              <ThemedText style={[styles.secondaryButtonText, { color: colors.mutedText }]}>取消</ThemedText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={onSubmit}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
              <MaterialCommunityIcons name="send" size={16} color={NAVY} />
              <ThemedText style={styles.primaryButtonText}>提交</ThemedText>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function SectionHeading({
  title,
  action,
  onAction,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.sectionHead}>
      <ThemedText style={styles.sectionHeading}>{title}</ThemedText>
      {action ? (
        <Pressable accessibilityRole="button" onPress={onAction} disabled={!onAction}>
          <ThemedText style={[styles.sectionAction, { color: colors.mutedText }]}>{action}</ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  aliasChip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  aliasRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  aliasText: {
    fontSize: 10,
    fontWeight: '700',
  },
  brandMark: {
    alignItems: 'center',
    borderRadius: 9,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  camera: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  cameraCenterState: {
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 28,
  },
  cameraControls: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 26,
    paddingHorizontal: 34,
    paddingTop: 16,
  },
  cameraHint: {
    alignItems: 'center',
    backgroundColor: 'rgba(16, 20, 38, 0.55)',
    borderColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    maxWidth: 260,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  cameraHintText: {
    color: 'rgba(255, 255, 255, 0.9)',
    fontSize: 10,
    fontWeight: '700',
  },
  cameraIconButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(16, 20, 38, 0.42)',
    borderRadius: 12,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  cameraRoot: {
    backgroundColor: DARK,
    flex: 1,
  },
  cameraShell: {
    backgroundColor: '#0d1420',
    flex: 1,
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  cameraSourceText: {
    color: 'rgba(255, 255, 255, 0.72)',
    fontSize: 9,
    fontWeight: '700',
    paddingTop: 10,
    textAlign: 'center',
  },
  cameraStateText: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  cameraTop: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  candidateCopy: {
    flex: 1,
  },
  candidateMeta: {
    fontSize: 9.5,
    fontWeight: '600',
    marginTop: 2,
  },
  candidateName: {
    fontSize: 11.5,
    fontWeight: '900',
  },
  candidateRow: {
    alignItems: 'center',
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
    padding: 10,
  },
  candidateScore: {
    fontSize: 11,
    fontWeight: '800',
  },
  clearText: {
    color: CORAL,
    fontSize: 11,
    fontWeight: '800',
  },
  commonCard: {
    borderRadius: 15,
    borderWidth: 1,
    overflow: 'hidden',
  },
  commonCopy: {
    padding: 9,
  },
  commonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  commonImage: {
    height: 86,
    width: '100%',
  },
  commonMeta: {
    fontSize: 9,
    fontWeight: '600',
    marginTop: 3,
  },
  commonName: {
    fontSize: 12,
    fontWeight: '900',
  },
  corner: {
    borderColor: LIME,
    height: 26,
    position: 'absolute',
    width: 26,
  },
  cornerBL: {
    borderBottomLeftRadius: 8,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    bottom: 16,
    left: 16,
  },
  cornerBR: {
    borderBottomRightRadius: 8,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    bottom: 16,
    right: 16,
  },
  cornerTL: {
    borderLeftWidth: 3,
    borderTopLeftRadius: 8,
    borderTopWidth: 3,
    left: 16,
    top: 16,
  },
  cornerTR: {
    borderRightWidth: 3,
    borderTopRightRadius: 8,
    borderTopWidth: 3,
    right: 16,
    top: 16,
  },
  dataNote: {
    fontSize: 9,
    fontWeight: '700',
    marginTop: 10,
    textAlign: 'center',
  },
  deleteButton: {
    padding: 6,
  },
  descCard: {
    padding: 14,
  },
  descText: {
    fontSize: 10.5,
    lineHeight: 18,
    marginTop: 8,
  },
  detailActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  detailHero: {
    height: 230,
    width: '100%',
  },
  detailHeroPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailHeroWrap: {
    borderRadius: 18,
    overflow: 'hidden',
    position: 'relative',
  },
  detailIconButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(16, 20, 38, 0.45)',
    borderRadius: 50,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  detailLink: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    marginTop: 12,
  },
  detailLinkText: {
    fontSize: 11,
    fontWeight: '900',
  },
  detailName: {
    fontSize: 22,
    fontWeight: '900',
  },
  detailSci: {
    fontSize: 11,
    fontStyle: 'italic',
    fontWeight: '700',
    marginTop: 3,
  },
  detailTopActions: {
    flexDirection: 'row',
    gap: 8,
    left: 12,
    position: 'absolute',
    top: 12,
  },
  disclaimer: {
    alignItems: 'flex-start',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 7,
    padding: 10,
  },
  disclaimerText: {
    color: '#8a6d1f',
    flex: 1,
    fontSize: 9.5,
    lineHeight: 15,
  },
  distribCopy: {
    flex: 1,
  },
  distribIcon: {
    alignItems: 'center',
    borderRadius: 10,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  distribMeta: {
    fontSize: 9,
    fontWeight: '600',
    marginTop: 3,
  },
  distribRow: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 11,
    padding: 11,
  },
  distribTitle: {
    fontSize: 11,
    fontWeight: '900',
  },
  emptyBody: {
    fontSize: 10.5,
    marginBottom: 14,
    marginTop: 5,
  },
  emptyIcon: {
    alignItems: 'center',
    borderRadius: 50,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  emptyTitle: {
    fontSize: 13,
    fontWeight: '900',
    marginTop: 12,
  },
  galleryButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(16, 20, 38, 0.42)',
    borderColor: 'rgba(255, 255, 255, 0.22)',
    borderRadius: 50,
    borderWidth: 1,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  ghostButton: {
    alignItems: 'center',
    borderColor: 'rgba(255, 255, 255, 0.32)',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    height: 42,
    paddingHorizontal: 13,
  },
  ghostButtonText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  heroActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
    marginTop: 14,
  },
  heroBody: {
    color: 'rgba(255, 255, 255, 0.82)',
    fontSize: 10.5,
    lineHeight: 16,
    marginTop: 6,
    maxWidth: 260,
  },
  heroCard: {
    flexDirection: 'row',
    minHeight: 210,
    overflow: 'hidden',
    padding: 16,
    position: 'relative',
  },
  heroCopy: {
    flex: 1,
  },
  heroImage: {
    borderRadius: 14,
    height: 110,
    position: 'absolute',
    right: 14,
    top: 64,
    width: 110,
  },
  heroTitle: {
    color: '#ffffff',
    fontSize: 19,
    fontWeight: '900',
    lineHeight: 25,
    marginTop: 9,
  },
  historyCopy: {
    flex: 1,
  },
  historyEmpty: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 14,
    padding: 28,
  },
  historyMeta: {
    fontSize: 9.5,
    fontWeight: '600',
    marginTop: 3,
  },
  historyMetaLabel: {
    fontSize: 10,
    fontWeight: '700',
  },
  historyMetaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  historyName: {
    fontSize: 12,
    fontWeight: '900',
  },
  historyRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  historyRow: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
    padding: 10,
  },
  historyScore: {
    fontSize: 10.5,
    fontWeight: '800',
  },
  historyThumb: {
    alignItems: 'center',
    backgroundColor: GREEN_SOFT,
    borderRadius: 10,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: 10,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  imageCredit: {
    backgroundColor: 'rgba(16, 20, 38, 0.5)',
    borderRadius: 999,
    bottom: 10,
    left: 12,
    paddingHorizontal: 9,
    paddingVertical: 4,
    position: 'absolute',
  },
  imageCreditText: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 8.5,
    fontWeight: '700',
  },
  inlineLoader: {
    marginVertical: 10,
  },
  kindPill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'transparent',
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  kindRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: 12,
  },
  kindText: {
    fontSize: 10.5,
    fontWeight: '800',
  },
  liveBadge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(201, 243, 106, 0.16)',
    borderColor: 'rgba(201, 243, 106, 0.45)',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  liveBadgeText: {
    color: LIME,
    fontSize: 9.5,
    fontWeight: '800',
  },
  liveChip: {
    alignItems: 'center',
    borderRadius: 999,
    flexDirection: 'row',
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  liveChipText: {
    fontSize: 9,
    fontWeight: '800',
  },
  matchCard: {
    padding: 14,
  },
  matchCopy: {
    flex: 1,
  },
  matchIcon: {
    alignItems: 'center',
    backgroundColor: GREEN_SOFT,
    borderRadius: 10,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  matchName: {
    fontSize: 15,
    fontWeight: '900',
  },
  matchRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  matchSci: {
    fontSize: 10,
    fontStyle: 'italic',
    fontWeight: '700',
    marginTop: 2,
  },
  matchTag: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  matchTags: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 6,
  },
  matchTagText: {
    fontSize: 8.5,
    fontWeight: '800',
  },
  messageBanner: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    padding: 10,
  },
  messageText: {
    flex: 1,
    fontSize: 10.5,
    lineHeight: 15,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  modalBackdrop: {
    backgroundColor: 'rgba(16, 20, 38, 0.45)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalHandle: {
    alignSelf: 'center',
    backgroundColor: 'rgba(120, 130, 150, 0.5)',
    borderRadius: 999,
    height: 4,
    marginBottom: 12,
    width: 42,
  },
  modalSheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    padding: 18,
    paddingBottom: 30,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '900',
  },
  nameBlock: {
    marginTop: 14,
  },
  noteInput: {
    borderRadius: 12,
    borderWidth: 1,
    fontSize: 12,
    height: 84,
    marginTop: 12,
    padding: 11,
    textAlignVertical: 'top',
  },
  pageHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  pageSubtitle: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  pageTitle: {
    fontSize: 20,
    fontWeight: '900',
  },
  pageTitleBlock: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  permissionButton: {
    backgroundColor: LIME,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  permissionButtonText: {
    color: NAVY,
    fontSize: 12,
    fontWeight: '900',
  },
  photoPreview: {
    borderRadius: 16,
    height: 170,
    marginTop: 12,
    width: '100%',
  },
  pressed: {
    opacity: 0.78,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: LIME,
    borderRadius: 12,
    flexDirection: 'row',
    gap: 6,
    height: 42,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  primaryButtonText: {
    color: NAVY,
    fontSize: 11,
    fontWeight: '900',
  },
  privacyCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 13,
  },
  privacyText: {
    fontSize: 10.5,
    lineHeight: 16,
    marginTop: 7,
  },
  rankBadge: {
    alignItems: 'center',
    borderRadius: 8,
    height: 27,
    justifyContent: 'center',
    width: 27,
  },
  rankText: {
    fontSize: 10,
    fontWeight: '800',
  },
  recentCard: {
    alignItems: 'center',
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 9,
    padding: 9,
    width: 190,
  },
  recentCopy: {
    flex: 1,
  },
  recentMeta: {
    fontSize: 9,
    fontWeight: '600',
    marginTop: 2,
  },
  recentName: {
    fontSize: 11,
    fontWeight: '900',
  },
  recentRow: {
    gap: 10,
    paddingBottom: 2,
  },
  recentThumb: {
    alignItems: 'center',
    backgroundColor: GREEN_SOFT,
    borderRadius: 9,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  resultsActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  resultsHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  resultsHeaderSpacer: {
    width: 36,
  },
  resultsStatus: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  resultsTitle: {
    fontSize: 17,
    fontWeight: '900',
  },
  safetyCard: {
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 12,
    padding: 13,
  },
  safetyHead: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
  },
  safetyIcon: {
    alignItems: 'center',
    borderRadius: 8,
    height: 27,
    justifyContent: 'center',
    width: 27,
  },
  safetyQuote: {
    color: '#31624a',
    fontSize: 10.5,
    lineHeight: 17,
    marginTop: 8,
  },
  safetySourceRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    marginTop: 7,
  },
  safetySourceText: {
    fontSize: 9,
    fontWeight: '800',
  },
  safetyState: {
    fontSize: 9.5,
    fontWeight: '800',
    marginLeft: 'auto',
  },
  safetyTitle: {
    fontSize: 12.5,
    fontWeight: '900',
  },
  scoreText: {
    fontSize: 10.5,
    fontWeight: '700',
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
    paddingHorizontal: 12,
  },
  secondaryButtonText: {
    fontSize: 11,
    fontWeight: '800',
  },
  sectionAction: {
    fontSize: 10,
    fontWeight: '700',
  },
  sectionHead: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 9,
    marginTop: 6,
  },
  sectionHeading: {
    fontSize: 14,
    fontWeight: '900',
  },
  sectionTitle: {
    fontSize: 12.5,
    fontWeight: '900',
  },
  sectionTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
  },
  shutterButton: {
    backgroundColor: '#ffffff',
    borderColor: 'rgba(255, 255, 255, 0.35)',
    borderRadius: 50,
    borderWidth: 5,
    height: 66,
    width: 66,
  },
  sourceCard: {
    padding: 14,
  },
  sourceCardBody: {
    fontSize: 10.5,
    lineHeight: 16,
    marginTop: 8,
  },
  sourceCardCopy: {
    flex: 1,
  },
  sourceCardHead: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  sourceCardIcon: {
    alignItems: 'center',
    borderRadius: 10,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  sourceCardMeta: {
    fontSize: 9,
    fontWeight: '600',
    marginTop: 2,
  },
  sourceCardName: {
    fontSize: 12.5,
    fontWeight: '900',
  },
  sourceChip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  sourceChipText: {
    fontSize: 9,
    fontWeight: '800',
  },
  sourceChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: 12,
  },
  sourceIcon: {
    alignItems: 'center',
    borderRadius: 8,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  sourceLine: {
    alignItems: 'center',
    borderRadius: 11,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 9,
    marginBottom: 7,
    padding: 9,
  },
  sourceLineCopy: {
    flex: 1,
  },
  sourceLineMeta: {
    fontSize: 8.5,
    fontWeight: '600',
    marginTop: 1,
  },
  sourceLineName: {
    fontSize: 10,
    fontWeight: '900',
  },
  sourceLineState: {
    fontSize: 8.5,
    fontWeight: '800',
  },
  sourceLinkRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    marginTop: 9,
  },
  sourceLinkText: {
    fontSize: 10,
    fontWeight: '800',
  },
  statusBadge: {
    alignItems: 'center',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '900',
  },
  taxonCell: {
    borderRadius: 12,
    borderWidth: 1,
    flexBasis: '47%',
    flexGrow: 1,
    padding: 10,
  },
  taxonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  taxonLabel: {
    fontSize: 9,
    fontWeight: '800',
    marginBottom: 3,
  },
  taxonValue: {
    fontSize: 11,
    fontWeight: '900',
  },
  viewfinder: {
    bottom: '24%',
    left: '12%',
    position: 'absolute',
    right: '12%',
    top: '24%',
  },
});
