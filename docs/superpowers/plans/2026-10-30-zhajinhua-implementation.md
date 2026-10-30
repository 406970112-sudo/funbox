# 炸金花小程序 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for coordinated execution. Backend rules and mini-program UI have separate file ownership and a fixed JSON contract, so use superpowers:dispatching-parallel-agents for those independent work packages; integration and HTTP routing stay with the parent.

**Goal:** Implement the approved native WeChat mini-program UI and server-authoritative multiplayer 炸金花 scorekeeping flow end to end.

**Architecture:** Preserve legacy score rooms. New mini-program rooms explicitly opt into `zhaJinHuaSettings.rulesVersion=2`. Add persistent versioned hand state and settings using additive SQLite tables, reuse existing room transactions, idempotent receipts, realtime invalidation, participant identities and settlement ledger. UI derives state from snapshots, never applies authoritative scores locally.

**Tech Stack:** Native WeChat WXML/WXSS/JavaScript, Node built-in tests, Go HTTP services, SQLite, existing WebSocket snapshot synchronization.

**Spec:** `docs/zhajinhua-prototype-v1/rules-and-prototype.md`, `docs/zhajinhua-ui-v1/interaction-states.md`, `docs/zhajinhua-ui-v2/README.md`, latest visual `docs/zhajinhua-ui-v2/01-entry-and-room-r2.png`.

## Global Constraints

- Keep homepage text, illustration and horizontal cards; remove rules and service-status copy; enable poker entry.
- Pot prioritizes exact money and points; no decorative artwork column. Host fixes cents-per-point at creation.
- Blind1/seen2, initial ante, increasing base raises up to cap; no circle limit before cap; exactly3 full subsequent circles after cap, unless only1 survivor.
- Compare only at active count <= threshold, pay own follow once before selecting a live opponent, tie initiator loses; advance from initiator seat, skipping eliminated.
- Bonus host verifies revealed baozi/shunjin regardless of winner; all other frozen hand participants pay including folded; bonus outside pot, zero-sum final ledger.
- Room supports repeated hands; complete bonus before next hand or settlement. Join/admit, leave/rejoin and accepted host transfer only between hands; identities/history retained.
- New poker rooms support2–12 seated players. Legacy generic/mahjong limits/semantics remain unchanged. Additive migration must work with existing DB constraints.
- Do not deploy or modify production services. Reuse current checkout; design files are untracked user work and must remain intact.

## Shared JSON / Go contract

`CreateRoomInput.zhaJinHuaSettings` optional pointer to `ZhaJinHuaSettings`; nested fields `rulesVersion:2, antePoints, maxBetPoints, compareThreshold, baoziBonusPoints, shunjinBonusPoints`. Room `maxPlayers`2–12, `centsPerPoint` integer cents. Settings snapshot retains old `forceOpenThreshold` for compatibility and may add `maxPlayers` for additive legacy schema support.

Extend `ZhaJinHuaHand` with `rulesVersion`, `phase` (`betting|comparing|showdown|bonus|finished`), frozen `settings`, `circleNumber`, `capCirclesRemaining`, optional `pendingComparison` (`actorParticipantId`, `points`), while retaining existing `id/number/potPoints/currentBetPoints/currentTurnParticipantId/players/actions/winnerParticipantId` fields. Player `seen`, status `active|folded|eliminated`, optional `exitReason`, final `gamePoints/bonusPoints/deltaPoints`, `bonusKind`. Status remains active through bonus; only finish after host confirms.

Keep POST existing hands/actions/cancel routes. New action strings `follow`, `look`, `compare_pay`, `compare_result`, `showdown`, alongside `raise`,`fold`; `points` on raise means new BASE, `outcome` is `win|lose|tie`, `targetParticipantId` for compare_result and `winnerParticipantId` for showdown. Actor ID always from auth.

New service `ConfirmZhaJinHuaBonuses(ctx,actor,meta,handID,ZhaJinHuaBonusInput{Bonuses:[]ZhaJinHuaBonusEntry{ParticipantID,Kind}})`; HTTP POST `/score-rooms/{roomID}/zha-jin-hua/hands/{handID}/bonus`, body metadata plus `bonuses:[{participantId,kind}]`. Empty[] explicitly means no bonus.

