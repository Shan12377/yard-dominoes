# Sunday Yard Palette Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the app's dark "black room" palette with the new "Sunday Yard" direction from `.claude/rules/design.md`: a sun-bleached cream room, the flag green and gold at full strength (not rationed to a dark-theme accent), black used only as ink. No structural or material technique changes — the felt texture, wood framing, tile thickness, and board corner-turning algorithm from the prior visual-polish build all stay; only the color values change.

**Architecture:** Everything lives in `apps/web/src/styles.css` — a full token and value replacement, same file structure as before. No HTML, TypeScript, or engine changes. No new CSS classes or selectors; every existing selector keeps its name and purpose, only its color values change.

**Tech Stack:** Plain CSS (custom properties). No new dependencies.

## Global Constraints

- **Scope is `apps/web/src/styles.css` only.** No other file changes in this plan.
- **A hard rule for every color decision, not just a preference:** gold used as a FILL (a button background, a lit pip, a small dot, a ring/outline/focus-visible) may stay bright (`--gold`/`--gold-hi`). Gold used as TEXT on the cream room or a cream-toned panel must use `--gold-deep` instead — bright gold text on a light cream background fails contrast; `--gold-deep` exists specifically for this case. Apply this rule to every selector that sets `color: var(--gold...)` in the current file — check each one individually, don't blanket-replace.
- **No pure grey.** Every neutral (muted text, unlit states, subtle borders) should read as warm — derived from `--ink`/`--wood`/`--muted`, never a flat grey hex.
- **No client-side unit test runner.** Test cycle is `npm run typecheck`, `npm run build`, and the manual verification steps in each task.
- **Portrait-first.** Checked at 390×844 before wider.
- **Commit after every task**, `type: short description` style, no scope creep.

---

## Task 1: Recolor to Sunday Yard

**Files:**
- Modify: `apps/web/src/styles.css` (entire file)

**Interfaces:**
- Produces: the new CSS custom property set on `:root` — `--sand`, `--sand-hi`, `--forest`, `--forest-hi`, `--forest-lo`, `--wood`, `--wood-hi`, `--gold`, `--gold-hi`, `--gold-deep`, `--bone`, `--bone-shade`, `--pip`, `--ink`, `--muted`, `--blood`. Font variables (`--display`, `--body`, `--mono`, `--signage`) are unchanged — no font swap in this plan, only color.

- [ ] **Step 1: Replace the entire stylesheet**

Replace the full contents of `apps/web/src/styles.css` with:

