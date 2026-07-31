import Matter from 'matter-js';

import {
  createBrickBreakerRulesState,
  reduceBrickBreakerRules,
  type BrickBreakerPowerUp,
  type BrickBreakerRulesState,
  type BrickBreakerStatus,
} from './brick-breaker-rules.ts';

export const BRICK_BREAKER_WORLD_WIDTH = 360;
export const BRICK_BREAKER_WORLD_HEIGHT = 560;

const BALL_RADIUS = 6;
const BASE_PADDLE_WIDTH = 92;
const EXPANDED_PADDLE_WIDTH = 132;
const PADDLE_HEIGHT = 12;
const PADDLE_Y = 526;
const MAX_FRAME_MS = 50;
const PHYSICS_STEP_MS = 1000 / 120;
const BALL_SPEED = 7.2;

const BRICK_COLORS = ['#ff7466', '#f3c84b', '#20c997', '#22c7d9', '#4b6bff'];
const POWER_UP_TYPES: BrickBreakerPowerUp[] = ['piercing', 'multiball', 'expand'];

type BrickRecord = {
  body: Matter.Body;
  color: string;
  hitPoints: number;
  maxHitPoints: number;
};

type BallRecord = {
  body: Matter.Body;
  parked: boolean;
};

type PowerUpRecord = {
  body: Matter.Body;
  type: BrickBreakerPowerUp;
};

export type BrickBreakerSession = {
  balls: Map<number, BallRecord>;
  bottomSensor: Matter.Body;
  bricks: Map<number, BrickRecord>;
  collisionHandler: (event: Matter.IEventCollision<Matter.Engine>) => void;
  disposed: boolean;
  engine: Matter.Engine;
  paddle: Matter.Body;
  paddleWidth: number;
  powerUps: Map<number, PowerUpRecord>;
  random: () => number;
  rules: BrickBreakerRulesState;
  walls: Matter.Body[];
};

export type BrickBreakerSnapshot = {
  activeEffects: BrickBreakerRulesState['activeEffects'];
  balls: Array<{ id: number; parked: boolean; radius: number; x: number; y: number }>;
  bricks: Array<{
    color: string;
    height: number;
    hitPoints: number;
    id: number;
    maxHitPoints: number;
    width: number;
    x: number;
    y: number;
  }>;
  combo: number;
  lastPowerUp: BrickBreakerPowerUp | null;
  level: number;
  lives: number;
  maxCombo: number;
  paddle: { height: number; width: number; x: number; y: number };
  powerUpRevision: number;
  powerUps: Array<{
    height: number;
    id: number;
    type: BrickBreakerPowerUp;
    width: number;
    x: number;
    y: number;
  }>;
  score: number;
  status: BrickBreakerStatus;
};

export type BrickBreakerSessionOptions = {
  random?: () => number;
};

function normalizedX(value: number) {
  return value / BRICK_BREAKER_WORLD_WIDTH;
}

function normalizedY(value: number) {
  return value / BRICK_BREAKER_WORLD_HEIGHT;
}

function createPaddle() {
  return Matter.Bodies.rectangle(
    BRICK_BREAKER_WORLD_WIDTH / 2,
    PADDLE_Y,
    BASE_PADDLE_WIDTH,
    PADDLE_HEIGHT,
    {
      chamfer: { radius: 6 },
      friction: 0,
      frictionStatic: 0,
      isStatic: true,
      label: 'paddle',
      restitution: 1,
    },
  );
}

function createWalls() {
  return [
    Matter.Bodies.rectangle(-8, BRICK_BREAKER_WORLD_HEIGHT / 2, 16, BRICK_BREAKER_WORLD_HEIGHT, {
      isStatic: true,
      label: 'wall',
      restitution: 1,
    }),
    Matter.Bodies.rectangle(
      BRICK_BREAKER_WORLD_WIDTH + 8,
      BRICK_BREAKER_WORLD_HEIGHT / 2,
      16,
      BRICK_BREAKER_WORLD_HEIGHT,
      { isStatic: true, label: 'wall', restitution: 1 },
    ),
    Matter.Bodies.rectangle(BRICK_BREAKER_WORLD_WIDTH / 2, -8, BRICK_BREAKER_WORLD_WIDTH, 16, {
      isStatic: true,
      label: 'wall',
      restitution: 1,
    }),
  ];
}

