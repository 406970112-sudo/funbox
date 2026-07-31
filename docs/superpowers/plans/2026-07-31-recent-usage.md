# 最近使用真实数据实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用用户真实进入工具或游戏详情页的数据替换“我的 > 最近使用”固定 mock，并最多展示最新 3 条。

**Architecture:** 使用纯 TypeScript 模块定义记录校验、去重、排序和三条上限；Web 与原生平台存储模块分别复用项目现有的 `localStorage`/`SecureStore` 模式。统一工具和游戏详情入口负责写入，“我的”页面在获得焦点时读取并映射到当前可见项目。

**Tech Stack:** Expo Router 6、React 19、React Native 0.81、TypeScript 5.9、Node test runner、Expo SecureStore。

## Global Constraints

- 工具和游戏都计入最近使用。
- 相同类型和项目 ID 去重，最新一次使用排第一。
- 持久化数据和界面都最多保留 3 条。
- Web 使用 `localStorage`，原生端使用 `SecureStore`，不新增后端或依赖。
- 损坏数据必须安全降级为空记录。
- 使用内置浏览器完成四个不同项目的真实点击验证。
- 只提交本功能相关文件，最终提交信息使用中文并带功能前缀。

---

### Task 1: 最近使用纯数据模型

**Files:**
- Create: `frontend/lib/recent-usage.ts`
- Create: `frontend/tests/recent-usage.test.mjs`
- Modify: `frontend/package.json`

**Interfaces:**
- Produces: `RecentUsageItem`、`MAX_RECENT_USAGE_ITEMS`、`addRecentUsage(items, item)`、`parseRecentUsage(value)`。
- Guarantees: 返回值按 `usedAt` 降序、按 `kind:itemId` 去重并截断为 3 条。

- [x] **Step 1: 写失败测试**

在 `frontend/tests/recent-usage.test.mjs` 中覆盖四条记录只保留最新三条、重复项目上浮、损坏数据过滤：

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { addRecentUsage, parseRecentUsage } from '../lib/recent-usage.ts';

