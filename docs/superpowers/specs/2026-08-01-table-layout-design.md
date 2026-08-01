# Table layout — seats surround the felt, a live rail beside it (design)

## Why

The user compared our live table screen against JamDom.com's — three
screenshots, two of JamDom's dense old table UI (player photo boxes at the
four corners, live per-seat stats, a scrolling move log, a players/ping/rank
list, and chat, all visible at once around a big central board) and one of
ours (seat cards stacked in a row *below* the felt, chat and the watchers
list not visible at all once you're actually seated and playing). Their
words: "same positioning as them are even bigger i want... ensure the other
things are able to go on the sides as well" — and, on the mobile tradeoff,
explicit delegation: "go with what will ensure the board is viewable and the
other things on mobile, do what you think is best... make it splash where
people feel luxury in the room."

`.claude/rules/design.md` is explicit that copying JamDom's actual look is
"the trap to avoid" — flag colours on a flat grey grid reads as 2009, and
this app's whole material language (felt texture, wood trim, top-light
gradients, tile thickness) exists specifically to not be that. So the thing
being borrowed here is JamDom's **information density and seating
geometry** — a board that reads as the centre of a real table with people
sitting around it, not their visual style. Nothing about palette,
typography, or the material model changes; this spec is layout only.

## Scope

**In:** `apps/web/src/onlinetableview.ts` (`liveTableView()` and the seat
card it builds), `apps/web/src/styles.css` (new grid rules for the seating
cross, the side rail, the mobile seat strip), wiring live chat and the
watchers list into the table view (both already exist — chat in
`loungeview.ts`'s lounge room, `watchersPanel()` already in
`onlinetableview.ts` — this reuses them, it does not build new
messaging/presence infrastructure).

**Out:**
- `apps/web/src/main.ts`'s `tableView()` for **local/offline play against
  duppies**. That screen has no chat, no other humans, and no watchers — the
  actual JamDom comparison (a room full of people) doesn't apply to it the
  same way. The seating-cross CSS and enriched seat card built here are
  written to be reusable, so bringing local play to visual parity later is a
  much smaller follow-up, but it is not part of this pass.
- Any new server data. Every stat shown here — score, points, who's
  connected, chat — is already sent to the client today; this is exclusively
  a layout and CSS change.
- Voice/video panels, reactions/quick-chat bars, the report button, the
  hand-result panel, the tournament round banner. These keep their current
  behaviour and get repositioned, not redesigned.

## Approach

### 1. The felt gets bigger and becomes the grid's centre

`feltBox()` in `render.ts` currently caps the board at `min(940, viewport) −
padding` wide and `min(64vh, 560px)` tall. Both caps go up — the felt is the
"spacious" element the user asked for, and on a wide screen it should read
as the obvious centre of gravity of the page, not one panel among several
stacked ones.

### 2. Seats surround the felt in a cross, not a row underneath it

New CSS grid, replacing today's `.seats { grid-template-columns:
repeat(auto-fit, minmax(150px, 1fr)) }` row:

```
              [ seat: top    ]
[ seat: left ][    FELT      ][ seat: right ]
              [ seat: bottom ]
