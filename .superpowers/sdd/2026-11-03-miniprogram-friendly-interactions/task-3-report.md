# Task 3 — continuous meme browsing and quick actions

Implemented approved point 8 in existing checkout; no dependency, backend, scoring, or branch changes.

## Behavior

- Library and cloud favorites opt into appended cursor paging; online uses appended numbered pages; guest favorites, pending favorites, and recent browsing expose progressively larger local slices. IDs deduplicate across remote pages. Load more and bottom reach block concurrent fetches and preserve scroll position. Initial skeletons are separate from incremental loading; failures retain usable items and retry the failed cursor/page. Filters reset to page one; generations fence stale query/mode results.
- Per-tile catchtap favorite buttons provide independent busy state and never navigate. Desired pending state is authoritative after cloud failure and includes retry-sync feedback. A real storage failure restores the prior visible state. Async completion is fenced against account changes. Shared client tracks successful known favorite state by stable account scope so returning from detail updates controls without resetting appended lists.
- Longpress offers preview original, favorite/unfavorite, and share image. The following tile tap is suppressed. Preview/share always resolve detail first; a list thumbnail is never presented as the original. Unavailable items offer no image actions. List and detail reuse runImageMedia for download, large-file confirmation, progress, cancellation, album permission feedback and successful-save events. List provides retry of failed original-image actions.
- Empty library searches expose “用这个词联网搜图”; it preserves q, loads default enabled sources, and submits automatically in that one action when sources exist. Ordinary mode switching and shared online links retain their previous explicit-submit behavior.
- Existing category/ranking/detail routes, attribution, guest/cloud/pending collection modes and recent browsing remain supported. Default createPager behavior remains replacement paging for existing callers/tests; the library supplies {append: true}.

## RED / GREEN evidence

1. Added four behavioral tests before implementation: append/dedupe/cursor recovery, same-query online handoff, list favorite pending/storage/account handling, and longpress choices/original/share/tap suppression. Initial run: 32 pass, 4 expected failures (duplicate IDs and missing page actions).
2. Detail persistence rollback regression: observed true vs expected false, then fixed pending-aware restoration.
3. Shared media background lifecycle regression: observed busy=true after return, then fixed control recovery.
4. Updated an old online previous-page assertion for appended/deduplicated behavior. Existing default pager replacement tests remain intact.
5. Added coverage for online append failure/retry and stale query, detail return with appended items and filter reset, stable-account known favorite state, and shared large-original/cancel/permission handling.

Final verification:

- node --test miniprogram/tests/*.test.js: **251 passed, 0 failed** (full current checkout, including concurrent score/home work).
- Meme suite: **42 behavioral tests**, all passing as part of full suite.
- Native wcc compiled library/detail WXML successfully; native wcsc compiled both WXSS successfully. Outputs: /tmp/task3-wxml.js and /tmp/task3-wxss.js.
- git diff --check for owned files: clean.

## Interfaces / simulator fixtures

- createPager(fetchPage, onChange, {append: true}); legacy two-argument calls retain their existing contract.
- client.favoriteState(id, fallback): pending.desired > same-account known successful intent > supplied server/list fallback. No cloud mutation contract changed.
- uniqueImages(items) preserves first-occurrence order; runImageMedia(page, fullImage, action, wx) is shared by list/detail.
- To inspect paging, return 36 first-page items plus nextCursor, then a second response with one repeated ID and new IDs. Reject that second request once, then retry with the same cursor. For online use page=1/2 plus hasMore. Set q to a different term while the old deferred response remains pending.
- To inspect quick actions, list fixtures may contain thumbnail URLs only; detail must return a valid gateway original and bytes. Try bytes > 5 MiB, modal cancel, media cancel, auth deny, unavailable detail and account switch while favorite is deferred. To inspect one-action fallback, return zero library results and at least one enabled online source.

## Remaining limitations

Integrated simulator/visual checks belong to the controller's Task 4. No production media searches, favorites or scoring writes were used for this task. Native action-sheet appearance, OS album authorization, animated GIF behavior and actual share targets require simulator/device checking. Online provider availability and source-reported hasMore are external contracts; existing backend cursor snapshot conflicts reset to page one. A fresh ordinary library response without favorite metadata can only show local pending/known favorite state until authoritative detail/cloud favorites are loaded; no full-account favorites prefetch was introduced.

## Review fix round 1 — private pager account boundary and local collection return

Read task-3-review.md and reproduced the P1 with a behavioral VM test: A page one contains private-A/A-cursor; A page two is deferred; hide; switch to B; return with B merge deferred. Before the fix, the retained pager still contained one A item after the visible array had been cleared. Also reproduced stale same-account guest favorites and recent browsing after returning from detail.

Added four regression tests before production changes. RED command `node --test miniprogram/tests/meme.test.js` produced 42 pass / 4 fail: retained private pager item (1 instead of 0), old guest favorite first item, missing new recent detail, and missing pager.reset method.

Changes:

- Added pager.reset() to invalidate generation, clear retained items and cursor history, reset requested retry page to one, discard old filters, and clear loading/error/source/total state.
- A changed-account private collection now clears suspended resume intent, local collection cache and saved private scroll position, resets both pager and visible state, and immediately starts page one for B. Its initialization does not depend on merge completion. Bottom reach cannot use A's cursor; a late A response cannot replace B's data. Finishing delayed B synchronization does not reset or reload B's current browsing depth.
- Same-account local favorites/pending/recent returns reread actual scoped client collections and retain the previously appended page depth. Main library return behavior remains covered by the existing test preserving appended items without fetching page one. Pending collection synchronization also reconciles at current depth rather than unconditionally resetting.

GREEN focused command `node --test miniprogram/tests/meme.test.js`: 46 pass / 0 fail. The account test includes delayed B merge, bottom reach during B page-one initialization and late A completion after B has loaded; the pager test also checks retry's page-one cursor and discarded old filters.

Final full command `node --test miniprogram/tests/*.test.js`: **275 pass / 0 fail**, duration 4739.637 ms. The full suite includes concurrent score changes; no unrelated failures observed. `git diff --check -- miniprogram/packages/meme/library/index.js miniprogram/utils/meme.js miniprogram/tests/meme.test.js` exited 0. No WXML/WXSS changes in this fix round; existing native compiler results still describe the unchanged templates/styles. Integrated simulator/device checks remain with Task 4.
