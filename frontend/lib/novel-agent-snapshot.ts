import type {
  NovelDraft,
  NovelOutline,
  NovelReview,
  NovelStageId,
  NovelStyleDimension,
  ReferenceAnalysis,
} from './novel-agent-workflow.ts';

export const NOVEL_WORKFLOW_SNAPSHOT_VERSION = 1 as const;

export type NovelWorkflowPhase = 'idle' | 'planning' | 'awaiting-approval' | 'writing' | 'complete';
export type NovelWorkflowFormSnapshot = {
  premise: string;
  genre: string;
  tone: string;
  referenceTitle: string;
  referenceSample: string;
  keywords: string;
  styleDimensions: NovelStyleDimension[];
};

export type NovelWorkflowSnapshot = {
  version: typeof NOVEL_WORKFLOW_SNAPSHOT_VERSION;
  mode?: 'demo' | 'real';
  workflowId?: string | null;
  workflowVersion?: number | null;
  phase: NovelWorkflowPhase;
  form: NovelWorkflowFormSnapshot;
  stages: Partial<Record<NovelStageId, 'idle' | 'running' | 'complete'>>;
  reference: ReferenceAnalysis | null;
  outline: NovelOutline | null;
  draft: NovelDraft | null;
  review: NovelReview | null;
  memorySync: { status: string; updated: string[] } | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasValidForm(value: unknown): value is NovelWorkflowFormSnapshot {
  if (!isRecord(value)) return false;
  return typeof value.premise === 'string'
    && typeof value.genre === 'string'
    && typeof value.tone === 'string'
    && typeof value.referenceTitle === 'string'
    && typeof value.referenceSample === 'string'
    && typeof value.keywords === 'string'
    && Array.isArray(value.styleDimensions)
    && value.styleDimensions.every((item) => typeof item === 'string');
}

function hasValidPhase(value: unknown): value is NovelWorkflowPhase {
  return value === 'idle'
    || value === 'planning'
    || value === 'awaiting-approval'
    || value === 'writing'
    || value === 'complete';
}

function hasValidStages(value: unknown): value is NovelWorkflowSnapshot['stages'] {
  if (!isRecord(value)) return false;
  return Object.values(value).every((stage) => stage === 'idle' || stage === 'running' || stage === 'complete');
}

function isNullableRecord(value: unknown): value is Record<string, unknown> | null {
  return value === null || isRecord(value);
}

export function serializeNovelWorkflow(snapshot: NovelWorkflowSnapshot): string {
  return JSON.stringify(snapshot);
}

export function restoreNovelWorkflow(raw: string | null): NovelWorkflowSnapshot | null {
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      !isRecord(parsed)
      || parsed.version !== NOVEL_WORKFLOW_SNAPSHOT_VERSION
      || !hasValidPhase(parsed.phase)
      || !hasValidForm(parsed.form)
      || !hasValidStages(parsed.stages)
      || !isNullableRecord(parsed.reference)
      || !isNullableRecord(parsed.outline)
      || !isNullableRecord(parsed.draft)
      || !isNullableRecord(parsed.review)
      || !isNullableRecord(parsed.memorySync)
    ) {
      return null;
    }
    return parsed as NovelWorkflowSnapshot;
  } catch {
    return null;
  }
}
