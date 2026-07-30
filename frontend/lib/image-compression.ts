import { Platform } from 'react-native';

import { getAPIBaseUrl } from '@/lib/auth-api';
import type {
  ImageCompressionAsset,
  ImageCompressionMode,
  ImageCompressionResult,
  ImageCompressionStatus,
} from '@/types/image-compression';

type APIErrorPayload = {
  error?: string;
};

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export class ImageCompressionAPIError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = 'ImageCompressionAPIError';
    this.code = code;
    this.status = status;
  }
}

export async function getImageCompressionStatus(): Promise<ImageCompressionStatus> {
  const response = await fetch(`${getAPIBaseUrl()}/api/v1/image-compression/status`);
  const payload = (await response.json().catch(() => ({}))) as ImageCompressionStatus & APIErrorPayload;
  if (!response.ok) {
    throw new ImageCompressionAPIError(payload.error || 'status_unavailable', response.status);
  }
  return { available: Boolean(payload.available), provider: payload.provider || 'TinyPNG' };
}

export async function compressImage(
  asset: ImageCompressionAsset,
  mode: ImageCompressionMode,
): Promise<ImageCompressionResult> {
  const formData = new FormData();

  if (Platform.OS === 'web') {
    const sourceResponse = await fetch(asset.uri);
    const sourceBlob = await sourceResponse.blob();
    formData.append('image', sourceBlob, asset.fileName);
  } else {
    formData.append(
      'image',
      {
        name: asset.fileName,
        type: asset.mimeType,
        uri: asset.uri,
      } as never,
    );
  }
  formData.append('mode', mode);

  const response = await fetch(`${getAPIBaseUrl()}/api/v1/image-compression/compress`, {
    body: formData,
    method: 'POST',
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as APIErrorPayload;
    throw new ImageCompressionAPIError(payload.error || 'image_compression_failed', response.status);
  }

  const data = new Uint8Array(await response.arrayBuffer());
  const mimeType = response.headers.get('Content-Type')?.split(';')[0] || asset.mimeType;
  const originalSize = parsePositiveInteger(response.headers.get('X-Original-Size')) || asset.size;
  const compressedSize = parsePositiveInteger(response.headers.get('X-Compressed-Size')) || data.byteLength;
  const uri =
    Platform.OS === 'web'
      ? URL.createObjectURL(new Blob([data], { type: mimeType }))
      : await writeNativeBytes(data, asset.fileName);

  return {
    compressedSize,
    fileName: asset.fileName,
    mimeType,
    originalSize,
    uri,
  };
}

export function releaseCompressedImage(result: ImageCompressionResult) {
  if (Platform.OS === 'web' && result.uri.startsWith('blob:')) {
    URL.revokeObjectURL(result.uri);
  }
}

export async function saveCompressedImage(result: ImageCompressionResult) {
  if (Platform.OS === 'web') {
    downloadWebUri(result.uri, result.fileName);
    return;
  }

  const MediaLibrary = await import('expo-media-library');
  const permission = await MediaLibrary.requestPermissionsAsync(true, ['photo']);
  if (!permission.granted) {
    throw new ImageCompressionAPIError('media_permission_denied', 0);
  }
  await MediaLibrary.createAssetAsync(result.uri);
}

export async function downloadCompressedImagesAsZip(results: ImageCompressionResult[]) {
  const entries = await Promise.all(
    results.map(async (result, index) => ({
      data: new Uint8Array(await (await fetch(result.uri)).arrayBuffer()),
      name: uniqueZipName(result.fileName, index),
    })),
  );
  const { createStoredZip } = await import('@/lib/stored-zip');
  const zip = createStoredZip(entries);
  const fileName = `funbox-compressed-${formatDate(new Date())}.zip`;

  if (Platform.OS === 'web') {
    const uri = URL.createObjectURL(new Blob([zip], { type: 'application/zip' }));
    downloadWebUri(uri, fileName);
    setTimeout(() => URL.revokeObjectURL(uri), 1000);
    return;
  }

  const fileUri = await writeNativeBytes(zip, fileName);
  const Sharing = await import('expo-sharing');
  if (!(await Sharing.isAvailableAsync())) {
    throw new ImageCompressionAPIError('sharing_unavailable', 0);
  }
  await Sharing.shareAsync(fileUri, {
    dialogTitle: '导出压缩图片',
    mimeType: 'application/zip',
    UTI: 'public.zip-archive',
  });
}

export function getImageCompressionErrorMessage(error: unknown) {
  if (!(error instanceof ImageCompressionAPIError)) {
    return '图片压缩失败，请检查网络后重试。';
  }

  const messages: Record<string, string> = {
    compression_mode_invalid: '压缩策略无效，请重新选择。',
    image_compression_failed: 'TinyPNG 暂时无法处理这张图片，请稍后重试。',
    image_compression_not_configured: '图片压缩服务尚未配置。',
    image_required: '请选择需要压缩的图片。',
    image_too_large: '单张图片不能超过 5 MB。',
    image_type_invalid: '仅支持 JPG、PNG 和 WebP 图片。',
    media_permission_denied: '需要相册权限才能保存图片。',
    provider_auth_failed: 'TinyPNG 服务认证失败，请联系管理员。',
    provider_quota_exceeded: 'TinyPNG 本月额度已用完，请稍后再试。',
    rate_limited: '操作过于频繁，请稍后再试。',
    sharing_unavailable: '当前设备不支持分享 ZIP 文件。',
  };
  return messages[error.code] || '图片压缩失败，请稍后重试。';
}

function parsePositiveInteger(value: string | null) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function downloadWebUri(uri: string, fileName: string) {
  if (typeof document === 'undefined') return;
  const anchor = document.createElement('a');
  anchor.download = fileName;
  anchor.href = uri;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

async function writeNativeBytes(data: Uint8Array, fileName: string) {
  const FileSystem = await import('expo-file-system/legacy');
  if (!FileSystem.cacheDirectory) {
    throw new ImageCompressionAPIError('cache_unavailable', 0);
  }
  const fileUri = `${FileSystem.cacheDirectory}${sanitizeFileName(fileName)}`;
  await FileSystem.writeAsStringAsync(fileUri, bytesToBase64(data), {
    encoding: FileSystem.EncodingType.Base64,
  });
  return fileUri;
}

function sanitizeFileName(fileName: string) {
  return fileName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').slice(-120) || 'compressed-image.png';
}

function uniqueZipName(fileName: string, index: number) {
  return `${String(index + 1).padStart(2, '0')}-${sanitizeFileName(fileName)}`;
}

function formatDate(date: Date) {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part) => String(part).padStart(2, '0'))
    .join('');
}

function bytesToBase64(data: Uint8Array) {
  let output = '';
  for (let index = 0; index < data.length; index += 3) {
    const a = data[index];
    const b = data[index + 1];
    const c = data[index + 2];
    output += BASE64_ALPHABET[a >> 2];
    output += BASE64_ALPHABET[((a & 3) << 4) | ((b ?? 0) >> 4)];
    output += b === undefined ? '=' : BASE64_ALPHABET[((b & 15) << 2) | ((c ?? 0) >> 6)];
    output += c === undefined ? '=' : BASE64_ALPHABET[c & 63];
  }
  return output;
}
