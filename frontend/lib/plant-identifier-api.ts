import { Platform } from 'react-native';

import { getAPIBaseUrl } from './auth-api';
import type {
  CommonPlant,
  IdentificationResult,
  PlantFeedbackInput,
  PlantHistoryItem,
  PlantSourcesResponse,
  SpeciesDetail,
} from '@/types/plant-identifier';

type ErrorPayload = {
  error?: string;
};

export class PlantIdentifierAPIError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = 'PlantIdentifierAPIError';
    this.code = code;
    this.status = status;
  }
}

export type PlantPhotoAsset = {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
};

export async function identifyPlantImage(
  asset: PlantPhotoAsset,
  token?: string | null,
  signal?: AbortSignal,
) {
  const form = new FormData();
  const fileName = asset.fileName || 'plant-photo.jpg';
  const mimeType = asset.mimeType || mimeFromUri(asset.uri) || 'image/jpeg';
  if (Platform.OS === 'web') {
    const blob = await fetch(asset.uri).then((response) => response.blob());
    form.append('image', blob, fileName);
  } else {
    form.append('image', {
      uri: asset.uri,
      name: fileName,
      type: mimeType,
    } as unknown as Blob);
  }
  return requestJSON<IdentificationResult>('/api/v1/plant-id/identify', {
    body: form,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    method: 'POST',
    signal,
  });
}

export async function fetchPlantSpecies(
  gbifKey: number,
  hint?: { scientificName?: string; commonName?: string; family?: string; genus?: string },
  token?: string | null,
) {
  const search = new URLSearchParams();
  if (hint?.scientificName) search.set('scientificName', hint.scientificName);
  if (hint?.commonName) search.set('commonName', hint.commonName);
  if (hint?.family) search.set('family', hint.family);
  if (hint?.genus) search.set('genus', hint.genus);
  const query = search.toString();
  return requestJSON<SpeciesDetail>(
    `/api/v1/plant-id/species/${gbifKey}${query ? `?${query}` : ''}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  );
}

export async function fetchPlantCommonPlants() {
  const response = await requestJSON<{ items: CommonPlant[]; fetchedAt: string }>(
    '/api/v1/plant-id/common-plants',
  );
  return response;
}

export async function fetchPlantSources() {
  return requestJSON<PlantSourcesResponse>('/api/v1/plant-id/sources');
}

export async function fetchPlantHistory(token: string, limit = 30) {
  const response = await requestJSON<{ items: PlantHistoryItem[] }>(
    `/api/v1/plant-id/history?limit=${limit}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return response.items;
}

export async function deletePlantHistory(token: string, historyId: string) {
  await requestJSON<{ success: boolean }>(
    `/api/v1/plant-id/history/${encodeURIComponent(historyId)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      method: 'DELETE',
    },
  );
}

export async function clearPlantHistory(token: string) {
  await requestJSON<{ success: boolean }>('/api/v1/plant-id/history', {
    headers: { Authorization: `Bearer ${token}` },
    method: 'DELETE',
  });
}

export async function submitPlantFeedback(payload: PlantFeedbackInput, token?: string | null) {
  await requestJSON<{ success: boolean }>('/api/v1/plant-id/feedback', {
    body: JSON.stringify(payload),
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    method: 'POST',
  });
}

export function getPlantIdentifierErrorMessage(error: unknown) {
  if (!(error instanceof PlantIdentifierAPIError)) {
    return '暂时无法连接识花草服务，请稍后重试。';
  }
  const messages: Record<string, string> = {
    plant_id_not_configured: '识别服务暂未配置，请稍后再试。',
    plant_id_provider_failed: '识别服务暂时不可用，请重试。',
    plant_id_request_failed: '识别请求失败，请稍后重试。',
    plant_species_not_found: '没有找到该物种的完整资料。',
    gbif_key_invalid: '物种编号无效。',
    image_too_large: '图片不能超过 5 MB。',
    image_type_invalid: '图片仅支持 JPG、PNG 或 WebP。',
    image_required: '请选择一张植物照片。',
    rate_limited: '请求过于频繁，请稍后再试。',
    unauthorized: '登录状态已失效，请重新登录。',
    feedback_failed: '反馈提交失败，请稍后重试。',
    history_failed: '历史记录加载失败，请稍后重试。',
    history_not_found: '该条记录不存在或已删除。',
  };
  return messages[error.code] || '识花草请求失败，请稍后重试。';
}

function mimeFromUri(uri: string) {
  const lower = uri.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

async function requestJSON<T>(path: string, options: RequestInit = {}) {
  const baseUrl = getAPIBaseUrl();
  const response = await fetch(`${baseUrl}${path}`, options);
  const payload = (await response.json().catch(() => ({}))) as T & ErrorPayload;
  if (!response.ok) {
    throw new PlantIdentifierAPIError(payload.error || 'request_failed', response.status);
  }
  return payload;
}