function createBottomSensor() {
  return Matter.Bodies.rectangle(
    BRICK_BREAKER_WORLD_WIDTH / 2,
    BRICK_BREAKER_WORLD_HEIGHT + 18,
    BRICK_BREAKER_WORLD_WIDTH,
    36,
    { isSensor: true, isStatic: true, label: 'bottom-sensor' },
  );
}

function addParkedBall(session: BrickBreakerSession) {
  const body = Matter.Bodies.circle(
    session.paddle.position.x,
    PADDLE_Y - PADDLE_HEIGHT / 2 - BALL_RADIUS - 3,
    BALL_RADIUS,
    {
      friction: 0,
      frictionAir: 0,
      inertia: Infinity,
      label: 'ball',
      restitution: 1,
      slop: 0.01,
    },
  );
  Matter.Body.setStatic(body, true);
  Matter.Composite.add(session.engine.world, body);
  session.balls.set(body.id, { body, parked: true });
}

function buildLevel(session: BrickBreakerSession) {
  const columns = 8;
  const rows = 6;
  const gap = 6;
  const horizontalMargin = 15;
  const brickWidth =
    (BRICK_BREAKER_WORLD_WIDTH - horizontalMargin * 2 - gap * (columns - 1)) / columns;
  const brickHeight = 22;
  const top = 34;

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const isCutout = row === 0 && (column === 0 || column === columns - 1);
      if (isCutout) {
        continue;
      }

      const maxHitPoints = (row + column + session.rules.level) % 7 === 0 ? 2 : 1;
      const x = horizontalMargin + brickWidth / 2 + column * (brickWidth + gap);
      const y = top + brickHeight / 2 + row * (brickHeight + gap);
      const body = Matter.Bodies.rectangle(x, y, brickWidth, brickHeight, {
        chamfer: { radius: 4 },
        isStatic: true,
        label: 'brick',
        restitution: 1,
      });
      const record: BrickRecord = {
        body,
        color: BRICK_COLORS[(row + Math.floor(column / 2)) % BRICK_COLORS.length],
        hitPoints: maxHitPoints,
        maxHitPoints,
      };
      Matter.Composite.add(session.engine.world, body);
      session.bricks.set(body.id, record);
    }
  }
}

function removeBall(session: BrickBreakerSession, id: number) {
  const record = session.balls.get(id);
  if (!record) {
    return;
  }
  Matter.Composite.remove(session.engine.world, record.body);
  session.balls.delete(id);
}

function removePowerUp(session: BrickBreakerSession, id: number) {
  const record = session.powerUps.get(id);
  if (!record) {
    return;
  }
  Matter.Composite.remove(session.engine.world, record.body);
  session.powerUps.delete(id);
}

function rotateVelocity(velocity: Matter.Vector, angle: number) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: velocity.x * cos - velocity.y * sin,
    y: velocity.x * sin + velocity.y * cos,
  };
}

function applyBallSpeed(body: Matter.Body, velocity = body.velocity) {
  const current = Matter.Vector.magnitude(velocity);
  if (current < 0.01) {
    Matter.Body.setVelocity(body, { x: BALL_SPEED * 0.52, y: -BALL_SPEED * 0.85 });
    return;
  }

  const minVertical = BALL_SPEED * 0.32;
  const ySign = velocity.y >= 0 ? 1 : -1;
  const corrected =
    Math.abs(velocity.y) < minVertical
      ? { x: velocity.x, y: ySign * minVertical }
      : velocity;
  const magnitude = Math.max(0.01, Matter.Vector.magnitude(corrected));
  Matter.Body.setVelocity(body, {
    x: (corrected.x / magnitude) * BALL_SPEED,
    y: (corrected.y / magnitude) * BALL_SPEED,
  });
}

function reflectFromPaddle(session: BrickBreakerSession, ball: Matter.Body) {
  const offset = Math.max(
    -1,
    Math.min(1, (ball.position.x - session.paddle.position.x) / (session.paddleWidth / 2)),
  );
  const angle = offset * 1.05;
  Matter.Body.setPosition(ball, {
    x: ball.position.x,
    y: PADDLE_Y - PADDLE_HEIGHT / 2 - BALL_RADIUS - 1,
  });
  applyBallSpeed(ball, { x: Math.sin(angle) * BALL_SPEED, y: -Math.cos(angle) * BALL_SPEED });
}

