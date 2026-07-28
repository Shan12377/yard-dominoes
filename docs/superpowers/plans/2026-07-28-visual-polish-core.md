# Visual Polish — Core Play Screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the app's actual palette, typography, and materials in line with `.claude/rules/design.md` (felt table, wood framing, real tile thickness, Anton display type, gold used sparingly), and fix the domino board so it turns corners like a real table instead of scrolling in one endless horizontal line.

**Architecture:** Everything lives in three files: `apps/web/src/styles.css` (palette, typography, every component's visual treatment, materials), `apps/web/index.html` (font loading), and `apps/web/src/render.ts` (`renderBoard()`'s layout algorithm, plus using the engine's own `PlacedTile.crosswise` field instead of recomputing it). No engine or backend files change. `Board.line`'s data shape (`packages/engine/src/types.ts`) is untouched — it's already physical left-to-right order, which is exactly what the new layout needs; this is a presentation-only change.

**Tech Stack:** Plain CSS (custom properties, CSS Grid), Vite, TypeScript, Google Fonts (Anton, Karla, IBM Plex Mono, Bungee).

## Global Constraints

- **Scope is the core play screens only.** Avatars, atmosphere images, and Academy lesson diagrams are explicitly out of this plan — do not touch `packages/engine/art/`, do not add any image-generation script, do not touch `academy.ts` or anything under `apps/web/public/art/`.
- **No engine changes.** `packages/engine/src/types.ts`'s `Board`/`PlacedTile` shape stays exactly as-is.
- **No client-side unit test runner** in `apps/web`. Test cycle per task is `npm run typecheck`, `npm run build`, and the concrete manual verification steps given in that task.
- **Gold is a highlight, never routine chrome.** Per `.claude/rules/design.md`: stays gold — lit score pips, the six-love sweep, `button.act` (the one primary action per screen), VIP-tier indicators, small positive-state dots (verify-ok, presence, "your side" label). Moves off gold onto bone/wood/muted tones — nav active state, eyebrow labels, chat usernames, belt numbers, non-VIP badges/gates, the install card, verify's neutral states.
- **Green is the table surface, not a status color.** `--felt`/`--felt-hi`/`--felt-lo` are reserved for `.table-felt` (the actual board). Nothing else uses them.
- **Portrait-first.** Every visual change gets checked at 390×844 before anything wider — this project's stated priority, and the board's row-wrapping specifically needs to be seen wrapping often at this width, not just scrolling.
- **Commit after every task**, `type: short description` style, no scope creep.

---

## Task 1: New palette, typography, and full component restyle

**Files:**
- Modify: `apps/web/index.html` (font loading)
- Modify: `apps/web/src/styles.css` (entire file)

**Interfaces:**
- Produces: the new CSS custom property set on `:root` — `--night`, `--char`, `--felt`, `--felt-hi`, `--felt-lo`, `--wood`, `--wood-hi`, `--gold`, `--gold-hi`, `--gold-deep`, `--bone`, `--bone-shade`, `--pip`, `--blood`, `--muted`, `--display`, `--body`, `--mono`, `--signage`. Also produces `.line`'s `grid-template-columns: repeat(var(--board-cols, 6), auto)` — the variable itself is set from JS in Task 2, not declared here; this file only references it with a static fallback.

- [ ] **Step 1: Swap font loading**

In `apps/web/index.html`, replace the Google Fonts `<link>`:

```html
<link
  href="https://fonts.googleapis.com/css2?family=Anton&family=Bungee&family=Karla:wght@400;600;800&family=IBM+Plex+Mono:wght@400;600&display=swap"
  rel="stylesheet" />
```

(This replaces the existing `Archivo+Black` family with `Anton` and adds `Bungee` — `Karla` and `IBM+Plex+Mono` stay as they were.)

- [ ] **Step 2: Replace the entire stylesheet**

Replace the full contents of `apps/web/src/styles.css` with:

```css
/* =============================================================================
   Yard — Jamaican Dominoes

   The palette comes from the game's own materials, not a UI kit: green felt
   under a warm bulb, bone tiles with real thickness, wood framing the table,
   gold that behaves like metal and appears only where it's earned. Green is
   the table surface and nothing else; gold is a highlight and nothing else.
   ========================================================================== */

:root {
  --night:      #0A0D0A;
  --char:       #14180F;

  --felt:       #0A5C2E;
  --felt-hi:    #0F7A3D;
  --felt-lo:    #063F1F;

  --wood:       #4A2A18;
  --wood-hi:    #6B3E24;

  --gold:       #FFC72C;
  --gold-hi:    #FFE082;
  --gold-deep:  #9A6E14;

  --bone:       #F8F4E9;
  --bone-shade: #DDD5C2;
  --pip:        #12100D;

  --blood:      #C0392B;

  --ink:   var(--bone);
  --muted: #9C9086;

  --display: 'Anton', system-ui, sans-serif;
  --body: 'Karla', system-ui, sans-serif;
  --mono: 'IBM Plex Mono', ui-monospace, monospace;
  --signage: 'Bungee', system-ui, sans-serif;

  --r: 6px;
  --gap: 12px;
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  min-height: 100%;
  background: var(--night);
  color: var(--ink);
  font-family: var(--body);
  -webkit-font-smoothing: antialiased;
  overscroll-behavior: none;
}

body {
  background-image:
    radial-gradient(120% 80% at 50% -10%, rgba(255, 199, 44, 0.08), transparent 60%),
    linear-gradient(var(--night), #050603);
  background-attachment: fixed;
}

#app {
  max-width: 940px; margin: 0 auto;
  /* Respect the notch and home indicator when running as an installed app. */
  padding: calc(20px + env(safe-area-inset-top)) calc(16px + env(safe-area-inset-right))
           calc(48px + env(safe-area-inset-bottom)) calc(16px + env(safe-area-inset-left));
}

h1, h2, h3 { font-family: var(--display); font-weight: 400; letter-spacing: 0.01em; margin: 0; }
h1 { font-size: clamp(28px, 6vw, 44px); line-height: 0.95; }
h2 { font-size: 20px; }
p { line-height: 1.55; }

.eyebrow {
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--muted);
}

.muted { color: var(--muted); }

/* ------------------------------------------------------------------ chrome */
.topbar {
  display: flex; align-items: baseline; justify-content: space-between;
  gap: 12px; margin-bottom: 20px; flex-wrap: wrap;
}
.brand { display: flex; align-items: baseline; gap: 10px; }
.brand h1 { font-family: var(--signage); font-size: 24px; }

.nav { display: flex; gap: 4px; }
.nav button {
  font-family: var(--mono); font-size: 12px; letter-spacing: 0.08em;
  text-transform: uppercase; background: none; border: 0;
  color: var(--muted); padding: 8px 10px; cursor: pointer; border-radius: var(--r);
}
.nav button[aria-current='true'] { color: var(--bone); background: rgba(248, 244, 233, 0.1); }
.nav button:hover:not([aria-current='true']) { color: var(--bone); }

/* ------------------------------------------------------------------- cards */
.panel {
  background: linear-gradient(180deg, var(--char), #0E1109);
  border: 1px solid rgba(74, 42, 24, 0.4);
  border-radius: var(--r);
  padding: 18px;
  margin-bottom: 16px;
}

.row { display: flex; gap: var(--gap); flex-wrap: wrap; align-items: center; }
.spread { display: flex; justify-content: space-between; align-items: center; gap: var(--gap); }
.stack { display: grid; gap: 10px; }

button.act {
  font-family: var(--body); font-weight: 800; font-size: 14px;
  letter-spacing: 0.02em;
  background: var(--gold); color: #241505; border: 0;
  padding: 11px 18px; border-radius: var(--r); cursor: pointer;
}
button.act:hover { filter: brightness(1.08); }
button.act:disabled { background: #4A4536; color: #8A8474; cursor: not-allowed; }
button.ghost {
  background: transparent; color: var(--bone);
  border: 1px solid rgba(248, 244, 233, 0.28);
}
button.ghost:hover { border-color: var(--gold); color: var(--gold); }

select, input {
  font-family: var(--body); font-size: 14px;
  background: var(--night); color: var(--ink);
  border: 1px solid rgba(248, 244, 233, 0.22);
  border-radius: var(--r); padding: 9px 11px;
}
label.field { display: grid; gap: 5px; font-size: 12px; color: var(--muted); }

/* ============================================================ score track ==
   The signature. Six love is six wins in a row while they stay on nothing, so
   the score IS six pips. They light gold one at a time, and when the run
   bruks they all go out together. The rule is the interface.
   ========================================================================= */
.scoreboard { display: flex; gap: 22px; align-items: center; flex-wrap: wrap; }
.side-score { display: grid; gap: 6px; }
.side-name {
  font-family: var(--mono); font-size: 11px;
  letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted);
}
.side-name.us { color: var(--gold); }
.pips { display: flex; gap: 5px; }
.pips i {
  width: 16px; height: 16px; border-radius: 50%;
  background: #1A1D16; border: 1px solid rgba(248, 244, 233, 0.16);
  transition: background 240ms ease, box-shadow 240ms ease, transform 240ms ease;
}
.pips i.lit {
  background: var(--gold);
  box-shadow: 0 0 12px rgba(255, 199, 44, 0.65);
  transform: scale(1.06);
}
.pips.bruk i { animation: bruk 420ms ease both; }
@keyframes bruk {
  0% { background: var(--blood); box-shadow: 0 0 14px rgba(192, 57, 43, 0.8); }
  100% { background: #1A1D16; box-shadow: none; }
}
.under-love { font-family: var(--mono); font-size: 11px; color: var(--muted); }

/* -------------------------------------------------------------- the board */
.table-felt {
  background:
    repeating-linear-gradient(115deg, rgba(255,255,255,0.035) 0 2px, transparent 2px 6px),
    radial-gradient(120% 90% at 50% -15%, rgba(255, 255, 255, 0.10), transparent 55%),
    linear-gradient(165deg, var(--felt-hi), var(--felt) 45%, var(--felt-lo));
  border: 6px solid var(--wood);
  border-image: linear-gradient(165deg, var(--wood-hi), var(--wood)) 1;
  border-radius: 10px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 18px 40px rgba(0,0,0,0.55);
  padding: 14px 12px;
  min-height: 96px;
  max-height: min(64vh, 560px);
  overflow-y: auto;
  display: flex; align-items: center;
  scrollbar-width: thin;
}

/* --board-cols is set inline by renderBoard() in render.ts (Task 2), computed
   from window.innerWidth at render time — not from a CSS media query. Board
   elements are built while still detached from the document (every view in
   this app constructs a fragment before appending it), and getComputedStyle
   on a detached element cannot resolve an ancestor's custom property, so the
   column count has to be pushed in from JS rather than read from CSS. The
   `6` here is only a fallback for the (never-hit-in-practice) case where
   something renders `.line` without going through renderBoard(). */
.line {
  display: grid;
  grid-template-columns: repeat(var(--board-cols, 6), auto);
  grid-auto-flow: row;
  align-items: center; justify-items: center;
  gap: 8px 2px;
  margin: auto;
  padding: 8px;
}
.line:empty { display: flex; }
.line:empty::after {
  content: 'Pose to open the board';
  font-family: var(--mono); font-size: 12px; color: rgba(248,244,233,0.35);
  margin: auto;
}

/* --------------------------------------------------------------- the tile */
.tile {
  --w: 30px; --h: 60px;
  width: var(--w); height: var(--h);
  background: linear-gradient(168deg, #FFFEFA, var(--bone) 42%, var(--bone) 78%);
  border-radius: 4px;
  box-shadow:
    0 4px 0 var(--bone-shade),
    0 6px 10px rgba(0,0,0,0.5);
  display: grid; grid-template-rows: 1fr 1px 1fr;
  padding: 3px; flex: none; position: relative;
}
.tile .bar { background: rgba(18,16,13,0.4); }
.tile.cross { transform: rotate(90deg); margin: 0 15px; }
.tile .half {
  display: grid; grid-template-columns: repeat(3, 1fr); grid-template-rows: repeat(3, 1fr);
  place-items: center; padding: 2px;
}
.tile .half b { width: 5px; height: 5px; border-radius: 50%; background: var(--pip); display: block; }

.hand { display: flex; gap: 6px; flex-wrap: wrap; padding: 4px 0; }
.hand .tile { --w: 38px; --h: 76px; cursor: pointer; transition: transform 140ms ease; }
.hand .tile.playable:hover { transform: translateY(-8px); }
.hand .tile.dead { opacity: 0.34; cursor: not-allowed; }
.hand .tile.chosen { outline: 2px solid var(--gold); outline-offset: 2px; transform: translateY(-8px); }

.slammed { animation: slam 320ms cubic-bezier(0.2, 0.9, 0.2, 1.2); }
@keyframes slam {
  0% { transform: translateY(-26px) scale(1.16); }
  60% { transform: translateY(2px) scale(0.97); }
  100% { transform: none; }
}
.table-felt.shake { animation: shake 260ms ease; }
@keyframes shake {
  0%,100% { transform: none; }
  25% { transform: translate(-2px, 1px) rotate(-0.25deg); }
  75% { transform: translate(2px, -1px) rotate(0.25deg); }
}

/* ---------------------------------------------------------------- seating */
.seats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
.seat {
  border: 1px solid rgba(248,244,233,0.12); border-radius: var(--r);
  padding: 10px 12px; background: rgba(0,0,0,0.2);
}
.seat.turn { border-color: var(--gold); box-shadow: 0 0 0 1px var(--gold) inset; }
.seat.partner { border-left: 3px solid var(--felt-hi); }
.seat h3 { font-size: 14px; font-family: var(--body); font-weight: 800; }
.seat .meta { font-family: var(--mono); font-size: 11px; color: var(--muted); }
.backs { display: flex; gap: 2px; margin-top: 6px; }
.backs i {
  width: 9px; height: 18px; border-radius: 2px;
  background: linear-gradient(160deg, var(--wood-hi), var(--wood));
  border: 1px solid rgba(0,0,0,0.4); display: block;
}
.passed { color: var(--blood); font-family: var(--mono); font-size: 11px; }

/* -------------------------------------------------------------- the coach */
.grade { font-family: var(--mono); font-size: 10px; letter-spacing: 0.1em;
  text-transform: uppercase; padding: 2px 7px; border-radius: 3px; }
.grade.best { background: var(--felt); color: #E7F7EC; }
.grade.fine { background: #2F4A3B; color: #DCEDE3; }
.grade.loose { background: var(--wood); color: #F0DFC9; }
.grade.blunder { background: var(--blood); color: #FBE7E3; }

.review-move {
  display: grid; grid-template-columns: auto auto 1fr; gap: 10px;
  align-items: start; padding: 10px 0;
  border-bottom: 1px solid rgba(248,244,233,0.08);
}
.review-move .ply { font-family: var(--mono); font-size: 11px; color: var(--muted); }
.review-move .note { font-size: 13px; line-height: 1.5; }
.review-move .lesson {
  font-family: var(--mono); font-size: 11px; color: var(--gold);
  background: none; border: 0; padding: 0; cursor: pointer; text-align: left;
}
.critical { border-left: 3px solid var(--gold); padding-left: 10px; }

.accuracy { font-family: var(--display); font-size: 40px; color: var(--gold); line-height: 1; }

/* -------------------------------------------------------------- fairness */
.verify {
  font-family: var(--mono); font-size: 11px;
  display: inline-flex; align-items: center; gap: 7px;
}
.verify .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--muted); }
.verify.ok .dot { background: var(--gold); box-shadow: 0 0 8px var(--gold); }
.verify.bad .dot { background: var(--blood); }
code.seed { font-family: var(--mono); font-size: 10px; color: var(--muted); word-break: break-all; }

/* --------------------------------------------------------------- academy */
.belt {
  border: 1px solid rgba(248,244,233,0.12); border-radius: var(--r);
  padding: 14px 16px; margin-bottom: 10px; background: rgba(0,0,0,0.18);
}
.belt .num {
  font-family: var(--display); font-size: 26px; color: var(--muted);
  line-height: 1; min-width: 34px;
}
.belt.open { border-color: var(--gold); }
.lesson { padding: 12px 0; border-top: 1px solid rgba(248,244,233,0.08); }
.lesson h3 { font-family: var(--body); font-weight: 800; font-size: 14px; margin-bottom: 4px; }
.lesson p { margin: 0; font-size: 13.5px; color: var(--bone-shade); }
.terms { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 7px; }
.terms span {
  font-family: var(--mono); font-size: 10px; letter-spacing: 0.06em;
  border: 1px solid rgba(248,244,233,0.2); color: var(--muted);
  padding: 2px 7px; border-radius: 99px;
}

.banner {
  padding: 12px 14px; border-radius: var(--r); font-size: 14px;
  border: 1px solid var(--wood-hi); background: rgba(74,42,24,0.2);
}
.banner.six-love {
  font-family: var(--signage); font-size: 22px; text-align: center;
  color: var(--gold); border-color: var(--gold);
  background: rgba(255,199,44,0.1);
  animation: flare 700ms ease;
}
@keyframes flare {
  from { transform: scale(0.94); opacity: 0; }
  to { transform: none; opacity: 1; }
}

@media (max-width: 560px) {
  .tile { --w: 26px; --h: 52px; }
  .hand .tile { --w: 34px; --h: 68px; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}

:focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }

/* ---------------------------------------------------------------- lounges */
.lounge-card {
  display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: center;
  border: 1px solid rgba(248,244,233,0.12); border-radius: var(--r);
  padding: 14px 16px; margin-bottom: 10px; background: rgba(0,0,0,0.18);
  cursor: pointer; transition: border-color 140ms ease;
}
.lounge-card:hover { border-color: var(--gold); }
.lounge-card.locked { opacity: 0.6; cursor: default; }
.lounge-card h3 { font-family: var(--body); font-weight: 800; font-size: 15px; }
.lounge-card .desc { font-size: 13px; color: var(--bone-shade); margin-top: 2px; }
.gate {
  font-family: var(--mono); font-size: 10px; letter-spacing: 0.1em;
  text-transform: uppercase; padding: 3px 8px; border-radius: 99px;
  border: 1px solid rgba(248,244,233,0.25); color: var(--muted);
}
.gate.vip { border-color: var(--gold); background: rgba(255,199,44,0.12); color: var(--gold); }

.room { display: grid; grid-template-columns: 1fr 240px; gap: 14px; }
@media (max-width: 700px) { .room { grid-template-columns: 1fr; } }

.chat-log {
  display: grid; gap: 8px; max-height: 340px; overflow-y: auto;
  padding-right: 6px; scrollbar-width: thin;
}
.chat-msg { font-size: 13.5px; line-height: 1.45; }
.chat-msg .who { font-family: var(--mono); font-size: 11px; color: var(--bone); margin-right: 6px; }
.chat-msg .when { font-family: var(--mono); font-size: 10px; color: var(--muted); margin-left: 6px; }
.chat-form { display: flex; gap: 8px; margin-top: 10px; }
.chat-form input { flex: 1; }

.roster { display: grid; gap: 6px; align-content: start; }
.roster .head { font-family: var(--mono); font-size: 11px; letter-spacing: 0.14em;
  text-transform: uppercase; color: var(--muted); }
.roster .person { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.roster .person .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--gold); }
.badge {
  font-family: var(--mono); font-size: 9px; letter-spacing: 0.08em;
  text-transform: uppercase; padding: 1px 6px; border-radius: 99px;
  border: 1px solid rgba(248,244,233,0.25); color: var(--muted);
}
.badge.yardie { border-color: var(--felt-hi); color: var(--felt-hi); }
.badge.vip { border-color: var(--gold); color: var(--gold); }

/* ------------------------------------------------------------------ tiers */
.tiers { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px; }
.tier-card {
  border: 1px solid rgba(248,244,233,0.14); border-radius: var(--r);
  padding: 16px; background: rgba(0,0,0,0.2); display: grid; gap: 10px;
  align-content: start;
}
.tier-card.vip { border-color: var(--gold); }
.tier-card .price { font-family: var(--display); font-size: 22px; color: var(--gold); }
.tier-card ul { margin: 0; padding-left: 18px; display: grid; gap: 5px; }
.tier-card li { font-size: 13px; color: var(--bone-shade); }
.offline-note {
  border: 1px dashed rgba(248,244,233,0.3); border-radius: var(--r);
  padding: 14px; font-size: 13.5px; color: var(--bone-shade);
}


/* ------------------------------------------------------------------ install */
.install-card {
  border: 1px solid var(--wood-hi); border-radius: var(--r);
  background: linear-gradient(rgba(74,42,24,0.25), rgba(74,42,24,0.08));
  padding: 16px; margin-bottom: 16px; display: grid; gap: 12px;
}
.install-card h2 { font-size: 18px; }
.steps { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }
.steps li { display: grid; grid-template-columns: 26px 1fr; gap: 10px; align-items: center; font-size: 14px; }
.steps .n {
  width: 24px; height: 24px; border-radius: 50%;
  display: grid; place-items: center;
  background: var(--gold); color: #241505;
  font-family: var(--mono); font-size: 12px; font-weight: 600;
}
.share-glyph { display: inline-block; vertical-align: -2px; margin: 0 2px; }
.dismiss {
  background: none; border: 0; color: var(--muted);
  font-family: var(--mono); font-size: 11px; cursor: pointer;
  justify-self: start; padding: 0; text-decoration: underline;
}
.update-bar {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  border: 1px solid rgba(248,244,233,0.25); border-radius: var(--r);
  padding: 10px 14px; margin-bottom: 14px; font-size: 13.5px;
}
```

Note what changed from the original beyond the variable renames, and why:

- `.panel` no longer uses the old wood-brown gradient (`--board`/`--grain` are gone) — it's now a neutral dark card (`--char` based) with a faint wood-toned border. Panels are chat cards, forms, stat blocks — "room furniture," not the table itself, so they don't get felt green.
- `.table-felt` now has an actual `border: 6px solid var(--wood)` plus a `border-image` gradient, replacing the old 1px hairline — this is the "wood frames the felt" material rule. It also picks up a diagonal weave texture and a radial highlight (light from above), and switches from `overflow-x: auto` (endless horizontal scroll) to `overflow-y: auto` with a `max-height` — this is required by Task 2's row-wrapping and is called out again there.
- `.tile`'s shadow changed from a flat single-color offset to a `--bone-shade` bottom edge plus a tighter contact shadow — the tile-thickness material rule.
- Gold is removed from: `.nav[aria-current]` (now a subtle bone-tinted background), `.eyebrow` (now muted), `.side-name.us` stays gold (a legitimate "your side" highlight, kept deliberately), `.chat-msg .who` (now bone, not gold), `.belt .num` (now muted), `.gate`/`.badge` default states (now muted, VIP variants keep gold), `.install-card` (now wood-toned, not gold-toned), `.terms span` (now muted-bordered). Gold stays on: `.pips.lit`, `button.act`, `.banner.six-love`, `.accuracy`, `.grade.best` uses felt not gold (a "good outcome" reasonably maps to the table-green family without diluting gold), `.tier-card.vip`/`.badge.vip`/`.gate.vip`, `.verify.ok`, `.roster .person .dot` (presence), `.seat.turn`, `:focus-visible`.
- `.badge.yardie` moved from the old `--green` (which was really just "amber's implicit opposite," not felt) to `--felt-hi` specifically — a deliberate, small, legitimate use of the felt-family color for a tier badge, distinct from the actual table surface.
- `h1`'s `letter-spacing` flipped from `-0.01em` to `0.01em` — Anton is already a tight, condensed face; the old negative tracking (tuned for Archivo Black) reads too cramped in Anton. `.brand h1` now uses `--signage` (Bungee) at a smaller size (24px) instead of `--display` at 26px — this is the one wordmark use case `design.md` names explicitly.

- [ ] **Step 3: Typecheck and build**

```bash
npm run typecheck && npm run build
```

Expected: clean. This task touches no TypeScript, so typecheck is really confirming nothing else broke; build should show the same two-chunk structure as before (`index` and `loungeview`), with `dist/assets/index-*.css` reflecting the new stylesheet's size (a few KB difference either way is fine — this isn't the bundle-splitting invariant, which is about JS chunking, not CSS size).

