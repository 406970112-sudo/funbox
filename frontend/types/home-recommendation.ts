import type { AppIconName } from '@/types/app';

export type HomeRecommendationKind = 'tool' | 'game';

export type HomeRecommendationItem = {
  slotId: string;
  kind: HomeRecommendationKind;
  featureId: string;
  name: string;
  tagline: string;
  icon: AppIconName;
  accentColor: string;
  route: string;
  ctaLabel: string;
  title: string;
  description: string;
  sortOrder: number;
};

export type HomeRecommendationsResponse = {
  date: string;
  source: 'configured' | 'fallback';
  items: HomeRecommendationItem[];
};

export type HomeRecommendationSlot = {
  id: string;
  featureId: string;
  featureKind: HomeRecommendationKind;
  enabled: boolean;
  sortOrder: number;
  startsOn: string | null;
  endsOn: string | null;
  weekdays: number[];
  titleOverride: string;
  descriptionOverride: string;
  ctaLabelOverride: string;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
};

export type HomeRecommendationSlotInput = {
  featureId: string;
  enabled?: boolean;
  sortOrder?: number;
  startsOn?: string | null;
  endsOn?: string | null;
  weekdays?: number[];
  titleOverride?: string;
  descriptionOverride?: string;
  ctaLabelOverride?: string;
};

export type HomeRecommendationRegistryFeature = {
  id: string;
  name: string;
  tagline: string;
  description: string;
  icon: AppIconName;
  category: string;
  route: string;
  accentColor: string;
  badges: string[];
  usageLabel: string;
  status: string;
  featured: boolean;
  hiddenFromList: boolean;
  initialRoles: string[];
};

export type HomeRecommendationAdminSlot = {
  slot: HomeRecommendationSlot;
  feature: HomeRecommendationRegistryFeature;
  valid: boolean;
  invalidNote: string;
};

export type HomeRecommendationAdminListResponse = {
  slots: HomeRecommendationAdminSlot[];
  registry: HomeRecommendationRegistryFeature[];
  summary: {
    enabledToday: number;
    disabled: number;
    defaultFeature: string;
  };
};

export type HomeRecommendationSlotStats = {
  slotId: string;
  featureId: string;
  views: number;
  clicks: number;
  clickRate: number;
};

export type HomeRecommendationAuditEntry = {
  id: string;
  adminId: string;
  action: string;
  slotId: string;
  detail: string;
  createdAt: string;
};
