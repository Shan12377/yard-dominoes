# Avatar set — prompts

Uses the template in [art-direction.md](./art-direction.md) unchanged. Read
that file first; the rules there win, and nothing below overrides them.

Eight avatars. Enough that a full lounge does not look cloned, few enough to
lay side by side and actually check. Per the template's closing rule, if the
set ever changes, **regenerate all eight** — never one against a new rule
while seven sit on the old one. That is exactly how the first reaction set
drifted.

---

## The one rule that is specific to avatars

**Reactions vary by expression. Avatars vary by identity.**

An avatar sits on a seat for an entire set. A reaction is thrown and clears
itself. If the avatars are expressive, they read as reactions that got stuck,
and the player spends the first hand wondering why nobody's face is changing.

So every avatar below is **calm, settled, neutral, at rest**, and the thing
that tells them apart is what the character is wearing — drawn from a real
domino yard, not from a costume box.

### Do not put avatars on a different background

The template's forest green (`#146B3A`) stays. The temptation is to change it
so avatars don't look like reactions — don't. Distinguish them in the
interface instead, which costs no art and carries no risk of a mismatched set:

- **avatar** → circular crop, static, always present on the seat
- **reaction** → square chip, animates in, clears itself

Shape and behaviour separate them. Colour does not have to.

---

## The set

Half the set is women, and two are elders, because
[art-direction.md](./art-direction.md) is explicit that this does not happen
unless it is asked for every single time. The grandmother is in here on
purpose — she is the image that file specifically reaches for.

| id | file | who |
|---|---|---|
| `tam` | `tam.webp` | locs under a knitted tam |
| `wrap` | `wrap.webp` | gold head-wrap, tied high |
| `granny` | `granny.webp` | curlers and reading glasses — the one taking your money |
| `straw` | `straw.webp` | wide-brim yard hat |
| `hoops` | `hoops.webp` | hoop earrings, hair slicked back |
| `cap` | `cap.webp` | flat cap, gold tooth |
| `phones` | `phones.webp` | headphones — plays from foreign |
| `plain` | `plain.webp` | no accessory, thin gold rim |

`plain` is not filler. The requirement is *presence without a photo*, and some
players want presence without a character either. It is the default.

---

## Prompts

Paste the base block from [art-direction.md](./art-direction.md) verbatim,
then replace its final sentence with one line below.

**1 · `tam`**
> The character wears a knitted red, gold and green tam sitting high on its
> head with a few thick dark locs falling out beneath it, and its expression is
> calm and settled, at rest, neither smiling nor frowning.

**2 · `wrap`**
> The character wears a gold fabric head-wrap tied high in a knot above its
> head, and its expression is calm and settled, at rest, neither smiling nor
> frowning.

**3 · `granny`**
> The character is an elder wearing small round reading glasses low on its face
> and a few pink hair curlers above, and its expression is calm, patient and
> unimpressed, at rest, neither smiling nor frowning.

**4 · `straw`**
> The character wears a wide-brim woven straw yard hat with a warm black band,
> shading the top of its face, and its expression is calm and settled, at rest,
> neither smiling nor frowning.

**5 · `hoops`**
> The character wears large gold hoop earrings on each side with its dark hair
> slicked back flat, and its expression is calm and confident, at rest, neither
> smiling nor frowning.

**6 · `cap`**
> The character wears a warm black flat cap tilted slightly, with a single gold
> tooth showing, and its expression is calm and settled, at rest, neither
> smiling nor frowning.

**7 · `phones`**
> The character wears large warm black over-ear headphones with a gold band
> across the top of its head, and its expression is calm and settled, at rest,
> neither smiling nor frowning.

**8 · `plain`**
> The character wears nothing at all and carries only a thin gold outline
> around the edge of its body, and its expression is calm and settled, at rest,
> neither smiling nor frowning.

### Assembled example (`plain`, ready to paste)

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
anywhere in the image. The character wears nothing at all and carries only a
thin gold outline around the edge of its body, and its expression is calm and
settled, at rest, neither smiling nor frowning.
```

Generate at 1024×1024 with `gpt-image-1`, medium quality, then scale to
**128px WebP** into `apps/web/public/avatars/`. Expect 2–3 KB each, same as
the reactions.

---

## The representation problem, stated honestly

[art-direction.md](./art-direction.md) asks illustrations to vary age **and
shade**. Every avatar here is bone-white ivory, because the template says the
character is a domino tile and a domino tile has one colour. So this set varies
age and gender and does not vary shade at all.

Two ways out, and **this is Dr. Hunter's call, not an engineering one**:

1. **Accept it.** Nobody reads an ivory domino as a skin tone; the accessories
   carry the identity and the shade instruction was written for illustrations
   of people.
2. **Vary the body** — aged ivory, warm bone, cool bone across the set.

Recommend 1. Option 2 makes the tile body a proxy for skin, which is a heavier
thing to have accidentally built than it looks.

---

## Wiring it up

Two things that are easy to get wrong:

**Store an id, never a URL.** `profiles.avatar text check (avatar in ('tam',
'wrap', 'granny', 'straw', 'hoops', 'cap', 'phones', 'plain'))`, nullable. A
client-supplied URL in that column is an arbitrary-image hole — someone points
their avatar at a remote tracker, or worse, and every player who sees them at a
table loads it.

**This one *does* go in the grant list.** Unlike `is_host`, a player picks
their own avatar, so the next migration extends the `0012` column grant to six:
`username, flag, bio, origin, gender, avatar`. Verify afterwards that `tier`
still is not among them.

The profile editor built for Yardie/Foreign is where the picker goes — the
surface already exists, which is the whole reason that piece of work was worth
doing first.
