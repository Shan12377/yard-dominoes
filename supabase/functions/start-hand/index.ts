// POST /start-hand  { tableId, clientSeed }
//
// Deals the next hand. The commitment is written BEFORE any tile is dealt and
// the seed stays hidden until the hand ends — that is the whole fairness
// guarantee, and it lives in these twenty lines.

import { handled, json, requireUser, serviceClient, persist, HttpError } from '../_shared/lib.ts';
import { provablyFairShuffle, commit, randomSeed } from '../_shared/engine/shuffle.ts';
import { deal } from '../_shared/engine/hand.ts';
import { dealPlan } from '../_shared/engine/tiles.ts';
import { DUPPY_THINK_SECONDS } from '../_shared/engine/clock.ts';

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
    // Paired modes (partner, openhand) score by SIDE, not seat — same
    // scoreboard shape, one entry per side. Cutthroat scores per seat.
    const sides = (table.mode === 'partner' || table.mode === 'openhand')
      ? 2 : table.seat_count;
    const { data } = await db.from('sets').insert({
      table_id: tableId,
      scores: new Array(sides).fill(0),
      pose_must_be_double_six: true,
    }).select().single();
    set = data;
  }

  // Idempotency: a double-tap (two partners both hitting "Deal next hand", or
  // a double-tap on one device) must not create two active hands on the same
  // set. If one is already active, hand the caller that hand instead of
  // dealing a second one on top of it.
  const { data: existingActive } = await db.from('hands')
    .select('*').eq('set_id', set!.id).eq('status', 'active').maybeSingle();
  if (existingActive) {
    return json({
      ok: true, handId: existingActive.id, commitment: existingActive.commitment,
      turn: existingActive.turn,
    });
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
    // French, round 2+ only — round 1 (and a tie-break reshuffle) already
    // forces the chucha specifically via poseMustBeDoubleSix above; this is
    // the "any double, your choice, or you're fined and it passes to
    // someone who has one" rule for every hand after that.
    poseMustBeAnyDouble:
      table.format === 'french' && !(set!.pose_must_be_double_six || table.tournament),
    // French round 1 is opened by whoever holds the chucha (0-0). The
    // pose_must_be_double_six flag stays TRUE for that first hand (createSet
    // sets it), and openingTile switches from 6-6 to 0-0 for French.
    openingTile: table.format === 'french' ? '0-0' : '6-6',
    // Required so the pose branch in applyMove can tell a chucha pose is
    // French and build a cross board — openingTile alone doesn't do this.
    format: table.format,
  });

  const { data: handRow, error: handError } = await db.from('hands').insert({
    set_id: set!.id, hand_no: handNo, commitment, server_seed: serverSeed,
    client_seeds: clientSeeds, deal: state.hands, hands: state.hands,
    boneyard: state.boneyard, board: state.board, turn: state.turn,
    move_log: [], status: 'active', poser: state.poser,
    pose_must_be_double_six: state.poseMustBeDoubleSix,
    pose_must_be_any_double: state.poseMustBeAnyDouble ?? false,
  }).select().single();
  // The unique partial index on (set_id) where status = 'active' is the
  // database-level backstop against the same race the check above narrows
  // but can't fully close (TOCTOU between that select and this insert).
  if (handError) throw new HttpError(500, handError.message);

  // Everyone starts a hand level. Banking time across hands would let one
  // early rout buy an unanswerable advantage in the hand that decides the set.
  await db.from('seats').update({ time_bank: 0 }).eq('table_id', tableId);

  await persist(db, handRow!.id, tableId, set!.id, state, seatUsers,
    seats![state.turn].duppy_level ? DUPPY_THINK_SECONDS : table.turn_seconds, 0);
  await db.from('tables').update({ status: 'playing' }).eq('id', tableId);

  return json({ ok: true, handId: handRow!.id, commitment, turn: state.turn });
}));
