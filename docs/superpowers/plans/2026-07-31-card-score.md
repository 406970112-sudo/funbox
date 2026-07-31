# Card Score Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a production-ready Funbox card-game scoring room where a logged-in host and temporary guests record zero-sum round deltas, confirm immutable rounds, sync state in real time, and receive an exact minimum-transfer settlement.

**Architecture:** Add an isolated Go `score` domain package backed by the existing SQLite database and expose commands/snapshots through the existing HTTP server. Reuse the existing Realtime Hub with score-specific principals and treat REST snapshots as the source of truth. Add a focused Expo tool module that uses the existing theme/components, persists guest room credentials per platform, and refreshes on WebSocket invalidation events.

**Tech Stack:** Go 1.22, `modernc.org/sqlite`, `golang-jwt/jwt/v5`, Gorilla WebSocket, Expo 54, React Native 0.81, Expo Router 6, TypeScript 5.9, `react-native-qrcode-svg`, Node test runner.

## Global Constraints

- Keep hosts account-authenticated; allow guests to join with a 1-12 character unique temporary nickname.
- Support 2-8 participants, integer score deltas, and integer currency minor units only.
- Start every participant at 0; count only unanimously confirmed zero-sum rounds.
- Confirmed rounds are immutable; corrections are linked reversal rounds.
- Generate a genuinely minimum transaction count for settlement, not a greedy approximation.
- Reuse existing `MobileScreen`, `useAppTheme`, `MaterialCommunityIcons`, spacing, radius, light mode, and dark mode conventions.
- Do not add runtime dependencies or a new infrastructure service.
- Keep REST snapshots authoritative; WebSocket events only invalidate/refresh the current snapshot.
- Use Codex's internal browser for desktop, mobile, dark-mode, multi-tab, console, and network verification.

---

## File Structure

### Backend

- Create `backend/internal/score/model.go`: domain enums, DTOs, actor identity, command inputs, errors.
- Create `backend/internal/score/settlement.go`: exact minimum-transfer search and balance validation.
- Create `backend/internal/score/settlement_test.go`: deterministic and exhaustive settlement tests.
- Create `backend/internal/score/store.go`: SQLite connection, migrations, transactional persistence, snapshot queries.
- Create `backend/internal/score/service.go`: room lifecycle, permissions, idempotency, zero-sum confirmation, reversal, settlement, guest JWTs.
- Create `backend/internal/score/service_test.go`: domain and persistence tests against a temporary SQLite database.
- Create `backend/internal/httpapi/score_handlers.go`: score authentication middleware, JSON handlers, error mapping, realtime publishing.
- Create `backend/internal/httpapi/score_handlers_test.go`: end-to-end HTTP and WebSocket room test.
- Modify `backend/internal/httpapi/server.go`: inject `score.Service`, register routes.
- Modify `backend/internal/httpapi/social_handlers.go`: skip social presence callbacks for score principals.
- Modify `backend/cmd/api/main.go`: open score store, construct service with the existing signing key, close store.

### Frontend

- Create `frontend/types/card-score.ts`: wire DTOs and UI credential/session types.
- Create `frontend/lib/card-score.ts`: pure formatting, sorting, progress, score-difference helpers.
- Create `frontend/tests/card-score.test.mjs`: pure helper tests.
- Create `frontend/lib/card-score-api.ts`: REST commands, error mapping, realtime URL.
- Create `frontend/lib/card-score-session-storage.ts`: memory fallback.
- Create `frontend/lib/card-score-session-storage.native.ts`: SecureStore implementation.
- Create `frontend/lib/card-score-session-storage.web.ts`: localStorage implementation.
- Create `frontend/features/tools/card-score/card-score-components.tsx`: themed controls, participant rows, status/progress, settlement rows.
- Create `frontend/features/tools/card-score/card-score-screen.tsx`: create/join/waiting/active/settled state orchestration and realtime refresh.
- Modify `frontend/features/tools/tool-detail-screen.tsx`: route `card-score` to the new screen.
- Modify `backend/internal/access/feature_registry.json`: register the visible tool.
- Modify `frontend/features/auth/auth-screen.tsx`: support a validated `/tools/...` return target after login.
- Modify `frontend/package.json`: add a `test:card-score` script only; no dependency changes.

