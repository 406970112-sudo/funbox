# Brick Breaker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a complete, cross-platform brick-breaker game to FunBox and verify it in the Codex in-app browser.

**Architecture:** Keep scoring, lives, combo, level progression, and power-up timers in a pure reducer; keep movement and collision in a focused Matter.js session that emits reducer events. The React Native screen owns input, layout, frame scheduling, persistence, and visual feedback while rendering normalized snapshots from the session.

**Tech Stack:** Expo Router, React Native 0.81, TypeScript, Matter.js, Expo Haptics, Expo Secure Store, Node test runner, Codex in-app Browser.

## Global Constraints

- Support Web, iOS, and Android from one implementation.
- Include three lives, progressive levels, combo scoring, pause/restart, and local best score.
- Include piercing, multiball, and expanded-paddle power-ups.
- Mobile input is drag-to-steer plus tap-to-launch; Web also supports mouse, arrow keys, Space, and Escape.
- Do not add backend APIs, leaderboards, purchases, networking, or account sync.
- Preserve unrelated staged and working-tree changes already present in the repository.

---

## File Structure

- `frontend/features/games/brick-breaker-rules.ts`: pure rules reducer and public rule types.
- `frontend/features/games/brick-breaker-engine.ts`: Matter.js world, collisions, commands, and render snapshot.
- `frontend/features/games/brick-breaker-best-score.ts`: cross-platform local best-score persistence.
- `frontend/features/games/brick-breaker-game-screen.tsx`: responsive UI, controls, animations, and frame loop.
- `frontend/tests/brick-breaker-rules.test.mjs`: deterministic rules coverage.
- `frontend/tests/brick-breaker-engine.test.mjs`: Matter session smoke and boundary coverage.
- `frontend/features/games/game-detail-screen.tsx`: route dispatch for `brick-breaker`.
- `frontend/mocks/app-data.ts`: playable game registration.
- `frontend/types/app.ts`: game ID union.
- `frontend/features/home/home-screen.tsx`: four-game visibility and updated section copy.
- `frontend/package.json` and lockfiles: Matter.js, type package, and test scripts.

### Task 1: Pure Game Rules

**Files:**
- Create: `frontend/features/games/brick-breaker-rules.ts`
- Create: `frontend/tests/brick-breaker-rules.test.mjs`
- Modify: `frontend/package.json`

**Interfaces:**
- Produces: `createBrickBreakerRulesState()`, `reduceBrickBreakerRules(state, event)`, `BrickBreakerRulesState`, `BrickBreakerRulesEvent`, `BrickBreakerPowerUp`, and `BrickBreakerStatus`.
- Consumes: no platform APIs.

- [ ] **Step 1: Write failing reducer tests**

```js
const initial = createBrickBreakerRulesState();
assert.equal(initial.lives, 3);
assert.equal(reduceBrickBreakerRules(initial, { type: 'LAUNCH' }).status, 'playing');

const hit = reduceBrickBreakerRules(initial, { type: 'BRICK_DESTROYED', basePoints: 100 });
assert.equal(hit.score, 100);
assert.equal(hit.combo, 1);

const lost = reduceBrickBreakerRules({ ...initial, status: 'playing' }, { type: 'BALLS_LOST' });
assert.equal(lost.lives, 2);
assert.equal(lost.status, 'ready');
```

- [ ] **Step 2: Run the rules test and confirm the missing-module failure**

Run: `npm --prefix frontend run test:brick-breaker-rules`
Expected: FAIL because `brick-breaker-rules.ts` does not exist.

- [ ] **Step 3: Implement the immutable reducer**

```ts
export type BrickBreakerStatus = 'ready' | 'playing' | 'paused' | 'cleared' | 'lost';
export type BrickBreakerPowerUp = 'piercing' | 'multiball' | 'expand';

export function createBrickBreakerRulesState(): BrickBreakerRulesState {
  return { activeEffects: {}, combo: 0, level: 1, lives: 3, maxCombo: 0, score: 0, status: 'ready' };
}

export function reduceBrickBreakerRules(
  state: BrickBreakerRulesState,
  event: BrickBreakerRulesEvent,
): BrickBreakerRulesState {
  // Exhaustive switch for launch, pause, resume, brick hits, balls lost,
  // level cleared, power-up collection, effect ticking, and restart.
}
```

