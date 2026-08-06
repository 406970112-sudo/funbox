import type { GoOutLocalState } from '@/types/go-out-checklist';

export function emptyGoOutLocalState(): GoOutLocalState {
  return {
    schemaVersion: 1,
    items: [],
    scenes: [],
    sceneItems: [],
    schedules: [],
    settings: {
      city: '',
      lat: 0,
      lon: 0,
      timezone: 'Asia/Shanghai',
      weatherEnabled: false,
      activeSceneId: '',
      notificationEnabled: false,
      updatedAt: 0,
    },
    completions: [],
    updatedAt: 0,
  };
}

const storageKey = 'funbox.go-out-checklist.state.v1';

export async function getGoOutLocalState(): Promise<GoOutLocalState> {
  if (typeof window === 'undefined') return emptyGoOutLocalState();
  return parseState(window.localStorage.getItem(storageKey)) ?? emptyGoOutLocalState();
}

export async function setGoOutLocalState(state: GoOutLocalState) {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  }
}

export async function clearGoOutLocalState() {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(storageKey);
  }
}

function parseState(value: string | null): GoOutLocalState | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as GoOutLocalState;
    return parsed && parsed.schemaVersion === 1 ? parsed : null;
  } catch {
    return null;
  }
}
