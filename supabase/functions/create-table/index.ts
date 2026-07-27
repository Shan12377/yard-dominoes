// POST /create-table
import { handled, json, requireUser, serviceClient, HttpError } from '../_shared/lib.ts';

Deno.serve(handled(async (req) => {
  const user = await requireUser(req);
  const body = await req.json();
  const db = serviceClient();

  const seatCount = Number(body.seatCount ?? 4);
  if (![2, 3, 4].includes(seatCount)) throw new HttpError(422, 'seat count must be 2, 3 or 4');

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
  await db.from('seats').insert(seats);

  return json({ ok: true, tableId: table.id, joinCode: table.join_code });
}));
