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
- `apps/web/public/marketing/` — three generated social-play scenes used only
  on marketing/onboarding surfaces, never behind a live board

The hero must remain a static responsive image, not hundreds of pip DOM nodes.
That conversion materially improved mobile paint and main-thread performance.

## Motion and sound signature

- Ordinary tiles arrive quickly with a small bone-on-table settle and the
  recorded knock.
- A pass is communicated by the seat card and table voice, never color alone.
- The final domino drops, spins, settles and shakes the felt. This is the one
  deliberately theatrical gameplay moment.
- Six love gets the gold result banner and its own recorded sound.
- `prefers-reduced-motion` collapses all transforms and transitions without
  removing the state or result text.
