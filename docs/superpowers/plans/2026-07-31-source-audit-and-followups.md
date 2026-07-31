# Source audit — JamDom.com tutorials — and the follow-through plan (2026-07-31)

Two primary sources checked against the shipped engine: JamDom.com's own
"How to Play Cutthroat" and "How to Play French" YouTube tutorials, both
saved as clippings at `~/Clinical Research 2026/Clippings - Youtube - UMPJE
- Pharmacy Decoder/Clippings/`. Full transcripts read end to end, cross-
checked line by line against `packages/engine/src/{hand,set,types}.ts`.

Why this matters: the French cross-board work (`ad1d18b`) was built from
Dr. Hunter's typed recollection plus pagat.com, per the debrief — not from
this video. This is the first time the actual JamDom tutorial (the same
product Yard is positioned against) has been checked line by line against
what shipped.

## 1. Cutthroat — audit result: no bugs found

Checked point by point in the prior turn: 4 players/7 tiles, double-six
poses a fresh set (bruk correctly forces it, matching `set.test.ts:59`
regardless of tournament flag), winner poses next with any tile, six-love
scoring and bruk, blocked-hand lowest-count resolution, anti-clockwise
play, "straight six" = `firstToSix`. Every one matches. The only
divergence — JamDom defaults cutthroat to six-love, we default to
`firstToSix` — is the already-documented, bench-tested CLAUDE.md decision,
not a bug. Not reopening it.

**No action needed on cutthroat.**

## 2. French — audit result: core mechanic confirmed correct, one real open question, one concrete spec upgrade

### Confirmed correct (verified against `hand.ts` directly, not just described)

- **Fill phase.** "You play double blank, the next four plays must be a
  blank, around all four corners." `crossLegalPlays` fill branch: legal iff
  `a === 0 || b === 0` — any tile carrying a blank half, exactly as
  described. ✓
- **Doubles-lead-suit.** "The double must always lead any suit — the only
  play possible... you cannot play on a suit unless the double is played."
  `crossLegalPlays` post-fill: `isSuitDouble || isSuitLed`, and `placeCross`
  adds to `suitLed` only when a double is played, keyed on the arm's
  open-end suit *before* the play. This is exactly the mechanic. ✓
- **Chucha opens round 1, race to 100, winner scores 0.** All confirmed
  live in the real 4-client verification from two sessions ago (server
  scoring matched an independent recomputation exactly:
  `[30, 54, 0, 8]`).

**No bug in what's shipped.** The core cross-board legality logic is
correct as built, independent of Dr. Hunter's recollection — two different
sources converged on the same rule.

### Open question — do NOT resolve by guessing (real stakes: this touches live scoring code)

The video's doubling rule, verbatim from the transcript (auto-generated
captions, genuinely ambiguous):

> "if somebody wins with a double whatever you hold in your hand doubles
> ... this is why my score is now 95 ... and if I had happen to lose with
> a double I would double up as well ... so it's mighty win with a double
> and you lose with a double then your double doubles your score"

Two readings are both plausible from this text:

1. **What's shipped today:** each seat's own score doubles iff *that seat*
   personally still holds a double when the hand ends
   (`doublesRemaining[seat]` in `hand.ts:297`, matches `set.test.ts` and
   Dr. Hunter's original spec).
2. **A different rule the video may be describing:** if the *winner's*
   final/winning tile was itself a double, *every other seat's* remaining
   score doubles for that hand — a table-wide trigger, not a per-seat one.
   Under this reading a seat could get doubled even holding zero doubles
   themselves, because someone else won by playing one.

These produce different numbers on real hands. The live verification two
sessions ago only proved *internal consistency* (client math matched
server math) — both sides used reading #1, so it can't distinguish the two
readings.

**Do not change the scoring code from this transcript alone.** Next step:
either re-watch the video's 6:28–6:56 segment with audio (captions are
unreliable there — "whatever you hold in your hand doubles" could easily
be a mangled "whatever [double] you hold in your hand" instead of a
table-wide trigger), or ask Dr. Hunter directly: *"if I win by playing a
double as my last tile, does everyone else's remaining hand double, or
only the people who are themselves still holding a double?"* One sentence
answers it. Flagging as open rather than shipping either guess.

