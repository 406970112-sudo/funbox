# Novel Agent Workflow Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the local Novel Agent MVP from a linear demo into a structured, reviewable workflow with chapter/scene cards, multidimensional review routing, user-directed revisions, and resumable workflow snapshots.

**Architecture:** Keep the current `R → A → B → C → memory` sequence, but make each handoff a typed artifact rather than free-form text. A will produce chapter and scene cards, B will receive an assembled scene context, C will run independent quality/style/originality/safety checks in parallel and aggregate a route, and the UI will preserve user revisions and snapshot state locally. Real provider calls and server persistence remain future adapters.

**Tech Stack:** TypeScript, React Native / Expo, AsyncStorage, Node test runner with `--experimental-strip-types`.

**Spec:** `outputs/novel-agent-mvp/technical-plan.md`, sections 15, 16, 17, 19, and the 2026-09-20 workflow optimization assessment.

## Global Constraints

- Do not add a real model provider, API key, server endpoint, or database in this iteration.
- Preserve the existing A approval gate: B cannot write until the user confirms the outline.
- Keep author style higher priority than reference style and never pass copied reference prose into the draft context.
- Keep the current `/tools/novel-agent` route and FunBox visual language.
- Keep the workflow usable on mobile widths and PC widths without horizontal overflow.
- Preserve existing tests and add focused tests for every new pure workflow behavior.
- Treat a local snapshot as resumable UI state, not as durable multi-user persistence.

## Review Focus

- A plan approval must create chapter and scene cards without allowing B to run early.
- A revision must preserve the selected scene's structure and record a new immutable version.
- Review routing must distinguish local, structural, originality, and safety problems.
- A malformed or old snapshot must be ignored safely instead of producing fake story data.
- Empty user feedback must not start a revision, and long feedback must remain readable on mobile.

---

### Task 1: Define structured writing artifacts

**Files:**
- Create: `frontend/lib/novel-agent-artifacts.ts`
- Test: `frontend/tests/novel-agent-artifacts.test.mjs`

**Interfaces:**
- Produces `NovelChapterCard`, `NovelSceneCard`, `NovelMemoryState`, `NovelWritingContext`, `NovelRevisionRequest`, `NovelRevisionRecord`, and `NovelWorkflowSnapshot` types.
- Produces `createChapterCards(outline: NovelOutline): NovelChapterCard[]`.
- Produces `createSceneCards(chapter: NovelChapterCard): NovelSceneCard[]`.
- Produces `createInitialMemoryState(outline: NovelOutline): NovelMemoryState`.
- Produces `assembleWritingContext(input): NovelWritingContext`.
- Produces `createRevisionRequest(input): NovelRevisionRequest | null`.

- [ ] **Step 1: Write failing tests for chapter and scene card generation**

Add tests that create the existing demo outline and assert that every chapter has a stable `chapterId`, every scene has a stable `sceneId`, scene goals inherit the chapter beat, and each card contains `mustKeep`, `mustAvoid`, and a target ending.

- [ ] **Step 2: Run the focused test file and verify the expected missing-export failure**

Run: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --experimental-strip-types tests/novel-agent-artifacts.test.mjs`

Expected: FAIL because `frontend/lib/novel-agent-artifacts.ts` and its builders do not exist yet.

- [ ] **Step 3: Implement the artifact types and deterministic builders**

Use the existing outline beats and chapter labels to create stable ids such as `ch-001` and `ch-001-scene-001`. Keep builders pure and deterministic. Do not use model calls, timestamps, or random ids.

- [ ] **Step 4: Add context assembly and revision request validation**

`assembleWritingContext` must include only the approved outline, one scene card, relevant memory, selected style dimensions, and optional prior review issue. `createRevisionRequest` must return `null` for blank feedback and normalize category/scope to the supported unions.

- [ ] **Step 5: Run the focused test and commit the artifact boundary**

Run: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --experimental-strip-types tests/novel-agent-artifacts.test.mjs`

Expected: PASS. Commit with: `git add frontend/lib/novel-agent-artifacts.ts frontend/tests/novel-agent-artifacts.test.mjs && git commit -m "feat: 增加小说章节场景制品"`.

### Task 2: Upgrade the workflow runner and review router

**Files:**
- Create: `frontend/lib/novel-agent-review.ts`
- Modify: `frontend/lib/novel-agent-workflow.ts`
- Test: `frontend/tests/novel-agent-workflow.test.mjs`

