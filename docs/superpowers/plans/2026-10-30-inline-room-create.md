# Inline Room Creation Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Implement the approved second UI concept: edit name and password in place and make room creation feel lightweight.

**Architecture:** Keep native mini-program inputs mounted, styled as text until focused. One active field controls focus decoration; values continue through the existing creation API and validation.

**Tech Stack:** WXML, WXSS, JavaScript, node:test.

**Spec:** User-approved UI image and inline-edit instruction in this chat.

## Global Constraints

- Name defaults to 老友局, password to 666666; name limit 40 characters, password 4–6 digits.
- Tap name or password directly; no creation modal or save step.
- Nickname remains editable and prefills for authenticated users.
- Preserve ongoing join-page work and other existing uncommitted changes.

## Review Focus

- Switching focus must not let a delayed blur clear the new active field.
- Empty names and invalid passwords must still block creation.
- Creation must use the latest input values, including while focused.
- Pending requests must prevent repeated submission and inline editing.
- Long names and narrow screens must not overflow the card.

### Task 1: Inline input behavior and simplified card

**Files:** Modify `miniprogram/pages/score/mahjong/index.{js,wxml,wxss}`, `miniprogram/README.md`; create `miniprogram/tests/mahjong-create.test.js`.

**Interfaces:** `beginInlineEdit(event)` activates name/password only; `endInlineEdit(event)` clears only the matching active field. Existing `handleField` remains the value update path.

- [x] Add regression coverage for focus switching, stale blur, pending-request protection, defaults, edited creation payload and invalid values.
- [x] Run the new test file and confirm missing inline handlers fail.
- [x] Implement native unboxed inputs, focused styling, compact password row, simplified note and creation copy.
- [x] Run `node --test miniprogram/tests/*.test.js`, check syntax and diff, review layout and implementation.
- [x] Update README and record verification results. Leave changes uncommitted for user review.

## Verification record

- Baseline: 104/104 mini-program tests passed. New regression tests first failed for missing inline handlers and focus reset.
- Final: `node --test miniprogram/tests/*.test.js`: 111/111 passed; `node --check miniprogram/pages/score/mahjong/index.js` and `git diff --check` passed.
- WeChat developer tool simulator: checked rendered default card, direct name/password focus, active underline, old-field blur and switching create/join. Native device keyboard has not been tested.
- Independent review found no actionable defects.
- Kept the existing blue-white colors, typography, illustration, tab bar and shared input/button styling. No commit or publication.
