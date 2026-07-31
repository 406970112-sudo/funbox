# Market Radar Design Specification

## Product Decision

Add one independent FunBox tool named `市场雷达` at `/tools/market-radar`. The MVP turns a flat list of market moves into a three-step decision flow: judge market strength, understand the selected sector, and trace the calculation basis.

## Primary Workflow

1. Open `市场雷达` from the FunBox tools list.
2. Switch between `全球`, `AI`, and `有色` market groups.
3. Switch between `1日`, `5日`, and `20日` performance windows.
4. Scan sectors sorted from strongest to weakest.
5. Open a sector to inspect its trend, verifiable market indicators, representative symbols, weights, and methodology.
6. Add or remove the sector from the local watch state.

## Data Policy

- Production data comes from Eastmoney's publicly accessible board, daily K-line, and constituent quote endpoints through the FunBox Go backend. The frontend never calls the upstream provider directly.
- The tracked universe contains five AI concept boards and five metals industry boards. `全球` is the union of those two groups, not a claim to cover every listed market worldwide.
- The backend calculates 1-day, 5-day, and 20-day returns from real adjusted daily closes. It derives market breadth, the pulse score, trend series, anomaly signals, and displayed constituent weights from the same fetched snapshot.
- The former qualitative `为什么上涨` content is replaced by verifiable market indicators such as interval return, turnover, advancing/declining constituents, and quote coverage. The product does not invent causal explanations from price data.
- The backend uses a short fresh-data cache and may serve only its most recent successfully fetched snapshot when the provider is temporarily unavailable. Such responses are marked stale. It never substitutes local demonstration values.
- The frontend displays the upstream source, fetch time, delayed-data wording, and stale state. A request with no usable live or cached snapshot renders an explicit retryable error state instead of demonstration data.
- Upstream URLs and cache settings remain backend configuration. No market-data secrets or provider coupling are exposed through the client bundle.
- The data model, calculations, API client, and React Native view remain separate so a licensed provider can replace Eastmoney without redesigning the screen.
- Visible financial copy includes the disclaimer `仅作信息展示，不构成投资建议`.

## Data Flow

1. The client requests `GET /api/v1/market-radar/snapshot` from the configured FunBox API base URL.
2. The market-radar service returns a fresh cached snapshot when it is within the configured TTL; otherwise it fetches board K-lines and constituent quotes from Eastmoney.
3. Each configured board is accepted only when it has enough valid closing prices to calculate the supported periods. Invalid boards are excluded and reported through coverage metadata; the request fails unless both `AI` and `有色` retain at least one valid board.
4. Successful snapshots are cached as immutable values. If a later refresh fails, the service returns the last successful snapshot with `stale: true`.
5. The client validates the response shape before rendering, keeps the previous successful screen visible during a manual refresh, and exposes loading, refresh, stale, and terminal error states explicitly.

## Calculation Rules

- `1日` return compares the latest close with the immediately preceding valid close.
- `5日` and `20日` returns compare the latest close with the close five and twenty trading sessions earlier.
- The trend series contains the latest twenty-one valid closes normalized to a 100-point starting value.
- Advancing and declining counts are based on the selected category's board return for the active period; unchanged boards are excluded from both counts.
- The pulse score is the rounded percentage of advancing boards, clamped to `0...100`. Its label is derived deterministically from score thresholds.
- The strongest board is the board with the highest active-period return. Ranking ties are resolved by stable board ID.
- Representative constituents are selected by free-float market capitalization from the current upstream member list. Displayed weights are each constituent's share of the selected representatives' combined free-float market capitalization and sum to 100% after rounding correction.

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
- Detail view for the selected sector with chart, live market indicators, representative symbols, calculated weights, methodology, and watch action.
- Selected watch state and unselected watch state.
- Initial loading, refreshing, stale snapshot, and retryable terminal error states.
- Light and dark theme support through the existing FunBox theme hook.

## Acceptance Criteria

- The tool is visible to all existing user roles and opens through the shared dynamic tool route.
- Category and period controls produce deterministic sorted results.
- No production code imports or renders the former local market snapshot, and no UI copy labels the displayed values as demonstration data.
- Responses identify Eastmoney as the source and include a fetch timestamp plus stale/coverage metadata.
- Tapping a row opens the matching detail state.
- Back returns to the overview without leaving the tool.
- Watch toggling changes visible local UI state.
- Backend service and handler tests cover parsing, calculation, caching, stale fallback, invalid upstream data, and error mapping using deterministic HTTP test fixtures. Test fixtures are never compiled into production fallback behavior.
- Frontend tests cover response validation, selection helpers, and user-facing error messages.
- Go tests, TypeScript, lint, focused frontend tests, and all existing test scripts pass.
- The Expo web build is exercised with the built-in Browser plugin at desktop and mobile widths. Browser QA covers page identity, nonblank rendering, framework overlays, console health, initial data load, category/period changes, manual refresh, detail navigation, watch toggling, and the retryable error state.

