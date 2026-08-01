# 个性化热点新闻 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 FunBox 中交付可抓取真实 RSS、复用 DeepSeek 摘要、支持本地个性化与来源追溯的 `热点速览` 工具。

**Architecture:** Go 后端通过可替换的 RSS Source 聚合文章，在纯函数层完成分类、聚类和热度排序，并通过共享 `DeepSeekConfig` 生成带来源引用的结构化摘要；Service 负责 15 分钟快照和失败降级。Expo 前端使用纯函数保存兴趣与行为权重，在一个聚焦屏幕中呈现首页、热点、收藏、偏好和详情状态。

**Tech Stack:** Go 1.22、`encoding/xml`、DeepSeek Chat Completions、Expo Router、React 19、React Native 0.81、TypeScript、SecureStore、Node test runner。

## Global Constraints

- 复用现有 `DEEPSEEK_API_KEY`，不得创建或暴露新的前端 Key。
- 默认刷新间隔 `900000ms`，默认每个来源最多读取 `20` 篇，每次最多摘要 `8` 个事件。
- 只展示标题、短摘要、来源和原文链接，不完整转载正文。
- 首页采用已确认的“每日简报优先”方案和现有 FunBox 主题。
- 保留工作区内所有无关未提交改动；仅选择性暂存热点新闻文件。

---

### Task 1: 新闻领域、RSS 采集与事件聚类

**Files:**
- Create: `backend/internal/news/types.go`
- Create: `backend/internal/news/source_rss.go`
- Create: `backend/internal/news/source_rss_test.go`
- Create: `backend/internal/news/ranking.go`
- Create: `backend/internal/news/ranking_test.go`

**Interfaces:**
- Produces: `Article`, `Event`, `FeedSnapshot`, `Source`, `NewRSSSource(client, feedURLs, maxPerFeed)`, `BuildEvents(articles, now, maxEvents)`。
- Consumers: Task 2 的摘要器与 Task 3 的 `Service`。

- [ ] **Step 1: 写 RSS 解析失败测试**

```go
func TestRSSSourceFetchesPartialFeedsAndNormalizesArticles(t *testing.T) {
    source := NewRSSSource(server.Client(), []string{server.URL + "/ok", server.URL + "/fail"}, 20)
    articles, err := source.Fetch(context.Background())
    if err != nil || len(articles) != 1 || articles[0].Source != "测试来源" {
        t.Fatalf("articles=%#v err=%v", articles, err)
    }
}
```

- [ ] **Step 2: 运行 `go test ./internal/news -run TestRSSSource -v`，确认因实现缺失而失败**
- [ ] **Step 3: 使用 `encoding/xml`、受限 Body 读取和并行请求实现 RSS Source，保留成功来源并去除 HTML 标签**
- [ ] **Step 4: 运行聚焦测试，确认 RSS 解析、日期、图片和部分失败均通过**
- [ ] **Step 5: 写聚类和热点排序失败测试**

```go
func TestBuildEventsDeduplicatesURLsAndClustersSimilarTitles(t *testing.T) {
    events := BuildEvents(sampleArticles, fixedNow, 20)
    if len(events) != 2 || events[0].SourceCount != 2 || events[0].HotScore <= events[1].HotScore {
        t.Fatalf("events=%#v", events)
    }
}
```

- [ ] **Step 6: 实现分类词典、中英文词元、Jaccard 相似度、事件 ID、内容哈希和 `0-100` 热点分**
- [ ] **Step 7: 运行 `go test ./internal/news -v`，确认全部通过**

### Task 2: DeepSeek 结构化摘要

**Files:**
- Create: `backend/internal/news/summarizer_deepseek.go`
- Create: `backend/internal/news/summarizer_deepseek_test.go`

**Interfaces:**
- Consumes: `config.DeepSeekConfig` 和 Task 1 的 `Event`。
- Produces: `Summarizer`、`NewDeepSeekSummarizer(cfg)`、`Summarize(ctx, event) (Summary, error)`、`ExtractiveSummary(event)`。

- [ ] **Step 1: 写 DeepSeek 请求失败测试，断言 Bearer Key、共享 Model、`response_format=json_object` 和来源编号输入**
- [ ] **Step 2: 运行 `go test ./internal/news -run TestDeepSeek -v`，确认实现缺失导致失败**
- [ ] **Step 3: 实现 `/chat/completions` 请求和严格 JSON 解码**

```go
type summaryPayload struct {
    OneSentence string     `json:"oneSentence"`
    KeyPoints   []KeyPoint `json:"keyPoints"`
    Uncertainty string     `json:"uncertainty"`
}
```

- [ ] **Step 4: 校验摘要非空、关键点数量 `1-4`、每个 `sourceIds` 都属于事件来源；失败返回 `ErrSummaryInvalid`**
- [ ] **Step 5: 实现确定性提取式摘要，确保模型不可用时仍有内容**
- [ ] **Step 6: 运行 `go test ./internal/news -v`，确认请求、解码、无效引用和降级测试通过**

### Task 3: 新闻快照服务、配置与 HTTP API

**Files:**
- Create: `backend/internal/news/service.go`
- Create: `backend/internal/news/service_test.go`
- Create: `backend/internal/httpapi/news_handlers.go`
- Create: `backend/internal/httpapi/news_handlers_test.go`
- Modify: `backend/internal/config/config.go`
- Modify: `backend/internal/httpapi/server.go`
- Modify: `backend/cmd/api/main.go`
- Modify: `backend/.env.example`

