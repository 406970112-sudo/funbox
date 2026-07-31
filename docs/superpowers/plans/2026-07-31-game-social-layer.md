# Game Social Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 接入统一游戏社交能力层，让五子棋支持好友实时对战，让积分游戏支持好友周榜与历史榜。

**Architecture:** 后端在现有社交存储上增加通用对局、落子与成绩表，通过游戏注册表限制能力，并由五子棋适配器服务端裁决。前端新增独立 `GameSocialProvider`，游戏页面消费统一接口和共享组件，不直接拼接 HTTP 或好友逻辑。

**Tech Stack:** Go 1.24、SQLite、`net/http`、现有 WebSocket Hub、Expo Router、React 19、React Native、TypeScript、Node test runner。

## Global Constraints

- 保持现有 FunBox 深蓝、主蓝、青柠视觉语言和移动端页面密度。
- 五子棋好友局必须由服务端校验落子和胜负，REST 是断线恢复的权威来源。
- 好友榜只能返回当前用户及其好友。
- 新增生产逻辑先写失败测试并确认失败原因，再写最小实现。
- 不升级依赖，不改动与本功能无关的文件。
- 最终提交信息使用中文并带 `feat:` 或 `fix:` 前缀。

---

### Task 1: 游戏能力注册与后端存储

**Files:**
- Create: `backend/internal/social/game_store.go`
- Create: `backend/internal/social/game_store_test.go`
- Modify: `backend/internal/social/store.go`

**Interfaces:**
- Produces: `GameCapabilityFor(gameID string) (GameCapability, bool)`、`CreateGameMatch`、`ListGameMatches`、`GetGameMatch`、`RespondGameMatch`、`SubmitGameMove`、`ResignGameMatch`、`SubmitGameScore`、`ListFriendLeaderboard`。
- `SubmitGameMove` consumes `GameMoveInput{ClientMoveID, Col, Row}` and returns the authoritative `GameMatch`.

```go
type GameCapability struct {
	FriendMatch bool
	ScoreRule   string
}

type GameMoveInput struct {
	ClientMoveID string
	Col          int
	Row          int
}

func (s *Store) CreateGameMatch(ctx context.Context, inviterID, opponentID, gameID string) (GameMatch, error)
func (s *Store) SubmitGameMove(ctx context.Context, matchID, userID string, input GameMoveInput) (GameMatch, error)
func (s *Store) ListFriendLeaderboard(ctx context.Context, userID, gameID, period string, now time.Time) ([]LeaderboardEntry, error)
```

- [ ] **Step 1: Write failing store tests** covering non-friend rejection, invitation acceptance, turn enforcement, duplicate move idempotency, five-in-a-row victory, resignation, score best selection, weekly filtering, and friend-only visibility.
- [ ] **Step 2: Run `go test ./internal/social -run 'TestGame' -v`** and verify failures are caused by missing game social types and methods.
- [ ] **Step 3: Add registry and migrations** with `gomoku: friendMatch`, `snake-brawl/tetris/brick-breaker: higher score`, plus the three game tables and indexes.
- [ ] **Step 4: Implement match and leaderboard methods** using transactions, ordered friendship checks, stable rank ordering (`score DESC, updated_at ASC, user_id ASC`), and Monday-based weekly cutoff.
- [ ] **Step 5: Run `go test ./internal/social -run 'TestGame' -v`** and verify all store tests pass.

### Task 2: HTTP and realtime game social API

**Files:**
- Create: `backend/internal/httpapi/game_social_handlers.go`
- Create: `backend/internal/httpapi/game_social_handlers_test.go`
- Modify: `backend/internal/httpapi/server.go`

**Interfaces:**
- Consumes: Task 1 store methods.
- Produces: JSON `gameMatchResponse`, `gameLeaderboardResponse`, and realtime events `game.match.invited`, `game.match.updated`, `game.match.finished`, `game.score.updated`.

```json
{
  "match": {
    "id": "match-id",
    "gameId": "gomoku",
    "status": "active",
    "currentTurnUserId": "user-id",
    "moves": [{"sequence": 1, "userId": "user-id", "row": 7, "col": 7}]
  }
}
```

- [ ] **Step 1: Write failing HTTP flow test** that registers two users, creates friendship, invites and accepts a Gomoku match, exchanges winning moves, verifies realtime events, submits two scores, and verifies the friend leaderboard response.
- [ ] **Step 2: Run `go test ./internal/httpapi -run TestGameSocialHTTPFlow -v`** and verify the first missing route returns 404.
- [ ] **Step 3: Register authenticated routes** for matches, moves, resign, scores, and leaderboards, using existing JSON/error helpers and rate limiting on invitation, move, and score writes.
- [ ] **Step 4: Implement handlers and response mappers** so both participants receive authoritative match events and friends receive score refresh events.
- [ ] **Step 5: Run `go test ./internal/httpapi -run TestGameSocialHTTPFlow -v`** and verify the complete flow passes.

### Task 3: 前端游戏社交客户端与 Provider

**Files:**
- Create: `frontend/types/game-social.ts`
- Create: `frontend/lib/game-social-api.ts`
- Create: `frontend/features/game-social/game-social-registry.ts`
- Create: `frontend/features/game-social/game-social-provider.tsx`
- Create: `frontend/tests/game-social-registry.test.mjs`
- Modify: `frontend/app/_layout.tsx`

