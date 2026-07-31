# Market Radar Design Specification

## Product Decision

Add one independent FunBox tool named `市场雷达` at `/tools/market-radar`. The MVP turns a flat list of market moves into a three-step decision flow: judge market strength, understand the selected sector, and trace the calculation basis.

## Primary Workflow

1. Open `市场雷达` from the FunBox tools list.
2. Switch between `全球`, `AI`, and `有色` market groups.
3. Switch between `1日`, `5日`, and `20日` performance windows.
4. Scan sectors sorted from strongest to weakest.
5. Open a sector to inspect its trend, drivers, representative symbols, weights, and methodology.
6. Add or remove the sector from the local watch state.

## Data Policy

- V1 ships with a bounded local demonstration snapshot, not a live or licensed market feed.
- The screen must label the snapshot clearly and must not claim that the values are real-time.
- The data model and selectors stay separate from the React Native view so a live provider can replace the fixture later.
- Visible financial copy includes the disclaimer `仅作信息展示，不构成投资建议`.

## Accepted Visual System

- Reference: `docs/market-radar-product-design-v1.png`.
- Page background: `#eef4ff`; surface: `#ffffff`; hero: `#151b3b`.
- Primary: `#4b6bff`; lime: `#c9f36a`; coral: `#ff6b8f`; success: `#1db991`.
- Screen content is capped at the existing FunBox `430px` mobile width.
- Use open list sections and thin separators. Avoid a repeated nested-card layout.
- Use the existing Material Community icon family with a consistent outline treatment.
- Main UI typography uses the existing platform font stack with deliberate weights and line heights.

## Required States

- Overview with pulse summary, category control, period control, ranked sector rows, and one anomaly signal.
- Detail view for the selected sector with chart, drivers, representative symbols, methodology, and watch action.
- Selected watch state and unselected watch state.
- Light and dark theme support through the existing FunBox theme hook.

## Acceptance Criteria

- The tool is visible to all existing user roles and opens through the shared dynamic tool route.
- Category and period controls produce deterministic sorted results.
- Tapping a row opens the matching detail state.
- Back returns to the overview without leaving the tool.
- Watch toggling changes visible local UI state.
- TypeScript, lint, focused tests, and existing test scripts pass.
- The Expo web build is exercised at mobile width and compared with the approved concept.

