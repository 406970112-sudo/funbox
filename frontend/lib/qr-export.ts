import type { RefObject } from 'react';
import { Platform, type View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

export type QrExportFormat = 'png' | 'svg';

const QR_EXPORT_CORAL = '#ef765f';
const QR_PREVIEW_BASE_SIZE = 246;

export async function captureQrPng(
  viewRef: RefObject<View | null>,
  size: number,
): Promise<string> {
  return captureRef(viewRef, {
    format: 'png',
    height: size,
    quality: 1,
    result: Platform.OS === 'web' ? 'data-uri' : 'tmpfile',
    width: size,
  });
}

export async function createWebQrPng({
  backgroundColor,
  color,
  payload,
  rounded,
  size,
  transparent,
}: {
  backgroundColor: string;
  color: string;
  payload: string;
  rounded: boolean;
  size: number;
  transparent: boolean;
}): Promise<string> {
  if (typeof document === 'undefined') {
    throw new Error('Web PNG export requires a browser.');
  }

  const { default: QRCode } = await import('qrcode');
  const canvas = document.createElement('canvas');
  const qrCanvas = document.createElement('canvas');
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('The browser cannot create a PNG image.');
  }

  canvas.height = size;
  canvas.width = size;

  const paperRadius = rounded ? Math.round(size * (22 / QR_PREVIEW_BASE_SIZE)) : Math.round(size * (6 / QR_PREVIEW_BASE_SIZE));
  const paperPadding = Math.max(8, Math.round(size * (14 / QR_PREVIEW_BASE_SIZE)));
  const qrSize = size - paperPadding * 2;

  if (!transparent) {
    drawRoundedSquare(context, 0, 0, size, paperRadius);
    context.fillStyle = backgroundColor;
    context.fill();
  }

  await QRCode.toCanvas(qrCanvas, payload, {
    color: {
      dark: color,
      light: transparent ? '#00000000' : backgroundColor,
    },
    errorCorrectionLevel: 'H',
    margin: 0,
    width: qrSize,
  });
  context.drawImage(qrCanvas, paperPadding, paperPadding, qrSize, qrSize);

  const logoSize = Math.round(size * (40 / QR_PREVIEW_BASE_SIZE));
  const logoBorder = Math.max(3, Math.round(size * (4 / QR_PREVIEW_BASE_SIZE)));
  const logoRadius = Math.round(logoSize * (rounded ? 13 / 40 : 5 / 40));
  const logoPosition = (size - logoSize) / 2;

  drawRoundedSquare(context, logoPosition, logoPosition, logoSize, logoRadius);
  context.fillStyle = '#ffffff';
  context.fill();

  const innerSize = logoSize - logoBorder * 2;
  drawRoundedSquare(
    context,
    logoPosition + logoBorder,
    logoPosition + logoBorder,
    innerSize,
    Math.max(1, logoRadius - logoBorder),
  );
  context.fillStyle = QR_EXPORT_CORAL;
  context.fill();

  context.fillStyle = '#ffffff';
  context.font = `900 ${Math.round(size * (16 / QR_PREVIEW_BASE_SIZE))}px sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText('F', size / 2, size / 2);

  return canvas.toDataURL('image/png');
}

function drawRoundedSquare(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  radius: number,
) {
  const boundedRadius = Math.min(radius, size / 2);

  context.beginPath();
  context.moveTo(x + boundedRadius, y);
  context.lineTo(x + size - boundedRadius, y);
  context.arcTo(x + size, y, x + size, y + boundedRadius, boundedRadius);
  context.lineTo(x + size, y + size - boundedRadius);
  context.arcTo(x + size, y + size, x + size - boundedRadius, y + size, boundedRadius);
  context.lineTo(x + boundedRadius, y + size);
  context.arcTo(x, y + size, x, y + size - boundedRadius, boundedRadius);
  context.lineTo(x, y + boundedRadius);
  context.arcTo(x, y, x + boundedRadius, y, boundedRadius);
  context.closePath();
}

export async function createQrSvg({
  backgroundColor,
  color,
  payload,
  size,
  transparent,
}: {
  backgroundColor: string;
  color: string;
  payload: string;
  size: number;
  transparent: boolean;
}): Promise<string> {
  const { default: QRCode } = await import('qrcode');

  return QRCode.toString(payload, {
    color: {
      dark: color,
      light: transparent ? '#00000000' : backgroundColor,
    },
    errorCorrectionLevel: 'H',
    margin: 2,
    type: 'svg',
    width: size,
  });
}

export function downloadWebData(data: string, fileName: string, mimeType: string): void {
  if (typeof document === 'undefined') {
    return;
  }

  const isDataUri = data.startsWith('data:');
  const url = isDataUri ? data : URL.createObjectURL(new Blob([data], { type: mimeType }));
  const anchor = document.createElement('a');

  anchor.download = fileName;
  anchor.href = url;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  if (!isDataUri) {
    URL.revokeObjectURL(url);
  }
}

export async function shareWebPng(dataUri: string, fileName: string): Promise<'downloaded' | 'shared'> {
  const response = await fetch(dataUri);
  const blob = await response.blob();
  const file = new File([blob], fileName, { type: 'image/png' });
  const shareNavigator = navigator as Navigator & {
    canShare?: (data: ShareData) => boolean;
    share?: (data: ShareData) => Promise<void>;
  };
  const shareData: ShareData = {
    files: [file],
    text: '由 FunBox 生成的二维码',
    title: '分享二维码',
  };

  if (shareNavigator.share && (shareNavigator.canShare?.(shareData) ?? true)) {
    await shareNavigator.share(shareData);
    return 'shared';
  }

  downloadWebData(dataUri, fileName, 'image/png');
  return 'downloaded';
}

export async function writeNativeSvg(svg: string, fileName: string): Promise<string> {
  const FileSystem = await import('expo-file-system/legacy');

  if (!FileSystem.cacheDirectory) {
    throw new Error('当前设备没有可用的缓存目录。');
  }

  const fileUri = `${FileSystem.cacheDirectory}${fileName}`;
  await FileSystem.writeAsStringAsync(fileUri, svg, {
    encoding: FileSystem.EncodingType.UTF8,
  });
  return fileUri;
}
