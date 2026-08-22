# YaadDominoes avatar collection

The first collection is twelve Jamaican human portraits plus one optional
accessory layer, chosen quickly from the profile editor. This creates 72 clear
looks (12 faces × six accessory states, including none) without turning setup
into a complicated face builder. The set varies age, gender presentation, skin
tone, hair, and expression without turning Jamaican identity into costume.

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

The original eight ids remain stable so existing profile rows keep working.
Migration `0042_avatar_collection.sql` extends the database constraint for the
four new ids. Apply that migration before deploying a client that lets players
save those four choices.

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
