export type ResourceResultCategory = 'all' | 'document' | 'media' | 'resource' | 'software';

export type ResourceSearchSourceStatus =
  | 'direct'
  | 'empty'
  | 'error'
  | 'restricted'
  | 'success'
  | 'timeout'
  | 'unavailable';

export type ResourceSearchHealth = {
  checkedAt?: string;
  httpStatus?: number;
  latencyMs?: number;
  message?: string;
  status: 'error' | 'ok' | 'restricted' | 'timeout' | 'unavailable' | 'unknown';
};

export type ResourceSearchSource = {
  adapterKey: string;
  cacheTtlMs: number;
  category: string;
  defaultSelected: boolean;
  description: string;
  domain: string;
  enabled: boolean;
  health?: ResourceSearchHealth | null;
  id: string;
  logo: string;
  logoBackground: string;
  logoColor: string;
  logoImagePath?: string;
  maxResults: number;
  mode: 'aggregate' | 'direct';
  name: string;
  searchUrlTemplate?: string;
  sortOrder: number;
  timeoutMs: number;
  updatedAt: string;
  url: string;
};

export type ResourceSearchResult = {
  category: string;
  diskType?: string;
  id: string;
  originUrl: string;
  requiresResolve: boolean;
  size?: string;
  sourceId: string;
  targetUrl?: string;
  title: string;
  updatedAt?: string;
};

export type ResourceSearchSourceResponse = {
  count: number;
  durationMs: number;
  fallbackUrl: string;
  message?: string;
  query: string;
  results: ResourceSearchResult[];
  sourceId: string;
  status: ResourceSearchSourceStatus;
};

export type ResolvedResourceResult = {
  extractionCode?: string;
  resultId: string;
  targetUrl: string;
};

export type ResourceSearchSourceInput = {
  adapterKey?: string;
  cacheTtlMs?: number;
  category?: string;
  defaultSelected?: boolean;
  description?: string;
  enabled?: boolean;
  homepageUrl: string;
  logoBackground?: string;
  logoColor?: string;
  logoImagePath?: string;
  logoText?: string;
  logoType?: string;
  maxResults?: number;
  mode: 'aggregate' | 'direct';
  name: string;
  searchUrlTemplate?: string;
  sortOrder?: number;
  testQuery?: string;
  timeoutMs?: number;
};

export type ResourceSearchHealthResult = {
  checkedAt: string;
  finalUrl?: string;
  httpStatus?: number;
  latencyMs?: number;
  message?: string;
  sourceId: string;
  status: ResourceSearchSourceStatus;
  trigger: string;
};

export type ResourceSearchTestResultItem = {
  category?: string;
  diskType?: string;
  reference?: string;
  size?: string;
  title: string;
};

export type ResourceSearchTestResult = {
  count: number;
  durationMs: number;
  message?: string;
  query: string;
  results: ResourceSearchTestResultItem[];
  searchUrl?: string;
  sourceId: string;
  status: ResourceSearchSourceStatus;
};

export type ResourceSearchAuditLog = {
  action: string;
  after?: string;
  before?: string;
  createdAt: string;
  id: number;
  message?: string;
  operatorName: string;
  result: string;
  sourceId: string;
};

export type ResourceSearchAuditPage = {
  logs: ResourceSearchAuditLog[];
  offset: number;
  limit: number;
  total: number;
};

export type ResourceSearchUsageStat = {
  avgDurationMs: number;
  failureCount: number;
  name: string;
  resultCount: number;
  searchCount: number;
  sourceId: string;
  successCount: number;
  timeoutCount: number;
};

export type ResourceSearchTopKeyword = {
  count: number;
  keyword: string;
};

export type ResourceSearchAdminStats = {
  days: number;
  sources: ResourceSearchUsageStat[];
  topKeywords: ResourceSearchTopKeyword[];
  totalSearches: number;
};
