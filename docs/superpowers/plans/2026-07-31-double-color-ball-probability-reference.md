# 双色球概率参考 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 FunBox 中交付一个使用中国福彩网官方历史开奖、可解释地生成五组双色球参考号码并提供无泄漏回测的移动端工具。

**Architecture:** Go 后端集中请求、校验并缓存最多 400 期官方开奖，通过一个只读接口提供给前端。React Native 前端把统计、生成器、评分和走步回测保持为纯函数，页面只负责加载状态、窗口切换、组合查看、刷新和本地保存。

**Tech Stack:** Go 1.22+ `net/http`、Expo 54、React Native 0.81、TypeScript 5.9、Node test runner、`expo-secure-store`、Web `localStorage`。

## Global Constraints

- 用户可见分析窗口只能是 30、100、300 期；第 301-400 期只允许用于回测历史上下文。
- 每个合法单式组合的一等奖理论概率固定显示为 `1 / 17,721,088`。
- 禁止“必中、稳赚、提高中奖率、AI 胜率”等表达；结构匹配度必须注明“不是中奖概率”。
- 官方数据不可用且没有缓存时不得展示或生成示例开奖号。
- 每组必须包含六个 1-33 的不重复升序红球和一个 1-16 的蓝球。
- 同批任意两组红球默认重合不超过 2 个；约束放宽必须在组合依据中披露。
- 不新增状态管理库；不新增持久化依赖，复用 `expo-secure-store` 和 Web `localStorage`。
- 保留工作区现有未提交改动，不修改或回退与本功能无关的文件。

---

## File Map

**Backend**

- `backend/internal/config/config.go`: 增加彩票来源、超时、缓存和数据量配置。
- `backend/internal/lottery/service.go`: 官方 JSON 解析、开奖校验、排序、去重、缓存与过期缓存回退。
- `backend/internal/lottery/service_test.go`: 服务行为测试。
- `backend/internal/httpapi/lottery_handlers.go`: `GET /api/v1/lottery/ssq/history`。
- `backend/internal/httpapi/lottery_handlers_test.go`: HTTP 状态码与响应测试。
- `backend/internal/httpapi/server.go`: 注入服务并注册路由。

**Frontend**

- `frontend/types/double-color-ball.ts`: 前后端数据、统计、组合和回测类型。
- `frontend/lib/double-color-ball-api.ts`: 历史快照请求与错误文案。
- `frontend/lib/double-color-ball.ts`: 分析、确定性生成器、评分、回测。
- `frontend/lib/double-color-ball-storage.ts`: 测试/非平台内存实现。
- `frontend/lib/double-color-ball-storage.web.ts`: `localStorage` 实现。
- `frontend/lib/double-color-ball-storage.native.ts`: `expo-secure-store` 实现。
- `frontend/features/tools/double-color-ball-components.tsx`: 号码球、热力矩阵、结构条和组合卡片。
- `frontend/features/tools/double-color-ball-screen.tsx`: 总览和参考组合页面状态。
- `frontend/features/tools/tool-detail-screen.tsx`: 工具路由分发。
- `backend/internal/access/feature_registry.json`: 工具元数据和角色开放。
- `frontend/tests/double-color-ball.test.mjs`: 纯函数、注册表和文案测试。
- `frontend/package.json`: 增加 `test:ssq` 脚本。

---

### Task 1: Backend Official History Service

**Files:**

- Modify: `backend/internal/config/config.go`
- Create: `backend/internal/lottery/service.go`
- Create: `backend/internal/lottery/service_test.go`

**Interfaces:**

- Produces: `lottery.Draw`, `lottery.HistorySnapshot`, `lottery.Service.History(context.Context) (HistorySnapshot, error)`。
- Produces errors: `lottery.ErrSourceUnavailable`, `lottery.ErrSourceInvalid`。
- Consumes: `config.LotteryConfig` with `SourceURL`, `Referer`, `RequestTimeout`, `CacheTTL`, `FetchCount`, `MinimumDraws`。

- [ ] **Step 1: Write failing parser and validation tests**

```go
func TestServiceHistoryParsesValidDrawsNewestFirst(t *testing.T) {
    upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        if got := r.Header.Get("Referer"); got != "https://www.cwl.gov.cn/ygkj/wqkjgg/ssq/" {
            t.Fatalf("Referer = %q", got)
        }
        _, _ = io.WriteString(w, `{"state":0,"message":"查询成功","result":[{"code":"2026001","date":"2026-01-02(四)","red":"01,02,03,04,05,06","blue":"07"},{"code":"2026002","date":"2026-01-04(日)","red":"02,03,04,05,06,07","blue":"08"}]}`)
    }))
    defer upstream.Close()

    service := lottery.NewService(config.LotteryConfig{
        SourceURL: upstream.URL,
        Referer: "https://www.cwl.gov.cn/ygkj/wqkjgg/ssq/",
        RequestTimeout: time.Second,
        CacheTTL: time.Minute,
        FetchCount: 2,
        MinimumDraws: 2,
    })
    snapshot, err := service.History(context.Background())
    if err != nil { t.Fatal(err) }
    if got := snapshot.Draws[0].Issue; got != "2026002" { t.Fatalf("issue = %s", got) }
    if got := snapshot.Draws[0].Date; got != "2026-01-04" { t.Fatalf("date = %s", got) }
}

func TestServiceHistoryRejectsDuplicateOrOutOfRangeBalls(t *testing.T) {
    draw := lottery.Draw{Issue: "2026001", Date: "2026-01-02", Red: []int{1, 2, 3, 4, 5, 5}, Blue: 17}
    if err := lottery.ValidateDraw(draw); err == nil {
        t.Fatal("expected invalid draw")
    }
}
```

