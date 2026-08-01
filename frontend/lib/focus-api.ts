import { getAPIBaseUrl } from '@/lib/auth-api';
import type {
  FocusCalendar,
  FocusGoal,
  FocusGoalInput,
  FocusHabit,
  FocusHabitInput,
  FocusHabitRecord,
  FocusList,
  FocusListInput,
  FocusStats,
  FocusTask,
  FocusTaskInput,
  FocusToday,
} from '@/types/focus';

type ErrorPayload = {
  error?: string;
};

type ListsResponse = { lists: FocusList[] };
type TasksResponse = { tasks: FocusTask[] };
type GoalsResponse = { goals: FocusGoal[] };
type HabitsResponse = { habits: FocusHabit[] };
type RecordResponse = { record: FocusHabitRecord };

export class FocusAPIError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = 'FocusAPIError';
    this.code = code;
    this.status = status;
  }
}

export function fetchFocusToday(token: string, date?: string) {
  return requestJSON<FocusToday>(
    `/api/v1/focus/today${date ? `?date=${encodeURIComponent(date)}` : ''}`,
    token,
  );
}

export async function fetchFocusLists(token: string) {
  const payload = await requestJSON<ListsResponse>('/api/v1/focus/lists', token);
  return payload.lists;
}

export function createFocusList(token: string, input: FocusListInput) {
  return requestJSON<FocusList>('/api/v1/focus/lists', token, {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export function updateFocusList(token: string, listId: string, input: Partial<FocusListInput>) {
  return requestJSON<FocusList>(`/api/v1/focus/lists/${encodeURIComponent(listId)}`, token, {
    body: JSON.stringify(input),
    method: 'PATCH',
  });
}

export function deleteFocusList(token: string, listId: string) {
  return requestJSON<{ success: boolean }>(
    `/api/v1/focus/lists/${encodeURIComponent(listId)}`,
    token,
    { method: 'DELETE' },
  );
}

export async function fetchFocusTasks(token: string, params: {
  listId?: string;
  status?: string;
  date?: string;
  q?: string;
} = {}) {
  const query = new URLSearchParams();
  if (params.listId) query.set('listId', params.listId);
  if (params.status) query.set('status', params.status);
  if (params.date) query.set('date', params.date);
  if (params.q) query.set('q', params.q);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  const payload = await requestJSON<TasksResponse>(`/api/v1/focus/tasks${suffix}`, token);
  return payload.tasks;
}

export function createFocusTask(token: string, input: FocusTaskInput) {
  return requestJSON<FocusTask>('/api/v1/focus/tasks', token, {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export function updateFocusTask(token: string, taskId: string, input: Partial<FocusTaskInput>) {
  return requestJSON<FocusTask>(`/api/v1/focus/tasks/${encodeURIComponent(taskId)}`, token, {
    body: JSON.stringify(input),
    method: 'PATCH',
  });
}

export function completeFocusTask(token: string, taskId: string, completed: boolean, date?: string) {
  return requestJSON<FocusTask>(
    `/api/v1/focus/tasks/${encodeURIComponent(taskId)}/complete`,
    token,
    {
      body: JSON.stringify({ completed, date }),
      method: 'POST',
    },
  );
}

export function deleteFocusTask(token: string, taskId: string) {
  return requestJSON<{ success: boolean }>(
    `/api/v1/focus/tasks/${encodeURIComponent(taskId)}`,
    token,
    { method: 'DELETE' },
  );
}

export async function fetchFocusGoals(token: string, date?: string) {
  const payload = await requestJSON<GoalsResponse>(
    `/api/v1/focus/goals${date ? `?date=${encodeURIComponent(date)}` : ''}`,
    token,
  );
  return payload.goals;
}

export function createFocusGoal(token: string, input: FocusGoalInput) {
  return requestJSON<FocusGoal>('/api/v1/focus/goals', token, {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export function updateFocusGoal(token: string, goalId: string, input: Partial<FocusGoalInput>) {
  return requestJSON<FocusGoal>(`/api/v1/focus/goals/${encodeURIComponent(goalId)}`, token, {
    body: JSON.stringify(input),
    method: 'PATCH',
  });
}

export function deleteFocusGoal(token: string, goalId: string) {
  return requestJSON<{ success: boolean }>(
    `/api/v1/focus/goals/${encodeURIComponent(goalId)}`,
    token,
    { method: 'DELETE' },
  );
}

export async function fetchFocusHabits(token: string, date?: string) {
  const payload = await requestJSON<HabitsResponse>(
    `/api/v1/focus/habits${date ? `?date=${encodeURIComponent(date)}` : ''}`,
    token,
  );
  return payload.habits;
}

export function createFocusHabit(token: string, input: FocusHabitInput) {
  return requestJSON<FocusHabit>('/api/v1/focus/habits', token, {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export function updateFocusHabit(token: string, habitId: string, input: Partial<FocusHabitInput>) {
  return requestJSON<FocusHabit>(`/api/v1/focus/habits/${encodeURIComponent(habitId)}`, token, {
    body: JSON.stringify(input),
    method: 'PATCH',
  });
}

export function addFocusHabitRecord(token: string, habitId: string, date?: string) {
  return requestJSON<RecordResponse>(
    `/api/v1/focus/habits/${encodeURIComponent(habitId)}/records`,
    token,
    {
      body: JSON.stringify({ date }),
      method: 'POST',
    },
  );
}

export function removeFocusHabitRecord(token: string, habitId: string, recordId: string) {
  return requestJSON<{ success: boolean }>(
    `/api/v1/focus/habits/${encodeURIComponent(habitId)}/records/${encodeURIComponent(recordId)}`,
    token,
    { method: 'DELETE' },
  );
}

export function removeFocusHabitRecordByDate(token: string, habitId: string, date: string) {
  return requestJSON<{ success: boolean }>(
    `/api/v1/focus/habits/${encodeURIComponent(habitId)}/records?date=${encodeURIComponent(date)}`,
    token,
    { method: 'DELETE' },
  );
}

export function fetchFocusStats(token: string, range: 'week' | 'month') {
  return requestJSON<FocusStats>(
    `/api/v1/focus/stats?range=${encodeURIComponent(range)}`,
    token,
  );
}

export function fetchFocusCalendar(token: string, month: string) {
  return requestJSON<FocusCalendar>(
    `/api/v1/focus/calendar?month=${encodeURIComponent(month)}`,
    token,
  );
}

export function getFocusErrorMessage(error: unknown) {
  if (!(error instanceof FocusAPIError)) {
    return '暂时无法连接效率清单服务，请稍后重试。';
  }
  const messages: Record<string, string> = {
    focus_goal_limit_reached: '每日目标最多只能设置 3 条。',
    focus_habit_already_done: '这个习惯今天已经打过卡了。',
    focus_invalid_input: '请检查输入内容是否完整。',
    focus_not_found: '清单内容不存在或已被删除。',
    focus_subtasks_pending: '请先完成全部子任务，再完成主任务。',
    rate_limited: '请求过于频繁，请稍后再试。',
    unauthorized: '登录状态已失效，请重新登录。',
  };
  return messages[error.code] ?? '效率清单操作失败，请稍后重试。';
}

async function requestJSON<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers as Record<string, string> | undefined),
  };
  const response = await fetch(`${getAPIBaseUrl()}${path}`, { ...options, headers });
  const payload = (await response.json().catch(() => ({}))) as Partial<T> & ErrorPayload;
  if (!response.ok) {
    throw new FocusAPIError(payload.error || 'request_failed', response.status);
  }
  return payload as T;
}
