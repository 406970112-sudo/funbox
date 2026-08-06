import { emptyQuietHomeSettings } from './quiet-home';
import type {
  QuietHomeHistoryRecord,
  QuietHomeNotification,
  QuietHomeSettings,
  QuietHomeTrip,
} from '@/types/quiet-home';

const settingsKey = 'funbox.quiet-home.settings.v1';
const activeTripKey = 'funbox.quiet-home.active-trip.v1';
const historyKey = 'funbox.quiet-home.history.v1';
const notificationsKey = 'funbox.quiet-home.notifications.v1';

export async function getQuietHomeSettings(): Promise<QuietHomeSettings> {
  if (typeof window === 'undefined') return emptyQuietHomeSettings();
  return parseSettings(window.localStorage.getItem(settingsKey)) ?? emptyQuietHomeSettings();
}

export async function setQuietHomeSettings(settings: QuietHomeSettings) {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(settingsKey, JSON.stringify(settings));
  }
}

export async function clearQuietHomeSettings() {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(settingsKey);
  }
}

export async function getQuietHomeActiveTrip(): Promise<QuietHomeTrip | null> {
  if (typeof window === 'undefined') return null;
  return parseTrip(window.localStorage.getItem(activeTripKey));
}

export async function setQuietHomeActiveTrip(trip: QuietHomeTrip | null) {
  if (typeof window !== 'undefined') {
    if (trip) window.localStorage.setItem(activeTripKey, JSON.stringify(trip));
    else window.localStorage.removeItem(activeTripKey);
  }
}

export async function clearQuietHomeActiveTrip() {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(activeTripKey);
  }
}

export async function getQuietHomeHistory(): Promise<QuietHomeHistoryRecord[]> {
  if (typeof window === 'undefined') return [];
  return parseHistory(window.localStorage.getItem(historyKey));
}

export async function setQuietHomeHistory(items: QuietHomeHistoryRecord[]) {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(historyKey, JSON.stringify(items));
  }
}

export async function clearQuietHomeHistory() {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(historyKey);
  }
}

export async function getQuietHomeNotifications(): Promise<QuietHomeNotification[]> {
  if (typeof window === 'undefined') return [];
  return parseNotifications(window.localStorage.getItem(notificationsKey));
}

export async function setQuietHomeNotifications(items: QuietHomeNotification[]) {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(notificationsKey, JSON.stringify(items));
  }
}

export async function clearQuietHomeNotifications() {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(notificationsKey);
  }
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
