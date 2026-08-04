export type DaysLeftRecordType = 'fixed' | 'opened' | 'recurring' | 'event';
export type DaysLeftStatus = 'active' | 'completed' | 'archived';
export type DaysLeftSource = 'user' | 'photo' | 'scanner' | 'api' | 'import';
export type DaysLeftCycleUnit = 'day' | 'week' | 'month' | 'year';
export type DaysLeftRiskLevel = 'overdue' | '7' | '30' | '90' | 'safe';

export type DaysLeftCategory = {
  id: string;
  name: string;
  icon: string;
  color: string;
  reminderLeadDays: number;
  defaultRecordType: DaysLeftRecordType;
  isSystem: boolean;
  sortOrder: number;
  recordCount: number;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
};

export type DaysLeftRecord = {
  id: string;
  categoryId: string;
  categoryName: string;
  categoryIcon: string;
  categoryColor: string;
  name: string;
  recordType: DaysLeftRecordType;
  startDate: string;
  expiryDate: string;
  validityValue: number;
  validityUnit: DaysLeftCycleUnit;
  cycleUnit: DaysLeftCycleUnit;
  cycleInterval: number;
  reminderLeadDays: number;
  remindAt: string;
  note: string;
  status: DaysLeftStatus;
  riskLevel: DaysLeftRiskLevel;
  source: DaysLeftSource;
  evidenceCount: number;
  verified: boolean;
  verifiedAt?: string;
  lastRenewedAt?: string;
  daysLeft: number;
  createdAt: string;
  updatedAt: string;
};

export type DaysLeftSummary = {
  date: string;
  overdue: number;
  dueToday: number;
  next7: number;
  next30: number;
  next90: number;
  today: DaysLeftRecord[];
  soon: DaysLeftRecord[];
};

export type DaysLeftEvent = {
  id: string;
  recordId: string;
  action: 'renewed' | 'completed';
  previousExpiryDate: string;
  newExpiryDate: string;
  note: string;
  evidenceUrl: string;
  createdAt: string;
};

export type DaysLeftEvidence = {
  id: string;
  recordId: string;
  fileUrl: string;
  kind: string;
  createdAt: string;
};

export type DaysLeftReminder = {
  id: string;
  recordId: string;
  remindAt: string;
  channel: string;
  status: string;
  recordName: string;
  daysLeft: number;
  createdAt: string;
};

export type DaysLeftDayCount = {
  date: string;
  count: number;
};

export type DaysLeftCalendar = {
  month: string;
  days: DaysLeftDayCount[];
};

export type DaysLeftCategoryCount = {
  categoryId: string;
  name: string;
  color: string;
  icon: string;
  count: number;
};

export type DaysLeftStats = {
  range: string;
  next30: number;
  next90: number;
  overdue: number;
  completed: number;
  total: number;
  rate: number;
  byCategory: DaysLeftCategoryCount[];
};

export type DaysLeftVerifyResult = {
  host: string;
  expiresAt: string;
  issuer: string;
  dnsNames: string[];
  verified: boolean;
  checkedAt: string;
};

export type DaysLeftRecordInput = {
  categoryId: string;
  name: string;
  recordType: DaysLeftRecordType;
  startDate?: string;
  expiryDate?: string;
  validityValue?: number;
  validityUnit?: DaysLeftCycleUnit;
  cycleUnit?: DaysLeftCycleUnit;
  cycleInterval?: number;
  reminderLeadDays?: number;
  note?: string;
  status?: DaysLeftStatus;
  source?: DaysLeftSource;
  verified?: boolean;
  verifiedAt?: string;
};

export type DaysLeftCategoryInput = {
  name: string;
  icon?: string;
  color?: string;
  reminderLeadDays?: number;
  defaultRecordType?: DaysLeftRecordType;
  sortOrder?: number;
  archived?: boolean;
};

export type DaysLeftRenewInput = {
  newExpiryDate?: string;
  note?: string;
  cycleUnit?: DaysLeftCycleUnit;
  cycleInterval?: number;
};
