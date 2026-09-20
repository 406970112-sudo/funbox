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

export function serializeNovelWorkflow(snapshot: NovelWorkflowSnapshot): string {
  return JSON.stringify(snapshot);
}

export function restoreNovelWorkflow(raw: string | null): NovelWorkflowSnapshot | null {
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== NOVEL_WORKFLOW_SNAPSHOT_VERSION || !hasValidForm(parsed.form)) {
      return null;
    }
    return parsed as NovelWorkflowSnapshot;
  } catch {
    return null;
  }
}
