# Home More Functions Implementation Plan

**Goal:** Implement the approved compact homepage website card using the user's supplied FunBox F logo.

**Architecture:** Add the card and a centered success dialog to the native homepage. Copy `https://xwhub.cn` with the WeChat clipboard API, showing guidance only after success; allow retry on failure. Keep changes in the current checkout on `codex/home-more-functions`.

**Tech Stack:** WXML, WXSS, JavaScript, Node test runner.

**Spec:** Approved compact design in this chat: logo / 更多功能 / 访问 xwhub.cn / 复制网址; success dialog with green check, browser guidance, URL and 我知道了. Use the supplied F image without altering it. Target card height 144rpx, rather than the taller initial design. No extra helper line inside card.

## Review Focus

- Success guidance must wait for clipboard success.
- Failure must allow retry without showing false success.
- Repeated taps must not start duplicate pending copies.
- Dismissing the dialog restores native tabs; leaving the page clears the dialog.
- Compact layout must fit a 320px viewport.

## Task 1: Homepage entry and clipboard feedback

- [x] Add behavioral tests in `miniprogram/tests/index-page.test.js` for pending/success/failure/retry/close; observe failures before implementation.
- [x] Copy supplied logo to `miniprogram/assets/icons/funbox-logo.png`.
- [x] Update `pages/index/index.js`, `.wxml`, `.wxss`: compact card, clipboard handling, custom accessible success dialog, failure toast, pending guard.
- [x] Run `node --test miniprogram/tests/*.test.js`, JS syntax and `git diff --check`; inspect native developer-tool rendering when available.

## Progress

- Baseline: 177 tests passed, 0 failed.
- User explicitly authorized implementation after design review; execute directly in this chat without another approval round.
- Verification: 179 tests passed, 0 failed; homepage JavaScript syntax and diff whitespace checks passed.
- Native verification: WeChat developer tools Stable 2.02.2608060, iPhone 5 / 320px viewport. Scrolled to footer and verified the supplied F logo, compact card, untruncated address/button; clicked 复制网址 and observed the success dialog and URL; clicked 我知道了 and verified 首页 / 我的 tabs restored.
- Logo SHA-256 matches the supplied PNG byte for byte.
- Independent code review: no blocking findings in clipboard handling, lifecycle, tab restoration or compact layout.
