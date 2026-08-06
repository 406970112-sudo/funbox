import type {
  LeftoverEvent,
  LeftoverHomePayload,
  LeftoverItem,
  LeftoverItemInput,
  LeftoverLocalState,
  LeftoverSettings,
  Recipe,
  RecipeMatch,
} from '../types/leftover-manager.ts';
import {
  createEmptyLeftoverLocalState,
  createEmptyLeftoverSettings,
  LEFTOVER_MAX_PHOTOS,
} from '../types/leftover-manager.ts';

export const INGREDIENT_TAG_OPTIONS = [
  '西红柿', '鸡蛋', '土豆', '午餐肉', '米饭', '面条', '猪肉', '牛肉', '鸡肉', '鱼',
  '虾', '西兰花', '黄瓜', '大蒜', '草莓', '酸奶', '牛奶', '豆腐', '蘑菇', '青椒',
] as const;

export const LEFT_OVER_RECIPE_LIBRARY: Recipe[] = [
  {
    id: 'tomato-scrambled-eggs', name: '西红柿炒鸡蛋',
    mainIngredients: [
      { keyword: '西红柿', label: '西红柿', quantity: '2 个' },
      { keyword: '鸡蛋', label: '鸡蛋', quantity: '3 个' },
    ],
    seasonings: ['食用油', '盐', '糖'], estimatedMinutes: 15,
    steps: ['西红柿切块，鸡蛋打散。', '热锅倒油，先炒鸡蛋后盛出。', '下西红柿炒出汁，加盐和糖调味。', '倒回鸡蛋翻匀即可。'],
    source: 'FunBox 家常菜谱库 V1',
  },
  {
    id: 'potato-luncheon-meat', name: '土豆午餐肉',
    mainIngredients: [
      { keyword: '土豆', label: '土豆', quantity: '2 个' },
      { keyword: '午餐肉', label: '午餐肉', quantity: '半盒' },
    ],
    seasonings: ['食用油', '盐', '生抽'], estimatedMinutes: 20,
    steps: ['土豆切小块，午餐肉切丁。', '锅中倒油，先煎土豆至边缘微黄。', '加入午餐肉炒香。', '加少量水焖熟，用盐和生抽调味。'],
    source: 'FunBox 家常菜谱库 V1',
  },
  {
    id: 'tomato-egg-fried-rice', name: '西红柿鸡蛋炒饭',
    mainIngredients: [
      { keyword: '米饭', label: '米饭', quantity: '1 碗' },
      { keyword: '西红柿', label: '西红柿', quantity: '1 个' },
      { keyword: '鸡蛋', label: '鸡蛋', quantity: '2 个' },
    ],
    seasonings: ['食用油', '盐'], estimatedMinutes: 18,
    steps: ['西红柿切丁，鸡蛋打散。', '炒熟鸡蛋后加入西红柿丁。', '倒入米饭炒散，加盐调味。'],
    source: 'FunBox 家常菜谱库 V1',
  },
  {
    id: 'luncheon-meat-fried-rice', name: '午餐肉炒饭',
    mainIngredients: [
      { keyword: '米饭', label: '米饭', quantity: '1 碗' },
      { keyword: '午餐肉', label: '午餐肉', quantity: '半盒' },
      { keyword: '鸡蛋', label: '鸡蛋', quantity: '1 个' },
    ],
    seasonings: ['食用油', '盐', '葱花'], estimatedMinutes: 15,
    steps: ['午餐肉切丁，鸡蛋打散。', '炒熟鸡蛋后加入午餐肉。', '倒入米饭炒散，加盐调味。'],
    source: 'FunBox 家常菜谱库 V1',
  },
  {
    id: 'garlic-broccoli', name: '蒜蓉西兰花',
    mainIngredients: [
      { keyword: '西兰花', label: '西兰花', quantity: '1 颗' },
      { keyword: '大蒜', label: '大蒜', quantity: '3 瓣' },
    ],
    seasonings: ['食用油', '盐'], estimatedMinutes: 12,
    steps: ['西兰花掰小朵，焯水后捞出。', '热锅倒油，下蒜末炒香。', '倒入西兰花翻炒，加盐出锅。'],
    source: 'FunBox 家常菜谱库 V1',
  },
  {
    id: 'cucumber-garlic-salad', name: '凉拌黄瓜',
    mainIngredients: [
      { keyword: '黄瓜', label: '黄瓜', quantity: '1 根' },
      { keyword: '大蒜', label: '大蒜', quantity: '2 瓣' },
    ],
    seasonings: ['醋', '生抽', '香油', '盐'], estimatedMinutes: 10,
    steps: ['黄瓜拍碎切段。', '加蒜末、醋、生抽、香油和盐拌匀。'],
    source: 'FunBox 家常菜谱库 V1',
  },
  {
    id: 'braised-pork-fried-rice', name: '红烧肉炒饭',
    mainIngredients: [
      { keyword: '米饭', label: '米饭', quantity: '1 碗' },
      { keyword: '红烧肉', label: '红烧肉', quantity: '半碗' },
    ],
    seasonings: ['食用油', '盐'], estimatedMinutes: 12,
    steps: ['红烧肉切小块。', '热锅后放入红烧肉炒热。', '倒入米饭炒散，按口味加盐。'],
    source: 'FunBox 家常菜谱库 V1',
  },
  {
    id: 'strawberry-yogurt-bowl', name: '草莓酸奶碗',
    mainIngredients: [
      { keyword: '草莓', label: '草莓', quantity: '半盒' },
      { keyword: '酸奶', label: '酸奶', quantity: '1 杯' },
    ],
    seasonings: [], estimatedMinutes: 5,
    steps: ['草莓洗净切块。', '倒入酸奶，撒上草莓即可。'],
    source: 'FunBox 家常菜谱库 V1',
  },
];