test('keeps only the three most recently used items', () => {
  const items = [
    { kind: 'tool', itemId: 'one', usedAt: 1 },
    { kind: 'tool', itemId: 'two', usedAt: 2 },
    { kind: 'game', itemId: 'three', usedAt: 3 },
  ];
  assert.deepEqual(
    addRecentUsage(items, { kind: 'tool', itemId: 'four', usedAt: 4 }).map((item) => item.itemId),
    ['four', 'three', 'two'],
  );
});
```

- [x] **Step 2: 运行测试并确认 RED**

Run: `npm --prefix frontend run test:recent-usage`

Expected: FAIL，因为 `frontend/lib/recent-usage.ts` 尚不存在。

- [x] **Step 3: 实现最小纯数据模块**

实现结构校验、稳定排序、`kind:itemId` 去重和 `slice(0, 3)`；在 `frontend/package.json` 注册 `test:recent-usage`。

- [x] **Step 4: 运行测试并确认 GREEN**

Run: `npm --prefix frontend run test:recent-usage`

Expected: 所有最近使用测试通过，0 失败。

### Task 2: 跨平台持久化

**Files:**
- Create: `frontend/lib/recent-usage-store.ts`
- Create: `frontend/lib/recent-usage-storage.ts`
- Create: `frontend/lib/recent-usage-storage.web.ts`
- Create: `frontend/lib/recent-usage-storage.native.ts`
- Modify: `frontend/tests/recent-usage.test.mjs`

**Interfaces:**
- Consumes: Task 1 的 `RecentUsageItem`、`addRecentUsage`、`parseRecentUsage`。
- Produces: `createRecentUsageStore(readValue, writeValue)`，用任意字符串存储适配器实现读写、容错和原子读改写。
- Produces: `getStoredRecentUsage(): Promise<RecentUsageItem[]>` 与 `recordStoredRecentUsage(item): Promise<RecentUsageItem[]>`。

- [x] **Step 1: 写失败的存储行为测试**

扩展 `recent-usage.test.mjs`，使用内存字符串适配器创建真实 store，断言连续写入四个项目后原始 JSON 与 `get()` 都只包含最新三条；再用抛错读取适配器断言安全返回空数组。

- [x] **Step 2: 运行测试并确认 RED**

Run: `npm --prefix frontend run test:recent-usage`

Expected: FAIL，因为 `createRecentUsageStore` 尚未实现。

- [x] **Step 3: 实现平台存储模块**

实现通用 store 后，使用键 `funbox.recent-usage.v1`。Web 适配器读写 `window.localStorage`，原生适配器调用 `SecureStore.getItemAsync/setItemAsync`；读取或解析异常返回空数组，写入异常不阻断导航。

- [x] **Step 4: 运行测试并确认 GREEN**

Run: `npm --prefix frontend run test:recent-usage`

Expected: 全部通过。

### Task 3: 在统一详情入口记录真实使用

**Files:**
- Modify: `frontend/features/tools/tool-detail-screen.tsx`
- Modify: `frontend/features/games/game-detail-screen.tsx`

**Interfaces:**
- Consumes: `recordStoredRecentUsage`。
- Produces: 每次进入有效、可用工具或可玩游戏详情页时写入 `{ kind, itemId, usedAt: Date.now() }`。

- [x] **Step 1: 加入最小记录副作用**

在两个详情组件中使用 `useEffect`，只在项目存在且状态有效时调用 `recordStoredRecentUsage`；工具还必须通过 `canAccessTool`，依赖只使用稳定的 ID、状态和布尔访问结果，避免重渲染重复写入。

- [x] **Step 2: 运行现有测试和类型检查**

Run: `npm --prefix frontend run test:recent-usage`

Run: `npx tsc --noEmit -p frontend/tsconfig.json`

Expected: 两条命令通过；入口的真实写入副作用留待 Task 5 内置浏览器验证。

### Task 4: “我的”渲染真实最近使用

**Files:**
- Modify: `frontend/features/profile/profile-screen.tsx`
- Modify: `frontend/mocks/app-data.ts`
- Modify: `frontend/types/app.ts`

**Interfaces:**
- Consumes: `getStoredRecentUsage()`、`getToolById()`、`getGameById()`、当前 `visibleTools`。
- Produces: 最多 3 条工具/游戏卡片与无记录空状态。

- [x] **Step 1: 接入焦点刷新与统一展示模型**

用 `useFocusEffect` 和 `useCallback` 每次进入“我的”时读取记录；工具映射名称、tagline、图标和路由，游戏映射名称、genre、统一游戏图标和路由。过滤不可见/不可用项目，显示数量；空数组时显示“还没有使用记录”状态。删除 `RecentActivity` 类型及固定 mock。

- [x] **Step 2: 运行测试、lint 与类型检查**

Run: `npm --prefix frontend run test:recent-usage`

Run: `npm run frontend:lint`

Run: `npx tsc --noEmit -p frontend/tsconfig.json`

Expected: 三条命令均退出 0。

### Task 5: 内置浏览器验证、同步与推送

**Files:**
- Verify only: no screenshots or temporary browser scripts committed.

**Interfaces:**
- Consumes: 完整 Web 应用。
- Produces: 点击顺序、三条上限、刷新持久化和控制台健康的运行时证据。

- [x] **Step 1: 启动前后端并打开内置浏览器**

启动项目既有服务，确定实际 URL。按照 Browser 技能连接内置浏览器，并定义流程：`首页 -> 依次打开四个不同项目 -> 我的 -> 最新三条 -> 刷新后仍保持`。

- [x] **Step 2: 完成桌面和移动端交互验证**

清理键 `funbox.recent-usage.v1` 后依次进入四个不同项目。检查“我的”只展示最新三条且顺序正确；重复点击较旧项目后确认其上浮；刷新后确认不丢失。采集 DOM、截图和浏览器错误/警告日志。

- [x] **Step 3: 运行完成前验证**

Run: `npm --prefix frontend run test:recent-usage`

Run: `npm run frontend:lint`

Run: `npx tsc --noEmit -p frontend/tsconfig.json`

Expected: 所有命令退出 0，浏览器目标流程通过且无相关控制台错误。

- [x] **Step 4: 只暂存本功能文件并提交**

```powershell
git add frontend/lib/recent-usage.ts frontend/lib/recent-usage-store.ts frontend/lib/recent-usage-storage.ts frontend/lib/recent-usage-storage.web.ts frontend/lib/recent-usage-storage.native.ts frontend/tests/recent-usage.test.mjs frontend/package.json frontend/features/tools/tool-detail-screen.tsx frontend/features/games/game-detail-screen.tsx frontend/features/profile/profile-screen.tsx frontend/mocks/app-data.ts frontend/types/app.ts docs/superpowers/specs/2026-07-31-recent-usage-design.md docs/superpowers/plans/2026-07-31-recent-usage.md
git commit -m "feat: 使用真实数据展示最近使用"
```

- [x] **Step 5: 推送 main 并核验远端**

Run: `git push origin main`

Run: `git status --short --branch`

Run: `git ls-remote origin refs/heads/main`

Expected: 推送成功，`origin/main` 指向新提交；用户原有未提交文件仍保留且未进入本次提交。
