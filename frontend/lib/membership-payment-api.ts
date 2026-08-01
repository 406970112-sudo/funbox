import { Platform } from 'react-native';

import { getAPIBaseUrl, resolveAvatarURL } from '@/lib/auth-api';
import type {
  AdminMembershipSettings,
  MembershipAsset,
  MembershipPaymentInfo,
  MembershipSettings,
} from '@/types/membership';

type APIErrorPayload = {
  error?: string;
};

type SettingsEnvelope = {
  settings: MembershipSettings;
};

export class MembershipPaymentAPIError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = 'MembershipPaymentAPIError';
    this.code = code;
    this.status = status;
  }
}

export async function getMembershipPaymentInfo(token: string) {
  const response = await requestMembershipJSON<MembershipPaymentInfo>(
    '/api/v1/membership/payment',
    token,
  );
  return { ...response, qrUrl: resolveAvatarURL(response.qrUrl) };
}

export async function getAdminMembershipSettings(token: string) {
  const response = await requestMembershipJSON<AdminMembershipSettings>(
    '/api/v1/admin/membership/settings',
    token,
  );
  return {
    ...response,
    settings: withResolvedQR(response.settings),
  };
}

export async function uploadAdminPaymentQR(token: string, asset: MembershipAsset) {
  const formData = new FormData();
  const fileName = asset.fileName || `payment-qr.${asset.mimeType === 'image/png' ? 'png' : 'jpg'}`;

  if (Platform.OS === 'web') {
    const assetResponse = await fetch(asset.uri);
    formData.append('qr', await assetResponse.blob(), fileName);
  } else {
    formData.append(
      'qr',
      {
        name: fileName,
        type: asset.mimeType || 'image/jpeg',
        uri: asset.uri,
      } as never,
    );
  }

  const response = await requestMembershipJSON<SettingsEnvelope>(
    '/api/v1/admin/membership/payment/qr',
    token,
    {
      body: formData,
      method: 'POST',
    },
  );
  return withResolvedQR(response.settings);
}

export async function removeAdminPaymentQR(token: string) {
  const response = await requestMembershipJSON<SettingsEnvelope>(
    '/api/v1/admin/membership/payment/qr',
    token,
    { method: 'DELETE' },
  );
  return withResolvedQR(response.settings);
}

export async function updateAdminPaymentNote(token: string, note: string) {
  const response = await requestMembershipJSON<SettingsEnvelope>(
    '/api/v1/admin/membership/payment/note',
    token,
    {
      body: JSON.stringify({ note }),
      headers: { 'Content-Type': 'application/json' },
      method: 'PUT',
    },
  );
  return withResolvedQR(response.settings);
}

export function getMembershipPaymentErrorMessage(error: unknown) {
  if (!(error instanceof MembershipPaymentAPIError)) {
    return '会员收款服务暂时不可用，请稍后重试。';
  }
  const messages: Record<string, string> = {
    admin_required: '当前账号没有管理员权限。',
    membership_service_unavailable: '会员收款服务未启用。',
    payment_note_invalid: '支付说明需要填写 1 到 200 个字符。',
    payment_qr_read_failed: '收款码读取失败，请重新选择图片。',
    payment_qr_required: '请选择一张收款码图片。',
    payment_qr_too_large: '收款码图片不能超过 2 MB。',
    payment_qr_type_invalid: '收款码仅支持 JPG、PNG 或 WebP 格式。',
    unauthorized: '登录状态已失效，请重新登录。',
  };
  return messages[error.code] || '会员收款设置保存失败，请稍后重试。';
}

async function requestMembershipJSON<T>(
  path: string,
  token: string,
  options: RequestInit = {},
) {
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`${getAPIBaseUrl()}${path}`, { ...options, headers });
  const payload = (await response.json().catch(() => ({}))) as T & APIErrorPayload;
  if (!response.ok) {
    throw new MembershipPaymentAPIError(payload.error || 'request_failed', response.status);
  }
  return payload;
}

function withResolvedQR(settings: MembershipSettings): MembershipSettings {
  return { ...settings, qrUrl: resolveAvatarURL(settings.qrUrl) };
}
