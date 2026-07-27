---
paths:
  - "apps/web/public/art/**"
  - "apps/web/src/academy*"
  - "packages/engine/src/academy.ts"
  - "packages/engine/art/**"
  - "scripts/**"
---

# Lesson art — what to build, lesson by lesson

Every Academy lesson gets one image. Almost all of them are **board diagrams
rendered from the engine**, not generated pictures. Read the "Teaching art"
section of `design.md` first for why.

## The renderer

Build `packages/engine/art/render.ts` exporting a function that takes a position
and returns SVG, reusing the same tile geometry as the live table so diagrams
restyle themselves when the palette changes.

```
renderDiagram({
  kind, board, hands, seat, highlight, annotations, counts, score
}) => string   // SVG
```

`kind` values used below: `tile`, `match`, `line`, `table`, `seating`, `set`,
`hand`, `board`, `counts`, `score`, `sequence`.

A script at `scripts/gen-diagrams.ts` walks the list below, renders each, and
writes `apps/web/public/art/boards/<LESSON_ID>.svg`. Committed to the repo.
Deterministic — same input, same file, so diffs stay reviewable.

Notation below is tile ids as the engine uses them: `"5-3"`, always low-high.

---

## Belt 1 — Yard Baby

Near-wordless. Big shapes, high contrast, no text a pre-reader can't skip.

| ID | Kind | What it shows |
|---|---|---|
| B1L1 | `tile` | One large `5-3` tile, centred. Halves separated by the bar, each half's pips gently pulsing in turn. No labels — the image teaches "two halves, count the spots." |
| B1L2 | `match` | A `5-3` on the table with the 3 end open, and a `3-1` sliding in beside it. Both 3s glow gold. The wrong tile (`4-2`) shown greyed and bouncing off. |
| B1L3 | `line` | Five tiles laid in a row. Gold arrows at each end pointing outward: you can add here, or here. Nowhere else. |
| B1L4 | `table` | Overhead view. Your seven tiles face up at the bottom; three other seats show tile backs only. This is the first time "nobody can see your hand" is made visual. |
| B1L5 | `sequence` | Four frames: hand of 3 → 2 → 1 → empty, last frame the slam. Ends on the win. |

## Belt 2 — Learner

| ID | Kind | What it shows |
|---|---|---|
| B2L1 | `set` | **The most important diagram in the app.** All 28 tiles in the classic triangular layout. Every tile carrying a 3 lights gold — there are exactly seven. A stepper cycles suit 0 through 6, seven every time. Everything in Belt 4 is built on this one fact. |
| B2L2 | `sequence` | Two frames. Tournament: the 6-6 holder must lay `6-6`. Casual: same hand, "sporting" declared, opens `5-2` instead. Same hand, two legal openings. |
| B2L3 | `seating` | Four seats. A large anticlockwise arrow. Partners joined by a line straight across the table. Label the seat to your right as "plays next" — this is the rule most apps get backwards. |
| B2L4 | `board` | Ends showing 2 and 5. Your four tiles below, every one dimmed because none carries a 2 or a 5. One word: pass. |
| B2L5 | `counts` | A jammed board, all four hands turned face up, each seat's pip total shown beside it. |
| B2L6 | `counts` | **The canonical example — build this exactly.** North `5-5` (10), East `2-2` (4), South `1-1` (2), West `5-1` (6). Show team totals: North+South 12, East+West 10. Then show North/South winning. The team holding MORE pips wins, because South alone holds the lowest single count. Annotate that plainly. |
| B2L7 | `score` | The six-pip track filling 0-0 → 6-0, then a second run: 5-0, opponent takes one, all six pips flare red and go out together. Bruk. |
| B2L8 | `score` | 1-0, they win — and instead of resetting, a playoff frame worth two, ending 2-0. |
| B2L9 | `seating` | Two tables side by side. Partner: two colours, partners opposite. Cut throat: four colours, every tub on its own bottom. |

## Belt 3 — Player

| ID | Kind | What it shows |
|---|---|---|
| B3L1 | `hand` | Seven tiles with a suit histogram beside them — how many of each number you hold. Long suits marked, voids marked. This is the habit the whole belt rests on. |
| B3L2 | `board` | A hand long in fives including `5-5`. It poses `5-5`. Three callouts: keeps your way back in, denies the suit to everyone else, tells your partner where you live. One tile, three jobs. |
| B3L3 | `board` | Two boards side by side, same hand. Left: ends you can answer, your matching tiles glowing. Right: ends you cannot, hand dark. Same tiles, different control. |
| B3L4 | `board` | Your two legal plays, and beneath each, what it opens up for the player on your right. The better tile for your hand is the worse tile for your position. |
| B3L5 | `hand` | Hand sorted heaviest to lightest, `6-6` and `6-5` flagged. Beside it, a blocked board showing what those tiles cost you on count. |
| B3L6 | `sequence` | Play `4-4` crosswise: both ends still show 4. Play `4-1`: the end becomes 1. A double does not move the board on. |

