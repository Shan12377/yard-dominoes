# YaadDominoes brand system

This is the canonical brand handoff for designers, developers, and AI agents.
When an older plan, screenshot, or comment conflicts with this document, this
document and `.claude/rules/design.md` describe the current direction.

## Brand core

- **Product name:** YaadDominoes
- **Descriptor:** Jamaican Dominoes
- **Slogan:** **Beat di table.**
- **Design direction:** Kingston Signal
- **Personality:** vibrant, social, competitive, unmistakably Jamaican, clean
  enough that the board always remains the star
- **Promise:** authentic Jamaican dominoes, free to play, built for the phone

“Slam dem down” is retired. Yard appeared as a working product name in
historical files; do not mechanically rewrite those records.
YaadDominoes is the current product name and “Beat di table.” is its slogan.
Yaadmoji is a separate product and must never be used as an alias. Yard,
Yardie, Yard Gate, and duppy remain intentional in-world terms.

## Visual system

The visual language combines Kingston sound-system energy, hand-painted
dancehall-sign rhythm, and domino pip geometry. It must not fall back to a
generic Jamaican tourism template.

Core palette:

- Signal blue `#073B5C` — app shell and primary environmental color
- Deep blue `#052B43` — panels, table rim, and depth
- Electric green `#00A859` — felt, play states, and positive action
- Mango `#FFC928` — primary calls to action and score emphasis
- Coral `#FF5A3C` — emotion, urgency, and expressive accents
- Sky `#43C7F4` — social and informational accents
- Bone `#FFF9EA` — dominoes and high-contrast text
- Pip black `#17130F` — pips and dark text on bright actions

Avoid brown or cream as dominant surfaces. Avoid casino imagery, chips,
stakes, pots, alcohol, pasted-on flags, palm-tree wallpaper, faux-luxury gold,
and decorative detail that makes tiles harder to read.

## Logo

The canonical mark is `apps/web/public/art/yaaddominoes-mark.svg`. It combines a
domino with a sound-system speaker/pip motif. Use that file rather than tracing
or regenerating it. Keep clear space of at least one domino-pip diameter around
the mark. Never stretch it, recolor individual pips arbitrarily, or place it
over a busy photograph.

The product wordmark is the text “YaadDominoes” set in the display/signage type
defined by the web design system. In the standard two-color lockup, **Yaad is
mango (`#FFC928`) and Dominoes is bone (`#FFF9EA`)** on signal blue. Do not add
a space or allow either half to wrap. The standard lockup is mark + wordmark +
the small descriptor “Jamaican dominoes.”

## Product experience

- The board is the primary interface, especially on mobile.
- On a modern phone, reserve roughly half the viewport height for the felt;
  place the player's hand immediately beneath it and show four players as one
  compact comparison strip rather than four stacked cards.
- Collapse chat, watchers, standings, log, and profile tools below the board
  until the viewport is wider than 1100px.
- Preserve a quiet center lane so tiles remain instantly scannable.
- Put personality around the board—in the rim, transitions, reactions,
  avatars, and celebration—not underneath critical game information.
- Prefer one clear primary action per screen.
- Maintain strong contrast and minimum 44px touch targets.
- Live-hand UI must never be interrupted by a modal.

## Photography and generated imagery

People imagery is useful for marketing, onboarding, academy stories, and social
campaigns because it makes the social promise tangible. It is not a substitute
for showing the real game board and should not appear behind live tiles.

If generated imagery is used, show believable Jamaican social play: mixed
ages, natural expressions, hands and dominoes that are physically credible,
and contemporary homes, verandas, community spaces, or street-side tables.
Avoid caricature, costume-like flag colors, luxury-casino styling, distorted
hands/dominoes, and generic tropical-resort scenes. Do not present generated
people as real customers. A marketing sequence should normally lead with the
actual product, then use one human scene to communicate atmosphere.

Domino accuracy is a release requirement, not decorative latitude. A photo may
show only one connected played chain; adjoining values must match, doubles sit
crosswise, and every unplayed hand faces its owner so the camera and opponents
see only backs or edges. Never allow disconnected face-up rows, loose public
bones, or a rack whose pips face another player.

