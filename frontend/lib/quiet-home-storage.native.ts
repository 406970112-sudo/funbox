import AsyncStorage from '@react-native-async-storage/async-storage';

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
  return parseSettings(await AsyncStorage.getItem(settingsKey)) ?? emptyQuietHomeSettings();
}

export async function setQuietHomeSettings(settings: QuietHomeSettings) {
  await AsyncStorage.setItem(settingsKey, JSON.stringify(settings));
}

export async function clearQuietHomeSettings() {
  await AsyncStorage.removeItem(settingsKey);
}

export async function getQuietHomeActiveTrip(): Promise<QuietHomeTrip | null> {
  return parseTrip(await AsyncStorage.getItem(activeTripKey));
}

export async function setQuietHomeActiveTrip(trip: QuietHomeTrip | null) {
  if (trip) await AsyncStorage.setItem(activeTripKey, JSON.stringify(trip));
  else await AsyncStorage.removeItem(activeTripKey);
}

export async function clearQuietHomeActiveTrip() {
  await AsyncStorage.removeItem(activeTripKey);
}

export async function getQuietHomeHistory(): Promise<QuietHomeHistoryRecord[]> {
  return parseHistory(await AsyncStorage.getItem(historyKey));
}

export async function setQuietHomeHistory(items: QuietHomeHistoryRecord[]) {
  await AsyncStorage.setItem(historyKey, JSON.stringify(items));
}

export async function clearQuietHomeHistory() {
  await AsyncStorage.removeItem(historyKey);
}

export async function getQuietHomeNotifications(): Promise<QuietHomeNotification[]> {
  return parseNotifications(await AsyncStorage.getItem(notificationsKey));
}

export async function setQuietHomeNotifications(items: QuietHomeNotification[]) {
  await AsyncStorage.setItem(notificationsKey, JSON.stringify(items));
}

export async function clearQuietHomeNotifications() {
  await AsyncStorage.removeItem(notificationsKey);
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
