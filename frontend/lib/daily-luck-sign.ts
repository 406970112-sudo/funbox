import type {
  DailyLuckSignCategory,
  DailyLuckSignCompletion,
  DailyLuckSignFact,
  DailyLuckSignResponse,
  DailyLuckSignSuggestion,
} from '@/types/daily-luck-sign';

export const categoryLabels: Record<DailyLuckSignCategory, string> = {
  'small-thing': '今日小事',
  challenge: '今日挑战',
  encouragement: '今日鼓励',
};

export function todayDateString(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatChineseDate(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][parsed.getDay()];
  return `${parsed.getMonth() + 1}月${parsed.getDate()}日 ${week}`;
}

export function groupSuggestions(
  suggestions: DailyLuckSignSuggestion[],
): Record<DailyLuckSignCategory, DailyLuckSignSuggestion[]> {
  return {
    'small-thing': suggestions.filter((item) => item.category === 'small-thing').slice(0, 3),
    challenge: suggestions.filter((item) => item.category === 'challenge').slice(0, 2),
    encouragement: suggestions.filter((item) => item.category === 'encouragement').slice(0, 2),
  };
}

export function factValue(fact: DailyLuckSignFact) {
  return `${fact.value}${fact.unit ? ` ${fact.unit}` : ''}`;
}

export function findFact(response: DailyLuckSignResponse, key: string) {
  return response.facts.find((fact) => fact.key === key);
}

export function completionStats(items: DailyLuckSignCompletion[], date: string) {
  const today = items.filter((item) => item.date === date).length;
  const month = date.slice(0, 7);
  const thisMonth = items.filter((item) => item.date.startsWith(month)).length;
  return { today, month: thisMonth, total: items.length };
}

export function isCompletionDone(
  items: DailyLuckSignCompletion[],
  date: string,
  ruleId: string,
) {
  return items.some((item) => item.date === date && item.ruleId === ruleId);
}

export function upsertCompletion(items: DailyLuckSignCompletion[], item: DailyLuckSignCompletion) {
  const existingIndex = items.findIndex(
    (entry) => entry.date === item.date && entry.ruleId === item.ruleId,
  );
  if (existingIndex >= 0) {
    const next = [...items];
    next[existingIndex] = item;
    return next;
  }
  return [item, ...items];
}

export function removeCompletion(items: DailyLuckSignCompletion[], id: string) {
  return items.filter((item) => item.id !== id);
}

export function completionId(date: string, ruleId: string) {
  return `local-${date}-${ruleId}`;
}
