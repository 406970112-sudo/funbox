# Miniprogram Friendly Interactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Implement all eight approved interaction improvements with the existing FunBox mini program style.

**Architecture:** Extend existing native mini program page controllers and small focused utilities. Reuse server-authoritative score mutations and existing meme clients. Only broaden room cancellation to truly empty active Mahjong/generic rooms, preserving all accounting history.

**Tech Stack:** WeChat native WXML/WXSS/JavaScript, Node test runner, Go/SQLite.

**Spec:** docs/superpowers/specs/2026-11-03-miniprogram-friendly-interactions-design.md

## Global Constraints
- Keep #f5f7fa background, #2d5bff primary, white rounded cards, pale blue auxiliary actions, current illustrations, and safe-area layouts.
- No new dependencies, no changes to poker rules, preserve guest use/account binding.
- Server-authoritative accounting, existing version/action-ID mutations, no automatic write retries or local fake balances.
- Never cancel rooms with any accounting history even if net balances equal zero.
- Reuse the existing checkout on codex/miniprogram-friendly-interactions; do not publish or push.

## Review Focus
- Expired credentials versus transient errors: clear only definitively invalid saved rooms; never leak guest identity across different rooms or account history across users.
- Reversal idempotency/version conflict: originals and reversal entries remain visible and non-repeatable.
- Empty-room termination: existing gift/round/poker history blocks cancellation, including zero net totals.
- Network recovery and modal errors: retain draft, block duplicate writes, show failure inside active interaction.
- Appended image results: stale queries, duplicate IDs, page failure and favorite races must not lose usable images.

### Task 1: Safe room lifecycle interfaces and current-room identity

