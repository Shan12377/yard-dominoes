---
paths:
  - "packages/engine/**/*.ts"
---

# Engine rules

Pure functions, zero dependencies, no I/O. This code runs in three runtimes —
browser, Deno, Node — so anything runtime-specific breaks two of them.

## Never

- Import from `node:*`. Use Web Crypto (`crypto.subtle`, `crypto.getRandomValues`).
- Add a dependency. Ask first.
- Mutate the state you were given. `applyMove` clones via `clone()`; if you add
  a field to `HandState`, add it to `clone()` in the same commit or you create a
  shared-reference bug that only shows up in the Coach's replay.
- Renumber Academy lesson ids. `coach.ts` references them as strings
  ("Belt 4 · Lesson 1") and a test asserts every reference resolves.

## Tile identity

Tile ids are canonical low-high strings: `"2-5"`, never `"5-2"`. Everything
uses `includes`, `filter(t => t !== tile)`, and `Set`, so a non-canonical id
silently fails to match instead of throwing. Always build ids with `tileId()`.

`suitStrength` counts a double **once**, not twice — `['3-3']` gives the 3 slot
a value of 1. Doubling it would make the bots overrate doubles.

## Traps that have already bitten

- **`knownVoids` reads `move.ends`, which `applyMove` stamps onto a pass.** If
  you construct a pass move by hand without `ends`, void detection silently
  returns nothing — no error, just bots and Coach going blind. Never fabricate
  a pass; go through `applyMove`.
- **A blocked hand ties when two or more seats share the lowest count.** Check
  for multiple minima; `counts.indexOf(min)` alone hides ties.
- **`handValue` resets to 1 after a decisive hand and increments after a tie.**
  Resetting on a tie destroys the escalating replay rule.
- **Six love holds an invariant: at most one side has points.** If you touch
  `applyHandResult`, keep the test that walks a long sequence asserting it.
- **`draw` does not end the turn.** `applyMove` returns early for it. A draw
  that advances the turn strands a player who still has to play.
- **Two-handers with a boneyard may not deal the 6-6 at all.** `findOpener`
  falls back to highest double, then heaviest tile. Do not reintroduce a throw.
- **Coach `memoKey` must include `consecutivePasses`.** Drop it and two
  positions that differ only in how close the board is to blocking collapse
  into one cache entry, producing wrong grades.
- **`sampleConsistentDeal` returns `null` when the void constraints are
  unsatisfiable.** Always handle it; the `general` duppy falls back to the
  heuristic. An unguarded `null` here crashes a live table.
- **The shuffle keystream is finite.** Rejection sampling can burn draws, so
  `keystream` allocates 8 blocks of headroom. Shrinking that throws
  "keystream exhausted" on a small fraction of deals — which is exactly the
  kind of intermittent bug that looks like the shuffle is rigged.

## Testing

`npm test` after every change. When a test fails, decide whether the test or
the code is wrong before editing either — several tests encode Jamaican rules
that look wrong to an outsider and are correct.

The blocked-hand test deliberately has the winning team holding **more** pips
overall. That is the rule. Do not "fix" it.

`npm run bench` plays whole sets with random bots and asserts tile conservation
on every move. Run it after changing `applyMove` or the shuffle.
