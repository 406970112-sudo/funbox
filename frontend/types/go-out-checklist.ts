export type GoOutItemType = 'item' | 'safety';

export type GoOutItem = {
  id: string;
  name: string;
  icon: string;
  itemType: GoOutItemType;
  weatherRuleIds?: string[];
  createdAt: number;
  updatedAt: number;
};

export type GoOutScene = {
  id: string;
  userId: string;
  name: string;
  icon: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
};

export type GoOutSceneItem = {
  sceneId: string;
  itemId: string;
  position: number;
};

export type GoOutSchedule = {
  id: string;
  sceneId: string;
  daysOfWeek: number[];
  time: string;
  enabled: boolean;
};

export type GoOutSettings = {
  city: string;
  lat: number;
  lon: number;
  timezone: string;
  weatherEnabled: boolean;
  activeSceneId: string;
  notificationEnabled: boolean;
  updatedAt: number;
};

export type GoOutSettingsPayload = {
  settings: GoOutSettings;
  schedules: GoOutSchedule[];
};

export type GoOutConfirmedItem = {
  id: string;
  name: string;
  weather: boolean;
  reason?: string;
};

export type GoOutWeatherSnapshot = {
  available: boolean;
  status: string;
  city?: string;
  temperature?: number;
  feelsLike?: number;
  precipProb?: number;
  uvIndex?: number;
  aqi?: number;
  weatherCode?: number;
  source?: string;
  fetchedAt?: string;
  license?: string;
  ruleHits?: string[];
  unavailableMsg?: string;
};

export type GoOutCompletion = {
  id: string;
  sceneId: string;
  sceneName: string;
  checkedAt: string;
  confirmedItems: GoOutConfirmedItem[];
  weather: GoOutWeatherSnapshot;
  resultText: string;
};

export type GoOutHomeItem = GoOutItem & {
  group: 'essential' | 'scene' | 'weather' | 'safety';
  sceneId?: string;
  weatherRuleId?: string;
  weatherReason?: string;
};

export type GoOutWeatherSuggestion = {
  ruleId: string;
  name: string;
  reason: string;
};

export type GoOutHomeResponse = {
  items: GoOutHomeItem[];
  scenes: GoOutScene[];
  sceneItems: GoOutSceneItem[];
  schedules: GoOutSchedule[];
  activeSceneId: string;
  activeScene?: GoOutScene;
  weather: GoOutWeatherSnapshot;
  weatherSuggestions: GoOutWeatherSuggestion[];
  settings: GoOutSettings;
  serverNow: string;
  updatedAt: number;
};

export type GoOutTemplateItem = {
  name: string;
  icon: string;
  weatherRuleIds?: string[];
};

export type GoOutTemplate = {
  id: string;
  name: string;
  icon: string;
  items: GoOutTemplateItem[];
};

export type GoOutHistoryStats = {
  today: number;
  week: number;
  streak: number;
  total: number;
};

export type GoOutHistoryResponse = {
  records: GoOutCompletion[];
  stats: GoOutHistoryStats;
};

export type GoOutHealthSource = {
  source: string;
  status: string;
  lastFetchedAt?: string;
  message?: string;
};

export type GoOutHealth = {
  status: string;
  sources: GoOutHealthSource[];
  updatedAt: string;
};

export type GoOutCity = {
  name: string;
  country: string;
  admin1?: string;
  lat: number;
  lon: number;
};

export type GoOutItemInput = {
  name: string;
  icon: string;
  itemType: GoOutItemType;
  weatherRuleIds?: string[];
};

export type GoOutSceneInput = {
  name: string;
  icon: string;
  sortOrder: number;
  itemIds?: string[];
};

export type GoOutLocalState = {
  schemaVersion: number;
  items: GoOutItem[];
  scenes: GoOutScene[];
  sceneItems: GoOutSceneItem[];
  schedules: GoOutSchedule[];
  settings: GoOutSettings;
  completions: GoOutCompletion[];
  updatedAt: number;
};
