export type HomeConsumablesEventType = 'purchase' | 'replace' | 'consume' | 'count';
export type HomeConsumablesPredictionState =
  | 'predictable'
  | 'developing'
  | 'no_data'
  | 'unknown_stock'
  | 'stale';

export type HomeConsumablesCategory = {
  id: string;
  name: string;
  icon: string;
  color: string;
  defaultUnit: string;
  defaultRemindDays: number;
  isSystem: boolean;
  sortOrder: number;
  itemCount: number;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
};

export type HomeConsumablesCyclePoint = {
  from: string;
  to: string;
  days: number;
  quantity: number;
};

export type HomeConsumablesPrediction = {
  state: HomeConsumablesPredictionState;
  remainingDays?: number;
  avgCycleDays?: number;
  ratePerDay?: number;
  sampleCount: number;
  cycles: HomeConsumablesCyclePoint[];
};

export type HomeConsumablesItem = {
  id: string;
  categoryId: string;
  categoryName: string;
  categoryIcon: string;
  categoryColor: string;
  name: string;
  unit: string;
  currentStock?: number;
  stockConfirmedAt?: string;
  currentCycleStartedAt?: string;
  remindDays: number;
  note: string;
  status: 'active' | 'archived';
  source: string;
  eventCount: number;
  prediction: HomeConsumablesPrediction;
  createdAt: string;
  updatedAt: string;
};

export type HomeConsumablesEvent = {
  id: string;
  itemId: string;
  itemName?: string;
  eventType: HomeConsumablesEventType;
  quantity: number;
  stockBefore?: number;
  stockAfter?: number;
  occurredAt: string;
  source: string;
  note: string;
  evidenceUrl?: string;
  undoneAt?: string;
  createdAt: string;
};

export type HomeConsumablesSummary = {
  date: string;
  needRestock: number;
  within7: number;
  within30: number;
  unknownStock: number;
  noData: number;
  totalItems: number;
  items: HomeConsumablesItem[];
};

export type HomeConsumablesReminder = {
  id: string;
  itemId: string;
  itemName: string;
  remainingDays: number;
  remindAt: string;
  channel: string;
  status: string;
  createdAt: string;
};

export type HomeConsumablesItemStat = {
  id: string;
  name: string;
  unit: string;
  currentStock?: number;
  remainingDays?: number;
  avgCycleDays?: number;
  sampleCount: number;
  recent30Consumed: number;
  recent30Purchases: number;
};

export type HomeConsumablesStats = {
  range: string;
  totalItems: number;
  needRestock: number;
  recent30Consumed: number;
  recent30Purchases: number;
  avgCycleDays?: number;
  predictionAccuracy?: string;
  items: HomeConsumablesItemStat[];
};

export type HomeConsumablesItemInput = {
  categoryId: string;
  name: string;
  unit: string;
  currentStock?: number;
  currentCycleStartedAt?: string;
  remindDays?: number;
  note?: string;
  source?: string;
  status?: 'active' | 'archived';
};

export type HomeConsumablesEventInput = {
  eventType: HomeConsumablesEventType;
  quantity: number;
  occurredAt?: string;
  source?: string;
  note?: string;
  evidenceUrl?: string;
};
