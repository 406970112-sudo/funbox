# WeChat Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Deliver approved WeChat identity signup/login and explicit legacy-account binding in the existing mini program.
**Architecture:** Add code2Session to the existing WeChat client; persist unique identities in SQLite transactions; issue existing FunBox JWTs. Keep the phone/password path and guest navigation.
**Tech Stack:** Native WXML/WXSS/CommonJS, Go net/http, SQLite, existing JWT.
**Spec:** docs/superpowers/specs/2026-10-30-wechat-login.md

## Global Constraints
- No phone authorization, shared default password, automatic identity merge, or AppSecret/session_key/OpenID in public responses/logs.
- Preserve existing unrelated edits; reuse current codex/general-score checkout per user scope and desktop workspace guidance.
- Authorization already given: execute through verification without another approval gate; do not commit, deploy or publish.

## Review Focus
- Concurrent signup/binding must not duplicate users or replace identity ownership.
- Late responses after logout/unload/account switching must not save sessions.
- Invalid/reused/expired code and missing credentials must fail without disclosing secrets.
- Existing users keep ID, role, nickname, password, and room history after binding.
- Return navigation must handle tab pages, deep links, guest cancellation and errors.

### Task 1: WeChat identity backend
**Files:** backend/internal/wechatminiprogram/login{,_test}.go; backend/internal/user/wechat{,_test}.go; backend/internal/auth/wechat{,_test}.go; existing user store and auth constructor; backend/internal/httpapi/wechat_auth_handlers{,_test}.go; auth response/error mapping, routes, cmd/api/main.go.
**Interfaces:** Code2Session(ctx, code) (Identity,error); FindOrCreateWeChat(ctx, appID, openID, unionID) (User,error); BindWeChat(ctx,userID,appID,openID,unionID) (User,error); LoginWeChat(ctx,code) (Session,error); BindWeChat(ctx,userID,code) (User,error).
- [x] Write tests for identity exchange validation/failures; signup repeat/concurrency; safe explicit binding/conflicts; HTTP JWT/private-field behavior and disabled credentials.
- [x] Run targeted tests and confirm red.
- [x] Implement client, migrations, service, routes and shared client wiring.
- [x] Run targeted backend tests; expected PASS.

### Task 2: Mini program login and binding
**Files:** miniprogram/utils/auth.js; pages/auth/index.{js,wxml,wxss,json}; pages/profile-settings/index.{js,wxml,wxss}; pages/legal/index.*; app.json; tests/wechat-auth.test.js and profile-settings tests.
**Interfaces:** loginWithWeChat({isActive}) saves existing session format; bindWeChat() stores updated same-account user. Default auth view is WeChat; explicit phone/register modes remain usable.
- [x] Write behavior tests for consent gate, manual-only wx.login, retries, duplicate submit, return destinations, no late save and authenticated binding.
- [x] Run tests and confirm red.
- [x] Implement approved UI, real policy destinations and legacy-binding entry.
- [x] Run node --test miniprogram/tests/*.test.js; expected PASS.

### Task 3: Documentation, rendering and review
**Files:** docs/wechat-login/README.md; backend/README.md; miniprogram/README.md; local preview artifacts.
- [x] Document configuration, endpoints, behavior and real-device acceptance checks.
- [x] Render current WXML/WXSS in available simulator/browser, inspect desktop and narrow phone views and save screenshots.
- [x] Run go test ./... and go vet ./... in backend; run full mini program suite; inspect diff.
- [x] Obtain one independent code review, fix material findings with regression tests, report external verification limits.

## Progress
- Ruling: User's approval of the mockup and request to implement authorizes execution; no repeated design approval needed.
- Ruling: Reuse current checkout, which contains unrelated work, and do not make automatic commits; touch only auth-related files except additive page registration/docs.


## Completion evidence
- Task 1: complete. Client/store/HTTP tests ran RED before production implementation; relevant Go packages passed. `go test -race ./internal/auth ./internal/user ./internal/wechatminiprogram ./internal/httpapi` PASS for all four packages.
- Task 2: complete. `node --test miniprogram/tests/*.test.js`: 153 passed, 0 failed. Invalid binding code and protected-page guest-loop regression tests each observed RED then GREEN.
- Task 3: complete. Native WeChat developer tools compile and render verified at 390×844 and 320×568; privacy link opens actual policy page; narrow layout scrolls to agreement/guest entry. Screenshots saved under docs/wechat-login. `go vet` for affected packages and `go build ./cmd/api` passed; generated binary removed.
- Full `go test ./...` / `go vet ./...` were run. Existing access version-vet, DNF August-date, and home-recommendation 30-day failures reproduced from an untouched HEAD archive of those packages; no unrelated code changed to suppress them.
- Independent review: one Important issue, invalid code logging out legacy account, fixed with regression. No Critical or Minor findings. No second review dispatched; covering regressions and full client suite passed.
- Reviewer deferred live platform availability: actual remote credentials/WeChat exchange and production rollout remain external verification, documented in acceptance checklist; local credentials only checked for existence.
- Reviewer deferred legal sufficiency: policy pages describe actual implementation; no legal sufficiency assertion is made.
- Reviewer deferred arbitrary nonexistent return paths: internally generated return paths are existing pages; malformed paths and auth self-loops are dropped, tab routes handled explicitly. Arbitrary unknown manually supplied page paths are outside the supported entry flow.
- Ruling: Native simulator QA replaces browser emulation because this is native WXML and the existing developer tools were available. Saved actual simulator screenshots; original device restored.
- Ruling: No automatic identity merge or transfer; users who created a separate new WeChat account receive conflict guidance rather than losing data. This prioritizes preserving existing ownership; account consolidation remains separate work.

- Subsequent user authorization: commit this WeChat login change and push to main. Existing unrelated room CSS and design artifacts remain outside this commit.
