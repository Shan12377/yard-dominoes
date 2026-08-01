# Table Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the online live table screen so the felt is bigger and central, seats surround it in a cross instead of stacking below it, and a side rail (chat, watchers, standings) stays visible the whole time you're playing — collapsing to a stacked mobile layout that keeps the same priority (board first) rather than a shrunk desktop layout.

**Architecture:** Pure layout/CSS change to `apps/web/src/onlinetableview.ts` (`liveTableView()`), a new pure `seatPosition()` helper (unit tested, no DOM), a reusable `chatPanel()` extracted from `loungeview.ts`, and new CSS grid rules in `styles.css`. No new server data, no new Realtime subscriptions, no changes to game logic.

**Tech Stack:** TypeScript, hand-built DOM (no framework), CSS Grid, existing `@yard/engine` for `sideOf`/`isPartnered`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-01-table-layout-design.md` — read it first for the "why."
- Out of scope: `apps/web/src/main.ts`'s `tableView()` (local/offline play), any new server data, voice/video/reactions/quick-chat/report-button *behavior* (repositioned only, not redesigned).
- Mobile/desktop breakpoint: `700px`, matching `.room`'s existing breakpoint in `styles.css` — do not invent a second breakpoint value.
- Primary mobile test width: `390×844` (design.md's stated primary target).
- Seat-to-position mapping (4 seats): bottom = `mySeat`, right = `mySeat+1`, top = `mySeat+2`, left = `mySeat+3` (mod `seatCount`). 3 seats: bottom = `mySeat`, right = `mySeat+1`, left = `mySeat+2`, top empty. 2 seats: bottom = `mySeat`, top = `mySeat+1`. Spectators anchor on seat 0 at bottom.
- No new colours, no new fonts, no new motion system — reuse existing `design.md` tokens (`--gold-hi`, `--wood`/`--wood-hi`, `.panel`'s card treatment) throughout.
- `npm test`, `npm run typecheck`, `npm run build` must stay green after every task.
- This is a frontend/visual feature — every task's manual verification step must actually be run in a browser (dev server + Playwright), not assumed from a code read.

---

### Task 1: `seatPosition()` — pure seat-to-cross-position mapping

**Files:**
- Create: `apps/web/src/seatlayout.ts`
- Test: `apps/web/src/seatlayout.test.ts`

**Interfaces:**
- Produces: `export type SeatSlot = 'top' | 'left' | 'right' | 'bottom';` and `export function seatPosition(seatIndex: number, mySeat: number | null, seatCount: 2 | 3 | 4): SeatSlot | null` — returns `null` when that seat index has no position in a seat count smaller than 4 (e.g. the "top" slot for a 3-seat table, or "left"/"right" for a 2-seat table). Later tasks (2, 6) call this once per seat while building the cross grid and the mobile seat strip.

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/web/src/seatlayout.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { seatPosition } from './seatlayout.ts';

test('4 seats: bottom is mine, then right/top/left going anti-clockwise from me', () => {
  assert.equal(seatPosition(2, 2, 4), 'bottom'); // mySeat
  assert.equal(seatPosition(3, 2, 4), 'right');  // mySeat+1
  assert.equal(seatPosition(0, 2, 4), 'top');    // mySeat+2 — the partner, opposite
  assert.equal(seatPosition(1, 2, 4), 'left');   // mySeat+3
});

test('4 seats: the mapping wraps correctly when mySeat is 0', () => {
  assert.equal(seatPosition(0, 0, 4), 'bottom');
  assert.equal(seatPosition(1, 0, 4), 'right');
  assert.equal(seatPosition(2, 0, 4), 'top');
  assert.equal(seatPosition(3, 0, 4), 'left');
});

test('3 seats: bottom/right/left, top is never used', () => {
  assert.equal(seatPosition(1, 1, 3), 'bottom');
  assert.equal(seatPosition(2, 1, 3), 'right');
  assert.equal(seatPosition(0, 1, 3), 'left');
});

test('2 seats: bottom is mine, top is the only other seat — never left/right', () => {
  assert.equal(seatPosition(0, 0, 2), 'bottom');
  assert.equal(seatPosition(1, 0, 2), 'top');
});

test('a spectator (mySeat null) anchors on seat 0 at the bottom', () => {
  assert.equal(seatPosition(0, null, 4), 'bottom');
  assert.equal(seatPosition(1, null, 4), 'right');
  assert.equal(seatPosition(2, null, 4), 'top');
  assert.equal(seatPosition(3, null, 4), 'left');
});

test('a seat count of 4 never returns null for any of the four seats', () => {
  for (let seat = 0; seat < 4; seat++) {
    assert.notEqual(seatPosition(seat, 0, 4), null);
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test apps/web/src/seatlayout.test.ts`
Expected: FAIL — `seatlayout.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```typescript
// apps/web/src/seatlayout.ts
//
// Where each seat sits in the cross grid around the felt — spec
// docs/superpowers/specs/2026-08-01-table-layout-design.md §2. Anchored on
// the viewer's own seat (always "bottom", closest to the thumb), the rest
// placed using the same seat-numbering invariant CLAUDE.md already states:
// seat+1 is the player to your physical right, so partners (seat+2 in a
// 4-hander) land opposite for free — nothing partner-specific to compute.

export type SeatSlot = 'top' | 'left' | 'right' | 'bottom';

