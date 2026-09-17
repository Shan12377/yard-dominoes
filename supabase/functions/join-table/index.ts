// POST /join-table  { joinCode }  or  { tableId, seatIndex }
import { handled, json, requireUser, requireLoungeEmail, serviceClient, HttpError, effectiveTier, TIER_RANK } from '../_shared/lib.ts';
import { adjustTrust, countStarted, TRUST } from '../_shared/game-end.ts';

// A player who leaves mid-hand drops to a duppy fill-in (leave-seat), not a
// truly open seat. This is how long they get to come back and reclaim it
// before the normal "already started" block applies to them too.
const REJOIN_WINDOW_MS = 5 * 60 * 1000;

Deno.serve(handled(async (req) => {
  const user = await requireUser(req);
  // Sitting down online needs a reachable account. RLS covers the lounge
  // tables, but this function runs as the service role, which RLS does not
  // apply to — so the gate has to be asked for here explicitly.
  requireLoungeEmail(user);
  const { joinCode, tableId, seatIndex } = await req.json();
  const db = serviceClient();

  // Codes are recycled once a table finishes (0061), so a finished table can
  // share this code. Only a live table answers to it; without this filter
  // .single() saw several rows and every Sit down / Rejoin on a reused code
  // failed as "no table" (owner, 2026-09-16: rejoining left a duppy seated).
  const query = joinCode
    ? db.from('tables').select('*').eq('join_code', String(joinCode).toUpperCase()).neq('status', 'finished')
    : db.from('tables').select('*').eq('id', tableId);
  const { data: table } = await query.single();
  if (!table) throw new HttpError(404, 'no table with that code');

  if (table.lounge_id) {
    const { data: lounge } = await db.from('lounges').select('min_tier').eq('id', table.lounge_id).single();
    const { data: profile } = await db.from('profiles').select('tier, tier_expires_at').eq('id', user.id).single();
    const mine = effectiveTier(profile ?? { tier: 'guest', tier_expires_at: null });
    if (lounge && TIER_RANK[mine] < TIER_RANK[lounge.min_tier]) {
      throw new HttpError(403, `${lounge.min_tier} membership required to sit at a table here`);
    }
  }

  // A tournament table is an ordinary table, so the join code alone would let
  // anybody who overheard it take a drawn player's seat. The event is the gate:
  // you must be in that tournament's queue and still standing.
  //
  // Deliberately not bound to the ONE table you were drawn to. A substitute
  // taking a no-show's seat is the whole point of the substitutes line, and
  // binding a player to a single table would mean a host-only seat-swapping
  // function existed before anyone had run a real Sunday.
  // A themed draw (battle of the sexes, couples) promises specific seating —
  // women on 0&2, a couple opposite itself — and that promise is worthless if
  // whoever taps Join first just gets whichever seat happens to be open.
  // `assignedSeat` is what tournament-host wrote for THIS player at draw time
  // (0058); when it is set, it overrides both the request's own `seatIndex`
  // and the "any open seat" fallback below. Null for an open event, and for
  // any substitute who was never part of the draw — see the caveat below.
  let assignedSeat: number | null = null;
  if (table.tournament_id) {
    const { data: signup } = await db.from('tournament_signups')
      .select('status, seat_index').eq('tournament_id', table.tournament_id)
      .eq('user_id', user.id).maybeSingle();
    if (!signup || !['seated', 'substitute'].includes(signup.status)) {
      throw new HttpError(403, 'this table belongs to a tournament you are not in');
    }
    assignedSeat = (signup.seat_index ?? null) as number | null;
  }

  const { data: seats } = await db.from('seats').select('*').eq('table_id', table.id).order('seat_index');

  if (table.status !== 'waiting') {
    // Not a fresh join — the only door still open once play has started is
    // reclaiming a seat this exact player left within the last few minutes.
    const cutoff = Date.now() - REJOIN_WINDOW_MS;
    const mySeats = seats!.filter((s: any) =>
      s.left_by_user_id === user.id && s.left_at !== null && Date.parse(s.left_at) > cutoff);
    if (mySeats.length === 0) return await takeOpenSeat(db, table, seats!, user.id, cutoff);

    // Back inside the window: the walk-off never happened (Table Trust, 0066).
    const penalty = (mySeats[0].left_penalty ?? 0) as number;
    if (penalty > 0) await adjustTrust(db, user.id, penalty, penalty === TRUST.loveWalk ? -1 : 0);

    const { error: rejoinErr } = await db.from('seats')
      .update({
        user_id: user.id, duppy_level: null, connected_at: new Date().toISOString(),
        left_by_user_id: null, left_at: null, left_penalty: null,
      })
      .eq('table_id', table.id).in('seat_index', mySeats.map((s: any) => s.seat_index))
      .eq('left_by_user_id', user.id);
    if (rejoinErr) throw new HttpError(500, rejoinErr.message);

    return json({ ok: true, tableId: table.id, seatIndex: mySeats[0].seat_index });
  }

  const existing = seats!.find((s: any) => s.user_id === user.id);
  if (existing) return json({ ok: true, tableId: table.id, seatIndex: existing.seat_index });

  // Across never leaves a side half-human — you claim your seat AND the one
  // across from it (0&2 or 1&3) together, or not at all. Everything else
  // about the table (mode, seat_count, RLS) is ordinary partner underneath.
  if (table.mode === 'across') {
    const pairs: [number, number][] = [[0, 2], [1, 3]];
    const openPair = pairs.find(([a, b]) => {
      const seatA = seats!.find((s: any) => s.seat_index === a);
      const seatB = seats!.find((s: any) => s.seat_index === b);
      return seatA && !seatA.user_id && seatB && !seatB.user_id;
    });
    if (!openPair) throw new HttpError(409, 'no free seat');
    // In case a duppy fallback below is ever needed, this remembers what
    // each seat held before the claim rather than guessing a tier.
    const priorDuppy = new Map(
      openPair.map((idx) => [idx, seats!.find((s: any) => s.seat_index === idx)?.duppy_level ?? null]),
    );

    // `.is('user_id', null)` re-checks freshness against the live row, not
    // the snapshot read above — closes most of the window where two people
    // race for the same pair. Not a database-level transaction, so a
    // genuine dead-heat can still split one seat to each of two callers;
    // the check below catches that and undoes the half-claim rather than
    // leaving the pair split between two different people.
    const { data: claimed, error: claimErr } = await db.from('seats')
      .update({ user_id: user.id, duppy_level: null, connected_at: new Date().toISOString(), sat_at: new Date().toISOString() })
      .eq('table_id', table.id).in('seat_index', openPair).is('user_id', null)
      .select();
    if (claimErr) throw new HttpError(500, claimErr.message);

    if (!claimed || claimed.length !== 2) {
      for (const row of claimed ?? []) {
        await db.from('seats').update({
          user_id: null, duppy_level: priorDuppy.get(row.seat_index) ?? 'pickney',
        }).eq('table_id', table.id).eq('seat_index', row.seat_index);
      }
      throw new HttpError(409, 'someone else just took that seat — try again');
    }

    return json({ ok: true, tableId: table.id, seatIndex: openPair[0] });
  }

  // KNOWN GAP: a substitute filling a no-show's seat has no seat_index of
  // their own (only the four players the draw actually seated get one), so
  // they still fall through to "any open seat" — which can land them on the
  // wrong side of a themed table. Substitute seating for a themed event is
  // not solved by this; a host currently has no way to assign one to a
  // specific side. Flagged, not fixed, in this pass.
  const target = assignedSeat != null
    ? seats!.find((s: any) => s.seat_index === assignedSeat && !s.user_id)
    : seatIndex != null
      ? seats!.find((s: any) => s.seat_index === seatIndex && !s.user_id)
      : seats!.find((s: any) => !s.user_id);
  if (!target) {
    throw new HttpError(409, assignedSeat != null ? 'your seat at this table is already taken' : 'no free seat');
  }

  await db.from('seats').update({
    user_id: user.id, duppy_level: null, connected_at: new Date().toISOString(), sat_at: new Date().toISOString(),
  }).eq('table_id', table.id).eq('seat_index', target.seat_index);

  return json({ ok: true, tableId: table.id, seatIndex: target.seat_index });
}));