---

### Task 1: Exact Settlement Engine

**Files:**
- Create: `backend/internal/score/model.go`
- Create: `backend/internal/score/settlement.go`
- Test: `backend/internal/score/settlement_test.go`

**Interfaces:**
- Consumes: `map[string]int64` of participant ID to balance in cents.
- Produces: `func MinimumTransfers(balances map[string]int64, order []string) ([]Transfer, error)`.
- Produces: `type Transfer struct { FromParticipantID string; ToParticipantID string; AmountCents int64 }`.

- [ ] **Step 1: Write failing balance and optimality tests**

```go
func TestMinimumTransfers(t *testing.T) {
    balances := map[string]int64{"a": 1000, "b": -500, "c": -500}
    got, err := MinimumTransfers(balances, []string{"a", "b", "c"})
    if err != nil || len(got) != 2 { t.Fatalf("transfers=%v err=%v", got, err) }
    assertBalancesSettled(t, balances, got)
}

func TestMinimumTransfersRejectsUnbalancedInput(t *testing.T) {
    _, err := MinimumTransfers(map[string]int64{"a": 100, "b": -99}, []string{"a", "b"})
    if !errors.Is(err, ErrBalancesNotZero) { t.Fatalf("err=%v", err) }
}
```

- [ ] **Step 2: Run the focused test and verify the red state**

Run: `go test ./internal/score -run TestMinimumTransfers -count=1` from `backend/`
Expected: FAIL because `MinimumTransfers` and score domain types do not exist.

- [ ] **Step 3: Implement exact DFS with deterministic tie-breaking**

```go
func MinimumTransfers(balances map[string]int64, order []string) ([]Transfer, error) {
    // Validate sum == 0, discard zero balances, then recursively pair the first
    // non-zero balance with opposite-signed balances. Memoize normalized states,
    // prefer complete cancellation, and retain the shortest deterministic plan.
}
```

Use participant order then ID as the stable tie-breaker. Apply each returned transfer to a fresh copy of balances and reject any result that does not settle every participant exactly.

- [ ] **Step 4: Add exhaustive small-balance verification and run tests**

Enumerate 2-6 participant balances in `[-3, 3]` whose sum is zero, compare the returned plan length with an independent minimum-count recursion, and validate amount conservation.

Run: `go test ./internal/score -run MinimumTransfers -count=1` from `backend/`
Expected: PASS.

- [ ] **Step 5: Commit the settlement engine**

```powershell
git add backend/internal/score/model.go backend/internal/score/settlement.go backend/internal/score/settlement_test.go
git commit -m "feat: add exact card score settlement"
```

### Task 2: SQLite Score Store and Snapshot Model

**Files:**
- Create: `backend/internal/score/store.go`
- Test: `backend/internal/score/service_test.go`

**Interfaces:**
- Consumes: existing `DATABASE_PATH`.
- Produces: `OpenStore(path string) (*Store, error)`, `Close() error`, and transaction/query helpers used by `Service`.
- Produces tables: `score_rooms`, `score_participants`, `score_rounds`, `score_entries`, `score_confirmations`, `score_room_events`, `score_command_receipts`, `score_settlements`.

- [ ] **Step 1: Write a failing migration and round-trip snapshot test**

```go
func TestOpenStoreCreatesScoreSchema(t *testing.T) {
    store, err := OpenStore(filepath.Join(t.TempDir(), "score.db"))
    if err != nil { t.Fatal(err) }
    defer store.Close()
    for _, table := range []string{"score_rooms", "score_participants", "score_rounds", "score_entries", "score_confirmations", "score_room_events", "score_command_receipts", "score_settlements"} {
        if !store.tableExists(t.Context(), table) { t.Fatalf("missing table %s", table) }
    }
}
```

