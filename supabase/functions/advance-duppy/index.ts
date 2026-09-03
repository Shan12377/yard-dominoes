// POST /advance-duppy  { handId }
//
// A Duppy is still server-authoritative: the browser may only ask for its
// already-due turn to be resolved. It never sends a tile or gets anyone's
// hidden hand. Persisting exactly one move gives every player time to see who
// played what before the next turn begins.

import { handled, json, requireUser, serviceClient, toState, persist, HttpError, Conflict, type HandRow } from '../_shared/lib.ts';
import { applyMove } from '../_shared/engine/hand.ts';
import { duppyMove } from '../_shared/engine/bots.ts';
import { applyHandResult } from '../_shared/engine/set.ts';
import { allowance, duppyThinkSeconds, type Clock } from '../_shared/engine/clock.ts';
import { applyRatingUpdates } from '../_shared/apply-rating.ts';

Deno.serve(handled(async (req) => {
  const user = await requireUser(req);
  const { handId } = await req.json() as { handId: string };
  const db = serviceClient();

  const { data: hand } = await db.from('hands').select('*').eq('id', handId).single();
  if (!hand) throw new HttpError(404, 'no such hand');
  const row = hand as HandRow;
  if (row.status !== 'active') throw new HttpError(409, 'that hand is already over');

  const { data: set } = await db.from('sets').select('*').eq('id', row.set_id).single();
  const { data: table } = await db.from('tables').select('*').eq('id', set!.table_id).single();
  const { data: seats } = await db.from('seats').select('*').eq('table_id', table!.id).order('seat_index');
  const seatUsers: (string | null)[] = seats!.map((seat: any) => seat.user_id);
  if (!seatUsers.includes(user.id)) throw new HttpError(403, 'you are not seated at this table');

  const actor = seats![row.turn];
  if (!actor?.duppy_level) throw new HttpError(409, 'it is not a duppy turn');
  // A tournament is real people only. A seat without a user there is a
  // placeholder waiting on the substitutes line, never a bot to be driven —
  // and a set containing one cannot be rated at all (apply-rating.ts).
  if (table!.tournament_id) {
    throw new HttpError(409, 'a tournament seat is played by a real person — waiting on a substitute');
  }
  const expiresAt = (row as any).turn_expires_at;
  if (!expiresAt || Date.parse(expiresAt) > Date.now()) {
    throw new HttpError(409, 'the duppy is still thinking');
  }

  let state = toState(row, table!.seat_count, table!.mode, table!.format);
  state = applyMove(state, duppyMove(state, actor.duppy_level));

  const clock: Clock = { base: table!.turn_seconds, cap: table!.turn_cap_seconds };
  const banks: number[] = seats!.map((seat: any) => seat.time_bank ?? 0);
  const nextSeconds = state.status === 'active' && seats![state.turn].duppy_level
    ? duppyThinkSeconds(table!.duppy_pace)
    : allowance(clock, banks[state.turn] ?? 0);

  try {
    await persist(db, row.id, table!.id, row.set_id, state, seatUsers, nextSeconds, row.version);
  } catch (err) {
    if (err instanceof Conflict) throw new HttpError(409, 'someone else moved first');
    throw err;
  }

  if (state.status !== 'active') {
    const current = {
      options: {
        mode: table!.mode, format: table!.format, seatCount: table!.seat_count,
        oneAllPlayTwo: table!.one_all_play_two,
        useBoneyard: table!.use_boneyard, target: table!.format === 'french' ? 100 : 6,
      },
      scores: set!.scores, handValue: set!.hand_value, poser: set!.poser,
      poseMustBeDoubleSix: set!.pose_must_be_double_six, playoff: set!.playoff,
      handsPlayed: set!.hands_played, winnerSide: set!.winner_side, sixLove: set!.six_love,
      frenchTieBreak: set!.french_tie_break ?? false,
    };
    const next = applyHandResult(current as any, state.result!);
    await db.from('sets').update({
      scores: next.scores, hand_value: next.handValue, poser: next.poser,
      pose_must_be_double_six: next.poseMustBeDoubleSix, playoff: next.playoff,
      hands_played: next.handsPlayed, winner_side: next.winnerSide, six_love: next.sixLove,
      french_tie_break: next.frenchTieBreak,
    }).eq('id', row.set_id);
    if (next.winnerSide !== null) {
      await db.from('tables').update({ status: 'finished' }).eq('id', table!.id);
      await applyRatingUpdates(db, table!.mode, seatUsers, next.winnerSide);
    }
    return json({ ok: true, handOver: true, set: next });
  }

  return json({ ok: true, handOver: false, turn: state.turn });
}));