### Concrete spec upgrade — the pass-penalty, now with an exact trigger

The debrief listed "+10 pass penalty" as a deferred one-liner with no
mechanic. The video gives the actual mechanic, twice, consistently:

- **Invalid pass** (you pass while you actually had a legal play):
  **+10**, applied immediately, not at hand end.
- **Three consecutive real passes** (your own turn comes around three
  times in a row with no legal play, i.e. you're shut out on every open
  end/arm three turns running): **+10**, also immediate.
- These are two *separate* triggers, not one. Confirmed by the narrator
  hitting the second one on-screen: three real, non-blockable passes in a
  row → score jumps by exactly 10, stacking with the eventual hand-end
  pip total.

This is now specific enough to build, once the doubling question above is
settled (both live in the same scoring code path).

## 3. Hard end / dead double / key — implementation plan

Not new engine *rules* — nothing here changes legality or scoring. These
are three named, derivable properties of public board state that real
Jamaican players use to read a board, currently unexposed anywhere in
`academy.ts`, `coach.ts`, or `leaks.ts`. Confirmed present in *both*
videos — this is universal terminology across cutthroat and French, not
mode-specific, so it belongs in a shared location, not duplicated per
mode.

One of the three (hard-end detection) already exists as an **unnamed
inline heuristic** inside `bots.ts`'s `scoreMove` exhaustion block:

```ts
// bots.ts, current scoreMove()
if (w.exhaustion > 0) {
  const seen = suitsSeen(view);
  for (const end of [left, right]) {
    const unseen = 7 - seen[end];
    if (unseen <= 1 && strength[end] > 0) score += w.exhaustion;
  }
}
```

The plan is to extract this into a named, tested, reusable function and
add the two siblings it doesn't yet have.

### 3.1 New pure functions — `packages/engine/src/bots.ts`

Add alongside the existing `suitsSeen`/`voidsFromLog` (same file, because
Coach already imports from `bots.ts`, and these read the same
`PublicView` those do):

```ts
/**
 * Suits where only ONE tile is unaccounted for (not on the board, not in
 * my hand) — meaning if I hold that last tile, I am the only player who
 * can ever answer that end again. "Hard end" in Jamaican play.
 */
export function hardEnds(view: PublicView): Pip[] {
  const seen = suitsSeen(view);
  const open = openEnds(view.board); // needs importing from hand.ts, or
                                       // duplicate the tiny open-end read
  return open.filter((suit) => seen[suit] === 6);
}

/**
 * Doubles in my own hand that can never be played again: every other
 * tile of that suit is already visible (board + my hand), AND no
 * currently open end exposes that suit right now.
 */
export function deadDoubles(view: PublicView): TileId[] {
  const seen = suitsSeen(view);
  const open = new Set(openEnds(view.board));
  return view.myHand.filter((t) => {
    const [a, b] = halves(t);
    if (a !== b) return false; // only doubles can be dead in this sense
    return seen[a] === 6 && !open.has(a as Pip);
  });
}

/**
 * True when my remaining hand holds the sole last tile of two DIFFERENT
 * suits simultaneously — an unbeatable position ("key").
 */
export function hasKey(view: PublicView): boolean {
  const seen = suitsSeen(view);
  const mySuits = new Set<Pip>();
  for (const t of view.myHand) {
    const [a, b] = halves(t);
    if (seen[a] === 6) mySuits.add(a);
    if (seen[b] === 6) mySuits.add(b);
  }
  return mySuits.size >= 2;
}
```

Cross-board note: `openEnds()` already exists in `hand.ts` (added for the
French work) and returns every open pip regardless of board shape — reuse
it rather than reading `board.leftEnd`/`rightEnd` directly, so these three
functions work unmodified for both linear and cross boards.

### 3.2 Tests — `packages/engine/test/bots.test.ts`