- [ ] **Step 2: Verify the migration test fails**

Run: `go test ./internal/score -run TestOpenStoreCreatesScoreSchema -count=1` from `backend/`
Expected: FAIL because `OpenStore` is undefined.

- [ ] **Step 3: Implement store setup and migrations**

Open SQLite with one connection, enable foreign keys, `busy_timeout=5000`, and WAL. Add checks for room/round states, participant status, positive money rate, player limits, unique active room code, unique room nickname, unique round entry, unique confirmation, and unique actor command ID.

```go
type Store struct { db *sql.DB }

func OpenStore(databasePath string) (*Store, error) {
    // Match existing user/social/access store setup and run score migrations.
}
```

- [ ] **Step 4: Implement complete snapshot queries**

Define `RoomSnapshot`, `Participant`, `Round`, `Entry`, `Confirmation`, and `Settlement` in `model.go`. Load room, ordered participants, confirmed history, current non-final round, totals from confirmed entries, and settlement in consistent order.

- [ ] **Step 5: Run score package tests**

Run: `go test ./internal/score -count=1` from `backend/`
Expected: PASS.

- [ ] **Step 6: Commit the store**

```powershell
git add backend/internal/score/store.go backend/internal/score/model.go backend/internal/score/service_test.go
git commit -m "feat: persist card score rooms"
```

### Task 3: Room Ledger Service, Permissions, and Guest Tokens

**Files:**
- Create: `backend/internal/score/service.go`
- Modify: `backend/internal/score/service_test.go`

**Interfaces:**
- Produces: `NewService(store *Store, signingKey []byte, guestTTL time.Duration) *Service`.
- Produces commands: `CreateRoom`, `JoinRoom`, `CancelRoom`, `StartRoom`, `StartRound`, `SubmitEntry`, `ConfirmRound`, `CancelRound`, `RemoveParticipant`, `SettleRoom`, `GetRoom`, `ListHistory`, `IssueInviteToken`, `IssueGuestToken`, `AuthenticateGuestToken`.
- Consumes: `Actor{ParticipantID, UserID, RoomID, Role}` and `CommandMeta{ClientActionID, ExpectedRoomVersion}`.

- [ ] **Step 1: Write the failing happy-path service test**

```go
func TestServiceConfirmsZeroSumRoundAndSettles(t *testing.T) {
    service := newTestService(t)
    created, err := service.CreateRoom(ctx, "host-user", "房主", CreateRoomInput{Name: "周五牌局", MaxPlayers: 4, CentsPerPoint: 50})
    if err != nil { t.Fatal(err) }
    guest, err := service.JoinRoom(ctx, JoinRoomInput{Code: created.Room.Code, DisplayName: "小陈"})
    if err != nil { t.Fatal(err) }
    host := created.Actor
    room := mustStartRoom(t, service, host, created.Room)
    round := mustStartRound(t, service, host, room)
    mustSubmit(t, service, host, round, 10)
    mustSubmit(t, service, guest.Actor, round, -10)
    mustConfirm(t, service, host, round)
    final := mustConfirm(t, service, guest.Actor, round)
    if final.CurrentRound != nil || len(final.Rounds) != 1 || final.Rounds[0].Status != RoundConfirmed { t.Fatalf("room=%+v", final) }
    settled := mustSettle(t, service, host, final)
    if len(settled.Settlement.Transfers) != 1 { t.Fatalf("settlement=%+v", settled.Settlement) }
}
```

- [ ] **Step 2: Run and verify the service test fails**

Run: `go test ./internal/score -run TestServiceConfirmsZeroSumRoundAndSettles -count=1` from `backend/`
Expected: FAIL because `Service` command methods are undefined.

