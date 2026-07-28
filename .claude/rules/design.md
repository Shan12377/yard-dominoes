# Design rules

The goal is not "a domino app that works." It is work that makes people ask who
designed it. Every decision below serves that.

## Direction: Sunday Yard

Midday, not midnight. A concrete yard at noon — sun-bleached cream, not a dark
room under one bulb. This replaced an earlier night-room direction after
research into the actual visual language (the flag, dancehall/sound-system
culture, Caribbean branding broadly) showed it skews sun-drenched and loud,
not dim and moody. A dark felt table under a single bulb read as a high-end
poker lounge — competent, but not actually Jamaican.

## The trap to avoid

Flag colours slapped on flat UI with no craft behind them is the obvious move
and it looks cheap — JamDom already does green-and-gold-on-grey and it reads
as 2009. The fix is not to avoid the flag colours; it's to give them the same
material weight this app already put into the table and tiles: real warmth,
real texture, real thickness. The palette is Jamaican and unapologetically so;
the execution is what has to be expensive-looking.

Rule of thumb: **cream is the room, green is a surface, gold is a bold
accent, black is ink and nothing else.** Gold is used generously here —
score, primary actions, wins — but it is never the room itself, and it never
substitutes for the actual surface materials (felt, wood, bone).

## Palette

```css
--sand:       #FAF3E1;  /* the room. sun-bleached cream, never white, never dark */
--sand-hi:    #FFFBF0;  /* panels/cards sitting slightly above the room */

--forest:     #146B3A;  /* the table. flag green, full strength, not a hint of it */
--forest-hi:  #1C8449;
--forest-lo:  #0E4F2A;

--wood:       #5A3A1E;  /* table edge framing the felt */
--wood-hi:    #7A5230;

--gold:       #E0A400;  /* flag gold, deepened to hold contrast on cream */
--gold-hi:    #F4C430;
--gold-deep:  #8F6600;

--bone:       #FFFBF0;  /* tile face. warm ivory, brighter than the room so tiles read as objects on it */
--bone-shade: #D9CCA8;  /* tile bottom edge — this is what gives it thickness */
--pip:        #241608;

--ink:        #241608;  /* text. warm near-black. NEVER a background, NEVER the room */
--blood:      #C0392B;  /* bruk, and nothing else */
```

## Type

- **Display** — `Anton`. Condensed, poster-weight, reads like a sound-system
  flyer.
- **Body** — `Karla`. Warm, slightly quirky, not a default UI face.
- **Mono** — `IBM Plex Mono`. Scores, counts, join codes, timers.
- **`Bungee`** — reserved for the six-love celebration and the wordmark ONLY.
  It is a signage face; used anywhere else it becomes noise.

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
3. **Wood frames the felt.** A grained border around the table, which is what
   makes the green read as a domino table rather than a CSS background.
4. **Light comes from above.** One bright, warm, direct source — noon sun, not
   a bulb. Gradients run top-light to bottom-dark, consistently, everywhere,
   including on the cream room itself (a very slight vignette keeps the
   content area from reading as a flat fill).

## Motion

- **The slam** — the winning tile drops from above, lands hard, the felt shakes,
  a faint dust puff. This is the emotional peak of Jamaican dominoes and it
  should feel physical.
- **Six-love** — a gold sweep across the board, `Bungee` at full width. Earn it:
  this fires once in ~37 hands, so it can afford to be enormous.
- **Bruk** — all six pips flare `--blood`, then go out together. The rule is the
  animation.
- Everything else stays quiet. Honour `prefers-reduced-motion`.

## Avatars

Five, and they map to the five duppy tiers — this is deliberate, not decorative:

| Duppy | Character |
|---|---|
| Pickney | A youth, maybe 19, cap, learning the game |
| Yard | Working man in his 30s, relaxed, plays most evenings |
| Ranker | Woman in her 30s, confident, sharp-eyed, gold hoops |
| Don | Man in his 50s, hat, unreadable, been playing forty years |
| General | Elder woman, grey locs, the one nobody wants to sit across from |

Midday light, shallow depth of field, shot as portraits at a domino table —
not studio headshots, not smiling stock photos. Square, 512px, generated once
and committed to `public/avatars/`.

Never use a real person's likeness. Human players upload their own photo.

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

Portrait phone is the primary target, not an afterthought. The board wraps
into rows and grows downward instead of scrolling sideways, turning corners
the way a real table's board does once it runs out of room; the hand stays
thumb-reachable at the bottom; nothing important sits in the top third. Test
at 390×844 before anything wider.
