# Market Radar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a production-quality, interactive `市场雷达` tool to the existing FunBox Expo application.

**Architecture:** Keep the bounded market snapshot and all ranking/detail selectors in a pure TypeScript module. Render an overview/detail state machine in one focused React Native screen, use `react-native-svg` for charts, and register the screen through the existing JSON-backed tool catalogue and dynamic route.

**Tech Stack:** Expo Router, React 19, React Native 0.81, TypeScript, MaterialCommunityIcons, react-native-svg, Node test runner.

## Global Constraints

- Preserve the approved visual reference at `docs/market-radar-product-design-v1.png`.
- Do not add a live market-data dependency or claim real-time values in V1.
- Preserve all unrelated dirty-worktree changes.
- Use the existing FunBox palette, mobile width, icon family, and route structure.
- Implement category, period, detail, back, and watch interactions as real local UI state.

---

### Task 1: Market Snapshot Domain Model

**Files:**
- Create: `frontend/lib/market-radar.ts`
- Test: `frontend/tests/market-radar.test.mjs`

**Interfaces:**
- Produces: `MARKET_CATEGORIES`, `MARKET_PERIODS`, `MARKET_SECTORS`, `getRankedMarketSectors(categoryId, period)`, `getMarketPulse(categoryId, period)`, and `getMarketSector(sectorId)`.
- Consumers: `frontend/features/tools/market-radar-screen.tsx`.

- [ ] **Step 1: Write the failing ranking and pulse tests**

```ts
assert.deepEqual(getRankedMarketSectors('ai', '1d').map((sector) => sector.id), [
  'cpo',
  'storage',
  'semiconductor',
  'ai-compute',
  'cloud',
]);
assert.deepEqual(getMarketPulse('ai', '1d'), {
  advancing: 5,
  declining: 0,
  score: 86,
  state: '强势',
  strongestSectorId: 'cpo',
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test --experimental-strip-types tests/market-radar.test.mjs` from `frontend/`.
Expected: FAIL because `lib/market-radar.ts` does not exist.

- [ ] **Step 3: Implement the snapshot types, fixtures, and pure selectors**

Create typed categories, periods, sector time-series, drivers, constituents, and the three exported selector functions. Sort with a copied array so calls never mutate fixture order.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test --experimental-strip-types tests/market-radar.test.mjs` from `frontend/`.
Expected: all market radar tests pass.

### Task 2: Tool Registration and Route Contract

**Files:**
- Modify: `backend/internal/access/feature_registry.json`
- Modify: `frontend/features/tools/tool-detail-screen.tsx`
- Test: `frontend/tests/market-radar.test.mjs`

**Interfaces:**
- Consumes: existing JSON registry and `/tools/[toolId]` route.
- Produces: the available `market-radar` catalogue entry and screen dispatch branch.

- [ ] **Step 1: Extend the failing test to require the catalogue entry**

Read `backend/internal/access/feature_registry.json` in the test and assert the `market-radar` entry has route `/tools/market-radar`, status `available`, and all four initial roles.

- [ ] **Step 2: Run the focused test and verify RED**

Expected: FAIL because the registry entry is absent.

- [ ] **Step 3: Add the registry definition and route dispatch**

Use icon `chart-timeline-variant-shimmer`, category `行情`, accent `#4b6bff`, and render `MarketRadarScreen` behind a hidden Expo stack header.

- [ ] **Step 4: Run the focused test and verify GREEN**

Expected: all market radar tests pass.

### Task 3: Interactive Market Radar Screen

**Files:**
- Create: `frontend/features/tools/market-radar-chart.tsx`
- Create: `frontend/features/tools/market-radar-screen.tsx`

**Interfaces:**
- Consumes: selectors and types from `frontend/lib/market-radar.ts`.
- Produces: the complete overview/detail tool surface.

- [ ] **Step 1: Build the reusable SVG charts**

Create `MarketSparkline` and `MarketTrendChart` components that derive stable SVG points from numeric series, render flat-series safely, and expose positive/negative color variants.

- [ ] **Step 2: Build the overview state**

Render the approved header, pulse hero, category segmented control, period segmented control, ranked rows, anomaly signal, snapshot label, and custom FunBox bottom navigation.

- [ ] **Step 3: Build the detail and watch states**

Open the selected sector in place, render chart/drivers/constituents/methodology, keep back inside the tool, and toggle local watch state with visible feedback.

- [ ] **Step 4: Run TypeScript and lint checks**

Run: `npx tsc --noEmit` and `npm run lint -- --max-warnings=0` from `frontend/`.
Expected: both exit successfully with no warnings.

### Task 4: Visual and Regression Verification

**Files:**
- Create during QA: `docs/market-radar-implementation-mobile.png`

**Interfaces:**
- Consumes: running Expo web application and approved concept image.
- Produces: verified functional and visual evidence.

- [ ] **Step 1: Run focused and existing test scripts**

Run every `test:*` script from `frontend/package.json`, including the focused market radar test.

- [ ] **Step 2: Start Expo web and exercise the route**

Open `/tools/market-radar`, switch category and period, open the first sector, toggle watch, and return to overview.

- [ ] **Step 3: Capture and compare mobile rendering**

Capture the overview and detail at a `430px`-class mobile viewport, then inspect both the accepted concept and latest implementation with `view_image`.

- [ ] **Step 4: Complete the fidelity ledger**

Check copy, hierarchy, palette, typography, icon treatment, spacing/container model, responsive behavior, and the core interaction path. Fix every material mismatch before handoff.

