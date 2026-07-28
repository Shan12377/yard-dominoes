---
paths:
  - "apps/web/src/**"
  - "apps/web/public/**"
  - "apps/web/index.html"
---

# Design rules

The goal is not "a domino app that works." It is work that makes people ask who
designed it. Every decision below serves that.

## The trap to avoid

Flag colours slapped on flat UI is the obvious move and it looks cheap. JamDom
already does green-and-gold-on-grey and it reads as 2009. Jamaican identity here
comes from **materials and light**, not from painting things in flag colours:
a felt table under a bulb, bone tiles with real weight, gold that behaves like
metal. The palette is Jamaican; the execution is expensive-looking.

Rule of thumb: **green is a surface, gold is a highlight, black is the room.**
Gold is never a background. If more than roughly a tenth of the screen is gold,
it has stopped meaning anything.

## Palette

```css
--night:      #0A0D0A;  /* room. black with a green cast, never pure #000 */
--char:       #14180F;

--felt:       #0A5C2E;  /* the table. deeper and richer than flag green */
--felt-hi:    #0F7A3D;
--felt-lo:    #063F1F;

--wood:       #4A2A18;  /* table edge framing the felt */
--wood-hi:    #6B3E24;

--gold:       #FFC72C;  /* flag gold. score, wins, the one accent */
--gold-hi:    #FFE082;
--gold-deep:  #9A6E14;

--bone:       #F8F4E9;  /* tile face. warm ivory, never white */
--bone-shade: #DDD5C2;  /* tile bottom edge — this is what gives it thickness */
--pip:        #12100D;

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
   a vignette so the centre sits under the bulb and the edges fall away.
2. **Tiles have thickness.** A 3–4px `--bone-shade` bottom edge and a tight
   dark shadow. They must read as objects lying on a surface, not as divs.
3. **Wood frames the felt.** A grained border around the table, which is what
   makes the green read as a domino table rather than a CSS background.
4. **Light comes from above.** One warm source. Gradients run top-light to
   bottom-dark, consistently, everywhere.

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

Warm evening light, shallow depth of field, shot as portraits at a domino table
— not studio headshots, not smiling stock photos. Square, 512px, generated once
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
Only for cultural framing: the yard, the table under a bulb, hands mid-slam,
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
