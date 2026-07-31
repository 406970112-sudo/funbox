# Game Card Artwork Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the homepage's generic game icons with four distinct, theme-aware SVG gameplay scenes for Snake, Gomoku, Tetris, and Brick Breaker.

**Architecture:** Keep `GameTile` responsible for card layout and navigation, move game-ID selection into a pure mapping helper, and render each scene through a focused `GameArtwork` component backed by `react-native-svg`. A pure mapping test prevents any supported game from silently falling through to another game's artwork.

**Tech Stack:** React 19, React Native 0.81, Expo 54, TypeScript, `react-native-svg` 15.12, Node test runner, Expo ESLint, Expo Web.

## Global Constraints

- Preserve the existing game card dimensions, title, genre, ordering, routes, press behavior, and accessibility target.
- Render each scene in a shared `64 × 48` SVG view box inside the existing `58`-pixel visual area.
- Keep the current green, brown-orange, blue, and coral-red game identity colors.
- Remove the separate circular play icon from the card artwork area.
- Do not load bitmap, remote, or network assets.
- Support Web, iOS, Android, light mode, and dark mode through the existing theme inputs.
- Unknown game IDs must render a neutral controller fallback instead of reusing a supported game's scene.

---

### Task 1: Lock Down Artwork Selection

**Files:**
- Create: `frontend/features/home/game-artwork-kind.ts`
- Create: `frontend/tests/game-artwork.test.mjs`

**Interfaces:**
- Consumes: a game ID string from `GameItem['id']` or future data.
- Produces: `GameArtworkKind` and `getGameArtworkKind(gameId: string): GameArtworkKind`.

- [ ] **Step 1: Write the failing mapping test**

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { getGameArtworkKind } from '../features/home/game-artwork-kind.ts';

test('maps every playable homepage game to distinct artwork', () => {
  const ids = ['snake-brawl', 'gomoku', 'tetris', 'brick-breaker'];
  const kinds = ids.map(getGameArtworkKind);

  assert.deepEqual(kinds, ['snake', 'gomoku', 'tetris', 'brick-breaker']);
  assert.equal(new Set(kinds).size, ids.length);
});

test('uses a neutral fallback for unknown games', () => {
  assert.equal(getGameArtworkKind('future-game'), 'fallback');
});
```

- [ ] **Step 2: Run the test and verify the missing module failure**

Run from `frontend`:

```powershell
node --test --experimental-strip-types tests/game-artwork.test.mjs
```

Expected: FAIL because `features/home/game-artwork-kind.ts` does not exist.

- [ ] **Step 3: Implement the exhaustive mapping helper**

```ts
export type GameArtworkKind =
  | 'snake'
  | 'gomoku'
  | 'tetris'
  | 'brick-breaker'
  | 'fallback';

export function getGameArtworkKind(gameId: string): GameArtworkKind {
  switch (gameId) {
    case 'snake-brawl':
      return 'snake';
    case 'gomoku':
      return 'gomoku';
    case 'tetris':
      return 'tetris';
    case 'brick-breaker':
      return 'brick-breaker';
    default:
      return 'fallback';
  }
}
```

- [ ] **Step 4: Run the mapping test and verify it passes**

Run:

```powershell
node --test --experimental-strip-types tests/game-artwork.test.mjs
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit the tested mapping**

```powershell
git add frontend/features/home/game-artwork-kind.ts frontend/tests/game-artwork.test.mjs
git commit -m "test: lock game artwork mappings"
```

---

### Task 2: Build and Integrate the Gameplay Scenes

**Files:**
- Create: `frontend/features/home/game-artwork.tsx`
- Modify: `frontend/features/home/home-screen.tsx:1-7`
- Modify: `frontend/features/home/home-screen.tsx:110-139`
- Modify: `frontend/features/home/home-screen.tsx:363-378`

**Interfaces:**
- Consumes: `gameId: string`, `accentColor: string`, `contrastColor: string`, and `mutedColor: string`.
- Produces: `GameArtwork(props): React.JSX.Element`, a decorative `64 × 48` SVG scene with `accessible={false}`.

- [ ] **Step 1: Create the focused SVG component**

Create `game-artwork.tsx` with this public interface and scene dispatch:

```tsx
type GameArtworkProps = {
  accentColor: string;
  contrastColor: string;
  gameId: string;
  mutedColor: string;
};

export function GameArtwork(props: GameArtworkProps) {
  const kind = getGameArtworkKind(props.gameId);

  return (
    <Svg
      accessible={false}
      viewBox="0 0 64 48"
      width="100%"
      height="100%">
      {kind === 'snake' ? <SnakeScene {...props} /> : null}
      {kind === 'gomoku' ? <GomokuScene {...props} /> : null}
      {kind === 'tetris' ? <TetrisScene {...props} /> : null}
      {kind === 'brick-breaker' ? <BrickBreakerScene {...props} /> : null}
      {kind === 'fallback' ? <FallbackScene {...props} /> : null}
    </Svg>
  );
}
```