```

Seats are assigned to a position by `seatIndex` relative to `mySeat`, not by
raw index — the player's own seat always anchors to the **bottom** position
(closest to the thumb, matching `client.md`'s existing "nothing important
sits in the top third" rule). The rest fill using the same seat-numbering
invariant CLAUDE.md already states — "seat+1 is the player to your physical
right... partners land opposite automatically":

- 4 seats: bottom = `mySeat`, right = `mySeat+1`, top = `mySeat+2`, left =
  `mySeat+3`. In partnered modes, top is always the partner — landing
  opposite falls out of the existing seat numbering for free, nothing
  partner-specific to compute.
- 3 seats: bottom = `mySeat`, right = `mySeat+1`, left = `mySeat+2`; top
  stays empty.
- 2 seats: bottom = `mySeat`, top = `mySeat+1` — facing off, not left/right,
  since a two-hander only has one other seat and "across the table" is what
  that reads as.

Spectators (no seat of their own) anchor on seat 0 at the bottom, since
there is no "me" to orient around.

### 3. A side rail, visible the whole time you're playing

To the right of the cross (widest breakpoint) sits a rail with three
sections, all built from things that already exist elsewhere and are wired
in here for the first time *during a live hand*:
- **Table talk** — the same chat log and input `loungeview.ts` already
  builds for the lounge room, rendered here too. The lounge's own copy stays
  where it is; this is the same underlying channel, not a second one.
- **Watchers** — `watchersPanel()` already exists in `onlinetableview.ts`
  but currently renders at the very bottom of the single-column stack, easy
  to miss. It moves into the rail.
- **Standings** — a compact score/points readout per seat, one line each,
  redundant with the seat cards' own score by design (JamDom's separate
  players/rank list is redundant with their corner boxes too) — the point is
  a glanceable summary that doesn't require finding the right corner.

### 4. Seat cards gain one line: score

Photo/avatar, name, and tile count are unchanged. Each card adds the seat's
current score/points (already computed, already sent — `game.scores` in
`onlinetable.ts` — just not shown per-seat today, only in the shared
scoreboard strip above the felt). This is the smallest version of "more
visible at once" that doesn't duplicate the standings rail's job of being a
quick side-by-side comparison.

### 5. Mobile (390px): board first, everything else one tap away, not stacked forever

A phone cannot show four sides of a board plus a side rail at once — this is
the real constraint the user acknowledged and asked me to resolve rather
than force. Resolution, in priority order matching "ensure the board is
viewable" first:

- The felt renders full-width at the top, as large as the viewport allows —
  the single most important thing on the screen, uncontested.
- Directly below it, a **compact horizontal seat strip** — small circular
  photo, name, tile count, score, one row, all seats visible without
  scrolling — replacing today's stacked full-width seat cards. This reads as
  "people around the table" in the same glance as the board, which a column
  of tall cards does not.
- The rail (chat / watchers / standings) becomes a **tab strip** below the
  seat row: three labelled tabs, one panel visible at a time, switched with
  a tap. It is reachable without leaving the table view or interrupting
  play — never a route change, never a modal (`client.md`'s "no modal
  during a live hand" holds here too) — just a section that swaps in place,
  the same rebuild-in-place pattern `render()` already uses everywhere.
- This collapse triggers at the same breakpoint the lounge's own `.room`
  grid already uses (`700px`), so the two-column-to-stacked behaviour is
  consistent across the app rather than inventing a second breakpoint
  convention.

### 6. "Make it splash" — the luxury pass

Threaded through the existing material language in `design.md`, not a new
one:
- The felt's frame (currently a flat 6px `--felt-rim` border) gets the same
  wood-grain treatment already used elsewhere (`--wood-hi`/`--wood`
  gradient), thicker, so the bigger board reads as an actual table object
  sitting in the room, not a rounded rectangle.
- Whoever's turn it is gets a stronger presence than today's thin gold
  border — a soft gold glow on their seat position (reusing `--gold-hi`,
  the same colour already used for the turn indicator, just more of it) —
  cheap to build, reads as the table paying attention to them.
- Seat photos/avatars render larger in the cross layout than today's 32px
  (more room now that they're not squeezed into a card row) — a bigger
  photo is itself part of "feeling like a real seat," independent of the
  stats next to it.
- The side rail's chat/watchers/standings panels get the same top-light
  card treatment (`design.md`'s "cards are objects too" — gradient, bottom
  shadow, soft warm shadow) the rest of the app already uses, so the rail
  doesn't read as a bolted-on sidebar.

No new colours, no new fonts, no new motion system — this is applying
existing, already-approved material rules more generously to a bigger
canvas, which is the actual ask.

## Testing

- Visual check at 390×844 (primary mobile target, per `design.md`) and at a
  wide desktop width, both with a full 4-seat table and a 2-seat table, since
  the seat-position math changes shape between them.
- Confirm chat, once wired into the live table view, still uses the same
  Realtime channel as the lounge room — no second subscription, no message
  duplication.
- Confirm the existing "chat draft survives a re-render" rule
  (`client.md`) still holds now that chat renders inside the table view's
  own render cycle, not only the lounge's.
- Confirm voice/video panels, reactions bar, and the report button on each
  seat still render and function inside the new seat card shape.