/** Order slots fill in, walking anti-clockwise from "me" at the bottom. */
const FOUR_SEAT_ORDER: SeatSlot[] = ['bottom', 'right', 'top', 'left'];
const THREE_SEAT_ORDER: (SeatSlot | null)[] = ['bottom', 'right', 'left'];
const TWO_SEAT_ORDER: SeatSlot[] = ['bottom', 'top'];

export function seatPosition(
  seatIndex: number, mySeat: number | null, seatCount: 2 | 3 | 4,
): SeatSlot | null {
  const anchor = mySeat ?? 0;
  const offset = ((seatIndex - anchor) % seatCount + seatCount) % seatCount;
  if (seatCount === 4) return FOUR_SEAT_ORDER[offset];
  if (seatCount === 3) return THREE_SEAT_ORDER[offset] ?? null;
  return TWO_SEAT_ORDER[offset] ?? null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test apps/web/src/seatlayout.test.ts`
Expected: PASS, all 6 tests.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS — this file has no consumers yet, so nothing else should be affected.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/seatlayout.ts apps/web/src/seatlayout.test.ts
git commit -m "feat: pure seat-to-cross-position mapping for the new table layout"
```

---

### Task 2: Bigger felt + cross grid on desktop, seats repositioned

**Files:**
- Modify: `apps/web/src/render.ts` (`feltBox()`, currently around line 88)
- Modify: `apps/web/src/onlinetableview.ts` (`liveTableView()`, currently lines 301–434)
- Modify: `apps/web/src/styles.css` (new rules after the existing `.table-felt` block, currently ending around line 305; and replacing `.seats`/`.seat` starting at line 391)

**Interfaces:**
- Consumes: `seatPosition(seatIndex, mySeat, seatCount)` from Task 1.
- Produces: `.table-cross` / `.seat-slot` / `.felt-slot` CSS classes that Task 6 (mobile) and Task 7 (luxury pass) build on. `liveTableView()`'s seat-card-building logic gets pulled into a named local function `seatCard(s, game, rerender, social)` so Task 3 (score line) and Task 6 (mobile strip) modify one place, not two.

- [ ] **Step 1: Raise the felt's size caps**

In `apps/web/src/render.ts`, find `feltBox()`:

```typescript
function feltBox(): BoardBox {
  return {
    width: Math.min(window.innerWidth, 940) - 32 - CHROME_X,
    height: Math.min(window.innerHeight * 0.64, 560) - CHROME_Y,
  };
}
```

Replace the two caps:

```typescript
function feltBox(): BoardBox {
  return {
    width: Math.min(window.innerWidth, 1200) - 32 - CHROME_X,
    height: Math.min(window.innerHeight * 0.72, 680) - CHROME_Y,
  };
}
```

- [ ] **Step 2: Extract the seat-card builder as its own function**

In `apps/web/src/onlinetableview.ts`, the current `liveTableView()` builds each seat card inline inside `game.seats.forEach((s) => {...})` (lines 356–405). Cut that whole callback body out into a standalone function placed just above `liveTableView`:

```typescript
function seatCard(
  s: SeatInfo, game: OnlineGame, rerender: () => void, social?: TableSocial,
): HTMLElement {
  const card = el('div', 'seat');
  if (game.hand?.turn === s.seatIndex && game.hand.status === 'active') card.classList.add('turn');
  // Cosmetic only — plan §7.1. A faint backdrop behind the seat's own
  // content, never anything that could compete with tile/turn legibility.
  if (s.userId && s.background) {
    card.style.backgroundImage = `linear-gradient(rgba(255,251,240,0.86), rgba(255,251,240,0.86)), url(${backgroundUrl(s.background as Background)})`;
    card.style.backgroundSize = 'cover';
    card.style.backgroundPosition = 'center';
  }
  const who = el('div', 'who');
  // A real uploaded photo first, falling back to the preset character —
  // photo.ts has no has_photo flag to check, so this is genuinely a try:
  // the browser's own onerror is what "no photo" looks like. A duppy has
  // its own art elsewhere (design.md's five tiers) and never picks from
  // either set.
  if (s.userId) {
    const img = document.createElement('img');
    img.className = 'avatar';
    img.width = 32;
    img.height = 32;
    img.alt = s.avatar ? (AVATAR_LABEL[s.avatar as Avatar] ?? '') : '';
    img.src = photoUrl(s.userId);
    img.onerror = () => {
      if (s.avatar) {
        img.onerror = null;
        img.src = avatarUrl(s.avatar as Avatar);
      } else {
        img.remove();
      }
    };
    who.appendChild(img);
  }
  who.append(el('h3', undefined,
    s.userId ? (s.username ?? `Seat ${s.seatIndex}`) : `Duppy · ${s.duppyLevel}`));
  // Yard or foreign, if they said. A duppy is from nowhere.
  if (s.origin === 'yardie' || s.origin === 'foreign') {
    who.append(el('span', `badge origin-${s.origin}`,
      s.origin === 'yardie' ? 'Yardie' : 'Foreign'));
  }
  card.appendChild(who);
  const count = game.hand?.hand_sizes[s.seatIndex] ?? 0;
  card.append(el('div', 'meta', `${count} tile${count === 1 ? '' : 's'}`));
  if (s.seatIndex !== game.mySeat) card.append(backsEl(count));
  decorateSeat(card, s.userId, social);
  if (s.userId && s.seatIndex !== game.mySeat) {
    card.appendChild(reportButton(s.userId, game.table.id, rerender));
  }
  return card;
}
```

- [ ] **Step 3: Replace the felt + seats section of `liveTableView` with the cross grid**

Still in `apps/web/src/onlinetableview.ts`, find this block (currently lines 345–406):

```typescript
  const felt = el('div', 'table-felt');
  const line = el('div', 'line');
  renderBoard(line, game.hand?.board ?? null);
  felt.appendChild(line);
  frag.appendChild(felt);

  if (game.hand?.status === 'active' && game.hand.turn_expires_at) {
    frag.appendChild(countdown(game, game.hand.turn_expires_at, rerender));
  }

  const seatsRow = el('div', 'seats');
  game.seats.forEach((s) => {
    const card = el('div', 'seat');
    if (game.hand?.turn === s.seatIndex && game.hand.status === 'active') card.classList.add('turn');
    // Cosmetic only — plan §7.1. A faint backdrop behind the seat's own
    // content, never anything that could compete with tile/turn legibility.
    if (s.userId && s.background) {
      card.style.backgroundImage = `linear-gradient(rgba(255,251,240,0.86), rgba(255,251,240,0.86)), url(${backgroundUrl(s.background as Background)})`;
      card.style.backgroundSize = 'cover';
      card.style.backgroundPosition = 'center';
    }
    const who = el('div', 'who');
    // A real uploaded photo first, falling back to the preset character —
    // photo.ts has no has_photo flag to check, so this is genuinely a try:
    // the browser's own onerror is what "no photo" looks like. A duppy has
    // its own art elsewhere (design.md's five tiers) and never picks from
    // either set.
    if (s.userId) {
      const img = document.createElement('img');
      img.className = 'avatar';
      img.width = 32;
      img.height = 32;
      img.alt = s.avatar ? (AVATAR_LABEL[s.avatar as Avatar] ?? '') : '';
      img.src = photoUrl(s.userId);
      img.onerror = () => {
        if (s.avatar) {
          img.onerror = null;
          img.src = avatarUrl(s.avatar as Avatar);
        } else {
          img.remove();
        }
      };
      who.appendChild(img);
    }
    who.append(el('h3', undefined,
      s.userId ? (s.username ?? `Seat ${s.seatIndex}`) : `Duppy · ${s.duppyLevel}`));
    // Yard or foreign, if they said. A duppy is from nowhere.
    if (s.origin === 'yardie' || s.origin === 'foreign') {
      who.append(el('span', `badge origin-${s.origin}`,
        s.origin === 'yardie' ? 'Yardie' : 'Foreign'));
    }
    card.appendChild(who);
    const count = game.hand?.hand_sizes[s.seatIndex] ?? 0;
    card.append(el('div', 'meta', `${count} tile${count === 1 ? '' : 's'}`));
    if (s.seatIndex !== game.mySeat) card.append(backsEl(count));
    decorateSeat(card, s.userId, social);
    if (s.userId && s.seatIndex !== game.mySeat) {
      card.appendChild(reportButton(s.userId, game.table.id, rerender));
    }
    seatsRow.appendChild(card);
  });
  frag.appendChild(seatsRow);
```

Replace it with:

```typescript
  const cross = el('div', 'table-cross');

  const feltSlot = el('div', 'felt-slot');
  const felt = el('div', 'table-felt');
  const line = el('div', 'line');
  renderBoard(line, game.hand?.board ?? null);
  felt.appendChild(line);
  feltSlot.appendChild(felt);
  if (game.hand?.status === 'active' && game.hand.turn_expires_at) {
    feltSlot.appendChild(countdown(game, game.hand.turn_expires_at, rerender));
  }
  cross.appendChild(feltSlot);

  game.seats.forEach((s) => {
    const slot = seatPosition(s.seatIndex, game.mySeat, game.table.seatCount);
    if (!slot) return;
    const wrap = el('div', `seat-slot seat-slot-${slot}`);
    wrap.appendChild(seatCard(s, game, rerender, social));
    cross.appendChild(wrap);
  });

  frag.appendChild(cross);
```

- [ ] **Step 4: Add the imports for `seatPosition` and `SeatInfo`**

At the top of `apps/web/src/onlinetableview.ts`, add a new import line:

```typescript
import { seatPosition } from './seatlayout.ts';
```

and change the existing `OnlineGame` import to also bring in `SeatInfo` (used in `seatCard`'s signature above):

```typescript
import { OnlineGame } from './onlinetable.ts';
```

becomes:

```typescript
import { OnlineGame } from './onlinetable.ts';
import type { SeatInfo } from './onlinetable.ts';
```

- [ ] **Step 5: Add the cross grid CSS**

In `apps/web/src/styles.css`, right after the `.table-felt` block (ends around line 305, before the "renderBoard() in render.ts sets..." comment at line 307), add:

```css
/* ------------------------------------------------------------ table-cross
   Seats surround the felt instead of stacking below it — spec
   docs/superpowers/specs/2026-08-01-table-layout-design.md §2. Named grid
   areas rather than raw row/column numbers: the same four class names
   (seat-slot-top/left/right/bottom) work whether 2, 3, or 4 of them are
   filled, and an unfilled slot (e.g. "top" on a 3-seat table) simply has no
   child — the grid area still exists but renders empty, no gap to patch. */
.table-cross {
  display: grid;
  grid-template-columns: minmax(120px, 1fr) minmax(0, 3fr) minmax(120px, 1fr);
  grid-template-rows: auto auto auto;
  grid-template-areas:
    ".    top    ."
    "left felt   right"
    ".    bottom .";
  gap: 10px;
  align-items: center;
}
.felt-slot { grid-area: felt; min-width: 0; }
.seat-slot-top { grid-area: top; }
.seat-slot-left { grid-area: left; }
.seat-slot-right { grid-area: right; }
.seat-slot-bottom { grid-area: bottom; }
```

- [ ] **Step 6: Remove the now-unused `.seats` rule**

In `apps/web/src/styles.css`, delete the line (around 392):

```css
.seats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
```

The `.seat` card rules directly below it (border, padding, `.seat.turn`, etc.) stay — `seatCard()` still produces a `.seat` element, just placed inside a `.seat-slot-*` wrapper now instead of a `.seats` row.

- [ ] **Step 7: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 8: Verify live in a real browser — 4-seat table**

```bash
npm run dev
```

Use the Playwright MCP tools (or manual browser) to: sign up two real test accounts via the Supabase REST API (same pattern as prior sessions — `POST /auth/v1/signup`), create a 4-seat cutthroat table with 2 duppies and both accounts seated, inject one account's session into `localStorage` under `sb-<project-ref>-auth-token`, navigate to the app, and confirm:
- The felt renders visibly larger than before.
- Your own seat card appears at the bottom of the cross.
- The other three seats (2 duppies + 1 human) appear at right/top/left.
- Playing a tile still works (click a legal tile, confirm it lands on the board).
- The report button still appears on the human opponent's seat card and still opens its reason form when clicked (it moved from a `.seats` row item into a `.seat-slot-*` wrapper in this task — confirm that move didn't break its layout or click handling).

Clean up the test accounts and table afterward via SQL, matching the cleanup pattern used throughout this project's prior sessions.

- [ ] **Step 9: Verify live — 2-seat table**

Repeat with a 2-seat cutthroat table (1 duppy or 1 second human). Confirm: your seat at bottom, the other seat at top, nothing renders in the left/right grid areas (no empty visible box — `grid-template-areas` leaves an empty cell with no border/background, so this should look clean; screenshot to confirm).

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/render.ts apps/web/src/onlinetableview.ts apps/web/src/styles.css
git commit -m "feat: seats surround the felt in a cross instead of stacking below it"
```

---

### Task 3: Seat card score line

**Files:**
- Modify: `apps/web/src/onlinetableview.ts` (`seatCard()`, written in Task 2; import line)

**Interfaces:**
- Consumes: `game.scores: number[]`, `game.table.mode: GameMode`, `sideOf`/`isPartnered` from `@yard/engine`.
- Produces: nothing new consumed by later tasks — this is a leaf addition to `seatCard()`.

- [ ] **Step 1: Add the engine imports**

In `apps/web/src/onlinetableview.ts`, change:

```typescript
import { CLOCK_LABELS, CLOCK_NAMES, DUPPY_LABELS, DUPPY_LEVELS } from '@yard/engine';
```

to:

```typescript
import { CLOCK_LABELS, CLOCK_NAMES, DUPPY_LABELS, DUPPY_LEVELS, isPartnered, sideOf } from '@yard/engine';
```

- [ ] **Step 2: Add the score line to `seatCard()`**

In the `seatCard()` function written in Task 2, right after the line that appends `.meta` (tile count):

```typescript
  const count = game.hand?.hand_sizes[s.seatIndex] ?? 0;
  card.append(el('div', 'meta', `${count} tile${count === 1 ? '' : 's'}`));
```

add:

```typescript
  const scoreIndex = isPartnered(game.table.mode) ? sideOf(s.seatIndex, game.table.mode) : s.seatIndex;
  const score = game.scores[scoreIndex] ?? 0;
  card.append(el('div', 'seat-score', String(score)));
```

- [ ] **Step 3: Add CSS for `.seat-score`**

In `apps/web/src/styles.css`, right after `.seat .meta { ... }` (around line 400):

```css
.seat .seat-score {
  font-family: var(--mono); font-variant-numeric: tabular-nums;
  font-size: 18px; font-weight: 700; color: var(--gold-deep);
  margin-top: 2px;
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Verify live — partner mode score is per-side, not duplicated per-seat**

Using the dev server, seat 4 accounts (or 2 humans + 2 duppies) at a **partner** table. Confirm that seat 0 and seat 2 (partners) show the *same* score number, and seat 1/seat 3 (the other side) show the other number — this is the whole reason `sideOf`/`isPartnered` are used instead of a raw `game.scores[s.seatIndex]`, which would be wrong for partner mode (scores are indexed by side, not by seat, in that mode).

- [ ] **Step 6: Verify live — cutthroat mode score is per-seat**

Same check on a cutthroat table: each of the (up to 4) seats should show its own independent score.

- [ ] **Step 7: Run the full suite and build**

Run: `npm test && npm run build`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/onlinetableview.ts apps/web/src/styles.css
git commit -m "feat: show live score on each seat card"
```

---

### Task 4: Extract a reusable chat panel from the lounge room

**Files:**
- Modify: `apps/web/src/loungeview.ts` (the `room()` function, currently starting at line 1236; the inline chat block currently at lines 1261–1320)

**Interfaces:**
- Produces: `export function chatPanel(lounge: Lounge, rerender: () => void): HTMLElement` — Task 5 imports this into `onlinetableview.ts` via the `TableSocial` object built in `loungeview.ts` (a view module may not import another view module directly — see the existing circular-import note in `onlinetableview.ts`'s `TableSocial` doc comment — so this function is *called* in `loungeview.ts` and the resulting `HTMLElement` is *handed* to `liveTableView()`, the same pattern already used for `voicePanel`/`videoPanel`/`reactionBar`).

- [ ] **Step 1: Extract the chat block into its own function**

In `apps/web/src/loungeview.ts`, find the block inside `room(lounge, rerender)` (currently lines 1261–1320):

```typescript
  // --- chat ---------------------------------------------------------------
  const chatPanel = el('div', 'panel');
  chatPanel.append(el('div', 'eyebrow', 'Table talk'));

  const log = el('div', 'chat-log');
  if (loungeState.messages.length === 0) {
    log.append(el('div', 'muted', 'Quiet in here. Say something.'));
  }
  for (const msg of loungeState.messages) {
    const line = el('div', 'chat-msg');
    line.append(el('span', 'who', msg.username ?? 'player'));
    line.append(document.createTextNode(msg.body));
    line.append(el('span', 'when', new Date(msg.created_at).toLocaleTimeString([], {
      hour: '2-digit', minute: '2-digit',
    })));
    log.appendChild(line);
  }
  chatPanel.appendChild(log);
  requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
  // Cap the rendered history; an all-day lounge otherwise grows without bound.
  if (loungeState.messages.length > 200) {
    loungeState.messages = loungeState.messages.slice(-200);
  }

  const form = el('div', 'chat-form');
  const input = document.createElement('input');
  input.placeholder = 'Chat here then send';
  input.maxLength = 500;
  input.value = draft;
  input.oninput = () => { draft = input.value; draftCaret = input.selectionStart ?? draft.length; };
  // Restore focus and caret only if the player was already typing here.
  if (draft) {
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(draftCaret, draftCaret);
    });
  }
  const send = document.createElement('button');
  send.className = 'act ghost';
  send.textContent = 'Send';
  const submit = async () => {
    const body = input.value.trim();
    if (!body) return;
    input.value = '';
    draft = '';
    draftCaret = 0;
    try {
      await sendMessage(lounge.id, body);
    } catch (err) {
      loungeState.error = err instanceof Error ? err.message : 'could not send';
      rerender();
    }
  };
  send.onclick = () => void submit();
  input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } };
  form.append(input, send);
  chatPanel.appendChild(form);

  chatPanel.appendChild(voicePanel(rerender));
  chatPanel.appendChild(reactionBar(rerender));
