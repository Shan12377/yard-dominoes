# Tournaments — debrief

**Status: v1 is LIVE in production.** Migration `0015`
(`20260729212747_tournaments`) is applied — confirmed via `list_migrations`.
`tournament-host` and `tournament-signup` are deployed and active at version 2;
`join-table` is at version 9 with the tournament-seat gate. A first host
(`Candy`, a real account) is set. Verified end to end against production on
2026-07-29, including the no-show/`clear` recovery path from §8's addendum:
drew a round, hit the "table never started" 409, cleared it, confirmed via
direct SQL the table went `abandoned` and the signups reset, redrew
successfully. All test data removed afterward.
**Source of requirements:** Wave 2.3 of
[the partner feedback roadmap](./2026-07-29-partner-feedback-roadmap.md), which
now points back here as the source of truth for what shipped.
**Migration applied:** `0015`.

> **This document was written before any code existed** and was kept as the
> working record through the build, including one false start (§10) and one
> post-ship bug fix (the `clear` action, §8). Sections below that read as
> forward-looking plan ("do this", "start with") describe what was in fact
> built, in the order it was built. Read them as history, not a TODO list.

Per the partner, this is *the* reason people buy VIP — a stronger pitch than
the microphone. Treat the queue rule as the paid promise it is.

---

## 0. Read this before you write a line

### `tables.tournament` is NOT a tournament

`tables.tournament` has existed since `0001` and it is a **rules flag**. It
means *the double-six must actually be led, not merely declared* — it feeds
`poseMustBeDoubleSix` in `packages/engine/src/set.ts:23` and is surfaced in the
UI as "Tournament — must lead the six" (`main.ts:544`). It is a property of how
a single table plays.

A tournament **event** — a Sunday, a sign-up list, two rounds and a final — is
an entirely different thing that does not exist anywhere in this codebase.

Do not overload the column. Do not name your new boolean `tournament`. A
tournament event will almost certainly *set* `tables.tournament = true` on the
tables it creates, and that is the whole of the relationship between them.

### There is no admin and no host role in this app

Grep confirms it: no `is_admin`, no `is_host`, no role column, nothing. Every
privileged write in this codebase goes through a service-role Edge Function.
You are adding the first notion of a privileged human, so get the shape right
the first time — see §4.

### `0012` protects you for free, but only if you leave it alone

`0012` revoked blanket UPDATE on `profiles` and re-granted it column by column;
`0014` extended the list to five columns. **A new column on `profiles` is not
writable by `authenticated` unless you name it in a grant.** So `is_host` is
safe by default.

The failure mode is a reflex `grant update (...)` that adds it "to be
consistent". `is_host` must never appear in that list, for exactly the reason
`tier` never does. After your migration runs, re-check:

```sql
select column_name from information_schema.column_privileges
where table_name = 'profiles' and grantee = 'authenticated'
  and privilege_type = 'UPDATE';
```

Expect the same five: `username, flag, bio, origin, gender`.

---

## 1. Ship a tournament you run by hand

The instinct here is a bracket generator, auto-advance from `sets.winner_side`,
seeding by rating, and a state machine. Resist all of it until one real Sunday
has been played.

Sundays, two rounds plus a final, small numbers, and a trusted human host who
already knows who won. What that human cannot do without software is:

1. take sign-ups before the event
2. order the queue so VIPs actually jump
3. see the ordered list, and see where the cut line falls
4. tell everybody at once that round two starts in five minutes

That is the whole of v1. Everything else is a human clicking. Auto-advance is
cheap to add *later* because the results are already in `sets` — and by then
you will know which of your bracket assumptions were wrong.

---

## 2. Schema (`0015_tournaments.sql`)

### `tournaments`

The event. Reads mostly like a `tables` row's calendar entry.

| column | notes |
|---|---|
| `id` | uuid pk |
| `lounge_id` | fk `lounges`. See §3 — this is a seed row, not new code |
| `name` | e.g. "Sunday Six Love" |
| `mode`, `format`, `seat_count` | passed straight to `create-table` later |
| `starts_at` | timestamptz. The countdown reads this |
| `signups_open_at` | nullable; null = open as soon as announced |
| `rounds` | smallint. The stated shape is two rounds plus a final, so `3`. Not used by v1 — the host decides — but cheap to record now |
| `status` | `announced` / `signups_open` / `seating` / `running` / `finished` / `cancelled` |
| `notice` | text, nullable. The intercom — see §5 |
| `host_id` | fk `profiles` |

RLS: readable by everyone. No client write policy at all.

