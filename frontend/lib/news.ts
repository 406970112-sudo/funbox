import type {
  NewsCategory,
  NewsEvent,
  NewsFeedSnapshot,
  NewsPreferences,
} from '../types/news.ts';

export const NEWS_CATEGORIES: ReadonlyArray<{
  id: NewsCategory;
  label: string;
  icon: string;
}> = [
  { id: 'ai', label: 'AI', icon: 'creation-outline' },
  { id: 'technology', label: '科技', icon: 'chip' },
  { id: 'finance', label: '财经', icon: 'chart-line' },
  { id: 'society', label: '社会', icon: 'account-group-outline' },
  { id: 'world', label: '国际', icon: 'earth' },
];

const NEWS_CATEGORY_IDS = new Set(NEWS_CATEGORIES.map((category) => category.id));

export const DEFAULT_NEWS_PREFERENCES: NewsPreferences = {
  version: 1,
  interests: ['ai', 'technology', 'finance'],
  behaviorWeights: {},
  savedEventIds: [],
};

export function rankNewsEvents(events: readonly NewsEvent[], preferences: NewsPreferences) {
  const interests = new Set(preferences.interests);
  return [...events].sort((left, right) => {
    const leftInterest = interests.has(left.category) ? 3 : 0;
    const rightInterest = interests.has(right.category) ? 3 : 0;
    if (leftInterest !== rightInterest) return rightInterest - leftInterest;

    const leftBehavior = clampBehaviorWeight(preferences.behaviorWeights[left.category]);
    const rightBehavior = clampBehaviorWeight(preferences.behaviorWeights[right.category]);
    if (leftBehavior !== rightBehavior) return rightBehavior - leftBehavior;

    if (left.hotScore !== right.hotScore) return right.hotScore - left.hotScore;
    return Date.parse(right.publishedAt) - Date.parse(left.publishedAt);
  });
}

export function filterNewsEvents(
  events: readonly NewsEvent[],
  options: { category?: NewsCategory; query?: string; savedEventIds?: readonly string[] },
) {
  const query = options.query?.trim().toLocaleLowerCase() ?? '';
  const savedIds = options.savedEventIds ? new Set(options.savedEventIds) : undefined;
  return events.filter((event) => {
    if (options.category && event.category !== options.category) return false;
    if (savedIds && !savedIds.has(event.id)) return false;
    if (!query) return true;
    return [
      event.title,
      event.summary.oneSentence,
      ...event.sources.map((source) => source.name),
    ].some((value) => value.toLocaleLowerCase().includes(query));
  });
}

export function toggleNewsInterest(preferences: NewsPreferences, category: NewsCategory): NewsPreferences {
  const current = new Set(preferences.interests);
  if (current.has(category)) current.delete(category);
  else current.add(category);
  return {
    ...preferences,
    interests: NEWS_CATEGORIES.map((item) => item.id).filter((id) => current.has(id)),
  };
}

export function recordNewsOpen(preferences: NewsPreferences, category: NewsCategory): NewsPreferences {
  const currentWeight = clampBehaviorWeight(preferences.behaviorWeights[category]);
  return {
    ...preferences,
    behaviorWeights: {
      ...preferences.behaviorWeights,
      [category]: Math.min(2, Math.round((currentWeight + 0.25) * 100) / 100),
    },
  };
}

export function toggleSavedNews(preferences: NewsPreferences, eventId: string): NewsPreferences {
  const current = new Set(preferences.savedEventIds);
  if (current.has(eventId)) current.delete(eventId);
  else current.add(eventId);
  return { ...preferences, savedEventIds: [...current] };
}

export function normalizeNewsPreferences(value: unknown): NewsPreferences {
  if (!isRecord(value)) return cloneDefaultPreferences();
  const interests = Array.isArray(value.interests)
    ? value.interests.filter(isNewsCategory)
    : cloneDefaultPreferences().interests;
  const behaviorWeights: Partial<Record<NewsCategory, number>> = {};
  if (isRecord(value.behaviorWeights)) {
    for (const category of NEWS_CATEGORIES) {
      const weight = value.behaviorWeights[category.id];
      if (typeof weight === 'number' && Number.isFinite(weight) && weight > 0) {
        behaviorWeights[category.id] = clampBehaviorWeight(weight);
      }
    }
  }
  const savedEventIds = Array.isArray(value.savedEventIds)
    ? [...new Set(value.savedEventIds.filter((id): id is string => typeof id === 'string' && id !== ''))]
    : [];
  return {
    version: 1,
    interests: [...new Set(interests)],
    behaviorWeights,
    savedEventIds,
  };
}

export function buildNewsFeedUrl(
  baseURL: string,
  options: { category?: NewsCategory; limit?: number } = {},
) {
  const params = new URLSearchParams();
  if (options.category) params.set('category', options.category);
  if (options.limit) params.set('limit', String(options.limit));
  const query = params.toString();
  return `${baseURL.replace(/\/+$/, '')}/api/v1/news/feed${query ? `?${query}` : ''}`;
}

export function parseNewsFeed(value: unknown): NewsFeedSnapshot {
  if (!isRecord(value)
    || typeof value.generatedAt !== 'string'
    || typeof value.stale !== 'boolean'
    || !isDailyBrief(value.dailyBrief)
    || !Array.isArray(value.events)
    || !value.events.every(isNewsEvent)) {
    throw new Error('新闻数据格式无效，请稍后重试。');
  }
  return value as NewsFeedSnapshot;
}

export function getNewsCategoryLabel(category: NewsCategory) {
  return NEWS_CATEGORIES.find((item) => item.id === category)?.label ?? category;
}

export function getNewsCategoryHeading(category?: NewsCategory) {
  if (!category) return '为你推荐';
  const label = getNewsCategoryLabel(category);
  return /^[a-z]+$/i.test(label) ? `${label} 新闻` : `${label}新闻`;
}

function cloneDefaultPreferences(): NewsPreferences {
  return {
    version: 1,
    interests: [...DEFAULT_NEWS_PREFERENCES.interests],
    behaviorWeights: {},
    savedEventIds: [],
  };
}

function clampBehaviorWeight(value: number | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(2, value));
}

function isNewsCategory(value: unknown): value is NewsCategory {
  return typeof value === 'string' && NEWS_CATEGORY_IDS.has(value as NewsCategory);
}

function isDailyBrief(value: unknown) {
  return isRecord(value)
    && typeof value.title === 'string'
    && Array.isArray(value.keyPoints)
    && value.keyPoints.every((point) => typeof point === 'string')
    && typeof value.eventCount === 'number';
}

function isNewsEvent(value: unknown) {
  return isRecord(value)
    && typeof value.id === 'string'
    && isNewsCategory(value.category)
    && typeof value.title === 'string'
    && typeof value.publishedAt === 'string'
    && typeof value.updatedAt === 'string'
    && typeof value.hotScore === 'number'
    && typeof value.sourceCount === 'number'
    && isSummary(value.summary)
    && Array.isArray(value.sources)
    && value.sources.every(isSource)
    && Array.isArray(value.timeline);
}

function isSummary(value: unknown) {
  return isRecord(value)
    && typeof value.oneSentence === 'string'
    && (value.status === 'generated' || value.status === 'fallback')
    && Array.isArray(value.keyPoints)
    && value.keyPoints.every((point) => isRecord(point)
      && typeof point.text === 'string'
      && Array.isArray(point.sourceIds)
      && point.sourceIds.every((id) => typeof id === 'string'));
}

function isSource(value: unknown) {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && typeof value.url === 'string'
    && typeof value.publishedAt === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
