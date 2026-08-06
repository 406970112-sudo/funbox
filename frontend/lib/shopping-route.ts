import type {
  ShoppingRoute,
  ShoppingZoneType,
} from '@/types/shopping-route';

export const ZONE_TYPE_OPTIONS: { value: ShoppingZoneType; label: string }[] = [
  { value: 'produce', label: '蔬菜水果' },
  { value: 'dairy', label: '冷藏冷冻' },
  { value: 'frozen', label: '冷冻食品' },
  { value: 'meat', label: '肉禽蛋' },
  { value: 'grain', label: '粮油调味' },
  { value: 'household', label: '日用品' },
  { value: 'personal', label: '个护清洁' },
  { value: 'snacks', label: '零食饮料' },
  { value: 'bakery', label: '烘焙' },
  { value: 'other', label: '其他' },
];

export function zoneTypeLabel(zoneType: ShoppingZoneType) {
  return ZONE_TYPE_OPTIONS.find((option) => option.value === zoneType)?.label ?? '其他';
}

export function sourceLabel(source: string) {
  const labels: Record<string, string> = {
    user: '用户录入',
    'cooking-guide': '菜谱导入',
    openfoodfacts: 'Open Food Facts',
    verified: '已核实映射',
    official: '门店官方',
  };
  return labels[source] ?? '已核实映射';
}

export function routeCompletenessLabel(route: ShoppingRoute | null | undefined) {
  if (!route) return '未生成路线';
  if (route.status === 'complete') return '已完成';
  const percent = Math.round(route.completeness * 100);
  if (route.unmappedCount > 0) return `${percent}% 已归位 · ${route.unmappedCount} 项未归位`;
  return `${percent}% 已归位`;
}

export function routeStopNames(route: ShoppingRoute) {
  const stops: string[] = [];
  for (const zoneGroup of route.zones) stops.push(zoneGroup.zone.name);
  return stops;
}
