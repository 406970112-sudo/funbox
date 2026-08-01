# Unread Message Dot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a red dot on the bottom Messages tab whenever at least one chat message is unread, and remove it only after every unread conversation has been successfully marked read.

**Architecture:** Derive all tab state from the existing `Conversation.unreadCount` values held by `SocialProvider`; do not introduce another unread store or backend endpoint. Put aggregation and immutable conversation updates in a small pure module, let the tab layout render the visual indicator, and make the chat screen use the provider's existing read action so server and local state change together.

**Tech Stack:** Expo Router 6, React 19, React Native 0.81, TypeScript 5.9, Node test runner, Expo ESLint, Go social API, built-in browser tooling.

## Global Constraints

- Count only unread chat messages; friend requests never affect the dot.
- Render a dot only, with no visible number.
- Keep the dot until all unread conversations have been successfully marked read.
- Preserve the dot when the mark-read request fails.
- Reuse the existing conversation API and WebSocket refresh flow; make no backend protocol changes.
- Verify desktop and mobile-width layouts with the built-in browser.

---

### Task 1: Unread Message State

**Files:**
- Create: `frontend/features/social/unread-message-state.ts`
- Create: `frontend/tests/unread-message-state.test.mjs`
- Modify: `frontend/package.json`

**Interfaces:**
- Consumes: `Conversation.unreadCount: number` from `frontend/types/social.ts`.
- Produces: `getUnreadMessageState(conversations): { accessibilityLabel: string; hasUnread: boolean; unreadCount: number }`.

- [ ] **Step 1: Write failing aggregation tests**

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { getUnreadMessageState } from '../features/social/unread-message-state.ts';

const conversation = (id, unreadCount) => ({ id, unreadCount });

test('hides the dot when every conversation is read', () => {
  assert.deepEqual(getUnreadMessageState([]), {
    accessibilityLabel: '消息',
    hasUnread: false,
    unreadCount: 0,
  });
  assert.equal(getUnreadMessageState([conversation('a', 0)]).hasUnread, false);
});

test('sums unread chat messages for the tab state', () => {
  assert.deepEqual(
    getUnreadMessageState([conversation('a', 2), conversation('b', 3)]),
    { accessibilityLabel: '消息，5 条未读', hasUnread: true, unreadCount: 5 },
  );
});

test('ignores invalid unread counts', () => {
  const state = getUnreadMessageState([
    conversation('a', -2),
    conversation('b', Number.NaN),
    conversation('c', 1.9),
  ]);

  assert.equal(state.unreadCount, 1);
});
```

- [ ] **Step 2: Run the test and verify the missing module failure**

Run: `node --test --experimental-strip-types tests/unread-message-state.test.mjs` from `frontend/`.

Expected: FAIL because `features/social/unread-message-state.ts` does not exist.

- [ ] **Step 3: Implement the pure state helpers**

```ts
import type { Conversation } from '@/types/social';

type UnreadConversation = Pick<Conversation, 'id' | 'unreadCount'>;

export function getUnreadMessageState(conversations: readonly UnreadConversation[]) {
  const unreadCount = conversations.reduce(
    (total, conversation) => total + normalizeUnreadCount(conversation.unreadCount),
    0,
  );

  return {
    accessibilityLabel: unreadCount > 0 ? `消息，${unreadCount} 条未读` : '消息',
    hasUnread: unreadCount > 0,
    unreadCount,
  };
}

function normalizeUnreadCount(value: number) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}
```

- [ ] **Step 4: Add and run the package test script**

Add to `frontend/package.json` scripts:

```json
"test:social-unread": "node --test --experimental-strip-types tests/unread-message-state.test.mjs"
```

Run: `npm run test:social-unread` from `frontend/`.

Expected: all unread state tests PASS.

- [ ] **Step 5: Commit the state helpers**

```bash
git add frontend/features/social/unread-message-state.ts frontend/tests/unread-message-state.test.mjs frontend/package.json
git commit -m "test: define unread message tab state"
```

---

### Task 2: Read State Integration

**Files:**
- Modify: `frontend/features/social/unread-message-state.ts`
- Modify: `frontend/features/social/social-provider.tsx`
- Modify: `frontend/features/social/chat-screen.tsx`
- Modify: `frontend/tests/unread-message-state.test.mjs`

**Interfaces:**
- Consumes: `SocialContextValue.markRead(conversationId): Promise<void>`.
- Produces: `clearConversationUnreadCount(conversations, conversationId): Conversation[]`.
- Produces: successful server read requests immediately clear only the matching provider conversation.

- [ ] **Step 1: Add failing targeted-clear tests**

Replace the existing helper import with the combined import below, then append the two tests:

```js
import {
  clearConversationUnreadCount,
  getUnreadMessageState,
} from '../features/social/unread-message-state.ts';