- [ ] **Step 4: Run the rules tests**

Run: `npm --prefix frontend run test:brick-breaker-rules`
Expected: PASS for initial state, scoring/combo, lives, pause, level clear, effects, and game over.

### Task 2: Matter.js Physics Session

**Files:**
- Create: `frontend/features/games/brick-breaker-engine.ts`
- Create: `frontend/tests/brick-breaker-engine.test.mjs`
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: rules types and reducer from Task 1.
- Produces: `createBrickBreakerSession(options?)`, `stepBrickBreakerSession(session, deltaMs)`, `launchBrickBreakerBall(session)`, `moveBrickBreakerPaddle(session, normalizedX)`, `pauseBrickBreakerSession(session)`, `resumeBrickBreakerSession(session)`, `restartBrickBreakerSession(session)`, `getBrickBreakerSnapshot(session)`, and `disposeBrickBreakerSession(session)`.

- [ ] **Step 1: Add Matter.js through the existing npm workspace**

Run: `npm install --workspace frontend matter-js && npm install --workspace frontend --save-dev @types/matter-js`
Expected: `frontend/package.json`, `frontend/package-lock.json`, and root `package-lock.json` record the dependency without removing existing scripts.

- [ ] **Step 2: Write failing engine tests**

```js
const session = createBrickBreakerSession({ random: () => 0.99 });
const before = getBrickBreakerSnapshot(session);
moveBrickBreakerPaddle(session, 2);
assert.ok(getBrickBreakerSnapshot(session).paddle.x <= 1);
launchBrickBreakerBall(session);
stepBrickBreakerSession(session, 32);
assert.notDeepEqual(getBrickBreakerSnapshot(session).balls[0], before.balls[0]);
disposeBrickBreakerSession(session);
```

- [ ] **Step 3: Run the engine test and confirm failure**

Run: `npm --prefix frontend run test:brick-breaker-engine`
Expected: FAIL because the session module does not exist.

- [ ] **Step 4: Implement the Matter.js world**

```ts
const WORLD_WIDTH = 360;
const WORLD_HEIGHT = 560;
const FIXED_STEP_MS = 1000 / 120;

export function stepBrickBreakerSession(session: BrickBreakerSession, deltaMs: number) {
  const boundedMs = Math.min(Math.max(deltaMs, 0), 50);
  for (let elapsed = 0; elapsed < boundedMs; elapsed += FIXED_STEP_MS) {
    Engine.update(session.engine, Math.min(FIXED_STEP_MS, boundedMs - elapsed));
  }
  // Remove lost balls, collect power-ups, tick effects, and advance levels.
}
```

Create static side/top walls, a kinematic paddle, sensor bottom boundary, circle balls, rectangular bricks, and sensor power-ups. Collision handlers update brick durability, adjust paddle rebound angle, dispatch rule events, and synchronize piercing sensors. Normalize all snapshot coordinates to `0..1`.

- [ ] **Step 5: Run both brick-breaker test suites**

Run: `npm --prefix frontend run test:brick-breaker-rules && npm --prefix frontend run test:brick-breaker-engine`
Expected: PASS.

### Task 3: Responsive Game Screen and Persistence

**Files:**
- Create: `frontend/features/games/brick-breaker-best-score.ts`
- Create: `frontend/features/games/brick-breaker-game-screen.tsx`

**Interfaces:**
- Consumes: all Task 2 session commands and snapshot types.
- Produces: `BrickBreakerGameScreen`.

- [ ] **Step 1: Implement best-score persistence using the Tetris pattern**

```ts
const bestScoreKey = 'funbox.brick-breaker.best-score.v1';
export async function getStoredBrickBreakerBestScore(): Promise<number>;
export async function setStoredBrickBreakerBestScore(score: number): Promise<void>;
```

