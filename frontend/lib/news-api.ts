import { Platform } from 'react-native';

import { buildNewsFeedUrl, parseNewsFeed } from '@/lib/news';
import type { NewsCategory, NewsFeedSnapshot } from '@/types/news';

const DEV_SERVER_URL = Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://127.0.0.1:3000';
const CONFIGURED_SERVER_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL?.trim() || process.env.EXPO_PUBLIC_VOICE_SERVER_URL?.trim();

export function getNewsApiBaseUrl() {
  return CONFIGURED_SERVER_URL || DEV_SERVER_URL;
}

export async function fetchNewsFeed(options: {
  category?: NewsCategory;
  limit?: number;
  signal?: AbortSignal;
} = {}): Promise<NewsFeedSnapshot> {
  const response = await fetch(buildNewsFeedUrl(getNewsApiBaseUrl(), options), {
    headers: { Accept: 'application/json' },
    signal: options.signal,
  });
  const payload = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    const error = isRecord(payload) && typeof payload.error === 'string'
      ? payload.error
      : 'news_request_failed';
    throw new Error(error === 'news_sources_unavailable'
      ? '新闻来源暂时不可用，请稍后重试。'
      : '新闻加载失败，请稍后重试。');
  }
  return parseNewsFeed(payload);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