test('clears only the opened conversation', () => {
  const untouched = conversation('b', 3);
  const result = clearConversationUnreadCount([conversation('a', 2), untouched], 'a');

  assert.equal(result[1], untouched);
  assert.deepEqual(result.map(({ id, unreadCount }) => ({ id, unreadCount })), [
    { id: 'a', unreadCount: 0 },
    { id: 'b', unreadCount: 3 },
  ]);
  assert.equal(getUnreadMessageState(result).hasUnread, true);
});

test('removes the final unread state', () => {
  const result = clearConversationUnreadCount([conversation('a', 1)], 'a');

  assert.equal(getUnreadMessageState(result).hasUnread, false);
});
```

Run `npm run test:social-unread` from `frontend/`.

Expected: FAIL because `clearConversationUnreadCount` is not exported.

- [ ] **Step 2: Implement the targeted immutable update**

Add to `unread-message-state.ts`:

```ts
export function clearConversationUnreadCount<T extends UnreadConversation>(
  conversations: readonly T[],
  conversationId: string,
): T[] {
  return conversations.map((conversation): T =>
    conversation.id === conversationId ? { ...conversation, unreadCount: 0 } : conversation,
  );
}
```

Run `npm run test:social-unread` and expect all tests to PASS.

- [ ] **Step 3: Use the helper after the read API succeeds**

In `social-provider.tsx`, import `clearConversationUnreadCount` and replace the inline mapping with:

```ts
setConversations((items) => clearConversationUnreadCount(items, conversationId));
```

Keep this update after `await markConversationRead(...)` so a failed request leaves unread state untouched.

- [ ] **Step 4: Route chat reads through the provider**

In `chat-screen.tsx`, remove the direct `markConversationRead` import, consume `markRead` from `useSocial()`, and replace:

```ts
await markConversationRead(accessToken, conversationId);
if (active) void refresh();
```

with:

```ts
await markRead(conversationId);
```

Keep `refresh` for the send-message path.

- [ ] **Step 5: Run focused verification**

Run from `frontend/`:

```bash
npm run test:social-unread
npx expo lint
npx tsc --noEmit
```

Expected: tests pass, lint has no errors, and TypeScript exits successfully.

- [ ] **Step 6: Commit the read integration**

```bash
git add frontend/features/social/unread-message-state.ts frontend/features/social/social-provider.tsx frontend/features/social/chat-screen.tsx frontend/tests/unread-message-state.test.mjs
git commit -m "feat: synchronize conversation read state"
```

---

### Task 3: Messages Tab Dot

**Files:**
- Modify: `frontend/app/(tabs)/_layout.tsx`

**Interfaces:**
- Consumes: `getUnreadMessageState(conversations)` from Task 1.
- Consumes: `useSocial().conversations` from the existing provider.
- Produces: an 8-9 px visual dot at the Messages tab icon's top-right corner and an unread-aware accessibility label.

- [ ] **Step 1: Confirm the current tab has no unread indicator**

Run the frontend with `npm run web` from `frontend/`, open it with the built-in browser, and inspect the Messages tab at desktop and mobile width.

Expected: the current icon contains no unread dot implementation.

- [ ] **Step 2: Render the derived indicator without layout shift**

Import `StyleSheet` and `View` from React Native, `useSocial`, and `getUnreadMessageState`. In `TabLayout`, derive:

```ts
const { conversations } = useSocial();
const unreadState = getUnreadMessageState(conversations);
```

Set `tabBarAccessibilityLabel: unreadState.accessibilityLabel`. Wrap the Messages icon in a fixed `24 x 24` container and render the dot only when `unreadState.hasUnread` is true.

```tsx
<View style={styles.messageIcon}>
  <Ionicons name={focused ? 'chatbubble' : 'chatbubble-outline'} size={23} color={color} />
  {unreadState.hasUnread ? (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.unreadDot, { borderColor: colors.card }]}
    />
  ) : null}
