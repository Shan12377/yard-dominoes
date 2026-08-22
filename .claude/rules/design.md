# Design rules

The goal is not "a domino app that works." It is work that makes people ask who
designed it. Every decision below serves that.

## Direction: Kingston Signal

A modern Jamaican sound system translated into a domino interface. Deep signal
blue is the room; electric green is the playing surface; mango calls the
action; coral carries emotion; sky blue carries social connection; bone white
belongs primarily to the dominoes. The system takes its rhythm from hand-painted
dancehall signs and its geometry from speaker stacks and domino pips. It is
vibrant and culturally specific without turning the flag, palms, or tourist
scenery into a template.

## The trap to avoid

Flag colours slapped on flat UI with no craft behind them is the obvious move
and it looks cheap — JamDom already does green-and-gold-on-grey and it reads
as 2009. The fix is not to avoid the flag colours; it's to give them the same
material weight this app already put into the table and tiles: real warmth,
real texture, real thickness. The palette is Jamaican and unapologetically so;
the execution is what has to be expensive-looking.

Rule of thumb: **signal blue is the room, green is the table, mango is action,
coral is emotion, sky is social, and bone is the domino.** Do not drift back
to beige lifestyle branding, all-black casino rooms, or flag colours pasted
onto generic cards.

## Palette

```css
--sand:       #073B5C;  /* legacy token name; now the signal-blue room */
--sand-hi:    #0C4F73;  /* legacy token name; tonal blue panels */
--forest:     #00A859;  /* electric green table and active states */
--forest-hi:  #2DD46F;
--forest-lo:  #007A3E;
--wood:       #052B43;  /* legacy token name; sound-system frame */
--wood-hi:    #10698F;
--gold:       #FFC928;  /* mango action, scores and wins */
--gold-hi:    #FFE16A;
--gold-deep:  #FFC928;
--bone:       #FFF9EA;
--bone-shade: #DCCFAB;
--pip:        #17130F;
--ink:        #FFF9EA;
--muted:      #B9DCEB;
--blood:      #FF5A3C;  /* coral: bruk, passes and emotional warnings */
--sky:        #43C7F4;  /* social connection and secondary energy */
```

## Type

- **Display** — the local `Impact`/condensed fallback stack. Poster-weight and
  reads like a sound-system flyer without delaying paint for a font download.
- **Body** — the local rounded Avenir/system stack. Warm and highly readable.
- **Mono** — the local SF Mono/Menlo stack. Scores, counts, join codes, timers.
- **Signage** — the local Arial Black/heavy stack: the wordmark, the six-love celebration, and
  the headings on the front door (the hero and the cards a visitor sees before
  they sit down). It is a signage face and it stops at the table; live-game
  headings use the compact local display stack. Mixing competing display faces
  on one screen makes the product read as two different sites stacked together.

  Signage type is bright gold on deep signal blue and bone white on green. Keep it
  off pale surfaces where mango loses contrast.

Do not restore render-blocking web-font requests. The 2026-08-22 Lighthouse
baseline measured roughly 1.76 seconds of avoidable delay from Google Fonts.

Patois goes in the interface, not just the copy: pose, bruk, under love, count,
slam, sporting, duppy, bredrin. Never translate these into generic game words.

## Materials — where the craft lives

Flat rectangles are what makes an app look amateur. Four things carry this
design:

1. **The felt has texture.** A woven diagonal pattern at very low opacity, plus
   a vignette so the centre sits brightest — direct midday sun, not a bulb —
   and the edges fall away slightly.
2. **Tiles have thickness.** A 3–4px `--bone-shade` bottom edge and a tight
   dark shadow. They must read as objects lying on a surface, not as divs.
3. **The sound-system frame holds the felt.** A deep signal-blue rim with
   speaker/pip geometry makes the green read as YaadDominoes rather than casino
   baize. Brown wood remains an optional table theme, not the brand default.
4. **Light comes from above.** One bright, warm, direct source — noon sun, not
   a bulb. Gradients run top-light to bottom-dark, consistently, everywhere,
   including on the signal-blue room itself (a slight vignette keeps the
   content area from reading as a flat fill).
5. **Cards are objects too.** Panels get the same treatment as tiles: a
   top-light gradient, a slightly darker bottom border for thickness, and a
   soft warm shadow. A card that is one flat fill with a hairline border is
   the thing that makes a page look like 2009.
6. **No stock form controls, ever.** A `<select>` without `appearance: none`
   renders the operating system's chevron and focus ring, and that single
   detail undoes everything else on the page — it is the most dated thing we
   shipped and the first thing that read as the incumbent's site. Controls get
   our chevron, our border, our gold focus ring.

## Illustration

