# Open Hand ("Ol' Man") — scoping debrief

**Status:** not started. This is the scoping document, written before any code
touches the engine.
**Source of requirements:** Wave 2.2 of
[the partner feedback roadmap](./2026-07-29-partner-feedback-roadmap.md), which
says exactly one useful thing about it: *"The player across from you sees your
hand. Affects the engine's information model, every duppy's decision function,
and the anti-cheat story. Scope carefully."*

This is the hardest item in the whole roadmap. It changes what a seat KNOWS at
every hand — a foundation of the engine — and it is the one place cheating
suspicion could actually take root. Do not start coding until §0 and §1 are
answered.

---

## 0. Read this before you write a line

### The anti-cheat invariant that MUST survive

`packages/engine/src/bots.ts` opens with a promise that is load-bearing for the
whole product:

> Difficulty scales by DEPTH OF REASONING, never by information. Every tier
> receives the same `PublicView` — a structure that contains the bot's own
> hand, the board, the move log, and opponents' hand SIZES, and which has no
> field capable of holding another seat's tiles.
>
> That is deliberate. "The computer cheats" is the most corrosive complaint in
> this category, and the only durable answer is an architecture where cheating
> is not expressible.

Open Hand appears at first read to require breaking this. It does not. In Open
Hand the human partner also sees the same tiles, so a partnered bot given a
`partnerHand` field is not cheating — it is receiving information the rules
grant it. The invariant restated: **a bot may only ever see information a human
in that seat, playing this mode, would also see.**

If you find yourself writing code that gives a bot more than its human
counterpart would see — including a cutthroat opponent's hand in Open Hand, or
a partner's hand in ordinary partner mode — stop. That is the corrosive bug.

### The three information models this app already has

Before adding a fourth, count what exists:

1. **Cutthroat** — each seat sees only its own tiles.
2. **Partner** — each seat sees only its own tiles.
3. **Duppy** — the bot's `PublicView` (its own tiles + public state) — the same
   information a human in that seat would have in modes 1 or 2.

Open Hand adds:

4. **Partner-visible** — each seat sees its own tiles AND its partner's tiles.

That's the whole engineering task, and everything below is how each layer
(engine, database, client, bots) implements #4 without silently opening a peek
into #1 or #2.

### `tables.tournament` warning, restated for this feature

`tables.tournament` is the double-six rule and is unrelated. Do not name any
column or type here `open` on its own — it will read as opposite of `closed`
which is a `table_status` value. `open_hand boolean` on `tables` and
`GameMode = 'cutthroat' | 'partner' | 'openhand'` (one word) throughout.

---

## 1. What "Open Hand" actually means — RESOLVE BEFORE CODING

This is not settled and the engineering is wasted if it lands wrong. Dr. Hunter
must pin down which of these she means:

**A. Partner-open.** In partner mode, each seat sees their partner's tiles and
nothing else. Cutthroat opponents remain hidden. This is the version the
roadmap describes ("the player across from you") and the version this debrief
assumes throughout unless flagged otherwise.

**B. Ol' Man = one seat is exposed.** One player plays with their hand exposed
to *everyone*, chosen by draw or by the loser of the last hand. Different game
entirely: not paired-with-my-partner, but a single-seat visibility change with
a different social dynamic (mocking the exposed player, coaching them, etc.).

**C. Both.** Two variants under one banner. Doubles the engineering.

I'm assuming **A** throughout the rest of this document. If Dr. Hunter says B
or C, most of §3 changes and §5 (bots) changes completely — a bot playing with
its hand exposed to every human at the table has a strategy problem I would
not know how to specify without asking a player who has actually done it.

**Second question:** does exposure last a whole set, or reset each hand? The
strategy conversation between partners is completely different if it's the
former (long-run planning) versus the latter (this-hand tactics).

**Third question:** are non-partners allowed to say anything about what they
saw? In casual play at a real table this is understood conduct; in an online
product with an anti-cheat story, "you saw my hand and told your partner over
Discord" is a category of complaint we cannot receive without an answer.

Everything below assumes A, whole-set exposure, and a "no comments across
sides" rule that is enforced only socially (nobody will build a bot to detect
Discord). If any of those change, come back here.

---

## 2. Engine — the smallest change that works

Assuming resolution A above.

### `types.ts`

```
export type GameMode = 'cutthroat' | 'partner' | 'openhand';
```

Every existing `sideOf`, `sideCount`, `seatsOfSide` already works: `openhand`
uses the same seat-to-side mapping as `partner` (0&2, 1&3). The mode name
carries the visibility change; nothing about pairing or play order differs.

`HandState.hands` and `HandState.mode` do not change. The engine's own state
has always been full-truth — the redaction happens at `PublicView` and at the
`hand_public` view.

