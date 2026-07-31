# 市场雷达真实数据 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将市场雷达从前端演示快照切换为由 FunBox 后端代理、计算并缓存的东方财富真实延迟行情。

**Architecture:** Go 后端负责固定板块池、上游请求、校验、区间计算、成分权重和新鲜/陈旧缓存，向前端提供单一快照接口。Expo 前端只负责响应校验、选择器和显式的加载/刷新/陈旧/失败状态，不包含生产行情后备数据。

**Tech Stack:** Go 1.22、`net/http`、Expo 54、React 19、React Native、TypeScript、Node test runner、Codex 内置 Browser 插件。

## Global Constraints

- 数据源采用东方财富公开板块、日 K 和成分股行情；客户端不得直连上游。
- AI 板块池固定为 `BK1134 算力概念`、`BK1128 CPO概念`、`BK1127 AI芯片`、`BK0800 人工智能`、`BK0579 云计算`。
- 有色板块池固定为 `BK0732 贵金属`、`BK1615 铜`、`BK1613 铝`、`BK1626 稀土`、`BK0479 钢铁`；`全球`为两组并集。
- 生产代码不得包含或回退到本地市场演示快照；测试上游响应只存在于 `_test.go` 和 `.test.mjs`。
- 页面必须展示来源、采集时间、延迟/陈旧状态和 `仅作信息展示，不构成投资建议`。
- 保留当前工作区所有非本任务改动。当前冲突文件若仍存在，逐个合并双方功能，不得选择整侧覆盖。
- 使用内置 Browser 插件完成桌面与移动端渲染、交互、控制台和错误态验证。
- 最终提交使用中文且带类型前缀：`feat: 接入市场雷达真实行情`，并推送到远端 `main`，禁止强推。

---

### Task 1: 东方财富行情服务与缓存

**Files:**
- Create: `backend/internal/marketradar/service.go`
- Create: `backend/internal/marketradar/service_test.go`
- Modify: `backend/internal/config/config.go`
- Modify: `backend/.env.example`

**Interfaces:**
- Produces: `marketradar.NewService(config.MarketRadarConfig) *Service`。
- Produces: `(*Service).Snapshot(context.Context, bool) (marketradar.Snapshot, error)`，第二个参数表示强制刷新。
- Produces: `Snapshot`、`Sector`、`Constituent`、`Indicator`、`Pulse`、`Coverage` JSON 合同。
- Produces errors: `ErrSourceUnavailable`、`ErrSourceInvalid`、`ErrInsufficientCoverage`。

- [ ] **Step 1: 写行情解析、计算和缓存的失败测试**

在 `service_test.go` 创建以下测试：

```go
func TestSnapshotBuildsRealBoardMetrics(t *testing.T) {
	upstream := newMarketRadarUpstream(t)
	service := NewService(testMarketRadarConfig(upstream.URL))
	snapshot, err := service.Snapshot(context.Background(), false)
	if err != nil { t.Fatal(err) }
	if snapshot.Source != "eastmoney" || snapshot.Stale { t.Fatalf("snapshot = %#v", snapshot) }
	if snapshot.Coverage.Requested != 10 || snapshot.Coverage.Loaded != 10 { t.Fatalf("coverage = %#v", snapshot.Coverage) }
	sector := snapshot.Sectors[0]
	if len(sector.Series) != 21 || sector.Series[0] != 100 { t.Fatalf("series = %#v", sector.Series) }
	if totalWeight(sector.Constituents) != 100 { t.Fatalf("constituents = %#v", sector.Constituents) }
}

func TestSnapshotCachesFreshDataAndServesStaleLastSuccess(t *testing.T) {
	upstream := newMarketRadarUpstream(t)
	service := NewService(testMarketRadarConfig(upstream.URL))
	first, err := service.Snapshot(context.Background(), false)
	if err != nil { t.Fatal(err) }
	calls := upstream.Calls()
	second, err := service.Snapshot(context.Background(), false)
	if err != nil || second.Stale || upstream.Calls() != calls { t.Fatalf("second = %#v, err = %v", second, err) }
	upstream.Fail()
	stale, err := service.Snapshot(context.Background(), true)
	if err != nil || !stale.Stale || stale.FetchedAt != first.FetchedAt { t.Fatalf("stale = %#v, err = %v", stale, err) }
}

func TestSnapshotRequiresAIAndMetalsCoverage(t *testing.T) {
	upstream := newMarketRadarUpstream(t)
	upstream.InvalidateCategory("ai")
	_, err := NewService(testMarketRadarConfig(upstream.URL)).Snapshot(context.Background(), false)
	if !errors.Is(err, ErrInsufficientCoverage) { t.Fatalf("error = %v", err) }
}
```

