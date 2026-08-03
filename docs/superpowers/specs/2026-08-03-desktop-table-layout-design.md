# Desktop table layout — board + hand always visible — design spec

## Goal

Fix a real usability regression on the desktop live table: the felt board
renders narrower than the tile-line laid out inside it (forcing its own
horizontal scrollbar), and the player's own hand is a separate panel
stacked below the entire table, pushed off the bottom of the viewport.
Both together mean a player often cannot see the full board and their own
hand at the same time without scrolling in two directions — which defeats
the actual mechanic of the game, not just its polish. This is scoped to
**desktop only**; the mobile layout from
`docs/superpowers/specs/2026-08-02-mobile-first-table-info-design.md`
(felt-first, compact seat strip, tabbed rail) already satisfies the same
requirement on mobile and is untouched here.

## Root cause, verified against source

`render.ts`'s `feltBox()` computes the box the board's tile-line is laid
out inside from `window.innerWidth`/`window.innerHeight` directly — the
whole browser window, not the actual CSS grid cell the felt renders into.
On desktop, that cell is `.table-cross`'s `minmax(0, 3fr)` middle column,
which is narrower than the full window after `.table-room`'s 300px rail,
the two `minmax(120px, 1fr)` seat-slot columns, and grid gaps are
subtracted. `feltBox()` assumes far more width than the felt actually has,
lays the tile-line out too wide, and `.table-felt`'s `overflow: auto`
turns that overflow into a scrollbar instead of a clipped board.

`myHandPanel()` is a separate panel, appended to the page after
`.table-room` closes (end of `liveTableView()` in `onlinetableview.ts`) —
this is why it sits below the fold rather than beside or under the board.

## Decisions from brainstorming

- **The hand docks directly under the felt**, inside the same
  `.felt-slot` column, not beside it and not as a separate trailing panel.
  Felt on top, hand right below — both inside one vertically-stacked block
  sized to fit the viewport together.
- **Opponent seat cards (left/right) go compact**, matching the JamDom
  reference photo the user pointed at directly: small player-info blocks
  in the corners, board dominant. The columns shrink from
  `minmax(120px, 1fr)` to a fixed, narrow width — photo, name, tile-backs,
  nothing else — and the felt's `3fr` column absorbs the freed width.

## Design

### 1. `feltBox()` measures the real container, not the window

`render.ts`'s `BoardFit` interface gains an optional field:

```typescript
export interface BoardFit {
  maxUnits?: number;
  unit?: number;
  /** The real box to lay the line out inside, measured by the caller from
   *  the actual attached DOM element. Falls back to feltBox()'s
   *  window-based guess when omitted (main.ts's local play, the hero demo,
   *  and the very first render before layout has happened). */
  box?: BoardBox;
}
```

`renderBoard()`'s line-board branch changes from:

```typescript
const { u, placements } = chooseUnit(orientLine(board), feltBox(), opts);
```

to:

```typescript
const { u, placements } = chooseUnit(orientLine(board), opts.box ?? feltBox(), opts);
```

`onlinetableview.ts`'s board-rendering call measures the real felt element
after it's attached to the document (an unattached element's
`getBoundingClientRect()` is all zeros, so this cannot happen inline
during the synchronous DOM-build pass) via a `requestAnimationFrame`
callback — the same pattern this codebase already uses for chat
auto-scroll and the countdown timer, both of which need the real DOM
after attachment:

```typescript
renderBoard(line, game.hand?.board ?? null); // first pass: feltBox()'s guess
requestAnimationFrame(() => {
  const box = { width: felt.clientWidth - 32, height: felt.clientHeight - 32 };
  if (box.width > 0 && box.height > 0) {
    renderBoard(line, game.hand?.board ?? null, { box });
  }
});
```

The `-32` matches `CHROME_X`/`CHROME_Y`'s existing padding subtraction
convention (felt padding + line padding) rather than introducing a new
magic number.

### 2. Hand moves inside `.felt-slot`

Currently (`liveTableView()`, end of the function):

```typescript
frag.appendChild(room); // .table-room, contains .table-cross + .table-rail
// ... later ...
frag.appendChild(myHandPanel(game, rerender));
```

Changes to building the hand panel *before* the felt slot closes, and
appending it inside `.felt-slot` rather than to `frag` directly:

```typescript
const feltSlot = el('div', 'felt-slot');
feltSlot.appendChild(felt); // the existing .table-felt element
if (!game.isSpectator && game.hand) {
  feltSlot.appendChild(myHandPanel(game, rerender));
}
cross.appendChild(feltSlot);
```

The spectator/no-hand guards match what already exists at the call site
being moved — this is a relocation, not new logic. `partnerHandPanel`
(open-hand mode's partner-tiles-visible panel) stays where it already is,
outside `.table-room`, since it's a secondary readable-not-actionable
panel and the spec's requirement is specifically about the player's own
actionable hand, not every panel on the page.

### 3. Compact seat columns

`.table-cross`'s grid-template-columns:

```css
/* before */
grid-template-columns: minmax(120px, 1fr) minmax(0, 3fr) minmax(120px, 1fr);
/* after */
grid-template-columns: 96px minmax(0, 1fr) 96px;
```

96px fits a photo/avatar, name, and tile-backs at their existing sizes
(the desktop `.avatar` is already 44px) without wrapping awkwardly — this
is a fixed width, not a minmax, since these columns no longer need to
flex; all the flexible space now belongs to the felt.

## Testing

Live-browser verification at desktop width only (1280px+; mobile is
untouched and out of scope):
- The felt renders the full board with no internal horizontal scrollbar,
  across a range of board sizes (a fresh 4-tile opening through a longer
  mid-hand board).
- The player's own hand is visible on screen directly below the felt with
  no page scrolling required, at a typical desktop viewport height
  (900px).
- Opponent seat cards at the smaller 96px width still show photo/avatar,
  name, and tile-backs legibly, not clipped or overlapping.

## Out of scope

Mobile CSS (already correct per the 2026-08-02 spec). The rail's own
width/content (Chat/Watching/Standings/Log) — untouched, this spec only
redistributes width between the felt and the seat columns, not the rail.
