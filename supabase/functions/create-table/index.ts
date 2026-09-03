// POST /create-table
import { handled, json, requireUser, serviceClient, HttpError, effectiveTier, TIER_RANK } from '../_shared/lib.ts';
import { clockByName, duppyPaceByName } from '../_shared/engine/clock.ts';

Deno.serve(handled(async (req) => {
  const user = await requireUser(req);
  const body = await req.json();
  const db = serviceClient();

  const seatCount = Number(body.seatCount ?? 4);
  if (![2, 3, 4].includes(seatCount)) throw new HttpError(422, 'seat count must be 2, 3 or 4');
  // Partner and openhand are both inherently 4-seat, 2-vs-2 formats — sideOf()
  // would otherwise split 3 seats into a nonsensical 2-vs-1, and 2 seats make
  // passPoseToPartner's (poser + 2) % 2 a no-op. `isPartnered` in the engine
  // groups them; the string check here catches an unknown mode too before it
  // reaches the game_mode enum cast and 500s.
  const mode = String(body.mode ?? 'partner');
  if (!['cutthroat', 'partner', 'openhand', 'across'].includes(mode)) {
    throw new HttpError(422, `unknown mode: ${mode}`);
  }
  if ((mode === 'partner' || mode === 'openhand' || mode === 'across') && seatCount !== 4) {
    throw new HttpError(422, `${mode} mode needs exactly 4 seats`);
  }
  // French is cut-throat, 4-hand only in v1 (see the French debrief) — the
  // engine's own createSet() lets a caller's options override its
  // french-implied mode/seatCount defaults, so this has to be caught here,
  // not assumed safe because the engine "usually" forces it.
  if (body.format === 'french' && (mode !== 'cutthroat' || seatCount !== 4)) {
    throw new HttpError(422, 'French is cut-throat, 4 players only');
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
    mode,
    // Cut throat six love runs to a median of ~196 hands. Never default to it.
    // Openhand and across are both partnered modes and default the same way
    // partner does.
    format: body.format ?? (mode === 'cutthroat' ? 'firstToSix' : 'sixlove'),
    seat_count: seatCount,
    // The client sends a name, never seconds — otherwise a patched client
    // could start a table with a turn long enough to hold the room hostage.
    turn_seconds: clockByName(body.clock).base,
    turn_cap_seconds: clockByName(body.clock).cap,
    // Named like the human clock. The server stores the allowed choice rather
    // than trusting a browser-supplied number of seconds.
    duppy_pace: duppyPaceByName(body.duppyPace),
    one_all_play_two: body.oneAllPlayTwo ?? true,
    use_boneyard: !!body.useBoneyard,
    is_private: !!body.isPrivate,
    lounge_id: body.loungeId ?? null,
    created_by: user.id,
  }).select().single();
  if (error) throw new HttpError(500, error.message);

  const duppies: string[] = body.duppies ?? [];
  const now = new Date().toISOString();
  let seats: any[];
  if (mode === 'across') {
    // The creator signs into both seats of one side — seat 0 and its
    // partner seat 2 — not a choice the client makes; that pairing IS
    // across. The other side (1&3) stays duppy-filled until a second real
    // player claims both of them together through join-table.
    seats = [
      { table_id: table.id, seat_index: 0, user_id: user.id, connected_at: now },
      { table_id: table.id, seat_index: 2, user_id: user.id, connected_at: now },
      { table_id: table.id, seat_index: 1, user_id: null, duppy_level: duppies[0] ?? null },
      { table_id: table.id, seat_index: 3, user_id: null, duppy_level: duppies[1] ?? null },
    ];
  } else {
    seats = [{ table_id: table.id, seat_index: 0, user_id: user.id, connected_at: now }];
    for (let i = 1; i < seatCount; i++) {
      seats.push({
        table_id: table.id, seat_index: i,
        user_id: null, duppy_level: duppies[i - 1] ?? null,
      });
    }
  }
  const { error: seatsError } = await db.from('seats').insert(seats);
  if (seatsError) {
    await db.from('tables').delete().eq('id', table.id);
    throw new HttpError(500, seatsError.message);
  }

  return json({ ok: true, tableId: table.id, joinCode: table.join_code });
}));
