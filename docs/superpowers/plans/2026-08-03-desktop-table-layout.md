# Desktop Table Layout (Board + Hand Always Visible) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the desktop live table so the felt never grows its own scrollbar and the player's hand is always visible directly under the board, with no page scrolling.

**Architecture:** `render.ts`'s board-sizing math already separates a pure, tested layer (`chooseUnit`, which takes a `box: BoardBox` as a plain parameter) from an untested DOM-touching wrapper (`renderBoard`, which currently always derives that box from `window.innerWidth`/`innerHeight` via `feltBox()` instead of the real container). Give `renderBoard` an escape hatch to accept the real, measured box instead, have `onlinetableview.ts` supply it once the felt is actually attached to the page, relocate the hand panel into the same visible block as the felt, and shrink the opponent seat columns so the felt has the width to use.

**Tech Stack:** TypeScript, vanilla DOM, existing `node:test` suite (no jsdom — DOM-touching code in this project is verified live in a browser, not unit tested; see Task 1's testing note).

## Global Constraints

- Desktop only (screens above the existing 700px mobile breakpoint). Do not modify anything under `@media (max-width: 700px)` — the mobile layout from the 2026-08-02 spec already satisfies board+hand visibility on mobile and must not change.
- `BoardBox` (`{ width: number; height: number }`) is already exported from `render.ts` — reuse it, do not redefine it.
- `chooseUnit(line, box, opts)` already takes `box` as a plain parameter and is already covered by `render.test.ts` — this plan does not change `chooseUnit` itself, only what `renderBoard` passes into it.
- Live-browser verification at desktop width (1280px+) is required for Tasks 2 and 3 — this whole plan exists because a screenshot-verified bug slipped through before, so "typecheck passes" is not sufficient evidence on its own for the wiring/CSS tasks.

---

### Task 1: `BoardFit.box` — let a caller supply the real measured box

**Files:**
- Modify: `apps/web/src/render.ts`

**Interfaces:**
- Consumes: nothing new — `BoardBox`, `chooseUnit`, `feltBox()` already exist exactly as used here.
- Produces: `BoardFit.box?: BoardBox`, consumed by Task 2's `renderBoard(line, board, { box })` call.

- [ ] **Step 1: Add the `box` field to `BoardFit`**

Find (around line 77):

```typescript
export interface BoardFit {
  /** Cap the width in units — the hero uses it to keep its demo line short. */
  maxUnits?: number;
  /** Pin the unit instead of fitting, for boards whose box is not the felt. */
  unit?: number;
}
```

Replace with:

```typescript
export interface BoardFit {
  /** Cap the width in units — the hero uses it to keep its demo line short. */
  maxUnits?: number;
  /** Pin the unit instead of fitting, for boards whose box is not the felt. */
  unit?: number;
  /** The real box to lay the line out inside, measured by the caller from
   *  the actual attached DOM element. Falls back to feltBox()'s
   *  window-based guess when omitted (main.ts's local play, the hero demo,
   *  and the very first render before the felt has been measured). */
  box?: BoardBox;
}
```

- [ ] **Step 2: Make `renderBoard` prefer the supplied box**

Find (around line 161, inside `renderBoard`'s line-board branch):

```typescript
  const { u, placements } = chooseUnit(orientLine(board), feltBox(), opts);
```

Replace with:

```typescript
  const { u, placements } = chooseUnit(orientLine(board), opts.box ?? feltBox(), opts);
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: clean. This is the only verification for this task — `chooseUnit`'s box-respecting behavior is already proven by the existing tests in `render.test.ts` (they call `chooseUnit` directly with an explicit box and assert on the result), and `renderBoard` itself calls real DOM APIs (`document.createElement`, `host.style...`) that this project's plain `node --test` setup has no jsdom for — it is verified live in a browser, which Task 2 does once this plumbing is actually wired to a real measurement.

- [ ] **Step 4: Run the existing suite to confirm no regression**

Run: `npm test`
Expected: all existing tests pass unchanged (246 at last count) — this change is additive (a new optional field, a fallback that preserves the old behavior when `box` is omitted), so every existing caller that doesn't pass `box` keeps behaving exactly as before.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/render.ts
git commit -m "feat: let renderBoard accept a real measured box instead of always guessing from the window"
```

---

### Task 2: Measure the real felt, re-render, and dock the hand under it

**Files:**
- Modify: `apps/web/src/onlinetableview.ts`

**Interfaces:**
- Consumes: `BoardFit.box` from Task 1 (passed as `renderBoard(line, board, { box })`).
- Produces: nothing further downstream — Task 3 is CSS-only and independent.

- [ ] **Step 1: Measure the real felt after attachment and re-render**

Find (around line 417-422):

```typescript
  const feltSlot = el('div', 'felt-slot');
  const felt = el('div', 'table-felt');
  const line = el('div', 'line');
  renderBoard(line, game.hand?.board ?? null);
  felt.appendChild(line);
  feltSlot.appendChild(felt);
```

Replace with:

```typescript
  const feltSlot = el('div', 'felt-slot');
  const felt = el('div', 'table-felt');
  const line = el('div', 'line');
  renderBoard(line, game.hand?.board ?? null); // first pass: feltBox()'s window-based guess
  felt.appendChild(line);
  feltSlot.appendChild(felt);
  // The felt isn't attached to the document yet at this point in the build,
  // so getBoundingClientRect() would read all zeros here — wait a frame for
  // real layout, then re-render against the real box if it differs from the
  // first guess. Matches this codebase's existing pattern for "needs the
  // real DOM after attach" (chat auto-scroll, the countdown timer).
  requestAnimationFrame(() => {
    // -32 matches CHROME_X/CHROME_Y's existing padding-subtraction
    // convention (felt padding + line padding), not a new magic number.
    const box = { width: felt.clientWidth - 32, height: felt.clientHeight - 32 };
    if (box.width > 0 && box.height > 0) {
      renderBoard(line, game.hand?.board ?? null, { box });
    }
  });
```

- [ ] **Step 2: Move the hand panel inside `.felt-slot`**

Find (around line 423-426, immediately after the code just changed in Step 1):

```typescript
  if (game.hand?.status === 'active' && game.hand.turn_expires_at) {
    feltSlot.appendChild(countdown(game, game.hand.turn_expires_at, rerender));
  }
  cross.appendChild(feltSlot);
```

Replace with:

```typescript
  if (game.hand?.status === 'active' && game.hand.turn_expires_at) {
    feltSlot.appendChild(countdown(game, game.hand.turn_expires_at, rerender));
  }
  // Docked directly under the felt so the board and the player's own hand
  // are always visible together — this used to be a separate panel
  // appended after .table-room closed, which pushed it below the fold.
  // Same guards as the old call site: only a seated player with a dealt
  // hand gets one.
  if (!game.isSpectator && game.hand) {
    feltSlot.appendChild(myHandPanel(game, rerender));
  }
  cross.appendChild(feltSlot);
```

- [ ] **Step 3: Remove the old call site**

Find (around line 480-489, now duplicating what Step 2 just added):

```typescript
  if (!game.hand) {
    frag.appendChild(startHandPanel(game));
  } else {
    if (!game.isSpectator) {
      // In openhand the partner's tiles render above your own. Small,
      // non-interactive, labelled — the panel is information you may act on,
      // not a hand you play. Missing from every other mode by construction.
      if (game.partnerTiles) frag.appendChild(partnerHandPanel(game.partnerTiles));
      frag.appendChild(myHandPanel(game, rerender));
    }

    if (game.hand.status !== 'active' && game.hand.result) {
      frag.appendChild(handResultPanel(game, rerender));
    }
  }
```

Replace with (removes only the now-duplicated `myHandPanel` line — `startHandPanel`, `partnerHandPanel`, and `handResultPanel` are untouched, this spec is about the player's own actionable hand specifically, not every panel on the page):

```typescript
  if (!game.hand) {
    frag.appendChild(startHandPanel(game));
  } else {
    if (!game.isSpectator) {
      // In openhand the partner's tiles render above your own. Small,
      // non-interactive, labelled — the panel is information you may act on,
      // not a hand you play. Missing from every other mode by construction.
      if (game.partnerTiles) frag.appendChild(partnerHandPanel(game.partnerTiles));
    }

    if (game.hand.status !== 'active' && game.hand.result) {
      frag.appendChild(handResultPanel(game, rerender));
    }
  }
```

- [ ] **Step 4: Typecheck, test, build**

Run: `npm run typecheck && npm test && npm run build`
Expected: all clean/green, same 246 tests as before (this task touches no test files — it's DOM wiring, verified live in Step 5).

- [ ] **Step 5: Live-browser verification at desktop width**

Start `npm run dev`, resize to at least 1280px wide, sign in, seat at (or create) a table with duppies filling empty seats, start a hand. Confirm:
- The felt has no internal horizontal scrollbar once the `requestAnimationFrame` re-render lands (open devtools and confirm `.line`'s rendered width fits inside `.table-felt` without `.table-felt` needing to scroll).
- Your own hand ("Your play") renders directly below the felt, inside the same visual block — not as a separate panel further down the page.
- Play a tile or two (or wait for a duppy to play) and confirm the board keeps rendering correctly as it grows — the re-render logic must not break on hand updates, only on the very first attach.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/onlinetableview.ts
git commit -m "feat: measure the felt's real size and dock the hand directly under it"
```

---

### Task 3: Compact the opponent seat columns

**Files:**
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: nothing from Tasks 1-2 — independent, CSS-only change.
- Produces: nothing downstream.

- [ ] **Step 1: Shrink `.table-cross`'s side columns**

Find (around line 327):

```css
  grid-template-columns: minmax(120px, 1fr) minmax(0, 3fr) minmax(120px, 1fr);
```

Replace with:

```css
  grid-template-columns: 96px minmax(0, 1fr) 96px;
```

- [ ] **Step 2: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: clean (CSS-only change, but confirms nothing else broke).

- [ ] **Step 3: Live-browser verification — the combined effect**

With the dev server still running at 1280px+ width (continuing from Task 2's session), confirm together:
- Opponent seat cards (left/right) at the new 96px width still show photo/avatar, name, and tile-backs legibly — nothing clipped, wrapped awkwardly, or overlapping.
- The felt is now visibly wider than before, using the space freed from the seat columns.
- Re-confirm Task 2's checks still hold now that the felt's real measured box has changed again: no scrollbar, hand still visible without scrolling.
- Take a screenshot at a normal desktop viewport height (900px) showing the full board and hand simultaneously visible with no page scroll, as the concrete before/after evidence for this fix.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/styles.css
git commit -m "feat: compact the opponent seat columns so the felt gets the width the JamDom reference gives its board"
```

---

## Self-Review Notes

- **Spec coverage:** all three spec sections (real-box measurement, hand relocation, compact seat columns) map to Tasks 1-3 respectively.
- **Type consistency verified against source:** `BoardBox` already exported from `render.ts` (confirmed via `render.test.ts`'s own `import type { BoardBox } from './render.ts'`); `chooseUnit(line, box, opts)` already takes `box` positionally, unchanged by this plan; `myHandPanel(game: OnlineGame, rerender: () => void): HTMLElement` signature confirmed at its definition (`onlinetableview.ts:660`) and matches both the old and new call sites exactly.
- **No placeholder scan hits:** every step has complete, real code — no TBD/TODO, no "add appropriate handling."
- **Testing note:** Task 1 deliberately adds no new unit test — `renderBoard`'s DOM-touching code has no jsdom in this project's test setup, and the pure logic it delegates to (`chooseUnit`) is already covered. Tasks 2-3's correctness is fundamentally about real browser layout, which is why both carry mandatory live-verification steps rather than unit tests standing in for them.
