import type {
  IntradaySnapshot,
  StockAlertEvent,
  StockReminder,
  StockReminderInput,
  StockReminderRuleType,
  StockReminderType,
  StockSignalRule,
  StockSignalStatus,
  StockSymbol,
  StockWatchItem,
} from '../types/stock-alert.ts';

export type {
  IntradayPoint,
  IntradaySnapshot,
  StockAlertEvent,
  StockAlertSettings,
  StockAnalysis,
  StockReminder,
  StockReminderInput,
  StockReminderRuleType,
  StockReminderType,
  StockSignalRule,
  StockSignalStatus,
  StockSymbol,
  StockWatchItem,
} from '../types/stock-alert.ts';

export type ChartPoint = {
  x: number;
  y: number;
};

export const SIGNAL_STATUS_LABELS: Record<StockSignalStatus, string> = {
  listening: '分时监听中',
  'near-buy': '信号待确认',
  'buy-triggered': '买入信号触发',
  'sell-triggered': '卖出信号触发',
  'stop-triggered': '止损信号触发',
  expired: '分析已过期',
  'data-missing': '分时数据缺失',
};

export function getSignalStatusLabel(status: StockSignalStatus) {
  return SIGNAL_STATUS_LABELS[status] ?? '状态未知';
}

export function getDirectionLabel(direction: StockReminderType) {
  const labels: Record<StockReminderType, string> = {
    buy: '买入',
    sell: '卖出',
    stop: '止损',
  };
  return labels[direction] ?? direction;
}

export function getTriggerPrice(rule: StockSignalRule, direction: StockReminderType) {
  if (direction === 'buy') return rule.buyTrigger;
  if (direction === 'sell') return rule.sellTrigger;
  return rule.stopLoss;
}

export function getSignalConditions(rule: StockSignalRule, direction: StockReminderType) {
  if (direction === 'buy') return rule.buyConditions;
  if (direction === 'sell') return rule.sellConditions;
  return [`分时价跌破止损价 ${rule.stopLoss.toFixed(2)}`];
}

export function isAnalysisExpired(validUntil: string) {
  if (!validUntil) return false;
  const today = new Date().toLocaleDateString('en-CA');
  return validUntil < today;
}

export function formatTriggerTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function buildIntradayChartPoints(
  points: readonly { price: number }[],
  width: number,
  height: number,
): ChartPoint[] {
  if (points.length === 0) return [];
  const values = points.map((point) => point.price);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = maximum - minimum;
  const step = points.length === 1 ? 0 : width / (points.length - 1);
  return points.map((point, index) => ({
    x: step * index,
    y: range === 0 ? height / 2 : height - ((point.price - minimum) / range) * height,
  }));
}

export function isValidStockSymbol(value: unknown): value is StockSymbol {
  if (!value || typeof value !== 'object') return false;
  const symbol = value as Partial<StockSymbol>;
  return (
    typeof symbol.code === 'string'
    && typeof symbol.name === 'string'
    && typeof symbol.market === 'string'
    && typeof symbol.secId === 'string'
  );
}

export function isValidStockWatchItem(value: unknown): value is StockWatchItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<StockWatchItem>;
  return (
    typeof item.id === 'string'
    && typeof item.symbolCode === 'string'
    && typeof item.name === 'string'
    && typeof item.signalStatus === 'string'
    && Array.isArray(item.reminderTypes)
  );
}

export function isValidIntradaySnapshot(value: unknown): value is IntradaySnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<IntradaySnapshot>;
  return (
    typeof snapshot.fetchedAt === 'string'
    && Array.isArray(snapshot.points)
    && snapshot.points.every((point) => typeof point?.price === 'number')
  );
}

export function isValidStockAlertEvent(value: unknown): value is StockAlertEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<StockAlertEvent>;
  return (
    typeof event.id === 'string'
    && typeof event.direction === 'string'
    && typeof event.triggerTime === 'string'
    && typeof event.triggerPrice === 'number'
    && Array.isArray(event.conditions)
  );
}