- [ ] **Step 3: Implement room creation, signed invitations, joining, and guest JWTs**

Generate a collision-checked 6-digit code. Create the host participant in the same transaction. Sign an invitation JWT containing `typ=score_invite`, `roomId`, `code`, `exp`, and `iat`; accept either that token or the manual room code in `JoinRoom`. Sign guest JWT claims containing `typ=score_guest`, `roomId`, `participantId`, `tokenVersion`, `exp`, and `iat`; validate signature, expiry, room/participant status, token version, and the 24-hour post-settlement read-only window on every guest-authenticated command.

- [ ] **Step 4: Implement ledger commands with idempotency**

For every write command: begin a transaction, check `score_command_receipts` before version validation, validate actor/room/round permissions, write domain rows, append an event with strictly increasing room sequence, increment room version, persist the result receipt, commit, and reload the snapshot.

- [ ] **Step 5: Implement review and confirmation rules**

When all frozen-roster entries exist and sum to zero, move to `review`. Any entry edit increments its revision, deletes all confirmations, and recomputes the state. Only matching entry revisions count as confirmations; the last confirmation atomically marks the round confirmed.

- [ ] **Step 6: Implement cancellation, reversal, removal, history, and settlement**

Allow the host to cancel a waiting room only before any confirmed round. Create reversal entries as exact negatives of a confirmed source round and require the same review/confirmation flow. Allow removal only when no collecting/review round exists. Keep removed participants in totals. Settle only when the room is active and has no pending round; persist one immutable settlement snapshot.

- [ ] **Step 7: Add permissions, conflict, idempotency, and correction tests**

Cover non-zero rejection, editing another participant, stale version, repeated command ID, reused command ID with a different body, confirmation reset, immutable confirmed round, host force-confirm rejection, disconnect-neutral persistence, participant removal, and reversal audit linkage.

Run: `go test ./internal/score -count=1` from `backend/`
Expected: PASS.

- [ ] **Step 8: Commit the service**

```powershell
git add backend/internal/score
git commit -m "feat: add multiplayer score ledger"
```

### Task 4: HTTP API and Realtime Invalidation

**Files:**
- Create: `backend/internal/httpapi/score_handlers.go`
- Create: `backend/internal/httpapi/score_handlers_test.go`
- Modify: `backend/internal/httpapi/server.go`
- Modify: `backend/internal/httpapi/social_handlers.go`
- Modify: `backend/cmd/api/main.go`

**Interfaces:**
- Consumes: `*score.Service` injected into `NewServer`.
- Produces: JSON endpoints under `/api/v1/score-rooms` and score principals formed as `"score:" + participantID`.
- Produces: `score.room.updated` WebSocket invalidation with `{roomId, roomVersion, sequence}`.

- [ ] **Step 1: Write a failing HTTP integration test**

Register a host account, create a room with its account bearer token, join as a guest without an account, open host and guest score realtime tickets, complete a zero-sum round through HTTP, assert both sockets receive `score.room.updated`, and fetch equal snapshots.

- [ ] **Step 2: Verify the integration test fails**

Run: `go test ./internal/httpapi -run TestScoreHTTPFlow -count=1` from `backend/`
Expected: FAIL because score routes are not registered.

- [ ] **Step 3: Register routes and actor middleware**

```go
mux.HandleFunc("POST /api/v1/score-rooms", api.withAuth(api.withAPIPipeline(api.handleCreateScoreRoom)))
mux.HandleFunc("POST /api/v1/score-rooms/join", api.withRateLimitedAPIPipeline("score-join", api.handleJoinScoreRoom))
mux.HandleFunc("GET /api/v1/score-rooms/{roomID}", api.withScoreActor(api.withAPIPipeline(api.handleGetScoreRoom)))
mux.HandleFunc("POST /api/v1/score-rooms/{roomID}/realtime-ticket", api.withScoreActor(api.withAPIPipeline(api.handleCreateScoreRealtimeTicket)))
```

