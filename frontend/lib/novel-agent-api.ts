import { getAPIBaseUrl } from './api-base-url.ts';
import type {
  NovelDraft,
  NovelOutline,
  NovelReview,
  NovelWorkflowInput,
  ReferenceAnalysis,
} from './novel-agent-workflow.ts';

export type NovelAgentModeConfig = {
  demo: boolean;
  real: boolean;
  enabled: boolean;
  provider: string;
  models: { planner: string; writer: string; reviewer: string };
};

type BackendWorkflow = {
  workflowId: string;
  status: string;
  version: number;
  input: NovelWorkflowInput;
  aMessages: { role: string; content: string; createdAt: string }[];
  draftPlan?: { reference?: ReferenceAnalysis; outline?: NovelOutline } | null;
  approvedPlan?: { reference?: ReferenceAnalysis; outline?: NovelOutline } | null;
  draft?: Partial<NovelDraft> | null;
  review?: Partial<NovelReview> | null;
};

export type NovelAgentWorkflowResult = {
  workflowId: string;
  status: string;
  version: number;
  reference: ReferenceAnalysis | null;
  outline: NovelOutline | null;
  draft: NovelDraft | null;
  review: NovelReview | null;
};

export class NovelAgentAPIError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number, detail?: string) {
    super(detail || code);
    this.name = 'NovelAgentAPIError';
    this.code = code;
    this.status = status;
  }
}

export async function getNovelAgentConfig() {
  return requestJSON<NovelAgentModeConfig>('/api/v1/novel-agent/config');
}

export async function createNovelAgentWorkflow(token: string, input: NovelWorkflowInput) {
  const response = await requestJSON<{ workflow: BackendWorkflow }>('/api/v1/novel-agent/workflows', {
    body: JSON.stringify(stripDemoFields(input)),
    headers: withJSONToken(token),
    method: 'POST',
  });
  return mapWorkflow(response.workflow);
}

export async function getNovelAgentWorkflow(token: string, workflowId: string) {
  const response = await requestJSON<{ workflow: BackendWorkflow }>(`/api/v1/novel-agent/workflows/${workflowId}`, withToken(token));
  return mapWorkflow(response.workflow);
}

export async function messageNovelAgentA(token: string, workflowId: string, message: string, expectedVersion: number) {
  const response = await requestJSON<{ workflow: BackendWorkflow }>(`/api/v1/novel-agent/workflows/${workflowId}/a/messages`, {
    body: JSON.stringify({ expectedVersion, message }),
    headers: withJSONToken(token),
    method: 'POST',
  });
  return mapWorkflow(response.workflow);
}

export async function approveNovelAgentA(token: string, workflowId: string, expectedVersion: number) {
  const response = await requestJSON<{ workflow: BackendWorkflow }>(`/api/v1/novel-agent/workflows/${workflowId}/a/approve`, {
    body: JSON.stringify({ expectedVersion }),
    headers: withJSONToken(token),
    method: 'POST',
  });
  return mapWorkflow(response.workflow);
}

export async function writeNovelAgentB(
  token: string,
  workflowId: string,
  expectedVersion: number,
  input: { sceneId?: string; chapterGoal?: string; sceneGoal?: string; context?: string } = {},
) {
  const response = await requestJSON<{ workflow: BackendWorkflow }>(`/api/v1/novel-agent/workflows/${workflowId}/b/write`, {
    body: JSON.stringify({ ...input, expectedVersion }),
    headers: withJSONToken(token),
    method: 'POST',
  });
  return mapWorkflow(response.workflow);
}

export async function reviewNovelAgentC(token: string, workflowId: string, expectedVersion: number) {
  const response = await requestJSON<{ workflow: BackendWorkflow }>(`/api/v1/novel-agent/workflows/${workflowId}/c/review`, {
    body: JSON.stringify({ expectedVersion }),
    headers: withJSONToken(token),
    method: 'POST',
  });
  return mapWorkflow(response.workflow);
}

export async function reviseNovelAgentB(
  token: string,
  workflowId: string,
  expectedVersion: number,
  input: { sceneId?: string; category?: string; scope?: string; feedback: string; mustChange?: string[]; mustKeep?: string[]; doNotChange?: string[] },
) {
  const response = await requestJSON<{ workflow: BackendWorkflow }>(`/api/v1/novel-agent/workflows/${workflowId}/b/revise`, {
    body: JSON.stringify({ ...input, expectedVersion }),
    headers: withJSONToken(token),
    method: 'POST',
  });
  return mapWorkflow(response.workflow);
}

function stripDemoFields(input: NovelWorkflowInput) {
  const { delayMs: _delayMs, ...realInput } = input;
  return realInput;
}

function mapWorkflow(workflow: BackendWorkflow): NovelAgentWorkflowResult {
  const plan = workflow.approvedPlan || workflow.draftPlan;
  return {
    workflowId: workflow.workflowId,
    status: workflow.status,
    version: workflow.version,
    reference: plan?.reference ?? null,
    outline: plan?.outline ?? null,
    draft: workflow.draft ? mapDraft(workflow.draft) : null,
    review: workflow.review ? mapReview(workflow.review) : null,
  };
}

function mapDraft(draft: Partial<NovelDraft>): NovelDraft {
  const paragraphs = Array.isArray(draft.paragraphs) ? draft.paragraphs : [];
  return {
    title: draft.title || '未命名章节',
    subtitle: draft.subtitle || '',
    paragraphs,
    wordCount: draft.wordCount ?? paragraphs.join('').length,
    revision: draft.revision ?? 1,
    sceneId: draft.sceneId || 'ch-001-scene-001',
    activeRevisionId: draft.activeRevisionId || `rev-${String(draft.revision ?? 1).padStart(3, '0')}`,
    revisionHistory: draft.revisionHistory ?? [],
    lastRevisionRequest: draft.lastRevisionRequest ?? null,
    sourceHook: draft.sourceHook || '',
    styleApplied: draft.styleApplied || '使用已确认的作品风格约束。',
    styleDimensions: draft.styleDimensions ?? [],
  };
}

function mapReview(review: Partial<NovelReview>): NovelReview {
  const checkResults = review.checkResults ?? [];
  const issueDetails = review.issueDetails ?? [];
  const categories = review.categories ?? Object.fromEntries(
    checkResults.map((check) => [check.id, {
      label: check.label,
      status: check.status,
      detail: check.evidence,
    }]),
  );
  return {
    round: review.round ?? 1,
    pass: review.pass ?? review.route === 'PASS',
    score: review.score ?? 0,
    summary: review.summary || 'C 已完成复核。',
    route: review.route || 'HUMAN_REVIEW',
    issues: review.issues ?? issueDetails.map((issue) => issue.message),
    issueDetails,
    checkResults,
    categories: categories as NovelReview['categories'],
    checks: review.checks ?? checkResults.map((check) => ({ label: check.label, status: check.status })),
  };
}

async function requestJSON<T>(path: string, options: RequestInit = {}) {
  const response = await fetch(`${getAPIBaseUrl()}${path}`, options);
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string; detail?: string };
  if (!response.ok) {
    throw new NovelAgentAPIError(payload.error || 'request_failed', response.status, payload.detail);
  }
  return payload as T;
}

function withToken(token: string): RequestInit {
  return { headers: { Authorization: `Bearer ${token}` } };
}

function withJSONToken(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}
