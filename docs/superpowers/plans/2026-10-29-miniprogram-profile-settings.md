# Mini Program Profile Settings

Goal: Remove the home resume card, align profile card heights, and let signed-in users edit their avatar/name or sign out from a dedicated page.

Approach: Extend the existing native WeChat pages and reuse the current Go account endpoints, blue/white palette, rounded cards, and shared illustration atlas. Avatar uploads save immediately; nickname changes use an explicit save button. Keep existing user changes and do not commit or publish.

- [x] Add behavior tests for account updates, validation, upload failure, session expiry, and logout.
- [x] Remove the home resume markup, styles, and unused session handler.
- [x] Use a shared 200rpx height for profile cards, including the compact guest card, and link the identity card to settings.
- [x] Register and implement profile settings with PATCH /users/me and POST /users/me/avatar (avatar field, JPG/PNG, 3 MB).
- [x] Verify the mini program test suite, syntax/configuration, and review the final diff.

Review focus: Preserve unsaved names on upload failure; do not cache late responses after logout; prevent duplicate submissions; redirect expired sessions to login; keep long names within the card.

Validation: Account/profile/page-registration tests pass (27/27). Temporary Playwright rendering of actual WXML/WXSS verifies 320px and 390px layouts, equal heights for signed-in/guest cards, and real nickname input/save handlers. This approximates WeChat rendering; native media selection and production uploads still need device validation. JavaScript syntax and git whitespace checks pass.

Independent review found a delayed-401 race that could clear a newer account. Added failing regression tests, then guarded settings callbacks by the initiating token and page lifetime; both regressions now pass.

The working tree changed concurrently outside this task. An observed full run passed 77/82; the five failing tests belonged to those ongoing room/realtime changes and were left untouched:
- score-connection-lifecycle: hiding a room releases realtime and polling, and showing it reconnects.
- score-connection-lifecycle: late room responses cannot start connections or polling while hidden.
- score-realtime: network recovery replaces a stale socket and ignores its late callbacks.
- score-realtime: a socket handshake that never completes times out and retries.
- score-realtime: connection creation failures retry once and cannot be revived by a late open.