### `bots.ts`

Extend `PublicView` with **one** field, present only when the mode grants it:

```
export interface PublicView {
  // ... existing fields ...
  /**
   * Set only when the mode grants a seat sight of its partner. `undefined`
   * everywhere else — the type on its own reads out the anti-cheat invariant:
   * an opponent's tiles are never in this shape.
   */
  partnerHand?: TileId[];
}
```

Two places to fill it: in `bots.ts` when a bot's `HandState` view is prepared
for it (currently the stub-state trick around line 299 — extend it to include
partner's real tiles when `mode === 'openhand'`), and in `PublicView`
construction for the human at the client (a mirror of the same trick).

**Anywhere the field is *read*, assert the mode.** The right shape is a helper
that returns `TileId[] | null` given a view and only returns tiles when
`view.mode === 'openhand'`, so a duppy strategy function that forgets and reads
`view.partnerHand` directly under partner mode gets a compile-friendly `null`
instead of leaking a peek from a test fixture that happened to fill the field.

### `hand.ts`, `set.ts`, `stateFromDeal`

No changes. The rules of play are unchanged — you still play a matching pip,
you still pass when you can't, the six-love scoring is untouched. Only what
each seat *sees* changes.

### Test coverage

The rule tests are all in packages/engine/test and cover `HandState`, which
does not change. Add one dedicated test file, `openhand.test.ts`, that asserts:

- `PublicView` for `mode: 'openhand'` includes `partnerHand`, and it matches
  `HandState.hands[partnerSeat]` at every point in a hand.
- `PublicView` for `mode: 'partner'` does not include `partnerHand`, ever.
- `PublicView` for `mode: 'cutthroat'` does not include *any* opponent's tiles
  under any mode variation.

The last one is the anti-cheat invariant as an executable test. It should have
existed already — write it either way.

---

## 3. Database — the visibility channel

`seat_hands` today has one policy:

```
create policy "you may read only your own tiles"
  on public.seat_hands for select using (user_id = auth.uid());
```

Open Hand needs a partner to read the partner's row. Three ways, in
increasing order of build cost:

**A. Widen the RLS policy.** Add an OR clause: you may also read a row whose
seat's partner in your side is you at the same table. Concretely: for the
signed-in user, find their seat at the table; the row is readable if the
target seat is that seat's partner AND `tables.mode = 'openhand'`.

*Why this is the lazy answer:* one migration, one policy, no new tables, no
new Realtime channels. Every existing read path (initial load, subscription
delta, re-fetch on 409) works unchanged because it goes through the same view.

*The risk:* RLS policies with joins across three tables are the ones most
likely to be wrong in a way that isn't caught by manual testing. Review the
policy against `should not be able to read` cases first, not `should be able
to`, and write pgTAP tests if we ever land any (nothing else in this repo
uses them today).

**B. A separate `partner_hands` broadcast.** Table gets written by the server
alongside `seat_hands` with an explicit `visible_to` list. Simplest to reason
about ("who can read row X? whoever is in `visible_to`"), most rows to write.

**C. Client filter.** Read all `seat_hands` for the table, filter on the
client. **Do not do this.** Trust boundaries live on the server; RLS is the
security model here and any read that returns tiles a client should not have
seen is a leak, whether or not the UI decides to display them.

**Start with A.** Write the policy, cover it with an integration probe — two
real accounts, one at seat 0, one at seat 2, one at seat 1 — and confirm all
three of the visibility rules in §2's test list at the DB level too.

### The mode-change race

`tables.mode` can in principle be updated. Today nothing writes it after
creation, but the policy A above should read the mode value from the *hand*
being read against, not the current table state. Otherwise switching a table
from openhand to partner mid-set would retroactively expose all the historic
`seat_hands` rows.

The safest form: add `mode` to `hand_public` (or `hands`) and have the policy
read from there. It denormalises but the denormalisation is a fact that was
true when the row was written, which is what we want.

---

## 4. Client — rendering partner's hand

Currently `OnlineGame.myTiles` is one array. Add `partnerTiles: TileId[] | null`
alongside it, populated by the same fetch that populates `myTiles` — the
extended RLS policy from §3 lets a partner's row come back in the same query
that returns yours.

Render partner's hand *above* the seat card, small, non-interactive — a strip
of tile faces sized somewhere between "clearly visible" and "not competing
with your own hand for attention". The current `.tile` styles at `--sm` scale
should be near right.

### The subtle client bug worth watching for

When your partner plays a tile, `partnerTiles` needs to update from the same
Realtime event that updates `hand_sizes` on `hand_public`. In `partner` mode
today the tile count going from 6 to 5 is enough visual feedback; in Open Hand
the tiles panel becoming *incorrect* between events is worse than useless —
you'd play a matching tile off information that already changed.

The cheap answer: on every `onPublic` event, also refetch `seat_hands` for the
partner's seat (when in openhand). That is one extra small round-trip per
move. The right answer is subscribing to `seat_hands` for the partner's row
via Realtime, same shape as the existing `onMyTiles` handler.

Do the cheap answer first. Every time this repo has picked the "one channel
per subscription" answer over "refetch on tick" it has cost more than it saved
(see the tournaments countdown comment in `tournamentview.ts` — same tradeoff
in the other direction, decided the same way).

---

## 5. Duppies — the strategy problem

This is where the estimate gets soft. The current duppy tiers each have a
decision function that reasons from partial information: what's still out,
who has passed on what, hand-size pressure. Open Hand hands the bot a whole
new class of certainty: *I know what my partner is holding.*

There are two ways to spend that.

**A. Coordinate.** Play tiles that set up my partner's next turn. Don't play a
tile that ends on a pip my partner is void in. Save a tile that will let my
partner close out a domino.

**B. Ignore it.** Play the mode as if the tiles weren't visible. Correct code,
obviously beatable — Open Hand becomes the "duppies are worse here" mode,
which is fine as a launch position because *humans playing humans* is the
point of the mode.

**Start with B for pickney and yard.** They should feel indistinguishably
naïve in every mode; a "cooperating pickney" reads as a bug. Consider A only
for `ranker` and above, and only if a human report says the higher tiers feel
noticeably dumber than in partner mode. This is speculative territory — do not
build A on speculation. Build B, ship, and let the reports drive whether A is
worth building.

**Anti-cheat corollary for B.** A duppy playing mode B is receiving `partnerHand`
in its view and ignoring it. That is fine — the field is present because the
rules of Open Hand permit it, and a lazy strategy is not a leak. The invariant
in §0 is about information flow, not information use.

---

## 6. Definition of done for v1

- [ ] `GameMode = 'cutthroat' | 'partner' | 'openhand'`, tests for §2's three
      visibility properties pass.
- [ ] `PublicView.partnerHand` populated only in openhand.
- [ ] Migration widens `seat_hands` RLS as described in §3, or adopts §3 B if
      that policy proves too hard to prove correct in review.
- [ ] The three visibility properties from §2 are also verified at the DB level
      with two real accounts at the table (seats 0 and 2) and one at seat 1.
- [ ] Client renders partner's tiles when the mode grants it, and stays in
      sync with plays (refetch-on-tick, per §4).
- [ ] `bots.ts` compiles and passes with `partnerHand` in `PublicView` and
      strategy option B (ignore the field). No tier receives partner
      information unless the mode grants it — assert this in `bots.test.ts`.
- [ ] `create-table` accepts `openhand` and gates it: openhand implies four
      seats (same as partner). Reject anything else with 422.
- [ ] UI to pick openhand in the New Table form, next to partner and
      cutthroat, one word: "Open hand".
- [ ] Verified with three real isolated clients, not tabs — the same standard
      Wave 1 and tournaments both used, and for the same reason (a `channel.
      track` replace-not-merge bug or an RLS blind spot won't show under one
      session).

Deliberately out of scope for v1: French mode (separate item), open-hand
strategy A (see §5), and any UI that "hides" a hand you're entitled to see.

## 7. Open questions for Dr. Hunter

1. **Which of A/B/C in §1?** Nothing below §1 is buildable without this.
2. **Whole-set exposure or per-hand?** (§1)
3. **A social rule about non-partners commenting on what they saw?** (§1) — I
   assume "yes but not enforced" and will not build enforcement unless told.
4. **Should this be VIP-gated?** Tournaments explicitly are not, because the
   queue is the pitch; Open Hand has no similar mechanic and could reasonably
   be a Yardie or VIP benefit. Default: free for everyone, but ask.
5. **Cutthroat + open hand at all?** This document assumes no — partner-open
   only. Cutthroat has no partner; "everyone exposed to everyone" is variant
   B in §1, which is a different game.

## 8. Effort estimate, honestly

Given the tournaments precedent, and that this is engine work rather than
tables-plus-functions work:

- With decision A, whole-set, no strategy-A bots: **one focused session**
  (small engine change, one migration, one client refetch path, one form
  control). The DB policy is the risk.
- With decision B (Ol' Man = one exposed seat): **rethink from §2 down**;
  the debrief above does not describe this variant and would need rewriting.
- With decision A plus strategy-A bots: add another session per tier that
  gets the cooperating strategy.

The fair thing to tell Dr. Hunter is that partner-open is a genuinely small
build once the rules are pinned down, and the delay so far is precisely
because the rules aren't pinned down. Answering §7 is what unblocks it.
