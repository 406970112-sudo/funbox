# Tabletop Artwork

Generated with the built-in image_gen tool. The shipped asset is
`miniprogram/assets/illustrations/tabletop-atlas.png`, optimized to 1152 x 768
with a transparent palette and a 3-column, 2-row layout. Native WXML controls
and labels remain separate from artwork. Tab icons originate from the two
editable SVG files in `miniprogram/assets/icons/` and are exported as 64px PNGs.

## Generation Prompt

```text
Create a production TRANSPARENT PNG sprite atlas for the approved FunBox Chinese general tabletop scoring mini app. Exactly 3 COLUMNS x 2 ROWS, total canvas 1536x1024 landscape, each cell exactly 512x512 square, invisible cell boundaries, generous transparent margins inside every cell, no bleed between cells, no background or grid or labels.
Style: very polished tactile soft 3D objects, cool-white ceramic/plastic, cobalt blue #2D5BFF, coral #FF765E, a little mint, neutral white lighting and very subtle contact shadows only. Clean silhouettes readable at small mobile size. No beige/yellow/ivory, paper grain, bamboo, felt table, neon, purple, money/coins. All surfaces pure white, blue, coral with optional green ONLY on mahjong.
Six separate compact centered still-life clusters occupying 75% of their own square cell:
TOP LEFT (row0 col0): generic TABLETOP HERO, one white ace-of-hearts poker card, one coral chess pawn, one cobalt die, one white small scoring slip with BLUE PLUS and CORAL MINUS marks, no readable words or numbers. Balanced cluster with all components visible and similar scale. No mahjong in this cell.
TOP MIDDLE (row0 col1): only two small white mahjong tiles, green circular dot suit on one and accurate red 中 on the other, green backs, one tiny white score slip with a blue plus symbol. Not elaborate.
TOP RIGHT (row0 col2): THREE white poker cards fanned neatly, black spade A, red heart K, black spade Q, one tiny blue-edged score slip. Energetic friendly tabletop objects.
BOTTOM LEFT (row1 col0): THREE white poker cards fanned neatly, red heart A, black club K, red diamond Q, a tiny coral round neutral score marker (not currency).
BOTTOM MIDDLE (row1 col1): feedback illustration, one small cobalt speech bubble containing 3 white horizontal note lines and one smaller coral speech bubble containing 3 white dots. Simple tactile 3D.
BOTTOM RIGHT (row1 col2): scoring / success illustration, one small upright clean white score sheet with a few pale blue horizontal strokes, one tilted smaller blue-edged score card with a BLUE PLUS and a CORAL MINUS, small cobalt circular checkmark in front. Generic scoring, no money.
All cells keep the same camera angle, material rendering, soft lighting and illustration scale. True transparent alpha channel, no checkerboard baked in, no opaque background anywhere. Do not make this a screenshot or poster; it is a reusable square-cell image atlas.
```
