# Admin User Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an admin-only user management workflow that lists and searches users, changes normal/VIP/SVIP identity safely, protects administrators, and records auditable role changes.

**Architecture:** Extend the existing user store with paginated admin queries and a transactional optimistic role update that writes an audit row. Expose those operations through the existing auth service and new admin HTTP handlers, then add a focused frontend API/model layer and a responsive Expo Router screen using the established FunBox admin theme.

**Tech Stack:** Go 1.22, `net/http`, SQLite (`modernc.org/sqlite`), Expo Router, React 19, React Native Web, TypeScript, Node test runner.

## Global Constraints

- Reuse the existing `normal / vip / svip / admin` values; the management UI may only assign `normal / vip / svip`.
- Administrator accounts are visible but protected from role changes.
- List responses expose masked phone numbers; full phone numbers are available only from the admin detail endpoint.
- A role update is optimistic via `expectedRole`, idempotent when the requested role already matches, and auditable when it changes.
- Desktop uses a compact table and right-side detail panel; mobile uses list rows and a bottom sheet.
- Match `docs/admin-access-product-design.png` and the existing `appTheme` palette; do not introduce a new visual system.
- Browser verification must use the Codex in-app browser only.
- Stage and commit only files created or modified for this feature.

---

### Task 1: User store queries and role-change transaction

**Files:**
- Modify: `backend/internal/user/store.go`
- Modify: `backend/internal/user/store_test.go`

**Interfaces:**
- Produces: `ListOptions`, `ListResult`, `RoleChange`, `Store.List`, `Store.UpdateRole`, and `Store.ListRoleChangesByUserID`.
- `UpdateRole(ctx, targetID, operatorID, expectedRole, nextRole, reason)` returns the updated user, whether a change occurred, and an error.

- [ ] **Step 1: Write failing store tests**

Add tests that create normal, VIP, SVIP, and admin accounts and assert:

```go
result, err := store.List(ctx, ListOptions{Query: "张", Role: roles.VIP, Limit: 20})
if err != nil || result.Total != 1 || result.Users[0].Role != roles.VIP {
    t.Fatalf("filtered users = %+v, err = %v", result, err)
}

updated, changed, err := store.UpdateRole(ctx, member.ID, admin.ID, roles.Normal, roles.VIP, "活动赠送")
if err != nil || !changed || updated.Role != roles.VIP {
    t.Fatalf("updated = %+v, changed = %v, err = %v", updated, changed, err)
}
```

Also cover administrator protection, stale `expectedRole`, idempotent updates, and exactly one audit row.

- [ ] **Step 2: Run the targeted tests and verify RED**

Run: `go test ./internal/user -run 'TestStore(List|UpdateRole|RoleChanges)' -v`

Expected: compile failure because the new types and methods do not exist.

- [ ] **Step 3: Implement the migration and store methods**

Add `user_role_changes` with foreign keys to `users`, query users with bounded pagination, and update role plus audit row in one transaction. Return sentinel errors:

```go
var (
    ErrProtectedAdminRole = errors.New("administrator role is protected")
    ErrRoleChanged = errors.New("user role changed")
)
```

- [ ] **Step 4: Run store tests and verify GREEN**

Run: `go test ./internal/user -v`

Expected: all user store tests pass.

- [ ] **Step 5: Commit the store increment**

```powershell
git add -- backend/internal/user/store.go backend/internal/user/store_test.go
git commit -m "feat: 增加用户身份变更存储"
```

### Task 2: Admin user HTTP API

**Files:**
- Create: `backend/internal/httpapi/admin_user_handlers.go`
- Create: `backend/internal/httpapi/admin_user_handlers_test.go`
- Modify: `backend/internal/auth/service.go`
- Modify: `backend/internal/httpapi/server.go`