- [ ] **Step 2: Run the focused backend test and confirm RED**

Run: `go test ./internal/lottery -run 'TestServiceHistory' -count=1` from `backend/`  
Expected: FAIL because package `internal/lottery` and its exported types do not exist.

- [ ] **Step 3: Add configuration defaults**

```go
type LotteryConfig struct {
    CacheTTL       time.Duration
    FetchCount     int
    MinimumDraws   int
    Referer        string
    RequestTimeout time.Duration
    SourceURL      string
}

Lottery: LotteryConfig{
    CacheTTL: durationFromMs("LOTTERY_CACHE_TTL_MS", "", "900000"),
    FetchCount: intFirst("LOTTERY_FETCH_COUNT", "", "400"),
    MinimumDraws: intFirst("LOTTERY_MINIMUM_DRAWS", "", "360"),
    Referer: envFirst("LOTTERY_REFERER", "https://www.cwl.gov.cn/ygkj/wqkjgg/ssq/"),
    RequestTimeout: durationFromMs("LOTTERY_REQUEST_TIMEOUT_MS", "", "10000"),
    SourceURL: envFirst("LOTTERY_SOURCE_URL", "https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice?name=ssq&issueCount=400"),
},
```

- [ ] **Step 4: Implement parsing, validation and sorting**

```go
type Draw struct {
    Blue  int    `json:"blue"`
    Date  string `json:"date"`
    Issue string `json:"issue"`
    Red   []int  `json:"red"`
}

type HistorySnapshot struct {
    AnalysisWindowMax int       `json:"analysisWindowMax"`
    Draws             []Draw    `json:"draws"`
    FetchedAt         time.Time `json:"fetchedAt"`
    Source            string    `json:"source"`
    SourceURL         string    `json:"sourceUrl"`
    Stale             bool      `json:"stale"`
}

func ValidateDraw(draw Draw) error {
    if draw.Issue == "" || len(draw.Red) != 6 || draw.Blue < 1 || draw.Blue > 16 {
        return ErrSourceInvalid
    }
    seen := map[int]bool{}
    for _, ball := range draw.Red {
        if ball < 1 || ball > 33 || seen[ball] { return ErrSourceInvalid }
        seen[ball] = true
    }
    return nil
}
```

`History` must send `User-Agent: FunBox/1.0` and configured `Referer`, decode `state == 0`, trim weekday suffix from `date`, parse comma-separated balls, skip invalid entries, deduplicate by issue, sort descending, and require `MinimumDraws` valid entries.

- [ ] **Step 5: Add cache and stale fallback tests**

```go
func TestServiceHistoryUsesFreshCacheAndFallsBackToStaleCache(t *testing.T) {
    var calls atomic.Int32
    fail := atomic.Bool{}
    upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
        calls.Add(1)
        if fail.Load() { http.Error(w, "offline", http.StatusBadGateway); return }
        _, _ = io.WriteString(w, `{"state":0,"result":[
            {"code":"2026002","date":"2026-01-04(日)","red":"02,03,04,05,06,07","blue":"08"},
            {"code":"2026001","date":"2026-01-02(四)","red":"01,02,03,04,05,06","blue":"07"}
        ]}`)
    }))
    defer upstream.Close()

    now := time.Date(2026, 7, 31, 0, 0, 0, 0, time.UTC)
    service := NewService(config.LotteryConfig{
        SourceURL: upstream.URL,
        Referer: "https://www.cwl.gov.cn/ygkj/wqkjgg/ssq/",
        RequestTimeout: time.Second,
        CacheTTL: time.Minute,
        FetchCount: 2,
        MinimumDraws: 2,
    })
    service.now = func() time.Time { return now }
    first, err := service.History(context.Background())
    if err != nil || first.Stale { t.Fatalf("first = %#v, %v", first, err) }
    _, _ = service.History(context.Background())
    if calls.Load() != 1 { t.Fatalf("calls = %d", calls.Load()) }
    now = now.Add(2 * time.Minute)
    fail.Store(true)
    stale, err := service.History(context.Background())
    if err != nil || !stale.Stale { t.Fatalf("stale = %#v, %v", stale, err) }
}
```