function dropPowerUp(session: BrickBreakerSession, brick: BrickRecord) {
  if (session.random() >= 0.18) {
    return;
  }

  const typeIndex = Math.min(
    POWER_UP_TYPES.length - 1,
    Math.floor(session.random() * POWER_UP_TYPES.length),
  );
  const type = POWER_UP_TYPES[typeIndex];
  const body = Matter.Bodies.rectangle(brick.body.position.x, brick.body.position.y, 24, 18, {
    frictionAir: 0,
    isSensor: true,
    label: 'power-up',
  });
  Matter.Body.setVelocity(body, { x: 0, y: 2.6 });
  Matter.Composite.add(session.engine.world, body);
  session.powerUps.set(body.id, { body, type });
}

function bodyPair(
  pair: Matter.Pair,
  firstLabel: string,
  secondLabel: string,
): [Matter.Body, Matter.Body] | null {
  if (pair.bodyA.label === firstLabel && pair.bodyB.label === secondLabel) {
    return [pair.bodyA, pair.bodyB];
  }
  if (pair.bodyB.label === firstLabel && pair.bodyA.label === secondLabel) {
    return [pair.bodyB, pair.bodyA];
  }
  return null;
}

function syncEffects(session: BrickBreakerSession) {
  const nextWidth = session.rules.activeEffects.expandMs > 0 ? EXPANDED_PADDLE_WIDTH : BASE_PADDLE_WIDTH;
  if (nextWidth !== session.paddleWidth) {
    Matter.Body.scale(session.paddle, nextWidth / session.paddleWidth, 1);
    session.paddleWidth = nextWidth;
    moveBrickBreakerPaddle(session, normalizedX(session.paddle.position.x));
  }

  const piercing = session.rules.activeEffects.piercingMs > 0;
  for (const brick of session.bricks.values()) {
    brick.body.isSensor = piercing;
  }
}

function clearDynamicBodies(session: BrickBreakerSession) {
  for (const ball of session.balls.values()) {
    Matter.Composite.remove(session.engine.world, ball.body);
  }
  session.balls.clear();
  for (const powerUp of session.powerUps.values()) {
    Matter.Composite.remove(session.engine.world, powerUp.body);
  }
  session.powerUps.clear();
}

function clearBricks(session: BrickBreakerSession) {
  for (const brick of session.bricks.values()) {
    Matter.Composite.remove(session.engine.world, brick.body);
  }
  session.bricks.clear();
}

function advanceLevelIfCleared(session: BrickBreakerSession) {
  if (session.rules.status !== 'playing' || session.bricks.size > 0) {
    return;
  }

  session.rules = reduceBrickBreakerRules(session.rules, { type: 'LEVEL_CLEARED' });
  clearDynamicBodies(session);
  syncEffects(session);
  buildLevel(session);
  addParkedBall(session);
}

function handleNoBalls(session: BrickBreakerSession) {
  if (session.rules.status !== 'playing' || session.balls.size > 0) {
    return;
  }
  session.rules = reduceBrickBreakerRules(session.rules, { type: 'BALLS_LOST' });
  for (const powerUp of session.powerUps.values()) {
    Matter.Composite.remove(session.engine.world, powerUp.body);
  }
  session.powerUps.clear();
  syncEffects(session);
  if (session.rules.status === 'ready') {
    addParkedBall(session);
  }
}

function createCollisionHandler(session: BrickBreakerSession) {
  return (event: Matter.IEventCollision<Matter.Engine>) => {
    for (const pair of event.pairs) {
      const ballBrick = bodyPair(pair, 'ball', 'brick');
      if (ballBrick) {
        damageBrickBreakerBrick(session, ballBrick[1].id);
        continue;
      }

      const ballPaddle = bodyPair(pair, 'ball', 'paddle');
      if (ballPaddle && ballPaddle[0].velocity.y > 0) {
        reflectFromPaddle(session, ballPaddle[0]);
        continue;
      }

      const powerUpPaddle = bodyPair(pair, 'power-up', 'paddle');
      if (powerUpPaddle) {
        const powerUp = session.powerUps.get(powerUpPaddle[0].id);
        if (powerUp) {
          collectBrickBreakerPowerUp(session, powerUp.type);
          removePowerUp(session, powerUp.body.id);
        }
        continue;
      }

      const ballBottom = bodyPair(pair, 'ball', 'bottom-sensor');
      if (ballBottom) {
        removeBall(session, ballBottom[0].id);
        continue;
      }

      const powerUpBottom = bodyPair(pair, 'power-up', 'bottom-sensor');
      if (powerUpBottom) {
        removePowerUp(session, powerUpBottom[0].id);
      }
    }
  };
}

