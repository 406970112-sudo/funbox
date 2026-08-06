export type TimeCapsuleMode = 'personal' | 'joint';
export type TimeCapsuleStatus = 'draft' | 'sealed' | 'opened' | 'archived';
export type TimeCapsuleOpenRule = 'date' | 'birthday' | 'days_left' | 'focus_goal' | 'focus_task';
export type TimeCapsuleContentKind = 'text' | 'photo' | 'voice';

export type TimeCapsule = {
  id: string;
  creatorId: string;
  mode: TimeCapsuleMode;
  title: string;
  note: string;
  openRule: TimeCapsuleOpenRule;
  openAt?: string;
  openTimezone: string;
  linkedDaysLeftId?: string;
  linkedFocusGoalId?: string;
  linkedFocusTaskId?: string;
  status: TimeCapsuleStatus;
  sealedAt?: string;
  openedAt?: string;
  archivedAt?: string;
  contentCount: number;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
};

export type TimeCapsuleMember = {
  id: string;
  capsuleId: string;
  userId: string;
  displayName: string;
  username: string;
  avatarFile: string;
  role: 'creator' | 'participant';
  inviteStatus: 'pending' | 'accepted' | 'declined' | 'exited';
  invitedAt: string;
  acceptedAt?: string;
  declinedAt?: string;
  exitedAt?: string;
  contentCount: number;
  createdAt: string;
  updatedAt: string;
};

export type TimeCapsuleContent = {
  id: string;
  capsuleId: string;
  userId: string;
  kind: TimeCapsuleContentKind;
  textContent: string;
  mediaId?: string;
  mediaUrl?: string;
  fileName?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  durationMs?: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type TimeCapsuleCounts = {
  draft: number;
  sealed: number;
  opened: number;
  archived: number;
  invitations: number;
};

export type TimeCapsuleHome = {
  counts: TimeCapsuleCounts;
  capsules: TimeCapsule[];
  invitations: TimeCapsule[];
};

export type TimeCapsuleNotification = {
  id: string;
  capsuleId: string;
  title: string;
  type: string;
  read: boolean;
  createdAt: string;
};

export type TimeCapsuleDetail = {
  capsule: TimeCapsule;
  members: TimeCapsuleMember[];
  contents: TimeCapsuleContent[];
};

export type TimeCapsuleInput = {
  mode: TimeCapsuleMode;
  title: string;
  note?: string;
  openRule: TimeCapsuleOpenRule;
  openAt?: string;
  openTimezone?: string;
  linkedDaysLeftId?: string;
  linkedFocusGoalId?: string;
  linkedFocusTaskId?: string;
  friendId?: string;
};

export type TimeCapsuleContentInput = {
  kind: TimeCapsuleContentKind;
  textContent?: string;
  mediaId?: string;
};

export type TimeCapsuleMedia = {
  id: string;
  capsuleId: string;
  userId: string;
  kind: TimeCapsuleContentKind;
  fileName: string;
  mimeType: string;
  byteSize: number;
  width: number;
  height: number;
  durationMs: number;
  createdAt: string;
};

export type DaysLeftSource = {
  id: string;
  name: string;
  expiryDate: string;
};

export type FocusSource = {
  kind: 'goal' | 'task';
  id: string;
  title: string;
  done: boolean;
};
