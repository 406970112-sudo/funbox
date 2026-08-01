import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import jsQR from 'jsqr';
import {
  createElement,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';

type ScannerProps = {
  onClose: () => void;
  onDetected: (value: string) => void;
  onManualEntry: () => void;
};

type CameraState = 'starting' | 'ready' | 'denied' | 'unsupported';

export function CardScoreScanner({ onClose, onDetected, onManualEntry }: ScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const detectedRef = useRef(onDetected);
  const [cameraState, setCameraState] = useState<CameraState>('starting');
  const [decoding, setDecoding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  detectedRef.current = onDetected;

  useEffect(() => {
    let disposed = false;
    let stream: MediaStream | null = null;
    let frame = 0;
    let lastScan = 0;

    async function tick() {
      if (disposed) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const now = performance.now();
      if (video && canvas && video.readyState >= 2 && now - lastScan > 180) {
        lastScan = now;
        const sourceWidth = video.videoWidth || 640;
        const sourceHeight = video.videoHeight || 480;
        const width = Math.min(sourceWidth, 720);
        const height = Math.max(1, Math.round((width * sourceHeight) / Math.max(sourceWidth, 1)));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (context) {
          context.drawImage(video, 0, 0, width, height);
          try {
            const value = await detectFromCanvas(canvas);
            if (value && !disposed) {
              detectedRef.current(value);
              return;
            }
          } catch {
            // Keep scanning the next frame.
          }
        }
      }
      frame = requestAnimationFrame(() => void tick());
    }

    async function startCamera() {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        if (!disposed) setCameraState('unsupported');
        return;
      }
      try {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: 'environment' },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
          });
        }
        if (disposed) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        video.muted = true;
        setCameraState('ready');
        await video.play().catch(() => undefined);
        if (disposed) return;
        frame = requestAnimationFrame(() => void tick());
      } catch {
        if (!disposed) setCameraState('denied');
      }
    }

    void startCamera();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      if (stream) stream.getTracks().forEach((track) => track.stop());
    };
  }, []);

  function openAlbum() {
    fileRef.current?.click();
  }

  async function loadBitmap(file: File) {
    if (typeof createImageBitmap === 'function') return createImageBitmap(file);
    return new Promise<HTMLImageElement>((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('image load failed'));
      };
      image.src = url;
    });
  }

  async function handleAlbumFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setDecoding(true);
    setMessage(null);
    try {
      const bitmap = await loadBitmap(file);
      const canvas = canvasRef.current;
      if (!canvas) return;
      const sourceWidth = (bitmap as HTMLImageElement).naturalWidth || bitmap.width || 1;
      const sourceHeight = (bitmap as HTMLImageElement).naturalHeight || bitmap.height || 1;
      const maxSource = Math.max(sourceWidth, sourceHeight);
      const scale = maxSource < 256 ? Math.min(4, Math.ceil(256 / maxSource)) : 1;
      const attempts: { height: number; smoothing: boolean; width: number }[] = [];
      if (scale > 1) {
        attempts.push({ height: sourceHeight * scale, smoothing: false, width: sourceWidth * scale });
        attempts.push({ height: sourceHeight * scale, smoothing: true, width: sourceWidth * scale });
      }
      attempts.push({ height: sourceHeight, smoothing: false, width: sourceWidth });

      for (const attempt of attempts) {
        canvas.width = attempt.width;
        canvas.height = attempt.height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) continue;
        context.imageSmoothingEnabled = attempt.smoothing;
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, attempt.width, attempt.height);
        context.drawImage(bitmap, 0, 0, attempt.width, attempt.height);
        const value = await detectFromCanvas(canvas);
        if (value) {
          onDetected(value);
          return;
        }
      }
      setMessage('没有在图片中识别到牌局二维码，请确认二维码完整清晰后重试。');
    } catch {
      setMessage('图片读取失败，请重试。');
    } finally {
      setDecoding(false);
    }
  }

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.topbar}>
        <Pressable
          accessibilityLabel="关闭扫码"
          accessibilityRole="button"
          onPress={onClose}
          style={styles.iconButton}>
          <MaterialCommunityIcons name="close" color="#ffffff" size={22} />
        </Pressable>
        <ThemedText style={styles.title}>扫描房间二维码</ThemedText>
        <Pressable
          accessibilityRole="button"
          onPress={onManualEntry}
          style={styles.manualButton}>
          <ThemedText style={styles.manualButtonText}>输入房间码</ThemedText>
        </Pressable>
      </View>

      <View style={styles.cameraShell}>
        {createElement('video', {
          autoPlay: true,
          muted: true,
          playsInline: true,
          ref: videoRef,
          style: styles.video,
        })}
        {cameraState === 'starting' ? (
          <View style={styles.centerState}>
            <ActivityIndicator color="#c9f36a" />
            <ThemedText style={styles.stateText}>正在打开相机</ThemedText>
          </View>
        ) : null}
        {cameraState === 'denied' ? (
          <View style={styles.centerState}>
            <MaterialCommunityIcons name="camera-off-outline" color="#ffffff" size={34} />
            <ThemedText style={styles.stateText}>相机权限未开启，可改用相册选图</ThemedText>
          </View>
        ) : null}
        {cameraState === 'unsupported' ? (
          <View style={styles.centerState}>
            <MaterialCommunityIcons name="camera-outline" color="#ffffff" size={34} />
            <ThemedText style={styles.stateText}>当前浏览器不支持相机扫码，可改用相册选图</ThemedText>
          </View>
        ) : null}
        <View pointerEvents="none" style={styles.viewfinder}>
          <View style={[styles.corner, styles.cornerTL]} />
          <View style={[styles.corner, styles.cornerTR]} />
          <View style={[styles.corner, styles.cornerBL]} />
          <View style={[styles.corner, styles.cornerBR]} />
        </View>
        {createElement('canvas', { ref: canvasRef, style: styles.hiddenCanvas })}
      </View>

      <ThemedText style={styles.hint}>将房主手机上的二维码放入框内</ThemedText>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          disabled={decoding}
          onPress={openAlbum}
          style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}>
          <MaterialCommunityIcons name="image-multiple-outline" color="#ffffff" size={20} />
          <ThemedText style={styles.actionLabel}>{decoding ? '识别中' : '相册选图'}</ThemedText>
        </Pressable>
      </View>
      {message ? <ThemedText style={styles.message}>{message}</ThemedText> : null}
      {createElement('input', {
        accept: 'image/*',
        onChange: handleAlbumFile,
        ref: fileRef,
        style: { display: 'none' },
        type: 'file',
      })}
    </SafeAreaView>
  );
}