export function createBrickBreakerSession(
  options: BrickBreakerSessionOptions = {},
): BrickBreakerSession {
  const engine = Matter.Engine.create({ gravity: { x: 0, y: 0, scale: 0.001 } });
  engine.positionIterations = 8;
  engine.velocityIterations = 6;
  const paddle = createPaddle();
  const walls = createWalls();
  const bottomSensor = createBottomSensor();
  const session: BrickBreakerSession = {
    balls: new Map<number, BallRecord>(),
    bottomSensor,
    bricks: new Map<number, BrickRecord>(),
    collisionHandler: (_event) => undefined,
    disposed: false,
    engine,
    paddle,
    paddleWidth: BASE_PADDLE_WIDTH,
    powerUps: new Map<number, PowerUpRecord>(),
    random: options.random ?? Math.random,
    rules: createBrickBreakerRulesState(),
    walls,
  };

  session.collisionHandler = createCollisionHandler(session);
  Matter.Composite.add(engine.world, [...walls, bottomSensor, paddle]);
  Matter.Events.on(engine, 'collisionStart', session.collisionHandler);
  buildLevel(session);
  addParkedBall(session);
  return session;
}

export function getBrickBreakerSnapshot(session: BrickBreakerSession): BrickBreakerSnapshot {
  return {
    activeEffects: { ...session.rules.activeEffects },
    balls: [...session.balls.values()].map(({ body, parked }) => ({
      id: body.id,
      parked,
      radius: normalizedX(BALL_RADIUS),
      x: normalizedX(body.position.x),
      y: normalizedY(body.position.y),
    })),
    bricks: [...session.bricks.values()].map((brick) => ({
      color: brick.color,
      height: normalizedY(brick.body.bounds.max.y - brick.body.bounds.min.y),
      hitPoints: brick.hitPoints,
      id: brick.body.id,
      maxHitPoints: brick.maxHitPoints,
      width: normalizedX(brick.body.bounds.max.x - brick.body.bounds.min.x),
      x: normalizedX(brick.body.position.x),
      y: normalizedY(brick.body.position.y),
    })),
    combo: session.rules.combo,
    lastPowerUp: session.rules.lastPowerUp,
    level: session.rules.level,
    lives: session.rules.lives,
    maxCombo: session.rules.maxCombo,
    paddle: {
      height: normalizedY(PADDLE_HEIGHT),
      width: normalizedX(session.paddleWidth),
      x: normalizedX(session.paddle.position.x),
      y: normalizedY(session.paddle.position.y),
    },
    powerUpRevision: session.rules.powerUpRevision,
    powerUps: [...session.powerUps.values()].map(({ body, type }) => ({
      height: normalizedY(body.bounds.max.y - body.bounds.min.y),
      id: body.id,
      type,
      width: normalizedX(body.bounds.max.x - body.bounds.min.x),
      x: normalizedX(body.position.x),
      y: normalizedY(body.position.y),
    })),
    score: session.rules.score,
    status: session.rules.status,
  };
}

export function moveBrickBreakerPaddle(session: BrickBreakerSession, normalizedPosition: number) {
  if (session.disposed) {
    return;
  }
  const halfWidth = session.paddleWidth / 2;
  const x = Math.max(
    halfWidth,
    Math.min(BRICK_BREAKER_WORLD_WIDTH - halfWidth, normalizedPosition * BRICK_BREAKER_WORLD_WIDTH),
  );
  Matter.Body.setPosition(session.paddle, { x, y: PADDLE_Y });
  for (const ball of session.balls.values()) {
    if (ball.parked) {
      Matter.Body.setPosition(ball.body, {
        x,
        y: PADDLE_Y - PADDLE_HEIGHT / 2 - BALL_RADIUS - 3,
      });
    }
  }
}

