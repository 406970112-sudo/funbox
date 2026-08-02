export type DiaryMood = '' | 'happy' | 'calm' | 'tired' | 'sad' | 'angry';
export type DiaryWeather = '' | 'sunny' | 'cloudy' | 'rainy' | 'windy';

export type DiaryNotebook = {
  id: string;
  name: string;
  coverColor: string;
  hasPassword: boolean;
  passwordVersion: number;
  reminderEnabled: boolean;
  reminderTime: string;
  status: string;
  entryCount: number;
  lastEntryDate: string;
  currentStreak: number;
  createdAt: string;
  updatedAt: string;
};

export type DiaryMedia = {
  id: string;
  url: string;
  contentType: string;
  width: number;
  height: number;
};

export type DiaryEntry = {
  id: string;
  notebookId: string;
  date: string;
  title: string;
  content: string;
  mood: DiaryMood;
  weather: DiaryWeather;
  media: DiaryMedia[];
  createdAt: string;
  updatedAt: string;
};

export type DiaryDay = {
  date: string;
  mood: DiaryMood;
  count: number;
};

export type DiaryCalendar = {
  month: string;
  days: DiaryDay[];
};

export type DiaryDayCount = {
  date: string;
  count: number;
};

export type DiaryMoodCount = {
  mood: DiaryMood;
  count: number;
};

export type DiaryStats = {
  notebookId: string;
  entryCount: number;
  monthCount: number;
  currentStreak: number;
  last7Days: DiaryDayCount[];
  moods: DiaryMoodCount[];
};

export type DiaryNotebookInput = {
  name: string;
  coverColor?: string;
  password?: string;
  reminderEnabled?: boolean;
  reminderTime?: string;
};

export type DiaryPasswordInput = {
  action: 'set' | 'change' | 'remove';
  current?: string;
  new?: string;
};

export type DiaryEntryInput = {
  title?: string;
  content: string;
  mood?: DiaryMood;
  weather?: DiaryWeather;
};