```

Replace it with:

```typescript
  // --- chat ---------------------------------------------------------------
  const chat = chatPanel(lounge, rerender);
  chat.appendChild(voicePanel(rerender));
  chat.appendChild(reactionBar(rerender));
```

Then, above the `room()` function definition, add the extracted function (matching the doc-comment style already used for other exported view helpers in this file, e.g. `avatarImg`):

```typescript
/**
 * The lounge's live chat, extracted so the live table view (which cannot
 * import this module — see TableSocial's doc comment in onlinetableview.ts
 * for why) can render the same panel while a hand is in progress. The
 * underlying channel and message list (loungeState.messages) are unchanged
 * either way — this only changes where the panel gets rendered, never
 * subscribes twice.
 */
export function chatPanel(lounge: Lounge, rerender: () => void): HTMLElement {
  const panel = el('div', 'panel');
  panel.append(el('div', 'eyebrow', 'Table talk'));

  const log = el('div', 'chat-log');
  if (loungeState.messages.length === 0) {
    log.append(el('div', 'muted', 'Quiet in here. Say something.'));
  }
  for (const msg of loungeState.messages) {
    const line = el('div', 'chat-msg');
    line.append(el('span', 'who', msg.username ?? 'player'));
    line.append(document.createTextNode(msg.body));
    line.append(el('span', 'when', new Date(msg.created_at).toLocaleTimeString([], {
      hour: '2-digit', minute: '2-digit',
    })));
    log.appendChild(line);
  }
  panel.appendChild(log);
  requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
  // Cap the rendered history; an all-day lounge otherwise grows without bound.
  if (loungeState.messages.length > 200) {
    loungeState.messages = loungeState.messages.slice(-200);
  }

  const form = el('div', 'chat-form');
  const input = document.createElement('input');
  input.placeholder = 'Chat here then send';
  input.maxLength = 500;
  input.value = draft;
  input.oninput = () => { draft = input.value; draftCaret = input.selectionStart ?? draft.length; };
  // Restore focus and caret only if the player was already typing here.
  if (draft) {
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(draftCaret, draftCaret);
    });
  }
  const send = document.createElement('button');
  send.className = 'act ghost';
  send.textContent = 'Send';
  const submit = async () => {
    const body = input.value.trim();
    if (!body) return;
    input.value = '';
    draft = '';
    draftCaret = 0;
    try {
      await sendMessage(lounge.id, body);
    } catch (err) {
      loungeState.error = err instanceof Error ? err.message : 'could not send';
      rerender();
    }
  };
  send.onclick = () => void submit();
  input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } };
  form.append(input, send);
  panel.appendChild(form);
  return panel;
}
```

- [ ] **Step 2: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: PASS. `chatPanel` as a local variable name inside `room()` no longer exists (renamed to `chat`), so there is no naming collision with the new exported function of the same name.

- [ ] **Step 3: Verify live — lounge chat still works exactly as before**

`npm run dev`, sign in, enter a lounge, send a chat message, confirm it appears with your username and timestamp, confirm your typed-but-unsent draft survives an incoming message from another tab/account (the existing `client.md` "chat draft survives a re-render" rule) — this step is a pure regression check, since the extraction changes no behavior.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/loungeview.ts
git commit -m "refactor: extract the lounge chat panel into a reusable function"
```