export function newLeftoverID(prefix: string) {
  const randomPart =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${randomPart}_${Date.now().toString(36)}`;
}

export function sourceTypeLabel(sourceType: string) {
  return (
    { leftover: '剩菜', takeout: '外卖', opened: '开封食品', ingredient: '食材' }[sourceType] ??
    sourceType
  );
}

export function zoneLabel(zone: string) {
  return (
    { fridge: '冷藏', freezer: '冷冻', door: '冰箱门', drawer: '冷藏抽屉' }[zone] ?? zone
  );
}

export function statusLabel(status: string) {
  return { active: '待处理', eaten: '已吃完', discarded: '已丢弃' }[status] ?? status;
}

export function eventActionLabel(eventType: string) {
  return (
    {
      created: '创建', edited: '编辑', reheated: '加热',
      eaten: '吃完', discarded: '丢弃', deleted: '删除',
    }[eventType] ?? eventType
  );
}

export function reheatLabel(count: number) {
  if (count <= 0) return '未加热';
  if (count === 1) return '已加热 1 次';
  return `已加热 ${count} 次`;
}

export function formatLeftoverTime(value?: number) {
  if (!value || !Number.isFinite(value)) return '暂无';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '暂无';
  return date.toLocaleString('zh-CN', {
    hour12: false,
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

export function deadlineLabel(item: LeftoverItem, now: number) {
  if (!item.expectedConsumeAt) return '未设置期限';
  if (item.expectedConsumeAt < now) return '已过期';
  const hours = Math.max(0, Math.ceil((item.expectedConsumeAt - now) / 3600000));
  const time = new Date(item.expectedConsumeAt);
  const short = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;
  if (hours <= 24) return `今天 ${short} 前`;
  if (hours <= 48) return `明天 ${short} 前`;
  return `${formatLeftoverTime(item.expectedConsumeAt)} 前`;
}

export function remainingLabel(item: LeftoverItem) {
  return item.remainingText || `${item.remainingPercent}%`;
}

export function validateLeftoverItemInput(input: LeftoverItemInput): string | null {
  const name = input.name.trim();
  if (!name || Array.from(name).length > 40) return '名称需为 1-40 个字符';
  if (!['leftover', 'takeout', 'opened', 'ingredient'].includes(input.sourceType)) return '请选择真实来源类型';
  if (Array.from(input.merchant.trim()).length > 30) return '商家不能超过 30 个字符';
  if (!input.enteredFridgeAt || input.expectedConsumeAt <= input.enteredFridgeAt) {
    return '预计食用期限必须晚于入冰箱时间';
  }
  if (!['fridge', 'freezer', 'door', 'drawer'].includes(input.storedZone)) return '请选择存放位置';
  if (input.remainingPercent < 1 || input.remainingPercent > 100) return '剩余分量需在 1%-100% 之间';
  if (Array.from(input.remainingText.trim()).length > 20) return '分量说明不能超过 20 个字符';
  if (input.reheatCount < 0 || input.reheatCount > 20) return '加热次数无效';
  if (input.costCents < 0) return '成本金额不能为负数';
  if (Array.from(input.notes.trim()).length > 60) return '备注不能超过 60 个字符';
  if (input.tags.length > 8 || input.tags.some((tag) => Array.from(tag.trim()).length > 8)) {
    return '最多 8 个食材标签，每个不超过 8 个字符';
  }
  return null;
}

export function buildLocalHome(state: LeftoverLocalState, now = Date.now()): LeftoverHomePayload {
  const active = state.items
    .filter((item) => item.status === 'active')
    .sort((left, right) => left.expectedConsumeAt - right.expectedConsumeAt);
  return {
    summary: buildLocalSummary(state, now),
    priority: active,
    suggestions: buildLocalSuggestions(state.items, now),
    serverNow: now,
    settings: state.settings,
  };
}

export function buildLocalHistory(state: LeftoverLocalState, now = Date.now()) {
  return {
    items: state.items
      .filter((item) => item.status === 'eaten' || item.status === 'discarded')
      .sort((left, right) => right.updatedAt - left.updatedAt),
    summary: buildLocalSummary(state, now),
    serverNow: now,
  };
}

export function buildLocalSummary(state: LeftoverLocalState, now: number) {
  const weekStart = now - 7 * 24 * 60 * 60 * 1000;
  const summary = {
    activeCount: 0, todayCount: 0, expiredCount: 0,
    thisWeekEaten: 0, thisWeekDiscarded: 0, avoidWasteCents: 0, wasteCents: 0,
  };
  for (const item of state.items) {
    if (item.status === 'active') {
      summary.activeCount += 1;
      if (item.expectedConsumeAt < now) summary.expiredCount += 1;
      if (item.expectedConsumeAt <= now + 24 * 60 * 60 * 1000) summary.todayCount += 1;
    }
    if (item.status === 'eaten') {
      if (item.eatenAt && item.eatenAt >= weekStart) summary.thisWeekEaten += 1;
      summary.avoidWasteCents += item.costCents;
    }
    if (item.status === 'discarded') {
      if (item.discardedAt && item.discardedAt >= weekStart) summary.thisWeekDiscarded += 1;
      summary.wasteCents += item.costCents;
    }
  }
  return summary;
}

export function localAddItem(
  state: LeftoverLocalState,
  input: LeftoverItemInput,
): { state: LeftoverLocalState; item: LeftoverItem | null; error: string | null } {
  const error = validateLeftoverItemInput(input);
  if (error) return { state, item: null, error };
  const name = input.name.trim();
  if (state.items.some((item) => item.status === 'active' && item.name === name)) {
    return { state, item: null, error: `${name} 已存在` };
  }
  const now = Date.now();
  const item: LeftoverItem = {
    id: newLeftoverID('local_item'), userId: state.settings.userId, name,
    sourceType: input.sourceType, merchant: input.merchant.trim(),
    enteredFridgeAt: input.enteredFridgeAt, expectedConsumeAt: input.expectedConsumeAt,
    storedZone: input.storedZone, remainingPercent: input.remainingPercent,
    remainingText: input.remainingText.trim(), reheatCount: input.reheatCount,
    tags: [...input.tags], costCents: input.costCents, notes: input.notes.trim(),
    status: 'active', photoCount: 0, createdAt: now, updatedAt: now,
  };
  const event: LeftoverEvent = {
    id: newLeftoverID('event'), itemId: item.id, userId: item.userId,
    eventType: 'created', note: '', happenedAt: now,
  };
  return {
    state: touchLocalState({ ...state, items: [...state.items, item], events: [event, ...state.events] }),
    item,
    error: null,
  };
}

export function localUpdateItem(
  state: LeftoverLocalState,
  itemId: string,
  input: LeftoverItemInput,
): { state: LeftoverLocalState; item: LeftoverItem | null; error: string | null } {
  const current = state.items.find((item) => item.id === itemId);
  if (!current) return { state, item: null, error: '记录不存在' };
  const error = validateLeftoverItemInput(input);
  if (error) return { state, item: null, error };
  const name = input.name.trim();
  if (state.items.some((item) => item.id !== itemId && item.status === 'active' && item.name === name)) {
    return { state, item: null, error: `${name} 已存在` };
  }
  const now = Date.now();
  const updated: LeftoverItem = {
    ...current, name,
    sourceType: input.sourceType, merchant: input.merchant.trim(),
    enteredFridgeAt: input.enteredFridgeAt, expectedConsumeAt: input.expectedConsumeAt,
    storedZone: input.storedZone, remainingPercent: input.remainingPercent,
    remainingText: input.remainingText.trim(), reheatCount: input.reheatCount,
    tags: [...input.tags], costCents: input.costCents, notes: input.notes.trim(),
    updatedAt: now,
  };
  const event: LeftoverEvent = {
    id: newLeftoverID('event'), itemId, userId: current.userId,
    eventType: 'edited', note: '', happenedAt: now,
  };
  return {
    state: touchLocalState({
      ...state,
      items: state.items.map((item) => (item.id === itemId ? updated : item)),
      events: [event, ...state.events],
    }),
    item: updated,
    error: null,
  };
}

export function localDeleteItem(state: LeftoverLocalState, itemId: string) {
  const item = state.items.find((candidate) => candidate.id === itemId);
  if (!item) return state;
  const now = Date.now();
  const event: LeftoverEvent = {
    id: newLeftoverID('event'), itemId, userId: item.userId,
    eventType: 'deleted', note: '', happenedAt: now,
  };
  const localPhotos = { ...state.localPhotos };
  delete localPhotos[itemId];
  return touchLocalState({
    ...state,
    items: state.items.filter((candidate) => candidate.id !== itemId),
    events: [event, ...state.events],
    localPhotos,
  });
}

export function localReheat(state: LeftoverLocalState, itemId: string) {
  const current = state.items.find((item) => item.id === itemId);
  if (!current || current.status !== 'active') return { state, item: current ?? null };
  const now = Date.now();
  const updated = { ...current, reheatCount: current.reheatCount + 1, updatedAt: now };
  return {
    state: touchLocalState({
      ...state,
      items: state.items.map((item) => (item.id === itemId ? updated : item)),
      events: [makeEvent(itemId, current.userId, 'reheated', '', now), ...state.events],
    }),
    item: updated,
  };
}

export function localEat(state: LeftoverLocalState, itemId: string) {
  const current = state.items.find((item) => item.id === itemId);
  if (!current || current.status !== 'active') return { state, item: current ?? null };
  const now = Date.now();
  const updated = { ...current, status: 'eaten' as const, eatenAt: now, updatedAt: now };
  return {
    state: touchLocalState({
      ...state,
      items: state.items.map((item) => (item.id === itemId ? updated : item)),
      events: [makeEvent(itemId, current.userId, 'eaten', '', now), ...state.events],
    }),
    item: updated,
  };
}

export function localDiscard(state: LeftoverLocalState, itemId: string, reason: string) {
  const current = state.items.find((item) => item.id === itemId);
  if (!current || current.status !== 'active') return { state, item: current ?? null };
  if (!reason.trim()) return { state, item: current, error: '请选择或填写丢弃原因' };
  const now = Date.now();
  const updated = {
    ...current,
    status: 'discarded' as const,
    discardedAt: now,
    discardReason: reason.trim(),
    updatedAt: now,
  };
  return {
    state: touchLocalState({
      ...state,
      items: state.items.map((item) => (item.id === itemId ? updated : item)),
      events: [makeEvent(itemId, current.userId, 'discarded', reason.trim(), now), ...state.events],
    }),
    item: updated,
    error: null,
  };
}

export function localAddPhoto(state: LeftoverLocalState, itemId: string, uri: string) {
  const current = state.items.find((item) => item.id === itemId);
  if (!current) return { state, error: '记录不存在' };
  const photos = state.localPhotos[itemId] ?? [];
  if (photos.length >= LEFTOVER_MAX_PHOTOS) return { state, error: '最多 3 张真实照片' };
  const nextPhotos = [...photos, uri];
  const updated = { ...current, photoCount: nextPhotos.length, updatedAt: Date.now() };
  return {
    state: touchLocalState({
      ...state,
      items: state.items.map((item) => (item.id === itemId ? updated : item)),
      localPhotos: { ...state.localPhotos, [itemId]: nextPhotos },
    }),
    error: null,
  };
}

export function localDeletePhoto(state: LeftoverLocalState, itemId: string, index: number) {
  const nextPhotos = (state.localPhotos[itemId] ?? []).filter((_, photoIndex) => photoIndex !== index);
  const localPhotos = { ...state.localPhotos };
  if (nextPhotos.length === 0) delete localPhotos[itemId];
  else localPhotos[itemId] = nextPhotos;
  const current = state.items.find((item) => item.id === itemId);
  const updated = current ? { ...current, photoCount: nextPhotos.length, updatedAt: Date.now() } : current;
  return touchLocalState({
    ...state,
    items: updated ? state.items.map((item) => (item.id === itemId ? updated : item)) : state.items,
    localPhotos,
  });
}

export function localUpdateSettings(state: LeftoverLocalState, settings: LeftoverSettings) {
  return touchLocalState({ ...state, settings: { ...settings, updatedAt: Date.now() } });
}

export function localClearState() {
  return createEmptyLeftoverLocalState();
}

export function buildLocalSuggestions(items: LeftoverItem[], now = Date.now()): RecipeMatch[] {
  const matches: RecipeMatch[] = [];
  for (const recipe of LEFT_OVER_RECIPE_LIBRARY) {
    const match = matchLocalRecipe(recipe, items, now);
    if (match) matches.push(match);
  }
  matches.sort((left, right) => {
    const leftScore = left.matchPercent + left.expiringCount * 10;
    const rightScore = right.matchPercent + right.expiringCount * 10;
    if (leftScore !== rightScore) return rightScore - leftScore;
    return left.estimatedMinutes - right.estimatedMinutes;
  });
  return matches.slice(0, 3);
}

export function normalizeLeftoverLocalState(value: LeftoverLocalState): LeftoverLocalState {
  return {
    ...createEmptyLeftoverLocalState(),
    ...value,
    items: Array.isArray(value.items) ? value.items : [],
    events: Array.isArray(value.events) ? value.events : [],
    localPhotos: value.localPhotos && typeof value.localPhotos === 'object' ? value.localPhotos : {},
    settings: value.settings ?? createEmptyLeftoverSettings(),
  };
}

function matchLocalRecipe(recipe: Recipe, items: LeftoverItem[], now: number): RecipeMatch | null {
  const matchedItems: RecipeMatch['matchedItems'] = [];
  const missing: string[] = [];
  const seen = new Set<string>();
  let matchedCount = 0;
  let expiringCount = 0;
  for (const ingredient of recipe.mainIngredients) {
    let found = false;
    for (const item of items) {
      if (item.status !== 'active' || item.remainingPercent <= 0) continue;
      if (!item.name.includes(ingredient.keyword) && !item.tags.some((tag) => tag.includes(ingredient.keyword))) continue;
      found = true;
      matchedCount += 1;
      if (!seen.has(item.id)) {
        const expiring = item.expectedConsumeAt <= now + 24 * 60 * 60 * 1000;
        matchedItems.push({
          itemId: item.id, name: item.name, remainingText: item.remainingText, expiringWithin: expiring,
        });
        seen.add(item.id);
        if (expiring) expiringCount += 1;
      }
      break;
    }
    if (!found) missing.push(`${ingredient.label} ${ingredient.quantity}`);
  }
  if (matchedCount === 0) return null;
  return {
    recipeId: recipe.id, name: recipe.name,
    matchPercent: Math.round((matchedCount * 100) / recipe.mainIngredients.length),
    matchedCount, totalCount: recipe.mainIngredients.length,
    estimatedMinutes: recipe.estimatedMinutes, source: recipe.source,
    matchedItems, missing, expiringCount,
  };
}

function makeEvent(itemId: string, userId: string, eventType: string, note: string, happenedAt: number): LeftoverEvent {
  return {
    id: newLeftoverID('event'), itemId, userId, eventType, note, happenedAt,
  };
}

function touchLocalState(state: LeftoverLocalState): LeftoverLocalState {
  return { ...state, updatedAt: Date.now() };
}
