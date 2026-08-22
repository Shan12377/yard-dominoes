# YaadDominoes avatar collection

The first collection is twelve Jamaican human portraits, chosen quickly from
the profile editor. Deep face customization is deliberately deferred. The set
varies age, gender presentation, skin tone, hair, accessories, and expression
without turning Jamaican identity into costume.

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
