export type FocusPriority = 'high' | 'medium' | 'low';
export type FocusRepeatRule = 'none' | 'daily' | 'weekly' | 'monthly';
export type FocusTaskStatus = 'open' | 'done' | 'archived';
export type FocusFrequency = 'daily' | 'weekly';

export type FocusList = {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
};

export type FocusTask = {
  id: string;
  listId: string;
  title: string;
  note: string;
  priority: FocusPriority;
  dueDate: string;
  dueTime: string;
  repeatRule: FocusRepeatRule;
  parentTaskId: string;
  status: FocusTaskStatus;
  completedAt?: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  subtasks: FocusTask[];
};

export type FocusGoal = {
  id: string;
  date: string;
  title: string;
  sourceTaskId: string;
  sortOrder: number;
  completed: boolean;
  completedAt?: string;
  createdAt: string;
};

export type FocusHabit = {
  id: string;
  name: string;
  icon: string;
  color: string;
  frequency: FocusFrequency;
  weekdays: number[];
  reminderTime: string;
  sortOrder: number;
  archived: boolean;
  streakDays: number;
  todayChecked: boolean;
  totalRecords: number;
  createdAt: string;
  updatedAt: string;
};

export type FocusHabitRecord = {
  id: string;
  habitId: string;
  recordDate: string;
  createdAt: string;
};

export type FocusProgress = {
  taskCompleted: number;
  taskTotal: number;
  goalCompleted: number;
  goalTotal: number;
  habitCompleted: number;
  habitTotal: number;
};

export type FocusToday = {
  date: string;
  tasks: FocusTask[];
  goals: FocusGoal[];
  habits: FocusHabit[];
  progress: FocusProgress;
};

export type FocusDayCount = {
  date: string;
  count: number;
};

export type FocusListCount = {
  listId: string;
  name: string;
  color: string;
  count: number;
};

export type FocusStats = {
  range: 'week' | 'month';
  taskCompleted: number;
  taskTotal: number;
  taskRate: number;
  goalCompleted: number;
  goalTotal: number;
  habitStreakMax: number;
  habitTotalRecords: number;
  last7Days: FocusDayCount[];
  byList: FocusListCount[];
};

export type FocusCalendar = {
  month: string;
  days: FocusDayCount[];
};

export type FocusTaskInput = {
  listId?: string;
  title: string;
  note?: string;
  priority?: FocusPriority;
  dueDate?: string;
  dueTime?: string;
  repeatRule?: FocusRepeatRule;
  parentTaskId?: string;
  status?: FocusTaskStatus;
  sortOrder?: number;
  subtasks?: {
    title: string;
    priority?: FocusPriority;
    dueDate?: string;
    dueTime?: string;
  }[];
};

export type FocusGoalInput = {
  date?: string;
  title: string;
  sourceTaskId?: string;
  sortOrder?: number;
  completed?: boolean;
};

export type FocusHabitInput = {
  name: string;
  icon?: string;
  color?: string;
  frequency: FocusFrequency;
  weekdays?: number[];
  reminderTime?: string;
  sortOrder?: number;
  archived?: boolean;
};

export type FocusListInput = {
  name: string;
  color?: string;
  sortOrder?: number;
  archived?: boolean;
};
