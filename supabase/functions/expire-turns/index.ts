// Scheduled via pg_cron. Serverless has no long-lived timers, so stale turns
// are retired by a job instead.
//
// A timed-out seat plays a legal move rather than forfeiting outright. Losing
// games to a frozen client is one of the loudest complaints against every rival
// app; the fix is to keep the game moving, not to punish the player.

import { handled, json, serviceClient, toState, persist } from '../_shared/lib.ts';
import { legalMoves, applyMove } from '../_shared/engine/hand.ts';
import { duppyMove } from '../_shared/engine/bots.ts';

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
    state = applyMove(state, duppyMove(state, 'yard'));

    let guard = 0;
    while (state.status === 'active' && seats![state.turn].duppy_level && guard++ < 40) {
      state = applyMove(state, duppyMove(state, seats![state.turn].duppy_level));
    }
    await persist(db, row.id, table!.id, row.set_id, state,
      seats!.map((s: any) => s.user_id), table!.turn_seconds, (row as any).version);
    moved++;
  }
  return json({ ok: true, moved });
}));