Keep `service_test.go` in package `lottery` so the test can replace the private `now` clock without widening the production API.

- [ ] **Step 6: Run and format backend service tests**

Run: `gofmt -w internal/config/config.go internal/lottery/service.go internal/lottery/service_test.go` from `backend/`  
Run: `go test ./internal/lottery ./internal/config -count=1` from `backend/`  
Expected: PASS.

- [ ] **Step 7: Commit the backend service slice**

```bash
git add backend/internal/config/config.go backend/internal/lottery/service.go backend/internal/lottery/service_test.go
git commit -m "feat: add official ssq history service"
```

---

### Task 2: Backend History HTTP Endpoint

**Files:**

- Modify: `backend/internal/httpapi/server.go`
- Create: `backend/internal/httpapi/lottery_handlers.go`
- Create: `backend/internal/httpapi/lottery_handlers_test.go`

**Interfaces:**

- Consumes: `lottery.Service.History(context.Context)` from Task 1.
- Produces: `GET /api/v1/lottery/ssq/history` JSON endpoint.
- Produces error codes: `lottery_source_unavailable`, `lottery_source_invalid`。

- [ ] **Step 1: Write failing handler tests**

```go
type fakeLotteryService struct {
    snapshot lottery.HistorySnapshot
    err error
}

func (f fakeLotteryService) History(context.Context) (lottery.HistorySnapshot, error) {
    return f.snapshot, f.err
}

func TestLotteryHistoryHandlerReturnsSnapshot(t *testing.T) {
    api := &Server{lotteryService: fakeLotteryService{snapshot: lottery.HistorySnapshot{Source: "cwl", AnalysisWindowMax: 300}}}
    mux := http.NewServeMux()
    registerLotteryRoutes(mux, api)
    request := httptest.NewRequest(http.MethodGet, "/api/v1/lottery/ssq/history", nil)
    response := httptest.NewRecorder()
    mux.ServeHTTP(response, request)
    if response.Code != http.StatusOK { t.Fatalf("status = %d", response.Code) }
}

func TestLotteryHistoryHandlerMapsSourceErrors(t *testing.T) {
    tests := []struct{ err error; code int; body string }{
        {lottery.ErrSourceUnavailable, http.StatusBadGateway, "lottery_source_unavailable"},
        {lottery.ErrSourceInvalid, http.StatusBadGateway, "lottery_source_invalid"},
    }
    for _, test := range tests {
        api := &Server{lotteryService: fakeLotteryService{err: test.err}}
        response := httptest.NewRecorder()
        api.handleLotteryHistory(response, httptest.NewRequest(http.MethodGet, "/api/v1/lottery/ssq/history", nil))
        if response.Code != test.code || !strings.Contains(response.Body.String(), test.body) {
            t.Fatalf("status/body = %d %s", response.Code, response.Body.String())
        }
    }
}
```

- [ ] **Step 2: Run the focused handler test and confirm RED**

Run: `go test ./internal/httpapi -run LotteryHistory -count=1` from `backend/`  
Expected: FAIL because `lotteryService`, route registration, and handler do not exist.

- [ ] **Step 3: Implement interface, route and error mapping**

```go
type lotteryHistoryService interface {
    History(context.Context) (lottery.HistorySnapshot, error)
}

func registerLotteryRoutes(mux *http.ServeMux, api *Server) {
    mux.HandleFunc("GET /api/v1/lottery/ssq/history", api.withAPIPipeline(api.handleLotteryHistory))
}

func (s *Server) handleLotteryHistory(w http.ResponseWriter, r *http.Request) {
    snapshot, err := s.lotteryService.History(r.Context())
    if err != nil {
        code := "lottery_source_unavailable"
        if errors.Is(err, lottery.ErrSourceInvalid) { code = "lottery_source_invalid" }
        writeJSON(w, http.StatusBadGateway, map[string]any{"error": code})
        return
    }
    writeJSON(w, http.StatusOK, snapshot)
}
```

Initialize `lotteryService: lottery.NewService(cfg.Lottery)` in `NewServer` and call `registerLotteryRoutes(mux, api)` next to the other feature route registrations.

- [ ] **Step 4: Format and run handler plus full backend tests**

Run: `gofmt -w internal/httpapi/server.go internal/httpapi/lottery_handlers.go internal/httpapi/lottery_handlers_test.go` from `backend/`  
Run: `go test ./... -count=1` from `backend/`  
Expected: PASS.

- [ ] **Step 5: Commit the HTTP endpoint slice**

```bash
git add backend/internal/httpapi/server.go backend/internal/httpapi/lottery_handlers.go backend/internal/httpapi/lottery_handlers_test.go
git commit -m "feat: expose ssq history endpoint"
```

---

### Task 3: Frontend Statistics Domain

**Files:**

