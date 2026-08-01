# 双色球历史开奖记录查询 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有双色球统一入口中增加近 400 期官方历史开奖记录查询，并提供期号、日期、分页和详情交互。

**Architecture:** 复用现有开奖快照接口，新增纯函数查询模块作为可测试边界，React Native 页面只管理请求、筛选和详情状态。路由继续通过 feature registry 与 ToolDetailScreen 分发，视觉完全复用当前双色球页的颜色、间距和卡片语言。

**Tech Stack:** Expo 54、React Native 0.81、React 19、expo-router、Node 内置测试、TypeScript 5.9、Codex 内置 Browser。

## Global Constraints

- 直接在用户明确授权的 `main` 分支工作并最终推送 `origin/main`。
- 只提交本功能文件，保留并避开当前工作区其他未提交改动。
- 不新增 npm 依赖，不修改现有开奖后端接口。
- 测试必须使用 Codex 内置 Browser，不打开 Chrome、Edge 或其他外部浏览器。
- UI 与 `double-color-ball-hub-screen.tsx`、`double-color-ball-screen.tsx` 的现有视觉保持一致。
- MVP 只承诺接口实际返回的近期数据，页面显示实际覆盖期数，不写“全部历史”。

---

### Task 1: 历史查询纯函数

**Files:**
- Create: `frontend/lib/double-color-ball-history.ts`
- Create: `frontend/tests/double-color-ball-history.test.mjs`

**Interfaces:**
- Consumes: `SSQDraw` from `frontend/types/double-color-ball.ts`。
- Produces: `filterSSQHistoryDraws(draws, filters)`, `paginateSSQHistoryDraws(draws, visibleCount)`, `validateSSQHistoryFilters(filters)`, `formatSSQBall(number)`。

- [ ] **Step 1: Write the failing tests**

```js
test('filters newest-first draws by selected range and exact issue', () => {
  assert.deepEqual(
    filterSSQHistoryDraws(makeDraws(400), { range: 100, issue: '2026980', startDate: '', endDate: '' }).map((draw) => draw.issue),
    ['2026980'],
  );
});

test('validates date format and chronological order', () => {
  assert.equal(validateSSQHistoryFilters({ issue: '', startDate: '2026-08-02', endDate: '2026-08-01' }), '开始日期不能晚于结束日期');
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test --experimental-strip-types tests/double-color-ball-history.test.mjs`

Expected: FAIL because `../lib/double-color-ball-history.ts` does not exist.

- [ ] **Step 3: Implement minimal pure functions**

```ts
export function filterSSQHistoryDraws(draws: readonly SSQDraw[], filters: SSQHistoryFilters) {
  return draws.slice(0, filters.range).filter((draw) => {
    if (filters.issue && draw.issue !== filters.issue) return false;
    if (filters.startDate && draw.date < filters.startDate) return false;
    if (filters.endDate && draw.date > filters.endDate) return false;
    return true;
  });
}
```

- [ ] **Step 4: Run tests and verify GREEN**

Run: `node --test --experimental-strip-types tests/double-color-ball-history.test.mjs`

Expected: all history helper tests PASS with zero failures.

### Task 2: 路由与入口卡片

**Files:**
- Modify: `backend/internal/access/feature_registry.json`
- Modify: `frontend/features/tools/tool-detail-screen.tsx`
- Modify: `frontend/features/tools/double-color-ball-hub-screen.tsx`
- Test: `frontend/tests/double-color-ball-history.test.mjs`

**Interfaces:**
- Consumes: feature registry tool id `double-color-ball-history` and route `/tools/double-color-ball-history`。
- Produces: 可访问但 `hiddenFromList: true` 的工具记录、ToolDetailScreen 分发、Hub 入口跳转。

- [ ] **Step 1: Add a failing registry contract test**

```js
test('registers history results as a hidden available tool for every role', () => {
  const tool = registry.find((item) => item.id === 'double-color-ball-history');
  assert.ok(tool);
  assert.equal(tool.route, '/tools/double-color-ball-history');
  assert.equal(tool.hiddenFromList, true);
  assert.deepEqual(tool.initialRoles, ['normal', 'vip', 'svip', 'admin']);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test --experimental-strip-types tests/double-color-ball-history.test.mjs`

