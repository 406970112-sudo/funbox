# Notebook UI implementation

**Goal:** Implement approved notebook boards with centered consistent icons, removing image and voice features from the mini-program.
**Spec:** docs/designs/notebook-v1/index.html, amended by user's removal of image and voice features.
**Architecture:** Keep existing native mini-program routes and backend data. Use a shared outline icon component and scoped style foundation; retain existing stored attachments without downloading or displaying them. No destructive data migration.

- [x] Shared icon component: 24-unit SVG artwork rendered in fixed centered boxes; consistent active/default/white states. Verify paths and actual rendered bounding boxes.
- [x] Home/search/books: follow approved boards, working combined filter sheet, book creation sheet and overflow actions. Preserve API filters and empty-book deletion checks. Test filter reset and create/rename behavior.
- [x] Editor/detail: unified writing area and reading hierarchy, two-tool checklist/tag dock, privacy row, password and more sheets. Remove media controls, lifecycle initialization, download/upload/play/record handlers and summaries. Test legacy-media notes make no media requests and save text normally.
- [x] Run all mini-program tests, JS syntax checks, rendered visual checks at narrow and standard widths. Review icon alignment and state overlays; record actual-device verification limits.

Constraints: primary #2d5bff, canvas #f5f7fa, ink #172139. Locked notes remain redacted. Session/password/security semantics unchanged. Image/voice removal applies to the current mini-program notebook feature; retain backend compatibility and historical data.

## Execution record

Implemented in current checkout as authorized. Independent cross-page reviews identified lifecycle and short-screen scrolling issues, reproduced and fixed with regression tests. Verification and non-destructive media-removal ruling: docs/designs/notebook-v1/implementation.md. Native screenshot checks use display fixtures; no publish, merge or data deletion.