Add cancel-room, start-room, start-round, submit-entry, confirm, cancel-round, remove-participant, settle, and authenticated host-history routes using the same middleware and strict JSON decoding.

- [ ] **Step 4: Map service errors and publish invalidations**

Map unauthenticated to `401`, forbidden to `403`, not found to `404`, room full/nickname conflict/state violations to `409` or `422`, stale versions to `409` with latest snapshot, and invalid inputs to `400`. After a successful mutation, publish to every participant principal formed as `"score:" + participant.ID`.

- [ ] **Step 5: Keep social presence separate**

In `handleRealtime`, pass `nil` presence callback for principals beginning `score:`; retain the existing callback for account user IDs.

- [ ] **Step 6: Wire the service in `main.go` and update constructor call sites**

Open the score store using `cfg.Database.Path`, create `score.NewService(scoreStore, signingKey, 7*24*time.Hour)`, pass it to `httpapi.NewServer`, and close the store during shutdown. Update all HTTP tests to pass `nil` or a test score service as the new final constructor parameter.

- [ ] **Step 7: Run backend tests and commit**

Run: `go test ./... -count=1` from `backend/`
Expected: PASS.

```powershell
git add backend/cmd/api/main.go backend/internal/httpapi backend/internal/score
git commit -m "feat: expose realtime score room API"
```

### Task 5: Frontend Score Types, Helpers, API, and Session Storage

**Files:**
- Create: `frontend/types/card-score.ts`
- Create: `frontend/lib/card-score.ts`
- Create: `frontend/tests/card-score.test.mjs`
- Create: `frontend/lib/card-score-api.ts`
- Create: `frontend/lib/card-score-session-storage.ts`
- Create: `frontend/lib/card-score-session-storage.native.ts`
- Create: `frontend/lib/card-score-session-storage.web.ts`
- Modify: `frontend/package.json`

**Interfaces:**
- Produces `ScoreRoomSnapshot`, `ScoreParticipant`, `ScoreRound`, `ScoreSettlement`, `ScoreCredential`, `StoredScoreSession`.
- Produces `formatScore`, `formatCNY`, `scoreDifference`, `sortedParticipants`, `roundProgress`.
- Produces REST functions and `connectScoreRealtime(credential, roomId, onInvalidate, onStatus)`.

- [ ] **Step 1: Write failing helper tests**

```js
test('score difference and money formatting stay integer-safe', () => {
  assert.equal(scoreDifference([{ submitted: true, deltaPoints: 8 }, { submitted: true, deltaPoints: -3 }]), -5)
  assert.equal(formatCNY(250), '¥2.50')
  assert.equal(formatScore(0), '0')
  assert.equal(formatScore(7), '+7')
})
```

- [ ] **Step 2: Verify the helper test fails**

Run: `npm run test:card-score` from `frontend/`
Expected: FAIL because the script and helper module do not exist.

- [ ] **Step 3: Implement types and pure helpers**

Keep wire names aligned exactly with Go JSON fields. Sort by `totalPoints DESC`, then `joinedAt`, then `id`. Return the missing amount as the negated submitted delta sum so copy can say “还差 +5 分” when current sum is `-5`.

- [ ] **Step 4: Implement REST client and error messages**

Set the header with ``Authorization: `Bearer ${credential.token}``` for both account and guest credentials. Include `clientActionId` from `crypto.randomUUID()` when available and a timestamp/random fallback otherwise. Throw `CardScoreAPIError(code, status, snapshot?)` and map each backend code to concise Chinese UI copy.

- [ ] **Step 5: Implement platform session storage**

Persist `{roomId, guestToken, participantId, savedAt}` under `funbox.card-score.session.v1`; use SecureStore on native, localStorage on web, and memory fallback for unsupported targets. Never persist account access tokens in this module.

- [ ] **Step 6: Run tests, typecheck the module, and commit**