- Create: `frontend/types/double-color-ball.ts`
- Create: `frontend/lib/double-color-ball.ts`
- Create: `frontend/tests/double-color-ball.test.mjs`
- Modify: `frontend/package.json`

**Interfaces:**

- Produces: `analyzeDraws(draws, windowSize)`, `classifyNumbers(stats)`, `getDrawStructure(draw)`。
- Produces types: `SSQDraw`, `SSQAnalysis`, `NumberStat`, `StructureSummary`。

- [ ] **Step 1: Define exact frontend types**

```ts
export type SSQDraw = {
  blue: number;
  date: string;
  issue: string;
  red: number[];
};

export type NumberTemperature = 'cold' | 'neutral' | 'hot';

export type NumberStat = {
  frequency: number;
  omission: number;
  number: number;
  temperature: NumberTemperature;
};

export type DrawStructure = {
  consecutivePairs: number;
  oddCount: number;
  redSum: number;
  zones: [number, number, number];
};

export type SSQAnalysis = {
  blueStats: NumberStat[];
  commonOddCounts: number[];
  commonZonePatterns: [number, number, number][];
  latestDraw: SSQDraw;
  redStats: NumberStat[];
  sumRange: [number, number];
  windowSize: 30 | 100 | 300;
};
```

- [ ] **Step 2: Write failing statistics tests**

```js
function makeSequentialDraws(count) {
  return Array.from({ length: count }, (_, index) => {
    const start = (index % 28) + 1;
    return {
      blue: (index % 16) + 1,
      date: `2026-01-${String((index % 28) + 1).padStart(2, '0')}`,
      issue: String(2027000 - index),
      red: Array.from({ length: 6 }, (_value, offset) => start + offset),
    };
  });
}

test('computes frequency totals, omissions and structures', () => {
  const draws = makeSequentialDraws(30);
  const analysis = analyzeDraws(draws, 30);
  assert.equal(analysis.redStats.reduce((sum, stat) => sum + stat.frequency, 0), 180);
  assert.equal(analysis.blueStats.reduce((sum, stat) => sum + stat.frequency, 0), 30);
  assert.equal(analysis.latestDraw.issue, draws[0].issue);
  assert.deepEqual(getDrawStructure({ red: [1, 2, 12, 17, 23, 33] }), {
    consecutivePairs: 1,
    oddCount: 4,
    redSum: 88,
    zones: [2, 2, 2],
  });
});

test('classifies exactly the top and bottom quartiles by activity rank', () => {
  const analysis = analyzeDraws(makeSequentialDraws(100), 100);
  assert.equal(analysis.redStats.filter((item) => item.temperature === 'hot').length, 8);
  assert.equal(analysis.redStats.filter((item) => item.temperature === 'cold').length, 8);
});
```

- [ ] **Step 3: Run the frontend test and confirm RED**

Run: `npm run test:ssq` from `frontend/`  
Expected: FAIL because the script and module do not exist.

- [ ] **Step 4: Add the test script and implement pure statistics**

```json
"test:ssq": "node --test --experimental-strip-types tests/double-color-ball.test.mjs"
```

```ts
export function getDrawStructure(draw: Pick<SSQDraw, 'red'>): DrawStructure {
  const sorted = [...draw.red].sort((a, b) => a - b);
  return {
    consecutivePairs: sorted.slice(1).filter((value, index) => value - sorted[index] === 1).length,
    oddCount: sorted.filter((value) => value % 2 === 1).length,
    redSum: sorted.reduce((sum, value) => sum + value, 0),
    zones: [
      sorted.filter((value) => value <= 11).length,
      sorted.filter((value) => value >= 12 && value <= 22).length,
      sorted.filter((value) => value >= 23).length,
    ],
  };
}
```

`analyzeDraws` must slice exactly the selected newest window, calculate frequency and omission arrays, rank activity by normalized frequency plus normalized omission recency, classify eight hot and eight cold red balls, calculate percentile sum bounds, and return the top three zone patterns and odd counts using stable tie-breaking.

- [ ] **Step 5: Run statistics tests and lint the new modules**

Run: `npm run test:ssq` from `frontend/`  
Run: `npx eslint lib/double-color-ball.ts types/double-color-ball.ts tests/double-color-ball.test.mjs` from `frontend/`  
Expected: PASS.

- [ ] **Step 6: Commit the statistics slice**

```bash
git add frontend/types/double-color-ball.ts frontend/lib/double-color-ball.ts frontend/tests/double-color-ball.test.mjs frontend/package.json
git commit -m "feat: add ssq statistics engine"
```

---

### Task 4: Deterministic Generator and Walk-Forward Backtest

**Files:**

- Modify: `frontend/types/double-color-ball.ts`
- Modify: `frontend/lib/double-color-ball.ts`
- Modify: `frontend/tests/double-color-ball.test.mjs`

**Interfaces:**