测试 helper 根据 `secid=90.<board>` 返回 22 条有效 K 线，根据 `fs=b:<board>+f:!50` 返回三只带 `f3`、`f12`、`f14`、`f21` 的成分股，并用原子计数器记录请求数。

- [ ] **Step 2: 运行测试并确认缺失包失败**

```powershell
cd backend
go test ./internal/marketradar -run TestSnapshot -v
```

Expected: FAIL，错误指向 `backend/internal/marketradar` 尚不存在。

- [ ] **Step 3: 添加后端配置合同**

在 `config.Config` 增加：

```go
type MarketRadarConfig struct {
	CacheTTL       time.Duration
	HistoryBaseURL string
	QuoteBaseURL   string
	RequestTimeout time.Duration
}
```

默认值分别为 `120000ms`、`https://push2his.eastmoney.com`、`https://push2.eastmoney.com`、`12000ms`，环境变量使用 `MARKET_RADAR_` 前缀并同步到 `backend/.env.example`。

- [ ] **Step 4: 实现真实行情服务**

`service.go` 的核心合同：

```go
type Snapshot struct {
	Categories []Category                    `json:"categories"`
	Coverage   Coverage                      `json:"coverage"`
	FetchedAt  time.Time                     `json:"fetchedAt"`
	Periods    []Period                      `json:"periods"`
	Pulses     map[string]map[string]Pulse    `json:"pulses"`
	Sectors    []Sector                      `json:"sectors"`
	Source     string                        `json:"source"`
	SourceURL  string                        `json:"sourceUrl"`
	Stale      bool                          `json:"stale"`
}
```

实现规则：K 线使用 `secid=90.<board>&klt=101&fqt=1&lmt=30`；1/5/20 日收益取倒数第 2/6/21 个收盘价；趋势取最近 21 个收盘价并以首值归一为 100。成分股按 `f21` 流通市值取前三名，权重合计修正为 100%。Indicator 只含最新收盘、成交额、上涨/下跌数和有效覆盖。使用有界并发抓取 10 个板块；AI 或有色无有效板块返回 `ErrInsufficientCoverage`。成功快照深拷贝缓存，TTL 内不请求上游，强刷失败仅返回已存在的最后成功快照并设 `stale=true`。

- [ ] **Step 5: 运行聚焦测试并确认通过**

```powershell
go test ./internal/marketradar -v
```

- [ ] **Step 6: 格式化并提交本任务**

```powershell
gofmt -w internal/marketradar/service.go internal/marketradar/service_test.go internal/config/config.go
git add backend/internal/marketradar backend/internal/config/config.go backend/.env.example
git commit -m "feat: 新增市场雷达真实行情服务"
```

---

### Task 2: 市场雷达快照 HTTP 接口

**Files:**
- Create: `backend/internal/httpapi/market_radar_handlers.go`
- Create: `backend/internal/httpapi/market_radar_handlers_test.go`
- Modify: `backend/internal/httpapi/server.go`

**Interfaces:**
- Consumes: `Snapshot(context.Context, bool) (marketradar.Snapshot, error)`。
- Produces: `GET /api/v1/market-radar/snapshot`，`refresh=1` 时强制刷新。
- Produces error codes: `market_radar_source_unavailable`、`market_radar_source_invalid`、`market_radar_insufficient_coverage`。

- [ ] **Step 1: 写 handler 失败测试**

