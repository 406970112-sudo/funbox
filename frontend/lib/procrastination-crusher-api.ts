import { getAPIBaseUrl } from '@/lib/auth-api';
import type {
  ProcrastinationGoal,
  ProcrastinationGoalInput,
  ProcrastinationHome,
  ProcrastinationLedger,
  ProcrastinationStats,
  ProcrastinationStepInput,
  ProcrastinationSuggestResult,
} from '@/types/procrastination-crusher';

type ErrorPayload = { error?: string };

export class ProcrastinationAPIError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = 'ProcrastinationAPIError';
    this.code = code;
    this.status = status;
  }
}

export function fetchProcrastinationHome(token: string, date?: string) {
  return requestJSON<ProcrastinationHome>(
    `/api/v1/procrastination/home${date ? `?date=${encodeURIComponent(date)}` : ''}`,
    token,
  );
}

export async function fetchProcrastinationGoals(token: string, status?: string) {
  const suffix = status ? `?status=${encodeURIComponent(status)}` : '';
  const payload = await requestJSON<{ goals: ProcrastinationGoal[] }>(
    `/api/v1/procrastination/goals${suffix}`,
    token,
  );
  return payload.goals;
}

export function createProcrastinationGoal(token: string, input: ProcrastinationGoalInput) {
  return requestJSON<ProcrastinationGoal>('/api/v1/procrastination/goals', token, {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export function fetchProcrastinationGoal(token: string, goalId: string) {
  return requestJSON<ProcrastinationGoal>(
    `/api/v1/procrastination/goals/${encodeURIComponent(goalId)}`,
    token,
  );
}

export function updateProcrastinationGoal(
  token: string,
  goalId: string,
  input: Partial<Pick<ProcrastinationGoal, 'title' | 'note' | 'deadline' | 'status'>>,
) {
  return requestJSON<ProcrastinationGoal>(
    `/api/v1/procrastination/goals/${encodeURIComponent(goalId)}`,
    token,
    {
      body: JSON.stringify(input),
      method: 'PATCH',
    },
  );
}

export function archiveProcrastinationGoal(token: string, goalId: string) {
  return requestJSON<ProcrastinationGoal>(
    `/api/v1/procrastination/goals/${encodeURIComponent(goalId)}`,
    token,
    { method: 'DELETE' },
  );
}

export function addProcrastinationStep(token: string, goalId: string, input: ProcrastinationStepInput) {
  return requestJSON<ProcrastinationGoal>(
    `/api/v1/procrastination/goals/${encodeURIComponent(goalId)}/steps`,
    token,
    {
      body: JSON.stringify(input),
      method: 'POST',
    },
  );
}

export function updateProcrastinationStep(
  token: string,
  goalId: string,
  stepId: string,
  input: Partial<Pick<ProcrastinationStepInput, 'title' | 'note' | 'estimatedMinutes' | 'sortOrder'>>,
) {
  return requestJSON<ProcrastinationGoal>(
    `/api/v1/procrastination/goals/${encodeURIComponent(goalId)}/steps/${encodeURIComponent(stepId)}`,
    token,
    {
      body: JSON.stringify(input),
      method: 'PATCH',
    },
  );
}

export function deleteProcrastinationStep(token: string, goalId: string, stepId: string) {
  return requestJSON<ProcrastinationGoal>(
    `/api/v1/procrastination/goals/${encodeURIComponent(goalId)}/steps/${encodeURIComponent(stepId)}`,
    token,
    { method: 'DELETE' },
  );
}

export function startProcrastinationStep(token: string, stepId: string) {
  return requestJSON<ProcrastinationGoal>(
    `/api/v1/procrastination/steps/${encodeURIComponent(stepId)}/start`,
    token,
    {
      body: '{}',
      method: 'POST',
    },
  );
}

export function completeProcrastinationStep(token: string, stepId: string, date?: string) {
  return requestJSON<ProcrastinationGoal>(
    `/api/v1/procrastination/steps/${encodeURIComponent(stepId)}/complete`,
    token,
    {
      body: JSON.stringify({ date: date ?? '' }),
      method: 'POST',
    },
  );
}

export function undoProcrastinationStep(token: string, stepId: string, date?: string) {
  return requestJSON<ProcrastinationGoal>(
    `/api/v1/procrastination/steps/${encodeURIComponent(stepId)}/undo`,
    token,
    {
      body: JSON.stringify({ date: date ?? '' }),
      method: 'POST',
    },
  );
}

export function fetchProcrastinationLedger(
  token: string,
  params: { goalId?: string; from?: string; to?: string; limit?: number } = {},
) {
  const query = new URLSearchParams();
  if (params.goalId) query.set('goalId', params.goalId);
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
  if (params.limit) query.set('limit', String(params.limit));
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return requestJSON<ProcrastinationLedger>(`/api/v1/procrastination/ledger${suffix}`, token);
}

export function fetchProcrastinationStats(token: string, range = 'week') {
  return requestJSON<ProcrastinationStats>(
    `/api/v1/procrastination/stats?range=${encodeURIComponent(range)}`,
    token,
  );
}

export function suggestProcrastinationSteps(
  token: string,
  input: { title: string; note?: string },
) {
  return requestJSON<ProcrastinationSuggestResult>('/api/v1/procrastination/suggest', token, {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export function getProcrastinationErrorMessage(error: unknown) {
  if (!(error instanceof ProcrastinationAPIError)) {
    return '暂时无法连接拖延任务粉碎机服务，请稍后重试。';
  }
  const messages: Record<string, string> = {
    procrastination_invalid_input: '请填写目标标题和 2-20 个微步骤，每步 1-120 分钟。',
    procrastination_not_found: '目标或步骤不存在。',
    procrastination_already_completed: '这一步已完成，不能重复领取经验值。',
    procrastination_step_not_completed: '只有已完成步骤可以撤销。',
    procrastination_ai_unavailable: 'AI 建议暂不可用，请直接手动拆解。',
    unauthorized: '登录状态已失效，请重新登录。',
    rate_limited: '操作过于频繁，请稍后再试。',
  };
  return messages[error.code] ?? '拖延任务粉碎机操作失败，请稍后重试。';
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
    throw new ProcrastinationAPIError(payload.error || 'request_failed', response.status);
  }
  return payload as T;
}
