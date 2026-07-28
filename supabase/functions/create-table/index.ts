// POST /create-table
import { handled, json, requireUser, serviceClient, HttpError, effectiveTier, TIER_RANK } from '../_shared/lib.ts';

Deno.serve(handled(async (req) => {
  const user = await requireUser(req);
  const body = await req.json();
  const db = serviceClient();

  const seatCount = Number(body.seatCount ?? 4);
  if (![2, 3, 4].includes(seatCount)) throw new HttpError(422, 'seat count must be 2, 3 or 4');
  // Partner is inherently a 4-seat, 2-vs-2 format — sideOf() would otherwise
  // split 3 seats into a nonsensical 2-vs-1, and 2 seats make
  // passPoseToPartner's (poser + 2) % 2 a no-op. The client should already
  // lock this in the form; this is the real gate.
  if ((body.mode ?? 'partner') === 'partner' && seatCount !== 4) {
    throw new HttpError(422, 'partner mode needs exactly 4 seats');
  }

  if (body.loungeId) {
    const { data: lounge } = await db.from('lounges').select('min_tier').eq('id', body.loungeId).single();
    if (!lounge) throw new HttpError(404, 'no such lounge');
    const { data: profile } = await db.from('profiles').select('tier, tier_expires_at').eq('id', user.id).single();
    const mine = effectiveTier(profile ?? { tier: 'guest', tier_expires_at: null });
    if (TIER_RANK[mine] < TIER_RANK[lounge.min_tier]) {
      throw new HttpError(403, `${lounge.min_tier} membership required to start a table here`);
    }
  }

  const { data: code } = await db.rpc('generate_join_code');

  const { data: table, error } = await db.from('tables').insert({
    join_code: code,
    mode: body.mode ?? 'partner',
    // Cut throat six love runs to a median of ~196 hands. Never default to it.
    format: body.format ?? (body.mode === 'cutthroat' ? 'firstToSix' : 'sixlove'),
    seat_count: seatCount,
    tournament: !!body.tournament,
    one_all_play_two: body.oneAllPlayTwo ?? true,
    use_boneyard: !!body.useBoneyard,
    is_private: !!body.isPrivate,
    lounge_id: body.loungeId ?? null,
    created_by: user.id,
  }).select().single();
  if (error) throw new HttpError(500, error.message);

  const duppies: string[] = body.duppies ?? [];
  const seats: any[] = [{
    table_id: table.id, seat_index: 0, user_id: user.id,
    connected_at: new Date().toISOString(),
  }];
  for (let i = 1; i < seatCount; i++) {
    seats.push({
      table_id: table.id, seat_index: i,
      user_id: null, duppy_level: duppies[i - 1] ?? null,
    });
  }
  const { error: seatsError } = await db.from('seats').insert(seats);
  if (seatsError) {
    await db.from('tables').delete().eq('id', table.id);
    throw new HttpError(500, seatsError.message);
  }

  return json({ ok: true, tableId: table.id, joinCode: table.join_code });
}));
