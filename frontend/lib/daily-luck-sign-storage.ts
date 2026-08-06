import type {
  DailyLuckSignCompletion,
  DailyLuckSignSettings,
} from '@/types/daily-luck-sign';

let memorySettings: string | null = null;
let memoryCompletions: string | null = null;

export function emptyDailyLuckSignSettings(): DailyLuckSignSettings {
  return {
    city: '',
    lat: 0,
    lon: 0,
    source: 'manual',
    updatedAt: 0,
  };
}

export async function getDailyLuckSignSettings(): Promise<DailyLuckSignSettings> {
  return parseSettings(memorySettings) ?? emptyDailyLuckSignSettings();
}

export async function setDailyLuckSignSettings(settings: DailyLuckSignSettings) {
  memorySettings = JSON.stringify(settings);
}

export async function clearDailyLuckSignSettings() {
  memorySettings = null;
}

export async function getDailyLuckSignCompletions(): Promise<DailyLuckSignCompletion[]> {
  return parseCompletions(memoryCompletions);
}

export async function setDailyLuckSignCompletions(items: DailyLuckSignCompletion[]) {
  memoryCompletions = JSON.stringify(items);
}

export async function clearDailyLuckSignCompletions() {
  memoryCompletions = null;
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