**Interfaces:**
- Produces: `NewsConfig`、`NewService(cfg, source, summarizer)`、`Feed(ctx)`、`Refresh(ctx)`、`Run(ctx)` 和 `GET /api/v1/news/feed`。
- Consumers: Task 4 的 `fetchNewsFeed`。

- [ ] **Step 1: 写 Service 缓存测试，证明同一内容哈希只调用一次摘要器，刷新失败时返回 `stale=true` 的旧快照**
- [ ] **Step 2: 运行 `go test ./internal/news -run TestService -v`，确认失败**
- [ ] **Step 3: 实现带互斥锁的快照、摘要 Map 缓存、立即刷新和定时 ticker**
- [ ] **Step 4: 写 Handler 失败测试，覆盖 `200`、`502 news_sources_unavailable`、`503 news_service_unavailable`、`category` 与 `limit`**
- [ ] **Step 5: 注册公开路由并将 `news.Service` 通过 `NewServer` 注入；更新现有构造调用的 `nil` 参数**
- [ ] **Step 6: 在 `main.go` 复用 `cfg.DeepSeek` 创建摘要器并用可取消 Context 启动刷新循环**
- [ ] **Step 7: 在 `.env.example` 增加 `NEWS_RSS_FEEDS`、`NEWS_REFRESH_INTERVAL_MS`、`NEWS_LOOKBACK_HOURS`、`NEWS_MAX_EVENTS`、`NEWS_SUMMARY_LIMIT`**
- [ ] **Step 8: 运行 `go test ./...`，确认后端全量通过**

### Task 4: 前端数据合约、API 与本地偏好

**Files:**
- Create: `frontend/types/news.ts`
- Create: `frontend/lib/news.ts`
- Create: `frontend/lib/news-api.ts`
- Create: `frontend/lib/news-preferences-storage.ts`
- Create: `frontend/lib/news-preferences-storage.web.ts`
- Create: `frontend/lib/news-preferences-storage.native.ts`
- Create: `frontend/tests/hot-news.test.mjs`
- Modify: `frontend/package.json`

**Interfaces:**
- Produces: `NEWS_CATEGORIES`、`DEFAULT_NEWS_PREFERENCES`、`rankNewsEvents`、`toggleNewsInterest`、`recordNewsOpen`、`toggleSavedNews`、`fetchNewsFeed`、`loadNewsPreferences`、`saveNewsPreferences`。
- Consumers: Task 5 的 `HotNewsScreen`。

- [ ] **Step 1: 写排序失败测试，证明主动兴趣优先、行为权重有上限、公共热点用于并列排序且输入数组不被修改**
- [ ] **Step 2: 运行 `npm run test:news`，确认模块不存在而失败**
- [ ] **Step 3: 实现纯函数偏好与排序，默认兴趣为 `ai/technology/finance`**
- [ ] **Step 4: 写 API URL、无效响应和工具注册失败测试**
- [ ] **Step 5: 实现 `fetchNewsFeed` 与 Web/SecureStore 持久化适配器**
- [ ] **Step 6: 在 `frontend/package.json` 注册 `test:news` 并运行至全绿**

### Task 5: 热点速览 UI 与动态路由

**Files:**
- Create: `frontend/features/tools/hot-news-screen.tsx`
- Modify: `backend/internal/access/feature_registry.json`
- Modify: `frontend/features/tools/tool-detail-screen.tsx`

**Interfaces:**
- Consumes: Task 4 的 API、类型、偏好函数和存储。
- Produces: `/tools/hot-news` 的完整首页、热点、收藏、我的和详情界面。

- [ ] **Step 1: 在注册测试中要求 `hot-news` 对四种角色可见、状态为 `available`、路由为 `/tools/hot-news`**
- [ ] **Step 2: 运行 `npm run test:news`，确认注册断言失败**
- [ ] **Step 3: 添加注册项和 `ToolDetailScreen` 分发，保留当前文件中的市场雷达改动**
- [ ] **Step 4: 实现加载、错误重试、刷新、搜索、分类、每日简报和开放列表**
- [ ] **Step 5: 实现详情的摘要引用、事件脉络、来源跳转、收藏和返回**
- [ ] **Step 6: 实现热点、收藏、我的四个底部视图及兴趣调整，确保偏好每次变化后持久化**
- [ ] **Step 7: 运行 `npx tsc --noEmit` 与 `npm run lint -- --max-warnings=0`，修复所有新增问题**

### Task 6: 运行验证、提交与推送

**Files:**
- Create: `docs/hot-news-implementation-desktop.png`
- Create: `docs/hot-news-implementation-mobile.png`
- Modify only if verification finds a defect: files owned by Tasks 1-5

**Interfaces:**
- Produces: 可重复验证的构建、运行截图、中文提交和远端 `main`。

- [ ] **Step 1: 运行 `go test ./...`、全部 `npm run test:*`、TypeScript、lint 和 Expo Web 导出**
- [ ] **Step 2: 启动后端与 Expo Web，打开 `/tools/hot-news`，验证真实 RSS、摘要降级、兴趣、搜索、详情、来源、收藏和四个底部视图**
- [ ] **Step 3: 在 `1440x1000` 和 `390x844` 视口截图并检查控制台、网络、文字溢出、重叠与空白图片**
- [ ] **Step 4: 运行 `git diff --check` 并逐项核对设计规格验收标准**
- [ ] **Step 5: 只暂存本计划文件、热点新闻代码、必要的共享文件和验证截图**
- [ ] **Step 6: 创建中文提交 `feat: 新增个性化热点新闻与AI摘要`**
- [ ] **Step 7: 推送 `main`，确认远端分支指向新提交**
