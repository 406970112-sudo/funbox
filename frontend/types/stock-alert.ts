export type StockSymbol = {
  code: string;
  name: string;
  market: string;
  secId: string;
  region: string;
};

export type IntradayPoint = {
  time: string;
  price: number;
  avgPrice: number;
  volume: number;
  amount: number;
};

export type IntradaySnapshot = {
  date: string;
  points: IntradayPoint[];
  latest: IntradayPoint;
  fetchedAt: string;
  stale: boolean;
};

export type StockSignalRule = {
  buyTrigger: number;
  buyConditions: string[];
  buyReferenceLow: number;
  buyReferenceHigh: number;
  sellTrigger: number;
  sellConditions: string[];
  sellReferenceLow: number;
  sellReferenceHigh: number;
  stopLoss: number;
  validTradingDays: number;
  reasons: string[];
  summary: string;
};

export type StockAnalysis = {
  id: string;
  watchItemId: string;
  model: string;
  dataEndDate: string;
  rule: StockSignalRule;
  createdAt: string;
};

export type StockSignalStatus =
  | 'listening'
  | 'near-buy'
  | 'buy-triggered'
  | 'sell-triggered'
  | 'stop-triggered'
  | 'expired'
  | 'data-missing';

export type StockReminderType = 'buy' | 'sell' | 'stop';

export type StockWatchItem = {
  id: string;
  userId: string;
  symbolCode: string;
  name: string;
  market: string;
  secId: string;
  enabled: boolean;
  reminderTypes: StockReminderType[];
  analysis?: StockAnalysis;
  validUntil: string;
  createdAt: string;
  latestPrice?: number;
  avgPrice?: number;
  changePct?: number;
  signalStatus: StockSignalStatus;
  intradayTime?: string;
  quoteStale: boolean;
};

export type StockAlertEvent = {
  id: string;
  userId: string;
  watchItemId: string;
  symbolCode: string;
  name: string;
  direction: StockReminderType;
  signalStrength: 'confirmed' | 'observation';
  triggerTime: string;
  triggerPrice: number;
  avgPrice: number;
  conditions: string[];
  pushed: boolean;
  pushedMessage: string;
  readAt?: string;
  createdAt: string;
};

export type StockAlertSettings = {
  userId: string;
  sendKeyMasked: string;
  sendKeyBound: boolean;
  reminderEnabled: boolean;
  updatedAt: string;
};
