# Featured Carousel Ping-Pong Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change the featured carousel autoplay from one-way wrapping to endpoint-safe ping-pong movement: `A -> B -> C -> D -> C -> B -> A -> B -> ...`.

**Architecture:** Keep the rendered slide collection unchanged and move index progression into a small pure function with no React Native dependencies. The carousel owns the current autoplay direction in a ref, asks the helper for each next step, and keeps existing manual scrolling, pagination, reduced-motion, and app-state behavior.

**Tech Stack:** TypeScript, React 19, React Native 0.81, Expo 54, Node test runner, Expo Web, Codex in-app Browser.

## Global Constraints

- The continuous four-card sequence is exactly `A -> B -> C -> D -> C -> B -> A -> B -> ...`; neither endpoint pauses for a duplicate autoplay step.
- Do not duplicate rendered cards or change pagination count, card keys, accessibility labels, or manual navigation behavior.
- Preserve reduced-motion handling, background autoplay suspension, and the existing 5200 ms interval.
- Use the Codex in-app Browser for rendered validation; do not substitute an external browser.
- Do not stage or modify unrelated pre-existing working-tree changes.
- Commit messages use a Conventional Commit prefix and Chinese description, then push the verified result directly to `main`.

---

### Task 1: Pure Carousel Sequence

**Files:**
- Create: `frontend/features/home/featured-carousel-sequence.ts`
- Create: `frontend/tests/featured-carousel-sequence.test.mjs`
- Modify: `frontend/package.json`

**Interfaces:**
- Consumes: zero-based `index`, `direction` (`-1 | 1`), and `itemCount`.
- Produces: `getNextCarouselStep(index, direction, itemCount): { index: number; direction: CarouselDirection }`.

- [ ] **Step 1: Write the failing sequence tests**

Create `frontend/tests/featured-carousel-sequence.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { getNextCarouselStep } from '../features/home/featured-carousel-sequence.ts';

function collectIndices(itemCount, transitions) {
  const indices = [0];
  let state = { index: 0, direction: 1 };

  for (let step = 0; step < transitions; step += 1) {
    state = getNextCarouselStep(state.index, state.direction, itemCount);
    indices.push(state.index);
  }

  return indices;
}

test('moves four slides forward and backward without repeating endpoints', () => {
  assert.deepEqual(collectIndices(4, 7), [0, 1, 2, 3, 2, 1, 0, 1]);
});

test('moves two slides back and forth', () => {
  assert.deepEqual(collectIndices(2, 3), [0, 1, 0, 1]);
});

test('keeps a safe index when fewer than two slides are available', () => {
  assert.deepEqual(getNextCarouselStep(0, 1, 0), { index: 0, direction: 1 });
  assert.deepEqual(getNextCarouselStep(0, -1, 1), { index: 0, direction: 1 });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run from `frontend/`:

```bash
node --test --experimental-strip-types tests/featured-carousel-sequence.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `featured-carousel-sequence.ts`.

- [ ] **Step 3: Implement the minimal sequence helper**

Create `frontend/features/home/featured-carousel-sequence.ts`:

```ts
export type CarouselDirection = -1 | 1;

export type CarouselStep = {
  direction: CarouselDirection;
  index: number;
};

export function getNextCarouselStep(
  index: number,
  direction: CarouselDirection,
  itemCount: number,
): CarouselStep {
  if (itemCount < 2) {
    return { direction: 1, index: 0 };
  }

  const lastIndex = itemCount - 1;
  const normalizedIndex = Math.max(0, Math.min(index, lastIndex));

  if (normalizedIndex === 0) {
    return { direction: 1, index: 1 };
  }

  if (normalizedIndex === lastIndex) {
    return { direction: -1, index: lastIndex - 1 };
  }

  return { direction, index: normalizedIndex + direction };
}
```

- [ ] **Step 4: Add and run the focused test script**

Add to `frontend/package.json` scripts:

```json
"test:featured-carousel": "node --test --experimental-strip-types tests/featured-carousel-sequence.test.mjs"
```

Run from `frontend/`:

```bash
npm run test:featured-carousel
```

Expected: 3 tests pass with 0 failures.

---

### Task 2: Autoplay Integration

**Files:**
- Modify: `frontend/features/home/featured-tool-carousel.tsx`
- Test: `frontend/tests/featured-carousel-sequence.test.mjs`

**Interfaces:**
- Consumes: `getNextCarouselStep` and `CarouselDirection` from Task 1.
- Produces: each autoplay tick updates `activeIndexRef`, React state, direction, and list offset from one helper result.

- [ ] **Step 1: Import the sequence helper**

Add beside the existing local imports:

```ts
import {
  getNextCarouselStep,
  type CarouselDirection,
} from './featured-carousel-sequence';
```

- [ ] **Step 2: Store autoplay direction without adding renders**

Add after `activeIndexRef`:

```ts
const autoPlayDirectionRef = useRef<CarouselDirection>(1);
```

- [ ] **Step 3: Replace modulo wrapping with the helper result**

