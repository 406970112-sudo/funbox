import type {
  HomeConsumablesEventType,
  HomeConsumablesItem,
  HomeConsumablesPredictionState,
} from '@/types/home-consumables';

const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function todayDateString(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatDateCN(date: string) {
  if (!date) return '';
  const parsed = new Date(`${date.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return `${parsed.getMonth() + 1}月${parsed.getDate()}日 ${WEEKDAY_NAMES[parsed.getDay()]}`;
}

export function formatShortDate(date: string) {
  if (!date) return '';
  const parsed = new Date(`${date.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return `${parsed.getMonth() + 1}/${parsed.getDate()}`;
}

export function formatDateTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  const hours = String(parsed.getHours()).padStart(2, '0');
  const minutes = String(parsed.getMinutes()).padStart(2, '0');
  return `${month}-${day} ${hours}:${minutes}`;
}

export function eventTypeLabel(type: HomeConsumablesEventType) {
  switch (type) {
    case 'purchase':
      return '买了一份';
    case 'replace':
      return '换新';
    case 'consume':
      return '用了部分';
    case 'count':
      return '盘点余量';
    default:
      return type;
  }
}

export function sourceLabel(source: string) {
  if (source === 'import') return '文件导入';
  return '用户录入';
}

export function predictionStateLabel(state: HomeConsumablesPredictionState) {
  switch (state) {
    case 'predictable':
      return '可预测';
    case 'developing':
      return '正在积累';
    case 'stale':
      return '事件已过期';
    case 'unknown_stock':
      return '余量未填写';
    default:
      return '暂无预测';
  }
}

export function predictionColor(state: HomeConsumablesPredictionState) {
  switch (state) {
    case 'predictable':
      return '#1db991';
    case 'developing':
      return '#4b6bff';
    case 'stale':
      return '#f1a33b';
    case 'unknown_stock':
    case 'no_data':
      return '#7483a2';
    default:
      return '#7483a2';
  }
}

export function iconForCategory(icon: string) {
  const fallback: Record<string, string> = {
    box: 'package-variant-closed',
    'bottle-tonic-outline': 'bottle-tonic-outline',
    shampoo: 'shampoo',
    recycle: 'recycle',
    cat: 'cat',
    dog: 'dog',
    water: 'water',
    'eye-outline': 'eye-outline',
    'water-filter': 'water-filter',
    package: 'package-variant-closed',
  };
  return (fallback[icon] ?? 'home-clock-outline') as never;
}

export function iconForEventType(type: HomeConsumablesEventType) {
  switch (type) {
    case 'purchase':
      return 'shopping-outline';
    case 'replace':
      return 'refresh';
    case 'consume':
      return 'minus-circle-outline';
    case 'count':
      return 'clipboard-check-outline';
    default:
      return 'dots-horizontal-circle-outline';
  }
}

export function formatStock(item: Pick<HomeConsumablesItem, 'currentStock' | 'unit'>) {
  if (item.currentStock === undefined || item.currentStock === null) {
    return '余量未填写';
  }
  return `${item.currentStock} ${item.unit}`;
}

export function remainingText(item: HomeConsumablesItem) {
  if (item.prediction.remainingDays === undefined) {
    return predictionStateLabel(item.prediction.state);
  }
  return `预计 ${item.prediction.remainingDays} 天`;
}
