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
import { afterTurn, allowance, usedBy } from '../_shared/engine/clock.ts';
import type { Clock } from '../_shared/engine/clock.ts';
import { applyRatingUpdates } from '../_shared/apply-rating.ts';

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

  let state = toState(row, table!.seat_count, table!.mode, table!.format);
  if (!isLegal(state, move)) throw new HttpError(422, 'illegal move');

  const clock: Clock = { base: table!.turn_seconds, cap: table!.turn_cap_seconds };
  const banks: number[] = seats!.map((s: any) => s.time_bank ?? 0);

  // What this turn cost. The turn began one full allowance before its expiry —
  // which is the banked allowance, not the flat base, or a seat spending banked
  // time would look to the speed stat like it had only just started.
  const expiresAt = (row as any).turn_expires_at ? Date.parse((row as any).turn_expires_at) : null;
  let spent: number | null = null;
  if (expiresAt) {
    const startedAt = expiresAt - allowance(clock, banks[mySeat]) * 1000;
    spent = usedBy(clock, banks[mySeat], startedAt, Date.now());
    await db.rpc('record_move_speed', { p_user: user.id, p_ms: Math.round(spent * 1000) });
  }

  state = applyMove(state, move);

  // Play out any duppies that now hold the turn.
  let guard = 0;
  while (state.status === 'active' && seats![state.turn].duppy_level && guard++ < 40) {
    state = applyMove(state, duppyMove(state, seats![state.turn].duppy_level));
  }

  // Whatever this seat did not spend is kept for a hand that needs reading.
  if (spent !== null) banks[mySeat] = afterTurn(clock, banks[mySeat], spent);

  try {
    // The deadline belongs to whoever holds the turn now, on their own budget.
    await persist(db, row.id, table!.id, row.set_id, state, seatUsers,
      allowance(clock, banks[state.turn] ?? 0), row.version);
  } catch (err) {
    if (err instanceof Conflict) throw new HttpError(409, 'someone else moved first — reloading');
    throw err;
  }

  // Only after the conditional write has held: a move that lost the race must
  // not leave the mover's bank spent on a turn that never happened.
  if (spent !== null) {
    await db.from('seats').update({ time_bank: Math.round(banks[mySeat]) })
      .eq('table_id', table!.id).eq('seat_index', mySeat);
  }

  if (state.status !== 'active') {
    const current = {
      options: {
        mode: table!.mode, format: table!.format, seatCount: table!.seat_count,
        tournament: table!.tournament, oneAllPlayTwo: table!.one_all_play_two,
        useBoneyard: table!.use_boneyard, target: table!.format === 'french' ? 100 : 6,
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
    // Site-wide tally (site_stats.total_hands_played) is kept by a database
    // trigger on this same write — see migration 0032 — rather than a second
    // call from here, so any future path that bumps sets.hands_played is
    // covered automatically instead of needing to remember this RPC too.

    if (next.winnerSide !== null) {
      await db.from('tables').update({ status: 'finished' }).eq('id', table!.id);
      await applyRatingUpdates(db, table!.mode, seatUsers, next.winnerSide);
    }
    return json({ ok: true, handOver: true, set: next });
  }

  return json({ ok: true, handOver: false, turn: state.turn });
}));
