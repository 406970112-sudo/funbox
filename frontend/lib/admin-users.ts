import type { UserRole } from '../types/access.ts';

export type AdminUsersQuery = {
  limit: number;
  offset: number;
  query?: string;
  role?: UserRole | '';
};

const rolePresentations = {
  admin: { color: '#151b3b', icon: 'shield-check-outline', label: '管理员' },
  normal: { color: '#7483a2', icon: 'account-outline', label: '普通用户' },
  svip: { color: '#e8667a', icon: 'crown-outline', label: 'SVIP' },
  vip: { color: '#4b6bff', icon: 'diamond-stone', label: 'VIP' },
} as const;

export function buildAdminUsersQuery(options: AdminUsersQuery) {
  const params = new URLSearchParams();
  const query = options.query?.trim();
  if (query) params.set('q', query);
  if (options.role) params.set('role', options.role);
  params.set('limit', String(options.limit));
  params.set('offset', String(options.offset));
  return `?${params.toString()}`;
}

export function maskUsername(username: string) {
  const normalized = username.trim();
  if (/^\d{11}$/.test(normalized)) {
    return `${normalized.slice(0, 3)}****${normalized.slice(7)}`;
  }
  if (normalized.length <= 2) return '*'.repeat(normalized.length);
  return `${normalized.slice(0, 1)}${'*'.repeat(normalized.length - 2)}${normalized.slice(-1)}`;
}

export function rolePresentation(role: UserRole, colorScheme: 'dark' | 'light' = 'light') {
  if (role === 'admin' && colorScheme === 'dark') {
    return { ...rolePresentations.admin, color: '#c9f36a' as const };
  }
  return rolePresentations[role];
}
