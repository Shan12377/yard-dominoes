# Setup — Claude Code and the PWA

Two separate things in here. Part one gets Claude Code working properly on this
project. Part two gets the app onto people's phones.

---

# Part 1 — Claude Code

## What goes where

```
yard-dominoes/
├── CLAUDE.md                  ← loads every session (122 lines)
└── .claude/
    └── rules/
        ├── engine.md          ← loads when touching packages/engine/
        ├── supabase.md        ← loads when touching supabase/
        ├── client.md          ← loads when touching apps/web/src/
        └── pwa.md             ← loads when touching PWA files
```

Drop `CLAUDE.md` at the project root and the `.claude/` folder beside it. Commit
both — they're team documentation, not personal settings.

## Why it's split this way

Anthropic's guidance is to keep each CLAUDE.md under about 200 lines, because
the file loads into context at the start of every session and longer files
measurably reduce how reliably Claude follows them. A 400-line CLAUDE.md doesn't
just cost tokens — it buries the rules that matter.

So the root file holds only what's true everywhere: commands, the six
invariants, the Jamaican rules competitors get wrong, and the settled product
decisions. Everything else is a **path-scoped rule** — the `paths:` frontmatter
means `engine.md` only enters context when Claude actually opens a file under
`packages/engine/`. Working on the client? The engine's twelve trap cases aren't
in your context at all.

That's the difference between a document and working memory.

## Using it

You don't need to tell Claude to read CLAUDE.md — it loads automatically at
session start. Open the project folder in VS Code, start Claude Code from the
**project root** (not a subfolder), and it's already there.

Worth knowing:

| Command | What it does |
|---|---|
| `/context` | Shows which memory files actually loaded — check here first if something's being ignored |
| `/memory` | Opens CLAUDE.md and rules for editing |
| `/init` | Regenerates a starter CLAUDE.md; if one exists it suggests improvements rather than overwriting |

A good opening message for a fresh session:

> Read CLAUDE.md, then run npm test to confirm the engine is green before we
> start. I want to work on [X].

You don't strictly need the "read CLAUDE.md" part, but asking for the test run
means Claude starts from a known-good state instead of assuming.

## Keeping it useful

The rule for adding something: **if you correct Claude twice about the same
thing, write it down.** One bad session isn't a rule — that's how these files
fill up with exceptions nobody needs.

Ask yourself where it belongs. True everywhere → `CLAUDE.md`. True only for one
area → the matching file in `.claude/rules/`. A multi-step procedure → neither;
that's a skill.

Two things to watch:

- **Contradictions.** If two rules disagree, Claude picks one arbitrarily.
  Re-read the whole set after any significant change.
- **Staleness.** These files describe decisions, and decisions change. When you
  reverse one — say you decide to build French mode after all — delete the old
  rule rather than adding a caveat beside it.

Claude Code also keeps its own auto-memory of things it learns as it works.
That's separate from these files and lives outside the repo. `/memory` shows you
both.

---

# Part 2 — The PWA

You were right that PWA is the correct call. No app store means no 30% cut, no
review queue, no gambling-adjacent rejection risk, and you ship updates the
moment you push. The tradeoff is that installing is something you have to teach,
especially on iPhone.

## What's already built

- `public/manifest.webmanifest` — name, icons, standalone display, shortcuts
- `public/sw.js` — offline shell, never caches Supabase, never reloads mid-hand
- `public/icons/` — 192, 512, maskable, apple-touch, favicon, four iOS splashes
- `src/pwa.ts` — platform detection, install prompt, update handling
- `index.html` — manifest link, Apple meta tags, splash screens

## The install card

It appears above the lobby and never over a live hand. What it shows depends
entirely on the device:

**Android and desktop Chrome** get a real Install button. The browser fires
`beforeinstallprompt`, we suppress its own banner, and one tap does it.

**iPhone in Safari** gets the three steps written out:

> 1. Tap the Share button at the bottom of Safari
> 2. Scroll down and tap Add to Home Screen
> 3. Tap Add in the top right

Safari implements no install event, so there is no button to offer. Most people
have no idea the option exists — those three lines *are* the iOS install funnel,
and how clearly you present them is the whole conversion rate.

**iPhone in Chrome or Firefox** gets told to open Safari. Those browsers can't
add to the home screen at all, even though they're WebKit underneath. Showing
them Safari's steps would just be a dead end.

**Already installed** — the card doesn't render.

## iOS limits worth planning around

- Push notifications need iOS 16.4+ **and** the app already installed. You can't
  notify someone who only visited.
- No background sync.
- Cached storage can be evicted after prolonged disuse, so a returning player
  may need to sign in again. Nothing important is stored client-side.
- Without the `apple-touch-startup-image` links there's a white flash on launch.
  Four device sizes are covered; add more if you see complaints.

## Deploying

```bash
npm run build          # outputs apps/web/dist
```

On Vercel: root directory `apps/web`, build `npm run build`, output `dist`. Set
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as environment variables.

HTTPS is required for service workers, which Vercel gives you. `localhost` is
exempt, so `npm run dev` works locally — but a LAN IP won't.

## Testing it properly

Test on a real iPhone in real Safari. The simulator doesn't reproduce install
behaviour, storage eviction, or the way iOS silently kills WebSockets when a
page goes to the background.

Use `npm run build && npm run preview` rather than `dev` — dev mode doesn't
serve the service worker the same way.

Checklist:

- [ ] Install card appears in Safari on iPhone, with three steps
- [ ] Install button appears in Chrome on Android
- [ ] Nothing appears once installed
- [ ] Launches full screen from the home screen icon, no browser chrome
- [ ] Icon and name look right on the home screen
- [ ] Airplane mode: still loads and plays against duppies
- [ ] Update bar does not appear mid-hand

## When you ship an update

Bump `VERSION` in `public/sw.js`. The activate handler deletes every cache that
doesn't match, so forgetting means players keep running old assets.

The new version installs in the background and waits. Players see "A new version
of Yard is ready" and choose when to reload — and if they're mid-hand, the
button doesn't appear until the hand is finished. Reloading someone out of a
six-love run is not an acceptable way to ship a bug fix.
