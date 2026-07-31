# 个性化热点新闻 Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` and complete every verification before publishing.

**Goal:** 在 FunBox 中交付可抓取真实 RSS、复用 DeepSeek 摘要、支持本地个性化与来源追溯的 `热点速览` 工具。

**Architecture:** Go 后端用可替换的 RSS Source 聚合文章，在纯函数层完成分类、聚类和热度排序；Service 维护 15 分钟快照、摘要哈希缓存和旧数据降级。Expo 前端用纯函数管理兴趣与行为权重，在一个聚焦屏幕中呈现首页、热点、收藏、我的和详情。

**Tech Stack:** Go 1.22、`encoding/xml`、DeepSeek Chat Completions、Expo Router、React 19、React Native 0.81、TypeScript、SecureStore、Node test runner。

## Task 1: 新闻领域与 RSS

- [x] 创建 `backend/internal/news/types.go`、`source_rss.go`、`ranking.go`。
- [x] 先写部分源失败、全源失败、HTML 清洗、日期图片、URL 去重、标题聚类和热度边界测试。
- [x] 实现并行受限 RSS 抓取、中英文词元、Jaccard 聚类和 `0-100` 热度分。
- [x] 运行 `go test ./internal/news -v`。

## Task 2: DeepSeek 摘要

- [x] 先写 Bearer Key、共享模型、JSON 模式、来源编号和非法引用测试。
- [x] 实现 `NewDeepSeekSummarizer`、严格 JSON 解码和 `ExtractiveSummary`。
- [x] 仅发送来源编号、标题和清洗后的短导语；不发送完整正文。

## Task 3: 快照、配置与 API

- [x] 添加 `NewsConfig`：`NEWS_RSS_FEEDS`、`NEWS_REFRESH_INTERVAL_MS`、`NEWS_REQUEST_TIMEOUT_MS`、`NEWS_LOOKBACK_HOURS`、`NEWS_MAX_ARTICLES_PER_FEED`、`NEWS_MAX_EVENTS`、`NEWS_SUMMARY_LIMIT`。
- [x] 先写内容哈希缓存、旧快照降级、无缓存错误和查询参数测试。
- [x] 实现 `Service.Feed/Refresh/Run` 和 `GET /api/v1/news/feed`。
- [x] 在 `main.go` 复用 `cfg.DeepSeek`，启动可取消刷新循环。
- [x] 运行 `go test ./...`。

## Task 4: 前端合约与偏好

- [x] 创建 `types/news.ts`、`lib/news.ts`、`lib/news-api.ts` 和平台存储适配器。
- [x] 先写默认兴趣、不可变排序、行为封顶、收藏、响应校验和工具注册测试。
- [x] Web 使用 `localStorage`，原生使用 SecureStore。
- [x] 运行 `npm run test:news` 和 `npx tsc --noEmit`。

## Task 5: 页面与路由

- [x] 在工具注册表增加 `hot-news` 并对四种角色开放。
- [x] 在 `ToolDetailScreen` 分发 `/tools/hot-news`。
- [x] 实现每日简报、真实数据列表、搜索、分类、刷新、收藏、兴趣和四个底部视图。
- [x] 实现详情摘要引用、事件脉络、原文跳转和所有加载/错误/空状态。
- [x] 运行 TypeScript 和零警告 lint。

## Task 6: 运行验证与发布

- [ ] 运行后端全量测试、全部前端 `test:*`、TypeScript、lint 和 Expo Web 导出。
- [ ] 启动后端与 Expo Web，验证真实 RSS、摘要降级、搜索、兴趣、收藏、详情与四个底部视图。
- [ ] 在 `1440x1000` 和 `390x844` 视口截图，检查控制台、网络、溢出、重叠和图片失败状态。
- [ ] 运行 `git diff --check` 并核对设计验收标准。
- [ ] 创建中文提交 `feat: 新增个性化热点新闻与AI摘要`，推送远端 `main`。