Run: `npm run test:card-score` from `frontend/`
Expected: PASS.

Run: `npx tsc --noEmit` from `frontend/`
Expected: PASS.

```powershell
git add frontend/types/card-score.ts frontend/lib/card-score* frontend/tests/card-score.test.mjs frontend/package.json
git commit -m "feat: add card score client domain"
```

### Task 6: Themed Card Score UI and Realtime Room Flow

**Files:**
- Create: `frontend/features/tools/card-score/card-score-components.tsx`
- Create: `frontend/features/tools/card-score/card-score-screen.tsx`

**Interfaces:**
- Consumes: `useAuth`, card-score API/session modules, `MobileScreen`, `useAppTheme`, `MaterialCommunityIcons`.
- Produces: `CardScoreScreen` routed by the tool detail screen.

- [ ] **Step 1: Build shared themed controls**

Implement `ScoreTopBar`, `SegmentedControl`, `ScoreField`, `ParticipantScoreRow`, `RoomProgress`, `TransferRow`, `PrimaryAction`, and `FeedbackBanner`. Use stable 44-54px controls, existing theme colors, no nested cards, and accessibility labels/roles.

- [ ] **Step 2: Build landing/create/join and resume states**

Create a direct operational screen with “创建房间/加入房间” segmented modes. Creation fields: room name, player limit stepper 2-8, cents-per-point presets `10/50/100/200`, and custom decimal input converted to integer cents. Joining fields: 6-digit code and 1-12 character nickname. Anonymous users see “登录后创建” but can still join. On mount, restore a valid guest session; authenticated hosts load recent room history and can resume an unfinished room or open a settled result.

- [ ] **Step 3: Build waiting room**

Show QR code, 6-digit room code with copy action, joined participants, amount rule, capacity, and host-only start/cancel actions. Use `Linking.createURL('/tools/card-score', {queryParams:{invite: room.inviteToken}})` for the QR value; keep the numeric room code as a manual fallback.

- [ ] **Step 4: Build active round UI**

Show confirmed totals first, then one unframed participant list and a focused current-round section. Allow only the current participant's integer input with `+1/+5/-1/-5` controls. Show submitted/confirmed progress, exact non-zero difference, host start/cancel/reversal controls, and all-player confirmation state.

- [ ] **Step 5: Build settlement and history UI**

Show final rank, total points, formatted amount, exact transfer instructions, total rounds, and collapsible history. Keep settled rooms read-only.

- [ ] **Step 6: Add realtime refresh and reconnect behavior**

After each snapshot, create a score realtime ticket and connect WebSocket. Debounce `score.room.updated` events into one snapshot reload, reconnect with capped exponential delay, reload after AppState becomes active, and display offline status without marking local drafts submitted.

- [ ] **Step 7: Verify lint/typecheck and commit**

Run: `npm run lint -- --max-warnings=0` from `frontend/`
Expected: PASS.

Run: `npx tsc --noEmit` from `frontend/`
Expected: PASS.

```powershell
git add frontend/features/tools/card-score
git commit -m "feat: build realtime card score room UI"
```

### Task 7: Tool Registration, Routing, and Login Return

**Files:**
- Modify: `backend/internal/access/feature_registry.json`
- Modify: `frontend/features/tools/tool-detail-screen.tsx`
- Modify: `frontend/features/auth/auth-screen.tsx`

**Interfaces:**
- Produces route `/tools/card-score` and feature ID `card-score`.
- Accepts auth query parameter `returnTo=/tools/card-score` only when it starts with `/tools/`.

- [ ] **Step 1: Register the tool**

Add an available featured entry named `打牌记分`, category `生活`, icon `cards-playing-outline`, accent `#1db991`, badges `多人同步` and `自动结算`, usage label `开始记分`, and all existing roles.

- [ ] **Step 2: Route the tool screen**

Import `CardScoreScreen` and return it with `Stack.Screen` header hidden when `tool?.id === 'card-score'`.

