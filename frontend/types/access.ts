export type UserRole = 'normal' | 'vip' | 'svip' | 'admin';

export type FeatureGrant = {
  displayName: string;
  role: UserRole;
  username: string;
};

export type ManagedFeature = {
  category: string;
  grantCount: number;
  grants: FeatureGrant[];
  id: string;
  name: string;
  roles: UserRole[];
  route: string;
};
