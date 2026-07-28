# Board Turns at Doubles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the board's "wrap every N tiles regardless of content" layout with one that turns 90° specifically at doubles — the actual meaningful turning point in a real domino line — with a fixed run-length as a safety cap only, not the primary trigger. This directly replaces the corner-turning algorithm shipped earlier this build cycle, which technically worked (confirmed via live production testing: it turns, and partial rows correctly right-align) but produces a grid-like look unrelated to where doubles actually fall, not a real domino chain.

**Architecture:** `renderBoard()` in `apps/web/src/render.ts` walks `board.line` (still untouched engine data — physical left-to-right play order, doubles flagged via `PlacedTile.crosswise`) tracking a current grid position and direction. Non-double tiles continue straight in the current direction; a double tile — or hitting a maximum run length, as a width safety net — turns the direction 90° for what follows. Every tile gets an explicit `grid-row`/`grid-column`, computed from this path and normalized to non-negative indices, replacing the previous fixed-column CSS Grid approach entirely.

**Tech Stack:** Plain TypeScript + CSS Grid with explicit per-item placement. No new dependencies. No engine changes.

## Global Constraints

- **No engine changes.** `packages/engine/src/types.ts`'s `Board`/`PlacedTile` shape stays exactly as-is — this is presentation-only, same as the algorithm it replaces.
- **No branching.** The engine's `Board` type has exactly two ends (`leftEnd`/`rightEnd`) — this game does not implement a spinner variant where a double can be played in more than one direction. The new layout must render a single continuous bending path, never a fork. Do not build multi-directional branching even if it would look closer to a real photo of a domino game — it would visually imply a rule this game doesn't have.
- **Portrait-first.** Checked at 390×844 before wider.
- **No client-side unit test runner.** Test cycle is `npm run typecheck`, `npm run build`, and live manual verification via a real, played-out hand (not a synthetic board with fabricated tiles) — this feature is specifically about whether real gameplay produces a correct, connected-looking path, so verification must be against actual play, not a hand-crafted test board.
- **Commit after every task**, `type: short description` style, no scope creep.

---

## Task 1: Turn-at-doubles layout algorithm

**Files:**
- Modify: `apps/web/src/render.ts`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: `PlacedTile.tile: TileId`, `PlacedTile.crosswise: boolean` (both already exist, unchanged).
- Produces: `renderBoard(host: HTMLElement, board: Board | null): void` — signature unchanged, every existing caller (`main.ts`, `onlinetableview.ts`) keeps working with no changes on their end.
- Produces: `tileEl(id: TileId, opts?: { cross?: 'h' | 'v' }): HTMLElement` — the `cross` option changes shape from `boolean` to `'h' | 'v' | undefined`, since a double now needs to know which axis it's overflowing into (the incoming run's direction), not just whether it's a double. This is a breaking change to `tileEl`'s own signature — grep for every call site before assuming only `renderBoard` uses it.

- [ ] **Step 1: Change `tileEl`'s cross option and the CSS it drives**

In `apps/web/src/render.ts`, `tileEl` currently reads:

```ts
export function tileEl(id: TileId, opts: { cross?: boolean } = {}): HTMLElement {
  const [a, b] = halves(id);
  const el = document.createElement('div');
  el.className = 'tile' + (opts.cross ? ' cross' : '');
  ...
```

Change the class logic to:

```ts
export function tileEl(id: TileId, opts: { cross?: 'h' | 'v' } = {}): HTMLElement {
  const [a, b] = halves(id);
  const el = document.createElement('div');
  el.className = 'tile' + (opts.cross ? ` cross-${opts.cross}` : '');
  ...
```

(Only the class-name line changes — everything else in `tileEl` stays the same.)

Before touching anything else, run `grep -rn "tileEl(" apps/web/src` to find every call site. You should find it called from `render.ts` itself (inside `renderBoard`, changing in this task) and from hand-rendering code in `main.ts`/`onlinetableview.ts` — those calls never pass a `cross` option at all (hands never show crosswise tiles), so they're unaffected by the type change and need no edits. If you find a call site passing a bare boolean (`{ cross: true }`), that's a real, additional call site the rest of this brief doesn't account for — stop and report it rather than guessing how to adapt it.

In `apps/web/src/styles.css`, replace:

```css
.tile.cross { transform: rotate(90deg); margin: 0 15px; }
```

with:

