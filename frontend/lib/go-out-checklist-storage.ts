import type { GoOutLocalState } from '@/types/go-out-checklist';

let memoryState: string | null = null;

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

export async function getGoOutLocalState(): Promise<GoOutLocalState> {
  return parseState(memoryState) ?? emptyGoOutLocalState();
}

export async function setGoOutLocalState(state: GoOutLocalState) {
  memoryState = JSON.stringify(state);
}

export async function clearGoOutLocalState() {
  memoryState = null;
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
