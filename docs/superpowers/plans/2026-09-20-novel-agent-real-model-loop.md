# Novel Agent Real Model Loop Implementation Plan

> For agentic workers: keep the progress ledger at `.superpowers/sdd/2026-09-20-novel-agent-real-model-loop/progress.md` updated after each task.

**Goal:** Replace the local deterministic novel-agent adapter with an optional, authenticated, persisted A→user approval→B→C real-model loop while preserving offline demo mode.

**Architecture:** Extend the existing Go API instead of introducing a second Node server. A `novelagent` package owns typed workflow state, SQLite persistence, provider abstraction, DeepSeek OpenAI-compatible calls, strict response validation, retry/call logging, and orchestration gates. `httpapi` exposes authenticated workflow routes. The existing React Native Web screen selects `demo` or `real` mode and maps both adapters into the same UI state.

**Tech Stack:** Go 1.22, `database/sql`, SQLite via `modernc.org/sqlite`, existing `httpapi` auth middleware, DeepSeek HTTP JSON API, React Native Web/Expo, TypeScript tests and existing Node test runner.

**Spec:** `outputs/novel-agent-mvp/technical-plan.md` is the source of truth. The current implementation target is the first real-model loop plus SQLite state and recovery; long-form memory, reference ingestion, and sample regression suites remain later phases.

## Global Constraints

- Real mode is disabled by default and must not expose or persist API keys.
- B routes must reject workflows without an approved A plan.
- Every state-changing request must be owner-scoped and version-aware.
- Model responses are untrusted: strict JSON decoding, required-field validation, bounded input/output, timeout, retry, and safe error messages are mandatory.
- Demo mode remains deterministic and usable without login or provider credentials.
- Do not alter unrelated backend test failures or broad FunBox behavior.

## Review Focus

- Verify the A approval gate cannot be bypassed through any B/C route.
- Verify retries do not duplicate state transitions or call logs incorrectly.
- Verify SQLite restart/reload preserves workflow state and versions.
- Verify provider failures never leak request content, API keys, or raw upstream secrets.
- Verify mobile and PC UI behavior remains compatible in both modes.

## Task 1: Add Configuration, Domain Contracts, and Provider Boundary

**Files:** `backend/internal/config/config.go`, `backend/internal/config/config_test.go`, `backend/internal/novelagent/types.go`, `backend/internal/novelagent/types_test.go`, `backend/internal/novelagent/provider.go`, `backend/internal/novelagent/provider_deepseek.go`, `backend/internal/novelagent/provider_deepseek_test.go`.

1. Write failing tests for novel-agent environment defaults, strict typed response decoding, required fields, code-fence normalization, and DeepSeek request/response decoding with an `httptest.Server`.
2. Add `NovelAgentConfig` with enabled/provider/model A/B/C, timeout, retry count, input limit, and output limit. Reuse the existing DeepSeek key/base URL settings and keep real mode disabled unless explicitly enabled and configured.
3. Define typed workflow, message, plan, chapter, review, provider request/response, and usage contracts using stable camelCase JSON.
4. Define a provider interface and an OpenAI-compatible DeepSeek implementation. Keep the API key in request headers only; record no prompts or secrets in provider errors.
5. Run `go test ./internal/config ./internal/novelagent` and commit only this task.

## Task 2: Implement SQLite Workflow and Call Logs

**Files:** `backend/internal/novelagent/store.go`, `backend/internal/novelagent/store_test.go`.

1. Write failing tests covering schema creation, owner isolation, workflow create/load/update, optimistic version conflicts, restart persistence, and call-log fields.
2. Add a single-connection SQLite store with migrations for workflows and model call logs. Persist typed JSON blobs, status, version, owner ID, timestamps, last error, and current artifact versions.
3. Use owner plus expected version in updates. Return typed not-found and conflict errors so HTTP handlers can map them safely.
4. Store provider/model/status/attempts/latency/token counts/error metadata, but never API keys or full prompt bodies.
5. Run `go test ./internal/novelagent` and commit only this task.

