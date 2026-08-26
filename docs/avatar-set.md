# YaadDominoes avatar collection

The collection is twenty Jamaican human portraits plus one optional accessory
layer, chosen quickly from the profile editor. This creates 120 clear looks
(20 faces × six accessory states, including none) without turning setup into a
complicated face builder. The set reflects Jamaica's Out of Many, One People
identity through varied age, gender presentation, skin tone, hair, and
background without turning anyone into a costume.

## Art direction

- Premium 2D editorial portrait illustration with confident warm-black lines.
- Signal-blue circular backdrop, consistent head scale, readable at 32–64px.
- Contemporary Jamaican people rather than domino bodies or tourist imagery.
- Natural brown skin tones; Kingston Signal colors appear only as accents.
- No flags, text, casino imagery, caricature, or photorealism.

The complete generated source sheet is
`docs/art/yaaddominoes-avatar-sheet.png`. Production crops are 256px WebP files
in `apps/web/public/avatars/`. If the visual style changes, regenerate the
whole sheet rather than adding one mismatched portrait.

## Collection

| id | description |
|---|---|
| `hoops` | Bantu knots and gold hoops |
| `plain` | Close-cropped hair and beard |
| `granny` | Silver curls and reading glasses |
| `tam` | Short locs and knitted tam |
| `wrap` | Gold headwrap |
| `straw` | Straw yard hat |
| `phones` | High-top curls and headphones |
| `afro` | Natural afro and gold studs |
| `braids` | Long braids and coral bandana |
| `cap` | Grey beard and flat cap |
| `twists` | Short twists and clear glasses |
| `goldtooth` | Big laugh and gold tooth |
| `marigold` | Braided updo and gold hoops |
| `cedar` | Curly fade and full beard |
| `sonia` | Sleek hair and gold earrings |
| `devon` | Close-cropped hair and round glasses |
| `otis` | Silver beard and warm smile |
| `nadia` | Natural curls and bright smile |
| `kyro` | Short curls and stud earring |
| `levi` | Loose locs and kind eyes |

The original ids remain stable so existing profile rows keep working. Migration
`0044_avatar_collection_expansion.sql` extends the database constraint for the
eight additional ids. Apply it before deploying a client that lets players save
those choices.

Store an id, never a URL. `apps/web/public/avatars/<id>.webp` is the only
rendering path; the database check prevents arbitrary remote-image tracking.

## Accessory layer

The optional ids are `shades`, `crown`, `flower`, `headphones`, and `flagpin`.
They render from small transparent SVGs in `apps/web/public/accessories/` as a
corner flair over the portrait, so one asset works reliably across every face
and at 32px seat-card size. Migration `0043_avatar_accessories.sql` adds the
checked `profiles.avatar_accessory` column. Apply migrations 0042 and 0043
before setting `VITE_AVATAR_ACCESSORIES_DB=true`. With the flag off, flair is
stored as a local preference so the editor remains usable against the current
schema without breaking profiles or lounges; the shared seat-card layer turns
on only after the migration lands.

## Duppy opponents

Duppies use five fixed, local 3D animated human portraits: `breeze`, `rally`,
`miss_mavis`, `tyrone`, and `auntie_vee`. They live only in
`apps/web/public/duppies/` and are never part of `Avatar`, the player picker,
or the database avatar constraint. A Duppy's visible level and seat select the
same portrait throughout a hand, replay, and coaching context. Duppies retain
their visible AI cue and never receive a person’s photo, accessories, camera,
online presence, or reactions.