```css
/* =============================================================================
   Yard — Jamaican Dominoes

   Sunday Yard: midday, not midnight. A concrete yard at noon — sun-bleached
   cream, not a dark room under one bulb. Green and gold are full-strength
   surfaces here, not accents rationed to a dark theme; black is ink and
   nothing else — never the room, never a background.
   ========================================================================== */

:root {
  --sand:       #FAF3E1;
  --sand-hi:    #FFFBF0;

  --forest:     #146B3A;
  --forest-hi:  #1C8449;
  --forest-lo:  #0E4F2A;

  --wood:       #5A3A1E;
  --wood-hi:    #7A5230;

  --gold:       #E0A400;
  --gold-hi:    #F4C430;
  --gold-deep:  #8F6600;

  --bone:       #FFFEFA;
  --bone-shade: #D9CCA8;
  --pip:        #241608;

  --ink:   #241608;
  --muted: #8A7355;

  --blood:      #C0392B;

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
  background: var(--sand);
  color: var(--ink);
  font-family: var(--body);
  -webkit-font-smoothing: antialiased;
  overscroll-behavior: none;
}

body {
  background-image:
    radial-gradient(120% 80% at 50% -10%, rgba(224, 164, 0, 0.10), transparent 60%),
    linear-gradient(var(--sand), #F5EAD2);
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
.brand h1 { font-family: var(--signage); font-size: 24px; color: var(--forest); }

.nav { display: flex; flex-wrap: wrap; gap: 4px; }
.nav button {
  font-family: var(--mono); font-size: 12px; letter-spacing: 0.08em;
  text-transform: uppercase; background: none; border: 0;
  color: var(--muted); padding: 8px 10px; cursor: pointer; border-radius: var(--r);
}
.nav button[aria-current='true'] { color: var(--ink); background: rgba(36, 22, 8, 0.08); }
.nav button:hover:not([aria-current='true']) { color: var(--ink); }

/* ------------------------------------------------------------------- cards */
.panel {
  background: linear-gradient(180deg, var(--sand-hi), #FFF7E0);
  border: 1px solid rgba(90, 58, 30, 0.16);
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
  background: var(--gold); color: #2A1B00; border: 0;
  padding: 11px 18px; border-radius: var(--r); cursor: pointer;
}
button.act:hover:not(.ghost) { background: var(--gold-hi); }
button.act:disabled { background: #E3D6B8; color: #A89878; cursor: not-allowed; }
button.ghost {
  background: transparent; color: var(--ink);
  border: 1px solid rgba(36, 22, 8, 0.28);
}
button.ghost:hover { border-color: var(--gold-deep); color: var(--gold-deep); }

select, input {
  font-family: var(--body); font-size: 14px;
  background: var(--sand-hi); color: var(--ink);
  border: 1px solid rgba(36, 22, 8, 0.22);
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
.side-name.us { color: var(--gold-deep); }
.pips { display: flex; gap: 5px; }
.pips i {
  width: 16px; height: 16px; border-radius: 50%;
  background: var(--bone-shade); border: 1px solid rgba(36, 22, 8, 0.14);
  transition: background 240ms ease, box-shadow 240ms ease, transform 240ms ease;
}
.pips i.lit {
  background: var(--gold);
  box-shadow: 0 0 12px rgba(224, 164, 0, 0.55);
  transform: scale(1.06);
}
.pips.bruk i { animation: bruk 420ms ease both; }
@keyframes bruk {
  0% { background: var(--blood); box-shadow: 0 0 14px rgba(192, 57, 43, 0.7); }
  100% { background: var(--bone-shade); box-shadow: none; }
}
.under-love { font-family: var(--mono); font-size: 11px; color: var(--muted); }

/* -------------------------------------------------------------- the board */
.table-felt {
  background:
    repeating-linear-gradient(115deg, rgba(255,255,255,0.045) 0 2px, transparent 2px 6px),
    radial-gradient(120% 90% at 50% -15%, rgba(255, 255, 255, 0.14), transparent 55%),
    linear-gradient(165deg, var(--forest-hi), var(--forest) 45%, var(--forest-lo));
  border: 6px solid var(--wood);
  border-radius: 10px;
  box-shadow:
    inset 0 0 0 1px var(--wood-hi),
    inset 0 1px 0 rgba(255, 255, 255, 0.12),
    0 14px 34px rgba(90, 58, 30, 0.28);
  padding: 14px 12px;
  min-height: 96px;
  max-height: min(64vh, 560px);
  overflow-y: auto;
  display: flex; align-items: center;
  scrollbar-width: thin;
}

/* --board-cols is set inline by renderBoard() in render.ts, computed from
   window.innerWidth at render time — not from a CSS media query. Board
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
  font-family: var(--mono); font-size: 12px; color: rgba(255,255,255,0.55);
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
    0 6px 10px rgba(0,0,0,0.45);
  display: grid; grid-template-rows: 1fr 1px 1fr;
  padding: 3px; flex: none; position: relative;
}
.tile .bar { background: rgba(36,22,8,0.35); }
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
  border: 1px solid rgba(36, 22, 8, 0.14); border-radius: var(--r);
  padding: 10px 12px; background: var(--sand-hi);
}
.seat.turn { border-color: var(--gold); box-shadow: 0 0 0 1px var(--gold) inset; }
.seat.partner { border-left: 3px solid var(--forest-hi); }
.seat h3 { font-size: 14px; font-family: var(--body); font-weight: 800; }
.seat .meta { font-family: var(--mono); font-size: 11px; color: var(--muted); }
.backs { display: flex; gap: 2px; margin-top: 6px; }
.backs i {
  width: 9px; height: 18px; border-radius: 2px;
  background: linear-gradient(160deg, var(--wood-hi), var(--wood));
  border: 1px solid rgba(36,22,8,0.3); display: block;
}
.passed { color: var(--blood); font-family: var(--mono); font-size: 11px; }

/* -------------------------------------------------------------- the coach */
.grade { font-family: var(--mono); font-size: 10px; letter-spacing: 0.1em;
  text-transform: uppercase; padding: 2px 7px; border-radius: 3px; }
.grade.best { background: var(--forest); color: #EAF7EF; }
.grade.fine { background: #CFE3D6; color: #1E4430; }
.grade.loose { background: var(--wood); color: #FBEEDA; }
.grade.blunder { background: var(--blood); color: #FBE7E3; }

.review-move {
  display: grid; grid-template-columns: auto auto 1fr; gap: 10px;
  align-items: start; padding: 10px 0;
  border-bottom: 1px solid rgba(36, 22, 8, 0.10);
}
.review-move .ply { font-family: var(--mono); font-size: 11px; color: var(--muted); }
.review-move .note { font-size: 13px; line-height: 1.5; }
.review-move .lesson {
  font-family: var(--mono); font-size: 11px; color: var(--gold-deep);
  background: none; border: 0; padding: 0; cursor: pointer; text-align: left;
}
.critical { border-left: 3px solid var(--gold); padding-left: 10px; }

.accuracy { font-family: var(--display); font-size: 40px; color: var(--gold-deep); line-height: 1; }

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
  border: 1px solid rgba(36, 22, 8, 0.14); border-radius: var(--r);
  padding: 14px 16px; margin-bottom: 10px; background: var(--sand-hi);
}
.belt .num {
  font-family: var(--display); font-size: 26px; color: var(--muted);
  line-height: 1; min-width: 34px;
}
.belt.open { border-color: var(--gold); }
.lesson { padding: 12px 0; border-top: 1px solid rgba(36, 22, 8, 0.10); }
.lesson h3 { font-family: var(--body); font-weight: 800; font-size: 14px; margin-bottom: 4px; }
.lesson p { margin: 0; font-size: 13.5px; color: var(--muted); }
.terms { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 7px; }
.terms span {
  font-family: var(--mono); font-size: 10px; letter-spacing: 0.06em;
  border: 1px solid rgba(36, 22, 8, 0.2); color: var(--muted);
  padding: 2px 7px; border-radius: 99px;
}

.banner {
  padding: 12px 14px; border-radius: var(--r); font-size: 14px;
  border: 1px solid var(--wood-hi); background: rgba(90, 58, 30, 0.08);
}
.banner.six-love {
  font-family: var(--signage); font-size: 22px; text-align: center;
  color: #2A1B00; border-color: var(--gold);
  background: var(--gold);
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

:focus-visible { outline: 2px solid var(--gold-deep); outline-offset: 2px; }

/* ---------------------------------------------------------------- lounges */
.lounge-card {
  display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: center;
  border: 1px solid rgba(36, 22, 8, 0.14); border-radius: var(--r);
  padding: 14px 16px; margin-bottom: 10px; background: var(--sand-hi);
  cursor: pointer; transition: border-color 140ms ease;
}
.lounge-card:hover { border-color: var(--gold-deep); }
.lounge-card.locked { opacity: 0.6; cursor: default; }
.lounge-card h3 { font-family: var(--body); font-weight: 800; font-size: 15px; }
.lounge-card .desc { font-size: 13px; color: var(--muted); margin-top: 2px; }
.gate {
  font-family: var(--mono); font-size: 10px; letter-spacing: 0.1em;
  text-transform: uppercase; padding: 3px 8px; border-radius: 99px;
  border: 1px solid rgba(36, 22, 8, 0.22); color: var(--muted);
}
.gate.vip { border-color: var(--gold); background: rgba(224, 164, 0, 0.14); color: var(--gold-deep); }

.room { display: grid; grid-template-columns: 1fr 240px; gap: 14px; }
@media (max-width: 700px) { .room { grid-template-columns: 1fr; } }

.chat-log {
  display: grid; gap: 8px; max-height: 340px; overflow-y: auto;
  padding-right: 6px; scrollbar-width: thin;
}
.chat-msg { font-size: 13.5px; line-height: 1.45; }
.chat-msg .who { font-family: var(--mono); font-size: 11px; color: var(--ink); margin-right: 6px; }
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
  border: 1px solid rgba(36, 22, 8, 0.22); color: var(--muted);
}
.badge.yardie { border-color: rgba(36, 22, 8, 0.22); color: var(--muted); }
.badge.vip { border-color: var(--gold); color: var(--gold-deep); }

/* ------------------------------------------------------------------ tiers */
.tiers { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px; }
.tier-card {
  border: 1px solid rgba(36, 22, 8, 0.16); border-radius: var(--r);
  padding: 16px; background: var(--sand-hi); display: grid; gap: 10px;
  align-content: start;
}
.tier-card.vip { border-color: var(--gold); }
.tier-card.vip .price { color: var(--gold-deep); }
.tier-card .price { font-family: var(--display); font-size: 22px; color: var(--ink); }
.tier-card ul { margin: 0; padding-left: 18px; display: grid; gap: 5px; }
.tier-card li { font-size: 13px; color: var(--muted); }
.offline-note {
  border: 1px dashed rgba(36, 22, 8, 0.28); border-radius: var(--r);
  padding: 14px; font-size: 13.5px; color: var(--muted);
}


/* ------------------------------------------------------------------ install */
.install-card {
  border: 1px solid var(--wood-hi); border-radius: var(--r);
  background: linear-gradient(rgba(90, 58, 30, 0.10), rgba(90, 58, 30, 0.03));
  padding: 16px; margin-bottom: 16px; display: grid; gap: 12px;
}
.install-card h2 { font-size: 18px; }
.steps { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }
.steps li { display: grid; grid-template-columns: 26px 1fr; gap: 10px; align-items: center; font-size: 14px; }
.steps .n {
  width: 24px; height: 24px; border-radius: 50%;
  display: grid; place-items: center;
  background: var(--bone-shade); color: var(--pip);
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
  border: 1px solid rgba(36, 22, 8, 0.22); border-radius: var(--r);
  padding: 10px 14px; margin-bottom: 14px; font-size: 13.5px;
}
```

