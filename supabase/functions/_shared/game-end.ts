// Everything that happens once when a game (set) is decided: Yard Rating,
// Table Trust and career stats (owner, 2026-09-17). Called from the same
// post-persist block in play-move, expire-turns and advance-duppy, in place of
// the bare rating call those used to make.

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { applyRatingUpdates } from './apply-rating.ts';
import { sideOf } from './engine/tiles.ts';
import type { GameMode } from './engine/types.ts';

/** Turns the clock may play for one person in a game before it is a stall-out. */
export const STALL_OUT_TIMEOUTS = 3;
export const TRUST = { walkOff: 8, loveWalk: 12, stallOut: 5, cleanFinish: 1 } as const;

const clampTrust = (value: number) => Math.max(0, Math.min(100, value));

export async function finishGame(
  db: SupabaseClient,
  table: { id: string; mode: GameMode; format?: string },
  setId: string,
  winnerSide: number,
  sixLove: boolean,
): Promise<void> {
  const { data: seats } = await db.from('seats').select('*').eq('table_id', table.id).order('seat_index');
  const { data: set } = await db.from('sets').select('created_at').eq('id', setId).single();
  if (!seats || !set) return;
  const began = Date.parse(set.created_at as string);
  // Legacy seats (before 0066) have no sat_at: they count as present throughout.
  const fullGame = (s: any) => !!s.user_id && (!s.sat_at || Date.parse(s.sat_at) <= began);

  // Which sides won at least one hand this game: a losing side that broke its
  // love loses less rating.
  const { data: hands } = await db.from('hands').select('result').eq('set_id', setId);
  const scoredSides = new Set<number>();
  for (const h of hands ?? []) {
    const side = (h as any).result?.winnerSide;
    if (typeof side === 'number' && !(h as any).result?.tie) scoredSides.add(side);
  }

  await applyRatingUpdates(db, table.mode, seats.map((s: any) => s.user_id), winnerSide, {
    format: table.format,
    ratedUsers: new Set(seats.filter(fullGame).map((s: any) => s.user_id as string)),
    sixLove,
    brokeLove: (side) => scoredSides.has(side),
  });

  // One update per person (an Across player holds two seats).
  const people = new Map<string, any[]>();
  for (const s of seats) if (s.user_id) people.set(s.user_id, [...(people.get(s.user_id) ?? []), s]);
  for (const [userId, mine] of people) {
    const { data: p } = await db.from('profiles')
      .select('is_admin, table_trust, games_finished, games_won, win_streak, best_win_streak').eq('id', userId).single();
    if (!p) continue;
    const won = mine.some((s) => sideOf(s.seat_index, table.mode) === winnerSide);
    const streak = won ? (p.win_streak ?? 0) + 1 : 0;
    let trust = p.table_trust ?? 100;
    // Admins carry no Table Trust (owner, 2026-09-17).
    if (!p.is_admin) {
      if (mine.some(fullGame)) trust += TRUST.cleanFinish;
      if (mine.reduce((n, s) => n + (s.timeouts ?? 0), 0) >= STALL_OUT_TIMEOUTS) trust -= TRUST.stallOut;
    }
    const { error } = await db.from('profiles').update({
      table_trust: clampTrust(trust),
      games_finished: (p.games_finished ?? 0) + 1,
      games_won: (p.games_won ?? 0) + (won ? 1 : 0),
      win_streak: streak,
      best_win_streak: Math.max(p.best_win_streak ?? 0, streak),
    }).eq('id', userId);
    if (error) console.error('finishGame: profile update failed', userId, error);
  }
  await db.from('seats').update({ timeouts: 0 }).eq('table_id', table.id);
}

/** Count a new game for everyone seated as a set begins, or one person joining mid-game. */
export async function countStarted(db: SupabaseClient, userIds: string[]): Promise<void> {
  for (const userId of new Set(userIds)) {
    const { data: p } = await db.from('profiles').select('games_started').eq('id', userId).single();
    if (!p) continue;
    await db.from('profiles').update({ games_started: (p.games_started ?? 0) + 1 }).eq('id', userId);
  }
}

/** Table Trust taken for walking off a game in progress; given back on a rejoin. */
export async function adjustTrust(db: SupabaseClient, userId: string, delta: number, loveWalkDelta = 0): Promise<void> {
  const { data: p } = await db.from('profiles').select('is_admin, table_trust, love_walks').eq('id', userId).single();
  if (!p || p.is_admin) return;
  await db.from('profiles').update({
    table_trust: clampTrust((p.table_trust ?? 100) + delta),
    love_walks: Math.max(0, (p.love_walks ?? 0) + loveWalkDelta),
  }).eq('id', userId);
}