type BarcodeDetectorLike = {
  detect(source: HTMLCanvasElement): Promise<{ rawValue: string }[]>;
};

function getBarcodeDetector(): BarcodeDetectorLike | null {
  if (typeof window === 'undefined') return null;
  const constructor = (
    window as unknown as {
      BarcodeDetector?: new (options?: { formats?: string[] }) => BarcodeDetectorLike;
    }
  ).BarcodeDetector;
  if (!constructor) return null;
  try {
    return new constructor({ formats: ['qr_code'] });
  } catch {
    return null;
  }
}

async function detectFromCanvas(canvas: HTMLCanvasElement) {
  const detector = getBarcodeDetector();
  if (detector) {
    try {
      const codes = await detector.detect(canvas);
      if (codes[0]?.rawValue) return codes[0].rawValue;
    } catch {
      // Fall through to the pure JS decoder.
    }
  }
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  try {
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const result = jsQR(image.data, image.width, image.height);
    return result?.data ?? null;
  } catch {
    return null;
  }
}

const styles = StyleSheet.create({
  actionButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderColor: 'rgba(255, 255, 255, 0.16)',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 52,
    paddingHorizontal: 18,
  },
  actionLabel: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  actions: {
    alignItems: 'center',
    paddingBottom: 18,
    paddingTop: 6,
  },
  cameraShell: {
    backgroundColor: '#0d1420',
    flex: 1,
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  centerState: {
    alignItems: 'center',
    bottom: 0,
    gap: 12,
    justifyContent: 'center',
    left: 0,
    paddingHorizontal: 28,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  corner: {
    borderColor: '#c9f36a',
    height: 26,
    position: 'absolute',
    width: 26,
  },
  cornerBL: {
    borderBottomLeftRadius: 8,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    bottom: 14,
    left: 14,
  },
  cornerBR: {
    borderBottomRightRadius: 8,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    bottom: 14,
    right: 14,
  },
  cornerTL: {
    borderLeftWidth: 3,
    borderTopLeftRadius: 8,
    borderTopWidth: 3,
    left: 14,
    top: 14,
  },
  cornerTR: {
    borderRightWidth: 3,
    borderTopRightRadius: 8,
    borderTopWidth: 3,
    right: 14,
    top: 14,
  },
  hiddenCanvas: {
    display: 'none',
  },
  hint: {
    color: 'rgba(255, 255, 255, 0.82)',
    fontSize: 13,
    fontWeight: '700',
    paddingHorizontal: 20,
    paddingTop: 16,
    textAlign: 'center',
  },
  iconButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderColor: 'rgba(255, 255, 255, 0.16)',
    borderRadius: 16,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  manualButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: 4,
  },
  manualButtonText: {
    color: '#c9f36a',
    fontSize: 12,
    fontWeight: '800',
  },
  message: {
    color: '#ffd0d6',
    fontSize: 12,
    lineHeight: 18,
    paddingBottom: 16,
    paddingHorizontal: 24,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.75,
  },
  root: {
    backgroundColor: '#0d1420',
    flex: 1,
  },
  stateText: {
    color: 'rgba(255, 255, 255, 0.86)',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 20,
    textAlign: 'center',
  },
  title: {
    color: '#ffffff',
    flex: 1,
    fontSize: 16,
    fontWeight: '900',
    textAlign: 'center',
  },
  topbar: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  video: {
    bottom: 0,
    height: '100%',
    left: 0,
    objectFit: 'cover',
    position: 'absolute',
    right: 0,
    top: 0,
    width: '100%',
  },
  viewfinder: {
    alignSelf: 'center',
    height: 210,
    position: 'absolute',
    width: '72%',
  },
});