---

### Task 5: Side rail — chat, watchers, standings, visible during play (desktop)

**Files:**
- Modify: `apps/web/src/onlinetableview.ts` (`TableSocial` interface, `liveTableView()`, `watchersPanel()`)
- Modify: `apps/web/src/loungeview.ts` (the `liveTableView(...)` call site, currently around line 1411)
- Modify: `apps/web/src/styles.css` (new `.table-room` wrapper)

**Interfaces:**
- Consumes: `chatPanel()` from Task 4.
- Produces: `.table-room` / `.table-rail` CSS classes that Task 6 (mobile) turns into tabs.

- [ ] **Step 1: Add `chatPanel` to `TableSocial`**

In `apps/web/src/onlinetableview.ts`, in the `TableSocial` interface:

```typescript
export interface TableSocial {
  /** User ids talking right now, so a seat shows who is speaking. */
  speaking: Set<string>;
  /** The reaction each person last threw, by user id. */
  reactions: Map<string, string>;
  voicePanel: HTMLElement | null;
  videoPanel?: HTMLElement | null;
  /** Pulled video streams, keyed by user id — VIP-gated, table-scoped. */
  videoStreams?: Map<string, MediaStream>;
  reactionBar: HTMLElement | null;
  quickChatBar?: HTMLElement | null;
  /** Everyone with this table open, seated players included. */
  watching?: { user_id: string; username: string }[];
}
```

