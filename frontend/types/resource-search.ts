import type { ResourceSearchSourceId } from '@/lib/resource-search';

export type ResourceResultCategory = 'all' | 'document' | 'media' | 'resource' | 'software';

export type ResourceSearchSourceStatus =
  | 'empty'
  | 'error'
  | 'restricted'
  | 'success'
  | 'timeout'
  | 'unavailable';

export type ResourceSearchResult = {
  category: string;
  diskType?: string;
  id: string;
  originUrl: string;
  requiresResolve: boolean;
  size?: string;
  sourceId: ResourceSearchSourceId;
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
  sourceId: ResourceSearchSourceId;
  status: ResourceSearchSourceStatus;
};

export type ResolvedResourceResult = {
  extractionCode?: string;
  resultId: string;
  targetUrl: string;
};