Implement the four scenes with shared rounded geometry and these exact visual elements:

- `SnakeScene`: an 8-pixel rounded snake path from `(8,36)` through `(29,18)` to `(45,11)`, a white eye at `(47,9)`, and a coral fruit centered at `(55,34)` with a green leaf stroke.
- `GomokuScene`: four vertical and three horizontal brown-orange board lines, three dark stones on the rising diagonal, and two light stones on the opposite diagonal.
- `TetrisScene`: a five-cell blue bottom row, two green stacks around a one-cell gap, one orange zig-zag falling piece, and a subtle dashed landing guide.
- `BrickBreakerScene`: two staggered coral brick rows, a themed dashed bounce path, a light ball centered at `(34,25)`, a dark rounded paddle, and a two-stroke break mark on the right brick.
- `FallbackScene`: a centered controller outline using `Path`, two small action circles, and a directional cross in `mutedColor`.

Use `Circle`, `G`, `Line`, `Path`, and `Rect` from `react-native-svg`. Keep every primitive inside the fixed view box and use round line caps/joins where the gameplay motion path changes direction.

- [ ] **Step 2: Replace the generic icon composition in `GameTile`**

Import `GameArtwork`, delete the ternary `icon` selection, replace the nested `gameIcon` plus `play-circle` elements with:

```tsx
<View style={[styles.gameVisual, { backgroundColor: `${game.accentColor}1c` }]}>
  <View style={styles.gameArtwork}>
    <GameArtwork
      accentColor={game.accentColor}
      contrastColor={colors.text}
      gameId={game.id}
      mutedColor={colors.mutedText}
    />
  </View>
</View>
```

Update `gameVisual` to center one fixed artwork canvas:

```ts
gameVisual: {
  alignItems: 'center',
  borderRadius: 13,
  height: 58,
  justifyContent: 'center',
  marginBottom: 10,
  overflow: 'hidden',
  paddingHorizontal: 8,
},
gameArtwork: {
  height: 48,
  width: 64,
},
```

Remove the unused `gameIcon` style after adding the fixed `gameArtwork` wrapper.

- [ ] **Step 3: Run automated verification**

Run from `frontend`:

```powershell
node --test --experimental-strip-types tests/game-artwork.test.mjs
npm run lint
npx expo export --platform web --output-dir "$env:TEMP\funbox-game-artwork-export"
```

Expected: mapping tests pass, lint exits with no errors, and Expo reports a completed web export.

- [ ] **Step 4: Verify the homepage in desktop and mobile browsers**

Start Expo Web on an unused port from `frontend`, then inspect the homepage at desktop and mobile widths. Confirm:

- The four scenes read as snake-and-fruit, board-and-stones, stacked tetrominoes, and ball-paddle-bricks.
- No card height, title, genre, or grid spacing changes.
- The scenes remain centered and unclipped at both widths.
- Light and dark themes preserve visible contrast.
- Clicking each card still navigates to its matching route.
- The browser console has no related warnings or errors.

Capture one desktop and one mobile screenshot for final comparison with the approved A-direction concept.

- [ ] **Step 5: Commit the artwork integration**

```powershell
git add frontend/features/home/game-artwork.tsx frontend/features/home/home-screen.tsx
git commit -m "feat: add gameplay artwork to game cards"
```

---

### Task 3: Final Fidelity Review

**Files:**
- Review: `frontend/features/home/game-artwork.tsx`
- Review: `frontend/features/home/home-screen.tsx`
- Review: captured desktop and mobile screenshots

**Interfaces:**
- Consumes: the approved A-direction visual and the browser screenshots.
- Produces: a verified homepage with no remaining material visual mismatches.

- [ ] **Step 1: Compare five fidelity points**

Record and correct any mismatch in: scene metaphor, original card geometry, identity color, artwork centering, and mobile legibility.

- [ ] **Step 2: Re-run the focused test and lint after visual fixes**

```powershell
node --test --experimental-strip-types tests/game-artwork.test.mjs
npm run lint
```

Expected: all focused tests pass and lint exits with no errors.

- [ ] **Step 3: Confirm the final diff is scoped**

```powershell
git status --short
git diff --check HEAD~2..HEAD
git diff --stat HEAD~2..HEAD
```

Expected: only the specification, plan, mapping, test, artwork component, and homepage integration are changed; no generated export or screenshot is committed.
