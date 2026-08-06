export type ProcrastinationGoalStatus = 'active' | 'completed' | 'archived';
export type ProcrastinationStepStatus = 'pending' | 'started' | 'completed';
export type ProcrastinationEventType =
  | 'step_completed'
  | 'step_undone'
  | 'goal_completed'
  | 'goal_completed_undo';

export type ProcrastinationStep = {
  id: string;
  goalId: string;
  userId: string;
  title: string;
  note: string;
  estimatedMinutes: number;
  sortOrder: number;
  status: ProcrastinationStepStatus;
  startedAt?: string;
  completedAt?: string;
  actualSeconds: number;
  xpEarned: number;
  createdAt: string;
  updatedAt: string;
};

export type ProcrastinationGoal = {
  id: string;
  userId: string;
  title: string;
  note: string;
  deadline: string;
  status: ProcrastinationGoalStatus;
  completedAt?: string;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
  steps?: ProcrastinationStep[];
  totalSteps: number;
  completedSteps: number;
  estimatedMinutes: number;
  remainingMinutes: number;
  xpEarned: number;
  expectedXP: number;
};

export type ProcrastinationEvent = {
  id: string;
  userId: string;
  goalId: string;
  stepId: string;
  eventType: ProcrastinationEventType;
  xpDelta: number;
  eventDate: string;
  createdAt: string;
  goalTitle: string;
  stepTitle: string;
};

export type ProcrastinationHome = {
  date: string;
  totalXP: number;
  todayXP: number;
  level: number;
  levelProgress: number;
  nextLevelXP: number;
  currentGoal?: ProcrastinationGoal;
  currentStep?: ProcrastinationStep;
  goals: ProcrastinationGoal[];
  events: ProcrastinationEvent[];
};

export type ProcrastinationDayCount = {
  date: string;
  count: number;
};

export type ProcrastinationStats = {
  range: string;
  stepsCompleted: number;
  todayXP: number;
  rangeXP: number;
  streakDays: number;
  goalsCompleted: number;
  totalGoals: number;
  last7Days: ProcrastinationDayCount[];
};

export type ProcrastinationLedger = {
  totalXP: number;
  events: ProcrastinationEvent[];
};

export type ProcrastinationStepInput = {
  title: string;
  note?: string;
  estimatedMinutes: number;
  sortOrder?: number;
};

export type ProcrastinationGoalInput = {
  title: string;
  note?: string;
  deadline?: string;
  steps: ProcrastinationStepInput[];
};

export type ProcrastinationSuggestedStep = {
  title: string;
  estimatedMinutes: number;
};

export type ProcrastinationSuggestResult = {
  summary: string;
  steps: ProcrastinationSuggestedStep[];
};
