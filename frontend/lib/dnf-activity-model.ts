import type {
  DnfActivity,
  DnfActivitySortKey,
  DnfActivityStatus,
} from '@/types/dnf-activity';

export const DNF_STATUS_LABELS: Record<DnfActivityStatus, string> = {
  ongoing: '进行中',
  upcoming: '未开始',
  ended: '已结束',
  unknown: '时间待确认',
};

export const DNF_STATUS_TABS: { id: DnfActivityStatus | ''; label: string }[] = [
  { id: '', label: '全部' },
  { id: 'ongoing', label: '进行中' },
  { id: 'upcoming', label: '未开始' },
  { id: 'ended', label: '已结束' },
  { id: 'unknown', label: '待确认' },
];

export function getDnfActivityStatusLabel(status: DnfActivityStatus) {
  return DNF_STATUS_LABELS[status] ?? '状态未知';
}

export function formatDnfActivityDateRange(activity: DnfActivity) {
  const start = activity.startDate;
  const end = activity.endDate;
  if (start && end) return `${start} ~ ${end}`;
  if (start) return `${start} 起`;
  if (end) return `${end} 前`;
  return '时间以官网为准';
}

export function getDnfActivityDaysLabel(activity: DnfActivity) {
  if (activity.status !== 'ongoing' || activity.daysLeft === undefined) {
    return '';
  }
  if (activity.daysLeft === 0) return '今天结束';
  return `剩余 ${activity.daysLeft} 天`;
}

export function isLongRunning(activity: DnfActivity) {
  if (!activity.startDate || !activity.endDate) return false;
  const end = new Date(`${activity.endDate}T00:00:00`);
  const start = new Date(`${activity.startDate}T00:00:00`);
  const days = Math.round((end.getTime() - start.getTime()) / 86400000);
  return days > 180;
}

export function filterDnfActivities(
  activities: readonly DnfActivity[],
  status: DnfActivityStatus | '',
  query: string,
) {
  const normalized = query.trim().toLowerCase();
  return activities.filter((activity) => {
    if (status && activity.status !== status) return false;
    if (normalized && !activity.title.toLowerCase().includes(normalized)) {
      return false;
    }
    return true;
  });
}

export function sortDnfActivities(
  activities: readonly DnfActivity[],
  sortKey: DnfActivitySortKey,
) {
  return [...activities].sort((left, right) => {
    if (sortKey === 'start') {
      return compareDate(left.startDate, right.startDate);
    }
    if (sortKey === 'fetched') {
      return right.fetchedAt.localeCompare(left.fetchedAt);
    }
    const statusOrder = { ongoing: 0, upcoming: 1, ended: 2, unknown: 3 } as const;
    if (left.status !== right.status) {
      return statusOrder[left.status] - statusOrder[right.status];
    }
    return compareDate(left.endDate, right.endDate);
  });
}

export function getDnfCalendarGrid(
  year: number,
  month: number,
  activityIdsByDate: Record<string, string[]>,
) {
  const first = new Date(year, month - 1, 1);
  const startWeekday = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells: { date: string; day: number; inMonth: boolean; has: boolean }[] = [];
  for (let index = 0; index < startWeekday; index += 1) {
    cells.push({ date: '', day: 0, inMonth: false, has: false });
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    cells.push({
      date,
      day,
      inMonth: true,
      has: (activityIdsByDate[date]?.length ?? 0) > 0,
    });
  }
  while (cells.length % 7 !== 0) {
    cells.push({ date: '', day: 0, inMonth: false, has: false });
  }
  return cells;
}

export function isToday(date: string) {
  const now = new Date();
  const local = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return date === local;
}

export function isValidDnfActivity(value: unknown): value is DnfActivity {
  if (!value || typeof value !== 'object') return false;
  const activity = value as Partial<DnfActivity>;
  return (
    typeof activity.id === 'string' &&
    typeof activity.title === 'string' &&
    typeof activity.status === 'string'
  );
}

function compareDate(left?: string, right?: string) {
  const leftValue = left || '9999-12-31';
  const rightValue = right || '9999-12-31';
  return leftValue.localeCompare(rightValue);
}