**Interfaces:**
- `runReferencePlan` returns `NovelPlan` with `chapterCards`, `sceneCards`, and `memory` in addition to the existing reference and outline.
- `runWritingReview` returns a draft with `revisionHistory`, a structured `NovelReviewReport`, and a memory update.
- `runReviewChecks(input): Promise<NovelReviewCheck[]>` runs quality, style, originality, and safety checks with `Promise.all`.
- `aggregateReviewChecks(checks): NovelReviewReport` chooses `PASS`, `B_REWRITE`, `REOPEN_PLANNING`, or `HUMAN_REVIEW` based on severity and evidence.

- [ ] **Step 1: Extend tests with multidimensional review expectations**

Assert that the first demo review contains four named checks, exposes issue location/severity/route, runs local problems through `B_REWRITE`, and routes a synthetic safety issue to `HUMAN_REVIEW` without automatic rewriting.

- [ ] **Step 2: Run the updated workflow tests and verify they fail for the new report shape**

Run: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --experimental-strip-types tests/novel-agent-workflow.test.mjs`

Expected: FAIL because the current review has only three categories and no route/evidence structure.

- [ ] **Step 3: Implement independent deterministic checkers and the aggregator**

Keep the demo deterministic, but model the production boundary: each checker returns `{ id, status, severity, evidence, issues }`; the aggregator owns routing. A score is derived only after the route is chosen and must not be the sole gate.

- [ ] **Step 4: Integrate chapter cards, scene context, review routing, and memory preflight/postflight**

The runner must assemble a scene context before B writes, perform a canonical-fact preflight, run parallel checks after B, apply only local automatic rework, and update memory only after the final report passes. Structural, safety, or originality routes must stop automatic rewriting.

- [ ] **Step 5: Run novel-agent tests and commit the runner change**

Run: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --experimental-strip-types tests/novel-agent-workflow.test.mjs tests/novel-agent-artifacts.test.mjs`

Expected: PASS. Commit with: `git add frontend/lib/novel-agent-review.ts frontend/lib/novel-agent-workflow.ts frontend/tests/novel-agent-workflow.test.mjs && git commit -m "feat: 增加小说多维复核路由"`.

### Task 3: Add immutable user-directed revisions

**Files:**
- Modify: `frontend/lib/novel-agent-artifacts.ts`
- Modify: `frontend/lib/novel-agent-workflow.ts`
- Test: `frontend/tests/novel-agent-artifacts.test.mjs`

**Interfaces:**
- Produces `reviseNovelDraft(draft, request, context): NovelDraft`.
- `NovelDraft` gains `sceneId`, `revisionHistory`, `activeRevisionId`, and `lastRevisionRequest`.
- Every revision preserves the original draft in history and increments a monotonic revision number.

- [ ] **Step 1: Write failing tests for blank feedback, targeted scene feedback, and version preservation**

Assert that blank feedback returns no revision request, a valid request changes only the selected scene content, the chapter hook and source facts remain unchanged, and the old revision remains recoverable in `revisionHistory`.

- [ ] **Step 2: Run the focused test and verify it fails before implementation**

Run: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --experimental-strip-types tests/novel-agent-artifacts.test.mjs`

Expected: FAIL because `reviseNovelDraft` and the revision metadata do not exist.

- [ ] **Step 3: Implement the smallest deterministic revision adapter**

The demo adapter should add the normalized user feedback to the selected scene's draft metadata and produce a visibly different revision while preserving structural fields. It must not pretend to call a model.

- [ ] **Step 4: Run focused and workflow tests, then commit**

Run: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --experimental-strip-types tests/novel-agent-artifacts.test.mjs tests/novel-agent-workflow.test.mjs`

Expected: PASS. Commit with: `git add frontend/lib/novel-agent-artifacts.ts frontend/lib/novel-agent-workflow.ts frontend/tests/novel-agent-artifacts.test.mjs && git commit -m "feat: 支持小说正文定向返工版本"`.

### Task 4: Expose cards, review evidence, and revision controls in the screen

**Files:**
- Modify: `frontend/features/tools/novel-agent-screen.tsx`
- Modify: `frontend/tests/novel-agent-layout.test.mjs` only if a new responsive helper is needed