- [ ] **Step 3: Preserve the requested tool after login**

Read `returnTo` from `useLocalSearchParams`, accept only a string beginning `/tools/`, and use that safe target for the authenticated redirect and successful login/register navigation; otherwise retain `/profile`.

- [ ] **Step 4: Run registry, frontend, and access tests**

Run: `go test ./internal/access ./internal/httpapi -count=1` from `backend/`
Expected: PASS.

Run: `npm run test:card-score && npm run lint -- --max-warnings=0 && npx tsc --noEmit` from `frontend/`
Expected: PASS.

- [ ] **Step 5: Commit integration**

```powershell
git add backend/internal/access/feature_registry.json frontend/features/tools/tool-detail-screen.tsx frontend/features/auth/auth-screen.tsx
git commit -m "feat: register card score tool"
```

### Task 8: Full Verification and Internal Browser Acceptance

**Files:**
- Modify only files required by verified defects found in this task.

**Interfaces:**
- Consumes complete backend/frontend feature.
- Produces verified desktop/mobile multi-client behavior and a running local URL.

- [ ] **Step 1: Run the complete automated suite**

Run: `go test ./... -count=1` from `backend/`
Expected: PASS.

Run each existing Node test script plus `npm run test:card-score`, `npm run lint -- --max-warnings=0`, and `npx tsc --noEmit` from `frontend/`.
Expected: PASS with zero failures and zero warnings.

- [ ] **Step 2: Start isolated backend and frontend servers**

Use a temporary SQLite path and free ports, for example backend `3100` and Expo Web `8088`, with `EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:3100`. Keep both processes running through browser verification.

- [ ] **Step 3: Test a four-client room in the internal browser**

Use separate browser contexts or tabs with cleared per-tab storage. Register/login the host, create a 4-player room, join three temporary guests, and verify all clients update after each command. Record rounds `(+12,-4,-3,-5)`, `(-6,+9,-1,-2)`, and a third round that first fails zero-sum validation, is corrected, and becomes confirmed.

- [ ] **Step 4: Test reconnection, reversal, and settlement**

Reload one guest during collection, confirm identity recovery, complete the round, reverse one confirmed round, and settle. Verify every client shows identical totals and transfer instructions and the transfers settle every final balance.

- [ ] **Step 5: Test responsive and dark layouts**

Inspect `1280x720` and `390x844` viewports in light and dark modes. Assert no horizontal document overflow, no visible descendant overflow, no text/button overlap, stable score columns, and fully visible bottom actions/sheets.

- [ ] **Step 6: Inspect runtime health**

Check browser console for errors, network requests for unexpected 4xx/5xx responses, and WebSocket reconnect behavior. Fix discovered defects using focused regression tests, then rerun the affected verification command and the complete suite.

- [ ] **Step 7: Commit verification fixes**

```powershell
$verificationFiles = @(git diff --name-only --diff-filter=AM)
if ($verificationFiles.Count -gt 0) {
  git add -- $verificationFiles
  git commit -m "fix: harden card score room flow"
}
```

Skip this commit when verification required no code changes.

### Task 9: Final Review and Handoff

**Files:**
- Review all feature changes since the plan commit.

- [ ] **Step 1: Review the branch diff against the approved spec**

Check every acceptance criterion: login requirement, guest join, self-only entry, zero-sum gate, unanimous confirmation, reconnection, immutable confirmed rounds, reversal, exact settlement, theme parity, and internal-browser coverage.

- [ ] **Step 2: Verify the worktree is clean and commits are scoped**

Run: `git status --short`
Expected: no output.

Run: `git log --oneline --decorate -10`
Expected: plan and feature commits only on the card-score branch after its base.

- [ ] **Step 3: Report implementation and test evidence**

Provide the feature branch, isolated worktree path, local URL, key file links, automated command results, browser scenarios, responsive viewports, and any remaining non-blocking limitations.
