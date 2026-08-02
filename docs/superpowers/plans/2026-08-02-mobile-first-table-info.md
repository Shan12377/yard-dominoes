# Mobile-First Table Info (Move Log + Tile-Backs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a turn-by-turn move log as a 4th rail tab on the live table, and make the existing tile-backs (remaining-tile-count indicator) visible on mobile instead of hidden.

**Architecture:** A new pure formatter file (`movelog.ts`) turns each `Move` into a display sentence, tested in isolation with no DOM. `onlinetableview.ts` wires that into a new `moveLogPanel()` function and a 4th entry in the existing `rail-tabs` mechanism — no new layout structure, this reuses the exact pattern `chatPanel`/`watchersPanel`/`standingsPanel` already use. A CSS-only change makes tile-backs render at a smaller size on mobile instead of `display: none`.

**Tech Stack:** TypeScript, `node:test`/`node:assert/strict` (existing project convention, see `seatlayout.test.ts`), vanilla DOM (`el()` helper from `render.ts`). No new dependencies.

## Global Constraints

- No new server data, no new dependencies, no changes to game logic — this is additive client UI only (spec's "Out of scope" section).
- `Move`'s actual type (`packages/engine/src/types.ts:86-104`) has five kinds: `pose`, `play`, `playcross`, `draw`, `pass`. All five must be handled.
- The exact display-name expression already used twice in this codebase (`s.username ?? \`Seat ${s.seatIndex}\`` for a human, `` `Duppy · ${s.duppyLevel}` `` for a bot) must be reused verbatim for consistency — do not invent a different duppy-naming convention.
- Photo/video shape stays circular (no change). No branding element inside the felt area (no change). Both already decided in the spec; nothing to implement for either.
- Test at both desktop width and 390px (this app's stated primary test width per `design.md`) before calling any UI task done.

---

### Task 1: `describeMoveLine()` — the pure formatter

**Files:**
- Create: `apps/web/src/movelog.ts`
- Test: `apps/web/src/movelog.test.ts`

**Interfaces:**
- Consumes: `Move` from `@yard/engine` (the union with `pose`/`play`/`playcross`/`draw`/`pass` kinds, each carrying `seat: number`), `SeatInfo` from `./onlinetable.ts` (`{ seatIndex: number; userId: string | null; username: string | null; duppyLevel: string | null; ... }`).
- Produces: `export function describeMoveLine(move: Move, seats: SeatInfo[], mySeat: number | null, isPartnerMode: boolean, mySide: number | null): string` — Task 2 imports this and `SeatInfo`'s shape stays exactly as already defined in `onlinetable.ts`, not redefined here.

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/web/src/movelog.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { describeMoveLine } from './movelog.ts';
import type { SeatInfo } from './onlinetable.ts';

function seat(overrides: Partial<SeatInfo>): SeatInfo {
  return {
    seatIndex: 0, userId: null, username: null, origin: null,
    avatar: null, background: null, duppyLevel: null, timeBank: 0,
    ...overrides,
  };
}

const seats: SeatInfo[] = [
  seat({ seatIndex: 0, userId: 'u0', username: 'Alice' }),
  seat({ seatIndex: 1, userId: 'u1', username: 'Bob' }),
  seat({ seatIndex: 2, userId: null, duppyLevel: 'pickney' }),
  seat({ seatIndex: 3, userId: 'u3', username: null }),
];

test('a pose names the tile and the poser', () => {
  const line = describeMoveLine({ kind: 'pose', seat: 1, tile: '6-6' }, seats, 0, false, null);
  assert.equal(line, 'Bob posed 6-6');
});

test('a play names the tile', () => {
  const line = describeMoveLine({ kind: 'play', seat: 1, tile: '4-4', end: 'left' }, seats, 0, false, null);
  assert.equal(line, 'Bob played 4-4');
});

test('a French cross-board play reads the same as a plain play', () => {
  const line = describeMoveLine({ kind: 'playcross', seat: 1, tile: '4-4', arm: 0 }, seats, 0, false, null);
  assert.equal(line, 'Bob played 4-4');
});

test('a draw has no tile named', () => {
  const line = describeMoveLine({ kind: 'draw', seat: 1, tile: '2-3' }, seats, 0, false, null);
  assert.equal(line, 'Bob drew a tile');
});

test('a pass', () => {
  const line = describeMoveLine({ kind: 'pass', seat: 1 }, seats, 0, false, null);
  assert.equal(line, 'Bob passed');
});

test('the viewer\'s own move shows "You", not their name', () => {
  const line = describeMoveLine({ kind: 'pass', seat: 0 }, seats, 0, false, null);
  assert.equal(line, 'You passed');
});

test('in partner mode, the partner\'s seat shows "Partner", not their name', () => {
  // mySeat 0, mySide 0 — seat 2 is on side 0 too (partner), seat 1/3 are the opposing side.
  const line = describeMoveLine({ kind: 'pass', seat: 2 }, seats, 0, true, 0);
  assert.equal(line, 'Partner passed');
});

test('in partner mode, an opposing seat still shows their real name', () => {
  const line = describeMoveLine({ kind: 'pass', seat: 1 }, seats, 0, true, 0);
  assert.equal(line, 'Bob passed');
});

test('a duppy seat shows "Duppy · <level>"', () => {
  const line = describeMoveLine({ kind: 'pass', seat: 2 }, seats, 0, false, null);
  assert.equal(line, 'Duppy · pickney passed');
});

test('a human seat with no username falls back to "Seat N"', () => {
  const line = describeMoveLine({ kind: 'pass', seat: 3 }, seats, 0, false, null);
  assert.equal(line, 'Seat 3 passed');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test apps/web/src/movelog.test.ts`
Expected: FAIL — `Cannot find module './movelog.ts'` (file does not exist yet).

- [ ] **Step 3: Write the implementation**

```typescript
// apps/web/src/movelog.ts
import type { Move } from '@yard/engine';
import type { SeatInfo } from './onlinetable.ts';

/** The exact display-name expression standingsPanel/seatCard already use
 *  (onlinetableview.ts:350, :542) — kept identical here rather than
 *  introducing a shared helper for a two-line expression used in three
 *  places, matching how this codebase already handles the duplication. */
function seatName(seat: SeatInfo): string {
  return seat.userId ? (seat.username ?? `Seat ${seat.seatIndex}`) : `Duppy · ${seat.duppyLevel}`;
}

/**
 * One line per Move, for the live table's turn-by-turn log. Pure and
 * DOM-free so it can be tested without a browser — see movelog.test.ts.
 */
export function describeMoveLine(
  move: Move,
  seats: SeatInfo[],
  mySeat: number | null,
  isPartnerMode: boolean,
  mySide: number | null,
): string {
  const seat = seats.find((s) => s.seatIndex === move.seat);
  let name: string;
  if (move.seat === mySeat) {
    name = 'You';
  } else if (isPartnerMode && mySide !== null && move.seat % 2 === mySide) {
    // sideOf() in the engine is seat % 2 for a 4-seat partner table — mySide
    // is already resolved by the caller (OnlineGame.mySide), so this only
    // needs to compare the move's seat against it, not re-derive sideOf.
    name = 'Partner';
  } else {
    name = seat ? seatName(seat) : `Seat ${move.seat}`;
  }

  switch (move.kind) {
    case 'pose': return `${name} posed ${move.tile}`;
    case 'play': return `${name} played ${move.tile}`;
    case 'playcross': return `${name} played ${move.tile}`;
    case 'draw': return `${name} drew a tile`;
    case 'pass': return `${name} passed`;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test apps/web/src/movelog.test.ts`
Expected: PASS, all 10 tests green.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean (no errors). This confirms `SeatInfo`'s import path and the `Move` union's field names actually match what Task 1 assumed — a real risk since `onlinetable.ts`'s `SeatInfo` and `@yard/engine`'s `Move` were read from source, not guessed.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/movelog.ts apps/web/src/movelog.test.ts
git commit -m "feat: pure formatter for the live table's turn-by-turn move log"
```

---

### Task 2: Wire the move log into the rail as a 4th tab

**Files:**
- Modify: `apps/web/src/onlinetableview.ts`

**Interfaces:**
- Consumes: `describeMoveLine` and nothing else from Task 1 (imported from `./movelog.ts`).
- Produces: nothing further downstream — this is the last code task.

- [ ] **Step 1: Import `describeMoveLine`**

At the top of `apps/web/src/onlinetableview.ts`, alongside the existing imports, add:

```typescript
import { describeMoveLine } from './movelog.ts';
```

- [ ] **Step 2: Widen `activeRailTab`'s type**

Find (around line 245):

```typescript
let activeRailTab: 'chat' | 'watchers' | 'standings' = 'chat';
```

Replace with:

```typescript
let activeRailTab: 'chat' | 'watchers' | 'standings' | 'log' = 'chat';
```

- [ ] **Step 3: Write `moveLogPanel()`**

Add this new function near `standingsPanel` (around line 550, right after `standingsPanel`'s closing brace):

```typescript
/** Turn-by-turn history for the current hand — JamDom shows this as a
 *  live scrolling log; game.hand.move_log already carries everything
 *  needed, just never rendered during an online hand until now. */
function moveLogPanel(game: OnlineGame): HTMLElement {
  const panel = el('div', 'panel');
  panel.append(el('div', 'eyebrow', 'Log'));
  const list = el('div', 'move-log');
  const moves = game.hand?.move_log ?? [];
  if (moves.length === 0) {
    list.append(el('div', 'muted', 'No moves yet.'));
  } else {
    const partnered = isPartnered(game.table.mode);
    for (const move of moves) {
      const line = describeMoveLine(move, game.seats, game.mySeat, partnered, game.mySide);
      list.append(el('div', 'move-log-line', line));
    }
  }
  panel.appendChild(list);
  requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
  return panel;
}
```

- [ ] **Step 4: Add the 4th tab and wire the panel into the rail**

Find the `tabDefs` array (around line 441):

```typescript
  const tabDefs: { id: typeof activeRailTab; label: string }[] = [
    { id: 'chat', label: 'Chat' },
    { id: 'watchers', label: 'Watching' },
    { id: 'standings', label: 'Standings' },
  ];
```

Add a 4th entry:

```typescript
  const tabDefs: { id: typeof activeRailTab; label: string }[] = [
    { id: 'chat', label: 'Chat' },
    { id: 'watchers', label: 'Watching' },
    { id: 'standings', label: 'Standings' },
    { id: 'log', label: 'Log' },
  ];
```

Find where `standingsPanel` gets appended to the rail (around line 466-469):

```typescript
  const standings = standingsPanel(game);
  standings.classList.add('rail-section', 'rail-section-standings');
  standings.classList.toggle('rail-section-active', activeRailTab === 'standings');
  rail.appendChild(standings);
```

Add immediately after it:

```typescript
  const log = moveLogPanel(game);
  log.classList.add('rail-section', 'rail-section-log');
  log.classList.toggle('rail-section-active', activeRailTab === 'log');
  rail.appendChild(log);
```

- [ ] **Step 5: Add minimal CSS for the log list**

In `apps/web/src/styles.css`, add near `.standings`/`.standing-row` (search for `.standing-row` to find the right neighborhood):

```css
.move-log { display: grid; gap: 4px; max-height: 300px; overflow-y: auto; }
.move-log-line { font-size: 13px; }
```

- [ ] **Step 6: Typecheck, test, build**

Run: `npm run typecheck && npm test && npm run build`
Expected: all clean/green. `npm test` should still show all 236+ prior tests plus the 10 new ones from Task 1 (246 total).

- [ ] **Step 7: Live-browser verification — desktop**

Start `npm run dev`, sign in, join a lounge, seat at (or create) a table, start a hand. Confirm:
- All 4 rail sections (Chat, Watching, Standings, Log) are visible simultaneously, unlabeled by tabs (desktop hides `.rail-tabs`).
- After a move is played (yours or a duppy's), the Log section shows a new line matching the move, using `describeMoveLine`'s exact wording.

- [ ] **Step 8: Live-browser verification — mobile (390px)**

Resize the browser (or use Playwright's `browser_resize` to 390×844). Confirm:
- The rail collapses to a tab strip: Chat / Watching / Standings / Log, four tabs.
- Tapping "Log" shows the move log and hides the other three sections; tapping another tab hides Log again.
- No layout overflow or clipping in the tab strip at 390px width.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/onlinetableview.ts apps/web/src/styles.css
git commit -m "feat: turn-by-turn move log as a 4th tab on the live table's rail"
```

---

### Task 3: Tile-backs visible on mobile, at a smaller size

**Files:**
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: nothing from Tasks 1-2 — independent, CSS-only change. Can be done in any order relative to Task 1/2, but numbered last since it's the smallest.
- Produces: nothing downstream.

- [ ] **Step 1: Find and replace the hiding rule**

In `apps/web/src/styles.css`, inside the `@media (max-width: 700px)` block (around line 741), find:

```css
  .table-cross .seat .backs { display: none; }
```

Replace with:

```css
  .table-cross .seat .backs { gap: 2px; }
  .table-cross .seat .backs i { width: 10px; height: 20px; }
```

- [ ] **Step 2: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: clean (CSS-only change, but confirms nothing else broke).

- [ ] **Step 3: Live-browser verification at 390px**

With the dev server running and the browser resized to 390px width, seat at (or continue) a table with at least one opponent holding tiles. Confirm:
- The opponent's remaining tile count now renders as small blank domino rectangles (not hidden, not a wall of text), sized to fit inline in the compact horizontal seat row.
- The seat row does not overflow, wrap awkwardly, or push other seat info off-screen at 390px.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/styles.css
git commit -m "fix: show tile-backs on mobile at a smaller size instead of hiding them"
```

---

## Self-Review Notes

- **Spec coverage:** all three design sections (move log, rail wiring,
  mobile tile-backs) map to Tasks 1-3; the two "decided against" items
  (photo/video shape, felt-area branding) correctly have no task.
- **Type consistency verified against source, not assumed:** `sideOf(seat,
  mode) = isPartnered(mode) ? seat % 2 : seat` (`tiles.ts:71-73`) confirms
  Task 1's `move.seat % 2 === mySide` is exactly right, not a guess.
  `PublicHand.move_log: Move[]` (`online.ts:156`) confirms the spec's
  original `game.hand.moveLog` was wrong and has been corrected to
  `move_log` in both the spec and this plan. `OnlineGame.seats`,
  `.mySeat`, `.mySide` all confirmed present on the class
  (`onlinetable.ts`).
- **No placeholder scan hits:** every step has real, complete code — no
  TBD/TODO, no "add appropriate handling."
