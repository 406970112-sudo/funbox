export type QuietHomeTripStatus = 'active' | 'checked_in' | 'cancelled' | 'expired';
export type QuietHomeContactStatus = '' | 'pending' | 'agreed' | 'declined' | 'removed';
export type QuietHomeNotificationType =
  | 'self_reminder'
  | 'contact_reminder'
  | 'safe_arrival'
  | 'cancel';
export type QuietHomeNotificationStatus = 'pending' | 'sent' | 'failed';

export type QuietHomeTrip = {
  id: string;
  userId: string;
  originLabel: string;
  destinationLabel: string;
  etaAt: string;
  graceMinutes: number;
  selfReminderEnabled: boolean;
  contactReminderEnabled: boolean;
  arrivalDetectionEnabled: boolean;
  lateSnapshotEnabled: boolean;
  contactUserId?: string;
  status: QuietHomeTripStatus;
  createdAt: string;
  updatedAt: string;
  checkedInAt?: string;
  cancelledAt?: string;
  lateMinutes?: number;
};

export type QuietHomeContact = {
  id: string;
  username: string;
  displayName: string;
  avatarFile?: string;
  status: QuietHomeContactStatus;
  agreedAt?: string;
};

export type QuietHomeNotification = {
  id: string;
  tripId: string;
  type: QuietHomeNotificationType;
  targetUserId?: string;
  channel: string;
  status: QuietHomeNotificationStatus;
  scheduledAt: string;
  sentAt?: string;
  error?: string;
};

export type QuietHomeHistoryRecord = {
  id: string;
  createdAt: string;
  originLabel: string;
  destinationLabel: string;
  etaAt: string;
  checkedInAt?: string;
  cancelledAt?: string;
  lateMinutes?: number;
  contactNotified: boolean;
};

export type QuietHomeSettings = {
  id: string;
  userId: string;
  defaultHome: string;
  graceMinutes: number;
  selfReminderEnabled: boolean;
  contactReminderEnabled: boolean;
  lateSnapshotEnabled: boolean;
  retentionDays: number;
  updatedAt: number;
};

export type QuietHomeLocationEvent = {
  id: string;
  tripId: string;
  usedAt: string;
  purpose: string;
  snapshot: boolean;
};

export type QuietHomePrivacyStatus = {
  notificationEnabled: boolean;
  locationUsed: boolean;
  contactCount: number;
  retentionDays: number;
  locationEvents: QuietHomeLocationEvent[];
};

export type QuietHomeState = {
  activeTrip: QuietHomeTrip | null;
  contacts: QuietHomeContact[];
  notifications: QuietHomeNotification[];
  settings: QuietHomeSettings;
  privacy: QuietHomePrivacyStatus;
};

export type QuietHomeCreateTripInput = {
  originLabel: string;
  destinationLabel: string;
  etaAt: string;
  graceMinutes: number;
  selfReminderEnabled?: boolean;
  contactReminderEnabled?: boolean;
  arrivalDetectionEnabled?: boolean;
  lateSnapshotEnabled?: boolean;
  contactUserId?: string;
};

export type QuietHomeUpdateTripInput = {
  etaAt?: string;
  graceMinutes?: number;
  selfReminderEnabled?: boolean;
  contactReminderEnabled?: boolean;
  arrivalDetectionEnabled?: boolean;
  lateSnapshotEnabled?: boolean;
  contactUserId?: string;
};