export function launchBrickBreakerBall(session: BrickBreakerSession) {
  if (session.disposed || session.rules.status !== 'ready') {
    return;
  }
  session.rules = reduceBrickBreakerRules(session.rules, { type: 'LAUNCH' });
  for (const ball of session.balls.values()) {
    if (!ball.parked) {
      continue;
    }
    ball.parked = false;
    Matter.Body.setStatic(ball.body, false);
    applyBallSpeed(ball.body, { x: BALL_SPEED * 0.54, y: -BALL_SPEED * 0.84 });
  }
}

export function pauseBrickBreakerSession(session: BrickBreakerSession) {
  if (!session.disposed) {
    session.rules = reduceBrickBreakerRules(session.rules, { type: 'PAUSE' });
  }
}

export function resumeBrickBreakerSession(session: BrickBreakerSession) {
  if (!session.disposed) {
    session.rules = reduceBrickBreakerRules(session.rules, { type: 'RESUME' });
  }
}

export function damageBrickBreakerBrick(session: BrickBreakerSession, brickId: number) {
  const brick = session.bricks.get(brickId);
  if (!brick || session.rules.status !== 'playing') {
    return;
  }

  brick.hitPoints -= 1;
  const destroyed = brick.hitPoints <= 0;
  session.rules = reduceBrickBreakerRules(session.rules, { destroyed, type: 'BRICK_HIT' });
  if (!destroyed) {
    return;
  }

  dropPowerUp(session, brick);
  Matter.Composite.remove(session.engine.world, brick.body);
  session.bricks.delete(brickId);
}

export function collectBrickBreakerPowerUp(
  session: BrickBreakerSession,
  powerUp: BrickBreakerPowerUp,
) {
  if (session.disposed || session.rules.status !== 'playing') {
    return;
  }
  session.rules = reduceBrickBreakerRules(session.rules, {
    powerUp,
    type: 'POWER_UP_COLLECTED',
  });

  if (powerUp === 'multiball' && session.balls.size > 0 && session.balls.size < 3) {
    const source = [...session.balls.values()].find((ball) => !ball.parked)?.body;
    if (source) {
      for (const angle of [-0.38, 0.38]) {
        if (session.balls.size >= 3) {
          break;
        }
        const body = Matter.Bodies.circle(source.position.x, source.position.y, BALL_RADIUS, {
          friction: 0,
          frictionAir: 0,
          inertia: Infinity,
          label: 'ball',
          restitution: 1,
          slop: 0.01,
        });
        applyBallSpeed(body, rotateVelocity(source.velocity, angle));
        Matter.Composite.add(session.engine.world, body);
        session.balls.set(body.id, { body, parked: false });
      }
    }
  }
  syncEffects(session);
}

export function stepBrickBreakerSession(session: BrickBreakerSession, deltaMs: number) {
  if (session.disposed || session.rules.status !== 'playing' || deltaMs <= 0) {
    return;
  }
  const boundedDelta = Math.min(MAX_FRAME_MS, deltaMs);
  const steps = Math.max(1, Math.ceil(boundedDelta / PHYSICS_STEP_MS));
  const stepMs = boundedDelta / steps;
  for (let index = 0; index < steps; index += 1) {
    Matter.Engine.update(session.engine, stepMs);
  }
  for (const ball of session.balls.values()) {
    if (!ball.parked) {
      applyBallSpeed(ball.body);
    }
  }
  session.rules = reduceBrickBreakerRules(session.rules, {
    deltaMs: boundedDelta,
    type: 'TICK_EFFECTS',
  });
  syncEffects(session);
  handleNoBalls(session);
  advanceLevelIfCleared(session);
}

export function restartBrickBreakerSession(session: BrickBreakerSession) {
  if (session.disposed) {
    return;
  }
  clearDynamicBodies(session);
  clearBricks(session);
  session.rules = reduceBrickBreakerRules(session.rules, { type: 'RESTART' });
  syncEffects(session);
  moveBrickBreakerPaddle(session, 0.5);
  buildLevel(session);
  addParkedBall(session);
}

export function disposeBrickBreakerSession(session: BrickBreakerSession) {
  if (session.disposed) {
    return;
  }
  session.disposed = true;
  Matter.Events.off(session.engine, 'collisionStart', session.collisionHandler);
  Matter.Composite.clear(session.engine.world, false, true);
  Matter.Engine.clear(session.engine);
  session.balls.clear();
  session.bricks.clear();
  session.powerUps.clear();
}
