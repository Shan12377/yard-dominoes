# Art direction — the template

**Every image made for Yard uses this. No exceptions without a decision to
change the template itself.**

The first reaction set failed because five images were made independently:
five lighting models, four backgrounds, three border styles, faces in two
different colours. Individually fine, together they read as clip art
collected from different places. A set is only a set if one template made all
of it — that is what this file exists to guarantee.

## The rules

1. **The character is a domino tile, never a smiley face.** Bone-white ivory
   body, softly rounded corners, a thin dark line across the middle, and
   pip-holes used as the eyes. The identity comes from the game's own object.
   A generic emoji with a Jamaican flag behind it is the templated answer —
   the flag is a background anyone can copy in an afternoon; a domino that
   *is* the character is not.
2. **Flat 2D vector only.** Thick confident outlines, bold simple shapes. No
   gradients, no gloss, no 3D rendering, no drop shadows, no photorealism,
   and never a photographic element (a real hand next to a cartoon face is
   the single most jarring thing you can do).
3. **Front-on, upright, centred**, filling about 85% of a square frame. No
   tilt, no rotation, no perspective, no lean.
4. **Solid flat forest green background** (`#146B3A`), edge to edge. Nothing
   else: no flag, no pattern, no scenery, no border.
   *Do not ask the image model for a transparent background.* It was tried
   three times and each time it made the tile body itself semi-transparent,
   so the felt showed straight through the domino. Solid green is reliable.
5. **Accents are gold (`#E0A400`) and warm black.** Nothing else.
6. **No text inside the image.** Ever. Captions are unreadable at the size
   these render, redundant when the interface already has a label, and they
   freeze the wording into a picture that then cannot be changed or
   translated. The words live in the UI.
7. **It must read at 64 pixels.** If detail disappears at that size, the
   detail was decoration. Check every image at its real size before accepting
   it — always look at the whole set side by side, never one at a time.

## Sizes

Reactions and icons ship at **128px WebP**, which lands around 2–3 KB each.
For comparison, one 2048px JPEG was 1.5–2.7 MB — roughly a thousand times the
weight for something displayed at a fiftieth of the size.

## The prompt

Paste this verbatim, then append one sentence describing the expression.

```
A single flat vector emoji-style character, perfectly centred and upright,
facing straight forward, filling 85% of a square frame. Straight-on front
view only: no tilt, no rotation, no perspective, no lean. The character IS a
domino tile standing upright: bone-white ivory body with softly rounded
corners, a thin dark dividing line across the middle, and pip-holes used as
facial features. Absolutely flat 2D vector art, thick confident outlines,
bold simple shapes, no gradients, no gloss, no 3D rendering, no drop shadows,
no photorealism, no human hands. Solid flat deep forest green background
(#146B3A) filling the whole square, no flag, no pattern, no scenery, no
border, no shadow. Accent colours limited to gold (#E0A400) and warm black.
Reads clearly at 64 pixels. NO text, NO letters, NO words, NO numbers
anywhere in the image. The expression is <DESCRIBE IT HERE>.
```

Generated with OpenAI `gpt-image-1` at 1024×1024, medium quality, then scaled
to 128px WebP.

## Reaction tiles — a second template, not a variant of the first

**The table-talk reactions (`REACTIONS` in `lounges.ts`) do NOT use the
character template above.** They were built to it in spirit but not in
practice, and this section exists because that gap caused real generation
failures when the set was extended — write it down once here rather than
rediscover it by trial and error again.

A reaction tile is a real domino tile, split by its own spine:

- **Top half:** a conventional flat cartoon face — eyebrows, eyes, a mouth —
  drawn as bold flat shapes. **Not** pip-holes standing in for eyes; that's
  the avatar template's trick, not this one's.
- **Bottom half:** a genuine domino pip count, arranged like a real domino
  face (1 through 6, or blank).
- Same cream body (`#FDF6E3`), thick dark ink outline (`#241608`), solid
  flat forest green background (`#146B3A`), flat 2D vector only — no
  gradients, no gloss, no 3D, no photorealism, no scenery. Same "reads at 64
  pixels, no text ever" rules as the character template.

**Two failure modes hit while extending this set, both worth naming so the
next attempt skips them:**

1. **The model defaults to a stray gold pip if gold is mentioned as an
   available accent at all**, even when told the exception is
   `six-love`-only. Fix: tell it gold may accent the FACE (an iris, a mouth
   highlight — this is what gives the set its warmth, see `tek-dat` and
   `hold-dat`), but state separately and explicitly that **pips are always
   solid black ink, no exceptions, full stop** — don't rely on "except X"
   phrasing, restate the pip rule as an unconditional default.
2. **A "blank" tile (no pips) reliably grows a soft glow/halo/vignette**
   around itself, as if the model is compensating for the empty space. Fix:
   explicitly rule out glow, halo, light bloom, vignette, and gradient by
   name in the same sentence that asks for a blank tile — don't assume "flat
   vector" earlier in the prompt is enough to suppress it.

Full working prompt, `scripts/gen_reactions.py`'s `BASE` plus a per-reaction
line describing the face and the pip count (or "blank"). Same
`gpt-image-1`, 1024×1024, medium quality, scaled to 128px WebP as the
character template — only the subject and the pip-colour rule differ.

New reaction names are Jamaican expressions picked to fill a real emotional
gap, never a translation of a generic emoticon-set label. If a competitor's
emoticon picker is ever used as a checklist again, borrow the *coverage*
(what emotions are missing), never the *names*.

## People in illustrations

Yard's illustrations must show **women at the table, playing and winning** —
not watching, not serving drinks, not decorative. Domino yards are read as
men's spaces and most reference imagery reflects that, so it will not happen
unless it is asked for explicitly every single time. Half the people in any
scene, and whoever is winning in at least half of them.

Also vary age and shade. The set should look like a real yard, which means
a grandmother taking money off a twenty-year-old is exactly the image to
reach for.

## When the template changes

Change it here, then regenerate **the whole set** — never one image against a
new rule while the rest sit on the old one. That is precisely how the first
set drifted.
