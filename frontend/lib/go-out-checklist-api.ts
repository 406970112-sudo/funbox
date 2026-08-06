import { getAPIBaseUrl } from '@/lib/auth-api';
import type {
  GoOutCity,
  GoOutCompletion,
  GoOutConfirmedItem,
  GoOutHealth,
  GoOutHistoryResponse,
  GoOutHomeResponse,
  GoOutItem,
  GoOutItemInput,
  GoOutScene,
  GoOutSceneInput,
  GoOutSceneItem,
  GoOutSettings,
  GoOutSettingsPayload,
  GoOutTemplate,
  GoOutWeatherSnapshot,
} from '@/types/go-out-checklist';

type ErrorPayload = { error?: string };

export class GoOutChecklistAPIError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = 'GoOutChecklistAPIError';
    this.code = code;
    this.status = status;
  }
}

export function fetchGoOutChecklistHome(token: string, sceneId?: string) {
  const suffix = sceneId ? `?sceneId=${encodeURIComponent(sceneId)}` : '';
  return requestJSON<GoOutHomeResponse>(`/api/v1/go-out-checklist/home${suffix}`, token);
}

export async function fetchGoOutChecklistItems(token: string) {
  const payload = await requestJSON<{ items: GoOutItem[] }>(
    '/api/v1/go-out-checklist/items',
    token,
  );
  return payload.items;
}