- [ ] **Step 4: Manual verification**

Run `npm run dev` and check, at 390×844 first:

1. Local play (`Play` tab): the topbar wordmark renders in Bungee, nav active state is a subtle bone highlight (not a gold pill), buttons for "Start table"/"Play"-equivalent primary actions are gold, panels are dark and neutral (not brown), the score track's lit pips are gold and the side label for "you" is gold.
2. A completed or in-progress local hand: tiles show a visible bone-shade bottom edge (thickness), the felt has a visible texture and is now green with a wood border framing it (not brown).
3. Lounges list: gate badges are muted/neutral except VIP-gated lounges, which stay gold.
4. Membership page: VIP tier card has the gold border and price; Guest/Yardie do not.
5. Trigger a six-love banner if practical (or inspect the `.banner.six-love` CSS directly) — confirm it uses Bungee.

Then spot-check the same set at 768×1024 and 1440×900 to confirm nothing broke going wider.

- [ ] **Step 5: Commit**

```bash
git add apps/web/index.html apps/web/src/styles.css
git commit -m "feat: restyle to the felt/wood/gold palette — Anton display type, materials, gold used sparingly"
```

---

## Task 2: Board corner-turning layout

**Files:**
- Modify: `apps/web/src/render.ts`
- Modify: `apps/web/src/main.ts` (remove one now-stale line — see Step 3)

