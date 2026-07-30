# French — scoping debrief (2026-07-30)

Follow-up to the openhand debrief pattern. The instruction was "now do the
french." I spent the session researching the actual rules (pagat.com, plus
what Dr. Hunter typed) rather than shipping code, because French isn't the
small variant the roadmap made it look like. What follows is what French
actually is, what it costs to build honestly, and the one question that
decides whether we ship *anything* French this month.

## What French actually is (Jamaican play, confirmed by both sources)

- **Four players, cut-throat.** Standard 28-tile set, 7 each. (Partner
  variant exists but the source describes cut-throat as the base form.)
- **Cross-shaped board, not a line.** The pose (double) opens a four-arm
  cross. The four blanks — one per arm — must be played before any other
  tile. Each arm's next tile after that must be the matching double before
  the arm can extend further.
- **The chucha (double-blank) opens round 1.** In later rounds the winner
  poses any double they choose, or the chucha again if they hold none.
- **Losers score, winner scores zero.** At hand end each player adds their
  remaining tile pip total to their running score.
- **Doubles in your hand double your score for the hand.** Left with any
  doubles: your pip total for that hand is × 2. Left with more than one:
  still × 2 (not × 2^n; this is Dr. Hunter's read and matches most sources).
- **First to 100+ LOSES.** The player(s) at or over 100 at hand end are
  out. Play continues until one player remains under 100 — they win.
- **Blocked hand:** lowest pip count wins, others score their pips as
  above.

Coin-tied shuffle (2026-07-29 spec, settled, in memory):

- **Trigger at 50** (configurable 50-70, partner recommends 50).
- 2 coins auto-deducted, blind, re-deals YOUR hand only, 10 seconds, once
  per player per set, both sides get the chance.
- Verifiable — the re-deal lives inside the commit-reveal scheme so the app
  can prove the paid re-shuffle wasn't rigged. This is the trust lever.

## Why this is not a small variant

The current engine's `Board` is `{ line: PlacedTile[], leftEnd, rightEnd }`
— one line, two ends. Every legal-move check, every render, every bot,
every replay, every share-URL codec, every animation assumes that shape.

French needs:

1. **New board topology.** Four arms rooted at a central double, with a
   per-arm sequencing rule ("blank first, then the matching double, then
   free"). This is not an extension of `Board`; it's a second shape. Every
   consumer of `Board` needs to switch on which shape it holds, OR the
   engine grows a second board type and the client renders it separately.
2. **Inverted scoring model.** Current `SetState` has "winner side gets
   handValue points, first to 6." French has "every seat accumulates its
   own losing pips, first to 100 is out." `scores: number[]` still fits,
   but `winnerSide` / `sixLove` / `handValue` / `oneAllPlayTwo` /
   `playoff` are all sixlove/firstToSix ideas that don't apply. Needs
   either a discriminated union on `SetState` by format, or a per-seat
   "eliminated" flag and a new winner-detection rule.
3. **Elimination model.** A hand still plays after one seat is out — with
   fewer active seats, or with the out player sitting. Current engine
   assumes every seat plays every hand of the set.
4. **Coin-tied shuffle mechanic.** Depends on the coin economy, which is
   not shipped. A shuffle without coins is fine offline but ships the
   feature with a mismatch: online rooms get a free trust-feature the
   partner priced at 2 coins.
5. **New pose rule.** Chucha (0-0) opens round 1, not double-six.
   Straightforward to add via `poseMustBeChucha` alongside the existing
   `poseMustBeDoubleSix`, but it is another branch in `hand.ts`.
6. **Coach's evaluation.** Reads "target = 6"; French reads "target = 100
   and LOWER is better." Coach's blunder detection, review UI, and grade
   thresholds all inherit from the current scoring shape.

For scale: openhand was two engine files, one migration, three test
invariants, no board changes. French is at least six files, a probably-new
board type, and a full new set of engine tests to pin down the four-arm
sequencing rule and the elimination invariants. It's roughly the size of
"tournaments" all over again, if not larger.

## The gating question

**Do we ship the coin economy before French, or ship French without the
shuffle?**

Coin economy first (option A):
- Order: coins (Stripe IAP, wallet table, spend/refund RPCs, no-cash-out
  guardrails) → French engine → French shuffle wired to coins.
- Pros: French ships whole, the shuffle is the differentiator, ToS text
  updates once. The partner's whole point about the shuffle was that
  it's the revenue lever AND the trust lever — losing it strips the
  business argument for the mode.
- Cons: coins is its own multi-session build (payments, ledger, RLS,
  refund flow, anti-abuse). French waits.

French first, no shuffle (option B):
- Order: French engine (cross board + scoring + elimination + chucha
  pose) → coins later → shuffle later.
- Pros: French mode is playable, the roadmap ticks the box, coins isn't
  blocking play.
- Cons: two announces instead of one, coin ToS work does not overlap with
  engine work, and the mode ships without the feature the partner
  identified as its whole business point.

If it were only me: **Option A**, because the shuffle is what makes French
worth building at all. But this is Dr. Hunter's call and the answer changes
the entire order of work.

## Not-decided-yet (small, wait until we pick A or B)

- Cross-board renderer (SVG or CSS grid?) — decide after topology is real.
- Should partner-mode French exist? The Jamaican source describes only
  cut-throat, and pip totals aggregated by side lose the "you're out at
  100" personal-elimination feel. Default: cut-throat only for v1.
- Doubles-double: is it × 2 flat or does each double double? Sources
  disagree. Default: flat × 2 (matches what Dr. Hunter typed).
- Blocked-hand tie: replay at higher value like sixlove, or split? Default:
  no replay — everyone scores their pips, the tied lowest counts count
  their pips too, nothing wins.

## What I did NOT ship

No code. No migration. No enum extension. No half-French mode. Shipping
`format = 'french'` as a stub while the board and elimination logic aren't
there is a bug shape: an existing table could be created French, no hand
could ever be played, and a rollback becomes another migration. Once the
gating question is answered I'll ship the full thing.
