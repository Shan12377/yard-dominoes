// The database side of the tournament queue.
//
// The RULE — who is ahead of whom, and where the cut line falls — is pure and
// lives in `tournament-queue.ts`, where `npm test` covers it. This file is the
// reads and writes around that rule: it loads rows, hands them to the tested
// functions, and shapes the answer.
//
// Its only `jsr:` import is `import type`, which Node's type stripping erases,
// so `standingFor` and `signupsOpen` ARE reachable from `node --test` and are
// tested in `tournament.test.ts`. (An earlier version of this comment claimed
// the opposite and that is why they went untested for a while — the numbers
// `standingFor` returns are the ones on screen selling VIP.) Only `loadQueue`
// needs a live client, and it is the thin half.
//
// Both Edge Functions that touch the queue go through here, so a player's
// "you are #14" and the host's seating draw cannot disagree — they are the same
// ordering of the same rows, computed on the server. The browser never sorts:
// `apps/web` imports nothing from `supabase/functions`, so any client-side
// ordering would necessarily be a second implementation of the paid promise.

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { drawForTheme, queueOrder, queueRank, type TournamentTheme } from './tournament-queue.ts';

/** Statuses that are still standing in line. */
const IN_LINE = ['signed_up', 'seated', 'substitute'];

export interface QueuedPlayer {
  userId: string;
  username: string;
  tier: string;
  tierExpiresAt: string | null;
  signedUpAt: string;
  status: string;
  round: number | null;
  tableId: string | null;
  /**
   * From `profiles.gender`, and null for most players — it is optional on the
   * profile and nobody is asked for it to enter an ordinary event. Only a
   * theme that seats by side reads it (drawForTheme); omitting it here would
   * make battle of the sexes seat nobody at all, silently.
   */
  gender: string | null;
  /** Who they entered WITH, for the couples theme. Null everywhere else. */
  partnerUserId: string | null;
  /** Their partner's name, for the "you entered with X" line on screen. */
  partnerUsername: string | null;
}

/**
 * The whole queue for one tournament, already in seating order.
 *
 * Tier is read from `profiles` **now**, not from `tier_at_signup`. That is the
 * feature, not an optimisation: a guest who signs up in the morning and buys
 * VIP in the afternoon jumps, and `tier_at_signup` exists only so a dispute
 * three weeks later is answerable.
 */
export async function loadQueue(
  db: SupabaseClient,
  tournamentId: string,
  now = Date.now(),
): Promise<QueuedPlayer[]> {
  const { data, error } = await db.from('tournament_signups')
    // The embed MUST name its foreign key. 0057 added partner_user_id, giving
    // this table two references to `profiles`, and a bare `profiles(...)` then
    // stops being unambiguous — PostgREST refuses the whole query rather than
    // picking one. That broke every tournament read, not just couples, until
    // the hint went in.
    .select('user_id, signed_up_at, status, round, table_id, partner_user_id, '
      + 'profiles!tournament_signups_user_id_fkey(username, tier, tier_expires_at, gender)')
    .eq('tournament_id', tournamentId)
    .in('status', IN_LINE);
  if (error) throw new Error(error.message);

  const players: QueuedPlayer[] = (data ?? []).map((r: any) => ({
    userId: r.user_id as string,
    username: (r.profiles?.username ?? 'player') as string,
    // A missing profile row would otherwise read as `undefined` and sort as a
    // guest by accident rather than on purpose. Be explicit about the default.
    tier: (r.profiles?.tier ?? 'guest') as string,
    tierExpiresAt: (r.profiles?.tier_expires_at ?? null) as string | null,
    signedUpAt: r.signed_up_at as string,
    status: r.status as string,
    round: (r.round ?? null) as number | null,
    tableId: (r.table_id ?? null) as string | null,
    gender: (r.profiles?.gender ?? null) as string | null,
    partnerUserId: (r.partner_user_id ?? null) as string | null,
    partnerUsername: null,
  }));

  // Resolve partner names from the queue itself rather than a second query —
  // a partner who has not entered has no name to show here, which is exactly
  // the state the player needs to see ("waiting on them to enter too").
  const nameById = new Map(players.map((p) => [p.userId, p.username]));
  for (const p of players) {
    p.partnerUsername = p.partnerUserId ? (nameById.get(p.partnerUserId) ?? null) : null;
  }

  return queueOrder(players, now);
}

/** What one player is told about their place in line. */
export interface Standing {
  /** 1-based. Null when this player is not in the queue at all. */
  position: number | null;
  /** How many live VIPs are ahead of them — the sentence that sells VIP. */
  vipsAhead: number;
  total: number;
  /** Whether they fall above the cut line at the current turnout. */
  aboveCut: boolean;
  status: string | null;
  round: number | null;
  tableId: string | null;
}

/**
 * Where one player stands, given the ordered queue.
 *
 * `aboveCut` is provisional until the host draws: it moves every time somebody
 * signs up, withdraws, or upgrades. That is honest — it is the answer to "would
 * I get a seat if it started now", which is the question a player is actually
 * asking while the countdown runs.
 */
export function standingFor(
  ordered: readonly QueuedPlayer[],
  seatCount: number,
  userId: string | null,
  now = Date.now(),
  theme: TournamentTheme = 'open',
): Standing {
  const index = userId === null ? -1 : ordered.findIndex((p) => p.userId === userId);
  // The draw stays the authority on who is in — asking it beats re-deriving
  // `floor(n / seatCount) * seatCount` here, which would be a second copy of
  // the rule that seats people.
  //
  // Membership of the drawn set, NOT position in the queue. Those are the same
  // thing only for an open event. A theme seats by side, so with six women and
  // two men the four who play are w1, m1, w2, m2 — positions 1, 2, 5 and 7 of
  // the queue, say. Comparing an index against a seat count would tell two of
  // them they are out and two of the unseated that they are in.
  const seated = new Set(
    drawForTheme(ordered, seatCount, theme).tables.flat(),
  );

  if (index < 0) {
    return {
      position: null, vipsAhead: 0, total: ordered.length,
      aboveCut: false, status: null, round: null, tableId: null,
    };
  }

  const me = ordered[index];
  const vipsAhead = ordered.slice(0, index)
    .filter((p) => queueRank(p.tier, p.tierExpiresAt, now) === 2).length;

  return {
    position: index + 1,
    vipsAhead,
    total: ordered.length,
    aboveCut: seated.has(me.userId),
    status: me.status,
    round: me.round,
    tableId: me.tableId,
  };
}

/** Sign-ups are open, per the event's own status and its opening time. */
export function signupsOpen(
  t: { status: string; signups_open_at: string | null },
  now = Date.now(),
): boolean {
  if (t.status !== 'signups_open') return false;
  // Null means "open as soon as announced", so only a future time closes it.
  return t.signups_open_at === null || Date.parse(t.signups_open_at) <= now;
}