add one field:

```typescript
  /** The lounge's live chat, prebuilt by loungeview.ts (same reasoning as
   *  voicePanel/videoPanel — this module cannot import loungeview.ts).
   *  Null when the table has no lounge context (e.g. a direct join-code
   *  attach with no lounge ever opened). */
  chatPanel?: HTMLElement | null;
```

- [ ] **Step 2: Write `standingsPanel()`**

In `apps/web/src/onlinetableview.ts`, add a new function near `watchersPanel()`:

```typescript
/** One line per seat/side, for the rail — a glanceable summary that does
 *  not require finding the right position in the cross to compare scores. */
function standingsPanel(game: OnlineGame): HTMLElement {
  const panel = el('div', 'panel');
  panel.append(el('div', 'eyebrow', 'Standings'));
  const list = el('div', 'standings');
  if (isPartnered(game.table.mode)) {
    const labels = ['You & partner', 'Them'];
    for (let side = 0; side < 2; side++) {
      const line = el('div', 'standing-row');
      line.append(el('span', undefined, side === (game.mySide ?? 0) ? labels[0] : labels[1]));
      line.append(el('span', 'seat-score', String(game.scores[side] ?? 0)));
      list.appendChild(line);
    }
  } else {
    game.seats.forEach((s) => {
      const line = el('div', 'standing-row');
      const label = s.userId ? (s.username ?? `Seat ${s.seatIndex}`) : `Duppy · ${s.duppyLevel}`;
      line.append(el('span', undefined, label));
      line.append(el('span', 'seat-score', String(game.scores[s.seatIndex] ?? 0)));
      list.appendChild(line);
    });
  }
  panel.appendChild(list);
  return panel;
}
```