</View>
```

Add stable dimensions and absolute positioning:

```ts
const styles = StyleSheet.create({
  messageIcon: {
    alignItems: 'center',
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  unreadDot: {
    backgroundColor: '#f04444',
    borderRadius: 5,
    borderWidth: 1.5,
    height: 9,
    position: 'absolute',
    right: -1,
    top: -2,
    width: 9,
  },
});
```

- [ ] **Step 3: Run static verification**

Run from `frontend/`:

```bash
npm run test:social-unread
npx expo lint
npx tsc --noEmit
```

Expected: all commands exit successfully.

- [ ] **Step 4: Exercise the real unread workflow in the built-in browser**

Start the local Go backend and Expo web frontend. Use two test accounts to establish a friendship and send a message to the recipient while the recipient is not in that conversation. Verify:

1. The recipient sees a red dot on the Messages tab.
2. Opening one unread conversation clears only that conversation; another unread conversation keeps the dot visible.
3. Opening the final unread conversation removes the dot.
4. A new real-time message makes the dot reappear without a page reload.
5. At desktop width and a mobile viewport near `390 x 844`, the dot does not overlap the label or adjacent tabs.

- [ ] **Step 5: Inspect runtime health**

Use the built-in browser to inspect console messages and failed network requests.

Expected: no new console errors, mark-read returns success, conversation refresh succeeds, and the red dot matches the returned `unreadCount` values.

- [ ] **Step 6: Commit the tab UI**

```bash
git add 'frontend/app/(tabs)/_layout.tsx'
git commit -m "feat: show unread message dot on tab"
```

---

### Task 4: Conversation Refresh Ordering

**Files:**
- Create: `frontend/features/social/latest-request-gate.ts`
- Create: `frontend/tests/latest-request-gate.test.mjs`
- Modify: `frontend/features/social/social-provider.tsx`
- Modify: `frontend/package.json`

**Interfaces:**
- Produces: `createLatestRequestGate(): { run<T>(load: () => Promise<T>): Promise<T | undefined>; invalidate(): void }`.
- Consumes: every `refreshForToken(...)` call in `SocialProvider`.
- Guarantees: only the most recently started refresh can commit a state snapshot; logout and Provider cleanup invalidate outstanding requests.

- [ ] **Step 1: Write the failing request-order tests**

Create `frontend/tests/latest-request-gate.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { createLatestRequestGate } from '../features/social/latest-request-gate.ts';

test('drops an older result that resolves after a newer refresh', async () => {
  const gate = createLatestRequestGate();
  let resolveOlder;
  let resolveNewer;
  const older = gate.run(() => new Promise((resolve) => {
    resolveOlder = resolve;
  }));
  const newer = gate.run(() => new Promise((resolve) => {
    resolveNewer = resolve;
  }));

  resolveNewer('one unread message');
  assert.equal(await newer, 'one unread message');

  resolveOlder('zero unread messages');
  assert.equal(await older, undefined);
});

test('invalidates an outstanding refresh', async () => {
  const gate = createLatestRequestGate();
  let resolveRequest;
  const result = gate.run(() => new Promise((resolve) => {
    resolveRequest = resolve;
  }));

  gate.invalidate();
  resolveRequest('stale account state');

  assert.equal(await result, undefined);
});
```

- [ ] **Step 2: Run the test and verify the missing module failure**

Run from `frontend/`:

```bash
node --test --experimental-strip-types tests/latest-request-gate.test.mjs
```

Expected: FAIL because `features/social/latest-request-gate.ts` does not exist.

- [ ] **Step 3: Implement the minimal latest-request gate**

Create `frontend/features/social/latest-request-gate.ts`:

```ts
export function createLatestRequestGate() {
  let latestRequestId = 0;

  return {
    invalidate() {
      latestRequestId += 1;
    },
    async run<T>(load: () => Promise<T>) {
      const requestId = ++latestRequestId;
      try {
        const result = await load();
        return requestId === latestRequestId ? result : undefined;
      } catch (error) {
        if (requestId === latestRequestId) throw error;
        return undefined;
      }
    },
  };
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run from `frontend/`:

```bash
node --test --experimental-strip-types tests/latest-request-gate.test.mjs
```

Expected: both request-order tests PASS.

- [ ] **Step 5: Guard asynchronous refresh results in `SocialProvider`**

Create one gate for the Provider lifetime with `useRef`. Wrap the existing `Promise.all` request in `gate.run(...)`. If it returns `undefined`, exit without updating state; otherwise apply the returned friends, requests, and conversations snapshot. A stale rejection is ignored by the gate, while an error from the latest request still reaches the existing error handler.

In the authentication effect cleanup, call `invalidate()` before closing the socket. This prevents responses belonging to an earlier token or an unmounted Provider from writing state.

- [ ] **Step 6: Add the test script and run focused verification**

Add to `frontend/package.json`:

```json
"test:social-refresh": "node --test --experimental-strip-types tests/latest-request-gate.test.mjs"
```

Run from `frontend/`:

```bash
npm run test:social-refresh
npm run test:social-unread
npx expo lint
npx tsc --noEmit
```

Expected: both social test suites pass, lint has no errors, and TypeScript exits successfully.

---

### Task 5: Final Regression Verification

**Files:**
- Verify only; no planned source changes.

**Interfaces:**
- Consumes: completed unread state, read integration, and tab UI from Tasks 1-3.
- Produces: evidence that the feature passes project checks and works in the browser.

- [ ] **Step 1: Run all relevant frontend tests**

Run from `frontend/`:

```bash
npm run test:social-unread
npm run test:auth
npm run test:ai-navigation
npm run test:resource-search
npm run test:qr
npm run test:gomoku
```

Expected: every test command passes.

- [ ] **Step 2: Run final static checks**

Run from `frontend/`:

```bash
npx expo lint
npx tsc --noEmit
```

Expected: both commands exit successfully.

- [ ] **Step 3: Check the final diff and working tree**

Run from repository root:

```bash
git diff --check
git status --short --branch
```

Expected: no whitespace errors and only intentional feature changes are present before the final commit.