```go
func TestMarketRadarSnapshotHandlerReturnsSnapshot(t *testing.T) {
	fake := &fakeMarketRadarService{snapshot: marketradar.Snapshot{Source: "eastmoney"}}
	api := &Server{marketRadarService: fake}
	mux := http.NewServeMux()
	registerMarketRadarRoutes(mux, api)
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/market-radar/snapshot?refresh=1", nil))
	if response.Code != http.StatusOK || !fake.forceRefresh || !strings.Contains(response.Body.String(), "eastmoney") {
		t.Fatalf("status/body/refresh = %d %s %v", response.Code, response.Body.String(), fake.forceRefresh)
	}
}
```

另建表驱动测试，断言三个服务错误都返回 502 和对应稳定错误码。

- [ ] **Step 2: 运行测试并确认缺失路由失败**

```powershell
go test ./internal/httpapi -run MarketRadar -v
```

- [ ] **Step 3: 实现路由和错误映射**

在 `Server` 增加：

```go
type marketRadarSnapshotService interface {
	Snapshot(context.Context, bool) (marketradar.Snapshot, error)
}
```

`NewServer` 注入 `marketradar.NewService(cfg.MarketRadar)`，注册 `GET /api/v1/market-radar/snapshot`。handler 仅把 `refresh=1` 解析为 true，成功返回快照，已知上游错误返回 502 和稳定错误码，未知错误按 unavailable 处理。

- [ ] **Step 4: 运行 HTTP 层和全部后端测试**

```powershell
go test ./internal/httpapi -run MarketRadar -v
go test ./...
```

- [ ] **Step 5: 提交 HTTP 接口**

```powershell
gofmt -w internal/httpapi/market_radar_handlers.go internal/httpapi/market_radar_handlers_test.go internal/httpapi/server.go
git add backend/internal/httpapi/market_radar_handlers.go backend/internal/httpapi/market_radar_handlers_test.go backend/internal/httpapi/server.go
git commit -m "feat: 提供市场雷达快照接口"
```

---

### Task 3: 前端真实数据合同、选择器与请求层

**Files:**
- Create: `frontend/types/market-radar.ts`
- Create: `frontend/lib/market-radar-api.ts`
- Modify: `frontend/lib/market-radar.ts`
- Modify: `frontend/tests/market-radar.test.mjs`
- Modify: `frontend/package.json`

**Interfaces:**
- Produces: `fetchMarketRadarSnapshot(signal?, refresh?, apiBaseUrl?)`。
- Produces: `MarketRadarSnapshot` 及子类型。
- Produces selectors: `getRankedMarketSectors(snapshot, categoryId, periodId)`、`getMarketPulse(snapshot, categoryId, periodId)`、`getMarketSector(snapshot, sectorId)`。
- Removes: `MARKET_SECTORS`、`MARKET_BREADTH` 和所有生产演示数值。

- [ ] **Step 1: 将现有测试改成真实快照合同的失败测试**

使用只含一只 AI 板块和一只有色板块的 `source: 'eastmoney'` 快照，新增：

```js
test('ranks sectors from an API snapshot without mutating it', () => {
	const original = structuredClone(snapshot);
	assert.deepEqual(getRankedMarketSectors(snapshot, 'global', '1d').map((item) => item.id), ['ai-compute', 'copper']);
	assert.deepEqual(snapshot, original);
});

test('requests a forced backend refresh', async () => {
	const originalFetch = globalThis.fetch;
	let requestedUrl = '';
	globalThis.fetch = async (url) => {
		requestedUrl = String(url);
		return new Response(JSON.stringify(snapshot), { status: 200 });
	};
	try {
		const result = await fetchMarketRadarSnapshot(undefined, true, 'http://127.0.0.1:3000');
		assert.equal(result.source, 'eastmoney');
		assert.equal(requestedUrl, 'http://127.0.0.1:3000/api/v1/market-radar/snapshot?refresh=1');
	} finally { globalThis.fetch = originalFetch; }
});

test('rejects non-eastmoney payloads', async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => new Response(JSON.stringify({ source: 'demo', sectors: [] }), { status: 200 });
	try {
		await assert.rejects(() => fetchMarketRadarSnapshot(undefined, false, 'http://127.0.0.1:3000'), /market_radar_source_invalid/);
	} finally { globalThis.fetch = originalFetch; }
});
```

- [ ] **Step 2: 运行聚焦测试并确认新合同失败**

```powershell
cd frontend
node --test --experimental-strip-types tests/market-radar.test.mjs
```