### `tournament_signups`

| column | notes |
|---|---|
| `tournament_id`, `user_id` | composite pk — one signup per person, enforced by the key |
| `signed_up_at` | `default now()`, **server-set** |
| `tier_at_signup` | snapshot, for dispute resolution only. **Never used for ordering** — see §6 |
| `status` | `signed_up` / `seated` / `substitute` / `out` / `disqualified` |
| `round` | smallint, nullable |

RLS: readable by everyone — the queue is public on purpose, because *seeing
three VIPs ahead of you* is the sales pitch. No client INSERT policy; sign-up
goes through an Edge Function so the open/closed check and the timestamp both
live server-side, consistent with every other write in this app.

A player may withdraw themselves. That is the only client-initiated change, and
even it is easier to route through the same function than to write a DELETE
policy you then have to reason about.

---

## 3. The tournament lounge is a seed row

`lounges` already has `slug`, `name`, `description`, `mode`, `min_tier`,
`capacity`, `sort_order`, and `0002` seeds five of them. A tournament lounge is
one more `insert`. It needs no new table, no new view, no new presence channel —
the lounge channel is already open, already synced, and already carries voice,
reactions, quick chat, and the `table` presence field.

`min_tier` stays `guest`. The tournament is not a paid room; the *queue* is
where VIP pays off. Locking guests out of the lounge would delete the audience
that watches VIPs jump the line, which is the mechanism that sells VIP.

---

## 4. The host role, scoped so it cannot grow

Requirement: trusted people can run tournaments **without any access to coins or
billing**.

Do this with `profiles.is_host boolean not null default false` and **no new
grants, no new RLS policies, and no new Postgres role.** Every host action is an
Edge Function that checks `is_host` server-side and touches only `tournaments`
and `tournament_signups`. A host therefore holds exactly zero database
privileges they did not already have as an ordinary player.

That is the narrow scoping the requirement asks for, and it is narrow by
construction rather than by discipline. A Postgres role, by contrast, is a thing
someone widens later with one `grant`.

`is_host` is set by you in SQL. There is no UI for making hosts, and there
should not be one until there is a reason.

**Host ≠ admin.** The host runs the Sunday. Recommended split for the penalty
requirement:

- **Host** may set `status = 'disqualified'` on a signup in *their own*
  tournament. That strips the player's runs in that event.
- **Ratings in `profiles.rating_partner` / `rating_cutthroat` are not touched.**

"Strip a player's runs" is ambiguous between those two and the difference is
large — one is a Sunday result, the other is a permanent record. **Ask Dr.
Hunter which she meant before building the second one.** Defaulting to the
smaller blast radius is correct while the question is open.

---

## 5. The intercom is one text column

Requirement: admin can broadcast to the tournament.

`tournaments.notice text` — the host writes it, everyone in the lounge sees it
as a banner. That covers "Round 2 starts in 5 minutes", which is what an
intercom is actually used for.

Do not build a message table, a second Realtime channel, or an announcement
history. If they later want scrollback, `lounge_messages` already exists as the
shape to copy — but a history of five messages that all said "five minutes" is
not worth a table today.

**Do not implement this as a Realtime broadcast event.** Broadcast is
peer-to-peer, so a patched client can claim to be the host and put words in her
mouth. A column written by a host-checked Edge Function and read by everyone
cannot be forged. This is the same reasoning that keeps every game write on the
server.

---

## 6. The queue rule — the part that must be exactly right

> A VIP who signs up at 4:30 gets a seat ahead of a regular who signed up at
> 9am.

```
order by tier_rank(effective_tier(p)) desc,
         signed_up_at asc,
         user_id asc          -- ties must be deterministic
```

Three things about this, each of which is a bug if you get it wrong:

**Use tier at seating time, not `tier_at_signup`.** Someone who signs up as a
guest at 9am and buys VIP at 4:30 *does* jump — that is precisely the moment the
upgrade sells itself, and it is the behaviour the partner described. Store
`tier_at_signup` anyway, but only so you can answer "why was I bumped" three
weeks later. Never order by it.

**Use `effective_tier()`, not `profiles.tier`.** It already exists
(`0002_lounges_tiers.sql:26`) and it is what makes an expired membership stop
counting. `join-table` and `create-table` both use it via
`_shared/lib.ts`. A raw `tier` read here would let a lapsed VIP jump the queue,
and it would be the *only* place in the app that does.

**One implementation of the ordering, not two.** The player's "you are #14, with
3 VIPs ahead of you" and the host's seating pass must be the same ordering or
they will disagree on the one day it matters.