## Belt 4 — Yard Champion

The belt that makes players. Diagrams matter most here.

| ID | Kind | What it shows |
|---|---|---|
| B4L1 | `sequence` | **The signature diagram.** Ends show 4 and 1. East passes. Both suits get a permanent void badge on East's seat — and that badge stays visible through the next four frames as the board changes. The point is that it never goes away. |
| B4L2 | `set` | All seven fives. Six are on the board or already played, greyed. The seventh is in your hand, glowing. That suit belongs to you. |
| B4L3 | `table` | All three opponents with their void lists beside them, filling up as the hand goes on. Three short lists that only ever grow. |
| B4L4 | `sequence` | Four frames of legal signalling: your first tile names your suit / partner passes so you stop feeding it / partner plays a suit twice so you open it / you can't go out, so you put him out. |
| B4L5 | `sequence` | You stop trying to go out. You play into their voids. Passes stack up. The board jams and you take it on count. |
| B4L6 | `board` | Three tiles left, two branches. Race to go out — and lose the block. Protect your count — and win it. Same position, different objective. |

## Belt 5 — Table General

| ID | Kind | What it shows |
|---|---|---|
| B5L1 | `board` | Your hand, the board, the void badges — and the unseen tiles listed down the side, crossing off as the constraints narrow. Not memory. Elimination. |
| B5L2 | `sequence` | One board, three scorelines. At 5-0 up, take the safe block. At 0-5 down, play for the jam because any win bruks them. At 1-1 with the playoff on, the hand is worth double. The scoreline changes the correct play. |
| B5L3 | `board` | A conventional signal sent deliberately false — and the opponent acting on it. |
| B5L4 | `sequence` | The same seven tiles played two ways: aggressive shedding versus holding back. You can usually tell inside two hands. |
| B5L5 | `sequence` | Timing bars under each move. One player is even throughout; the other stalls on the hard decision and gives it away free. |
| B5L6 | `board` | Tournament: the 6-6 forced down, the sporting option greyed out. |

---

## Atmosphere images — six, generated once

The only images that come from an image model. Everything above is rendered.

Common direction for all six: warm evening light, one overhead source, shallow
depth of field, documentary rather than staged, deep greens and warm browns to
sit with the palette. Photographic, not illustrated.

Hard constraints: **no recognisable faces, no text or signage in frame, no
brands or logos.** Faces make the images unusable as generic atmosphere and
raise likeness questions; text in generated images comes out wrong.

| File | Prompt direction |
|---|---|
| `art/hero.jpg` | A domino table outdoors at dusk under a single bare bulb, four players silhouetted around it, tiles bright against dark wood. Shot from slightly above and behind one player's shoulder. |
| `art/slam.jpg` | Hands mid-slam, one tile blurred with motion as it strikes the table, others scattered. Tight crop, hands only. |
| `art/set.jpg` | A double-six set on weathered wood, tiles face up and slightly scattered, raking evening light picking out the pips. |
| `art/yard.jpg` | An empty yard at golden hour: plastic chairs pulled up to a table, corrugated fence behind, one bulb strung overhead. Nobody in frame. |
| `art/hand.jpg` | Close crop of hands holding a rack of dominoes, thumb over the faces, table blurred behind. |
| `art/night.jpg` | The same table late, from a distance, bulb throwing a warm pool of light into darkness. |

Generated by `scripts/gen-art.ts`, written to `apps/web/public/art/`, committed.
Runs locally, never at runtime. Key in `.env.local`, never `VITE_` prefixed.

## Avatars

Five, described in `design.md`, mapped to the five duppy tiers. Same script,
written to `apps/web/public/avatars/<tier>.jpg`, square, 512px.

Design for the size they'll actually appear at. A 48px avatar shows almost none
of the realism you paid for, so give each one a strong silhouette and a distinct
colour — a cap, gold hoops, grey locs, a hat brim — so they're recognisable at a
glance rather than on inspection.

## Accessibility

Every diagram and image needs real `alt` text describing what it teaches, not
what it depicts. "A blocked board where the winning team holds more pips" — not
"a domino board." Belt 1 is aimed at pre-readers who may be listening to it.
