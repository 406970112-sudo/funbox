import { getAPIBaseUrl, resolveAvatarURL } from '@/lib/auth-api';
import { buildAdminUsersQuery, type AdminUsersQuery } from '@/lib/admin-users';
import type { UserRole } from '@/types/access';
import type {
  AdminUserDetail,
  AdminUserRoleChangesPage,
  AdminUsersPage,
} from '@/types/admin-user';

type AdminUserResponse = { user: AdminUserDetail };
type UpdateRoleResponse = AdminUserResponse & { changed: boolean };

export class AdminUsersAPIError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = 'AdminUsersAPIError';
    this.code = code;
    this.status = status;
  }
}

export async function listAdminUsers(token: string, options: AdminUsersQuery) {
  const response = await requestAdminUsersJSON<AdminUsersPage>(
    `/api/v1/admin/users${buildAdminUsersQuery(options)}`,
    token,
  );
  return {
    ...response,
    users: response.users.map((account) => ({
      ...account,
      avatarUrl: resolveAvatarURL(account.avatarUrl),
    })),
  };
}

export async function getAdminUser(token: string, userId: string) {
  const response = await requestAdminUsersJSON<AdminUserResponse>(
    `/api/v1/admin/users/${encodeURIComponent(userId)}`,
    token,
  );
  return { ...response.user, avatarUrl: resolveAvatarURL(response.user.avatarUrl) };
}

export async function listAdminUserRoleChanges(token: string, userId: string) {
  return requestAdminUsersJSON<AdminUserRoleChangesPage>(
    `/api/v1/admin/users/${encodeURIComponent(userId)}/role-changes?limit=20&offset=0`,
    token,
  );
}

export async function updateAdminUserRole(
  token: string,
  userId: string,
  expectedRole: UserRole,
  role: Exclude<UserRole, 'admin'>,
  reason: string,
) {
  const response = await requestAdminUsersJSON<UpdateRoleResponse>(
    `/api/v1/admin/users/${encodeURIComponent(userId)}/role`,
    token,
    {
      body: JSON.stringify({ expectedRole, reason, role }),
      headers: { 'Content-Type': 'application/json' },
      method: 'PATCH',
    },
  );
  return {
    changed: response.changed,
    user: { ...response.user, avatarUrl: resolveAvatarURL(response.user.avatarUrl) },
  };
}

export function getAdminUsersErrorMessage(error: unknown) {
  if (!(error instanceof AdminUsersAPIError)) {
    return '用户身份服务暂时不可用，请稍后重试。';
  }
  const messages: Record<string, string> = {
    admin_required: '当前账号没有管理员权限。',
    invalid_role: '请选择可分配的用户身份。',
    protected_admin_role: '管理员身份受保护，不能在这里调整。',
    role_changed: '该用户身份已被其他管理员更新，已为你刷新最新数据。',
    role_change_reason_invalid: '调整原因不能超过 100 个字。',
    user_not_found: '该用户不存在或已被移除。',
  };
  return messages[error.code] || '用户身份操作失败，请稍后重试。';
}

async function requestAdminUsersJSON<T>(
  path: string,
  token: string,
  options: RequestInit = {},
) {
  const response = await fetch(`${getAPIBaseUrl()}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new AdminUsersAPIError(payload.error || 'request_failed', response.status);
  }
  return payload;
}
