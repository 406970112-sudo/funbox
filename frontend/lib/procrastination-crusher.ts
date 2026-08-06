import type {
  ProcrastinationEventType,
  ProcrastinationStep,
  ProcrastinationStepInput,
} from '@/types/procrastination-crusher';

export const GOAL_BONUS_XP = 20;

export function stepXP(estimatedMinutes: number) {
  return Math.min(30, Math.max(1, 5 + estimatedMinutes));
}

export function goalExpectedXP(steps: readonly Pick<ProcrastinationStepInput, 'estimatedMinutes'>[]) {
  const stepTotal = steps.reduce((sum, step) => sum + stepXP(step.estimatedMinutes), 0);
  return steps.length > 0 ? stepTotal + GOAL_BONUS_XP : 0;
}

export function levelFromXP(totalXP: number) {
  const safeXP = Math.max(0, totalXP);
  const level = Math.floor(safeXP / 50) + 1;
  const progress = safeXP % 50;
  return { level, progress, next: 50 - progress };
}

export function todayDateString(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatMinutes(minutes: number) {
  return `${minutes} 分钟`;
}

export function formatActualSeconds(seconds: number) {
  if (seconds <= 0) return '';
  if (seconds < 60) return `${seconds} 秒`;
  const wholeMinutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest > 0 ? `${wholeMinutes} 分 ${rest} 秒` : `${wholeMinutes} 分钟`;
}

export function eventTypeLabel(type: ProcrastinationEventType) {
  switch (type) {
    case 'step_completed':
      return '步骤完成';
    case 'step_undone':
      return '步骤撤销';
    case 'goal_completed':
      return '目标完成奖励';
    case 'goal_completed_undo':
      return '目标奖励冲正';
  }
}

export function stepDisplayXP(step: Pick<ProcrastinationStep, 'estimatedMinutes' | 'status' | 'xpEarned'>) {
  return step.status === 'completed' ? step.xpEarned : stepXP(step.estimatedMinutes);
}
