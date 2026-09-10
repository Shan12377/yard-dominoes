# French Table Reference Prototype

This folder is an isolated geometry reference. It does not inherit visual
shortcuts from the production table. Bring code back to the app only after all
of these invariants pass in the browser.

## Non-negotiable layout rules

1. At 1440×900 and wider, the header, complete table, all four racks, played
   board, local hand, and turn control are visible at once. No page scrolling.
2. The wood table is a stable landscape rectangle, approximately 16:9. It may
   become shorter on a compact viewport, but never taller than the viewport.
3. Player racks live on the perimeter. They do not consume or overlap the
   central board zone.
4. The local hand stays on the lower rail and never touches the played board.
   The board zone has at least one full short-side of clear space above it.
5. Use the measured JamDom desktop proportions: a 1000×800 reference game
   surface, a 450×390 French board and 30×60 dominoes. Scale those three
   measurements together on larger desktop tables, with a 30px minimum short
   side. Opening hand, played board, doubles and backs use that exact physical
   size; gameplay may never trigger a recalculation. Doubles rotate; they do
   not change size.
6. French arms use the measured 450×390 coordinate route. Turns are properties
   of the route, never an excuse to resize the tiles.
7. Test the late-hand fixture with 25 played dominoes. It must remain wholly
   visible, connected, and separate from every rack and the local hand.
8. This prototype copies layout behavior—not JamDom branding, artwork, source
   code, or text. YaadDominoes remains visually its own product.

## Acceptance sizes

- 1440×900: complete late hand visible without document scrolling.
- 1024×768: complete late hand visible without document scrolling.
- Played domino short side: at least 30px and 3% of the desktop table width,
  capped at 60px; chosen once before rendering the hand.
- Local hand short side: exactly equal to the played domino short side.
- Board-to-hand clearance: at least 16px.