```css
.tile.cross-h { transform: rotate(90deg); margin: 0 15px; }
.tile.cross-v { transform: rotate(90deg); margin: 15px 0; }
```

`cross-h` is for a double whose incoming run was horizontal (left/right) — same visual result as the old single `.cross` rule. `cross-v` is new: a double whose incoming run was vertical (up/down) needs to overflow its grid cell vertically instead of horizontally, or it'll visually collide with the tiles above/below it in that run.

- [ ] **Step 2: Replace `renderBoard()`'s layout algorithm**

In `apps/web/src/render.ts`, the current `boardCols()` function and `renderBoard()` stay conceptually similar (`boardCols()` still computes a width-based limit from `window.innerWidth`, for the same reason as before — elements are built detached from the document, so a CSS media query can't be read via `getComputedStyle` at render time), but `renderBoard()`'s body is replaced entirely.

Replace the full block from the `/** Real boards turn corners... */` comment through the end of `renderBoard()` with:

```ts
function boardCols(): number {
  const w = window.innerWidth;
  if (w >= 900) return 12;
  if (w >= 640) return 9;
  return 6;
}

type Dir = 'right' | 'down' | 'left' | 'up';

/** Clockwise turn order — after a turn, whatever direction came next in this
 * cycle becomes the new travel direction. The choice of clockwise vs.
 * counter-clockwise is arbitrary; what matters is picking one and staying
 * consistent, so the path never doubles back on a turn it already made. */
const TURN_ORDER: Dir[] = ['right', 'down', 'left', 'up'];
const STEP: Record<Dir, { dr: number; dc: number }> = {
  right: { dr: 0, dc: 1 },
  down: { dr: 1, dc: 0 },
  left: { dr: 0, dc: -1 },
  up: { dr: -1, dc: 0 },
};

interface Placement {
  tile: import('@yard/engine').PlacedTile;
  row: number;
  col: number;
  /** The direction this tile's run was travelling in when it was placed —
   * for a double, this is the INCOMING direction (the turn happens after
   * placing it, not before), which is exactly what decides whether its
   * crosswise overflow should be horizontal or vertical. */
  dir: Dir;
}

/**
 * A real domino line only turns at a double — the natural, meaningful
 * turning point, laid crosswise on the table. Everything else continues
 * straight in whatever direction the line is currently travelling.
 * `maxRun` exists purely as a width safety net: if a genuinely long run of
 * non-doubles happens with nothing forcing a turn, the board would otherwise
 * grow arbitrarily wide off the visible table. Hitting the cap turns the
 * path exactly like a double would, just without one actually being played.
 *
 * This produces one continuous bending path, never a fork — the engine's
 * `Board` type has exactly two ends (no spinner variant), so a real branch
 * would visually claim a rule this game doesn't have.
 */
function layoutPath(line: import('@yard/engine').PlacedTile[], maxRun: number): Placement[] {
  const placements: Placement[] = [];
  let row = 0, col = 0, dir: Dir = 'right', runLength = 0;

  for (const tile of line) {
    placements.push({ tile, row, col, dir });
    runLength++;

    const turn = tile.crosswise || runLength >= maxRun;
    const step = STEP[dir];
    row += step.dr;
    col += step.dc;

    if (turn) {
      dir = TURN_ORDER[(TURN_ORDER.indexOf(dir) + 1) % 4];
      runLength = 0;
    }
  }
  return placements;
}

export function renderBoard(host: HTMLElement, board: Board | null) {
  host.innerHTML = '';
  if (!board || board.line.length === 0) return;

  const placements = layoutPath(board.line, boardCols());
  const rows = placements.map((p) => p.row);
  const cols = placements.map((p) => p.col);
  const minRow = Math.min(...rows), maxRow = Math.max(...rows);
  const minCol = Math.min(...cols), maxCol = Math.max(...cols);

  host.style.gridTemplateColumns = `repeat(${maxCol - minCol + 1}, auto)`;
  host.style.gridTemplateRows = `repeat(${maxRow - minRow + 1}, auto)`;

  for (const p of placements) {
    const cross: 'h' | 'v' | undefined = p.tile.crosswise
      ? (p.dir === 'up' || p.dir === 'down' ? 'v' : 'h')
      : undefined;
    const node = tileEl(p.tile.tile, { cross });
    node.style.gridColumn = String(p.col - minCol + 1);
    node.style.gridRow = String(p.row - minRow + 1);
    host.appendChild(node);
  }
}
```

`import('@yard/engine').PlacedTile` as an inline type is used above to avoid adding a new named import if `PlacedTile` isn't already imported in this file — check the existing import line (`import type { Board, TileId } from '@yard/engine';`) and prefer adding `PlacedTile` to that named import instead of the inline `import()` type syntax, which is functionally equivalent but less idiomatic for a file that already has a type-only import from the same module. Use whichever the existing file's conventions favor.

- [ ] **Step 3: Update `.line`'s CSS — no more fixed column count from a CSS variable**

In `apps/web/src/styles.css`, the current `.line` rule reads (comment included):

```css
/* --board-cols is set inline by renderBoard() in render.ts, computed from
   window.innerWidth at render time — not from a CSS media query. ... */
.line {
  display: grid;
  grid-template-columns: repeat(var(--board-cols, 6), auto);
  grid-auto-flow: row;
  align-items: center; justify-items: center;
  gap: 8px 2px;
  margin: auto;
  padding: 8px;
}
```

Replace the comment and the `grid-template-columns`/`grid-auto-flow` lines — `renderBoard()` now sets `grid-template-columns` AND `grid-template-rows` directly as inline styles per render (computed from the actual path's bounding box, which varies every render, not a fixed count), and places every tile with an explicit `grid-column`/`grid-row` rather than relying on auto-flow at all:

```css
/* renderBoard() in render.ts sets grid-template-columns, grid-template-rows,
   and each tile's grid-column/grid-row directly as inline styles — the path
   turns at doubles, not at a fixed column count, so the grid's shape is
   different every render and can't be expressed as a static CSS rule. */
.line {
  display: grid;
  align-items: center; justify-items: center;
  gap: 8px 2px;
  margin: auto;
  padding: 8px;
}
```

- [ ] **Step 4: Restore horizontal scroll on `.table-felt`**

The path can now turn in any of four directions, not just downward — a run of turns in the same rotational sense could grow the board wider than the felt as easily as taller. Find `.table-felt` in `apps/web/src/styles.css`, currently:

```css
.table-felt {
  ...
  overflow-y: auto;
  ...
}
```

Add horizontal scroll alongside the existing vertical scroll:

```css
.table-felt {
  ...
  overflow: auto;
  ...
}
```

(Replace the single `overflow-y: auto;` line with `overflow: auto;` — this covers both axes in one shorthand rather than needing two separate declarations. Confirm no other property in this rule already sets `overflow-x` that this would conflict with.)

- [ ] **Step 5: Typecheck and build**

```bash
npm run typecheck && npm run build
```

Expected: clean. If `PlacedTile` wasn't already exported from `@yard/engine`'s public surface, typecheck will fail loudly on the import — it should already be exported (it's used elsewhere in this file's context via `Board.line: PlacedTile[]`), but confirm rather than assume.

- [ ] **Step 6: Manual verification against real play — this is the entire point of the task**

Run `npm run dev`, start a local game, and **play an actual hand out** (not a synthetic/fabricated board) far enough that the line includes at least 2-3 real doubles, at 390×844 first. Confirm:

1. The line proceeds in a straight run (tiles side by side or stacked, depending on current direction) between doubles — no wrapping or turning happens except at an actual double or the width safety cap.
2. Each double is visibly rotated crosswise, and the run immediately after it clearly changes direction (90°, not continuing straight, not reversing 180°).
3. The path reads as one continuous, connected line when traced visually from the first tile to the last — not a grid, not disconnected segments.
4. If a run of non-doubles is long enough to hit the width safety cap (`boardCols()`'s value at this width) without a double occurring, confirm it still turns — the safety net actually works, not just the double-triggered case.
5. `.table-felt` scrolls in whichever direction the path actually grows — confirm both horizontal and vertical scroll work if the path's shape needs them (a path that only turns downward repeatedly won't need horizontal scroll to appear, which is fine — the point is confirming it's available, not forcing every direction to occur).

Repeat a fast version of the same check at 768×1024 and 1440×900 — a wider `boardCols()` value means doubles matter relatively more (fewer forced safety-cap turns), so confirm the behavior is still correct, not just that the narrow case works.

Record what you actually observed for each of the 5 checks, quoting or describing the actual tile sequence you played through, not a generic "it worked."

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/render.ts apps/web/src/styles.css
git commit -m "feat: board turns at doubles instead of a fixed tile count — a real domino line, not a grid"
```
