import type {
  GoOutCompletion,
  GoOutHomeItem,
  GoOutLocalState,
  GoOutSchedule,
  GoOutScene,
  GoOutSettings,
  GoOutTemplate,
  GoOutWeatherSuggestion,
  GoOutWeatherSnapshot,
} from '@/types/go-out-checklist';

export const GO_OUT_WEATHER_RULE_LABELS: Record<string, string> = {
  'rain-umbrella': '降雨概率 >= 40% 或当前有雨',
  'uv-protect': '当日最大 UV >= 6',
  'heat-water': '当日最高温 >= 32°C',
  'air-mask': '当前 EAQI > 100',
};

export const GO_OUT_TEMPLATES: GoOutTemplate[] = [
  {
    id: 'work',
    name: '上班模式',
    icon: 'briefcase',
    items: [
      { name: '手机', icon: 'smartphone' },
      { name: '钥匙', icon: 'key' },
      { name: '工牌', icon: 'id-card' },
      { name: '耳机', icon: 'headphones' },
    ],
  },
  {
    id: 'travel',
    name: '旅行模式',
    icon: 'luggage',
    items: [
      { name: '身份证', icon: 'id-card' },
      { name: '充电器', icon: 'battery-charging' },
      { name: '药品', icon: 'pill' },
      { name: '换洗衣物', icon: 'shirt' },
    ],
  },
  {
    id: 'sport',
    name: '运动模式',
    icon: 'dumbbell',
    items: [
      { name: '水杯', icon: 'cup', weatherRuleIds: ['heat-water'] },
      { name: '毛巾', icon: 'shirt' },
      { name: '耳机', icon: 'headphones' },
      { name: '门禁卡', icon: 'credit-card' },
    ],
  },
];

export function groupHomeItems(items: GoOutHomeItem[]) {
  return {
    essential: items.filter((item) => item.group === 'essential'),
    scene: items.filter((item) => item.group === 'scene'),
    weather: items.filter((item) => item.group === 'weather'),
    safety: items.filter((item) => item.group === 'safety'),
  };
}

export function completionResultText() {
  return '今日出门检查完成，没有遗漏。';
}

export function weatherRuleLabel(ruleId?: string) {
  if (!ruleId) return '';
  return GO_OUT_WEATHER_RULE_LABELS[ruleId] ?? ruleId;
}

export function formatGoOutTime(value: string | number | undefined) {
  if (!value) return '暂无';
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatGoOutDate(value: string | number | undefined) {
  if (!value) return '暂无';
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()];
  return `${date.getMonth() + 1}月${date.getDate()}日 ${week}`;
}

export function weatherStatusLabel(weather: GoOutWeatherSnapshot) {
  if (!weather.available) return weather.unavailableMsg || '天气暂未获取';
  return weather.status === 'partial' ? '部分可用' : '真实天气已更新';
}

export function scheduleDaysLabel(days: number[]) {
  const names = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  if (days.length === 7) return '每天';
  if (days.length === 5 && days.includes(1) && days.includes(2) && days.includes(3) && days.includes(4) && days.includes(5)) {
    return '工作日';
  }
  if (days.length === 2 && days.includes(0) && days.includes(6)) return '周末';
  return days.map((day) => names[day]).join('、');
}

export function scheduleLabel(schedule: GoOutSchedule) {
  return `${scheduleDaysLabel(schedule.daysOfWeek)} ${schedule.time}`;
}

export function resolveActiveScene(
  scenes: GoOutScene[],
  schedules: GoOutSchedule[],
  activeSceneId: string,
  now = new Date(),
) {
  const weekday = now.getDay();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  let best: { sceneId: string; minutes: number } | null = null;
  for (const schedule of schedules) {
    if (!schedule.enabled || !schedule.daysOfWeek.includes(weekday)) continue;
    const [hourText, minuteText] = schedule.time.split(':');
    const minutes = Number(hourText) * 60 + Number(minuteText);
    if (Number.isNaN(minutes)) continue;
    if (minutes <= currentMinutes && (!best || minutes > best.minutes)) {
      best = { sceneId: schedule.sceneId, minutes };
    }
  }
  const sceneId = best?.sceneId || activeSceneId;
  return scenes.some((scene) => scene.id === sceneId) ? sceneId : '';
}

