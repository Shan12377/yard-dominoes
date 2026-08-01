// The DB-touching half of rating-update.ts's pure glue: read every seat's
// current rating/RD, compute the post-set values, write them back. Not
// unit-testable without a live project (same reason persist() in lib.ts
// isn't) — the pure math and the pure domino-glue both are, and both have
// full coverage; this file is exercised by live Edge Function testing
// instead, same discipline as everywhere else money- or trust-adjacent in
// this codebase.

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { ratingUpdatesForSet } from './rating-update.ts';
import type { RatedSeat } from './rating-update.ts';
import type { GameMode } from './engine/types.ts';

/**
 * Rate a just-completed set, if it's ratable — call from the same
 * post-persist block that already advances `sets`/`tables` on
 * `winnerSide !== null` (play-move and expire-turns both have one).
 * A no-op for any table with a duppy seat; `ratingUpdatesForSet` returns []
 * for those and this simply writes nothing.
 */
export async function applyRatingUpdates(
  db: SupabaseClient,
  mode: GameMode,
  seatUsers: (string | null)[],
  winnerSide: number,
): Promise<void> {
  const humanIds = seatUsers.filter((id): id is string => id !== null);
  if (humanIds.length !== seatUsers.length) return; // any duppy seat — not rated, cheap to bail before the query

  const column = mode === 'cutthroat' ? 'rating_cutthroat' : 'rating_partner';
  const rdColumn = mode === 'cutthroat' ? 'rd_cutthroat' : 'rd_partner';

  const { data: profiles, error } = await db.from('profiles')
    .select(`id, ${column}, ${rdColumn}`).in('id', humanIds);
  if (error || !profiles) {
    console.error('applyRatingUpdates: could not read profiles', error);
    return;
  }
  const byId = new Map(profiles.map((p: any) => [p.id as string, p]));

  const seats: RatedSeat[] = seatUsers.map((userId) => {
    if (userId === null) return { userId: null, rating: { rating: 1200, rd: 350 } };
    const p = byId.get(userId);
    return {
      userId,
      rating: { rating: p?.[column] ?? 1200, rd: p?.[rdColumn] ?? 350 },
    };
  });

  const updates = ratingUpdatesForSet(mode, seats, winnerSide);
  for (const update of updates) {
    const { error: writeError } = await db.from('profiles')
      .update({ [column]: update.next.rating, [rdColumn]: update.next.rd })
      .eq('id', update.userId);
    if (writeError) console.error('applyRatingUpdates: write failed', update.userId, writeError);
  }
}