**Files:** backend/internal/score/service.go, backend/internal/score/*test.go; miniprogram/utils/score-api.js, miniprogram/utils/score-session.js; miniprogram/tests/score-api.test.js, miniprogram/tests/score-session.test.js (new focused test files allowed).

**Interfaces:** Add reverseScoreGiftBatch(credential, room, batchID) and cancelScoreRoom(credential, room), returning server snapshots through mutateRoom. Add saveRecentScoreRoom(room, credential), getRecentScoreRoom(), clearRecentScoreRoom(roomId) to score-session. Recent room stores room ID/name/gameType/status and minimal credential ownership metadata; guest token stays in existing score-session cache, and account metadata scopes to current user ID. Do not clear an unrelated room when clearing an older one.

- [x] Write failing service tests: host can cancel empty active Mahjong/generic room; nonhost forbidden; gift history blocks even after reversal to zero; round/poker history and settled status blocked; waiting behavior preserved. Run focused tests and observe expected failure.
- [x] Broaden CancelRoom guard only to empty active Mahjong/generic rooms with no gift batches, rounds, or poker hands/current hand/current round. Existing waiting-room behavior remains safe. Run Go tests.
- [x] Write failing JS API tests for correct reverse/cancel endpoint with credentials/version/action ID, and session tests for account isolation, guest recovery, unrelated clear, terminal clearing. Implement minimal wrappers/cache helpers. Credential cache must not allow guest continuation after its token has been replaced by another room.
- [x] Run node --test miniprogram/tests/*.test.js and go test ./... from backend; self-review and commit only task-owned files. Record test evidence and interfaces in report.

### Task 2: Home recovery and score-room interaction improvements

**Files:** miniprogram/pages/index/index.{js,wxml,wxss}; miniprogram/utils/score-room-base.js, score-entry-base.js; pages/score/{mahjong,general,room,poker-room}/index.{js,wxml,wxss}; optional focused score UX utility; miniprogram/tests/* appropriate tests.

**Interfaces:** Consume Task 1 recent-room helpers and reverse/cancel wrappers. Existing score snapshots expose giftBatches kind/reversesBatchId/createdBy. Reversal is host-only. Generic and Mahjong use shared room base; poker overrides applyRoom and lifecycle methods, so preserve method chaining and account binding.

- [x] Write failing behavioral tests for home resume with guest/account, terminal/expired versus network failure, stale async lookup, and no duplicate joining. Implement home card above scene selection and validate snapshot before navigation; refresh current-room cache from room snapshots for both guest and account users.
- [x] Write failing tests for stable recipient order across ranking changes with draft preservation, quick increments/clear and explicit give preview; implement stable joining order and +1/+5/+10, whole-batch clear, total button; keep safe integer limits and invalid input errors visible.
- [x] Write failing tests for reversal metadata/host gating/conflict, start confirmation when Mahjong has fewer than four players, and cancel guarding no-history active rooms; implement actions and clear nearby explanations in existing cards, no accounting rules altered.
- [x] Write failing tests for online-channel versus true offline, recovered snapshot failure, duplicate submits, and give/settlement local error preservation. Ensure actual network outage blocks writes and recovery requires a successful refresh. Show inline errors in active card/sheet, preserve drafts.
- [x] Write failing tests for personal settlement payable/receivable/no-transfer and copy text, safe rematch prefill; implement personal summary and copy in all three modes; add Mahjong/generic rematch navigation to create form with name/nickname only, password must not be in URL. Distinguish return-home from cancel/finish.
- [x] Run full Node suite. Preserve existing selectors/interaction feedback where practical, check WXML/WXSS compiler compatibility. Self-review and commit only task-owned files; report complete behavior and remaining simulator checks.

### Task 3: Continuous meme browsing and quick actions

**Files:** miniprogram/packages/meme/library/index.{js,wxml,wxss}, detail/index.js if refactoring; miniprogram/utils/meme.js and optional focused shared image-action utility; miniprogram/tests/meme*.test.js.

**Interfaces:** Reuse client.favorite(), client online/library paging, existing detail download/share actions. Keep existing favorites/recent/ranking/category modes usable. List favorites may be local guest or cloud account with pending sync, reuse that client contract.

- [x] Write failing behavioral tests for append/dedupe on load more, stale query results ignored, page failure retains images and retries correct cursor, busy prevents duplicate load, filters reset pagination but returning from detail preserves list.
- [x] Implement load-more for ordinary library/online/favorites result grids, replacing previous/next page controls there. Preserve initial versus incremental loading/error state and reasonable end state. Do not reset scroll on append; ensure old client pager tests remain meaningful or update to appended behavior.
- [x] Write failing tests for list favorite/pending sync, longpress menu preview/favorite/share, click suppression after longpress as needed, no-result online search preserving q. Cloud-sync failures retain the desired local pending state per the existing client; actual persistence failures restore prior visible state. Implement independent catchtap favorite button, longpress native action sheet, shared image actions reused by detail. Unavailable images do not offer invalid share/save actions.
- [x] Run Node suite; self-review and commit task-owned files. Report source/client limitations and UI checks.

### Task 4: Integrated verification and documentation

**Files:** miniprogram/README.md, task verification evidence under docs as appropriate; any narrowly scoped fixes found through verification.

- [x] Review each task and resolve important findings before advancing; complete whole-branch review and scoped verification of its final fixes.
- [x] Run final Node suite (285/285), backend Go suite, git diff --check, native WXML/WXSS compilers (14/16) and JavaScript syntax checks (62). Behavioral tests cover waiting, host reversal/cancel, recovery/errors, settlement and meme paging/empty state.
- [x] Verify focused native scenarios using synthetic snapshots: home checking/long error at 320px, give preview and offline retention, personal settlement/rematch form, list favorite/longpress/menu/append/deduplication. Record exact observed scope and fixture limitations in the verification document; no production mutations.
- [x] Update README with entry points, host-only reversal, empty-room cancellation rules, deployed-backend compatibility, and validation results; report exact passing checks and real-device limitations.
- [ ] Before a production release, perform device-only acceptance for actual scan, haptics, GIFs, photo permission and share receivers; no physical-device result is claimed by this implementation task.