The house graphic language is sound-system geometry: speaker cones, cropped
pip circles, stacked rectangles, angled colour cuts, and hand-painted-sign
typographic rhythm. Keep the middle of a live table quiet. Geometry may occupy
corners and frames; palms, flags, scenery, and branding do not sit underneath
the playable chain.

## Motion

- **The slam** — the winning tile drops from above, lands hard, the felt shakes,
  a faint dust puff. This is the emotional peak of Jamaican dominoes and it
  should feel physical.
- **Six-love** — a gold sweep across the board, signage type at full width. Earn it:
  this fires once in ~37 hands, so it can afford to be enormous.
- **Bruk** — all six pips flare `--blood`, then go out together. The rule is the
  animation.
- Everything else stays quiet. Honour `prefers-reduced-motion`.

## Performance guardrails

- Load no render-blocking third-party fonts or scripts.
- Keep the landing domino chain as the responsive WebP asset with its SVG as
  the editable source. Do not rebuild it as a large DOM illustration.
- Keep optional global data requests and service-worker registration out of
  the critical first-paint path.
- Run Lighthouse against `npm run build` plus the production preview, not the
  Vite development server. Mobile Lighthouse is throttled and can vary between
  runs; report the measured result rather than rounding it.
- Preserve the main landmark, valid `robots.txt`, `llms.txt`, social metadata,
  and zero-layout-shift image dimensions.

## Avatars

The first player collection is twelve human Jamaican portraits. It must vary
age, skin tone, gender presentation, hair and accessories while staying one
cohesive editorial illustration system. Selection is intentionally quick: one
face plus at most one small local accessory layer. Deep facial customization
remains deferred.

The canonical inventory and generation source are in `docs/avatar-set.md`.
Production crops are 256px WebP files in `apps/web/public/avatars/`. Existing
ids are stable profile data and must not be renamed. Regenerate the whole sheet
if the style changes; never splice in one visibly different character.
Accessory SVGs live in `apps/web/public/accessories/`; they remain corner flair
so the same layer aligns across all faces and stays legible at seat-card size.

Seat backdrops are environmental atmosphere, not miniature game scenes. Keep
them people-free, tile-free and text-free, with a calm dark central-left zone
for the player label. The canonical five live in
`apps/web/public/backgrounds/`; use vivid Kingston Signal color rather than a
brown/cream or Jamaican-flag-only treatment.

Never use a real person's likeness for a generated avatar. Human players may
upload their own photo through the separate photo path.

## Teaching art — read this before generating anything

Most Academy lessons must **not** get a photograph. A lesson about what a pass
reveals needs a picture of a board, and an AI image of a board will get the
pips wrong. That is worse than no image.

So there are two kinds of lesson art:

**1. Board diagrams — rendered from the engine, not generated.**
For every rule and strategy lesson, build the actual position with the engine
and render it to SVG using the same tile components as the live table. They are
accurate by construction, restyle themselves when the palette changes, cost
nothing, and can be animated to show a sequence. This is the impressive part of
the build — an AI image cannot do it.

Write these as a `packages/engine`-driven script that emits SVG into
`apps/web/public/art/boards/`.

**2. Atmosphere — generated once, committed.**
Only for cultural framing: the yard at midday, the table, hands mid-slam,
a domino set on wood. Roughly six images, not thirty-four.

**Never call an image API at runtime.** Generation happens in a local script
(`npm run gen:art`) that writes files into `public/art/` which are then
committed. Runtime generation would be slow, expensive, non-deterministic, and
would put an API key in the client bundle.

Any image-generation key lives in `.env.local`, is used only by the script, and
is never prefixed `VITE_`.

Every image needs real `alt` text — Belt 1 is aimed at pre-readers using a
screen reader out loud.

## Responsive

Portrait phone is the primary target, not an afterthought. The board turns at
doubles, not at running out of room — a real domino line only bends where a
double is laid crosswise, and the layout follows that: each row runs in one
direction until a double (or a width safety cap) ends it, then drops one row
and reverses direction, boustrophedon-style, the way text wraps. This is
deliberately two-directional, not four — an earlier version let the path turn
any of four ways and it spiralled into itself on most real hands, hiding
tiles that landed in an already-used cell. The hand stays thumb-reachable at
the bottom; nothing important sits in the top third. Test at 390×844 before
anything wider — it has the tightest width, so turns happen soonest and are
easiest to see.

- **Board-first layout is settled.** Both practice and online play give the
  felt about 52% of a modern phone viewport, keep the player's hand directly
  beneath it, and compress all four seats into one comparison strip. Do not
  restore vertically stacked full-size seat cards on mobile.
- The social rail collapses below the board at widths up to 1100px. A permanent
  side rail is allowed only when the board still has genuinely generous space.
- The player's hand stays in one horizontal, scrollable row so larger hands do
  not wrap into a tall block or shrink the bones below comfortable tap size.
