import type {
  QuietHomeContact,
  QuietHomeHistoryRecord,
  QuietHomeNotification,
  QuietHomeNotificationType,
  QuietHomeSettings,
  QuietHomeTrip,
} from '@/types/quiet-home';

export function emptyQuietHomeSettings(): QuietHomeSettings {
  return {
    id: '',
    userId: '',
    defaultHome: '',
    graceMinutes: 30,
    selfReminderEnabled: true,
    contactReminderEnabled: false,
    lateSnapshotEnabled: false,
    retentionDays: 30,
    updatedAt: 0,
  };
}

export function localTripId() {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function parseEtaInput(value: string) {
  const normalized = value.trim().replace(' ', 'T');
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export function formatEtaTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return `${String(parsed.getHours()).padStart(2, '0')}:${String(parsed.getMinutes()).padStart(2, '0')}`;
}

export function formatEtaLabel(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][parsed.getDay()];
  return `${parsed.getMonth() + 1}月${parsed.getDate()}日 ${week} ${formatEtaTime(value)}`;
}

export function minutesUntil(value: string, now = new Date()) {
  const target = new Date(value).getTime();
  if (Number.isNaN(target)) return 0;
  return Math.max(0, Math.round((target - now.getTime()) / 60000));
}

export function isPast(value: string, now = new Date()) {
  return new Date(value).getTime() <= now.getTime();
}

export function contactDisplayName(contact: QuietHomeContact) {
  return contact.displayName || contact.username || contact.id;
}

export function contactStatusLabel(status: QuietHomeContact['status']) {
  const labels: Record<QuietHomeContact['status'], string> = {
    '': '未添加',
    pending: '待对方同意',
    agreed: '已同意',
    declined: '已拒绝',
    removed: '已移除',
  };
  return labels[status] ?? status;
}

export function notificationLabel(type: QuietHomeNotificationType) {
  const labels: Record<QuietHomeNotificationType, string> = {
    self_reminder: '本人提醒',
    contact_reminder: '联系人提醒',
    safe_arrival: '已安全到家',
    cancel: '行程已取消',
  };
  return labels[type] ?? type;
}

export function notificationStatusLabel(status: QuietHomeNotification['status']) {
  const labels: Record<QuietHomeNotification['status'], string> = {
    pending: '待发送',
    sent: '已发送',
    failed: '发送失败',
  };
  return labels[status] ?? status;
}

export function graceMinutesLabel(minutes: number) {
  if (minutes <= 0) return '不升级联系人';
  return `${minutes} 分钟`;
}

export function historyStats(records: QuietHomeHistoryRecord[]) {
  const checkedIn = records.filter((item) => item.checkedInAt);
  const late = checkedIn.filter((item) => (item.lateMinutes ?? 0) > 0);
  const contactNotified = records.filter((item) => item.contactNotified);
  return {
    total: records.length,
    checkedIn: checkedIn.length,
    late: late.length,
    contactNotified: contactNotified.length,
  };
}

export function buildLocalTrip(input: {
  originLabel: string;
  destinationLabel: string;
  etaAt: string;
  graceMinutes: number;
  selfReminderEnabled: boolean;
  contactReminderEnabled: boolean;
  arrivalDetectionEnabled: boolean;
  lateSnapshotEnabled: boolean;
}): QuietHomeTrip {
  const now = new Date().toISOString();
  return {
    id: localTripId(),
    userId: 'local',
    originLabel: input.originLabel,
    destinationLabel: input.destinationLabel,
    etaAt: input.etaAt,
    graceMinutes: input.graceMinutes,
    selfReminderEnabled: input.selfReminderEnabled,
    contactReminderEnabled: input.contactReminderEnabled,
    arrivalDetectionEnabled: input.arrivalDetectionEnabled,
    lateSnapshotEnabled: input.lateSnapshotEnabled,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
}

export function buildLocalHistoryRecord(trip: QuietHomeTrip) {
  return {
    id: trip.id,
    createdAt: trip.createdAt,
    originLabel: trip.originLabel,
    destinationLabel: trip.destinationLabel,
    etaAt: trip.etaAt,
    checkedInAt: trip.checkedInAt,
    cancelledAt: trip.cancelledAt,
    lateMinutes: trip.lateMinutes,
    contactNotified: false,
  };
}