/**
 * A seat its player left more than REJOIN_WINDOW_MS ago goes to whoever asks
 * (owner, 2026-09-17). During a hand the seat is booked and start-hand seats
 * them at the next deal; between hands they sit now. Across seats come as the
 * pair that left together. Never on a tournament table: that has its own
 * substitutes line.
 */
async function takeOpenSeat(db: any, table: any, seats: any[], userId: string, cutoff: number) {
  if (table.tournament_id) throw new HttpError(409, 'that game has already started');
  const mine = seats.find((s) => s.user_id === userId);
  if (mine) return json({ ok: true, tableId: table.id, seatIndex: mine.seat_index });
  const booked = seats.find((s) => s.claim_user_id === userId);
  if (booked) return json({ ok: true, tableId: table.id, seatIndex: booked.seat_index, pending: true });

  const open = seats.filter((s) => !s.user_id && !s.claim_user_id && s.left_by_user_id
    && s.left_at && Date.parse(s.left_at) <= cutoff);
  if (open.length === 0) throw new HttpError(409, 'that game has already started');
  const group = table.mode === 'across'
    ? open.filter((s) => s.left_by_user_id === open[0].left_by_user_id)
    : [open[0]];
  const indexes = group.map((s) => s.seat_index);

  const { data: latest } = await db.from('hand_public').select('status')
    .eq('table_id', table.id).order('updated_at', { ascending: false }).limit(1).maybeSingle();
  const now = new Date().toISOString();

  if (latest?.status !== 'active') {
    const { data: seated, error } = await db.from('seats').update({
      user_id: userId, duppy_level: null, connected_at: now, sat_at: now, timeouts: 0,
      left_by_user_id: null, left_at: null, left_penalty: null, claim_user_id: null, claimed_at: null,
    }).eq('table_id', table.id).in('seat_index', indexes).is('user_id', null).select();
    if (error) throw new HttpError(500, error.message);
    if (!seated || seated.length !== indexes.length) throw new HttpError(409, 'someone else just took that seat — try again');
    await countStarted(db, [userId]);
    return json({ ok: true, tableId: table.id, seatIndex: indexes[0] });
  }

  const { data: claimed, error } = await db.from('seats').update({ claim_user_id: userId, claimed_at: now })
    .eq('table_id', table.id).in('seat_index', indexes).is('user_id', null).is('claim_user_id', null).select();
  if (error) throw new HttpError(500, error.message);
  if (!claimed || claimed.length !== indexes.length) {
    await db.from('seats').update({ claim_user_id: null, claimed_at: null })
      .eq('table_id', table.id).eq('claim_user_id', userId);
    throw new HttpError(409, 'someone else just took that seat — try again');
  }
  return json({ ok: true, tableId: table.id, seatIndex: indexes[0], pending: true });
}
