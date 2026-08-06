import type {
  QuietHomeHistoryRecord,
  QuietHomeNotification,
  QuietHomeSettings,
  QuietHomeTrip,
} from '@/types/quiet-home';

let memorySettings: string | null = null;
let memoryActiveTrip: string | null = null;
let memoryHistory: string | null = null;
let memoryNotifications: string | null = null;

export async function getQuietHomeSettings(): Promise<QuietHomeSettings> {
  return parseSettings(memorySettings) ?? emptySettings();
}

export async function setQuietHomeSettings(settings: QuietHomeSettings) {
  memorySettings = JSON.stringify(settings);
}

export async function clearQuietHomeSettings() {
  memorySettings = null;
}

export async function getQuietHomeActiveTrip(): Promise<QuietHomeTrip | null> {
  return parseTrip(memoryActiveTrip);
}

export async function setQuietHomeActiveTrip(trip: QuietHomeTrip | null) {
  memoryActiveTrip = trip ? JSON.stringify(trip) : null;
}

export async function clearQuietHomeActiveTrip() {
  memoryActiveTrip = null;
}

export async function getQuietHomeHistory(): Promise<QuietHomeHistoryRecord[]> {
  return parseHistory(memoryHistory);
}

export async function setQuietHomeHistory(items: QuietHomeHistoryRecord[]) {
  memoryHistory = JSON.stringify(items);
}

export async function clearQuietHomeHistory() {
  memoryHistory = null;
}

export async function getQuietHomeNotifications(): Promise<QuietHomeNotification[]> {
  return parseNotifications(memoryNotifications);
}

export async function setQuietHomeNotifications(items: QuietHomeNotification[]) {
  memoryNotifications = JSON.stringify(items);
}

export async function clearQuietHomeNotifications() {
  memoryNotifications = null;
}

function parseSettings(value: string | null): QuietHomeSettings | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as QuietHomeSettings;
    return parsed && typeof parsed.retentionDays === 'number' ? parsed : null;
  } catch {
    return null;
  }
}

function parseTrip(value: string | null): QuietHomeTrip | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as QuietHomeTrip;
    return parsed && parsed.status ? parsed : null;
  } catch {
    return null;
  }
}

function parseHistory(value: string | null): QuietHomeHistoryRecord[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as QuietHomeHistoryRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseNotifications(value: string | null): QuietHomeNotification[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as QuietHomeNotification[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function emptySettings(): QuietHomeSettings {
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
