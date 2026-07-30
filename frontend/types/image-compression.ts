export type ImageCompressionMode = 'smart' | 'quality';

export type ImageCompressionAsset = {
  fileName: string;
  id: string;
  mimeType: string;
  size: number;
  uri: string;
};

export type ImageCompressionResult = {
  compressedSize: number;
  fileName: string;
  mimeType: string;
  originalSize: number;
  uri: string;
};

export type ImageCompressionStatus = {
  available: boolean;
  provider: string;
};
