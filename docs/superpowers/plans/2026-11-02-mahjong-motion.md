# Mahjong Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 将已批准的加入页和六个麻将房动效落地。

**Architecture:** 纯函数从相邻快照提取可播放变化；独立页面动效模块管理瞬时反馈、分数递增、清理与偏好。现有业务方法只提供成功快照，不延迟服务端状态或金额。

**Tech Stack:** 原生微信小程序 WXML/WXSS/CommonJS，Node test，微信开发者工具。

**Spec:** `docs/superpowers/specs/2026-11-02-mahjong-motion-design.md`

## Global Constraints

- 复用现有蓝白主题与插画；不引入依赖。
- 自动入座、至少两人开局；不改后端、炸金花规则与通用记分流程。
- 成功动效只在服务端确认后触发；动效可关闭；后台清理计时器。

## Review Focus

- 重复、过期或跨房快照不触发旧动效。
- 恢复页面不回放后台累计记录。
- 一次给多人、累计负分时仍按本次增减反馈。
- 快速连续更新与动效关闭后不得覆盖最新真实分数。
- 加入请求失败保留输入，不显示成功；隐藏后不继续页面更新。

### Task 1: 房间变化与动效生命周期

**Files:** 新增 `miniprogram/utils/mahjong-motion.js`、`miniprogram/tests/mahjong-motion.test.js`；修改 `miniprogram/utils/score-room-base.js`。

**Interfaces:** `deriveMahjongMotion(previous, next)` 输出新增成员、分数变化、开局/结算；页面方法负责偏好、倒计时与清理。

- [x] 写测试覆盖初始/重复/过期/跨房、多人分数变化、后台恢复、关闭与连续更新。
- [x] 运行新测试确认缺失行为导致失败，再实现纯函数与生命周期。
- [x] 集成 `applyRoom`、onHide/onShow、复制与重连；运行房间测试。

### Task 2: 加入页与原生动效视图

**Files:** 修改 `score-entry-base.js`、麻将与房间 WXML/WXSS，增加独立 `mahjong-motion.wxss`。

**Interfaces:** 页面绑定 `reducedMotion`、`motionScene`、`motionNotice` 和每行分数/位移状态；业务数据保持原字段。

- [x] 写加入待处理/成功/失败与隐藏取消反馈的行为测试，先验证失败。
- [x] 实现扫描光束与陶瓷牌点缀、按钮反馈、抽屉和聚焦、加入成功勾选。
- [x] 实现入座、开局、浮分、分数流向、榜单位置过渡、账单展开与偏好开关。
- [x] 运行 `node --test miniprogram/tests/*.test.js`。

### Task 3: 原生验证与交付

**Files:** 更新 `miniprogram/README.md` 的动效说明。

- [x] 用微信开发者工具编译/自动化验证加入首页、抽屉、邀请、入座、开局、分数变化与结算。
- [x] 检查小屏与长昵称、减少动效、连续更新；若工具不可用明确记录限制。
- [x] 检查 JavaScript 语法、完整小程序测试和 `git diff --check`；自查差异。

## Execution notes

- 用户已明确批准设计并要求实施，继续执行，不重复请求审批。
- 按宿主要求复用当前干净 checkout，使用 `codex/mahjong-motion` 分支；用户后续已明确授权提交并推送到 main。

## Verification record

- 完整小程序测试：224/224 通过；新增行为测试先观察失败后修复。
- 原生 WXML/WXSS 编译通过；修改的 JavaScript 语法检查和 git diff --check 通过。
- 微信模拟器注入测试快照检查：邀请预览、入座、开局、增减分与流向、榜单换位、长昵称、减少动效、结算；运行异常为零。扫码首页与手动加入弹层通过真实按钮点击与截图检查。未在真实服务端创建牌局或记分，不等同于真机多人联调。
- 原生检查发现定位行未撑开榜单，改为 JS 计算 motionBoardHeight 并加入高度检查。
- 独立代码审查发现隐藏后的在途响应会消耗恢复标志，已用失败/通过回归测试验证修复。
- 此前保留分支供用户体验；用户后续要求提交并推送到 main，按该授权执行。
