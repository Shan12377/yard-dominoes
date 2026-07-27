// POST /play-move  { handId, move }
//
// The authority. A client sends an INTENT; this function decides whether it is
// legal and what the new state is. The client's copy of the game is a picture,
// never a source of truth.

import { handled, json, requireUser, serviceClient, toState, persist, HttpError, Conflict, type HandRow } from '../_shared/lib.ts';
import { isLegal, applyMove } from '../_shared/engine/hand.ts';
import { applyHandResult } from '../_shared/engine/set.ts';
import { duppyMove } from '../_shared/engine/bots.ts';
import type { Move } from '../_shared/engine/types.ts';

Deno.serve(handled(async (req) => {
  const user = await requireUser(req);
  const { handId, move } = await req.json() as { handId: string; move: Move };
  const db = serviceClient();

  const { data: hand } = await db.from('hands').select('*').eq('id', handId).single();
  if (!hand) throw new HttpError(404, 'no such hand');
  const row = hand as HandRow;
  if (row.status !== 'active') throw new HttpError(409, 'that hand is already over');

  const { data: set } = await db.from('sets').select('*').eq('id', row.set_id).single();
  const { data: table } = await db.from('tables').select('*').eq('id', set!.table_id).single();
  const { data: seats } = await db.from('seats').select('*').eq('table_id', table!.id).order('seat_index');

  const seatUsers: (string | null)[] = seats!.map((s: any) => s.user_id);
  const mySeat = seatUsers.indexOf(user.id);
  if (mySeat < 0) throw new HttpError(403, 'you are not seated at this table');
  if (row.turn !== mySeat) throw new HttpError(409, 'not your turn');
  if (move.seat !== mySeat) throw new HttpError(403, 'you cannot move for another seat');

  let state = toState(row, table!.seat_count, table!.mode);
  if (!isLegal(state, move)) throw new HttpError(422, 'illegal move');

  // Speed stat, JamDom-style: elapsed = time since this turn started, which is
  // (expiry - turn_seconds) ago. Recorded per profile; averages are computed.
  const expiresAt = (row as any).turn_expires_at ? Date.parse((row as any).turn_expires_at) : null;
  if (expiresAt) {
    const startedAt = expiresAt - table!.turn_seconds * 1000;
    const elapsed = Math.max(0, Math.min(Date.now() - startedAt, table!.turn_seconds * 1000));
    await db.rpc('record_move_speed', { p_user: user.id, p_ms: Math.round(elapsed) });
  }

  state = applyMove(state, move);

  // Play out any duppies that now hold the turn.
  let guard = 0;
  while (state.status === 'active' && seats![state.turn].duppy_level && guard++ < 40) {
    state = applyMove(state, duppyMove(state, seats![state.turn].duppy_level));
  }

  try {
    await persist(db, row.id, table!.id, row.set_id, state, seatUsers, table!.turn_seconds, row.version);
  } catch (err) {
    if (err instanceof Conflict) throw new HttpError(409, 'someone else moved first — reloading');
    throw err;
  }

  if (state.status !== 'active') {
    const current = {
      options: {
        mode: table!.mode, format: table!.format, seatCount: table!.seat_count,
        tournament: table!.tournament, oneAllPlayTwo: table!.one_all_play_two,
        useBoneyard: table!.use_boneyard, target: 6,
      },
      scores: set!.scores, handValue: set!.hand_value, poser: set!.poser,
      poseMustBeDoubleSix: set!.pose_must_be_double_six, playoff: set!.playoff,
      handsPlayed: set!.hands_played, winnerSide: set!.winner_side, sixLove: set!.six_love,
    };
    const next = applyHandResult(current as any, state.result!);
    await db.from('sets').update({
      scores: next.scores, hand_value: next.handValue, poser: next.poser,
      pose_must_be_double_six: next.poseMustBeDoubleSix, playoff: next.playoff,
      hands_played: next.handsPlayed, winner_side: next.winnerSide, six_love: next.sixLove,
    }).eq('id', row.set_id);

    if (next.winnerSide !== null) {
      await db.from('tables').update({ status: 'finished' }).eq('id', table!.id);
    }
    return json({ ok: true, handOver: true, set: next });
  }

  return json({ ok: true, handOver: false, turn: state.turn });
}));
