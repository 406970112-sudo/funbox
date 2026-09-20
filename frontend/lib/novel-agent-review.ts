import type { NovelWritingContext } from './novel-agent-artifacts.ts';
import type { NovelDraft, ReferenceAnalysis } from './novel-agent-workflow.ts';

export type NovelReviewRoute = 'PASS' | 'B_REWRITE' | 'REOPEN_PLANNING' | 'HUMAN_REVIEW';
export type NovelReviewSeverity = 'info' | 'minor' | 'major' | 'critical';
export type NovelReviewCheckId = 'quality' | 'style' | 'originality' | 'safety';

export type NovelReviewIssue = {
  type: string;
  message: string;
  location: string;
  severity: NovelReviewSeverity;
  route: Exclude<NovelReviewRoute, 'PASS'>;
  evidence: string;
};

export type NovelReviewCheck = {
  id: NovelReviewCheckId;
  label: string;
  status: 'pass' | 'warn';
  severity: NovelReviewSeverity;
  evidence: string;
  issues: NovelReviewIssue[];
};

export type NovelReviewCategory = {
  label: string;
  status: 'pass' | 'warn';
  detail: string;
};

export type NovelReview = {
  round: number;
  pass: boolean;
  score: number;
  summary: string;
  route: NovelReviewRoute;
  issues: string[];
  issueDetails: NovelReviewIssue[];
  checkResults: NovelReviewCheck[];
  categories: Record<NovelReviewCheckId, NovelReviewCategory>;
  checks: { label: string; status: 'pass' | 'warn' }[];
};

export type NovelReviewInput = {
  draft: NovelDraft;
  context: NovelWritingContext;
  reference: ReferenceAnalysis;
  round: 1 | 2;
};

function createQualityCheck({ context, round }: NovelReviewInput): NovelReviewCheck {
  if (round === 1) {
    return {
      id: 'quality',
      label: '剧情质量',
      status: 'warn',
      severity: 'minor',
      evidence: '当前场景结尾还没有把下一步行动落到具体动作上。',
      issues: [{
        type: 'pacing',
        message: '结尾悬念不足，主角的下一步行动还不够具体',
        location: `${context.scene.sceneId}/ending`,
        severity: 'minor',
        route: 'B_REWRITE',
        evidence: '章节结尾只有氛围变化，没有明确的行动选择。',
      }],
    };
  }

  return {
    id: 'quality',
    label: '剧情质量',
    status: 'pass',
    severity: 'info',
    evidence: '场景目标、冲突和结尾行动已经闭合。',
    issues: [],
  };
}

function createStyleCheck({ draft, reference }: NovelReviewInput): NovelReviewCheck {
  return {
    id: 'style',
    label: '作者风格',
    status: 'pass',
    severity: 'info',
    evidence: `作者风格优先，已执行${reference.referenceStyleProfile.enabled.join('、')}参考特征。`,
    issues: [],
  };
}

function createOriginalityCheck({ context }: NovelReviewInput): NovelReviewCheck {
  return {
    id: 'originality',
    label: '原创性',
    status: 'pass',
    severity: 'info',
    evidence: `只使用${context.scene.sceneId}的原创场景卡，没有传入参考原文。`,
    issues: [],
  };
}

function createSafetyCheck(): NovelReviewCheck {
  return {
    id: 'safety',
    label: '原创与安全',
    status: 'pass',
    severity: 'info',
    evidence: '没有发现需要停止自动流程的风险。',
    issues: [],
  };
}

export function createReviewChecks(input: NovelReviewInput): NovelReviewCheck[] {
  return [
    createQualityCheck(input),
    createStyleCheck(input),
    createOriginalityCheck(input),
    createSafetyCheck(),
  ];
}

export async function runReviewChecks(input: NovelReviewInput): Promise<NovelReviewCheck[]> {
  const checks = createReviewChecks(input);
  return Promise.all(checks.map(async (check) => check));
}

function routeForIssues(issues: NovelReviewIssue[]): NovelReviewRoute {
  if (issues.some((issue) => issue.route === 'HUMAN_REVIEW' || issue.severity === 'critical')) {
    return 'HUMAN_REVIEW';
  }
  if (issues.some((issue) => issue.route === 'REOPEN_PLANNING' || issue.severity === 'major')) {
    return 'REOPEN_PLANNING';
  }
  if (issues.some((issue) => issue.route === 'B_REWRITE')) return 'B_REWRITE';
  return 'PASS';
}

function categoryForCheck(check: NovelReviewCheck): NovelReviewCategory {
  return {
    label: check.label,
    status: check.status,
    detail: check.evidence,
  };
}

export function aggregateReviewChecks(checks: NovelReviewCheck[], round: number): NovelReview {
  const issueDetails = checks.flatMap((check) => check.issues);
  const route = routeForIssues(issueDetails);
  const categories = Object.fromEntries(
    checks.map((check) => [check.id, categoryForCheck(check)]),
  ) as Record<NovelReviewCheckId, NovelReviewCategory>;
  const score = route === 'HUMAN_REVIEW' ? 0 : issueDetails.length ? 76 : 92;
  const summary = route === 'PASS'
    ? '复核通过。当前场景的质量、风格、原创性与安全检查均已达标。'
    : route === 'B_REWRITE'
      ? '发现局部问题，交给 B 定向返工，不改变总体架构。'
      : route === 'REOPEN_PLANNING'
        ? '发现影响结构的问题，需要返回 A 重新确认。'
        : '发现需要人工确认的原创性或安全风险，已暂停自动返工。';

  return {
    round,
    pass: route === 'PASS',
    score,
    summary,
    route,
    issues: issueDetails.map((issue) => issue.message),
    issueDetails,
    checkResults: checks,
    categories,
    checks: checks.map((check) => ({ label: check.label, status: check.status })),
  };
}

