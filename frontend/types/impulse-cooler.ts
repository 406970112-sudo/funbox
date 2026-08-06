export type CoolingAnswers = {
  whyBuy: string;
  otherReason?: string;
  similarCount: string;
  similarInUse?: string;
  usageFrequency: string;
  wantsAfter24h: string;
  note?: string;
};

export type CoolingItem = {
  id: string;
  userId: string;
  name: string;
  priceCents: number;
  currency: string;
  sourceType: string;
  sourceText?: string;
  sourceUrl?: string;
  answers: CoolingAnswers;
  hourlyWageCents: number;
  monthlySalaryCents: number;
  equivalentHours?: number;
  incomeRatioPercent?: number;
  riskLevel: 'low' | 'medium' | 'high';
  riskReasons: string[];
  status: 'cooling' | 'pending_decision' | 'bought' | 'dropped';
  coolEndsAt: string;
  extendCount: number;
  decidedAt?: string;
  finalPriceCents?: number;
  finalPurchaseAt?: string;
  evidenceCount: number;
  createdAt: string;
  updatedAt: string;
};

export type CoolingItemInput = {
  name: string;
  priceCents: number;
  currency: string;
  sourceType: string;
  sourceText?: string;
  sourceUrl?: string;
  answers: CoolingAnswers;
};

export type CoolingDecisionInput = {
  action: 'buy' | 'drop';
  finalPriceCents?: number;
  finalPurchaseAt?: string;
  note?: string;
};

export type CoolingSettings = {
  monthlySalaryCents: number;
  monthlyWorkHours: number;
  hourlyWageCents: number;
  wageSource: string;
  notifyBeforeHours: number;
  notificationEnabled: boolean;
  effectiveHourlyWageCents?: number;
  effectiveMonthlySalaryCents?: number;
  updatedAt: string;
};

export type CoolingSettingsInput = {
  monthlySalaryCents?: number;
  monthlyWorkHours?: number;
  hourlyWageCents?: number;
  wageSource?: string;
  notifyBeforeHours?: number;
  notificationEnabled?: boolean;
};

export type CoolingDailyStat = {
  date: string;
  createdCount: number;
  boughtCount: number;
  droppedCount: number;
  amountCents: number;
};

export type CoolingStats = {
  totalCount: number;
  coolingCount: number;
  pendingCount: number;
  boughtCount: number;
  droppedCount: number;
  totalAmountCents: number;
  boughtAmountCents: number;
  droppedAmountCents: number;
  completionRate: number;
  avgEquivalentHours?: number;
  daily: CoolingDailyStat[];
};

export type CoolingHome = {
  stats: CoolingStats;
  pending: CoolingItem[];
  cooling: CoolingItem[];
  recent: CoolingItem[];
  serverNow: string;
};

export type CoolingEvent = {
  id: string;
  itemId: string;
  userId: string;
  action: string;
  note?: string;
  createdAt: string;
};

export type CoolingEvidence = {
  id: string;
  itemId: string;
  userId: string;
  fileUrl: string;
  originalName?: string;
  size?: number;
  createdAt: string;
};