## Task 3: Build A→B→C Orchestration with Retry and Recovery Semantics

**Files:** `backend/internal/novelagent/service.go`, `backend/internal/novelagent/service_test.go`.

1. Write failing tests using a fake provider for A discussion, A approval, B write, C review, normal B revision, provider retry, malformed output, approval-gate rejection, and restart-safe reload.
2. Implement service methods for create, A message, A approval, B write, C review, and B revision. Make every transition explicit and persist after each successful boundary.
3. Add bounded exponential backoff with injectable sleep/clock hooks for tests. Log every attempt and end in `FAILED` with a recoverable error rather than losing the workflow.
4. Make C route `B_REWRITE`, `REOPEN_PLANNING`, `HUMAN_REVIEW`, or completion based on structured severity; keep the first MVP focused on one chapter.
5. Run focused tests and commit only this task.

## Task 4: Expose Authenticated HTTP API and Wire Server Lifecycle

**Files:** `backend/internal/httpapi/novel_agent_handlers.go`, `backend/internal/httpapi/novel_agent_handlers_test.go`, `backend/internal/httpapi/server.go`, `backend/internal/httpapi/server_test.go`.

1. Write failing handler tests for mode/config discovery, auth rejection, workflow ownership, JSON validation, A approval, B gate, C response, revision, conflict, and safe upstream errors.
2. Add routes under `/api/v1/novel-agent`, protected by the existing bearer-auth middleware for workflow mutations and reads. Return stable HTTP status/error shapes.
3. Construct the service from existing config and SQLite path in `newServer`, register routes, and close the store during server shutdown without changing existing constructor callers.
4. Keep the discovery endpoint safe for unauthenticated UI boot: it reports enabled/provider/model labels, never credentials.
5. Run `go test ./internal/httpapi ./internal/novelagent` and commit only this task.

## Task 5: Add Frontend Real-Mode Adapter and Preserve Demo Mode

**Files:** `frontend/lib/novel-agent-api.ts`, `frontend/tests/novel-agent-api.test.mjs`, `frontend/features/tools/novel-agent-screen.tsx`, related frontend snapshot types/tests.

1. Write failing API mapping tests for headers, endpoint payloads, config discovery, conflict/error normalization, and real workflow response mapping.
2. Add a small authenticated API client using `getAPIBaseUrl()` and `useAuth().accessToken`; do not place provider credentials in the frontend.
3. Add a demo/real mode switch. Keep demo as the default, show real mode only when the server reports it enabled, and give an actionable login/config message when unavailable.
4. Map real A discussion, approval, B write, C review, and revision responses into the existing artifact/review UI and snapshot model. Persist the remote workflow ID for refresh recovery.
5. Run frontend focused tests, then the existing full suite, lint, and TypeScript checks. Commit only this task.

## Task 6: Documentation, Environment Example, and Verification

**Files:** `backend/.env.example` or the repository's existing environment documentation, `outputs/novel-agent-mvp/technical-plan.md`, `.superpowers/sdd/2026-09-20-novel-agent-real-model-loop/progress.md`.

1. Document safe local configuration, recommended low-cost DeepSeek role models, demo/real behavior, and the current MVP limits.
2. Append the actual implementation decisions, test results, known baseline failures, and follow-up items to the project memory file without deleting prior decisions.
3. Run targeted Go tests, targeted frontend tests, full frontend verification, `git diff --check`, and a final worktree review.
4. Commit the completed feature with a Chinese Conventional Commit subject. Merge/push only after verification confirms the feature branch is clean and the user-authorized integration target is still current.

## Verification Commands

```powershell
go test ./internal/config ./internal/novelagent ./internal/httpapi
npm run test:novel-agent
npm test
npm run lint
npm exec -- tsc --noEmit --pretty false
git diff --check
```

