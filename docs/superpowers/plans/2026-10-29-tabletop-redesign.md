# Tabletop Redesign Implementation Plan

> For agentic workers: use superpowers:executing-plans to implement task by task.

**Goal:** Apply the approved general-tabletop visual design to the existing mini program.

**Architecture:** Preserve page JS and business bindings. Share theme and illustration
styles through app.wxss; keep each page's layout in its own WXML/WXSS. Store one
transparent illustration atlas locally and reuse it across pages.

**Tech Stack:** Native WeChat WXML/WXSS, existing JavaScript, Node test runner.

**Spec:** docs/superpowers/specs/2026-10-29-tabletop-redesign-design.md

## Global Constraints

- Cool-white canvas #F5F7FA, primary #2D5BFF, coral #FF765E.
- Preserve every existing handler, conditional branch and form data binding.
- Preserve project.config.json local edits; do not push or publish this task.
- No new dependencies or business features. Keep the native two-item tab bar.

## Review Focus

- Guests retain login/register, host nickname and account binding.
- Long names and 320px screens must not overlap inputs or QR codes.
- QR expansion preserves dynamic pixel sizing and both image/canvas paths.
- Host-only start, invitation/password and settlement visibility stays intact.
- Only the settlement sheet exposes the currency rate; amounts still come from JS.

### Task 1: Shared Theme, Assets, Home and Profile

Files: app.wxss/app.json, assets/illustrations, assets/icons,
pages/index/index.wxml|wxss|json, pages/profile/index.wxml|wxss|json.

- [x] Generate and optimize a transparent local illustration atlas.
- [x] Implement theme, equal-weight home scenarios and profile states.
- [x] Update native colors and tab icons without changing navigation.
- [x] Check rendered states, asset size and existing tests.

### Task 2: Create and Join

Files: pages/score/mahjong/index.wxml|wxss|json.

- [x] Keep all fields and events while replacing header, tabs and shortcut layout.
- [x] Style create/join forms, location control, nearby list and bottom sheet.
- [x] Check both modes, long room names and narrow layout.

### Task 3: Room States and Review

Files: pages/score/room/index.wxml|wxss|json.

- [x] Restyle room header, invitations, seats, score board and give form.
- [x] Restyle settlement and all auxiliary/error/loading/QR states.
- [x] Verify existing tests, WXML structure/bindings and visual states.
- [x] Obtain one fresh review, resolve material findings and record limitations.

## Execution Record

- Approved design and implementation authorization are in the current chat.
- Native execution in the current checkout on codex/tabletop-redesign; preserve
  the existing unrelated configuration change. No commits or push during this task.
- Visual-only changes use existing behavior tests and targeted rendered checks;
  do not add implementation-mirroring tests.
- Ruling: native back navigation replaces the duplicate entry-header back button;
  all other original event handlers remain represented in WXML.
- Ruling: use darker coral #c74d38 for negative text and settlement confirmation
  to reach 4.62:1 contrast on white, retaining #ff765e for decorative accents.
- Review: independent review found the button pseudo-selector and coral contrast
  issues; both were fixed and the recheck found no remaining material findings.
- Verification: 55 existing Node tests pass; installed WeChat WXML and WXSS
  compilers pass; local artwork paths and unchanged production JS are checked.
- Browser plugin not available. A temporary Chromium WXML layout harness verified
  13 states at 390px and 320px, zero horizontal overflow or page errors, plus
  three interactions invoking production handlers (mode, gift total, rate).
- Limitation: WeChat CLI automation requires enabling the IDE service port,
  currently disabled. No setting was changed. Browser layout checks are not
  real WeChat runtime, keyboard, canvas-layering or physical-device validation.
- Asset: transparent shared atlas is 174466 bytes; complete mini program source
  is approximately 425 KB. Generation prompt is recorded in the artwork spec.
- Follow-up: replaced CSS-masked scan corners and the rotated non-square location
  shape with square PNGs exported from editable scan.svg/nearby.svg. The scanner
  now includes a center line and the location marker uses a symmetric path.
- Follow-up: themed feedback form, image picker, error state, success state and
  navigation to match the approved blue design. Production feedback JS is unchanged.
- Follow-up validation: 55 tests and native compilers pass; 10 entry/feedback
  state-width checks and five production-handler interactions pass in Chromium.
