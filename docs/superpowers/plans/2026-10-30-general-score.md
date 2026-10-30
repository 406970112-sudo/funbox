# 通用记分 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 按通用记分 V2 实现原生小程序独立入口、灵活人数记分和房主确认金额结算。

**Architecture:** 复用现有 generic 游戏类别、麻将的 entry/room 公共控制器及结算 API。新建通用入口页面；共享房间按 gameType 呈现中性主题。以 maxPlayers=0 表示不预设名额，数据库增加兼容旧表约束的标志，旧房间容量行为保持不变。

**Tech Stack:** 原生微信小程序 WXML/WXSS/JavaScript，Go，SQLite，node:test。

**Spec:** docs/general-score-design-v2/README.md

## Global Constraints

- 首页仅追加通用入口，既有内容、插画、文案与样式不改。
- 创建结构与麻将一致，仅主题图和必要文案不同；不增加人数设置。
- 2 人可开始，等待阶段可继续邀请，不新定义开始后加入／退出。
- 房主确认每分金额再结算，金额修改更新预览，游客与邀请流程复用现有逻辑。

## Review Focus

- 超过 8 人的手动加入及邀请预览不能误报满员。
- 旧数据库、麻将和炸金花容量行为保持兼容。
- 邀请和扫码路由必须呈现正确房间主题。
- 无效金额／非房主不能提交结算，已结算金额须来自确认值。
- 多人名单和金额弹层不能遮挡按钮，空座位不再按名额生成。

### Task 1: 后端灵活人数

**Files:** backend/internal/score/service.go, store.go, general_score_test.go

**Interfaces:** generic + maxPlayers=0 创建不限固定名额；快照保留 maxPlayers=0；既有大于零名额不变。

- [x] 新增失败测试：超过 8 人加入、邀请预览、2 人开始、房主按 50 分／点结算、非房主拒绝、旧容量保留和迁移。
- [x] 运行测试确认失败，再增加持久化标志和相关容量校验。
- [x] 跑后端 score/httpapi 与全量测试。

### Task 2: 小程序入口与主题

**Files:** miniprogram/pages/index/*, pages/score/general/*, utils/score-entry-base.js, score-room-base.js, score-format.js, pages/score/room/*, app.json, assets/illustrations/general-score.png

**Interfaces:** 新入口使用 gameType=generic, maxPlayers=0；房间主题由服务端 gameType 决定，共享已有邀请路径和结算 API。

- [x] 先测试创建请求／路由、多人昵称头像、无固定空位、结算确认与金额预览，确认失败。
- [x] 新增通用主题素材与页面；仅追加首页入口；共享房间条件化中性文案和插画，不影响麻将。
- [x] 跑小程序全量测试及 JavaScript 语法检查。

### Task 3: 验收

**Files:** miniprogram/README.md, docs/general-score-design-v2/implementation.md

- [x] 对照设计检查建房和结算布局；验证 6 人及更多成员的列表。
- [x] 检查最终差异与全部测试结果，记录原生微信工具无法覆盖的验证边界。
- [x] 更新实施记录，交付当前分支改动；不发布、不推送。

## Execution rulings / ledger

- 用户已明确要求按 V2 实施，直接在当前会话执行，不另加审批。
- 使用当前 checkout 新功能分支，保留已有未跟踪设计资料；不自动提交其他文件。
- maxPlayers=0 仅用于新建灵活人数 generic 房间；旧 generic 固定名额仍保留。

- Task 1: complete — score/httpapi 通过，旧容量及迁移回归通过。
- Task 2: complete — 143 项小程序测试和原生页面编译通过。
- Task 3: complete — 微信原生6人本地联调、基线失败复现及独立代码复核完成。
- Ruling: 大组采用有界转账建议 — 放开人数后穷举会阻塞唯一数据库连接 — 大组不保证全局最少笔数，账目仍准确结清。
