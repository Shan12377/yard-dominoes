# Visual polish — core play screens (design)

## Why

The app currently reads as a decent dark-mode UI, not a domino table. Checked
`apps/web/src/styles.css` against `.claude/rules/design.md` (already installed,
already approved) and found the palette and material model are inverted from
what that doc specifies:

- The table surface renders as brown wood (`--board: #3B1F1A`). Green is
  reserved for the score only. `design.md` wants the opposite: a **green felt**
  table surface, with wood only framing the edges.
- `--amber` (`#E8A33D`) is used broadly — nav active state, every button,
  badges, tier cards, lounge gates, chat usernames, belt numbers, the install
  card, verify dots. `design.md`: "gold is a highlight... never a background...
  if more than roughly a tenth of the screen is gold, it has stopped meaning
  anything." Current usage is closer to a third.
- Display font is Archivo Black. `design.md` specifies Anton, with Bungee
  reserved strictly for the six-love celebration and the wordmark.
- No felt texture, no wood grain, no tile-thickness shadow beyond a flat
  two-tone gradient. `design.md` calls these four things "where the craft
  lives."
- The board (`.table-felt`/`.line` in `styles.css`, `renderBoard()` in
  `render.ts`) lays tiles in one continuous horizontal line that only
  scrolls. Real Jamaican dominoes boards turn corners once the line runs out
  of table — confirmed against reference photos the user provided. This is
  a rendering gap, not a styling one: it needs a real layout algorithm, not
  a palette swap.

User's explicit scope call for this pass: **the screens players actually play
on** — local play, the online live table, lounges, membership. Academy
(lesson diagrams, drill screens) is explicitly deferred to last, and isn't
touched by this plan. Avatars and the six atmosphere images need an
image-generation API key that isn't set up yet — also out of scope here;
`.claude/rules/design.md` and `.claude/rules/lesson-art.md` already fully
specify them for whenever that's ready.

## Scope

**In:** `apps/web/src/styles.css` (full palette/type/material pass, every
selector), `apps/web/index.html` (font loading — swap Archivo Black for
Anton, add Bungee), `apps/web/src/render.ts` (`renderBoard()` — corner-turning
layout), a small amount of new CSS for the corner-turning board specifically.

**Out:** avatars, atmosphere images, Academy lesson-diagram renderer and its
~30 diagrams (`.claude/rules/lesson-art.md`), Academy drill screens (don't
exist yet, separate open thread, not part of visual polish at all).

## Approach

### 1. Palette and type — direct swap, one file

`styles.css`'s `:root` block gets replaced with `design.md`'s exact palette
(`--night`, `--felt`/`--felt-hi`/`--felt-lo`, `--wood`/`--wood-hi`,
`--gold`/`--gold-hi`/`--gold-deep`, `--bone`/`--bone-shade`, `--pip`,
`--blood`). Every existing rule that references the old variable names
(`--amber`, `--board`, `--grain`, `--green` used as the felt/table color) gets
remapped. This is mechanical but touches every section of the file — chrome,
cards, score track, tile, seating, coach, fairness, lounges, tiers, install —
so it's one pass across the whole file, not a series of small edits.

The harder judgment call is **where `--gold` survives vs. where it gets
replaced**. Rule from `design.md`: gold is score, wins, the one accent —
never a background, never routine UI chrome. Concretely:

- **Stays gold:** the lit score pips, the six-love sweep, a winning grade
  badge, the join-code/verify accent, focus rings (a highlight, momentary).
- **Moves off gold, onto bone/muted tones:** nav active state (currently a
  solid amber pill — becomes a bone-toned underline or subtle fill instead),
  `button.act`'s default background (currently solid amber for *every*
  primary action — reserve solid gold for the actions that matter, like
  "Start table" or "Deal next hand"; secondary actions like "Join"/"Sit down"
  use a quieter bone-outlined treatment already established by `.ghost`),
  badges/gates/tier borders (currently amber-bordered by default — only the
  VIP tier and locked-gate state keep gold, others go neutral), chat
  usernames, belt numbers, install-card chrome.

Font swap: `--display: 'Anton', system-ui, sans-serif` (Google Fonts, same
loading pattern already in `index.html`), add `--signage: 'Bungee', system-ui,
sans-serif` as a new variable used only by `.banner.six-love` and the
`<h1>` wordmark in the topbar — nowhere else.

### 2. Materials

Four additions, each scoped to a specific existing element:

