import type { UserRole } from '@/types/access';

export type AdminUserSummary = {
  avatarUrl: string;
  createdAt: string;
  displayName: string;
  id: string;
  maskedUsername: string;
  role: UserRole;
  updatedAt: string;
};

export type AdminUserDetail = Omit<AdminUserSummary, 'maskedUsername'> & {
  username: string;
};

export type AdminUserRoleChange = {
  createdAt: string;
  fromRole: UserRole;
  id: string;
  operatorDisplayName: string;
  operatorId: string;
  operatorMaskedUsername: string;
  reason: string;
  toRole: UserRole;
};

export type AdminUsersPage = {
  limit: number;
  offset: number;
  total: number;
  users: AdminUserSummary[];
};

export type AdminUserRoleChangesPage = {
  changes: AdminUserRoleChange[];
  limit: number;
  offset: number;
  total: number;
};