New service `ManageZhaJinHuaMember(ctx,actor,meta,participantID,ZhaJinHuaMemberInput{Action})`; HTTP POST `/score-rooms/{roomID}/participants/{participantID}/seat`, actions `admit|leave|rejoin|offer_host|accept_host`. Participant adds `seatStatus:seated|pending|left`, snapshot room adds optional `pendingHostParticipantId`. Auth remains available for pending/left users to view and request rejoin, but cannot act in hands. Seat snapshots independent of persistent identities.

PATCH settings body embeds metadata and `ZhaJinHuaSettings` fields (nested field optional if convenient but coordinate). Leave existing `UpdateZhaJinHuaSettingsInput` compatibility and add pointer `Settings *ZhaJinHuaSettings json:"settings,omitempty"` for V2 updates.

## Review Focus

- Repeat/timed-out compare payment and bonus confirmation must never double-charge; conflicts return latest snapshot.
- A player joining/leaving cannot alter old pot/bonus payer rosters or erase their final balances.
- Cap triggered midway through a normal circle excludes trigger action, counts three complete subsequent circles, handles folding and elimination.
- Host identity transfer must check live DB roles and target acceptance; old host loses powers, pending/left users retain read access only.
- Existing SQLite schemas and legacy score rooms must remain usable after upgrade.

### Task 1: Server rules and persistence (backend worker)

**Files:** `backend/internal/score/model.go`, `service.go`, `store.go`; new focused `zjh_v2.go`, `zjh_v2_test.go` and supporting migration tests if needed.

- [x] Write failing service tests for V2 create/start ante/multiplier, turn authorization, pay/result compare, cap3 circles, bonus zero-sum and repeat safety.
- [x] Run `go test ./internal/score` and confirm missing V2 behavior fails.
- [x] Implement contract with additive persistence and legacy dispatch, tests for member management and migration.
- [x] Run `go test ./internal/score` including unchanged legacy tests; report exact results.

### Task 2: Mini-program feature (UI worker)

**Files:** exclusively `miniprogram/` pages, utilities and Node tests. Reuse existing room invite/QR/auth/realtime infrastructure, split poker view/controller from mahjong as appropriate.

- [x] Write failing tests around derived poker state, action requests, create validation, turn-change reminders and member permissions.
- [x] Implement poker create/join, room entry routing, number-first pot, auto seat layout, actor banner and fixed actions, compare and showdown/bonus sheets, next-hand ledger/member/host-transfer management and settled room.
- [x] Preserve current homepage except specified deletions/entry. Retain explicit native share button beside QR. Numeric animation finite and optional, no auto-timeout forfeits.
- [x] Run `node --test miniprogram/tests/*.test.js` and JS/template checks; report exact results.

### Task 3: HTTP integration and acceptance (parent)

**Files:** `backend/internal/httpapi/score_handlers.go`, dedicated HTTP tests; documentation and integration harness as needed.

- [x] Add failing HTTP test for nested V2 creation, compare outcome, bonus/member routes and auth errors.
- [x] Wire contract, use existing request validation/error mapping and mutation realtime publishing.
- [x] Review both packages and exercise actual server through several authenticated players; include reconnect/idempotency and hand/bonus/leave/new-hand/settlement.
- [x] Full `go test ./...` and Node suite. Check WeChat tooling availability; if available compile and inspect real mini-program, otherwise report exact native runtime verification limits and use executable controller/integration tests without claiming native visual validation.

### Task 4: Review and handoff (parent + fresh reviewer)

- [x] Read changes against all approved rules, inspect auth/ledger/roster invariants, correct findings.
- [x] Run required checks after corrections and report changed files, evidence and remaining environment limitations. No production deploy.

## Execution ledger

- Baseline: `go test ./internal/score ./internal/httpapi` passed. Native mini-program Node baseline started; read final result before comparisons.
- Implementation is already authorized by the user's “按照设计方案实施”; proceed directly with this plan without another approval gate.

- Final verification: Node137/137; JS44; native WXML10/WXSS11; Go score/httpapi/wechatminiprogram/config fresh pass; cmd/api build pass. Full-suite three unrelated package failures reproduced on unchanged HEAD. See docs/zhajinhua-ui-v2/implementation.md.
- Native simulator:12-player real local snapshots, look/follow and compare tie verified; temporary backend and test project isolated from production.