**Interfaces:**
- Consumes: Task 1 store methods through the auth service.
- Produces: `GET /api/v1/admin/users`, `GET /api/v1/admin/users/{userID}`, `PATCH /api/v1/admin/users/{userID}/role`, and `GET /api/v1/admin/users/{userID}/role-changes`.

- [ ] **Step 1: Write failing HTTP integration tests**

Register an administrator and members against a real SQLite store, then assert the list response masks phone numbers, detail returns the full phone number, updates require admin auth, admin targets are protected, stale roles return `409 role_changed`, and successful changes return an audit log.

```go
response := requestAdminUserJSON[adminUsersResponse](t, server.Client(), http.MethodGet,
    server.URL+"/api/v1/admin/users?role=normal&limit=20&offset=0", nil, adminToken, http.StatusOK)
if response.Users[0].MaskedUsername != "138****0002" {
    t.Fatalf("masked username = %q", response.Users[0].MaskedUsername)
}
```

- [ ] **Step 2: Run the targeted tests and verify RED**

Run: `go test ./internal/httpapi -run TestAdminUsers -v`

Expected: requests return 404 because routes are not registered.

- [ ] **Step 3: Extend auth service and implement handlers**

Extend the auth store interface with the Task 1 methods, add small service forwarding methods with assignable-role validation, map sentinel errors to `400 invalid_role`, `403 protected_admin_role`, `404 user_not_found`, and `409 role_changed`, and register all four routes behind `withAuth(withAdmin(...))`.

- [ ] **Step 4: Run HTTP and full backend tests**

Run: `go test ./internal/httpapi -run TestAdminUsers -v`

Then: `go test ./...`

Expected: all tests pass.

- [ ] **Step 5: Commit the API increment**

```powershell
git add -- backend/internal/user/store.go backend/internal/user/store_test.go backend/internal/auth/service.go backend/internal/httpapi/admin_user_handlers.go backend/internal/httpapi/admin_user_handlers_test.go backend/internal/httpapi/server.go
git commit -m "feat: 增加后台用户身份管理接口"
```

### Task 3: Frontend API and presentation model

**Files:**
- Create: `frontend/types/admin-user.ts`
- Create: `frontend/lib/admin-users.ts`
- Create: `frontend/lib/admin-users-api.ts`
- Create: `frontend/tests/admin-users.test.mjs`
- Modify: `frontend/package.json`

**Interfaces:**
- Produces: `AdminUserSummary`, `AdminUserDetail`, `RoleChangeRecord`, `listAdminUsers`, `getAdminUser`, `updateAdminUserRole`, `getAdminUserRoleChanges`, `maskUsername`, `rolePresentation`, and `buildAdminUsersQuery`.

- [ ] **Step 1: Write failing frontend model tests**

```js
assert.equal(maskUsername('13812345678'), '138****5678');
assert.equal(buildAdminUsersQuery({ limit: 20, offset: 40, query: '张 三', role: 'vip' }),
  '?q=%E5%BC%A0+%E4%B8%89&role=vip&limit=20&offset=40');
assert.deepEqual(rolePresentation('svip'), {
  color: '#e8667a', icon: 'crown-outline', label: 'SVIP'
});
```

- [ ] **Step 2: Run the model test and verify RED**

Run: `node --test --experimental-strip-types tests/admin-users.test.mjs`

Expected: module-not-found failure for `lib/admin-users.ts`.

- [ ] **Step 3: Implement types, helpers, and API calls**

Keep view-independent formatting and query construction in `admin-users.ts`. Implement a typed API error and map server error codes to Chinese user-facing messages in `admin-users-api.ts`.

- [ ] **Step 4: Run model tests, typecheck, and lint**

Run: `npm run test:admin-users`

Then: `npx tsc --noEmit`

Then: `npm run lint`

Expected: all commands exit 0.

### Task 4: Responsive admin user management screen

**Files:**
- Create: `frontend/app/admin/users.tsx`
- Create: `frontend/features/admin-users/admin-users-screen.tsx`
- Modify: `frontend/features/feedback/admin-home-screen.tsx`
- Modify: `frontend/app/_layout.tsx`

