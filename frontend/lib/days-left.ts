import type { DaysLeftRecord, DaysLeftRecordType, DaysLeftRiskLevel } from '@/types/days-left';

const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function todayDateString(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function currentMonthKey(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function formatDateCN(date: string) {
  if (!date) return '';
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return `${parsed.getMonth() + 1}月${parsed.getDate()}日 ${WEEKDAY_NAMES[parsed.getDay()]}`;
}

export function formatShortDate(date: string) {
  if (!date) return '';
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return `${parsed.getMonth() + 1}/${parsed.getDate()}`;
}

export function recordTypeLabel(type: DaysLeftRecordType) {
  switch (type) {
    case 'opened':
      return '开封有效';
    case 'recurring':
      return '周期续费';
    case 'event':
      return '纪念日';
    default:
      return '固定到期';
  }
}

export function cycleUnitLabel(unit: string) {
  switch (unit) {
    case 'day':
      return '天';
    case 'week':
      return '周';
    case 'month':
      return '月';
    case 'year':
      return '年';
    default:
      return unit;
  }
}

export function sourceLabel(source: string) {
  switch (source) {
    case 'photo':
      return '照片';
    case 'scanner':
      return '扫描确认';
    case 'api':
      return '接口校验';
    case 'import':
      return '文件导入';
    default:
      return '手动录入';
  }
}

export function riskLabel(level: DaysLeftRiskLevel) {
  switch (level) {
    case 'overdue':
      return '已逾期';
    case '7':
      return '7 天内';
    case '30':
      return '30 天内';
    case '90':
      return '90 天内';
    default:
      return '安全';
  }
}

export function riskColor(level: DaysLeftRiskLevel) {
  switch (level) {
    case 'overdue':
      return '#ff5d6c';
    case '7':
      return '#f1a33b';
    case '30':
      return '#4b6bff';
    case '90':
      return '#7e5bef';
    default:
      return '#1db991';
  }
}

export function iconForCategory(icon: string) {
  const fallback: Record<string, string> = {
    'id-card': 'id-card-outline',
    'credit-card': 'credit-card-outline',
    package: 'package-variant-closed',
    server: 'server-outline',
    car: 'car-outline',
    cake: 'cake-variant-outline',
  };
  return fallback[icon] ?? 'calendar-clock-outline';
}

export function iconForRecordType(type: DaysLeftRecordType) {
  switch (type) {
    case 'opened':
      return 'package-variant-closed';
    case 'recurring':
      return 'refresh';
    case 'event':
      return 'cake-variant-outline';
    default:
      return 'calendar-check-outline';
  }
}

export function computeDaysLeft(expiryDate: string, today = todayDateString()) {
  const start = new Date(`${today}T00:00:00`).getTime();
  const end = new Date(`${expiryDate}T00:00:00`).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.round((end - start) / 86400000);
}

export function buildCalendarDays(monthKey: string, dueByDate: Map<string, number>) {
  const [year, month] = monthKey.split('-').map(Number);
  const first = new Date(year, month - 1, 1);
  const leading = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells: { day: number; date: string; count: number; today: boolean }[] = [];
  for (let index = 0; index < leading; index++) {
    cells.push({ day: 0, date: '', count: 0, today: false });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${monthKey}-${String(day).padStart(2, '0')}`;
    cells.push({
      day,
      date,
      count: dueByDate.get(date) ?? 0,
      today: date === todayDateString(),
    });
  }
  return cells;
}

export function riskOfRecord(record: Pick<DaysLeftRecord, 'daysLeft' | 'expiryDate' | 'status'>) {
  if (record.status !== 'active') return 'safe' as const;
  const today = todayDateString();
  if (record.expiryDate < today) return 'overdue' as const;
  if (record.daysLeft <= 7) return '7' as const;
  if (record.daysLeft <= 30) return '30' as const;
  if (record.daysLeft <= 90) return '90' as const;
  return 'safe' as const;
}