**Interfaces:**
- Consumes: `PlacedTile.crosswise: boolean` (already exists on the engine's `Board` type — this task switches `renderBoard()` from recomputing crosswise-ness via `isDouble()` to using this field directly). `--board-cols` is a CSS custom property `.line` reads via `var(--board-cols, 6)` (already in place from Task 1) — this task is what actually sets it, from JS, not CSS.
- Produces: no new exported functions — `renderBoard()`'s existing signature (`(host: HTMLElement, board: Board | null) => void`) is unchanged, only its internal layout logic changes. Every existing caller (`main.ts`, `onlinetableview.ts`) keeps working with no changes on their end.

**Why this can't just read a CSS media query:** every view in this app builds its DOM as a detached fragment and appends it to the document only once fully built (`main.ts`'s `tableView()` and `onlinetableview.ts`'s `liveTableView()` both call `renderBoard(line, ...)` *before* `line` is appended anywhere — confirmed by reading both call sites). `getComputedStyle()` on a detached element can't resolve an ancestor's custom property, because there is no ancestor yet at that point. So the column count has to be computed from `window.innerWidth` directly in JS and pushed onto the element as an inline custom property — which the CSS `var(--board-cols, 6)` from Task 1 then picks up once the element is actually rendered, regardless of when it was set.

- [ ] **Step 1: Replace `renderBoard()`'s implementation**

In `apps/web/src/render.ts`, the current function is:

```ts
export function renderBoard(host: HTMLElement, board: Board | null) {
  host.innerHTML = '';
  if (!board) return;
  for (const placed of board.line) {
    host.appendChild(tileEl(placed.tile, { cross: isDouble(placed.tile) }));
  }
}
```

Replace it with:

```ts
/**
 * Real boards turn corners once they run out of table instead of scrolling
 * sideways forever. `.line` is a CSS Grid with a column count this function
 * sets directly (see the note on why it can't come from a CSS media query).
 * `board.line` is already physical left-to-right order (see `Board.line`'s
 * doc comment in packages/engine/src/types.ts) — a straight append would
 * just make one row that keeps growing sideways, which is the problem this
 * replaces. Every other row is reversed before appending, so DOM order still
 * matches the grid's natural fill order (top-to-bottom, left-to-right) while
 * the *visual* result reads as one continuous path that turns at the edge of
 * the table instead of jumping back to the left edge each wrap.
 */
function boardCols(): number {
  const w = window.innerWidth;
  if (w >= 900) return 12;
  if (w >= 640) return 9;
  return 6;
}

export function renderBoard(host: HTMLElement, board: Board | null) {
  host.innerHTML = '';
  host.style.setProperty('--board-cols', String(boardCols()));
  if (!board) return;

  const cols = boardCols();
  for (let i = 0; i < board.line.length; i += cols) {
    const row = board.line.slice(i, i + cols);
    const rowIndex = i / cols;
    const ordered = rowIndex % 2 === 0 ? row : row.slice().reverse();
    for (const placed of ordered) {
      host.appendChild(tileEl(placed.tile, { cross: placed.crosswise }));
    }
  }
}
```

(`boardCols()` is called twice — once unconditionally to set the CSS variable even when `board` is `null`, so the empty-state message in Task 1's `.line:empty` still sits inside a correctly-configured grid, and once inside the loop. This is intentional, not a mistake to dedupe away — the property needs to be set before the early return.)

- [ ] **Step 2: Drop the now-unused `isDouble` import**

At the top of `apps/web/src/render.ts`, change:

```ts
import { halves, isDouble } from '@yard/engine';
```

to:

```ts
import { halves } from '@yard/engine';
```

(`isDouble` is no longer called anywhere in this file — `placed.crosswise` replaces it. If `isDouble` is still used elsewhere in this file for a different purpose, check before removing the import; based on the file's current 94 lines, it is not.)

- [ ] **Step 3: Remove the now-stale horizontal-scroll centering in `main.ts`**

`apps/web/src/main.ts`'s `tableView()` function has this line, immediately after `frag.appendChild(felt);`:

```ts
requestAnimationFrame(() => { felt.scrollLeft = (felt.scrollWidth - felt.clientWidth) / 2; });
```

This centered the old single-row board's horizontal scroll position. `.table-felt` no longer scrolls horizontally (Task 1 changed it to `overflow-y: auto`), so this line is inert dead code now, not an active bug — but it's confusing to leave referencing behavior that no longer exists. Delete this line entirely. Confirm the surrounding code (the `felt`/`line` construction just above it) is otherwise untouched.

- [ ] **Step 4: Typecheck and build**

```bash
npm run typecheck && npm run build
```

Expected: clean. If `isDouble` was actually still needed elsewhere in `render.ts`, typecheck will fail loudly on the removed import — restore it in that case rather than guessing.

- [ ] **Step 5: Manual verification — this is the part with no existing precedent to compare against**

Run `npm run dev`. Since `boardCols()` reads `window.innerWidth` fresh on every call, and this app only re-renders on a state change (not on a bare window resize — resizing the browser alone won't trigger a re-render, matching how the rest of this codebase already behaves), **set the viewport size first, then take an action that triggers a render** (playing a tile, or reloading the page at that size) rather than resizing mid-game and expecting it to reflow live. This is a real, known limitation, not an oversight — flag it in your report but don't try to add a resize listener to fix it; that's out of scope for this plan.

At 390×844 (`boardCols()` returns 6, the smallest — wrapping happens soonest and is easiest to see), play a local hand out far enough to lay more than 6 tiles. Confirm:

1. After the 6th tile, the 7th tile starts a new row instead of continuing to scroll the first row horizontally.
2. The second row reads in the *opposite* direction from the first (if row one filled left-to-right, row two's tiles appear to continue from the right edge going left) — this is the boustrophedon pattern; it should look like one continuous path, not like the board reset to the left edge.
3. Crosswise doubles still render rotated 90° correctly within whichever row they land in.
4. `.table-felt` grows downward as rows accumulate rather than needing horizontal scrolling — confirm the `overflow-y: auto` / `max-height` from Task 1 kicks in only for a genuinely long hand (unlikely to hit in a quick manual test, but check the CSS is in place).
5. Reload at 768×1024 (`boardCols()` returns 9) and again at 1440×900 (`boardCols()` returns 12), and repeat: play enough tiles to exceed the row size at that width and confirm it still wraps correctly.

Record what you actually saw for each of the 5 checks — this is the one piece of this plan with no existing implementation to fall back on if something's subtly wrong.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/render.ts apps/web/src/main.ts
git commit -m "feat: board turns corners instead of scrolling one endless row"
```

---

## Task 3: Full verification pass across all play screens

**Files:** none (verification only — fix inline in whichever file if something's actually broken, per the note below)

**Interfaces:** none — this task consumes everything from Tasks 1 and 2.

- [ ] **Step 1: Build and typecheck one more time from a clean state**

```bash
npm run typecheck && npm run build && npm test
```

Expected: all clean. `npm test` (the engine's 59 tests) should be unaffected by this plan entirely — it's a sanity check that nothing in `render.ts` accidentally broke an engine import path.

- [ ] **Step 2: Portrait-first pass, 390×844, covering every play screen**

Using `npm run dev` with devtools' device toolbar set to exactly 390×844 (or a real phone), walk through:

1. **Local play**, start to finish: config screen, an active hand (play several tiles until the board wraps at least once, per Task 2's check), a blocked or dominoed finish, the coach review panel, the six-love/bruk animations if you can trigger them (or at minimum confirm the CSS is correct by inspection).
2. **Lounges**: the list, entering a lounge (chat + roster), the open-tables panel, starting or joining a table, a live hand on the online table (reuses the same `renderBoard()`/tile CSS as local play, so this mostly re-confirms Task 1/2 apply consistently rather than being a new surface).
3. **Membership**: all three tier cards.
4. **Academy**: the belt list only (lesson content/diagrams are out of scope for this plan, but the belt list itself uses `.belt`/`.lesson`/`.terms` classes touched in Task 1 — confirm those render correctly; do not touch lesson diagram content).

For each, confirm: no horizontal overflow/scrolling of the page itself (the board's own internal scroll, if it ever triggers, is fine — the page shouldn't scroll sideways), text is legible against the new backgrounds, buttons are reachable and have visible `:focus-visible` states, nothing renders using an old CSS variable name that no longer exists (this would show as a broken/transparent/black element — inspect via devtools if anything looks wrong).

- [ ] **Step 3: Spot-check wider**

Repeat a fast pass (not the full walkthrough) at 768×1024 and 1440×900, confirming nothing that worked at 390×844 broke going wider — particularly the `.room` two-column lounge layout and the tier cards' `auto-fit` grid.

- [ ] **Step 4: Fix anything genuinely broken**

If Step 2 or 3 finds a real visual bug (not a matter of taste — an actually broken layout, an invisible element, incorrect color), fix it directly in `styles.css` or `render.ts` as part of this task, matching the patterns already established in Tasks 1 and 2. Document what was found and fixed.

- [ ] **Step 5: Commit** (only if Step 4 produced changes — otherwise this task ends at Step 3 with nothing to commit)

```bash
git add apps/web/src/styles.css apps/web/src/render.ts
git commit -m "fix: visual polish verification fixes"
```
