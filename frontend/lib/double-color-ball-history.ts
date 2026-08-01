import type { SSQDraw } from '../types/double-color-ball.ts';

export type SSQHistoryRange = 30 | 100 | 400;

export type SSQHistoryFilters = {
  endDate: string;
  issue: string;
  range: SSQHistoryRange;
  startDate: string;
};

export type SSQHistoryFilterInput = Omit<SSQHistoryFilters, 'range'>;

export function filterSSQHistoryDraws(
  draws: readonly SSQDraw[],
  filters: SSQHistoryFilters,
) {
  const scoped = draws.slice(0, Math.max(0, Math.floor(filters.range)));
  return scoped.filter((draw) => {
    if (filters.issue && draw.issue !== filters.issue) return false;
    if (filters.startDate && draw.date < filters.startDate) return false;
    if (filters.endDate && draw.date > filters.endDate) return false;
    return true;
  });
}

export function paginateSSQHistoryDraws(draws: readonly SSQDraw[], visibleCount: number) {
  const safeCount = Math.max(0, Math.floor(visibleCount));
  return {
    hasMore: safeCount < draws.length,
    items: draws.slice(0, safeCount),
  };
}

export function validateSSQHistoryFilters(filters: SSQHistoryFilterInput) {
  if (filters.issue && !/^\d+$/.test(filters.issue)) {
    return '期号只能输入数字';
  }
  if (
    (filters.startDate && !isISOCalendarDate(filters.startDate))
    || (filters.endDate && !isISOCalendarDate(filters.endDate))
  ) {
    return '日期格式需为 YYYY-MM-DD';
  }
  if (filters.startDate && filters.endDate && filters.startDate > filters.endDate) {
    return '开始日期不能晚于结束日期';
  }
  return null;
}

export function formatSSQBall(number: number) {
  return String(number).padStart(2, '0');
}

function isISOCalendarDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}