Replace the current `nextIndex` calculation and updates inside the autoplay interval with:

```ts
const nextStep = getNextCarouselStep(
  activeIndexRef.current,
  autoPlayDirectionRef.current,
  featuredSlides.length,
);
autoPlayDirectionRef.current = nextStep.direction;
activeIndexRef.current = nextStep.index;
setActiveIndex(nextStep.index);
listRef.current?.scrollToOffset({
  animated: true,
  offset: nextStep.index * cardStep,
});
```

Endpoint selection needs no separate reset: the helper always moves index `0` right and the final index left. Interior manual selection retains the existing direction.

- [ ] **Step 4: Run focused and static verification**

Run from `frontend/`:

```bash
npm run test:featured-carousel
npx tsc --noEmit
npm run lint
```

Expected: focused tests pass, TypeScript exits 0, and lint has no errors.

---

### Task 3: Rendered Browser Verification

**Files:**
- Verify only; do not commit screenshots, traces, or temporary scripts.

**Interfaces:**
- Consumes: Expo Web home route and the in-app Browser runtime.
- Produces: evidence for page identity, nonblank rendering, overlay absence, console health, actual sequence, pagination interaction, and visual layout.

- [ ] **Step 1: Start Expo Web on an available local port**

Run from `frontend/`, preferring port `8081`:

```powershell
npm run web -- --port 8081
```

Keep the server running until browser verification finishes. If `8081` is occupied, select the next free port and use that exact URL for all browser checks.

If the Expo development server listens but does not answer HTTP in the current runtime, verify the bundle and serve the generated output locally instead:

```powershell
$env:CI='1'
npx expo export --platform web --output-dir "$env:TEMP\funbox-carousel-web-export"
python -m http.server 8082 --directory "$env:TEMP\funbox-carousel-web-export"
```

This fallback must still be exercised through the Codex in-app Browser and must use an export generated from the current working tree.

- [ ] **Step 2: Connect the Codex in-app Browser and inspect the home page**

Navigate to the local Expo Web URL and verify:

- URL and title identify the intended app;
- the DOM snapshot contains the “精选功能” carousel and meaningful page content;
- no Expo, Metro, React, or Webpack error overlay is visible;
- console error and warning logs contain no relevant application failures;
- a viewport screenshot shows the carousel without clipping or overlap.

- [ ] **Step 3: Prove the automatic and manual sequence**

Observe the displayed carousel count across autoplay intervals and record the indices:

```text
01 -> 02 -> 03 -> 04 -> 03 -> 02 -> 01 -> 02
```

Click the fourth pagination control, verify `04 / 04`, wait one autoplay interval, and verify the next state is `03 / 04`.

- [ ] **Step 4: Recheck browser health after interaction**

Capture a fresh DOM snapshot, console error/warning log, and screenshot. Expected: meaningful content remains visible, no framework overlay appears, no relevant console failures are present, and pagination/layout remain coherent.

---

### Task 4: Final Verification, Commit, and Push

**Files:**
- Stage only: `docs/superpowers/plans/2026-07-31-featured-carousel-ping-pong.md`
- Stage only: `frontend/package.json`
- Stage only: `frontend/features/home/featured-carousel-sequence.ts`
- Stage only: `frontend/features/home/featured-tool-carousel.tsx`
- Stage only: `frontend/tests/featured-carousel-sequence.test.mjs`

**Interfaces:**
- Consumes: verified implementation and browser evidence.
- Produces: Chinese Conventional Commit on `main`, pushed to `origin/main`.

- [ ] **Step 1: Run fresh final verification**

Run from `frontend/`:

```bash
npm run test:featured-carousel
npx tsc --noEmit
npm run lint
```

Expected: all commands exit 0 with no test failures or lint errors.

- [ ] **Step 2: Audit the exact diff and staged paths**

Run from the repository root:

```bash
git diff --check
git diff -- frontend/package.json frontend/features/home/featured-carousel-sequence.ts frontend/features/home/featured-tool-carousel.tsx frontend/tests/featured-carousel-sequence.test.mjs docs/superpowers/plans/2026-07-31-featured-carousel-ping-pong.md
git status --short
```

Expected: the task diff matches this plan; unrelated pre-existing changes remain unstaged.

- [ ] **Step 3: Commit only the implementation files**

```bash
git add -- docs/superpowers/plans/2026-07-31-featured-carousel-ping-pong.md frontend/package.json frontend/features/home/featured-carousel-sequence.ts frontend/features/home/featured-tool-carousel.tsx frontend/tests/featured-carousel-sequence.test.mjs
git diff --cached --check
git diff --cached --name-status
git commit -m "fix: 调整精选轮播往返顺序"
```

Expected: the staged list contains only the five paths above and the commit succeeds on `main`.

- [ ] **Step 4: Confirm the remote has not advanced and push main**

```bash
git fetch origin main
git rev-list --count HEAD..origin/main
git push origin main
```

Expected: the behind count is `0`, then the push updates `origin/main` without force.
