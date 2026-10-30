# Scan-first room join implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task.

**Goal:** Implement the approved three-screen design: prominent scan entry, optional manual join sheet, and invitation confirmation.

**Architecture:** Keep native WXML/WXSS pages and existing invitation/API/session flow. The Mahjong entry page owns the manual sheet and scan feedback; the room page continues to handle scanned and shared invitations through the same nickname-only confirmation.

**Tech Stack:** WeChat mini-program, CommonJS, Node test runner.

**Spec:** User-approved design image `/Users/mac/.codex/generated_images/01a18a98-fb9d-72d0-ae02-83596c0973c2/exec-83d1883d-9d07-426e-8957-6cbe1f12e988.png` and preceding chat.

## Global constraints

- Preserve blue/white palette, native navigation, create-room behavior, and existing worktree edits.
- Default join view contains no expanded form. Manual entry is a secondary row opening a bottom sheet.
- Manual joining retains room-code/password/nickname validation. Scanned/shared invitations require only a nickname.
- Keep work in current checkout on `codex/scan-first-room-join`; do not deploy or publish.

## Review focus

- Dismiss/reopen sheet preserves input but clears stale errors and keyboard offsets.
- Submission cannot be duplicated or dismissed while pending; failures remain editable in the sheet.
- Scanner cancellation stays quiet; invalid codes and actual scanner errors appear beside scan entry.
- Both QR scene and invitation token reach the same confirmation without requesting a password.
- Short viewports and an open keyboard keep sheet fields and submit action reachable by scrolling.

### Task 1: Scan-first entry and manual sheet

**Files:** `miniprogram/pages/score/mahjong/index.{js,wxml,wxss}`, `miniprogram/tests/mahjong-join.test.js`.

**Interfaces:** Add `manualJoinOpen`, `manualKeyboardHeight`, `scanning`; handlers `openManualJoin`, `closeManualJoin`, `handleManualKeyboard`, `noop`. Keep `scanToJoin` and `joinByCode` API contracts.

- [x] Add and run behavior tests for sheet lifecycle, keyboard reset, pending guard, manual validation/submission, scan cancellation/error and credential routing. Confirm missing behavior fails before implementation.
- [x] Implement dominant scan card, secondary manual row, invitation hint and scrollable safe-area-aware sheet using existing brand/illustration assets.
- [x] Run focused tests; confirm manual and scan behaviors pass.

### Task 2: Invitation confirmation and verification

**Files:** `miniprogram/pages/score/room/index.{wxml,wxss}`, `miniprogram/tests/score-room.test.js`, `miniprogram/README.md`.

**Interfaces:** Preserve `joinNeeded`, `previewRoom`, `joinNickname`, `joinFromInvite` and its token/scene credential handling.

- [x] Cover scene-based nickname-only joining, blank nickname and pending duplicate guard.
- [x] Implement welcoming invitation header, room summary, verified-invitation strip and nickname confirmation. Retain existing error/retry paths and dynamic room data.
- [x] Update README describing scan-first entry and manual sheet.
- [x] Run `node --test miniprogram/tests/*.test.js`, JS syntax checks, and `git diff --check`.
- [x] Attempt WeChat developer-tool preview and inspect default/manual/invite screens at normal and short viewport sizes; report any unavailable verification honestly.

## Progress

- Baseline: 95/95 mini-program tests passed before changes.
- Existing modifications: miniprogram README, app WXSS, home WXML/WXSS. Preserve them.

- Completed: scan-first entry, manual sheet, and invitation confirmation; no backend contract changes.
- Verification: 104/104 Node mini-program tests passed; JS syntax checks and git diff --check passed.
- Native QA: WeChat developer tools rendered default join and manual sheet at 390×844 and 320×568; validation, dismissal, and scrolling to submit under simulated 280px/250px keyboard heights verified. Invitation layout checked with local fixture data; no real room was created or joined.
- Independent review: no Important/Critical findings.
- Remaining verification boundary: physical-camera QR scanning, real shared-invite launch, and physical-device keyboard behavior were not exercised.
