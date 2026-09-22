# 需求方案模板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 Funbox 工具目录中新增一个本地需求方案模板工具，让用户输入需求后只替换固定提示词中的占位内容，并可预览和复制完整结果。

**Architecture:** 以现有 Expo Router 工具链为入口，通过 `feature_registry.json` 注册工具，由 `ToolDetailScreen` 按工具 ID 分发到新的 React Native 页面。模板拼接逻辑独立放在 `lib/requirement-prompt.ts`，页面只负责状态、交互、主题样式和剪贴板适配。

**Tech Stack:** Expo Router, React Native, TypeScript, `expo-clipboard`, Node.js built-in test runner.

**Spec:** 用户提供的固定中文模板；仅替换 `【在这里填写具体需求】`，其余内容保持原样。

## Global Constraints

- 复用 Funbox 现有 `MobileScreen`、`PageHeader`、`SurfaceCard` 和 `useAppTheme` 视觉与布局体系。
- 不新增后端接口、异步业务流程、缓存或持久化。
- 空输入仍展示完整固定模板；输入中的换行、标点和特殊字符必须原样保留。
- 复制按钮必须复制当前完整预览内容，并在成功或失败时给出用户可见状态。
- 保留仓库中与本需求无关的现有改动。

## Review Focus

- 空输入不得导致模板缺段，验证默认占位符仍存在。
- 多行、首尾空格和特殊字符必须原样透传。
- 输入内容包含占位符本身时只替换模板占位符一次。
- 复制失败必须有可见错误反馈，不能静默失败。
- 工具必须通过真实目录注册和详情路由进入，而不是只在局部页面中可达。

### Task 1: 固定模板生成逻辑

**Files:**
- Create: `frontend/lib/requirement-prompt.ts`
- Test: `frontend/tests/requirement-prompt.test.mjs`

**Interfaces:**
- Produces `REQUIREMENT_PROMPT_PLACEHOLDER`, `REQUIREMENT_PROMPT_TEMPLATE`, and `buildRequirementPrompt(requirement: string): string`.

- [ ] Write tests for exact default template, single replacement, multiline preservation, and placeholder-like user input.
- [ ] Run `npm run test:requirement-prompt` and verify it fails because the module is missing.
- [ ] Implement the constant template and one-placeholder replacement without trimming user input.
- [ ] Run the focused test and the full frontend test suite.

### Task 2: Funbox tool registration and screen routing

**Files:**
- Modify: `backend/internal/access/feature_registry.json`
- Modify: `frontend/features/tools/tool-detail-screen.tsx`
- Create: `frontend/features/tools/requirement-prompt-screen.tsx`

**Interfaces:**
- Consumes `buildRequirementPrompt` and existing theme/UI primitives.
- Produces `/tools/requirement-prompt` as a visible, accessible tool route.

- [ ] Add a normal-user-accessible registry entry with existing tool metadata conventions.
- [ ] Add the tool ID branch to the real `ToolDetailScreen` dispatch chain.
- [ ] Implement controlled input, live output preview, copy action, success/error feedback, and mobile-safe layout.
- [ ] Run lint and focused tests before browser validation.

### Task 3: Rendered workflow verification

**Files:**
- Modify: `frontend/package.json` to expose the focused test command.

- [ ] Start the existing Expo web entry and open `/tools/requirement-prompt`.
- [ ] Verify tool directory navigation, requirement entry, exact preview output, copy action, and a mobile viewport.
- [ ] Check console/runtime errors and capture the final rendered state.