Expected: FAIL because the registry entry is missing.

- [ ] **Step 3: Add registry, route dispatch, and matching card**

Add the hidden registry item, import/render `DoubleColorBallHistoryScreen`, and place a green `calendar-search` card immediately after the hub hero with copy from the approved PRD.

- [ ] **Step 4: Run the test and verify GREEN**

Run: `node --test --experimental-strip-types tests/double-color-ball-history.test.mjs`

Expected: all tests PASS.

### Task 3: 历史查询页面

**Files:**
- Create: `frontend/features/tools/double-color-ball-history-screen.tsx`
- Modify: `frontend/features/tools/tool-detail-screen.tsx`

**Interfaces:**
- Consumes: `fetchSSQHistory`, query helpers, `SSQHistorySnapshot`, app theme, expo-router。
- Produces: loading/error/ready/detail states,期号/日期查询、30/100/400 范围、30 条加载更多和来源说明。

- [ ] **Step 1: Implement only behavior covered by Task 1 tests**

The screen calls `fetchSSQHistory`, validates on query submit, renders filtered/paginated data, and uses a local selected draw for detail state. No new helper behavior is added inside the component.

- [ ] **Step 2: Run focused and existing双色球 tests**

Run: `node --test --experimental-strip-types tests/double-color-ball-history.test.mjs tests/double-color-ball.test.mjs`

Expected: all tests PASS with zero failures.

- [ ] **Step 3: Run static validation**

Run: `npx tsc --noEmit`

Run: `npm run lint`

Expected: both commands exit 0.

- [ ] **Step 4: Export the Web build**

Run: `npx expo export --platform web --output-dir <temporary-directory>`

Expected: export exits 0 and emits the route bundle without compile errors.

### Task 4: Codex 内置 Browser 验收

**Files:**
- No repository files.

**Interfaces:**
- Consumes: local Expo Web URL and the implemented routes。
- Produces: DOM、控制台、交互和移动/桌面截图证据。

- [ ] **Step 1: Start Expo Web without opening a browser**

Run: `npx expo start --web --port 8087 --non-interactive`

Expected: local development server is available at `http://127.0.0.1:8087`.

- [ ] **Step 2: Use only Codex in-app Browser**

Open `/tools/double-color-ball-hub`, verify page identity/nonblank/overlay/console, click “查看历史开奖”, and confirm `/tools/double-color-ball-history` renders.

- [ ] **Step 3: Exercise the target flow**

Verify range switching, issue search, invalid date message, result detail, back-to-list state retention, and load-more where data permits.

- [ ] **Step 4: Check responsive rendering**

Capture one mobile viewport and one desktop viewport. Check text clipping, overlap, scroll, empty/error messaging, card order and visual consistency against the supplied reference.

### Task 5: Completion audit, commit, and push

**Files:**
- All files listed above plus `docs/ssq-history-results-prd-v1.0.docx`, this spec, and this plan.

**Interfaces:**
- Consumes: fresh test/build/browser evidence and scoped git diff。
- Produces: one or more Chinese conventional commits pushed to `origin/main` without unrelated files。

- [ ] **Step 1: Run the full feature verification again**

Run focused tests, `npx tsc --noEmit`, `npm run lint`, and Web export; repeat required Browser checks after the final code state.

- [ ] **Step 2: Audit requirements against evidence**

Confirm entry, route, loading/error/cache, query, paging, detail, responsive behavior, no external browser use, and no unrelated staged changes.

- [ ] **Step 3: Stage only scoped files**

Run `git add` with an explicit list of the feature, test, registry, spec, plan, and PRD paths. Inspect `git diff --cached --stat` and `git diff --cached`.

- [ ] **Step 4: Commit in Chinese with a feature prefix**

Run: `git commit -m "feat: 新增双色球历史开奖结果查询"`

- [ ] **Step 5: Push main**

Run: `git push origin main`

Expected: remote reports the new commit on `origin/main`.
