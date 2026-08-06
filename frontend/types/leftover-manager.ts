export const LEFTOVER_SCHEMA_VERSION = 1;
export const LEFTOVER_MAX_PHOTOS = 3;

export const LEFTOVER_SOURCE_TYPES = [
  'leftover',
  'takeout',
  'opened',
  'ingredient',
] as const;

export const LEFTOVER_ZONES = ['fridge', 'freezer', 'door', 'drawer'] as const;
export const LEFTOVER_STATUSES = ['active', 'eaten', 'discarded'] as const;

export type LeftoverSourceType = (typeof LEFTOVER_SOURCE_TYPES)[number];
export type LeftoverZone = (typeof LEFTOVER_ZONES)[number];
export type LeftoverStatus = (typeof LEFTOVER_STATUSES)[number];

export type LeftoverItem = {
  id: string;
  userId: string;
  name: string;
  sourceType: LeftoverSourceType;
  merchant: string;
  enteredFridgeAt: number;
  expectedConsumeAt: number;
  storedZone: LeftoverZone;
  remainingPercent: number;
  remainingText: string;
  reheatCount: number;
  tags: string[];
  costCents: number;
  notes: string;
  status: LeftoverStatus;
  eatenAt?: number;
  discardedAt?: number;
  discardReason?: string;
  photoCount: number;
  coverPhotoUrl?: string;
  createdAt: number;
  updatedAt: number;
};

export type LeftoverPhoto = {
  id: string;
  itemId: string;
  userId: string;
  fileUrl: string;
  sortOrder: number;
  createdAt: number;
};

export type LeftoverEvent = {
  id: string;
  itemId: string;
  userId: string;
  eventType: string;
  note: string;
  happenedAt: number;
};

export type LeftoverItemDetail = LeftoverItem & {
  photos: LeftoverPhoto[];
  events: LeftoverEvent[];
};

export type LeftoverSettings = {
  userId: string;
  remindBeforeHours: number;
  daily09Enabled: boolean;
  evening19Enabled: boolean;
  notificationEnabled: boolean;
  updatedAt: number;
};

export type LeftoverItemInput = {
  name: string;
  sourceType: LeftoverSourceType;
  merchant: string;
  enteredFridgeAt: number;
  expectedConsumeAt: number;
  storedZone: LeftoverZone;
  remainingPercent: number;
  remainingText: string;
  reheatCount: number;
  tags: string[];
  costCents: number;
  notes: string;
};

export type RecipeIngredient = {
  keyword: string;
  label: string;
  quantity: string;
};

export type Recipe = {
  id: string;
  name: string;
  mainIngredients: RecipeIngredient[];
  seasonings: string[];
  estimatedMinutes: number;
  steps: string[];
  source: string;
};

export type RecipeMatchedItem = {
  itemId: string;
  name: string;
  remainingText: string;
  expiringWithin: boolean;
};

export type RecipeMatch = {
  recipeId: string;
  name: string;
  matchPercent: number;
  matchedCount: number;
  totalCount: number;
  estimatedMinutes: number;
  source: string;
  matchedItems: RecipeMatchedItem[];
  missing: string[];
  expiringCount: number;
};

export type LeftoverHomeSummary = {
  activeCount: number;
  todayCount: number;
  expiredCount: number;
  thisWeekEaten: number;
  thisWeekDiscarded: number;
  avoidWasteCents: number;
  wasteCents: number;
};

export type LeftoverHomePayload = {
  summary: LeftoverHomeSummary;
  priority: LeftoverItem[];
  suggestions: RecipeMatch[];
  serverNow: number;
  settings: LeftoverSettings;
};

export type LeftoverHistoryPayload = {
  items: LeftoverItem[];
  summary: LeftoverHomeSummary;
  serverNow: number;
};

export type LeftoverLocalState = {
  schemaVersion: number;
  items: LeftoverItem[];
  events: LeftoverEvent[];
  localPhotos: Record<string, string[]>;
  settings: LeftoverSettings;
  updatedAt: number;
};

export function createEmptyLeftoverSettings(userId = 'local'): LeftoverSettings {
  return {
    userId,
    remindBeforeHours: 2,
    daily09Enabled: false,
    evening19Enabled: false,
    notificationEnabled: false,
    updatedAt: 0,
  };
}

export function createEmptyLeftoverLocalState(): LeftoverLocalState {
  return {
    schemaVersion: LEFTOVER_SCHEMA_VERSION,
    items: [],
    events: [],
    localPhotos: {},
    settings: createEmptyLeftoverSettings(),
    updatedAt: 0,
  };
}