- Consumes: `SSQAnalysis`, `getDrawStructure` from Task 3.
- Produces: `generateReferenceBatch(analysis, batchIndex)`, `runWalkForwardBacktest(draws, windowSize)`。
- Produces types: `ReferenceCombination`, `ReferenceBatch`, `BacktestSummary`。

- [ ] **Step 1: Add failing generator invariants tests**

```js
function intersectionSize(left, right) {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value)).length;
}

test('generates a deterministic legal low-overlap batch', () => {
  const analysis = analyzeDraws(makeSequentialDraws(300), 100);
  const first = generateReferenceBatch(analysis, 0);
  const repeated = generateReferenceBatch(analysis, 0);
  assert.deepEqual(first, repeated);
  assert.equal(first.combinations.length, 5);
  for (const item of first.combinations) {
    assert.equal(new Set(item.red).size, 6);
    assert.deepEqual(item.red, [...item.red].sort((a, b) => a - b));
    assert.ok(item.red.every((value) => value >= 1 && value <= 33));
    assert.ok(item.blue >= 1 && item.blue <= 16);
    assert.ok(item.structureScore >= 0 && item.structureScore <= 100);
  }
  for (let left = 0; left < 5; left += 1) {
    for (let right = left + 1; right < 5; right += 1) {
      assert.ok(intersectionSize(first.combinations[left].red, first.combinations[right].red) <= 2);
    }
  }
});

test('changes the batch when batchIndex changes', () => {
  const analysis = analyzeDraws(makeSequentialDraws(300), 100);
  assert.notDeepEqual(generateReferenceBatch(analysis, 0), generateReferenceBatch(analysis, 1));
});
```

- [ ] **Step 2: Run generator tests and confirm RED**

Run: `npm run test:ssq -- --test-name-pattern="deterministic|batchIndex"` from `frontend/`  
Expected: FAIL because generator functions and types do not exist.

- [ ] **Step 3: Implement seeded sampling, constraints and score**

```ts
export type ReferenceCombination = {
  blue: number;
  label: 'balanced' | 'distributed' | 'trend' | 'mixed' | 'low-overlap';
  relaxedConstraints: string[];
  red: number[];
  structure: DrawStructure & { hotCount: number; latestRepeatCount: number; maximumBatchOverlap: number };
  structureScore: number;
};

export function generateReferenceBatch(analysis: SSQAnalysis, batchIndex: number): ReferenceBatch {
  const random = createSeededRandom(`${analysis.latestDraw.issue}:${analysis.windowSize}:${batchIndex}`);
  const combinations: ReferenceCombination[] = [];
  for (let attempt = 0; attempt < 5000 && combinations.length < 5; attempt += 1) {
    const candidate = buildWeightedCandidate(analysis, random);
    if (acceptCandidate(candidate, combinations, analysis, strictConstraints)) {
      combinations.push(scoreCandidate(candidate, combinations, analysis));
    }
  }
  return fillWithDocumentedRelaxation(combinations, analysis, random, batchIndex);
}
```

Implement a small string-hash plus `mulberry32` PRNG, weighted sampling without replacement, strict constraints from the spec, stable labels by index, and relaxation order `blue uniqueness -> batch overlap -> consecutive pairs -> sum range`. Every relaxation must be included in `relaxedConstraints`.

- [ ] **Step 4: Add failing no-leakage backtest test**

```js
test('walk-forward backtest never reads the target or future draws', () => {
  const draws = makeSequentialDraws(180);
  const observedWindows = [];
  const result = runWalkForwardBacktest(draws, 100, {
    onWindow(target, history) {
      observedWindows.push({ target: target.issue, history: history.map((draw) => draw.issue) });
    },
  });
  assert.ok(result.sampleCount > 0);
  for (const item of observedWindows) {
    assert.ok(!item.history.includes(item.target));
  }
  assert.equal(result.hitBuckets.zeroToOne + result.hitBuckets.twoToThree + result.hitBuckets.fourPlus, result.sampleCount);
});
```

- [ ] **Step 5: Implement capped walk-forward backtest**

```ts
export function runWalkForwardBacktest(
  draws: readonly SSQDraw[],
  windowSize: 30 | 100 | 300,
  hooks: { onWindow?: (target: SSQDraw, history: readonly SSQDraw[]) => void } = {},
): BacktestSummary {
  const targetCount = windowSize === 30 ? 30 : 60;
  const chronological = [...draws].reverse();
  const eligible = chronological.slice(windowSize);
  const targets = eligible.slice(-targetCount);
  return summarizeTargets(targets, chronological, windowSize, hooks);
}
```

For every target, pass only the immediately preceding `windowSize` draws into `analyzeDraws`, generate batch 0, compare all five combinations with the target, and aggregate `0-1`, `2-3`, `4+` red hits plus blue hit count.

- [ ] **Step 6: Run all SSQ domain tests and lint**

