import type {
  FocusPriority,
  FocusRepeatRule,
  FocusTask,
} from '@/types/focus';

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

export function formatFocusDate(date: string) {
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

export function formatTaskDue(task: Pick<FocusTask, 'dueDate' | 'dueTime'>, today = todayDateString()) {
  if (!task.dueDate) return '随时';
  if (task.dueDate === today) return task.dueTime ? `今天 ${task.dueTime}` : '今天';
  if (task.dueDate < today) return task.dueTime ? `逾期 ${task.dueTime}` : '已逾期';
  const short = formatShortDate(task.dueDate);
  return task.dueTime ? `${short} ${task.dueTime}` : short;
}

export function isOverdueTask(task: Pick<FocusTask, 'dueDate' | 'status'>, today = todayDateString()) {
  return task.status === 'open' && Boolean(task.dueDate) && task.dueDate < today;
}

export function priorityLabel(priority: FocusPriority) {
  return priority === 'high' ? '高' : priority === 'low' ? '低' : '中';
}

export function repeatLabel(repeat: FocusRepeatRule) {
  switch (repeat) {
    case 'daily':
      return '每天';
    case 'weekly':
      return '每周';
    case 'monthly':
      return '每月';
    default:
      return '不重复';
  }
}

export function formatPercent(rate: number) {
  const value = Math.round(rate * 100);
  return `${value}%`;
}

export function normalizeSubtaskLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 20);
}

export function isToday(date: string, today = todayDateString()) {
  return date === today;
}

export function weekdayLabel(weekday: number) {
  return WEEKDAY_NAMES[weekday % 7].replace('周', '周');
}

export function habitFrequencyLabel(habit: { frequency: 'daily' | 'weekly'; weekdays: number[] }) {
  if (habit.frequency === 'daily') return '每天';
  if (habit.weekdays.length === 0) return '每周';
  return habit.weekdays
    .map((weekday) => {
      const names = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
      return names[(weekday - 1 + 7) % 7];
    })
    .join('/');
}

export function listByColor(color: string) {
  const normalized = color.toLowerCase();
  const palette = ['#7e5bef', '#4b6bff', '#1db991', '#f1a33b', '#ff6b8f'];
  if (palette.includes(normalized)) return normalized;
  return '#7e5bef';
}