**Interfaces:**
- Consumes: Task 3 API and presentation helpers plus existing `useAuth`, `useAppTheme`, and Expo Router navigation.
- Produces: an admin-only responsive screen at `/admin/users`.

- [ ] **Step 1: Add the route and admin-home entry**

Register `admin/users` in the root stack and add the「用户管理」entry using `account-group-outline` with the PRD copy.

- [ ] **Step 2: Implement list loading, search, filters, and pagination**

Use a deferred search value, reset offset when search/filter changes, cancel stale effects with an `active` flag, and show loading, empty, retry, and pagination states. Desktop renders a compact table; mobile renders scan-friendly rows.

- [ ] **Step 3: Implement protected detail and role adjustment panel**

Load detail and the latest ten role changes in parallel. Render role choices as a segmented single-select control, disable administrator targets, require a changed selection, show downgrade warning, and confirm before calling `updateAdminUserRole`.

- [ ] **Step 4: Refresh state after success and handle conflicts**

Replace the changed row without refetching the whole list, refresh detail/logs, show a success message, and on `role_changed` reload the latest user before requiring a new confirmation.

- [ ] **Step 5: Run frontend checks**

Run: `npm run test:admin-users`

Then: `npx tsc --noEmit`

Then: `npm run lint`

Expected: all commands exit 0.

- [ ] **Step 6: Commit the frontend increment**

```powershell
git add -- frontend/app/admin/users.tsx frontend/features/admin-users/admin-users-screen.tsx frontend/features/feedback/admin-home-screen.tsx frontend/app/_layout.tsx frontend/types/admin-user.ts frontend/lib/admin-users.ts frontend/lib/admin-users-api.ts frontend/tests/admin-users.test.mjs frontend/package.json frontend/package-lock.json package-lock.json
git commit -m "feat: 增加后台用户身份管理页面"
```

### Task 5: Runtime and visual verification

**Files:**
- Modify only if browser verification exposes a tested defect.
- Create temporarily then remove: browser screenshots and QA-only artifacts.

**Interfaces:**
- Consumes: completed backend and frontend.
- Produces: verified desktop/mobile workflows and a clean feature branch.

- [ ] **Step 1: Run the full automated verification suite**

Run backend and frontend checks from a clean status snapshot:

```powershell
go test ./...
npm run test:admin-users
npx tsc --noEmit
npm run lint
```

- [ ] **Step 2: Start backend and Expo web without opening an external browser**

Run the backend on port `8080` and Expo web on an available local port with non-interactive flags. Do not pass any CLI flag that opens a system browser.

- [ ] **Step 3: Verify with Codex in-app browser**

In the IAB, sign in as an administrator and verify:

- desktop list/search/filter/pagination layout;
- desktop detail panel and administrator protection;
- normal → VIP change and audit row;
- VIP → normal downgrade warning;
- empty search and failed/blocked states;
- mobile list, filters, bottom sheet, and confirmation;
- no clipped text, overlap, overflow, console errors, or broken icons.

- [ ] **Step 4: Compare visual evidence**

Capture desktop and mobile screenshots in the IAB, inspect them with `view_image`, and compare against `docs/admin-access-product-design.png` for palette, density, typography, radii, table/list anatomy, panel behavior, and icon treatment.

- [ ] **Step 5: Audit requirements and git scope**

Re-read `docs/admin-user-identity-prd.md`, map every MVP acceptance item to API tests, frontend tests, or browser evidence, run `git diff --check`, and confirm no unrelated main-worktree changes are present in the feature branch.

- [ ] **Step 6: Push the verified commit chain to main**

Fetch `origin/main`, verify it is an ancestor of the feature branch, then push without force:

```powershell
git fetch origin main
git merge-base --is-ancestor origin/main HEAD
git push origin HEAD:main
```