Run: `npm run test:ssq` from `frontend/`  
Run: `npx eslint lib/double-color-ball.ts types/double-color-ball.ts tests/double-color-ball.test.mjs` from `frontend/`  
Expected: PASS.

- [ ] **Step 7: Commit generator and backtest**

```bash
git add frontend/types/double-color-ball.ts frontend/lib/double-color-ball.ts frontend/tests/double-color-ball.test.mjs
git commit -m "feat: generate and backtest ssq references"
```

---

### Task 5: Frontend API and Saved Batch Storage

**Files:**

- Create: `frontend/lib/double-color-ball-api.ts`
- Create: `frontend/lib/double-color-ball-storage.ts`
- Create: `frontend/lib/double-color-ball-storage.web.ts`
- Create: `frontend/lib/double-color-ball-storage.native.ts`
- Modify: `frontend/types/double-color-ball.ts`
- Modify: `frontend/tests/double-color-ball.test.mjs`

**Interfaces:**

- Produces: `fetchSSQHistory(signal?)`, `getSSQErrorMessage(error)`。
- Produces: `getSavedSSQBatch()`, `setSavedSSQBatch(value)`, `removeSavedSSQBatch()`。
- Consumes: `getAPIBaseUrl()` and `ReferenceBatch`。

- [ ] **Step 1: Add failing snapshot and storage contract tests**

```js
test('saved batch storage round-trips only the current batch payload', async () => {
  await removeSavedSSQBatch();
  const analysis = analyzeDraws(makeSequentialDraws(100), 100);
  const saved = {
    batch: generateReferenceBatch(analysis, 2),
    batchIndex: 2,
    issue: analysis.latestDraw.issue,
    windowSize: 100,
  };
  await setSavedSSQBatch(saved);
  assert.deepEqual(await getSavedSSQBatch(), saved);
  await removeSavedSSQBatch();
  assert.equal(await getSavedSSQBatch(), null);
});

test('maps lottery API errors to actionable Chinese copy', () => {
  assert.equal(getSSQErrorMessage(new SSQAPIError('lottery_source_unavailable', 502)), '官方开奖数据暂时不可用，请稍后重试。');
  assert.equal(getSSQErrorMessage(new SSQAPIError('lottery_source_invalid', 502)), '官方开奖数据格式异常，暂时无法生成参考组合。');
});
```

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `npm run test:ssq -- --test-name-pattern="storage|API errors"` from `frontend/`  
Expected: FAIL because API and storage modules do not exist.

- [ ] **Step 3: Implement API client and exact response type**

```ts
export type SSQHistorySnapshot = {
  analysisWindowMax: 300;
  draws: SSQDraw[];
  fetchedAt: string;
  source: 'cwl';
  sourceUrl: string;
  stale: boolean;
};

export async function fetchSSQHistory(signal?: AbortSignal) {
  const response = await fetch(`${getAPIBaseUrl()}/api/v1/lottery/ssq/history`, { signal });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new SSQAPIError(payload.error || 'request_failed', response.status);
  return payload as SSQHistorySnapshot;
}
```

- [ ] **Step 4: Implement platform storage adapters**

```ts
const savedBatchKey = 'funbox.ssq.saved-batch.v1';

export type SavedSSQBatch = {
  batch: ReferenceBatch;
  batchIndex: number;
  issue: string;
  windowSize: 30 | 100 | 300;
};
```

Use module memory in `.ts`, `window.localStorage` in `.web.ts`, and `SecureStore.getItemAsync/setItemAsync/deleteItemAsync` in `.native.ts`. Parse JSON defensively and return `null` for malformed data.

- [ ] **Step 5: Run API/storage tests and lint**

Run: `npm run test:ssq` from `frontend/`  
Run: `npx eslint lib/double-color-ball-api.ts lib/double-color-ball-storage*.ts types/double-color-ball.ts` from `frontend/`  
Expected: PASS.

- [ ] **Step 6: Commit API and storage**

```bash
git add frontend/lib/double-color-ball-api.ts frontend/lib/double-color-ball-storage.ts frontend/lib/double-color-ball-storage.web.ts frontend/lib/double-color-ball-storage.native.ts frontend/types/double-color-ball.ts frontend/tests/double-color-ball.test.mjs
git commit -m "feat: load and save ssq reference batches"
```

---

### Task 6: Mobile UI Components and Screen Flow

**Files:**

- Create: `frontend/features/tools/double-color-ball-components.tsx`
- Create: `frontend/features/tools/double-color-ball-screen.tsx`
- Modify: `frontend/tests/double-color-ball.test.mjs`

**Interfaces:**

- Consumes: Tasks 3-5 domain, API and storage functions.
- Produces: `DoubleColorBallScreen` used by tool routing.
- Produces components: `NumberBall`, `HeatGrid`, `StructureBars`, `CombinationCard`, `BacktestPanel`。

- [ ] **Step 1: Add failing source-level UI guardrail test**

