# Mobile-first table information density — design spec

## Goal

Close the gap between what JamDom's live-table screenshot shows in one
glance (move history, per-player tile counts) and what Beat Di Table's live
table currently shows — without copying JamDom's desktop-only, everything-
crammed-in visual style, and with mobile as the primary case rather than a
deferred afterthought. This reverses an earlier framing in the same
conversation ("laptop first, mobile later") after the user pushed back:
mobile is this app's stated primary target per `design.md`, and nothing
here should treat it as secondary.

## Context

The live table (`apps/web/src/onlinetableview.ts`) already has a proven
mobile pattern from the 2026-08-01 table-layout redesign
(`docs/superpowers/specs/2026-08-01-table-layout-design.md`): a
`table-rail` with three tabs (Chat / Watching / Standings) that only exist
as tabs on mobile (`@media (max-width: 700px)`) — on desktop, `.rail-tabs`
is hidden and all three sections stack and show simultaneously. This spec
extends that existing, working pattern rather than inventing a new one.

Two things prompted this spec, both from the user comparing Beat Di
Table's live table to a JamDom screenshot:

1. JamDom shows a live, scrolling turn-by-turn log ("Turn #15 - Player 2
   PASSES!"). Beat Di Table has the underlying data
   (`game.hand.moveLog`, already synced from the server, already used by
   the Coach/local-review feature) but has never rendered it as a live
   panel during an online hand.
2. JamDom shows each player's remaining tile count as a row of blank
   domino tiles. Beat Di Table has this too (`backsEl()`,
   `apps/web/src/render.ts`) — already wired into both online and local
   play — but the mobile compact seat-strip CSS hides it outright
   (`.table-cross .seat .backs { display: none; }`) to save space. The
   tile-backs were resized larger on desktop in the same conversation
   (18×36px, up from 9×18px ticks) specifically because they read as too
   abstract at the old size — but that improvement is invisible on the
   primary device.

## Decisions made during brainstorming

Two things were explicitly considered and rejected, worth recording so a
future pass doesn't silently redo this work:

- **Photo/video shape stays circular, not square.** JamDom's square
  photo tiles are part of the "grid of grey boxes" look `design.md`
  names specifically as "the trap to avoid" when comparing this app to
  JamDom. Circular is the consistent treatment already used everywhere a
  photo/avatar appears (Edit profile's picker, the player profile card,
  roster lines, `.seat-video`) — switching only the seat-card instance to
  square would make the app look like two different products stitched
  together, for a closer resemblance to exactly the aesthetic this
  project has been deliberately moving away from.
- **No additional "Beat Di Table" branding inside the felt/table area.**
  JamDom bakes a logo into their game canvas because their live table is
  a detached window with no site chrome around it — nothing else on
  screen names the site. Beat Di Table is a normal web page with a
  persistent top nav bar (name + tagline) visible above every screen,
  including the live table, on every device. That gap JamDom is solving
  for doesn't exist here; adding a watermark would spend screen space
  this whole redesign is trying to protect, to solve a problem this app
  doesn't have.

## Design

### 1. Move log panel

A new `moveLogPanel(game: OnlineGame): HTMLElement` in
`onlinetableview.ts`, built from `game.hand.moveLog` (type `Move[]`,
already present on `OnlineGame`) plus `game.seats` for names. Newest
entry at the bottom, auto-scrolled into view on update — same pattern
`chatPanel` in `loungeview.ts` already uses for its own log.

**Formatting is a separate, pure, unit-testable function**, not inlined
into the DOM-building code:

```typescript
function describeMoveLine(move: Move, seats: SeatInfo[], mySeat: number | null): string
```

Rules:
- A play: `"<Name> played <tile>"`, e.g. `"Duppy 3 played 4-4"`.
- A pass: `"<Name> passed"`.
- The mover's own seat shows `"You"` instead of their name when
  `move.seat === mySeat`.
- In partner mode, the partner's seat shows `"Partner"` instead of their
  username — matches the existing convention in `scoreTrack`'s "You &
  partner" / "Them" labeling elsewhere on this same screen, so the log
  doesn't introduce a naming convention nothing else on the page uses.
- Every other seat shows its actual display name (username, or `Duppy N`
  for a bot seat, matching what seat cards already show).

Text only, no tile graphic — chosen explicitly over a richer version with
a small rendered tile next to each line, because each graphical line
would cost noticeably more vertical space on a short phone screen where
the log is competing with chat/watchers/standings for the same tab slot.

### 2. Wiring into the existing rail

`activeRailTab`'s type gains `'log'`, and `tabDefs` gains one entry:

```typescript
{ id: 'log', label: 'Log' }
```

`moveLogPanel(game)` gets the same `rail-section` / `rail-section-log`
class pair every other rail section already gets, toggled the same way:

```typescript
const log = moveLogPanel(game);
log.classList.add('rail-section', 'rail-section-log');
log.classList.toggle('rail-section-active', activeRailTab === 'log');
rail.appendChild(log);
```

No new CSS structure needed for desktop — the existing `.table-rail`
grid absorbs a 4th stacked panel the same way it already absorbs three.
Mobile gets the 4th tab for free from the existing `.rail-tabs` flex
row and `.rail-section` / `.rail-section-active` display toggle.

### 3. Tile-backs visible on mobile, smaller

`apps/web/src/styles.css`'s mobile media query currently has:

```css
.table-cross .seat .backs { display: none; }
```

Replaced with a smaller sizing rule instead of hiding, scaled down from
the desktop 18×36px (itself already scaled up from the original 9×18px
ticks) to fit the horizontal compact seat-strip row without breaking its
layout:

```css
.table-cross .seat .backs { gap: 2px; }
.table-cross .seat .backs i { width: 10px; height: 20px; }
```

`backsEl()` itself (`render.ts`) needs no change — this is a pure CSS
sizing override at the existing mobile breakpoint, same mechanism the
seat strip already uses to shrink the avatar (`.table-cross .seat
.avatar { width: 22px; height: 22px; }` at the same breakpoint).

## Testing

- `describeMoveLine()`: unit tests covering a play, a pass, the viewer's
  own move (`"You"`), a partner's move in partner mode (`"Partner"`),
  and an opponent's move (their actual name) — five cases, each a
  one-line assertion, no DOM involved.
- Tab wiring and mobile CSS: live-browser verification at both a desktop
  width and 390px (this app's stated primary test width per
  `design.md`), same as every other piece of the table-layout redesign
  has gotten — confirm the Log tab appears, switches correctly, and that
  tile-backs render (not hidden) and don't overflow the compact seat row
  at 390px.

## Out of scope

Already shipped in the same conversation, not touched by this spec:
bigger desktop tile-backs, the post-purchase account-securing prompt,
site-wide hands-played tracking (not yet displayed anywhere). Also out
of scope: any change to photo/video shape, and any new branding element
inside the table area — both explicitly decided against above.
