export type MembershipTier = 'vip' | 'svip';

export type MembershipPlan = {
  period: 'month';
  priceCents: number;
  tier: MembershipTier;
};

export type MembershipPaymentInfo = {
  enabled: boolean;
  note: string;
  plans: MembershipPlan[];
  qrUrl: string;
};

export type MembershipSettings = {
  enabled: boolean;
  note: string;
  qrUrl: string;
  svipPriceCents: number;
  updatedAt: string;
  updatedByName: string;
  updatedByUsername: string;
  vipPriceCents: number;
};

export type MembershipChange = {
  action: 'note_update' | 'qr_remove' | 'qr_upload';
  createdAt: string;
  detail: string;
  id: string;
  operatorDisplayName: string;
  operatorUsername: string;
};

export type AdminMembershipSettings = {
  changes: MembershipChange[];
  limit: number;
  offset: number;
  settings: MembershipSettings;
  total: number;
};

export type MembershipAsset = {
  fileName?: string | null;
  mimeType?: string;
  uri: string;
};
