import { Platform } from 'react-native';

import { getAPIBaseUrl } from '@/lib/auth-api';
import type {
  PriceRadarAsset,
  PriceRadarComment,
  PriceRadarObjection,
  PriceRadarReport,
  PriceRadarSearchResult,
  PriceRadarSourceStatus,
} from '@/types/price-radar';

type APIErrorPayload = {
  error?: string;
};

export class PriceRadarAPIError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = 'PriceRadarAPIError';
    this.code = code;
    this.status = status;
  }
}

export async function fetchPriceRadarSearch(
  query: string,
  provinceCode = '310000',
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({ q: query, provinceCode });
  return requestPriceRadarJSON<PriceRadarSearchResult>(
    `/api/v1/price-radar/search?${params}`,
    { signal },
  );
}

export function fetchPriceRadarProduct(productId: string, provinceCode = '310000', signal?: AbortSignal) {
  const params = new URLSearchParams({ provinceCode });
  return requestPriceRadarJSON<PriceRadarSearchResult>(
    `/api/v1/price-radar/products/${encodeURIComponent(productId)}?${params}`,
    { signal },
  );
}

export function fetchPriceRadarReports(productId: string, includePending = false, signal?: AbortSignal) {
  const params = new URLSearchParams({ includePending: includePending ? '1' : '0' });
  return requestPriceRadarJSON<{ items: PriceRadarReport[]; total: number }>(
    `/api/v1/price-radar/products/${encodeURIComponent(productId)}/reports?${params}`,
    { signal },
  );
}

export function fetchPriceRadarDiscussions(reportId: string, signal?: AbortSignal) {
  return requestPriceRadarJSON<{ comments: PriceRadarComment[]; objections: PriceRadarObjection[] }>(
    `/api/v1/price-radar/reports/${encodeURIComponent(reportId)}/discussions`,
    { signal },
  );
}

export function fetchPriceRadarSources(signal?: AbortSignal) {
  return requestPriceRadarJSON<{ sources: PriceRadarSourceStatus[] }>(
    '/api/v1/price-radar/sources',
    { signal },
  );
}

export function fetchMyPriceRadarContributions(token: string, signal?: AbortSignal) {
  return requestPriceRadarJSON<{ reports: PriceRadarReport[] }>(
    '/api/v1/price-radar/my-contributions',
    { token, signal },
  );
}

export async function submitPriceRadarReport(
  token: string,
  input: {
    productId: string;
    productName: string;
    storeName: string;
    storeType: string;
    price: number;
    unit: string;
    purchaseDate: string;
    address: string;
    latitude: number;
    longitude: number;
  },
  assets: PriceRadarAsset[],
) {
  const formData = new FormData();
  formData.append('productId', input.productId);
  formData.append('productName', input.productName);
  formData.append('storeName', input.storeName);
  formData.append('storeType', input.storeType);
  formData.append('price', String(input.price));
  formData.append('unit', input.unit);
  formData.append('purchaseDate', input.purchaseDate);
  formData.append('address', input.address);
  formData.append('latitude', String(input.latitude));
  formData.append('longitude', String(input.longitude));
  for (const asset of assets) {
    await appendPriceRadarAsset(formData, asset);
  }
  return requestPriceRadarJSON<PriceRadarReport>('/api/v1/price-radar/reports', {
    token,
    body: formData,
    method: 'POST',
  });
}

export async function submitPriceRadarComment(token: string, reportId: string, body: string) {
  return requestPriceRadarJSON<PriceRadarComment>(
    `/api/v1/price-radar/reports/${encodeURIComponent(reportId)}/comments`,
    {
      token,
      body: JSON.stringify({ body }),
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

export async function submitPriceRadarObjection(
  token: string,
  reportId: string,
  reason: string,
  body: string,
  assets: PriceRadarAsset[],
) {
  const formData = new FormData();
  formData.append('reason', reason);
  formData.append('body', body);
  for (const asset of assets) {
    await appendPriceRadarAsset(formData, asset);
  }
  return requestPriceRadarJSON<PriceRadarObjection>(
    `/api/v1/price-radar/reports/${encodeURIComponent(reportId)}/objections`,
    {
      token,
      body: formData,
      method: 'POST',
    },
  );
}

export function listAdminPriceReviews(token: string, signal?: AbortSignal) {
  return requestPriceRadarJSON<{ reports: PriceRadarReport[]; objections: PriceRadarObjection[] }>(
    '/api/v1/admin/price-reviews',
    { token, signal },
  );
}

export function decidePriceRadarReport(token: string, reportId: string, action: string, note: string) {
  return requestPriceRadarJSON<{ success: boolean }>(
    `/api/v1/admin/price-reviews/${encodeURIComponent(reportId)}/decision`,
    {
      token,
      body: JSON.stringify({ action, note }),
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

export function decidePriceRadarObjection(
  token: string,
  objectionId: string,
  action: string,
  resolution: string,
) {
  return requestPriceRadarJSON<{ success: boolean }>(
    `/api/v1/admin/objections/${encodeURIComponent(objectionId)}/decision`,
    {
      token,
      body: JSON.stringify({ action, resolution }),
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

export function getPriceRadarErrorMessage(error: unknown) {
  if (!(error instanceof PriceRadarAPIError)) {
    return '菜价雷达服务暂时不可用，请稍后重试。';
  }
  const messages: Record<string, string> = {
    price_radar_image_too_large: '单张图片不能超过 5 MB。',
    price_radar_image_type_invalid: '图片仅支持 JPG、PNG 或 WebP 格式。',
    price_radar_images_too_many: '最多只能上传 3 张图片。',
    price_radar_invalid_input: '请填写完整的商户、价格、单位与购买日期。',
    price_radar_product_not_found: '官方品种库暂未找到该菜名。',
    price_radar_report_not_found: '该报价记录不存在或已下线。',
    price_radar_source_invalid: '官方菜价数据格式异常，暂无法生成参考价。',
    price_radar_source_unavailable: '官方菜价数据暂时不可用，请稍后重试。',
    rate_limited: '请求过于频繁，请稍后再试。',
    unauthorized: '登录状态已失效，请重新登录。',
    admin_required: '当前账号没有管理员权限。',
  };
  return messages[error.code] || '菜价雷达请求失败，请稍后重试。';
}

async function requestPriceRadarJSON<T>(
  path: string,
  options: RequestInit & { token?: string } = {},
) {
  const headers = new Headers(options.headers);
  if (options.token) headers.set('Authorization', `Bearer ${options.token}`);
  const response = await fetch(`${getAPIBaseUrl()}${path}`, { ...options, headers });
  const payload = (await response.json().catch(() => ({}))) as T & APIErrorPayload;
  if (!response.ok) {
    throw new PriceRadarAPIError(payload.error || 'request_failed', response.status);
  }
  return payload;
}

async function appendPriceRadarAsset(formData: FormData, asset: PriceRadarAsset) {
  const fileName = asset.fileName || 'price-radar-evidence.jpg';
  if (Platform.OS === 'web') {
    const response = await fetch(asset.uri);
    formData.append('images', await response.blob(), fileName);
    return;
  }
  formData.append('images', {
    name: fileName,
    type: asset.mimeType || 'image/jpeg',
    uri: asset.uri,
  } as never);
}
