// Scheduled via pg_cron. Serverless has no long-lived timers, so stale turns
// are retired by a job instead.
//
// A timed-out seat plays a legal move rather than forfeiting outright. Losing
// games to a frozen client is one of the loudest complaints against every rival
// app; the fix is to keep the game moving, not to punish the player.

import { handled, json, serviceClient, toState, persist } from '../_shared/lib.ts';
import { legalMoves, applyMove } from '../_shared/engine/hand.ts';
import { applyHandResult } from '../_shared/engine/set.ts';
import { duppyMove } from '../_shared/engine/bots.ts';
import { allowance } from '../_shared/engine/clock.ts';

Deno.serve(handled(async () => {
  const db = serviceClient();
  const { data: stale } = await db.from('hands').select('*')
    .eq('status', 'active').lt('turn_expires_at', new Date().toISOString()).limit(25);

  let moved = 0;
  for (const row of stale ?? []) {
    const { data: set } = await db.from('sets').select('*').eq('id', row.set_id).single();
    const { data: table } = await db.from('tables').select('*').eq('id', set!.table_id).single();
    const { data: seats } = await db.from('seats').select('*').eq('table_id', table!.id).order('seat_index');

    let state = toState(row as any, table!.seat_count, table!.mode);
    if (legalMoves(state).length === 0) continue;

    const clock = { base: table!.turn_seconds, cap: table!.turn_cap_seconds };
    const banks: number[] = seats!.map((s: any) => s.time_bank ?? 0);
    // The seat that ran out has spent everything it had — base and bank both.
    // It is emptied rather than left alone, or a player could bank time all
    // game and then sit out every turn on the same hoard.
    const timedOut = state.turn;
    banks[timedOut] = 0;

    state = applyMove(state, duppyMove(state, 'yard'));

    let guard = 0;
    while (state.status === 'active' && seats![state.turn].duppy_level && guard++ < 40) {
      state = applyMove(state, duppyMove(state, seats![state.turn].duppy_level));
    }
    await persist(db, row.id, table!.id, row.set_id, state,
      seats!.map((s: any) => s.user_id),
      allowance(clock, banks[state.turn] ?? 0), (row as any).version);
    await db.from('seats').update({ time_bank: 0 })
      .eq('table_id', table!.id).eq('seat_index', timedOut);
    moved++;

    // Mirror play-move's post-persist block: a forced timeout move can end a
    // hand exactly as a human move can, and if it does, the set/table must
    // advance the same way — otherwise an all-duppy table (reachable now that
    // leave-seat converts human seats to duppies) never resolves its sets.
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
    }
  }
  return json({ ok: true, moved });
}));