In a final-bone celebration, the celebrating player must have no rack and no
unplayed bones. Most bones belong in the connected table chain, while any
losing players still holding bones should have only small concealed hands.
The tabletop directly in front of the winner must be visibly bare between their
body/resting hand and the played chain; do not place another player's concealed
bones where they can be misread as the winner's hand.
Before approving a four-player scene, account for all four seats explicitly:
winner = zero bones; left loser = small hand directly under the left player's
hand; right loser = small hand directly beneath that player; far-right loser =
small hand beside that player. No losing hand may disappear during an edit.
Four-player partner scenes must show one player at each edge of a square table,
with partners/opponents physically opposite—not four people lined along one
side. In the canonical night scene, coral is directly across from blue, while
green is directly across from yellow. Visible table corners should separate all
four seats.
Keep a late-game chain compact and clearly centered with visible bare table
around it; no endpoint should aim toward, touch, or overhang a table edge.
The played chain must remain open with exactly two visibly separated ends. A
closed rectangle, ring, or loop reads as a locked board and can never represent
a player winning by laying the final bone.
Always rebuild marketing artwork from its clean source in one edit. Repeated
AI edits soften faces and texture; iterative derivatives are not production
masters. Export human photography at WebP quality 90 unless measurement shows
a smaller setting is visually indistinguishable.

## Source-of-truth files

- `docs/branding.md` — brand strategy and visual guardrails
- `.claude/rules/design.md` — implementation-specific design rules
- `apps/web/src/styles.css` — production design tokens and components
- `apps/web/public/art/yaaddominoes-mark.svg` — canonical logo mark
- `docs/memory.md` — settled decisions and project continuity
- `CLAUDE.md` and `AGENTS.md` — mandatory agent handoff instructions

## Production asset family

The shipped family is derived from the canonical SVG mark; do not regenerate
these files from an unrelated prompt or substitute Yaadmoji artwork.

- `apps/web/public/art/yaaddominoes-mark.svg` — master mark
- `apps/web/public/art/hero-domino-line.svg` — editable hero illustration
- `apps/web/public/art/hero-domino-line.webp` and
  `hero-domino-line-360.webp` — responsive production hero images
- `apps/web/public/icons/` — 32, 180, 192, 512 and maskable PWA icons
- `apps/web/public/icons/favicon.ico` and `safari-pinned-tab.svg` — browser and
  domain identity fallbacks
- `apps/web/public/icons/splash-*.png` — iOS launch screens
- `apps/web/public/yaaddominoes-social.png` — 1200×630 social card
- `apps/web/public/avatars/` — twelve 256px human portrait WebPs; source and
  inventory live in `docs/avatar-set.md`
- `apps/web/public/accessories/` — five composable local SVG flair layers;
  together with “none,” these turn the twelve portraits into 72 quick looks
- `apps/web/public/backgrounds/` — five people-free 480×320 seat atmospheres:
  Kingston midday, evening lights, rain on zinc, south coast, and corner shop.
  They use environmental color rather than extra figures or dominoes so hidden
  hands can never be confused with decorative art.
- `apps/web/public/marketing/` — three generated social-play scenes used only
  on marketing/onboarding surfaces, never behind a live board. Their domino
  arrangements were accuracy-corrected on 2026-08-22.

The hero must remain a static responsive image, not hundreds of pip DOM nodes.
That conversion materially improved mobile paint and main-thread performance.
On the first homepage render only, the complete connected line drops in,
rebounds and settles using transform/opacity. It does not replay during normal
rerenders or when returning from another section in the same page session.

## Motion and sound signature

- Ordinary tiles arrive quickly with a small bone-on-table settle and the
  recorded knock.
- A pass is communicated by the seat card and table voice, never color alone.
- The final domino remains in its legal board position while a visual clone
  rises toward the player, spins in the air, settles and shakes the felt. This
  is the one deliberately theatrical gameplay moment; it must never mutate or
  obscure the underlying game state.
- Six love gets the gold result banner and its own recorded sound.
- `prefers-reduced-motion` collapses all transforms and transitions without
  removing the state or result text.
