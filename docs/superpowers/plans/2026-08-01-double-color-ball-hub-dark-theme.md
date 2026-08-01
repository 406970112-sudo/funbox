# 双色球入口深色模式 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让双色球二级入口的三张卡片完整响应深色模式，并移除全部状态标签。

**Architecture:** 在入口组件旁新增纯函数配色模块，根据 `light | dark` 返回三张卡片的背景、边框和图标底色。组件只消费该配色结果，自动测试直接验证纯函数输出与无标签结构，浏览器验证负责最终渲染与交互。

**Tech Stack:** React Native、Expo Router、TypeScript、Node.js test runner、Codex 内置浏览器

## Global Constraints

- 只使用 Codex 内置浏览器进行渲染验证，不打开外部浏览器。
- 只修改双色球二级入口及其测试，不改变路由和业务逻辑。
- 提交信息使用中文并带 `fix:` 前缀，最终直接推送到 `main`。

---

### Task 1: 主题配色与标签回归测试

**Files:**
- Create: `frontend/features/tools/double-color-ball-hub-theme.ts`
- Create: `frontend/tests/double-color-ball-hub-theme.test.mjs`
- Modify: `frontend/package.json`

**Interfaces:**
- Produces: `getDoubleColorBallHubPalette(colorScheme: 'light' | 'dark')`，返回 `reference`、`labV2`、`labV1` 三套 `background`、`border`、`iconBackground` 配色。

- [ ] **Step 1: 写失败测试**

  覆盖浅色与深色配色应不同、深色 V2/V1 不再使用浅色背景，以及标签配置为空。

- [ ] **Step 2: 验证测试因模块缺失而失败**

  Run: `npm run test:ssq-hub`
  Expected: FAIL，提示找不到 `double-color-ball-hub-theme.ts`。

- [ ] **Step 3: 实现最小配色模块**

  定义只读的浅色与深色卡片 palette，并导出纯函数。

- [ ] **Step 4: 验证测试通过**

  Run: `npm run test:ssq-hub`
  Expected: PASS，全部断言通过。

### Task 2: 入口组件接入主题配色

**Files:**
- Modify: `frontend/features/tools/double-color-ball-hub-screen.tsx`

**Interfaces:**
- Consumes: `getDoubleColorBallHubPalette(colorScheme)`。

- [ ] **Step 1: 移除三张卡片的标签节点和标签样式**

  删除“已有功能”“新功能”“经典版”及 `badge`、`badgeText` 样式。

- [ ] **Step 2: 接入三套主题 palette**

  将卡片背景、边框、图标底色改为 palette 值，并删除 V2/V1 写死的浅色卡片样式。

- [ ] **Step 3: 运行静态检查和相关测试**

  Run: `npm run lint -- --no-cache`
  Expected: exit 0。

  Run: `npm run test:ssq-hub && npm run test:ssq && npm run test:ssq-lab && npm run test:ssq-lab-classic`
  Expected: exit 0。

### Task 3: Codex 内置浏览器验证与交付

**Files:**
- Modify: none

**Interfaces:**
- Consumes: 本地 Expo Web 页面。

- [ ] **Step 1: 启动不自动打开浏览器的本地服务**

  Run: `npx expo start --web --non-interactive`
  Expected: 输出本地访问 URL，且不唤起外部浏览器。

- [ ] **Step 2: 在 Codex 内置浏览器验证深色桌面视口**

  检查页面身份、非空、无错误遮罩、控制台健康、卡片颜色和标签移除。

- [ ] **Step 3: 在 Codex 内置浏览器验证深色移动视口与入口跳转**

  检查 390 x 844 下无溢出或遮挡，并点击一个入口确认路由变化。

- [ ] **Step 4: 提交并推送**

  Run: `git commit -m "fix: 修复双色球入口深色模式卡片"`

  Run: `git push origin main`

  Expected: 两条命令均 exit 0，远端 `main` 指向新提交。

