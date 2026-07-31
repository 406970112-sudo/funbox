import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createBrickBreakerRulesState,
  reduceBrickBreakerRules,
} from '../features/games/brick-breaker-rules.ts';

test('moves through ready, playing, and paused states without changing the score', () => {
  const initial = createBrickBreakerRulesState();
  const playing = reduceBrickBreakerRules(initial, { type: 'LAUNCH' });
  const paused = reduceBrickBreakerRules(playing, { type: 'PAUSE' });
  const resumed = reduceBrickBreakerRules(paused, { type: 'RESUME' });

  assert.equal(initial.status, 'ready');
  assert.equal(playing.status, 'playing');
  assert.equal(paused.status, 'paused');
  assert.equal(resumed.status, 'playing');
  assert.equal(resumed.score, 0);
});

test('rewards consecutive brick hits with a capped multiplier', () => {
  let state = reduceBrickBreakerRules(createBrickBreakerRulesState(), { type: 'LAUNCH' });

  state = reduceBrickBreakerRules(state, { destroyed: false, type: 'BRICK_HIT' });
  assert.equal(state.score, 25);
  assert.equal(state.combo, 1);

  state = reduceBrickBreakerRules(state, { destroyed: true, type: 'BRICK_HIT' });
  assert.equal(state.score, 225);
  assert.equal(state.combo, 2);

  for (let index = 0; index < 5; index += 1) {
    state = reduceBrickBreakerRules(state, { destroyed: true, type: 'BRICK_HIT' });
  }

  assert.equal(state.score, 2_425);
  assert.equal(state.combo, 7);
  assert.equal(state.maxCombo, 7);
});

test('loses one life only after all balls are gone and ends on the third loss', () => {
  let state = reduceBrickBreakerRules(createBrickBreakerRulesState(), { type: 'LAUNCH' });

  state = reduceBrickBreakerRules(state, { type: 'BALLS_LOST' });
  assert.equal(state.lives, 2);
  assert.equal(state.status, 'ready');

  state = reduceBrickBreakerRules(state, { type: 'LAUNCH' });
  state = reduceBrickBreakerRules(state, { type: 'BALLS_LOST' });
  state = reduceBrickBreakerRules(state, { type: 'LAUNCH' });
  state = reduceBrickBreakerRules(state, { type: 'BALLS_LOST' });

  assert.equal(state.lives, 0);
  assert.equal(state.status, 'lost');
  assert.equal(state.combo, 0);
});

test('advances a cleared level while preserving lives and cumulative score', () => {
  let state = reduceBrickBreakerRules(createBrickBreakerRulesState(), { type: 'LAUNCH' });
  state = reduceBrickBreakerRules(state, { destroyed: true, type: 'BRICK_HIT' });
  state = reduceBrickBreakerRules(state, { type: 'LEVEL_CLEARED' });

  assert.equal(state.level, 2);
  assert.equal(state.lives, 3);
  assert.equal(state.score, 100);
  assert.equal(state.combo, 0);
  assert.equal(state.status, 'ready');
});

test('ticks timed effects only during active play and records multiball collection', () => {
  let state = reduceBrickBreakerRules(createBrickBreakerRulesState(), {
    powerUp: 'piercing',
    type: 'POWER_UP_COLLECTED',
  });
  state = reduceBrickBreakerRules(state, {
    powerUp: 'expand',
    type: 'POWER_UP_COLLECTED',
  });

  const readyTick = reduceBrickBreakerRules(state, { deltaMs: 1_000, type: 'TICK_EFFECTS' });
  assert.equal(readyTick.activeEffects.piercingMs, 8_000);
  assert.equal(readyTick.activeEffects.expandMs, 10_000);

  const playing = reduceBrickBreakerRules(readyTick, { type: 'LAUNCH' });
  const activeTick = reduceBrickBreakerRules(playing, { deltaMs: 1_500, type: 'TICK_EFFECTS' });
  const multiball = reduceBrickBreakerRules(activeTick, {
    powerUp: 'multiball',
    type: 'POWER_UP_COLLECTED',
  });

  assert.equal(multiball.activeEffects.piercingMs, 6_500);
  assert.equal(multiball.activeEffects.expandMs, 8_500);
  assert.equal(multiball.lastPowerUp, 'multiball');
  assert.equal(multiball.powerUpRevision, 3);
});

test('restart returns to a clean first-level session', () => {
  let state = reduceBrickBreakerRules(createBrickBreakerRulesState(), { type: 'LAUNCH' });
  state = reduceBrickBreakerRules(state, { destroyed: true, type: 'BRICK_HIT' });
  state = reduceBrickBreakerRules(state, { type: 'BALLS_LOST' });

  assert.deepEqual(
    reduceBrickBreakerRules(state, { type: 'RESTART' }),
    createBrickBreakerRulesState(),
  );
});