*Revised — the first draft of this document said "one SQL view or one function
read by both", which is wrong in this codebase.* `apps/web` imports nothing from
`supabase/functions` (checked: zero matches), so anything living in `_shared/`
is out of the browser's reach and the client would end up with a second copy.

The actual answer is simpler: **the browser never sorts.** The server computes
each entry's position and the client renders the number it is handed. There is
no duplication because the client does not implement the rule at all. That also
keeps the ordering inside the service-role boundary, consistent with the rest of
this app, where the client is never the thing that decides.

Everyone past the last full table is the **substitutes line**. The number of
tables is derived from turnout, not declared by the host — 11 people in fours is
two tables and three substitutes. That is
already a promised VIP benefit — `lounges.ts:59` sells "Front of the tournament
substitutes line" today — and the same ordering delivers it for free. It is one
ordered list with a cut line drawn across it, not two lists.

### This part is done

`supabase/functions/_shared/tournament-queue.ts` — pure, no Deno, no network, so
`npm test` covers it (the same split `billing.ts` uses). Two functions:

- `queueOrder(entries, now)` — the sort above
- `drawCutLine(ordered, seatCount)` — full tables of humans, everyone else a
  substitute

18 tests in `tournament-queue.test.ts`, covering all five cases this section
originally listed plus the upgrade-jumps-the-queue case, unknown tier strings,
and a sweep asserting no table is ever short and nobody is lost across every
turnout from 0 to 40.

**Only full tables of real people play.** The alternative — spread everyone
across `ceil(n / seatCount)` tables and pad with duppies — was written and
rejected (§11). A Sunday where a quarter of the seats are bots is not a
tournament, and a bot would be deciding which humans go through. The overflow is
not waste; it is the substitutes line, which is already on the pricing page.

A consequence to carry into §8: fewer entrants than one full table means no
tables at all. Partner mode needs exactly four seats — `create-table` rejects
anything else and `sideOf()` would split three seats into a nonsensical 2-vs-1 —
so three people is not a small tournament, it is not a tournament. Cancel.

---

## 7. Sign-up flow and the banner

- The banner queries the next `tournaments` row with `starts_at` in the future
  and `status` in (`announced`, `signups_open`). No new backend.
- Countdown from `starts_at`, client-side.
- **The banner must not flash.** More than three flashes per second is a
  seizure risk and fails WCAG 2.3.1. Use a slow pulse, and honour
  `prefers-reduced-motion` by rendering it static. "Flashing banner" in the
  requirements means *make it impossible to miss*, and a bold static banner
  achieves that without the hazard.
- After sign-up the banner becomes the queue position, because that is the
  screen that sells VIP: **"You are #14. Three VIPs are ahead of you."**

### Do not build a recurrence scheduler

Sundays are the regular slot, but the host creating each week's row is thirty
seconds of work and zero code. `pg_cron` is already available if this ever
becomes tedious (see `0005_expire_turns_cron.sql`), so the door is open. It is
not open yet.

---

## 8. Seating

When the host starts the event, run the queue through `queueOrder` then
`drawCutLine`, and for each full table call the existing `create-table` with
`tournament: true` and `lounge_id` = the tournament lounge.

Note that `create-table` currently seats **the caller** at seat 0
(`create-table/index.ts:58`) and `join-table` requires the *joining user's* auth
(`join-table/index.ts:6`). Neither can seat a third party. So one of:

- the host creates the table and players are told to sit (each calls
  `join-table` themselves — lazier, and it naturally proves they are present,
  which is a real problem at 9am on a Sunday); or
- a new host-only Edge Function that writes `seats` rows under the service role.

**Start with the first.** "Your table is ready, go sit" is one line of UI, and a
player who does not turn up to claim their seat is exactly who the substitutes
line exists for. Auto-seating an absent player is worse than not seating them.

### A host must be able to un-draw a round

Found by review after v1 shipped, and fixed: **nothing in this codebase ever
writes `tables.status = 'abandoned'`.** The enum value has existed since `0001`
and no code path sets it. A table only reaches `finished` when a set completes
through `play-move` or `expire-turns`, and `expire-turns` walks *hands*, so a
table where no hand was ever started is invisible to it.

The draw guard refuses a new round while any of the event's tables is `waiting`
or `playing`. Put those together and a table nobody turned up to sits at
`waiting` for ever and blocks every future draw, with no host action able to
clear it — recovery through a database console, which §4 says a host must never
need. No-shows are not an edge case; the substitutes line exists because they
are expected.