**Interfaces:**
- After approval, show chapter and scene cards before B output.
- Show C's four check results, route, severity, evidence, and issue locations.
- Add feedback category, revision scope, feedback text, and `让 B 修改` controls.
- Keep the existing mobile single-column and PC two-column arrangement.

- [ ] **Step 1: Add a screen-level behavior test seam before editing UI**

If the existing test setup cannot render React Native screens, export a pure `getNovelRevisionControlState` helper from the workflow/artifact layer and test that blank feedback disables revision while a valid request enables it. Do not add a new UI test framework dependency.

- [ ] **Step 2: Run the helper test and verify the new behavior is absent**

Run the focused artifact test and confirm the new state helper is missing or returns the old state before implementation.

- [ ] **Step 3: Add the UI sections and wire the handlers**

Keep event handlers functional and use functional state updates. When a revision is submitted, update the draft, append to the visible revision history, rerun the local review adapter, and keep the user on the current scene. Show an explicit “演示适配器，未调用真实模型” label near the revision control.

- [ ] **Step 4: Run lint, typecheck, focused tests, and full tests**

Run from `frontend`:

```powershell
npm run lint
npx tsc --noEmit
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --experimental-strip-types tests/novel-agent-workflow.test.mjs tests/novel-agent-artifacts.test.mjs tests/novel-agent-layout.test.mjs
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --experimental-strip-types tests/*.test.mjs
```

Expected: all commands pass; full suite remains at or above the 381 baseline tests.

- [ ] **Step 5: Commit the screen integration**

Commit with: `git add frontend/features/tools/novel-agent-screen.tsx frontend/lib/novel-agent-artifacts.ts frontend/tests/novel-agent-artifacts.test.mjs && git commit -m "feat: 完善小说工坊复核与返工交互"`.

### Task 5: Add local workflow snapshot recovery

**Files:**
- Create: `frontend/lib/novel-agent-snapshot.ts`
- Modify: `frontend/features/tools/novel-agent-screen.tsx`
- Test: `frontend/tests/novel-agent-snapshot.test.mjs`

**Interfaces:**
- `serializeNovelWorkflow(snapshot: NovelWorkflowSnapshot): string`.
- `restoreNovelWorkflow(raw: string | null): NovelWorkflowSnapshot | null`.
- Snapshot schema includes a version number and only approved workflow artifacts, draft versions, review report, and memory state.

- [ ] **Step 1: Write failing tests for round-trip and malformed snapshots**

Assert that a valid snapshot round-trips without losing revision history, a malformed JSON string returns `null`, an unsupported version returns `null`, and no raw reference prose is stored in the draft context.

- [ ] **Step 2: Run the focused test and verify the expected missing-module failure**

Run: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --experimental-strip-types tests/novel-agent-snapshot.test.mjs`

Expected: FAIL because the snapshot module does not exist.

- [ ] **Step 3: Implement versioned serialization and safe restoration**

Use JSON serialization only, validate the top-level version and required object fields, and return `null` for anything that cannot be trusted. Keep storage adapter concerns outside the pure module.

- [ ] **Step 4: Connect AsyncStorage at the screen boundary**

Load the latest valid snapshot on mount, save after approved-plan, draft, review, and revision state changes, and clear it on reset. Do not block first paint on storage; fall back to the empty state when storage is unavailable.

- [ ] **Step 5: Run all verification commands and commit**

Run the focused snapshot test, novel-agent tests, full test suite, `npm run lint`, `npx tsc --noEmit`, and `git diff --check`. Commit with: `git add frontend/lib/novel-agent-snapshot.ts frontend/features/tools/novel-agent-screen.tsx frontend/tests/novel-agent-snapshot.test.mjs && git commit -m "feat: 增加小说工作流快照恢复"`.

## Final Integration Checklist

- [ ] Review the diff for accidental changes outside the novel-agent feature and plan files.
- [ ] Run the frontend full test suite and record the exact pass count.
- [ ] Run lint, TypeScript, and `git diff --check` from the correct `frontend` / repo directories.
- [ ] Start the Expo web app and verify `/tools/novel-agent` at a mobile viewport and a PC viewport.
- [ ] Verify the path `R → A approval → cards → B → parallel C checks → local revision → memory/snapshot` in the browser.
- [ ] Update `outputs/novel-agent-mvp/technical-plan.md` with implemented decisions, tests, and remaining real-provider limitations.
