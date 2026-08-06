import type MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps } from 'react';

import type { WhereIsItCategory, WhereIsItItem } from '../types/where-is-it.ts';
import { WHERE_IS_IT_CATEGORIES } from '../types/where-is-it.ts';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

const ROOM_ICONS: Record<string, IconName> = {
  'door-open': 'door-open',
  sofa: 'sofa',
  utensils: 'silverware-fork-knife',
  'chef-hat': 'chef-hat',
  bed: 'bed',
  'notebook-pen': 'notebook-edit-outline',
  bath: 'bathtub-outline',
  'flower-2': 'flower-outline',
  warehouse: 'warehouse',
  home: 'home-outline',
};

export function roomIconName(icon: string): IconName {
  return ROOM_ICONS[icon] ?? 'home-outline';
}

export function categoriesForPicker(): WhereIsItCategory[] {
  return [...WHERE_IS_IT_CATEGORIES];
}

export function parseTags(text: string): string[] {
  return text
    .split(/[,，、\s]+/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 8);
}

export function tagsText(tags: string[]): string {
  return tags.join('、');
}

export function formatWhereIsItTime(value?: string): string {
  if (!value) return '暂无';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function lastSeenLabel(item: WhereIsItItem): string {
  return item.lastSeenAt ? formatWhereIsItTime(item.lastSeenAt) : '暂无确认记录';
}

export function unconfirmedLabel(days: number): string {
  if (days <= 0) return '最近已确认';
  if (days >= 180) return '已 180+ 天未确认';
  return `已 ${days} 天未确认`;
}

export function locationLabel(item: WhereIsItItem): string {
  return `${item.roomName} · ${item.locationDetail}`;
}

export function eventActionLabel(action: string): string {
  return action === 'move' ? '移动位置' : action === 'confirm' ? '确认还在' : action;
}

export function sortOptions() {
  return [
    { value: 'updated', label: '最近移动' },
    { value: 'created', label: '最近新增' },
    { value: 'confirmed', label: '最近确认' },
    { value: 'name', label: '名称排序' },
  ] as const;
}
