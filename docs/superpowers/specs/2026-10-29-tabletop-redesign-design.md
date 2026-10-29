# FunBox Tabletop Visual Redesign

## Approved Direction

Implement the cool-white, cobalt-blue and coral designs approved in this chat.
The product is a general tabletop scoring companion. Mahjong artwork belongs
only to its own scenario; the three home game entries have equal visual weight.

## Scope

- Home: compact generic tabletop hero, account entry, conditional resume card,
  three equally sized game cards, scoring principles and service status.
- Profile: account information or guest login/register, conditional recent
  games entry, feedback and a generic tabletop illustration.
- Mahjong entry: create/join tabs, all existing fields, location switch,
  scanning, nearby search and nearby join sheet.
- Room: invitation join, waiting, active scoring, account binding, QR expansion,
  settlement sheet/results, loading/error/cancelled states.
- Shared navigation, native tab colors/icons and page backgrounds.

## Visual System

- Canvas #F5F7FA, surface #FFFFFF, primary #2D5BFF, ink #172139,
  coral #FF765E, muted #7B879C. Pale mint is a scenario accent only.
- Clear rounded Chinese headings, strong score numerals, generous touch targets,
  restrained cool shadows and white rounded cards.
- Reusable transparent raster illustration atlas for tactile game objects;
  actual labels, numbers and controls remain native WXML.
- Small entry animations only; avoid ornament around score entry.

## Functional Constraints

Preserve handlers, data bindings, conditions, authentication, API calls and
scoring/settlement arithmetic. Only hosts start and settle. Starting still
requires at least two participants. Other games remain coming soon. Per-point
currency appears only in settlement. No new payment, ranking or account features.
Keep the user's existing project.config.json changes untouched.

## Alternatives

The initial ivory/forest-green mahjong theme was rejected. The approved modern
multi-game blue design replaces it throughout the requested surfaces.

## Validation

Run the existing miniprogram Node tests. Check WXML bindings, image references,
package size and syntax. Use installed WeChat tooling if available; otherwise
use a temporary browser rendering harness for visual layout, explicitly retaining
the limitation that it is not the real WeChat runtime. Review guest/host and
waiting/active/settled states plus a narrow viewport before completion.
