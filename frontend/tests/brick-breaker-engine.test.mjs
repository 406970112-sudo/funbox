import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectBrickBreakerPowerUp,
  createBrickBreakerSession,
  damageBrickBreakerBrick,
  disposeBrickBreakerSession,
  getBrickBreakerSnapshot,
  launchBrickBreakerBall,
  moveBrickBreakerPaddle,
  pauseBrickBreakerSession,
  restartBrickBreakerSession,
  resumeBrickBreakerSession,
  stepBrickBreakerSession,
} from '../features/games/brick-breaker-engine.ts';

test('creates a ready session with a parked ball, paddle, and brick field', () => {
  const session = createBrickBreakerSession({ random: () => 0.99 });
  const snapshot = getBrickBreakerSnapshot(session);

  assert.equal(snapshot.status, 'ready');
  assert.equal(snapshot.lives, 3);
  assert.equal(snapshot.balls.length, 1);
  assert.equal(snapshot.balls[0].parked, true);
  assert.equal(snapshot.paddle.x, 0.5);
  assert.ok(snapshot.bricks.length >= 32);
  assert.ok(snapshot.bricks.some((brick) => brick.maxHitPoints === 2));

  disposeBrickBreakerSession(session);
});

test('clamps paddle movement and keeps the parked ball attached', () => {
  const session = createBrickBreakerSession({ random: () => 0.99 });

  moveBrickBreakerPaddle(session, 2);
  const right = getBrickBreakerSnapshot(session);
  assert.ok(right.paddle.x < 1);
  assert.equal(right.balls[0].x, right.paddle.x);

  moveBrickBreakerPaddle(session, -1);
  const left = getBrickBreakerSnapshot(session);
  assert.ok(left.paddle.x > 0);
  assert.equal(left.balls[0].x, left.paddle.x);

  disposeBrickBreakerSession(session);
});

test('launches the ball, advances with bounded time, and freezes while paused', () => {
  const session = createBrickBreakerSession({ random: () => 0.99 });

  launchBrickBreakerBall(session);
  const launched = getBrickBreakerSnapshot(session);
  stepBrickBreakerSession(session, 32);
  const moved = getBrickBreakerSnapshot(session);

  assert.equal(launched.status, 'playing');
  assert.equal(launched.balls[0].parked, false);
  assert.notDeepEqual(moved.balls[0], launched.balls[0]);

  pauseBrickBreakerSession(session);
  const paused = getBrickBreakerSnapshot(session);
  stepBrickBreakerSession(session, 1_000);
  assert.deepEqual(getBrickBreakerSnapshot(session).balls, paused.balls);

  resumeBrickBreakerSession(session);
  stepBrickBreakerSession(session, 16);
  assert.notDeepEqual(getBrickBreakerSnapshot(session).balls, paused.balls);

  disposeBrickBreakerSession(session);
});

test('bounces off a wall and keeps moving with finite physics values', () => {
  const session = createBrickBreakerSession({ random: () => 0.99 });
  launchBrickBreakerBall(session);

  const ball = [...session.balls.values()][0].body;
  assert.ok(ball.velocity.x > 0);

  let bounced = false;
  for (let frame = 0; frame < 120; frame += 1) {
    stepBrickBreakerSession(session, 16);
    assert.ok(Number.isFinite(ball.position.x));
    assert.ok(Number.isFinite(ball.position.y));
    assert.ok(Number.isFinite(ball.velocity.x));
    assert.ok(Number.isFinite(ball.velocity.y));
    if (ball.velocity.x < 0) {
      bounced = true;
      break;
    }
  }

  assert.equal(bounced, true);
  const xAfterBounce = ball.position.x;
  for (let frame = 0; frame < 5; frame += 1) {
    stepBrickBreakerSession(session, 16);
  }
  assert.ok(ball.position.x < xAfterBounce);

  disposeBrickBreakerSession(session);
});

test('damages reinforced bricks before destroying them and updates scoring', () => {
  const session = createBrickBreakerSession({ random: () => 0.99 });
  launchBrickBreakerBall(session);
  const strongBrick = getBrickBreakerSnapshot(session).bricks.find(
    (brick) => brick.maxHitPoints === 2,
  );

  assert.ok(strongBrick);
  damageBrickBreakerBrick(session, strongBrick.id);
  const damaged = getBrickBreakerSnapshot(session);
  assert.equal(damaged.bricks.find((brick) => brick.id === strongBrick.id)?.hitPoints, 1);
  assert.equal(damaged.score, 25);

  damageBrickBreakerBrick(session, strongBrick.id);
  const destroyed = getBrickBreakerSnapshot(session);
  assert.equal(destroyed.bricks.some((brick) => brick.id === strongBrick.id), false);
  assert.equal(destroyed.score, 225);
  assert.equal(destroyed.combo, 2);

  disposeBrickBreakerSession(session);
});

test('applies multiball, expanded paddle, and piercing effects to the live world', () => {
  const session = createBrickBreakerSession({ random: () => 0.99 });
  launchBrickBreakerBall(session);
  const baseWidth = getBrickBreakerSnapshot(session).paddle.width;

  collectBrickBreakerPowerUp(session, 'multiball');
  collectBrickBreakerPowerUp(session, 'expand');
  collectBrickBreakerPowerUp(session, 'piercing');
  const powered = getBrickBreakerSnapshot(session);

  assert.equal(powered.balls.length, 3);
  assert.ok(powered.paddle.width > baseWidth);
  assert.equal(powered.activeEffects.expandMs, 10_000);
  assert.equal(powered.activeEffects.piercingMs, 8_000);

  stepBrickBreakerSession(session, 50);
  assert.ok(getBrickBreakerSnapshot(session).activeEffects.expandMs < 10_000);

  disposeBrickBreakerSession(session);
});

test('restart rebuilds the first level and clears session progress', () => {
  const session = createBrickBreakerSession({ random: () => 0.99 });
  launchBrickBreakerBall(session);
  const brick = getBrickBreakerSnapshot(session).bricks[0];
  damageBrickBreakerBrick(session, brick.id);
  collectBrickBreakerPowerUp(session, 'multiball');

  restartBrickBreakerSession(session);
  const restarted = getBrickBreakerSnapshot(session);

  assert.equal(restarted.status, 'ready');
  assert.equal(restarted.score, 0);
  assert.equal(restarted.level, 1);
  assert.equal(restarted.balls.length, 1);
  assert.equal(restarted.balls[0].parked, true);

  disposeBrickBreakerSession(session);
});
