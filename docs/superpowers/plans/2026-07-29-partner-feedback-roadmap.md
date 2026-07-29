# Beat Di Table — Partner Feedback Roadmap (2026-07-29)

> **Handoff document.** Any session can pick this up cold. Read "Where things
> stand" first, then "Settled decisions" so you do not relitigate them, then
> take the next unchecked task. **Update `docs/memory.md` and your own memory
> as you finish each item** — the protocol is at the bottom of this file.

**Source:** two recorded WhatsApp calls between Dr. Hunter and her business
partner, who plays JamDom daily and is the source of all competitive intel
here. The transcripts are mostly patwa and were auto-transcribed badly; every
requirement below is the reading Dr. Hunter confirmed, not a guess from the raw
text. Where a number is still uncertain it says so explicitly.

---

## Where things stand (2026-07-29)

**Product is named Beat Di Table.** User-visible surfaces renamed. Internal
names (`@yard/engine`, the `yard-dominoes` folder, `yard:*` localStorage keys,
the git remote) deliberately still say "yard" — renaming the storage keys would
wipe every player's saved coach history, and the package alias is invisible.
Game vocabulary that legitimately says Yard stays: the **Yard** duppy level,
the **Yardie** tier, **Yard Gate** lounge, the **Yard Baby / Yard Champion**
Academy belts, and "Yard rules" in hero copy.

**Shipped and on `main`:** authentic snaking board layout, board sizing that
scales to the felt, live P2P voice, duppy table talk + recorded voice, the
solver-backed coach, leak detection, shareable hand replays, reactions,
provably-fair deal + Verify, terms/privacy/age gate, the billing fixes, and
banked turn time.

**Migrations, functions, and the paywall — resolved 2026-07-29, do not
re-apply.** An earlier draft of this section (from before the fix landed) said
`0011`/`0012`/`0013` were written but not applied, and called that the biggest
risk in the repo. That was true when it was written and is false now — do not
trust it, and do not re-run these migrations on the strength of stale
paperwork. Verify state directly if you doubt this:

```sql
select column_name from information_schema.columns
where table_schema='public' and table_name='seats' and column_name='time_bank';
-- non-empty ⇒ 0013 (and therefore 0011, 0012 before it) is applied.
```

