import { emptyDailyLuckSignSettings } from '@/lib/daily-luck-sign-storage.ts';
import type {
  DailyLuckSignCompletion,
  DailyLuckSignSettings,
} from '@/types/daily-luck-sign';

const settingsKey = 'funbox.daily-luck-sign.settings.v1';
const completionsKey = 'funbox.daily-luck-sign.completions.v1';

export async function getDailyLuckSignSettings(): Promise<DailyLuckSignSettings> {
  if (typeof window === 'undefined') return emptyDailyLuckSignSettings();
  return parseSettings(window.localStorage.getItem(settingsKey)) ?? emptyDailyLuckSignSettings();
}

export async function setDailyLuckSignSettings(settings: DailyLuckSignSettings) {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(settingsKey, JSON.stringify(settings));
  }
}

export async function clearDailyLuckSignSettings() {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(settingsKey);
  }
}

export async function getDailyLuckSignCompletions(): Promise<DailyLuckSignCompletion[]> {
  if (typeof window === 'undefined') return [];
  return parseCompletions(window.localStorage.getItem(completionsKey));
}

export async function setDailyLuckSignCompletions(items: DailyLuckSignCompletion[]) {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(completionsKey, JSON.stringify(items));
  }
}

export async function clearDailyLuckSignCompletions() {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(completionsKey);
  }
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
