// Who gets a seat at a tournament, and in what order.
//
// Pure — no Deno, no network, no engine import — so `npm test` covers the rule
// that decides who plays, without a database or a Deno runtime. Same split as
// `billing.ts`, for the same reason: the decision worth testing is a decision
// about a list, and everything touching Postgres is I/O around it.
//
// This is the paid promise. Per the business partner it is *the* reason people
// buy VIP, ahead of the microphone, so it is the one piece of the tournament
// that is worth more test than code.
//
// ponytail: TIER_RANK is also declared in `lib.ts` and `apps/web/src/lounges.ts`.
// A third copy is deliberate rather than lazy — `lib.ts` imports `jsr:` and
// Deno globals, so importing it here would put this file out of reach of
// `node --test`, which is the entire point of keeping it pure. Three seats and
// two lines; if it ever grows, hoist it, don't hoist it now.

/** guest < yardie < vip. Matches `lib.ts` and `lounges.ts`. */
const RANK: Record<string, number> = { guest: 0, yardie: 1, vip: 2 };

/**
 * One player in the queue.
 *
 * `tier` and `tierExpiresAt` are read from `profiles` **at seating time**, not
 * copied into the signup row. See `queueRank` for why that distinction is the
 * whole feature.
 */
export interface QueueEntry {
  userId: string;
  tier: string;
  tierExpiresAt: string | null;
  /** ISO timestamp, server-set on signup. */
  signedUpAt: string;
}

/**
 * Where a player's membership puts them in line.
 *
 * Two things here are easy to get wrong and both are bugs people will notice:
 *
 * **Three bands, not two.** Yardie is a *paid* tier. Sorting it level with a
 * free guest means somebody paid and got nothing, which is worse than not
 * selling the perk at all.
 *
 * **Expiry counts.** This mirrors `effective_tier()` in `0002` and
 * `effectiveTier()` in `lib.ts`, which `join-table` and `create-table` both go
 * through. A lapsed VIP jumping the queue would make this the only place in the
 * app where an expired membership still buys something.
 */
export function queueRank(tier: string, tierExpiresAt: string | null, now: number): number {
  if (tier === 'guest') return RANK.guest;
  const live = tierExpiresAt === null || Date.parse(tierExpiresAt) > now;
  return live ? (RANK[tier] ?? RANK.guest) : RANK.guest;
}

/**
 * The queue, in the order seats are handed out.
 *
 * **A VIP who signs up at 4:30 is seated ahead of a guest who signed up at
 * 9am.** That is the entire mechanism — a sort key, no locks, no held seats, no
 * reservations.
 *
 * Tier is evaluated **now**, not snapshotted at signup. Someone who joined the
 * queue as a guest in the morning and bought VIP in the afternoon does jump,
 * and that moment is precisely where the upgrade sells itself. A stored or
 * generated `priority` column cannot do this: Postgres generated columns may
 * only read the row they live on, so any such column necessarily freezes a copy
 * of the tier at insert and silently gives you the opposite behaviour.
 *
 * `userId` settles the last tie so a seeding pass that retries deals the same
 * bracket twice instead of reshuffling live players between tables.
 *
 * Returns a new array; the caller's list is not reordered underneath it.
 */
export function queueOrder<T extends QueueEntry>(entries: readonly T[], now: number): T[] {
  return [...entries].sort((a, b) =>
    queueRank(b.tier, b.tierExpiresAt, now) - queueRank(a.tier, a.tierExpiresAt, now)
    || Date.parse(a.signedUpAt) - Date.parse(b.signedUpAt)
    || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
}

export interface Draw {
  /** Full tables of humans, in queue order. */
  tables: string[][];
  /** Everyone past the cut, still in queue order. */
  substitutes: string[];
}

/**
 * Draw the cut line: only **full tables of real people** play.
 *
 * The tempting alternative is to spread everyone across `ceil(n / seatCount)`
 * tables and fill the gaps with duppies. Do not. Two reasons:
 *
 * 1. A Sunday where a quarter of the seats are bots is not a tournament, and a
 *    bot would be deciding which humans go through.
 * 2. The overflow is not waste — it is the **substitutes line**, which this app
 *    already sells today. `apps/web/src/lounges.ts` lists "Front of the
 *    tournament substitutes line" as a VIP benefit, and the same ordering
 *    delivers it for nothing. One ordered list with a line drawn across it.
 *
 * A consequence worth stating: fewer entrants than one full table means no
 * tables at all. Partner mode needs exactly four seats — `create-table` rejects
 * anything else, and `sideOf()` would split three seats into a nonsensical
 * 2-vs-1 — so three people is not a small tournament, it is not a tournament.
 * The caller cancels rather than seeding.
 */
export function drawCutLine(ordered: readonly string[], seatCount: number): Draw {
  if (seatCount < 2) return { tables: [], substitutes: [...ordered] };
  const tableCount = Math.floor(ordered.length / seatCount);
  const tables: string[][] = [];
  for (let t = 0; t < tableCount; t++) {
    tables.push(ordered.slice(t * seatCount, (t + 1) * seatCount));
  }
  return { tables, substitutes: [...ordered.slice(tableCount * seatCount)] };
}