- **Felt texture:** `.table-felt`'s background gradient gets a low-opacity
  diagonal weave (a repeating linear-gradient at a fixed angle, same
  technique the current CSS already uses for a much subtler effect at
  `.table-felt`'s existing `repeating-linear-gradient`) plus a radial
  vignette centered slightly above middle (the "light comes from above" rule)
  so the center reads brighter than the edges.
- **Wood framing:** `.table-felt` gets a visible grained border — a few
  pixels of `--wood`/`--wood-hi` gradient as the border itself (not just a
  1px hairline like today), so the felt reads as inset into a wooden table
  edge rather than floating as a rounded rectangle.
- **Tile thickness:** `.tile`'s bottom edge becomes a distinct `--bone-shade`
  strip (3-4px, per `design.md`) instead of the current single-color
  `box-shadow` offset, plus a tighter, darker contact shadow so tiles read as
  objects sitting on the felt.
- **Top-down light:** audit every gradient in the file (panels, tiles, the
  board, buttons) so they consistently run light-at-top to dark-at-bottom —
  several currently don't (e.g. `.panel`'s gradient direction is arbitrary).

### 3. Board corner-turning layout

**The real engineering piece.** `Board.line` (in `packages/engine/src/types.ts`)
stays exactly as-is — a flat, ordered array of placed tiles. This is
presentation-only; the engine's data model doesn't change, matching the
project's own rule that the client never decides game state and shouldn't
need to for what's purely a rendering concern.

`renderBoard()` (`apps/web/src/render.ts`) changes from "append every tile
into one flex row" to a **boustrophedon layout**: lay tiles left-to-right
along a row; when the row would exceed the felt's available width, turn 90°
at the next tile (rendered as a corner piece — visually just the tile
rotated to face the new direction, no new tile concept needed) and continue
the line in the perpendicular direction, alternating direction each time it
turns, the way a real board on a table with edges actually grows. This needs:

- A width measurement (the felt's actual rendered width at call time, via
  `getBoundingClientRect()` or a fixed measured tile-count-per-row derived
  from the container's CSS width — the second is simpler and avoids a layout
  thrash on every render, and is the intended approach: compute
  tiles-per-row once from a CSS custom property matching the felt's own
  responsive width breakpoints, not by measuring the live DOM).
- Direction state per row (alternating left-to-right / right-to-left, or
  consistently one direction with a vertical drop — reference photos show
  the classic "grows outward from the spinner in an increasingly boxed-in
  L or plus shape" pattern; the simplest faithful version for a single
  scrolling line of play is a **single-direction snake**: right along a row,
  turn down at the edge, continue right (or left, alternating) — this reads
  correctly and doesn't need to model branching in two directions from a
  center spinner, which real physical play does but which `Board.line`'s
  flat single-sequence data model doesn't represent anyway).
- The crosswise-double convention (`isDouble` → `cross: true`, already
  implemented) still applies within each row segment; a corner tile is a
  separate visual state (rotated to point the new direction) independent of
  whether it happens to be a double.
- Portrait-first: at 390px width, a row is short (few tiles), so corners
  happen often — this needs testing at 390×844 specifically, per the
  project's stated responsive priority, not just at desktop width where a
  long single row might never actually need to turn during a normal test.

This replaces `.line`'s CSS (currently `display: flex`) with a CSS Grid whose
column count is the computed tiles-per-row, tiles placed into explicit grid
cells by `renderBoard()`'s layout computation rather than relying on flex
wrap (flex-wrap alone can't alternate direction or rotate corner tiles
correctly).

## Testing

No client-side unit test runner exists in `apps/web` (consistent with the
rest of this codebase — this was already true for the online-play build).
Verification is: `npm run typecheck`, `npm run build` (confirm bundle
discipline unaffected — this doesn't touch anything Supabase-related, so
both chunks should be identical in structure to before), and manual
verification at 390×844 first, then wider, covering: local play (a full
hand, watching the board fill and turn at least one corner), the online live
table (same, plus the six-love sweep and bruk animations still fire
correctly against the new palette), lounges list, membership tiers page.
Screenshot-compare against the reference photos for the corner-turning
behavior specifically, since that's the one part with no existing precedent
in this codebase to fall back on.

## Explicitly deferred (not this plan)

- Avatars (5 duppy tiers) and atmosphere images (6) — blocked on an
  image-generation API key not yet configured.
- Academy lesson-diagram renderer and the ~30 diagrams in `lesson-art.md`.
- Academy drill screens generally (separate open thread, predates this
  entire visual-polish phase).