export function createGoOutChecklistItem(token: string, input: GoOutItemInput) {
  return requestJSON<GoOutItem>('/api/v1/go-out-checklist/items', token, {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export function updateGoOutChecklistItem(
  token: string,
  itemId: string,
  input: Partial<GoOutItemInput>,
) {
  return requestJSON<GoOutItem>(
    `/api/v1/go-out-checklist/items/${encodeURIComponent(itemId)}`,
    token,
    {
      body: JSON.stringify(input),
      method: 'PATCH',
    },
  );
}

export function deleteGoOutChecklistItem(token: string, itemId: string) {
  return requestJSON<{ success: boolean }>(
    `/api/v1/go-out-checklist/items/${encodeURIComponent(itemId)}`,
    token,
    { method: 'DELETE' },
  );
}

export async function fetchGoOutChecklistScenes(token: string) {
  return requestJSON<{ scenes: GoOutScene[]; sceneItems: GoOutSceneItem[] }>(
    '/api/v1/go-out-checklist/scenes',
    token,
  );
}

export function createGoOutChecklistScene(token: string, input: GoOutSceneInput) {
  return requestJSON<GoOutScene>('/api/v1/go-out-checklist/scenes', token, {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export function updateGoOutChecklistScene(
  token: string,
  sceneId: string,
  input: Partial<GoOutSceneInput>,
) {
  return requestJSON<GoOutScene>(
    `/api/v1/go-out-checklist/scenes/${encodeURIComponent(sceneId)}`,
    token,
    {
      body: JSON.stringify(input),
      method: 'PUT',
    },
  );
}

export function deleteGoOutChecklistScene(token: string, sceneId: string) {
  return requestJSON<{ success: boolean }>(
    `/api/v1/go-out-checklist/scenes/${encodeURIComponent(sceneId)}`,
    token,
    { method: 'DELETE' },
  );
}

export async function fetchGoOutChecklistTemplates(token: string) {
  const payload = await requestJSON<{ templates: GoOutTemplate[] }>(
    '/api/v1/go-out-checklist/templates',
    token,
  );
  return payload.templates;
}

export function applyGoOutChecklistTemplate(token: string, templateId: string) {
  return requestJSON<GoOutScene>(
    `/api/v1/go-out-checklist/templates/${encodeURIComponent(templateId)}/apply`,
    token,
    { body: '{}', method: 'POST' },
  );
}

export function fetchGoOutChecklistSettings(token: string) {
  return requestJSON<GoOutSettingsPayload>('/api/v1/go-out-checklist/settings', token);
}

export function saveGoOutChecklistSettings(
  token: string,
  payload: GoOutSettingsPayload,
) {
  return requestJSON<GoOutSettingsPayload>('/api/v1/go-out-checklist/settings', token, {
    body: JSON.stringify(payload),
    method: 'PUT',
  });
}

export function fetchGoOutChecklistHistory(token: string) {
  return requestJSON<GoOutHistoryResponse>('/api/v1/go-out-checklist/history', token);
}

export function addGoOutChecklistCompletion(
  token: string,
  input: { sceneId: string; confirmedItems: GoOutConfirmedItem[] },
) {
  return requestJSON<GoOutCompletion>('/api/v1/go-out-checklist/completions', token, {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export function deleteGoOutChecklistCompletion(token: string, id: string) {
  return requestJSON<{ success: boolean }>(
    `/api/v1/go-out-checklist/completions/${encodeURIComponent(id)}`,
    token,
    { method: 'DELETE' },
  );
}

export function fetchGoOutChecklistHealth(token: string) {
  return requestJSON<GoOutHealth>('/api/v1/go-out-checklist/weather/health', token);
}

export async function searchGoOutChecklistCities(token: string, query: string) {
  const payload = await requestJSON<{ results: GoOutCity[] }>(
    `/api/v1/go-out-checklist/cities?q=${encodeURIComponent(query)}`,
    token,
  );
  return payload.results;
}

export async function downloadGoOutChecklistExport(token: string, format: 'csv' | 'json') {
  const response = await fetch(
    `${getAPIBaseUrl()}/api/v1/go-out-checklist/export?format=${format}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  const payload = (await response.json().catch(() => ({}))) as ErrorPayload;
  if (!response.ok) {
    throw new GoOutChecklistAPIError(payload.error || 'request_failed', response.status);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `go-out-checklist.${format}`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function clearGoOutChecklistData(token: string) {
  return requestJSON<{ success: boolean }>('/api/v1/go-out-checklist/data', token, {
    method: 'DELETE',
  });
}

export async function fetchLocalGoOutWeather(
  settings: GoOutSettings,
): Promise<GoOutWeatherSnapshot> {
  if (!settings.city || !settings.lat || !settings.lon) {
    return {
      available: false,
      status: 'unavailable',
      unavailableMsg: '请先选择城市',
    };
  }
  const forecastURL =
    `https://api.open-meteo.com/v1/forecast?latitude=${settings.lat}` +
    `&longitude=${settings.lon}&timezone=${encodeURIComponent(settings.timezone || 'Asia/Shanghai')}` +
    `&current=temperature_2m,apparent_temperature,weather_code` +
    `&daily=temperature_2m_max,precipitation_probability_max,uv_index_max&forecast_days=1`;
  const airURL =
    `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${settings.lat}` +
    `&longitude=${settings.lon}&current=european_aqi&timezone=${encodeURIComponent(settings.timezone || 'Asia/Shanghai')}`;
  try {
    const [forecast, air] = await Promise.all([
      fetch(forecastURL).then((response) => response.json()),
      fetch(airURL).then((response) => response.json()),
    ]);
    const daily = forecast?.daily;
    const current = forecast?.current;
    const snapshot: GoOutWeatherSnapshot = {
      available: true,
      status: 'complete',
      city: settings.city,
      temperature: daily?.temperature_2m_max?.[0],
      feelsLike: current?.apparent_temperature,
      precipProb: daily?.precipitation_probability_max?.[0],
      uvIndex: daily?.uv_index_max?.[0],
      aqi: air?.current?.european_aqi,
      weatherCode: current?.weather_code,
      source: 'Open-Meteo',
      fetchedAt: new Date().toISOString(),
      license: 'cc-by-4.0',
    };
    return snapshot;
  } catch {
    return {
      available: false,
      status: 'unavailable',
      unavailableMsg: '天气暂未获取',
    };
  }
}

export function getGoOutChecklistErrorMessage(error: unknown) {
  if (!(error instanceof GoOutChecklistAPIError)) {
    return '暂时无法连接出门检查清单服务，请稍后重试。';
  }
  const messages: Record<string, string> = {
    go_out_checklist_invalid_input: '清单内容不完整，请检查后重试。',
    go_out_checklist_not_found: '记录不存在，可能已被删除。',
    go_out_checklist_city_query_required: '请输入城市关键词。',
    unauthorized: '登录状态已失效，请重新登录。',
    rate_limited: '操作过于频繁，请稍后再试。',
  };
  return messages[error.code] ?? '出门检查清单暂时不可用，请稍后重试。';
}

async function requestJSON<T>(
  path: string,
  token: string,
  options: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers as Record<string, string> | undefined),
    Authorization: `Bearer ${token}`,
  };
  const response = await fetch(`${getAPIBaseUrl()}${path}`, { ...options, headers });
  const payload = (await response.json().catch(() => ({}))) as Partial<T> & ErrorPayload;
  if (!response.ok) {
    throw new GoOutChecklistAPIError(payload.error || 'request_failed', response.status);
  }
  return payload as T;
}