- [ ] **Step 2: Implement the screen frame loop and cleanup**

```ts
const sessionRef = useRef(createBrickBreakerSession());
useEffect(() => {
  let frameId: number | undefined;
  // requestAnimationFrame on Web, fixed interval fallback on native.
  return () => {
    if (frameId !== undefined) cancelAnimationFrame(frameId);
    disposeBrickBreakerSession(sessionRef.current);
  };
}, []);
```

- [ ] **Step 3: Render the approved layout**

Render the app bar, score strip, fixed-aspect game field, bricks, balls, falling power-ups, paddle, edge-aligned combo/effect chips, drag steering area, launch button, and pause/lost bottom sheet. Use normalized coordinates so viewport changes do not mutate the physics world.

- [ ] **Step 4: Add mobile and Web controls**

Use `Pressable` pointer/touch movement to map the steering area to `moveBrickBreakerPaddle`. On Web, attach `keydown`/`keyup` handlers for ArrowLeft, ArrowRight, Space, and Escape; remove them on unmount. Buttons must have accessible names: `返回`, `暂停游戏`, `发球`, `继续游戏`, and `重新开始`.

- [ ] **Step 5: Run TypeScript-facing lint**

Run: `npm --prefix frontend run lint`
Expected: no new lint errors from the brick-breaker files.

### Task 4: Register the Game in FunBox

**Files:**
- Modify: `frontend/types/app.ts`
- Modify: `frontend/mocks/app-data.ts`
- Modify: `frontend/features/games/game-detail-screen.tsx`
- Modify: `frontend/features/home/home-screen.tsx`

**Interfaces:**
- Consumes: `BrickBreakerGameScreen` from Task 3.
- Produces: `/games/brick-breaker` and a visible homepage tile.

- [ ] **Step 1: Add the typed game ID and catalog entry**

```ts
export type GameId =
  | 'snake-brawl'
  | 'gomoku'
  | 'tetris'
  | 'brick-breaker'
  | 'brain-challenge'
  | 'speed-racer';
```

Register `打砖块`, genre `休闲街机`, accent `#ff7466`, route `/games/brick-breaker`, and status `playable`.

- [ ] **Step 2: Route the game detail page**

Import `BrickBreakerGameScreen` and return it when `game.id === 'brick-breaker'`, preserving the existing no-header route structure.

- [ ] **Step 3: Make all four playable games visible**

Change the home playable-game slice from `3` to `4` and the section metadata to `四款小游戏，随时开一局`.

- [ ] **Step 4: Run the complete focused test set and lint**

Run: `npm --prefix frontend run test:brick-breaker-rules && npm --prefix frontend run test:brick-breaker-engine && npm --prefix frontend run test:gomoku && npm --prefix frontend run lint`
Expected: all commands pass.

### Task 5: In-App Browser QA

**Files:**
- No committed files.

**Interfaces:**
- Consumes: running Expo Web app and `/games/brick-breaker`.
- Produces: DOM, console, screenshot, and interaction evidence.

- [ ] **Step 1: Start Expo Web on an available local port**

Run: `npm --prefix frontend run web -- --port 8081`
Expected: Expo reports a local Web URL; use another port only if 8081 is occupied.

- [ ] **Step 2: Open the game with the Codex in-app Browser**

Navigate to `http://localhost:8081/games/brick-breaker`, verify title/URL, capture a DOM snapshot and desktop screenshot, and read warning/error logs.

- [ ] **Step 3: Exercise the primary interaction**

Verify the unique `发球` control, click it, confirm the ball position changes, press `Escape`, and confirm `游戏暂停` plus `继续游戏` appear.

- [ ] **Step 4: Verify a narrow mobile viewport**

Set the in-app browser viewport capability to approximately `390x844`, reload, and confirm the score strip, field, steering control, launch button, and pause sheet fit without horizontal overflow or overlap. Capture a mobile screenshot.

- [ ] **Step 5: Run final console and static checks**

Confirm there is no framework overlay and no relevant warning/error log. Re-run the focused tests and `git diff --check` for touched files.
