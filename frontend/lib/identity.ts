import type { UserRole } from '../types/access.ts';
import type { AppIconName } from '../types/app.ts';

export type IdentityPresentation = {
  actionLabel: string;
  cardSubtitle: string;
  cardTitle: string;
  color: string;
  darkColor: string;
  description: string;
  icon: AppIconName;
  label: string;
  signature: string;
};

const identityPresentations: Record<UserRole, IdentityPresentation> = {
  normal: {
    actionLabel: '查看会员',
    cardSubtitle: '了解 VIP 与 SVIP 权益',
    cardTitle: '普通用户',
    color: '#7483a2',
    darkColor: '#9eacb9',
    description: '注册后的默认身份',
    icon: 'account-outline',
    label: '普通用户',
    signature: '欢迎回来，继续使用你的轻量工具箱。',
  },
  vip: {
    actionLabel: '查看权益',
    cardSubtitle: '专属工具已解锁，查看全部会员权益',
    cardTitle: 'VIP 会员 · 已生效',
    color: '#e8a33d',
    darkColor: '#f2c14e',
    description: '可访问配置给 VIP 的功能',
    icon: 'diamond-stone',
    label: 'VIP',
    signature: 'VIP 权益已生效，专属工具已为你解锁。',
  },
  svip: {
    actionLabel: '查看权益',
    cardSubtitle: '全部会员权益可用，查看完整权益列表',
    cardTitle: 'SVIP 会员 · 已生效',
    color: '#e8667a',
    darkColor: '#ff8ba3',
    description: '可访问配置给 SVIP 的功能',
    icon: 'crown-outline',
    label: 'SVIP',
    signature: 'SVIP 全权益生效，所有会员能力已解锁。',
  },
  admin: {
    actionLabel: '进入后台',
    cardSubtitle: '可管理入口权限、用户身份与内容',
    cardTitle: '管理员账号',
    color: '#151b3b',
    darkColor: '#c9f36a',
    description: '拥有管理后台权限',
    icon: 'shield-check-outline',
    label: '管理员',
    signature: '你拥有后台管理权限，可管理用户身份与入口权限。',
  },
};

export function identityPresentation(
  role: UserRole,
  colorScheme: 'dark' | 'light' = 'light',
) {
  const item = identityPresentations[role];
  return { ...item, color: colorScheme === 'dark' ? item.darkColor : item.color };
}

export function hasIdentityBadge(role: UserRole) {
  return role !== 'normal';
}

export function identityRoute(role: UserRole) {
  return role === 'admin' ? '/admin' : '/profile/membership';
}
