export type NewsCategory = 'ai' | 'technology' | 'finance' | 'society' | 'world';

export type NewsSource = {
  id: string;
  name: string;
  url: string;
  publishedAt: string;
};

export type NewsKeyPoint = {
  text: string;
  sourceIds: string[];
};

export type NewsSummary = {
  oneSentence: string;
  keyPoints: NewsKeyPoint[];
  uncertainty?: string;
  status: 'generated' | 'fallback';
  model?: string;
};

export type NewsTimelineItem = {
  sourceId: string;
  label: string;
  publishedAt: string;
};

export type NewsEvent = {
  id: string;
  category: NewsCategory;
  title: string;
  imageUrl?: string;
  publishedAt: string;
  updatedAt: string;
  hotScore: number;
  sourceCount: number;
  summary: NewsSummary;
  sources: NewsSource[];
  timeline: NewsTimelineItem[];
};

export type NewsDailyBrief = {
  title: string;
  keyPoints: string[];
  eventCount: number;
};

export type NewsFeedSnapshot = {
  generatedAt: string;
  stale: boolean;
  dailyBrief: NewsDailyBrief;
  events: NewsEvent[];
};

export type NewsPreferences = {
  version: 1;
  interests: NewsCategory[];
  behaviorWeights: Partial<Record<NewsCategory, number>>;
  savedEventIds: string[];
};