**Interfaces:**
- Produces: `useGameSocial()` with `matches`, `inviteFriend`, `respondToInvite`, `playGomokuMove`, `resignMatch`, `submitScore`, `loadLeaderboard`, and `refreshMatches`.
- Produces: `getGameSocialCapability(gameID)` and `rankLeaderboardEntries(entries, currentUserID)` as pure tested helpers.

```ts
type GameSocialContextValue = {
  matches: GameMatch[];
  inviteFriend: (gameId: GameId, opponentId: string) => Promise<GameMatch>;
  respondToInvite: (matchId: string, action: 'accept' | 'decline') => Promise<GameMatch>;
  playGomokuMove: (matchId: string, row: number, col: number) => Promise<GameMatch>;
  resignMatch: (matchId: string) => Promise<GameMatch>;
  submitScore: (gameId: GameId, score: number) => Promise<void>;
  loadLeaderboard: (gameId: GameId, period: LeaderboardPeriod) => Promise<LeaderboardEntry[]>;
};
```

- [ ] **Step 1: Write failing registry tests** asserting Gomoku is friend-match capable, score games use `higher`, unsupported games expose neither capability, and current-user leaderboard entries remain server-ranked.
- [ ] **Step 2: Run `node --test --experimental-strip-types tests/game-social-registry.test.mjs`** and verify failure is caused by the missing registry module.
- [ ] **Step 3: Implement typed API and registry** with avatar URL resolution, API error mapping, and exact backend payloads.
- [ ] **Step 4: Implement Provider** that derives game events from `SocialProvider.lastEventSequence`, refreshes only match state for match events, and keeps score submissions out of initial render waterfalls.
- [ ] **Step 5: Wrap the app with `GameSocialProvider`** inside `SocialProvider` and run the registry test to green.

### Task 4: 五子棋好友实时对战

**Files:**
- Create: `frontend/features/game-social/friend-match-sheet.tsx`
- Create: `frontend/features/game-social/gomoku-friend-match.tsx`
- Modify: `frontend/features/games/gomoku-game-screen.tsx`

**Interfaces:**
- Consumes: `useSocial().friends`, `useGameSocial()` and the existing `GomokuBoardView` visual language.
- Produces: a mode switch between `ai` and `friend`, invitation sheet, incoming invitation actions, authoritative match board, reconnect state, and resign action.

- [ ] **Step 1: Extract shared board input mapping** without changing human-vs-AI behavior and keep existing Gomoku engine tests green.
- [ ] **Step 2: Add the mode switch and friend sheet** using existing `MobileScreen`, `SocialAvatar`, theme colors, segmented controls, and login fallback.
- [ ] **Step 3: Render active friend matches** from server moves; disable cells unless it is the current user's turn; replace AI-only undo/restart controls with chat-status, refresh, and resign actions.
- [ ] **Step 4: Verify incoming invite accept/decline, pending invite state, active play, finished result, and disconnected status in the web app.**

### Task 5: 好友排行榜与积分游戏接入

**Files:**
- Create: `frontend/app/games/[gameId]/leaderboard.tsx`
- Create: `frontend/features/game-social/game-leaderboard-screen.tsx`
- Create: `frontend/features/game-social/game-leaderboard-button.tsx`
- Modify: `frontend/features/games/tetris-game-screen.tsx`
- Modify: `frontend/features/games/snake-game-screen.tsx`
- Modify: `frontend/features/games/brick-breaker-game-screen.tsx`
- Modify: `frontend/app/_layout.tsx`

**Interfaces:**
- Consumes: `useGameSocial().submitScore/loadLeaderboard` and `getGameSocialCapability`.
- Produces: shared trophy entry, weekly/all-time segmented leaderboard, podium/list presentation, and one score submission per completed run.

- [ ] **Step 1: Add leaderboard route and shared button** with logged-out guidance and existing page/header patterns.
- [ ] **Step 2: Implement weekly/history leaderboard UI** with current-user highlight, loading/empty/error states, and stable dimensions at mobile and desktop widths.
- [ ] **Step 3: Submit final score once** when Tetris reaches game over, Snake reaches crashed/cleared/victory, and Brick Breaker reaches lost; use refs to prevent duplicate effect submissions.
- [ ] **Step 4: Add leaderboard entry** to each score game's header or result sheet without displacing existing primary controls.
- [ ] **Step 5: Run targeted front-end tests and manually verify all three routes.**

### Task 6: Full verification, commit, and push

**Files:**
- Modify only files listed above plus this design and plan.

- [ ] **Step 1: Run `gofmt` on changed Go files.**
- [ ] **Step 2: Run `go test ./...` in `backend`.**
- [ ] **Step 3: Run `node --test --experimental-strip-types tests/*.test.mjs`, `npx tsc --noEmit`, and `npm run lint` in `frontend`.**
- [ ] **Step 4: Start Expo web, verify Gomoku friend flow and leaderboard desktop/mobile screenshots, and inspect console errors.**
- [ ] **Step 5: Audit `git diff --check`, changed-file scope, and requirement coverage.**
- [ ] **Step 6: Commit with `feat: 接入游戏社交对战与好友排行` and push the commit to `origin/main` only after confirming remote `main` has not advanced.**
