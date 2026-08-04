export type DnfActivityStatus = 'ongoing' | 'upcoming' | 'ended' | 'unknown';

export type DnfActivity = {
  id: string;
  sourceId: string;
  title: string;
  startDate?: string;
  endDate?: string;
  status: DnfActivityStatus;
  daysLeft?: number;
  mobileUrl?: string;
  pcUrl?: string;
  mobileImage?: string;
  pcImage?: string;
  description?: string;
  fetchedAt: string;
  stale: boolean;
};

export type DnfActivityOverview = {
  total: number;
  ongoing: number;
  upcoming: number;
  ended: number;
  unknown: number;
  ongoingActivities: DnfActivity[];
  endingSoon: DnfActivity[];
  source: string;
  sourceUrl: string;
  fetchedAt: string;
  stale: boolean;
};

export type DnfActivityList = {
  items: DnfActivity[];
  total: number;
  page: number;
  pageSize: number;
};

export type DnfCalendarDay = {
  date: string;
  activityIds: string[];
};

export type DnfCalendarMonth = {
  year: number;
  month: number;
  days: DnfCalendarDay[];
};

export type DnfShareInfo = {
  activityId: string;
  title: string;
  url: string;
  startDate?: string;
  endDate?: string;
  imageUrl?: string;
  text: string;
};

export type DnfActivitySortKey = 'ending' | 'start' | 'fetched';