```js
test('screen keeps probability and responsibility guardrails visible', async () => {
  const source = await readFile(new URL('../features/tools/double-color-ball-screen.tsx', import.meta.url), 'utf8');
  assert.match(source, /1 \/ 17,721,088/);
  assert.match(source, /结构匹配度不是中奖概率/);
  assert.match(source, /仅供娱乐与概率研究参考/);
  assert.doesNotMatch(source, /AI 胜率/);
});
```

- [ ] **Step 2: Run UI guardrail test and confirm RED**

Run: `npm run test:ssq -- --test-name-pattern="guardrails"` from `frontend/`  
Expected: FAIL because the screen file does not exist.

- [ ] **Step 3: Build reusable visual components**

```tsx
type NumberBallProps = {
  number: number;
  size?: number;
  tone: 'blue' | 'neutral' | 'red';
};

const padBall = (number: number) => String(number).padStart(2, '0');

export function NumberBall({ number, tone, size = 32 }: NumberBallProps) {
  const backgroundColor = tone === 'blue' ? '#3785ff' : tone === 'red' ? '#ff5f72' : '#eef1f8';
  return (
    <View accessibilityLabel={`${tone === 'blue' ? '蓝球' : '红球'} ${padBall(number)}`} style={[styles.ball, { backgroundColor, height: size, width: size }]}>
      <ThemedText style={[styles.ballText, tone === 'neutral' && styles.neutralBallText]}>{padBall(number)}</ThemedText>
    </View>
  );
}
```

`HeatGrid` renders fixed 11-column red balls with stable dimensions. `CombinationCard` uses seven `NumberBall` components, selected border, strategy label, score, accessibility state, and press handling. `StructureBars` and `BacktestPanel` use plain `View` bars so no chart dependency is added.

- [ ] **Step 4: Implement screen state machine**

```ts
type ViewMode = 'analysis' | 'combinations';
type LoadState = 'loading' | 'ready' | 'error';

const [viewMode, setViewMode] = useState<ViewMode>('analysis');
const [windowSize, setWindowSize] = useState<30 | 100 | 300>(100);
const [batchIndex, setBatchIndex] = useState(0);
const [selectedCombinationIndex, setSelectedCombinationIndex] = useState(0);
const [loadState, setLoadState] = useState<LoadState>('loading');
```

On mount, fetch history with `AbortController`, calculate the selected analysis, restore saved batch only when issue and window match, otherwise generate batch 0. Switching windows recalculates analysis and resets batch index. “换一批组合” increments `batchIndex`. “保存本期” writes the exact current batch. Entering the combinations view computes backtest after the navigation state update and shows a progress placeholder.

Render states exactly:

- Loading: `正在同步官方开奖数据` with activity indicator.
- Error: `getSSQErrorMessage(error)` plus `重新加载` button.
- Stale: amber banner with fetched time.
- Ready analysis: latest draw metadata, probability strip, tabs, heat grid, structure bars, CTA.
- Ready combinations: five cards, selected evidence, backtest, save/regenerate, responsibility copy.

- [ ] **Step 5: Run UI tests, TypeScript and focused lint**

Run: `npm run test:ssq` from `frontend/`  
Run: `npx tsc --noEmit` from `frontend/`  
Run: `npx eslint features/tools/double-color-ball-components.tsx features/tools/double-color-ball-screen.tsx` from `frontend/`  
Expected: PASS.

- [ ] **Step 6: Commit the screen slice**

```bash
git add frontend/features/tools/double-color-ball-components.tsx frontend/features/tools/double-color-ball-screen.tsx frontend/tests/double-color-ball.test.mjs
git commit -m "feat: build ssq probability reference screen"
```

---

### Task 7: Tool Registration and Route Integration

**Files:**

- Modify: `backend/internal/access/feature_registry.json`
- Modify: `frontend/features/tools/tool-detail-screen.tsx`
- Modify: `frontend/tests/double-color-ball.test.mjs`

**Interfaces:**

- Consumes: `DoubleColorBallScreen` from Task 6.
- Produces tool ID `double-color-ball` and route `/tools/double-color-ball` for all roles.

- [ ] **Step 1: Add failing registration test**

```js
test('registers double color ball for every app role', async () => {
  const registryUrl = new URL('../../backend/internal/access/feature_registry.json', import.meta.url);
  const registry = JSON.parse(await readFile(registryUrl, 'utf8'));
  const tool = registry.find((item) => item.id === 'double-color-ball');
  assert.deepEqual(
    { initialRoles: tool?.initialRoles, route: tool?.route, status: tool?.status },
    { initialRoles: ['normal', 'vip', 'svip', 'admin'], route: '/tools/double-color-ball', status: 'available' },
  );
});
```

- [ ] **Step 2: Run registration test and confirm RED**

Run: `npm run test:ssq -- --test-name-pattern="registers"` from `frontend/`  
Expected: FAIL because the registry entry does not exist.