- [ ] **Step 3: 创建类型和纯选择器**

`types/market-radar.ts` 镜像后端合同并限定 `MarketCategoryId = 'global' | 'ai' | 'metals'`、`MarketPeriodId = '1d' | '5d' | '20d'`、`MarketRadarSource = 'eastmoney'`。重写 `lib/market-radar.ts`，只保留 snapshot 选择器和 `buildMarketChartPoints`；排序复制数组，不定义板块或涨跌常量。

- [ ] **Step 4: 实现请求、校验和错误文案**

`market-radar-api.ts` 定义带 `code`、`status` 的 `MarketRadarAPIError`。请求传入 base URL 或动态导入 `getAPIBaseUrl`，解析后验证 source、时间戳、非空分类/周期/板块、AI 与有色覆盖、三个有限收益值和有效 series。HTTP 错误沿用后端 `error` 字段；错误文案覆盖 unavailable、invalid、insufficient coverage、rate limited 和网络失败。

- [ ] **Step 5: 添加脚本并验证**

在冲突已合并的 `frontend/package.json` 中保留全部现有脚本并增加：

```json
"test:market-radar": "node --test --experimental-strip-types tests/market-radar.test.mjs"
```

运行：

```powershell
npm run test:market-radar
npx tsc --noEmit
```

- [ ] **Step 6: 提交前端数据层**

```powershell
git add frontend/types/market-radar.ts frontend/lib/market-radar.ts frontend/lib/market-radar-api.ts frontend/tests/market-radar.test.mjs frontend/package.json
git commit -m "feat: 接入市场雷达快照数据层"
```

---

### Task 4: 页面接入加载、刷新、陈旧与错误状态

**Files:**
- Modify: `frontend/features/tools/market-radar-screen.tsx`
- Modify: `frontend/features/tools/market-radar-chart.tsx` only if the live series exposes a rendering contract mismatch

**Interfaces:**
- Consumes: `fetchMarketRadarSnapshot`、真实 snapshot selectors 和 types。
- Produces: 首屏加载、数据页面、刷新中、陈旧缓存、终态错误与重试交互。
- Preserves: 分类、周期、详情、返回、关注和底部导航现有交互。

- [ ] **Step 1: 用内置 Browser 记录页面行为红灯**

启动已完成的后端接口和当前 Expo Web，加载 `browser:control-in-app-browser` 后打开 `/tools/market-radar`。以用户可见行为检查“页面从后端展示 `东方财富公开行情` 且不显示演示快照”。

Expected: FAIL。当前页面仍显示 `演示快照` / `演示数据`，不会请求或展示真实快照。保存 DOM 状态和控制台输出作为红灯证据，不提交截图或临时文件。

- [ ] **Step 2: 保持数据层聚焦测试为绿**

```powershell
npm run test:market-radar
```

Expected: Task 3 的数据合同测试保持 PASS；页面行为仍由 Step 1 的 Browser 红灯约束。

- [ ] **Step 3: 接入异步快照状态机**

状态包含 `snapshot`、`loadError`、`isLoading`、`isRefreshing`。挂载时用 `AbortController` 请求普通快照，卸载时 abort。手动刷新使用 `refresh=true`；已有 snapshot 时保持页面并显示刷新中，初次失败时只显示错误文案和重试按钮，不能渲染板块列表。

- [ ] **Step 4: 将所有显示值改为 snapshot 驱动**

分类、周期、排名、pulse、最强板块和详情全部来自 snapshot。详情标题改为 `行情指标`，渲染真实 indicators 与成分代码/权重。顶部显示更新时间、`正在刷新` 或 `缓存行情`。来源行显示 `东方财富公开行情 · 延迟数据` 和 coverage；删除全部演示/本地快照文案，保留风险提示与主题适配。

- [ ] **Step 5: 运行前端验证**

```powershell
npm run test:market-radar
npx tsc --noEmit
npm run lint
```

- [ ] **Step 6: 按 React 最佳实践复核并提交页面**

调用 `build-web-apps:react-best-practices` 检查请求瀑布、effect 依赖、派生状态和重渲染，修正后提交：