export function localHistoryStats(
  records: GoOutCompletion[],
  now = new Date(),
) {
  const todayKey = dateKey(now);
  const weekStart = new Date(now);
  while (weekStart.getDay() !== 1) weekStart.setDate(weekStart.getDate() - 1);
  const weekKey = dateKey(weekStart);
  const seenDays = new Set<string>();
  let today = 0;
  let week = 0;
  for (const record of records) {
    const date = new Date(record.checkedAt);
    if (Number.isNaN(date.getTime())) continue;
    const key = dateKey(date);
    seenDays.add(key);
    if (key === todayKey) today += 1;
    if (key >= weekKey) week += 1;
  }
  let streak = 0;
  let cursor = new Date(now);
  if (!seenDays.has(dateKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (seenDays.has(dateKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return { today, week, streak, total: records.length };
}

export function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function emptyGoOutSettings(): GoOutSettings {
  return {
    city: '',
    lat: 0,
    lon: 0,
    timezone: 'Asia/Shanghai',
    weatherEnabled: false,
    activeSceneId: '',
    notificationEnabled: false,
    updatedAt: 0,
  };
}

export function weatherSourceText(weather: GoOutWeatherSnapshot) {
  if (!weather.available) return '暂无真实天气';
  return `${weather.source || 'Open-Meteo'} · ${formatGoOutTime(weather.fetchedAt)}`;
}

export function buildLocalHomeItems(
  state: GoOutLocalState,
  activeSceneId: string,
  weather: GoOutWeatherSnapshot,
): GoOutHomeItem[] {
  const sceneItemIds = new Set(
    state.sceneItems
      .filter((link) => link.sceneId === activeSceneId)
      .map((link) => link.itemId),
  );
  return state.items
    .map((item) => {
      const ruleHit = matchingLocalRule(item.weatherRuleIds ?? [], weather);
      const base: GoOutHomeItem = {
        ...item,
        group: item.itemType === 'safety' ? 'safety' : 'essential',
      };
      if (item.itemType === 'safety') return base;
      if (ruleHit) {
        const weatherItem: GoOutHomeItem = {
          ...base,
          group: 'weather',
          weatherRuleId: ruleHit,
          weatherReason: weatherRuleLabel(ruleHit),
        };
        return weatherItem;
      }
      if (sceneItemIds.has(item.id)) {
        const sceneItem: GoOutHomeItem = { ...base, group: 'scene', sceneId: activeSceneId };
        return sceneItem;
      }
      return base;
    })
    .sort((a, b) => {
      const order: Record<string, number> = {
        essential: 0,
        scene: 1,
        weather: 2,
        safety: 3,
      };
      return order[a.group] - order[b.group] || a.createdAt - b.createdAt;
    });
}

export function buildLocalWeatherSuggestions(
  items: GoOutLocalState['items'],
  weather: GoOutWeatherSnapshot,
): GoOutWeatherSuggestion[] {
  if (!weather.available) return [];
  const names: Record<string, string> = {
    'rain-umbrella': '雨伞',
    'uv-protect': '防晒霜',
    'heat-water': '水杯',
    'air-mask': '口罩',
  };
  const existing = new Set(items.flatMap((item) => item.weatherRuleIds ?? []));
  return Object.entries(names)
    .filter(([rule]) => !existing.has(rule) && matchingLocalRule([rule], weather))
    .map(([rule, name]) => ({
      ruleId: rule,
      name,
      reason: weatherRuleLabel(rule),
    }));
}

export function matchingLocalRule(
  ruleIds: string[],
  weather: GoOutWeatherSnapshot,
) {
  if (!weather.available) return '';
  for (const rule of ruleIds) {
    const hit =
      (rule === 'rain-umbrella' && (weather.precipProb ?? 0) >= 40) ||
      (rule === 'uv-protect' && (weather.uvIndex ?? 0) >= 6) ||
      (rule === 'heat-water' && (weather.temperature ?? 0) >= 32) ||
      (rule === 'air-mask' && (weather.aqi ?? 0) > 100);
    if (hit) return rule;
  }
  return '';
}