- [ ] **Step 3: Wrap the cross grid and add the rail in `liveTableView()`**

In `apps/web/src/onlinetableview.ts`, the code from Task 2 ends with:

```typescript
  frag.appendChild(cross);
```

Change it to build a `.table-room` wrapper holding the cross and the rail:

```typescript
  const room = el('div', 'table-room');
  room.appendChild(cross);

  const rail = el('div', 'table-rail');
  if (social?.chatPanel) rail.appendChild(social.chatPanel);
  const crowd = watchersPanel(game, social);
  if (crowd) rail.appendChild(crowd);
  rail.appendChild(standingsPanel(game));
  room.appendChild(rail);

  frag.appendChild(room);
```

- [ ] **Step 4: Remove the old bottom-of-page `watchersPanel` call**

Further down in `liveTableView()`, the existing code has:

```typescript
  const crowd = watchersPanel(game, social);
  if (crowd) frag.appendChild(crowd);
```

placed after the hand panels (around what was line 424–425 before Task 2's edits). Delete this — `watchersPanel` is now called once, inside the rail-building code from Step 3, not twice.

- [ ] **Step 5: Wire `chatPanel` into the `TableSocial` object in `loungeview.ts`**

In `apps/web/src/loungeview.ts`, at the `liveTableView(...)` call site (around line 1425), the `social` object currently ends with:

```typescript
      watching: loungeState.roster.filter(
        (p) => p.table === loungeState.onlineGame!.table.id,
      ),
    }));
```

Add a `chatPanel` field:

```typescript
      watching: loungeState.roster.filter(
        (p) => p.table === loungeState.onlineGame!.table.id,
      ),
      chatPanel: loungeState.current ? chatPanel(loungeState.current, rerender) : null,
    }));
```

- [ ] **Step 6: Add CSS for `.table-room` and `.table-rail`**

In `apps/web/src/styles.css`, right after the `.table-cross` block added in Task 2:

```css
/* Desktop: cross + rail side by side. Collapses in Task 6's mobile pass. */
.table-room { display: grid; grid-template-columns: 1fr 300px; gap: 16px; align-items: start; }
.table-rail { display: grid; gap: 12px; }
.standings { display: grid; gap: 6px; margin-top: 4px; }
.standing-row { display: flex; justify-content: space-between; align-items: center; font-size: 13.5px; }
.standing-row .seat-score { font-size: 15px; }
```

- [ ] **Step 7: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 8: Verify live — chat visible and functional during play**

Using the dev server and a real seated account: confirm the rail renders to the right of the cross with chat, watchers (if anyone's spectating), and standings. Send a chat message from *within the table view* and confirm it appears — then open the same lounge in a second browser context (or a second real account) *not* seated at this table, confirm the message arrives there too (same channel, not a second one, per the spec's testing section). Confirm your typed-but-unsent draft in the table view's chat box survives an incoming move/re-render (same draft-preservation rule as Task 4, now exercised from inside a live hand instead of the lounge room).

- [ ] **Step 9: Verify live — chat is absent, not broken, when there's no lounge context**

Attach to a table directly by join code without visiting its lounge first (if reachable in the current build), or inspect that `chatPanel: null` renders no chat section and nothing else in the rail breaks.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/onlinetableview.ts apps/web/src/loungeview.ts apps/web/src/styles.css
git commit -m "feat: chat, watchers, and standings stay visible in a side rail during play"
```

---

### Task 6: Mobile — felt first, compact seat strip, tabbed rail

**Files:**
- Modify: `apps/web/src/onlinetableview.ts` (tab state for the rail)
- Modify: `apps/web/src/styles.css` (the `@media (max-width: 700px)` block)

**Interfaces:**
- Consumes: `.table-room`/`.table-cross`/`.table-rail`/`.seat-slot-*` from Tasks 2 and 5.
- Produces: nothing new consumed elsewhere — this is the last structural task.

- [ ] **Step 1: Add rail-tab state and tab buttons**

In `apps/web/src/onlinetableview.ts`, add module-level state near the other module-level UI state (e.g. next to `reportOpenFor`):

```typescript
// Mobile only — desktop shows all three rail sections at once (Task 5's
// .table-rail), a phone shows one at a time behind tabs. Module state, not
// per-render, so the choice survives a re-render the same way reportOpenFor
// and the chat draft already do.
let activeRailTab: 'chat' | 'watchers' | 'standings' = 'chat';
```

In the rail-building code from Task 5, wrap the three sections with visibility classes and add a tab strip above them:

```typescript
  const rail = el('div', 'table-rail');

  const tabs = el('div', 'rail-tabs');
  const tabDefs: { id: typeof activeRailTab; label: string }[] = [
    { id: 'chat', label: 'Chat' },
    { id: 'watchers', label: 'Watching' },
    { id: 'standings', label: 'Standings' },
  ];
  for (const { id, label } of tabDefs) {
    const btn = document.createElement('button');
    btn.className = 'rail-tab' + (activeRailTab === id ? ' active' : '');
    btn.textContent = label;
    btn.onclick = () => { activeRailTab = id; rerender(); };
    tabs.appendChild(btn);
  }
  rail.appendChild(tabs);

  if (social?.chatPanel) {
    social.chatPanel.classList.add('rail-section', 'rail-section-chat');
    social.chatPanel.classList.toggle('rail-section-active', activeRailTab === 'chat');
    rail.appendChild(social.chatPanel);
  }
  const crowd = watchersPanel(game, social);
  if (crowd) {
    crowd.classList.add('rail-section', 'rail-section-watchers');
    crowd.classList.toggle('rail-section-active', activeRailTab === 'watchers');
    rail.appendChild(crowd);
  }
  const standings = standingsPanel(game);
  standings.classList.add('rail-section', 'rail-section-standings');
  standings.classList.toggle('rail-section-active', activeRailTab === 'standings');
  rail.appendChild(standings);
```

This replaces the plain `if (social?.chatPanel) rail.appendChild(social.chatPanel);` / `if (crowd) rail.appendChild(crowd);` / `rail.appendChild(standingsPanel(game));` lines Task 5 added — same three sections, now tagged with tab-related classes. On desktop (Task 5's CSS), `.rail-tabs` and the active-state classes are simply not used by any selector, so nothing visually changes above 700px until Step 3 below adds the mobile-only rules.

- [ ] **Step 2: Add the compact mobile seat card variant — CSS only, same markup**

The mobile seat strip reuses the exact same `.seat` DOM `seatCard()` already produces (Task 2) — no second render path. Add to `apps/web/src/styles.css`, inside a new `@media (max-width: 700px)` block (create one if none exists yet for this section; check whether `.room`'s existing `@media (max-width: 700px) { .room { grid-template-columns: 1fr; } }` block can be extended rather than duplicated):

```css
@media (max-width: 700px) {
  .table-room { grid-template-columns: 1fr; }

  /* Board first, uncontested — the spec's top priority for mobile. */
  .table-cross {
    grid-template-columns: repeat(4, 1fr);
    grid-template-areas:
      "felt felt felt felt"
      "bottom left right top";
  }
  .felt-slot { min-height: 0; }

  /* Compact horizontal strip: all seats in one glance, no tall cards. */
  .seat-slot-top, .seat-slot-left, .seat-slot-right, .seat-slot-bottom {
    min-width: 0;
  }
  .table-cross .seat {
    display: flex; align-items: center; gap: 6px;
    padding: 6px 8px;
  }
  .table-cross .seat .who { flex-direction: row; align-items: center; gap: 4px; }
  .table-cross .seat .avatar { width: 22px; height: 22px; }
  .table-cross .seat h3 { font-size: 11px; }
  .table-cross .seat .meta { display: none; }
  .table-cross .seat .backs { display: none; }
  .table-cross .seat .origin-yardie, .table-cross .seat .origin-foreign { display: none; }
  .table-cross .seat .seat-score { font-size: 13px; margin-top: 0; margin-left: auto; }
  .table-cross .seat .report { display: none; }

  /* Rail becomes tabs: one section visible at a time. */
  .rail-tabs { display: flex; gap: 6px; margin-bottom: 8px; }
  .rail-tab {
    flex: 1; padding: 8px; border-radius: var(--r);
    border: 1px solid rgba(90, 58, 30, 0.28); background: var(--sand-hi);
    font-family: var(--body); font-weight: 700; font-size: 12.5px;
  }
  .rail-tab.active { background: var(--gold); border-color: var(--gold-deep); }
  .rail-section { display: none; }
  .rail-section-active { display: block; }
}
```

- [ ] **Step 3: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 4: Verify live at 390×844 — board is the dominant element**

Resize the Playwright browser (or use `browser_resize`) to 390×844, load a live 4-seat table. Confirm: the felt renders full-width near the top of the screen, all four seats are visible in a compact single row below it without vertical scrolling to see them, and the report button/origin badge/tile-backs are hidden (not broken — just hidden per the CSS above, since a phone-width seat chip has no room for them; they remain available on desktop).

- [ ] **Step 5: Verify live at 390×844 — rail tabs switch correctly**

Tap "Chat", confirm the chat panel is the only rail section visible and the input is usable; tap "Standings", confirm chat disappears and standings appears; tap "Watching" (with at least one spectator present, or confirm the tab is simply inert/hidden per `watchersPanel`'s existing "return null when nobody is watching" behavior — check which happens and that it's not broken either way).

- [ ] **Step 6: Verify live at a wide desktop width — nothing from the mobile CSS leaks**

Resize back above 700px, confirm the rail shows all three sections simultaneously with no tab strip visible, and seat cards are back to their full desktop size (avatar 32px, tile count and origin badge visible).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/onlinetableview.ts apps/web/src/styles.css
git commit -m "feat: mobile table layout — board first, compact seat strip, tabbed rail"
```

---

### Task 7: The luxury pass — wood frame, turn glow, bigger photos, rail card treatment

**Files:**
- Modify: `apps/web/src/styles.css` (`.table-felt`, `.seat.turn`, `.avatar` sizing in the cross, `.table-rail .panel`)

**Interfaces:**
- Consumes: everything from Tasks 2, 5, 6. This task only adds/adjusts CSS declarations — no new markup, no new TypeScript.

- [ ] **Step 1: Thicker wood-grain felt frame**

In `apps/web/src/styles.css`, the current `.table-felt` rule has:

```css
  border: 6px solid var(--felt-rim);
```

Change to a gradient wood-grain border, matching the treatment already used for `.backs i` and other wood-trim elements elsewhere in the file:

```css
  border: 10px solid transparent;
  border-image: linear-gradient(160deg, var(--wood-hi), var(--wood)) 1;
```

- [ ] **Step 2: Stronger turn glow**

Find `.seat.turn` (added in the original seating section, still present after Task 2's edits):

```css
.seat.turn { border-color: var(--gold); box-shadow: 0 0 0 1px var(--gold) inset; }
```

Change to:

```css
.seat.turn {
  border-color: var(--gold);
  box-shadow: 0 0 0 2px var(--gold) inset, 0 0 16px 2px rgba(224, 164, 0, 0.45);
}
```

- [ ] **Step 3: Bigger seat photos in the desktop cross (not the mobile strip)**

Add, right after the `.table-cross` block from Task 2:

```css
.table-cross .seat .avatar { width: 44px; height: 44px; }
```

(This is overridden back down to 22px by Task 6's `@media (max-width: 700px)` block, which is correct — bigger photos are a desktop-space luxury; the mobile strip is deliberately compact.)

- [ ] **Step 4: Rail panels get the standard card treatment**

Check whether `.table-rail .panel` already inherits the full `.panel` treatment (gradient, bottom border, shadow) from the base `.panel` rule — it should, since `chatPanel()`, `watchersPanel()`, and `standingsPanel()` all build their root element via `el('div', 'panel')`. If a visual check in Step 6 shows the rail looks flatter than the rest of the app (e.g. because `.table-rail`'s `display: grid` or `gap` is somehow suppressing the shadow), add:

```css
.table-rail .panel { margin: 0; }
```

only if needed to fix a real visual issue found in Step 6 — do not add speculative CSS here without first seeing the problem live.

- [ ] **Step 5: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 6: Verify live — screenshot comparison**

At a wide desktop width, screenshot the live table view before and after this task's changes (or compare against a screenshot taken at the end of Task 5). Confirm: the felt's frame reads as wood, not a flat border; the current player's seat has a visible warm glow, not just a thin outline; seat photos are noticeably more present than before; the rail panels look like the same "card" material as every other panel in the app, not a bolted-on sidebar.

- [ ] **Step 7: Verify live — mobile still looks intentional, not just smaller**

At 390×844, confirm the mobile seat strip's smaller photos and the felt's new wood frame both still read cleanly at that size — a 10px border-image on a narrow phone screen should not visually overwhelm a seat chip; if it does, reduce the mobile-width border back down inside the existing `@media (max-width: 700px)` block from Task 6.

- [ ] **Step 8: Run everything one final time**

Run: `npm test && npm run typecheck && npm run build`
Expected: PASS, all green.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/styles.css
git commit -m "feat: luxury material pass — wood-framed felt, turn glow, bigger photos"
```
