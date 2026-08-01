import type { UserRole } from '../types/access.ts';
import { identityPresentation } from './identity.ts';

export type AdminUsersQuery = {
  limit: number;
  offset: number;
  query?: string;
  role?: UserRole | '';
};

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
  const item = identityPresentation(role, colorScheme);
  return { color: item.color, icon: item.icon, label: item.label };
}
