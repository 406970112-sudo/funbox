import type { CoolingAnswers, CoolingItem, CoolingStats } from '@/types/impulse-cooler';

export const WHY_BUY_OPTIONS = [
  { value: 'need', label: '需要' },
  { value: 'reward', label: '奖励自己' },
  { value: 'promo', label: '被促销吸引' },
  { value: 'fomo', label: '跟风' },
  { value: 'emotion', label: '情绪缓解' },
  { value: 'other', label: '其他' },
] as const;

export const SIMILAR_OPTIONS = [
  { value: 'none', label: '没有' },
  { value: 'one', label: '有 1 件' },
  { value: 'many', label: '有多件' },
] as const;

export const USAGE_OPTIONS = [
  { value: 'daily', label: '每天' },
  { value: 'weekly', label: '每周' },
  { value: 'monthly', label: '每月' },
  { value: 'rarely', label: '偶尔' },
  { value: 'never', label: '可能不用' },
] as const;

export const WANTS_OPTIONS = [
  { value: 'yes', label: '是' },
  { value: 'no', label: '否' },
  { value: 'unsure', label: '不确定' },
] as const;

export function parseYuanToCents(value: string): number | null {
  const normalized = value.trim().replace(/,/g, '');
  if (!normalized) return null;
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount * 100);
}

export function formatCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function formatHours(value?: number): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return '--';
  return value.toFixed(1);
}

export function formatPercent(value?: number): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return '--';
  return `${value.toFixed(1)}%`;
}

export function sourceLabel(sourceType: string): string {
  if (sourceType === 'screenshot') return '用户上传截图';
  if (sourceType === 'link') return '商品链接';
  return '用户填写';
}

export function riskMeta(level: string): { label: string; color: string } {
  if (level === 'high') return { label: '高提醒', color: '#ff5d6c' };
  if (level === 'medium') return { label: '中提醒', color: '#f1a33b' };
  return { label: '低提醒', color: '#1db991' };
}

export function statusMeta(status: string): { label: string; color: string } {
  if (status === 'cooling') return { label: '冷静中', color: '#4b6bff' };
  if (status === 'pending_decision') return { label: '待决定', color: '#ff5d6c' };
  if (status === 'bought') return { label: '已购买', color: '#7e5bef' };
  return { label: '已放弃', color: '#1db991' };
}

export function remainingText(item: CoolingItem, serverNow: string): string {
  const end = new Date(item.coolEndsAt).getTime();
  const now = new Date(serverNow).getTime();
  const diff = Math.max(0, end - now);
  const hours = Math.floor(diff / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  const seconds = Math.floor((diff % 60_000) / 1000);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function answerLabel(answers: CoolingAnswers, key: keyof CoolingAnswers): string {
  const value = answers[key] as string;
  if (!value) return '未填写';
  if (key === 'whyBuy') {
    const option = WHY_BUY_OPTIONS.find((item) => item.value === value);
    return option?.label ?? value;
  }
  if (key === 'similarCount') {
    const option = SIMILAR_OPTIONS.find((item) => item.value === value);
    const similar = option?.label ?? value;
    if (value !== 'none' && answers.similarInUse) {
      return `${similar}，${answers.similarInUse === 'yes' ? '经常使用' : '不经常使用'}`;
    }
    return similar;
  }
  if (key === 'usageFrequency') {
    const option = USAGE_OPTIONS.find((item) => item.value === value);
    return option?.label ?? value;
  }
  if (key === 'wantsAfter24h') {
    const option = WANTS_OPTIONS.find((item) => item.value === value);
    return option?.label ?? value;
  }
  return value;
}

export function completionRateText(stats: CoolingStats): string {
  return `${stats.completionRate.toFixed(1)}%`;
}

export function maxBarHeight(stats: CoolingStats): number {
  return Math.max(1, ...stats.daily.map((day) => day.createdCount + day.boughtCount + day.droppedCount));
}
