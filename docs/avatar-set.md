# YaadDominoes avatar collection

The collection is twenty-four Jamaican human portraits plus one optional
accessory layer, chosen quickly from the profile editor. This creates 264 clear
looks (24 faces × eleven accessory states, including none) without turning setup into a
complicated face builder. The set reflects Jamaica's Out of Many, One People
identity through varied age, gender presentation, skin tone, hair, and
background without turning anyone into a costume.

## Art direction

- Premium 2D editorial portrait illustration with confident warm-black lines.
- Signal-blue circular backdrop, consistent head scale, readable at 32–64px.
- Contemporary Jamaican people rather than domino bodies or tourist imagery.
- Natural brown skin tones; Kingston Signal colors appear only as accents.
- No flags or text embedded in the portrait artwork or its backdrop; small
  optional flag pins are separate local wearables. No casino imagery,
  caricature, or photorealism.

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
| `harold` | Silver hair and kind eyes |
| `mei` | Silver bob and round glasses |
| `imani` | Late-teen, curly puff and bright yellow top |
| `tariq` | Late-teen, curly fade and green hoodie |

The original ids remain stable so existing profile rows keep working. Migration
`0044_avatar_collection_expansion.sql` extends the database constraint for the
first eight additional ids; `0046_avatar_collection_diversity.sql` extends it
for these four. Apply both before deploying a client that lets players save
those choices.

Store an id, never a URL. `apps/web/public/avatars/<id>.webp` is the only
rendering path; the database check prevents arbitrary remote-image tracking.

## Accessory layer

The optional ids are `shades`, `crown`, `flower`, `headphones`, `flagpin`
(Jamaica), `canadapin`, `ukpin`, `bandana`, `beanie`, and `necklace`. They
render from small transparent SVGs in `apps/web/public/accessories/`. Each is
placed as a wearable—at the eye line, hairline, temple, ears, or neckline—not
as a generic badge. Table-size variants stay wholly within the portrait circle
so a cosmetic can never cover a playable domino. Migration
`0043_avatar_accessories.sql` adds the checked `profiles.avatar_accessory`
column and `0045_avatar_accessory_expansion.sql` extends its allowed values.
Apply both before enabling the new accessories in production.

## Duppy opponents

Duppies use five fixed, local 3D animated human portraits: `breeze`, `rally`,
`miss_mavis`, `tyrone`, and `auntie_vee`. They live only in
`apps/web/public/duppies/` and are never part of `Avatar`, the player picker,
or the database avatar constraint. A Duppy's visible level and seat select the
same portrait throughout a hand, replay, and coaching context. Duppies retain
their visible AI cue and never receive a person’s photo, accessories, camera,
online presence, or reactions.
