import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
  DEFAULT_NEWS_PREFERENCES,
  buildNewsFeedUrl,
  getNewsCategoryHeading,
  parseNewsFeed,
  rankNewsEvents,
  recordNewsOpen,
  toggleNewsInterest,
  toggleSavedNews,
} from '../lib/news.ts';

test('labels the personalized feed with the selected category', () => {
  assert.equal(getNewsCategoryHeading(), '为你推荐');
  assert.equal(getNewsCategoryHeading('ai'), 'AI 新闻');
  assert.equal(getNewsCategoryHeading('technology'), '科技新闻');
});

test('defaults to AI, technology and finance interests', () => {
  assert.deepEqual(DEFAULT_NEWS_PREFERENCES.interests, ['ai', 'technology', 'finance']);
  assert.deepEqual(DEFAULT_NEWS_PREFERENCES.behaviorWeights, {});
  assert.deepEqual(DEFAULT_NEWS_PREFERENCES.savedEventIds, []);
});

test('ranks active interests before public heat without mutating the API array', () => {
  const events = [
    makeEvent({ id: 'society-hot', category: 'society', hotScore: 100, title: '公共热点' }),
    makeEvent({ id: 'ai-followed', category: 'ai', hotScore: 40, title: '关注的 AI' }),
    makeEvent({ id: 'ai-hotter', category: 'ai', hotScore: 80, title: '更热的 AI' }),
  ];
  const originalOrder = events.map((event) => event.id);

  const ranked = rankNewsEvents(events, DEFAULT_NEWS_PREFERENCES);

  assert.deepEqual(ranked.map((event) => event.id), ['ai-hotter', 'ai-followed', 'society-hot']);
  assert.deepEqual(events.map((event) => event.id), originalOrder);
  assert.notEqual(ranked, events);
});

test('caps behavior weight at two and keeps preference updates immutable', () => {
  const starting = {
    ...DEFAULT_NEWS_PREFERENCES,
    behaviorWeights: { ai: 1.9 },
  };
  const opened = recordNewsOpen(starting, 'ai');
  const openedAgain = recordNewsOpen(opened, 'ai');

  assert.equal(opened.behaviorWeights.ai, 2);
  assert.equal(openedAgain.behaviorWeights.ai, 2);
  assert.equal(starting.behaviorWeights.ai, 1.9);

  const withoutAI = toggleNewsInterest(openedAgain, 'ai');
  assert.deepEqual(withoutAI.interests, ['technology', 'finance']);
  assert.deepEqual(openedAgain.interests, ['ai', 'technology', 'finance']);
});

test('toggles saved events without duplicates', () => {
  const saved = toggleSavedNews(DEFAULT_NEWS_PREFERENCES, 'evt-1');
  const unchanged = toggleSavedNews(saved, 'evt-1');

  assert.deepEqual(saved.savedEventIds, ['evt-1']);
  assert.deepEqual(unchanged.savedEventIds, []);
});

test('builds bounded feed URLs and validates response structure', () => {
  assert.equal(
    buildNewsFeedUrl('http://127.0.0.1:3000/', { category: 'ai', limit: 12 }),
    'http://127.0.0.1:3000/api/v1/news/feed?category=ai&limit=12',
  );
  assert.throws(() => parseNewsFeed({ generatedAt: 'now', events: 'invalid' }), /新闻数据格式无效/);

  const parsed = parseNewsFeed({
    generatedAt: '2026-07-31T02:00:00Z',
    stale: false,
    dailyBrief: { title: '今日热点', keyPoints: ['重点'], eventCount: 1 },
    events: [makeEvent({ id: 'evt-1', category: 'ai', hotScore: 90, title: '热点' })],
  });
  assert.equal(parsed.events[0].id, 'evt-1');
});

test('accepts a pending summary while DeepSeek finishes in the background', () => {
  const event = makeEvent({ id: 'evt-pending', category: 'technology', hotScore: 70, title: '生成中的热点' });
  event.summary.status = 'pending';

  const parsed = parseNewsFeed({
    generatedAt: '2026-07-31T02:00:00Z',
    stale: false,
    dailyBrief: { title: '今日热点', keyPoints: ['重点'], eventCount: 1 },
    events: [event],
  });

  assert.equal(parsed.events[0].summary.status, 'pending');
});

test('registers hot news as an available tool for every role', async () => {
  const registryURL = new URL('../../backend/internal/access/feature_registry.json', import.meta.url);
  const registry = JSON.parse(await readFile(registryURL, 'utf8'));
  const hotNews = registry.find((tool) => tool.id === 'hot-news');

  assert.ok(hotNews, 'hot-news must be present in the consumed feature registry');
  assert.equal(hotNews.status, 'available');
  assert.equal(hotNews.route, '/tools/hot-news');
  assert.deepEqual(hotNews.initialRoles, ['normal', 'vip', 'svip', 'admin']);
});

function makeEvent({ id, category, hotScore, title }) {
  return {
    id,
    category,
    title,
    imageUrl: '',
    publishedAt: '2026-07-31T01:00:00Z',
    updatedAt: '2026-07-31T01:00:00Z',
    hotScore,
    sourceCount: 1,
    summary: {
      oneSentence: `${title}摘要`,
      keyPoints: [{ text: '关键事实', sourceIds: ['S1'] }],
      uncertainty: '',
      status: 'fallback',
      model: '',
    },
    sources: [{
      id: 'S1',
      name: '测试来源',
      url: `https://example.com/${id}`,
      publishedAt: '2026-07-31T01:00:00Z',
    }],
    timeline: [],
  };
}