Note the deliberate choices beyond a straight value substitution, since a reviewer should judge these against the "gold as fill vs. gold as text" rule, not assume every color came from a 1:1 mechanical swap:

- `.line:empty::after`'s placeholder text color stays a light, low-opacity white (`rgba(255,255,255,0.55)`) rather than switching to a dark ink tone — this text sits on the green felt table, not the cream room, so it needs to read against green, same as before.
- `.grade.fine`'s badge flipped from a dark green-grey background with light text to a light mint background with dark text — small badges read more cohesively against a light room this way; contrast is fine either direction, this is a legibility-neutral aesthetic call, not a fix.
- `.banner.six-love` changed from "gold text on a gold-tinted dark panel" to "dark text on a solid gold panel" — the original combination (bright gold text on a light gold tint) would fail badly on a cream background; inverting to a solid gold fill with dark ink text is both legible and arguably a stronger celebratory moment (reads like a gold medal/ribbon).
- `.chat-msg .who` changed from `var(--bone)` (plain bright text, used because it was the base "make it pop but not gold" color on dark) to `var(--ink)` — the direct equivalent on light: full-strength base text color, not muted, not gold.
- Every other former use of `--bone-shade` as a TEXT color (`.lesson p`, `.lounge-card .desc`, `.tier-card li`, `.offline-note`) moved to `var(--muted)` — `--bone-shade` is reserved for the tile's physical thickness edge only now, not for secondary text, since on a light room a light tan text color would be nearly illegible.

