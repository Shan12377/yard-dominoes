// The DB-touching half of rating-update.ts's pure glue: read every seat's
// current rating/RD, compute the post-set values, write them back. Not
// unit-testable without a live project (same reason persist() in lib.ts
// isn't) — the pure math and the pure domino-glue both are, and both have
// full coverage; this file is exercised by live Edge Function testing
// instead, same discipline as everywhere else money- or trust-adjacent in
// this codebase.

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { ratingUpdatesForSet } from './rating-update.ts';
import { effectiveTier } from './lib.ts';
import { sideOf } from './engine/tiles.ts';
import type { RatedSeat } from './rating-update.ts';
import type { GameMode } from './engine/types.ts';

/**
 * Rate a just-completed set, if it's ratable — call from the same
 * post-persist block that already advances `sets`/`tables` on
 * `winnerSide !== null` (play-move and expire-turns both have one).
 * A no-op for any table with a duppy seat; `ratingUpdatesForSet` returns []
 * for those and this simply writes nothing.
 */
/** Yard Rating never drops below this (owner, 2026-09-17). */
export const RATING_FLOOR = 1000;
/** A six-love win's gain is multiplied by this; the losers lose no extra. */
export const SIX_LOVE_BONUS = 1.5;
/** A losing side that won at least one hand this game loses this share less. */
export const LOVE_SHIELD = 0.25;
/** Below this Table Trust a player's games are unrated for them. */
export const ROUGH_PLAY_TRUST = 75;

export interface RatingOptions {
  /** 'french' writes the French rating instead of the cut-throat one. */
  format?: string;
  /** Only these players' ratings are written: those seated for the whole game. */
  ratedUsers?: Set<string>;
  sixLove?: boolean;
  /** Did this side win at least one hand during the game? */
  brokeLove?: (side: number) => boolean;
}

export async function applyRatingUpdates(
  db: SupabaseClient,
  mode: GameMode,
  seatUsers: (string | null)[],
  winnerSide: number,
  options: RatingOptions = {},
): Promise<void> {
  const humanIds = seatUsers.filter((id): id is string => id !== null);
  if (humanIds.length !== seatUsers.length) return; // any duppy seat — not rated, cheap to bail before the query

  // French has its own board (0067): it is cut-throat mode underneath, but a
  // race to 100 where the lowest score wins is its own skill.
  const french = options.format === 'french';
  const column = french ? 'rating_french' : mode === 'cutthroat' ? 'rating_cutthroat' : 'rating_partner';
  const rdColumn = french ? 'rd_french' : mode === 'cutthroat' ? 'rd_cutthroat' : 'rd_partner';

  const { data: profiles, error } = await db.from('profiles')
    .select(`id, tier, tier_expires_at, table_trust, is_admin, ${column}, ${rdColumn}`).in('id', humanIds);
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
  // Ranking is the Yardie perk (owner, 2026-09-16, option B): every real set
  // is still rated — a guest's current rating counts in everyone's expected
  // score — but only a Yardie or VIP has their own rating written. A guest
  // plays, and never ranks.
  const member = (userId: string) => {
    const p = byId.get(userId);
    return effectiveTier({ tier: p?.tier ?? 'guest', tier_expires_at: p?.tier_expires_at ?? null }) !== 'guest';
  };
  const sideOfUser = new Map<string, number>();
  seatUsers.forEach((id, seat) => { if (id) sideOfUser.set(id, sideOf(seat, mode)); });
  for (const update of updates) {
    if (!member(update.userId)) continue;
    if (options.ratedUsers && !options.ratedUsers.has(update.userId)) continue;
    // Admins play unranked; the players at their table are still rated.
    if (byId.get(update.userId)?.is_admin) continue;
    // Rough Play: behaviour never changes the rating, but it pauses it.
    if ((byId.get(update.userId)?.table_trust ?? 100) < ROUGH_PLAY_TRUST) continue;
    const before = byId.get(update.userId)?.[column] ?? 1200;
    const side = sideOfUser.get(update.userId);
    let delta = update.next.rating - before;
    if (side === winnerSide && options.sixLove && delta > 0) delta *= SIX_LOVE_BONUS;
    if (side !== winnerSide && delta < 0 && side !== undefined && options.brokeLove?.(side)) delta *= 1 - LOVE_SHIELD;
    const rating = Math.max(RATING_FLOOR, Math.round(before + delta));
    const { error: writeError } = await db.from('profiles')
      .update({ [column]: rating, [rdColumn]: update.next.rd })
      .eq('id', update.userId);
    if (writeError) console.error('applyRatingUpdates: write failed', update.userId, writeError);
  }
}
