// POST /start-hand  { tableId, clientSeed }
//
// Deals the next hand. The commitment is written BEFORE any tile is dealt and
// the seed stays hidden until the hand ends — that is the whole fairness
// guarantee, and it lives in these twenty lines.

import { handled, json, requireUser, serviceClient, persist, HttpError } from '../_shared/lib.ts';
import { provablyFairShuffle, commit, randomSeed } from '../_shared/engine/shuffle.ts';
import { deal, applyMove } from '../_shared/engine/hand.ts';
import { dealPlan } from '../_shared/engine/tiles.ts';
import { duppyMove } from '../_shared/engine/bots.ts';

Deno.serve(handled(async (req) => {
  const user = await requireUser(req);
  const { tableId, clientSeed } = await req.json() as { tableId: string; clientSeed?: string };
  const db = serviceClient();

  const { data: table } = await db.from('tables').select('*').eq('id', tableId).single();
  if (!table) throw new HttpError(404, 'no such table');

  const { data: seats } = await db.from('seats').select('*').eq('table_id', tableId).order('seat_index');
  const seatUsers: (string | null)[] = seats!.map((s: any) => s.user_id);
  if (!seatUsers.includes(user.id)) throw new HttpError(403, 'you are not seated here');
  if (seats!.some((s: any) => !s.user_id && !s.duppy_level)) {
    throw new HttpError(409, 'the table is not full yet');
  }

  let { data: set } = await db.from('sets')
    .select('*').eq('table_id', tableId).is('winner_side', null)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();

  if (!set) {
    const sides = table.mode === 'partner' ? 2 : table.seat_count;
    const { data } = await db.from('sets').insert({
      table_id: tableId,
      scores: new Array(sides).fill(0),
      pose_must_be_double_six: true,
    }).select().single();
    set = data;
  }

  const { count } = await db.from('hands')
    .select('*', { count: 'exact', head: true }).eq('set_id', set!.id);
  const handNo = (count ?? 0) + 1;

  // --- commit, then deal ---------------------------------------------------
  const serverSeed = randomSeed();
  const commitment = await commit(serverSeed);
  const clientSeeds = [clientSeed ?? randomSeed(8)];
  const { removeDoubleBlank } = dealPlan(table.seat_count, table.use_boneyard);

  const order = await provablyFairShuffle({
    serverSeed, clientSeeds, handId: `${set!.id}:${handNo}`, removeDoubleBlank,
  });

  let state = deal({
    order,
    seatCount: table.seat_count,
    mode: table.mode,
    useBoneyard: table.use_boneyard,
    poser: set!.pose_must_be_double_six ? undefined : set!.poser,
    poseMustBeDoubleSix: set!.pose_must_be_double_six || table.tournament,
  });

  const { data: handRow } = await db.from('hands').insert({
    set_id: set!.id, hand_no: handNo, commitment, server_seed: serverSeed,
    client_seeds: clientSeeds, deal: state.hands, hands: state.hands,
    boneyard: state.boneyard, board: state.board, turn: state.turn,
    move_log: [], status: 'active', poser: state.poser,
    pose_must_be_double_six: state.poseMustBeDoubleSix,
  }).select().single();

  let guard = 0;
  while (state.status === 'active' && seats![state.turn].duppy_level && guard++ < 40) {
    state = applyMove(state, duppyMove(state, seats![state.turn].duppy_level));
  }

  await persist(db, handRow!.id, tableId, set!.id, state, seatUsers, table.turn_seconds, 0);
  await db.from('tables').update({ status: 'playing' }).eq('id', tableId);

  return json({ ok: true, handId: handRow!.id, commitment, turn: state.turn });
}));