```powershell
git add frontend/features/tools/market-radar-screen.tsx frontend/features/tools/market-radar-chart.tsx frontend/tests/market-radar.test.mjs
git commit -m "feat: 展示市场雷达真实行情状态"
```

---

### Task 5: 全量回归、内置浏览器验证与 main 推送

**Files:**
- Verify: `backend/`
- Verify: `frontend/`
- Do not commit screenshots, traces, temporary browser scripts, or generated reports

**Interfaces:**
- Proves: 真实后端响应、前端渲染、交互、错误态和全部现有自动化回归。
- Produces: 远端 `main` 包含真实数据改动。

- [ ] **Step 1: 运行全量自动化验证**

```powershell
cd backend
go test ./...
cd ..
npm --prefix frontend run test:gomoku
npm --prefix frontend run test:qr
npm --prefix frontend run test:ai-navigation
npm --prefix frontend run test:resource-search
npm --prefix frontend run test:ssq
npm --prefix frontend run test:social-refresh
npm --prefix frontend run test:social-unread
npm --prefix frontend run test:auth
npm --prefix frontend run test:market-radar
npm --prefix frontend run lint
npx --prefix frontend tsc --noEmit
```

Expected: 所有命令退出码为 0，没有跳过失败项。

- [ ] **Step 2: 启动真实后端和 Expo Web**

后端 `go run ./cmd/api` 后请求 `http://127.0.0.1:3000/api/v1/market-radar/snapshot`，确认 `source=eastmoney`、`stale=false`、`coverage.loaded>0`、AI 与有色均有板块。前端设置 `EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:3000` 后运行 `npx expo start --web --port 8081`。

- [ ] **Step 3: 使用内置 Browser 插件验证桌面流程**

加载 `browser:control-in-app-browser`，命名会话并打开 `http://127.0.0.1:8081/tools/market-radar`。在 `1280x900` 验证 URL/标题、非空 DOM、无框架覆盖层、无相关 console error/warn、出现真实来源且无演示文案。点击 `AI`、`5日`、首个板块、关注、返回和刷新，逐步检查排名、详情、关注状态与更新时间。截图保存到仓库外 Codex 临时目录。

- [ ] **Step 4: 使用同一 Browser 会话验证移动端和错误态**

将视口切为 `390x844`，重复非空、无覆盖层、无重叠/裁切和主要交互检查。停止后端后刷新，验证只显示真实请求错误和重试按钮且无演示列表；恢复后端点击重试，验证真实行情恢复，并记录移动端截图和控制台健康状态。

- [ ] **Step 5: 完成需求和 Git 审计**

```powershell
rg -n "演示数据|演示快照|MARKET_SECTORS|MARKET_BREADTH" frontend/lib/market-radar.ts frontend/lib/market-radar-api.ts frontend/features/tools/market-radar-screen.tsx
git diff --check
git status --short --branch
git log -8 --oneline --decorate
```

Expected: `rg` 无匹配，diff check 无错误，本任务外改动保持原状。

- [ ] **Step 6: 补齐最终功能提交**

前面任务提交已包含全部改动时不创建空提交；仍有本任务文件时精确暂存并执行 `git commit -m "feat: 接入市场雷达真实行情"`。

- [ ] **Step 7: 获取远端状态并推送 main**

```powershell
git fetch origin
git log --left-right --cherry-pick --oneline origin/main...main
git push origin main
```

仅在远端仍是本地 main 祖先时直接推送。远端新增提交时先在隔离的临时集成分支合并并重跑同一套测试，再以普通合并结果推送；禁止 `--force` 和 `--force-with-lease`。

- [ ] **Step 8: 推送后复核远端 main**

```powershell
git fetch origin
git rev-parse main
git rev-parse origin/main
git log -1 --oneline origin/main
```

Expected: 本地与远端 main 指向包含本功能的同一提交，远端中文类型前缀提交可见。

---

## Plan Self-Review

- 覆盖真实数据源、板块池、计算、缓存/陈旧、错误态、来源、无演示回退和浏览器验收。
- 后端与前端字段、周期 ID、错误码和函数签名一致。
- 每个生产改动都有失败测试先行，浏览器验证不以 build 或 lint 代替。
- Git 步骤保留现有工作区改动、禁止强推，并在推送后核对远端 main。