- [ ] **Step 3: Register the tool**

```json
{
  "id": "double-color-ball",
  "name": "双色球概率参考",
  "tagline": "历史数据与结构化参考号",
  "description": "查看近期开奖的冷热、遗漏和分布结构，并生成五组可解释、低重合的下期参考号码。",
  "icon": "chart-bell-curve-cumulative",
  "category": "数据",
  "route": "/tools/double-color-ball",
  "accentColor": "#ff5f72",
  "badges": ["历史分析", "理性参考"],
  "usageLabel": "查看概率分析",
  "status": "available",
  "featured": true,
  "initialRoles": ["normal", "vip", "svip", "admin"]
}
```

- [ ] **Step 4: Add route dispatch**

```tsx
import { DoubleColorBallScreen } from '@/features/tools/double-color-ball-screen';

if (tool?.id === 'double-color-ball') {
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <DoubleColorBallScreen />
    </>
  );
}
```

- [ ] **Step 5: Run registration test and complete frontend static checks**

Run: `npm run test:ssq` from `frontend/`  
Run: `npm run frontend:lint` from the repository root  
Run: `npx tsc --noEmit` from `frontend/`  
Expected: PASS.

- [ ] **Step 6: Commit registration**

```bash
git add backend/internal/access/feature_registry.json frontend/features/tools/tool-detail-screen.tsx frontend/tests/double-color-ball.test.mjs
git commit -m "feat: register ssq probability reference tool"
```

---

### Task 8: Integrated Runtime and Responsive Verification

**Files:**

- Modify only files required to fix defects found by the commands below.
- Do not edit unrelated dirty files.

**Interfaces:**

- Consumes the complete feature from Tasks 1-7.
- Produces verified backend, frontend, Web runtime, and screenshot evidence.

- [ ] **Step 1: Run full automated verification**

Run: `go test ./... -count=1` from `backend/`  
Run: `npm run test:ssq` from `frontend/`  
Run: `npm run lint` from `frontend/`  
Run: `npx tsc --noEmit` from `frontend/`  
Expected: all commands exit 0.

- [ ] **Step 2: Start backend and Expo Web on free ports**

Run backend from `backend/` with `go run ./cmd/api`. Use the configured default `http://127.0.0.1:3000` unless occupied.  
Run frontend from `frontend/` with `npx expo start --web --port 8081`. If 8081 is occupied, increment to the next free port.  
Expected: both long-running processes remain active and print their URLs.

- [ ] **Step 3: Verify the live data contract**

Run: `Invoke-RestMethod http://127.0.0.1:3000/api/v1/lottery/ssq/history | ConvertTo-Json -Depth 5`  
Expected: source `cwl`, `analysisWindowMax` 300, 360-400 validated draws, latest issue first, and `stale` false under normal network conditions.

- [ ] **Step 4: Verify the rendered workflow at desktop-narrow and mobile sizes**

Open `/tools/double-color-ball` in the browser. Verify at 430×932 and 390×844:

- Analysis view has no horizontal overflow.
- All 33 heat balls remain visible in an 11-column grid.
- The probability warning appears before the reference-number CTA.
- Switching 30/100/300 changes the analysis.
- Five combinations render seven balls each.
- Selecting a combination updates the evidence panel.
- Saving changes the button to `已保存` and survives refresh.
- Regenerating changes the batch while preserving legality.
- Stale/error banners do not overlap the header or controls.

Save screenshots to `output/ssq-analysis-430.png` and `output/ssq-combinations-390.png`.

- [ ] **Step 5: Check browser console and network failures**

Expected console: no React key warnings, unhandled promise rejections, or layout errors.  
Expected network: one history request on initial load; no repeated request when switching windows or combinations.

- [ ] **Step 6: Stop long-running verification processes**

Terminate the backend and Expo sessions cleanly after screenshots and console checks finish.

- [ ] **Step 7: Review the final diff and commit verification fixes**

Run: `git diff --check`  
Run: `git status --short`  
Confirm only intended feature files and pre-existing user changes are present. If verification required code fixes, commit only those feature files:

```bash
git add backend/internal/config/config.go backend/internal/lottery backend/internal/httpapi/lottery_handlers.go backend/internal/httpapi/lottery_handlers_test.go backend/internal/httpapi/server.go backend/internal/access/feature_registry.json frontend/types/double-color-ball.ts frontend/lib/double-color-ball.ts frontend/lib/double-color-ball-api.ts frontend/lib/double-color-ball-storage.ts frontend/lib/double-color-ball-storage.web.ts frontend/lib/double-color-ball-storage.native.ts frontend/features/tools/double-color-ball-components.tsx frontend/features/tools/double-color-ball-screen.tsx frontend/features/tools/tool-detail-screen.tsx frontend/tests/double-color-ball.test.mjs frontend/package.json
git commit -m "fix: polish ssq probability reference workflow"
```

If no fixes were required, do not create an empty commit.
