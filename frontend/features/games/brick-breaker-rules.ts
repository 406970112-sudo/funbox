export type BrickBreakerStatus = 'ready' | 'playing' | 'paused' | 'cleared' | 'lost';
export type BrickBreakerPowerUp = 'piercing' | 'multiball' | 'expand';

export type BrickBreakerActiveEffects = {
  expandMs: number;
  piercingMs: number;
};

export type BrickBreakerRulesState = {
  activeEffects: BrickBreakerActiveEffects;
  combo: number;
  lastPowerUp: BrickBreakerPowerUp | null;
  level: number;
  lives: number;
  maxCombo: number;
  powerUpRevision: number;
  score: number;
  status: BrickBreakerStatus;
};

export type BrickBreakerRulesEvent =
  | { type: 'LAUNCH' }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { destroyed: boolean; type: 'BRICK_HIT' }
  | { type: 'BALLS_LOST' }
  | { type: 'LEVEL_CLEARED' }
  | { powerUp: BrickBreakerPowerUp; type: 'POWER_UP_COLLECTED' }
  | { deltaMs: number; type: 'TICK_EFFECTS' }
  | { type: 'RESTART' };

const EMPTY_EFFECTS: BrickBreakerActiveEffects = {
  expandMs: 0,
  piercingMs: 0,
};

export function createBrickBreakerRulesState(): BrickBreakerRulesState {
  return {
    activeEffects: { ...EMPTY_EFFECTS },
    combo: 0,
    lastPowerUp: null,
    level: 1,
    lives: 3,
    maxCombo: 0,
    powerUpRevision: 0,
    score: 0,
    status: 'ready',
  };
}

export function reduceBrickBreakerRules(
  state: BrickBreakerRulesState,
  event: BrickBreakerRulesEvent,
): BrickBreakerRulesState {
  switch (event.type) {
    case 'LAUNCH':
      return state.status === 'ready' ? { ...state, status: 'playing' } : state;
    case 'PAUSE':
      return state.status === 'playing' ? { ...state, status: 'paused' } : state;
    case 'RESUME':
      return state.status === 'paused' ? { ...state, status: 'playing' } : state;
    case 'BRICK_HIT': {
      if (state.status !== 'playing') {
        return state;
      }

      const combo = state.combo + 1;
      const multiplier = Math.min(combo, 5);
      const points = event.destroyed ? 100 * multiplier : 25;

      return {
        ...state,
        combo,
        maxCombo: Math.max(state.maxCombo, combo),
        score: state.score + points,
      };
    }
    case 'BALLS_LOST': {
      if (state.status !== 'playing') {
        return state;
      }

      const lives = Math.max(0, state.lives - 1);

      return {
        ...state,
        activeEffects: { ...EMPTY_EFFECTS },
        combo: 0,
        lastPowerUp: null,
        lives,
        status: lives === 0 ? 'lost' : 'ready',
      };
    }
    case 'LEVEL_CLEARED':
      if (state.status !== 'playing') {
        return state;
      }

      return {
        ...state,
        activeEffects: { ...EMPTY_EFFECTS },
        combo: 0,
        lastPowerUp: null,
        level: state.level + 1,
        status: 'ready',
      };
    case 'POWER_UP_COLLECTED':
      return {
        ...state,
        activeEffects: {
          expandMs:
            event.powerUp === 'expand'
              ? Math.max(state.activeEffects.expandMs, 10_000)
              : state.activeEffects.expandMs,
          piercingMs:
            event.powerUp === 'piercing'
              ? Math.max(state.activeEffects.piercingMs, 8_000)
              : state.activeEffects.piercingMs,
        },
        lastPowerUp: event.powerUp,
        powerUpRevision: state.powerUpRevision + 1,
      };
    case 'TICK_EFFECTS':
      if (state.status !== 'playing' || event.deltaMs <= 0) {
        return state;
      }

      return {
        ...state,
        activeEffects: {
          expandMs: Math.max(0, state.activeEffects.expandMs - event.deltaMs),
          piercingMs: Math.max(0, state.activeEffects.piercingMs - event.deltaMs),
        },
      };
    case 'RESTART':
      return createBrickBreakerRulesState();
  }
}