What actually happened: all three migrations were applied via the Supabase
MCP tool, then verified live — a real anonymous account attempting to `PATCH`
its own `tier` to `vip` got `403 / 42501` (the free-VIP hole from `0012` is
closed), and a real hand was played through `play-move` end to end, proving a
fast move banks unspent time, a slow move banks ~0, and a timed-out turn
(caught live, mid-test, via production's own `pg_cron` sweep) zeroes the bank.
All ten Edge Functions were then deployed together via `npm run fn:deploy`
(after fixing that script to invoke the CLI through `npx` — it was calling a
bare `supabase` that isn't installed globally).

**Still open, not resolved by the above:**
- The Stripe dashboard endpoint is still subscribed to only the original two
  events. Until `invoice.paid`, `charge.refunded`, and `charge.dispute.created`
  are ticked, three of the four billing fixes in `0011`/the webhook rewrite
  cannot fire — `invoice.paid` is the one that matters most, since without it
  a renewal does not extend anybody's membership.
- `ENTITY` blanks in `legal.ts` need the LLC before a lawyer can review it.

**Deploy order, for the next migration that needs one:** apply schema changes
before deploying functions that depend on them, and re-sync the vendored
engine (`npm run sync:engine`) first — it's gitignored and regenerated, not
committed. `0013` specifically taught this the hard way: deploying
`create-table` before its migration would have hard-failed every table
creation, since the insert writes a column the old schema didn't have.

**Two bugs surfaced while building Wave 1, both worth knowing about:**

1. **Every pip on every tile was invisible on `main`.** The board-sizing work
   changed pips from a fixed `5px` to `width: 56%` so they would scale with the
   felt — but `.tile .half` used `place-items: center`, which shrink-wraps each
   of the nine grid cells to its contents. An empty `<span>` is zero wide, so
   56% of it is zero, and the tiles rendered blank. Fixed by making each span
   its own stretched centring box. **The board sizing feature had shipped with
   its tiles blank and nobody saw it.**
2. **The dev server no longer registers the service worker** (`pwa.ts`). It used
   to. `sw.js` caches same-origin GETs first-hit-wins, which is safe in
   production because Vite content-hashes built assets — but `npm run dev`
   serves `/src/styles.css` and `/src/*.ts` at stable URLs, so the worker
   pinned the first version it ever saw and served it through every edit. That
   is how bug 1 stayed hidden: the page under test was not the code on disk.
   To exercise the worker itself, `npm run build && npx vite preview`.

The lesson for whoever is next: **a clean typecheck told us nothing here.**
Both bugs were pure CSS and pure cache, and both were only ever visible by
looking at the running page.

---

## Settled decisions — do not reopen

- **Coins never cash out.** Money in, utility only. The partner was explicit:
  *"it's not gambling because you're not getting any real money, you're not
  taking it out."* This is what keeps the whole economy out of a licensing
  regime, and it is load-bearing. Nothing in the app may ever convert coins
  back to money.
- **No SFU for voice.** P2P mesh over the existing Realtime channel. An SFU
  only earns its cost above ~20 in a room.
- **Guests get reactions and listen-only voice free.** Membership sells the
  microphone, not membership of the room.
- **The art template (`docs/art-direction.md`) is mandatory** for any new
  artwork, and illustrations with people must show women playing and winning.
- **Voice is additive** and must never take down the lounge, chat, or a live
  hand. Failure modes are in `.claude/rules/voice.md`.

## Open decisions — need Dr. Hunter, do not guess

1. **Does the paid re-shuffle ship?** It is mild pay-to-win (see Wave 3). The
   partner knows players dislike it and considers the revenue worth it. Her
   call. If yes, the Terms line *"a membership does not buy an advantage in a
   hand, and it never will"* must be rewritten before launch.
2. **Coin send floor** — partner said 60 on JamDom, then settled on 20.
3. **Whether local play against duppies gets a clock.** Currently it has none,
   so practice does not train what the speed rooms test.

---

## Wave 1 — visible, cheap, blocked on nothing

### 1.1 Brown felt, and a player-chosen table colour

The partner asked twice: *"the table color... let it be brown."* JamDom lets
players adjust it, and he explicitly likes that.

- [x] **Done.** Brown is the default. `--felt-hi/-lo/--felt/--felt-rim` are new
      tokens in `styles.css`; `--forest` was left alone, since it is the brand
      green on buttons, links and the logo — recolouring your table must not
      restyle the whole app.
- [x] **Done.** Four felts (`brown`, `clay`, `green`, `blue`) in
      `apps/web/src/felt.ts`, persisted to `yard:felt`, applied as `data-felt`
      on `<html>` so one write recolours hero, table and replay together.
      Swatches sit next to the sound toggle. The theme blocks are plain
      attribute selectors rather than `:root[...]` ones on purpose: each swatch
      button carries its own `data-felt` and paints itself from the very tokens
      it sets, so a felt's colours are defined in exactly one place.
- [x] Contrast checked. `clay` was deliberately pulled down to `#A66E3E` —
      a genuinely cream felt is the combination that fails against `--bone`
      (`#FDF6E3`), and `docs/design.md` records a bone/sand-hi collision that
      already had to be fixed once.

### 1.2 Sound effects

**The recordings already exist** — Dr. Hunter supplied them, they are real
dominoes, and they are already in `apps/web/public/sfx/`:

| File | Plays when |
|---|---|
| `knock.m4a` (19 KB) | a tile is played |
| `shuffle.m4a` (75 KB) | a hand is dealt / shuffled |
| `six-love.m4a` (82 KB) | a six love is given |

- [x] **Done.** `apps/web/src/sfx.ts`, sibling of `speak.ts` and reading the
      same mute flag — the toggle now reads "Sound on/off" rather than "Duppy
      voice", because it silences both.
- [x] **Done.** `Audio` objects are built once and reused, and are built lazily
      on the first gesture rather than at import, so the front door does not
      spend ~180 KB on a game that visitor may never start.
- [x] **Done.** `unlock()` on the first `pointerdown`/`keydown` plays every clip
      muted and stops it, which is what iOS requires.
- [x] **Done.** All three files precached, `VERSION` bumped to `bdt-v2`.
- **Wiring:** local play fires from the `LocalGame` event stream. Online has no
      `played` event — the server sends whole states, not moves — so the knock
      comes off a board-length diff in `onlinetable.ts`'s `onPublic`, and the
      shuffle off a changed `hand_id` with an empty board. Joining mid-hand is
      deliberately silent: that deal did not just happen.
- [ ] Later, if wanted: coins-received and round-won sounds. Do **not** use
      Suno — it writes songs. Real recordings or ElevenLabs SFX.

**Verified in the browser, not just typechecked:** four tiles on the board
produced exactly four `knock.m4a` plays at 0.55 volume; muting produced zero
plays across four more tiles; a fresh deal produced exactly one `shuffle.m4a`
and no stray knock. **`six-love.m4a` is wired but was NOT heard** — reaching a
six love needs a full set, and neither the local `setOver` path nor the online
`sets.six_love` edge was played through. It is one line on each path, but treat
it as unproven.

### 1.3 Yard *and* Foreign

The front door currently speaks only to yard play. The partner wants both
represented, because the audience is split between Jamaica and the diaspora —
and the UK/US Jamaican community is a large part of the paying base.

- [x] **Copy done.** The hero eyebrow now reads "Jamaican dominoes — yard and
      foreign", and the body says "Yard rules from wherever you're playing".
      Art still speaks only to the island; the band and the reaction set are
      unchanged.
- [x] **Done.** `0014_profile_identity.sql` adds `profiles.origin`
      ('yardie'|'foreign') and `profiles.gender` ('f'|'m'), both nullable and
      never inferred. **Applied to production and verified**: exactly five
      columns are UPDATE-grantable to `authenticated` (username, flag, bio,
      origin, gender) and `tier` is still not one of them, so `0012` holds.
      `origin` is deliberately NOT `flag`: a Jamaican in London is foreign and
      her flag is still 'jm'. `flag` remains unwritten by anything.
- [x] **Done.** Optional M/F, as "Call me — She / He". Tapping the chosen
      option clears it, so an optional question stays answerable with "never
      mind".
- **This required building the first profile editor in the app** — until now
      `username` was assigned at sign-up and nothing was ever editable.
      Reachable from the lounge LIST via "Edit profile" (not from inside a
      lounge — you back out first, which is a rough edge worth revisiting).
      Badge shows on the seat and beside your name in the lounge list; the
      class is `origin-yardie`, prefixed because `.badge.yardie` was already
      the Yardie TIER and they mean different things.

Verified live end to end: renamed the account, chose Foreign + She, confirmed
the row in Postgres, and saw `Shelly_Yard · FOREIGN` on the seat at a real
table. The too-short-name error path shows its message rather than failing
silently.
- [ ] **Avatars for people who will not show their face.** Must be a real
      option, not a fallback — many players want presence without a photo. The
      art template applies.

**These three were deliberately NOT started**, and the reason matters: **there
is no profile editor in this app at all.** `profiles` has had a `flag` column
(territory code) since `0001` and nothing has ever written to it. So the badge
is not a badge — it is the first profile-editing surface, plus a migration
adding the columns, plus a **column grant in the `0012` style** (a blanket
`grant update on profiles` would reopen the free-VIP hole that migration was
written to close). Scope it as its own piece of work, not as a chip on a seat.
Avatars additionally need artwork under `docs/art-direction.md`.

### 1.4 Duppy impatience lines

- [x] **Done.** New `waiting` trigger in `talk.ts` with per-level lines,
      including both of the partner's. It is the only trigger fired by the
      ABSENCE of a move, so it needs a timer at the callsite — `nagLater()` in
      `main.ts`, not a game event.
- [x] **Done.** Runs through the same `TALK_CHANCE`, so `don` (0.2) almost
      never nags and `pickney` (0.9) almost always does. Capped at **two**
      lines per turn and one seat speaks, not the whole table at once: first at
      14s, again at 30s, then silence. Stops on any event and on leaving the
      Play tab — a duppy calling you slow from a screen you have left is a bug.
- Note: local play still has **no turn clock** (open decision 3), which is
      exactly why this is worth having — the nag is the only time pressure a
      solo player ever feels.

Verified live: sat idle on my own turn against a `ranker` and got "Duppy, stop
hold di game." on screen.

### 1.5 Spectator list

- [x] **Done.** A "Watching — N" panel of names above the reaction bar.
      Speakers are highlighted, using the same `speaking` set the seats use.
- **How it knows.** `PresenceEntry` gained a `table` field, announced on the
      lounge channel when a table opens and cleared when it closes — no second
      channel, because the lounge one is already open, already synced, and
      already carries voice and reactions. Watch for one thing: `channel.track`
      REPLACES the whole entry rather than merging, so `enterLounge` now keeps
      a single running copy (`announce()`), or picking up the mic silently
      clears which table you are watching and vice versa.
- Seated players are filtered out (they are on screen as seats already), and
      the panel returns null rather than rendering "Nobody is watching".
- [ ] **NOT done: a notice when someone joins.** Needs a diff of the previous
      roster and somewhere to put a transient message.

**NOT verified.** This needs two real clients in the same lounge and only one
was available — two tabs in one browser share a Supabase session and are not
two players. The panel has never been seen with a name in it.

---

## Wave 2 — systems, still no money

### 2.1 Typed chat at the table + the anti-cheat rule

Many players will not use a microphone. The partner's rule is sharp and worth
implementing exactly:

- [x] **Quick chat done** — the partner's eight buttons (ME, YOU, ANY, BLESS,
      GG, DWL, KMT, BRB) at the table, in `lounges.ts` as `QUICK_CHAT`. They
      ride the **same broadcast and the same on-screen slot as reactions**, so
      one person is only ever saying one thing at a time and there is no second
      timer or second event to keep in step. A quick-chat id renders as words,
      a reaction id as a picture; `knownSignal()` gates both, so a peer
      broadcasting an invented id still renders nothing.
      **They are public on purpose, and that IS the anti-cheat for this half:**
      ME/YOU/ANY are real signals in partner play, and a private channel
      carrying them is how a hand gets thrown. Broadcast, they are what they
      are across a real table — everyone hears it, including the people it
      would hurt.
      Verified live at a real table: clicking GG put a green GG chip on my own
      seat and it cleared itself. **Not verified from a second client.**
- [ ] Free-text typed chat at the table (this is only the canned half).
- [ ] **VIP can send private messages.**
- [ ] **Nobody seated in a live hand may send or receive a private message.**
      That is the anti-cheat: private channels between seated players are how
      hands get shared. Enforce it **server-side**, not in the UI.

### 2.2 Game variants — NOT already in the engine

Dr. Hunter told the partner French was "in the code." **It is not.**
`packages/engine/src/types.ts` has `GameMode = 'cutthroat' | 'partner'` and
nothing else. Do not promise a date before scoping.

- [ ] **French** — race to 100 rather than six love. New format, new scoring,
      and the coach's evaluation needs to understand the different target.
- [ ] **Open hand / "Ol' Man"** — the player across from you sees your hand.
      Affects the engine's information model, every duppy's decision function,
      and the anti-cheat story. Scope carefully.
- [ ] 3- and 4-hand cut throat variants.

### 2.3 Tournaments

- [ ] Separate **tournament lounge**.
- [ ] Sign-up flow: a flashing banner after login, click to enter, countdown
      from the morning of the event.
- [ ] **VIP jumps the queue** — a VIP who signs up at 4:30 gets a seat ahead of
      a regular who signed up at 9am. Per the partner this is *the* reason
      people buy VIP; it is a stronger pitch than the microphone.
- [ ] **Host role**: trusted people can run tournaments without any access to
      coins or billing. Scope the permission narrowly.
- [ ] Admin can broadcast to the tournament ("intercom").
- [ ] Cheating penalty: an admin can strip a player's runs.
- [ ] Sundays are the regular slot. Typical shape is two rounds plus a final.

---

## Wave 3 — the coin economy (gated on the open decisions)

### The spec, as confirmed

- **$5 → 25 coins** by card. Minimum send **20** (confirm).
- **Never withdrawable.** See Settled decisions.
- Coins are **separate from rating points**. Winning does not grant coins.
- Spends: **shuffle 2**, **playback/replay 2**, **virtual beer 3**, and
  sending coins to other players (pure social flex — the partner is clear that
  players enjoy visibly "walking around with money").

### The shuffle, precisely

| | |
|---|---|
| What it shuffles | **The buyer's own hand only** — not a table re-deal |
| Blind? | Yes. *"You might get something worse."* |
| Cost | 2 coins, auto-deducted. No coins, no shuffle |
| Decide within | 10 seconds |
| Frequency | **Once per player, per set.** Both sides get the chance |
| Trigger | At **5** in six love; at **50** in French (race to 100; configurable 50–70) |

**Why this is a decision and not just a task:** it is mild pay-to-win. Coins
buy an option a coinless player does not have, and a player only re-rolls a bad
hand, so the expected value is positive. It is symmetric, capped, and a
gamble — much narrower than a full re-deal — but it is still an advantage
bought with money, and it contradicts a sentence currently in the Terms.

**The design lever that makes it defensible:** put the paid re-shuffle inside
the existing commit-reveal scheme so the re-deal is verifiable too. JamDom
players already suspect the shuffle — the partner said so twice. Being the only
app where a player can *prove* the re-deal they paid for was not rigged to sell
them another one turns the feature people resent into the feature that proves
the house honest. Build it that way from the start, not as a retrofit.

### Implementation notes

- [ ] Coins need a **ledger**, not a counter on `profiles`. Every grant, spend
      and transfer is a row. This is money-adjacent: it needs an audit trail,
      and "why did my coins vanish" must be answerable.
- [ ] Server-authoritative throughout, like every other mutation here. A client
      must never be able to name its own balance.
- [ ] Stripe products for coin packs, same webhook that already handles
      memberships. **Idempotency matters more here** than for subscriptions —
      a duplicated `checkout.session.completed` must not double-grant coins.
      The existing `payments.stripe_session_id` unique constraint is the model.
- [ ] Terms and Privacy both need updating: the "no chips, no coins" line, the
      advantage line if the shuffle ships, and a refund position on coins.
- [ ] It is a **PWA, not an app-store app** — no 30% platform cut on any of
      this. That is a real advantage over a native rival and worth stating.

---

## Memory protocol for whoever picks this up

Keep these in sync as you work — a later session will read them instead of the
transcripts, which are long and badly transcribed.

- **`docs/memory.md`** — the repo's own log. Add a numbered phase entry when a
  piece of work lands. Record what was built, why, the gotcha that cost time,
  and **anything you could not verify**. Existing entries are the model: they
  are candid about what is unproven, and that candour is the point.
- **Assistant memory** (`~/.claude/projects/.../memory/`) — update
  `project_yard_dominoes.md` for decisions, constraints, and hard-won gotchas
  that are not derivable from the code. Do not duplicate what the repo records.
- **This file** — tick the boxes as they land. If a decision in "Open
  decisions" gets answered, move it into "Settled decisions" with the answer
  and the date.

### Verification standard

Do not mark anything done on a clean typecheck alone. This repo's own history
records a voice feature that shipped while silently connecting nobody, and a
webhook that had been quietly failing every write for a session.

- `npm test`, `npm run typecheck`, `npm run build` all green.
- Anything visible: check it in the browser preview, both desktop and mobile.
- Anything online: it needs the migration applied, the functions deployed, and
  **two real clients** — two tabs in one browser share a Supabase session and
  are not two players.
- Say plainly what you did not verify. An honest gap is worth more than a
  confident claim that turns out to be false.
