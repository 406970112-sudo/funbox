export type RecommendationCategory = 'phone' | 'tablet' | 'earbuds' | 'tv' | 'small-appliance' | 'accessory';

export type RecommendationPlatform = 'jd' | 'taobao' | 'pdd';

export type ProductRecommendationRequest = {
  query: string;
  category?: RecommendationCategory | '';
  budgetMin?: number;
  budgetMax?: number;
  brands?: string[];
  scenarios?: string[];
  platforms?: RecommendationPlatform[];
};

export type PlatformLink = {
  platform: RecommendationPlatform;
  label: string;
  url: string;
};

export type RecommendationReason = {
  label: string;
  text: string;
};

export type RecommendationItem = {
  productId: string;
  name: string;
  brand: string;
  fitScore: number;
  referencePrice: number;
  priceSource: string;
  reasons: RecommendationReason[];
  suitableFor: string;
  specs: Record<string, string>;
  links: PlatformLink[];
};

export type ProductRecommendationResponse = {
  queryId: string;
  category: RecommendationCategory;
  budget?: { min: number; max: number };
  preferences?: string[];
  summary: string;
  items: RecommendationItem[];
  ai: 'deepseek' | 'fallback';
  disclaimer: string;
  generatedAt: string;
};

export type ProductCatalogItem = {
  id: string;
  category: RecommendationCategory;
  name: string;
  brand: string;
  tagline: string;
  referencePrice: number;
  priceSource: string;
  specs: Record<string, string>;
  links: PlatformLink[];
  fitTags: string[];
};

export type RecommendationHistoryItem = {
  queryId: string;
  query: string;
  category: string;
  summary: string;
  productCount: number;
  createdAt: string;
};
