import type { UserRole } from '@/types/access';

export type AuthUser = {
  avatarUrl: string;
  createdAt: string;
  displayName: string;
  id: string;
  role: UserRole;
  username: string;
};

export type AuthSession = {
  accessToken: string;
  user: AuthUser;
};

export type AvatarAsset = {
  fileName?: string | null;
  mimeType?: string;
  uri: string;
};