Six cases minimum, mirroring the existing `suitsSeen`/`voidsFromLog` test
style:
- `hardEnds` returns the suit when 6 of 7 are seen and I hold the 7th.
- `hardEnds` returns empty when the 7th tile is still genuinely unseen
  (could be an opponent's or the boneyard's).
- `deadDoubles` returns a double once its 6 siblings are all visible and
  no open end currently shows that suit.
- `deadDoubles` does NOT flag a double whose suit is currently open (it's
  playable right now, not dead).
- `hasKey` true with two qualifying suits, false with only one.
- Cross-board case: `hardEnds`/`deadDoubles` work off `openEnds()` and
  don't special-case `board.kind`.

### 3.3 Coach wiring — `packages/engine/src/coach.ts`

Coach already grades a move Best/Fine/Loose/Blunder and attaches a
plain-language explanation. Extend the per-move annotation: when the
position that was just played from had a live hard end, dead double, or
key available (self or opponent), name it in the explanation using the
Jamaican term, e.g. *"you had hard six here — nobody else could answer
it"* or *"your double-four went dead two plays ago — no more fours are
coming."* This is copy-generation off the three functions above, not new
grading logic; the existing `scoreMove`/rollout grading is untouched.

### 3.4 Academy — one new lesson

Per `academy.ts`'s existing belt structure (referenced by string ids like
"Belt 4 · Lesson 1" — renumbering forbidden per `engine.md`), add ONE new
lesson introducing all three terms together, since the video presents them
as a connected reading skill, not three separate topics. Use the
engine-rendered board-diagram pipeline already established in
`design.md`'s "Teaching art" section (`packages/engine`-driven script →
SVG into `public/art/boards/`) — build the actual hard-end/dead-double/key
position with the real engine and render it, never hand-drawn or
AI-generated, so it's accurate by construction. Suggested slot: Belt 4
(the belt already covers `knownVoids`-derived inference per the README's
Coach description), as the natural next lesson after voids.

### 3.5 Scope boundary

Explicitly NOT touching: `legalMoves`, `applyMove`, `applyHandResult`,
scoring, or bot move-selection weights. `scoreMove`'s existing exhaustion
heuristic can *optionally* be refactored to call `hardEnds()` instead of
its inline duplicate once the function exists, purely as a dedup — that
refactor is safe because the underlying math (`7 - seen[end] <= 1 &&
strength[end] > 0`) is unchanged, just named. Not required for this to
ship; a nice-to-have.

## 4. Priority order — working through the punch list

Preserving the order given, with one dependency-driven reorder called out.

1. **Cross-board server sync + deploy** (`start-hand`/`play-move`/
   `expire-turns` need the vendored engine copy refreshed and redeployed,
   same rollout as openhand/French scoring). *Moved ahead of "French
   phase 3" below it depends on* — phase 3 items can't be verified live
   until this lands.
2. **French phase 3**, now better specified by this audit:
   - Resolve the doubling-trigger open question (§2) — blocks any pass-
     penalty work sharing the same scoring path.
   - Pass penalty: two triggers, both +10, both immediate (§2).
   - True mid-set elimination at 100 (currently the set just ends; a
     real elimination model lets remaining players keep playing).
   - Coin-tied shuffle at 50 — blocked on the coin economy (item 6).
   - Cross-aware pass inference, replay URL encoding, anti-clockwise turn
     order for French specifically.
3. **Avatars wiring** — `profiles.avatar` column + grant extension to six
   columns + picker in the profile editor. Art already generated and
   pushed; this is pure plumbing.
4. **Tournament debrief's 4 open questions** (disqualify scope,
   host-vs-admin, entry cost, guest-seating-when-full).
5. **Stripe dashboard** — tick `invoice.paid`, `charge.refunded`,
   `charge.dispute.created`. Five minutes, real revenue-continuity risk
   per `billing.md` until done.
6. **Coin economy** — Stripe IAP, wallet table, spend/refund RPCs,
   no-cash-out guardrails. Gates item 2's shuffle.