- [ ] **Step 2: Typecheck and build**

```bash
npm run typecheck && npm run build
```

Expected: clean. This task touches no TypeScript. Build should show the same two-chunk structure as before (`index` and `loungeview`).

- [ ] **Step 3: Manual verification**

Run `npm run dev` and check, at 390×844 first:

1. Local play: the room is cream/sand, not dark or white. The topbar wordmark renders in Bungee, colored forest green. Panels (config forms, coach review) are light cream cards, not dark ones. `button.act` (Deal, Play again, etc.) is solid gold with dark text — confirm it's legible. The score track's lit pips are gold; the "you" side label is a deep, legible gold (`--gold-deep`), not the bright fill-gold (which would be too light to read as text).
2. An active or completed hand: the table is green felt with a visible wood frame, tiles show the bone-shade thickness edge, everything reads correctly against the green (not the cream room).
3. Six-love banner (trigger if practical, or inspect the CSS directly): solid gold background, dark text — confirm this is legible and looks like a genuine celebratory moment, not a legibility failure.
4. Lounges list and Membership page: cards are light, gate/tier badges are muted except VIP (gold border, `--gold-deep` text).
5. Confirm nothing anywhere shows gold TEXT directly on the cream room or a cream panel using the bright `--gold`/`--gold-hi` value — spot check `.side-name.us`, `.review-move .lesson`, `.accuracy`, `.badge.vip`, `.gate.vip`, `.tier-card.vip .price` specifically, since these were the selectors most likely to need the `--gold-deep` swap and are the easiest to get wrong.

