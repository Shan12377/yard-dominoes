// POST /join-table  { joinCode }  or  { tableId, seatIndex }
import { handled, json, requireUser, serviceClient, HttpError, effectiveTier, TIER_RANK } from '../_shared/lib.ts';

Deno.serve(handled(async (req) => {
  const user = await requireUser(req);
  const { joinCode, tableId, seatIndex } = await req.json();
  const db = serviceClient();

  const query = joinCode
    ? db.from('tables').select('*').eq('join_code', String(joinCode).toUpperCase())
    : db.from('tables').select('*').eq('id', tableId);
  const { data: table } = await query.single();
  if (!table) throw new HttpError(404, 'no table with that code');
  if (table.status !== 'waiting') throw new HttpError(409, 'that game has already started');

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
  if (table.tournament_id) {
    const { data: signup } = await db.from('tournament_signups')
      .select('status').eq('tournament_id', table.tournament_id)
      .eq('user_id', user.id).maybeSingle();
    if (!signup || !['seated', 'substitute'].includes(signup.status)) {
      throw new HttpError(403, 'this table belongs to a tournament you are not in');
    }
  }

  const { data: seats } = await db.from('seats').select('*').eq('table_id', table.id).order('seat_index');
  const existing = seats!.find((s: any) => s.user_id === user.id);
  if (existing) return json({ ok: true, tableId: table.id, seatIndex: existing.seat_index });

  const target = seatIndex != null
    ? seats!.find((s: any) => s.seat_index === seatIndex && !s.user_id)
    : seats!.find((s: any) => !s.user_id);
  if (!target) throw new HttpError(409, 'no free seat');

  await db.from('seats').update({
    user_id: user.id, duppy_level: null, connected_at: new Date().toISOString(),
  }).eq('table_id', table.id).eq('seat_index', target.seat_index);

  return json({ ok: true, tableId: table.id, seatIndex: target.seat_index });
}));
