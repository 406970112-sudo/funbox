import { getAPIBaseUrl } from '@/lib/auth-api';
import type { ManagedFeature, UserRole } from '@/types/access';

type VisibleFeaturesResponse = {
  featureIds: string[];
};

export type MembershipFeatureMatrix = {
  id: string;
  name: string;
  roles: UserRole[];
};

type MembershipMatrixResponse = {
  features: MembershipFeatureMatrix[];
};

type ManagedFeaturesResponse = {
  features: ManagedFeature[];
};

export class AccessAPIError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = 'AccessAPIError';
    this.code = code;
    this.status = status;
  }
}

export async function getVisibleFeatureIDs(token: string | null) {
  const response = await requestAccessJSON<VisibleFeaturesResponse>(
    '/api/v1/features',
    withOptionalToken(token),
  );
  return response.featureIds;
}

export async function getMembershipFeatureMatrix(token: string) {
  const response = await requestAccessJSON<MembershipMatrixResponse>(
    '/api/v1/membership/features',
    withToken(token),
  );
  return response.features;
}

export async function getManagedFeatures(token: string) {
  const response = await requestAccessJSON<ManagedFeaturesResponse>(
    '/api/v1/admin/features',
    withToken(token),
  );
  return response.features;
}

export async function updateManagedFeatureRoles(
  token: string,
  featureID: string,
  roles: UserRole[],
) {
  const response = await requestAccessJSON<ManagedFeaturesResponse>(
    `/api/v1/admin/features/${encodeURIComponent(featureID)}/roles`,
    {
      body: JSON.stringify({ roles }),
      headers: {
        ...withToken(token).headers,
        'Content-Type': 'application/json',
      },
      method: 'PUT',
    },
  );
  return response.features;
}

export async function updateManagedFeatureGrant(
  token: string,
  featureID: string,
  username: string,
  granted: boolean,
) {
  const response = await requestAccessJSON<ManagedFeaturesResponse>(
    `/api/v1/admin/features/${encodeURIComponent(featureID)}/grants`,
    {
      body: JSON.stringify({ granted, username }),
      headers: {
        ...withToken(token).headers,
        'Content-Type': 'application/json',
      },
      method: 'PUT',
    },
  );
  return response.features;
}

export function getAccessErrorMessage(error: unknown) {
  if (!(error instanceof AccessAPIError)) {
    return '权限服务暂时不可用，请稍后重试。';
  }
  const messages: Record<string, string> = {
    admin_required: '当前账号没有管理员权限。',
    feature_not_found: '功能入口不存在或已下线。',
    user_not_found: '没有找到这个手机号对应的用户。',
  };
  return messages[error.code] || '权限配置保存失败，请稍后重试。';
}

async function requestAccessJSON<T>(path: string, options: RequestInit = {}) {
  const response = await fetch(`${getAPIBaseUrl()}${path}`, options);
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new AccessAPIError(payload.error || 'request_failed', response.status);
  }
  return payload;
}

function withToken(token: string): RequestInit {
  return { headers: { Authorization: `Bearer ${token}` } };
}

function withOptionalToken(token: string | null): RequestInit {
  return token ? withToken(token) : {};
}
