import AsyncStorage from '@react-native-async-storage/async-storage';

import { emptyDailyLuckSignSettings } from '@/lib/daily-luck-sign-storage';
import type {
  DailyLuckSignCompletion,
  DailyLuckSignSettings,
} from '@/types/daily-luck-sign';

const settingsKey = 'funbox.daily-luck-sign.settings.v1';
const completionsKey = 'funbox.daily-luck-sign.completions.v1';

export async function getDailyLuckSignSettings(): Promise<DailyLuckSignSettings> {
  return parseSettings(await AsyncStorage.getItem(settingsKey)) ?? emptyDailyLuckSignSettings();
}

export async function setDailyLuckSignSettings(settings: DailyLuckSignSettings) {
  await AsyncStorage.setItem(settingsKey, JSON.stringify(settings));
}

export async function clearDailyLuckSignSettings() {
  await AsyncStorage.removeItem(settingsKey);
}

export async function getDailyLuckSignCompletions(): Promise<DailyLuckSignCompletion[]> {
  return parseCompletions(await AsyncStorage.getItem(completionsKey));
}

export async function setDailyLuckSignCompletions(items: DailyLuckSignCompletion[]) {
  await AsyncStorage.setItem(completionsKey, JSON.stringify(items));
}

export async function clearDailyLuckSignCompletions() {
  await AsyncStorage.removeItem(completionsKey);
}

function parseSettings(value: string | null): DailyLuckSignSettings | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as DailyLuckSignSettings;
    return parsed && typeof parsed.city === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

function parseCompletions(value: string | null): DailyLuckSignCompletion[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as DailyLuckSignCompletion[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