Then spot-check the same set at 768×1024 and 1440×900.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/styles.css
git commit -m "feat: restyle to Sunday Yard — midday cream room, full-strength flag colors, gold as text uses gold-deep for contrast"
```

---

## Task 2: Verification pass — contrast and consistency across all screens

**Files:** none (verification only — fix inline in `apps/web/src/styles.css` if something's genuinely broken)

**Interfaces:** none — this task consumes Task 1's stylesheet.

- [ ] **Step 1: Build and typecheck one more time from a clean state**

```bash
npm run typecheck && npm run build && npm test
```

Expected: all clean.

- [ ] **Step 2: Portrait-first pass, 390×844, covering every screen**

Using `npm run dev` with devtools' device toolbar set to 390×844, walk through: local play (config → active hand with several tiles played, so the board's felt/wood/tile-thickness is visible → coach review → verify-deal), lounges (list → a room's chat/roster → open-tables panel if reachable), membership (all three tier cards), Academy (belt list).

For each, confirm:
- No text is illegible against its background — this is the main new risk this palette swap introduces (light-on-light or gold-on-light failures) that didn't exist in the prior dark theme.
- Gold never appears as text directly on the cream room or a cream panel — only as fills (buttons, pips, dots, badges-as-borders) or as `--gold-deep` when it is text.
- The felt table and wood framing still read correctly (this only changes if `--forest`/`--wood` variables were mistyped — should be unaffected by this task, but confirm).
- No stray dark-theme relic — a background, border, or shadow that still reads as "dark card on dark room" rather than "light card on light room."

- [ ] **Step 3: Spot-check wider**

Repeat a fast pass at 768×1024 and 1440×900.

- [ ] **Step 4: Fix anything genuinely broken**

A contrast failure or a missed `--gold` → `--gold-deep` swap is a real bug to fix here, not a matter of taste. Fix directly in `apps/web/src/styles.css`, matching the patterns already established in Task 1.

- [ ] **Step 5: Commit** (only if Step 4 produced changes)

```bash
git add apps/web/src/styles.css
git commit -m "fix: Sunday Yard palette verification fixes"
```