7. **Hard end / dead double / key** — plan in §3 above, no blockers,
   can run in parallel with anything else on this list since it touches
   no shared scoring/legality code.
8. **Cosmetic yard-scene backgrounds** (§7.1) — no blockers, same art
   pipeline as avatars.
9. **Video presence** (§7.2) — explicitly LAST. Not blocked technically,
   just lowest priority by instruction: this is a genuinely new cost
   center and a genuinely new piece of infrastructure, and everything
   above it is either revenue-protecting, already-scoped, or free to
   build. Do not pull this forward without being asked.

## 6. VIP membership — what JamDom actually ships, and where Yard should exceed it

Third source, same folder: "JamDom.com VIP Features Video Tutorial"
(2012, `youtube.com/watch?v=DvZMEhPEqd0`). Watched directly with Playwright
— navigated to the video, seeked the underlying `<video>` element to the
emoticon-catalog segment, and screenshotted it, because the auto-caption
transcript alone couldn't show what the actual emoticon picker looks like.
Screenshots at `../../../jamdom-vip-emoticons-{1,2,3}.png` (the project
parent folder — same place this session's other verification screenshots
already live, e.g. `01-home-390.png`).

Genuinely useful finding: the emoticon feature is a fixed catalog of ~25
named emotions ("Angry", "Big Smile", "Blush", "Confused", "Cool",
"Crossed", "Disappointed", "Sad", "Sarcastic", "Scary", "Sleepy", more
below the fold), each triggered by a typed colon-command (`:d`, `:(`,
`:@`, `(h)`...) or manual copy-paste from a table, rendered as a small
static bear-mascot face — and **every emotion ships in separate MALE and
FEMALE art**, a binary the player doesn't choose, it's inferred from their
account. That's the whole feature: 2005-era MSN Messenger emoticons,
reskinned as bears, gender-locked, typed by exact command string with no
autocomplete or error feedback if you fumble the syntax.

### Checked against what's already shipped — most of this is already done, and already better

Before proposing anything, I checked the current codebase, because
`0002_lounges_tiers.sql` and `lounges.ts` turned out to already be built
*directly against JamDom's VIP feature list*, with comments citing JamDom
by name:

| JamDom VIP feature (2012) | Yard's status |
|---|---|
| VIP-exclusive table mic | **Shipped, and structurally better.** `canSpeak()` gate, P2P mesh (`voice.ts`), zero vendor cost — see CLAUDE.md's Voice section. |
| Skip full lounges | **Shipped.** `lounges.ts:237`, comment: *"the single most-praised JamDom VIP perk, inverted into our gate."* `capacity` soft-cap + VIP bypass, sourced from `0002_lounges_tiers.sql`'s own comment referencing JamDom. |
| Bredrins list (friends), capped at ~40, only 14 shown, rotates on refresh | **Shipped, and strictly better** — `bredrins` table, comment: *"JamDom's most-loved VIP feature."* No arbitrary cap, no rotation gimmick — shows every bredrin with live per-lounge `last_seen`, all at once. |
| Tournament round-1 priority when a seat opens late | **Shipped, and provably better.** This *is* the substitutes-line mechanism (`tournament-queue.ts`'s `drawCutLine`) — server-authoritative, tested, deterministic. JamDom's version is presumably a human noticing a no-show; ours is a sort key nobody can dispute. |
| Emoticons for table talk | **Shipped, differently and better-aimed.** `REACTIONS` (6) + `QUICK_CHAT` (8) in `lounges.ts` — patois (`Tek dat`, `Six love`, `KMT`, `DWL`), on-brand flat-vector art per `art-direction.md`, tap-to-send (no typed syntax to fumble on a phone), gender-neutral, and — this is the one JamDom never had — **server-side anti-cheat awareness already designed in**: the code comment explains exactly why `QUICK_CHAT` is broadcast-only and shares one on-screen slot with reactions, so a private "ME/YOU/ANY" signal between partners can't be smuggled through it. |
| Private messages, one-way if the recipient isn't VIP | **Not built, already correctly planned** — `2026-07-29-partner-feedback-roadmap.md` §2.1 already has *"VIP can send private messages"* + *"nobody seated in a live hand may send or receive one, enforced server-side."* Don't redesign this, just build it — the anti-cheat framing is already right. |
| "Bling out" your profile page — custom HTML/CSS, self-hosted music, staff help required if you can't code it yourself | **Deliberately not chasing this.** Free-form CSS/JS injection on a page other players load is a real security hole (stored XSS), and "email us on Facebook for help" doesn't scale. The profile editor (avatar picker, `bio`, `origin`, `flag`, `gender` — see `0012`/`0014` migrations) already gives real self-expression without arbitrary code execution. This is JamDom's weakest VIP feature, not a bar to clear. |

### Genuinely new — not covered anywhere yet

1. **VIP Corner ("yearbook of VIPs with profile pictures")** — a static
   photo wall. Yard's `Red Carpet` lounge is already named for exactly
   this slot but nothing renders there yet. Proposal: a live wall, not a
   photo gallery — avatar (already built), current status (in a hand /
   in a lounge / away), and a stat line (current streak, or per-style
   rank once that ships). Static yearbook energy, live-data execution.
2. **Personalized greeting** — a custom recorded audio line per VIP,
   "takes a couple of weeks" because a human records it by hand. The
   product already has a library of real recorded patois lines
   (`raw/*.m4a` — `six-love.m4a` etc.) used for hand-result audio.
   Proposal: let a VIP **pick** a signature win-line from a small curated
   set at signup — instant, not a multi-week manual queue — rather than
   promising a bespoke recording per person, which doesn't scale past a
   few hundred VIPs anyway.
3. **Player search across lounges** — JamDom's version: type a name, hit
   search, get told if they're online. Yard already has live Realtime
   presence per lounge (that's how the roster renders today). Proposal:
   a single search box that queries presence across every lounge at
   once and jumps you there — strictly more than JamDom's per-lounge
   manual click-through, and cheap given the presence infra already
   exists.
4. **First-priority access to new features/lounges "for a week"** — the
   schema already has the exact primitive this needs (`lounges.min_tier`,
   same pattern as VIP-only lounges). Low priority, cheap later: gate a
   brand-new lounge or feature at `min_tier: 'vip'` for its first week,
   then open it. Not worth building ahead of having a second feature to
   actually gate.

### What NOT to build

The colon-command emoticon picker itself (typed `:d`, autocomplete, etc.)
is not worth chasing on its own terms — `REACTIONS`/`QUICK_CHAT` already
beat it for this product's actual primary surface (portrait phone,
thumb-reachable buttons beat typed syntax every time, per `client.md`'s
"portrait phone is the primary target"). The only place a typed, colon-
triggered picker would add anything is inside **free-text chat**, which
isn't built yet either (`2026-07-29-partner-feedback-roadmap.md` §2.1).
When that lands, a `:` -triggered autocomplete over the existing
`REACTIONS`/`QUICK_CHAT` catalog (not a new 25-entry emoticon set) is the
right scope — reuse the vocabulary that's already on-brand rather than
importing generic emoji, which `art-direction.md` explicitly rejects.

## 7. Visual personalization — yard-scene backgrounds (now) and video presence (deferred)

Two different features, deliberately split by risk. "Choose your
background" forked into two readings that point at genuinely different
architecture — resolving that fork here rather than conflating them.

### 7.1 Now — cosmetic yard-scene backgrounds

No new real-time infra. A handful of backdrop scenes (midday concrete
yard, evening string-lights, rain on a zinc roof — same register as
`yard-band.svg`, never postcard-tropical) as a personalization option for
a seat or lounge presence, generated once through the exact art pipeline
already governing avatars and reactions (`art-direction.md`'s flat-vector
template, generated by a local script, committed as static assets, never
called at runtime). Gate: `apps/web` already has the profile-editor
surface (`172cbe5`) to hang a picker off of, same pattern as the avatar
picker planned in §6.

### 7.2 Deferred (explicitly LAST) — actual video presence

**Not rejected — deferred by direct instruction, dead last in the
priority order (§4 item 9).** The
existing "voice is a peer-to-peer mesh, never an SFU" decision in
CLAUDE.md was scoped to *audio specifically* — it was never a video
decision. The reasoning does not transfer cleanly:

- **Pure P2P mesh means each seat uploads separately to the other three.**
  Audio at ~40kbps × 3 is trivial (under 150kbps upload), which is why
  free STUN + free-tier TURN covered it. Video at even modest quality
  (~500kbps–1Mbps) × 3 recipients is 1.5–3Mbps of simultaneous upload —
  a real problem on the mobile data this product is built for
  (`design.md`: "portrait phone is the primary target").
- **This is exactly the problem an SFU (upload once, server fans out)
  exists to solve.** The old "an SFU pays for itself above ~20 in a
  room" threshold was computed off audio vendor pricing. Video is billed
  meaningfully higher per minute by the same vendors (LiveKit, Daily),
  so that threshold does not transfer — a video SFU could conceivably
  justify its cost at a room size where audio's SFU never would, or it
  could still be unaffordable at four. Needs its own number, not reuse
  of the audio math.
- **Adoption risk independent of infra cost:** camera-on is a much
  higher social-friction ask than mic-on for a casual mobile domino
  game. Even built, opt-in could stay low enough to undermine the
  upgrade case the infra cost was justified against.

If this gets picked up later: background blur/replacement itself is
newly cheap (client-side WebGPU segmentation via MediaPipe/TF.js, zero
server cost for the effect itself) — the blocker was never the
background-replacement feature, it's the underlying video transport
economics. Scope any future work as "can we afford video transport at
all," not "can we afford background blur."

#### Real pricing, checked live against both vendors' own current docs (2026-07-31) — not estimated from memory

The question was specifically "what's the most cost-efficient way to do
this without lag." Fetched both vendors' pricing pages directly rather
than trust a summary:

| | **LiveKit Cloud** | **Cloudflare Realtime (Calls)** |
|---|---|---|
| Billing unit | Per participant-minute | Per GB egress |
| Rate | Free: 5,000 min/mo. Ship ($50/mo): 150,000 min included, then $0.0005/min. | $0.05/GB egress. **1,000 GB free/mo**, pooled with TURN. |
| Source | [livekit.com/pricing](https://livekit.com/pricing) | [developers.cloudflare.com/realtime/pricing](https://developers.cloudflare.com/realtime/pricing/) |

Worked example (my estimate, not vendor-published): a 4-seat table, 30
minutes, all four on video at ~500kbps/stream — deliberately modest
resolution, since nobody needs to read fine print off a domino table,
which is itself most of the cost lever:

- **LiveKit**: 4 × 30 = 120 participant-minutes/session → free tier
  covers ~41 sessions/month before any charge; ~$0.06/session beyond it.
- **Cloudflare**: SFU only bills Cloudflare→client egress (upload TO
  Cloudflare is free) — 4 recipients × 3 incoming streams × 30 min ≈
  1.35GB/session → free tier covers **~740 sessions/month**, ~18× more
  headroom than LiveKit's free tier, ~$0.07/session beyond it.

**Recommendation if this is ever built: Cloudflare, not a new vendor.**
Same per-unit economics once past free, dramatically bigger free
allowance, and it extends a relationship this app already has (TURN
today) rather than onboarding LiveKit/Daily from zero. This does not
change the priority — still last — it just means the "how" is answered
in advance for whenever "when" changes.

## 8. Open questions for Dr. Hunter

1. The doubling trigger (§2) — one-sentence answer needed before touching
   French scoring again.
2. Everything already open from the tournament debrief (unchanged,
   listed for completeness): disqualify scope, host-vs-admin, entry cost,
   guest-seating-when-full.
3. Video presence (§7.2) — worth commissioning a real cost model, or
   staying audio-only indefinitely? Not urgent; flagging so it's a
   deliberate choice rather than a default nobody revisits.
