import { getAPIBaseUrl } from '@/lib/auth-api';
import type {
  HomeRecommendationAdminListResponse,
  HomeRecommendationAuditEntry,
  HomeRecommendationSlot,
  HomeRecommendationSlotInput,
  HomeRecommendationSlotStats,
  HomeRecommendationsResponse,
} from '@/types/home-recommendation';

type ErrorPayload = {
  error?: string;
};

export class HomeRecommendationAPIError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = 'HomeRecommendationAPIError';
    this.code = code;
    this.status = status;
  }
}

export async function getHomeRecommendations(
  token: string | null,
  options: { date?: string } = {},
) {
  const query = options.date ? `?date=${encodeURIComponent(options.date)}` : '';
  return requestHomeRecommendationJSON<HomeRecommendationsResponse>(
    `/api/v1/home/recommendations${query}`,
    token,
  );
}

export async function recordHomeRecommendationEvent(
  token: string,
  input: { eventType: 'view' | 'click'; slotId: string; date?: string },
) {
  await requestHomeRecommendationJSON<{ success: boolean } & ErrorPayload>(
    '/api/v1/home/recommendations/events',
    token,
    {
      body: JSON.stringify({
        date: input.date ?? '',
        eventType: input.eventType,
        slotId: input.slotId,
      }),
      method: 'POST',
    },
  );
}

export async function getAdminHomeRecommendations(token: string) {
  return requestHomeRecommendationJSON<HomeRecommendationAdminListResponse & ErrorPayload>(
    '/api/v1/admin/home-recommendations',
    token,
  );
}

export async function createAdminHomeRecommendation(token: string, slot: HomeRecommendationSlotInput) {
  return requestHomeRecommendationJSON<{ slot: HomeRecommendationSlot } & ErrorPayload>(
    '/api/v1/admin/home-recommendations',
    token,
    {
      body: JSON.stringify({ slot }),
      method: 'POST',
    },
  );
}

export async function updateAdminHomeRecommendation(
  token: string,
  slotID: string,
  slot: HomeRecommendationSlotInput,
) {
  return requestHomeRecommendationJSON<{ slot: HomeRecommendationSlot } & ErrorPayload>(
    `/api/v1/admin/home-recommendations/${encodeURIComponent(slotID)}`,
    token,
    {
      body: JSON.stringify({ slot }),
      method: 'PUT',
    },
  );
}

export async function deleteAdminHomeRecommendation(token: string, slotID: string) {
  await requestHomeRecommendationJSON<{ success: boolean } & ErrorPayload>(
    `/api/v1/admin/home-recommendations/${encodeURIComponent(slotID)}`,
    token,
    { method: 'DELETE' },
  );
}

export async function reorderAdminHomeRecommendations(token: string, slotIDs: string[]) {
  await requestHomeRecommendationJSON<{ success: boolean } & ErrorPayload>(
    '/api/v1/admin/home-recommendations/reorder',
    token,
    {
      body: JSON.stringify({ slotIds: slotIDs }),
      method: 'PUT',
    },
  );
}

export async function getHomeRecommendationAuditLog(token: string) {
  const response = await requestHomeRecommendationJSON<
    { items: HomeRecommendationAuditEntry[] } & ErrorPayload
  >('/api/v1/admin/home-recommendations/audit-log', token);
  return response.items;
}

export async function getHomeRecommendationStats(token: string) {
  const response = await requestHomeRecommendationJSON<
    { items: HomeRecommendationSlotStats[]; sinceDate: string } & ErrorPayload
  >('/api/v1/admin/home-recommendations/stats', token);
  return response;
}

export function getHomeRecommendationErrorMessage(error: unknown) {
  if (!(error instanceof HomeRecommendationAPIError)) {
    return '首页推荐服务暂时不可用，请稍后重试。';
  }
  const messages: Record<string, string> = {
    admin_required: '当前账号没有管理员权限。',
    home_recommendation_at_least_one: '至少保留 1 个推荐位。',
    home_recommendation_feature_invalid: '推荐功能不存在、已下架或不可推荐。',
    home_recommendation_date_range_invalid: '生效日期范围不合法，开始日期不能晚于结束日期。',
    home_recommendation_weekday_invalid: '生效星期取值需要在 1-7 且不能重复。',
    home_recommendation_override_invalid: '文案覆盖长度不合法，请检查后重试。',
    home_recommendation_slot_not_found: '推荐位不存在或已删除。',
    unauthorized: '登录状态已失效，请重新登录。',
  };
  return messages[error.code] || '首页推荐保存失败，请稍后重试。';
}

async function requestHomeRecommendationJSON<T>(
  path: string,
  token: string | null,
  options: RequestInit = {},
) {
  const headers = new Headers(options.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(`${getAPIBaseUrl()}${path}`, { ...options, headers });
  const payload = (await response.json().catch(() => ({}))) as T;
  if (!response.ok) {
    throw new HomeRecommendationAPIError(
      (payload as ErrorPayload).error || 'request_failed',
      response.status,
    );
  }
  return payload;
}