The same dead end has a second entrance: the draw is a sequence of separate
writes with no transaction, so a failure partway leaves live tables behind and
the retry hits the same guard.

`tournament-host`'s `clear` action abandons only `waiting` tables — never a hand
in play, which is `expire-turns`' business — and returns those players to the
queue. Players are updated before tables, so a failure between the two leaves
people re-queued and tables still dead, which clearing again fixes; the other
order strands players pointing at a table in no round.

---

## 9. Definition of done for v1 — all done, shipped, verified in production

- [x] **Done.** `0015_tournaments.sql`, applied (`20260729212747_tournaments`).
      `profiles` UPDATE grant confirmed still exactly five columns; `is_host`
      absent, as designed.
- [x] **Done.** Tournament Yard lounge seeded.
- [x] **Done.** `tournament-signup` Edge Function (enter / withdraw / status),
      server-set `signed_up_at`. Deployed, version 2.
- [x] **Done.** Host functions in `tournament-host`: create, notice, open/close
      signups, start (draw), mark (out/disqualified/reinstate), finish, cancel,
      plus `clear` (added post-ship, §8) — every one checking `is_host`
      server-side. Deployed, version 2.
- [x] **Done.** `tournament-queue.ts` + 18 tests — the queue rule and the cut
      line. Three tier bands, `effective_tier` semantics, evaluated at seating
      time. The server computes position; the browser never sorts.
- [x] **Done.** Banner + countdown in `countdown.ts`/`tournamentview.ts`, no
      flashing, `prefers-reduced-motion` honoured.
- [x] **Done.** Queue position and VIPs-ahead-of-you visible to the player —
      `Standing` in `_shared/tournament.ts`, 15 tests of its own.
- [x] **Done — verified in production, 2026-07-29**, including the failure
      path the `clear` fix exists for: real tournament, real signups, a drawn
      round, the "table never started" 409 confirmed, `clear` confirmed by
      direct SQL (table → `abandoned`, both signups → `signed_up`/`null`/
      `null`), redraw confirmed to succeed. Test data removed afterward. Not
      run with two simultaneous isolated clients at the same table the way
      Wave 1's spectator/quick-chat items were — worth doing before a real
      Sunday with real turnout, since that class of check has caught real bugs
      here before.

## 10. The false start, and what it cost

A first attempt (2026-07-29) produced `supabase/functions/_shared/bracket.ts`
and its tests in an isolated worktree. **It was branched at `1298711`, one
commit before this document existed at `cb17cb8`, so it never had any of the
above.** Nothing shipped, nothing was committed, no migration ran. Recording it
because four of the five mistakes are ones anyone would make from the
requirements alone.

**It built the deferred half first.** `advancersFrom`, `roundComplete`,
`tournamentIsOver`, multi-round seeding — the bracket state machine §1 says to
resist until one real Sunday has been played, written before signup, the queue,
the host role or the intercom existed.

**Two priority bands instead of three.** `0` for VIP, `1` for everyone else,
which sorts a paying Yardie level with a free guest.

**A stored generated column for priority.** The stated intent — write the rule
down once so the client's list and the server's seeder cannot disagree — is
exactly right, and is why §6 exists. The mechanism cannot work: a Postgres
generated column may only reference its own row and must be immutable, so it
cannot read `profiles.tier` at all. Any such column necessarily freezes a copy
of the tier at insert, which is `tier_at_signup` ordering — the precise
behaviour §6 rules out, arrived at by a route that looks like the right idea.

**`effective_tier()` bypassed**, so an expired VIP would still jump.

**Duppies instead of substitutes.** `seatAssignments` spread players evenly and
padded the gaps with bots, deleting a VIP benefit the app sells today.

The salvage: `tournament-queue.ts` keeps the deterministic `userId` tiebreak and
the returns-a-new-array discipline, both of which that draft got right and both
of which are load-bearing. The bracket half is not lost either — it is written
down here, and it will be easier to build correctly once a real Sunday has shown
which of its assumptions were wrong.

**The process lesson, which is the general one:** a worktree cut before a
planning document exists cannot follow it. Rebase the worktree onto `main`
before starting, and check the plan file is actually present.

## 11. Open questions for Dr. Hunter

1. Does "strip a player's runs" mean the tournament result only, or rating
   points too? (§4 — defaulting to the smaller one.)
2. Can a host disqualify, or admin only?
3. Is there an entry cost? Nothing above assumes one, and coins do not exist
   yet (Wave 3).
4. Does a guest with no membership get a seat at all if VIPs and yardies fill
   the tables, or is the substitutes line the honest answer?
