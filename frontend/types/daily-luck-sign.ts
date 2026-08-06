export type DailyLuckSignStatus = 'complete' | 'partial' | 'unavailable';
export type DailyLuckSignCategory = 'small-thing' | 'challenge' | 'encouragement';

export type DailyLuckSignLocation = {
  name: string;
  lat: number;
  lon: number;
  source: 'manual' | 'system-location';
};

export type DailyLuckSignColor = {
  hex: string;
  name: string;
  ruleId: string;
  rationale: string;
};

export type DailyLuckSignFact = {
  key: string;
  label: string;
  value: string | number;
  unit?: string;
  source: string;
  fetchedAt: string;
  license: string;
};

export type DailyLuckSignSuggestion = {
  id: string;
  category: DailyLuckSignCategory;
  title: string;
  reason: string;
  ruleId: string;
  sources: string[];
};

export type DailyLuckSignResponse = {
  date: string;
  timezone: string;
  status: DailyLuckSignStatus;
  location: DailyLuckSignLocation;
  color: DailyLuckSignColor;
  facts: DailyLuckSignFact[];
  suggestions: DailyLuckSignSuggestion[];
  generatedAt: string;
  cachedAt?: string;
};

export type DailyLuckSignCompletion = {
  id: string;
  date: string;
  ruleId: string;
  title: string;
  completedAt: string;
};

export type DailyLuckSignSettings = {
  city: string;
  lat: number;
  lon: number;
  source: 'manual' | 'system-location';
  updatedAt: number;
};

export type DailyLuckSignCity = {
  name: string;
  country: string;
  admin1?: string;
  lat: number;
  lon: number;
};

export type DailyLuckSignHealthSource = {
  source: string;
  status: string;
  lastFetchedAt?: string;
  message?: string;
};

export type DailyLuckSignHealth = {
  status: DailyLuckSignStatus;
  sources: DailyLuckSignHealthSource[];
  updatedAt: string;
};

export type DailyLuckSignFetchParams = {
  date: string;
  location: DailyLuckSignLocation;
  token?: string | null;
};
