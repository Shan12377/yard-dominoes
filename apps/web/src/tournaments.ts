/**
 * Tournaments, client side.
 *
 * Reads only. Every write — signing up, withdrawing, and every host action —
 * goes through an Edge Function, because `tournaments` and `tournament_signups`
 * carry no client write grant at all (0015). The one that matters most is
 * `signed_up_at`: it decides the queue, so a client able to write its own row
 * could write itself an earlier morning.
 *
 * **This file never sorts the queue.** The server computes each player's
 * position and hands back a number to render. The rule lives in
 * `supabase/functions/_shared/tournament-queue.ts`, which `apps/web` cannot
 * import — so any ordering here would be a second implementation of the promise
 * VIP is actually sold on, free to drift from the one that seats people.
 */

import type { GameMode } from '@yard/engine';
import { supabase } from './online.ts';

export type TournamentStatus =
  | 'announced' | 'signups_open' | 'seating' | 'running' | 'finished' | 'cancelled';

export type TournamentTheme = 'open' | 'battle_of_the_sexes';

/** What a player is told this event is. */
export const THEME_LABEL: Record<TournamentTheme, string> = {
  open: 'Open to all',
  battle_of_the_sexes: 'Battle of the sexes — women against men',
};

export interface Tournament {
  id: string;
  loungeId: string | null;
  name: string;
  mode: GameMode;
  format: string;
  seatCount: number;
  /**
   * Which kind of event. Seating only — a theme never changes the rules of
   * the game. 'open' is the ordinary one and is what any older row reads as.
   */
  theme: TournamentTheme;
  startsAt: string;
  signupsOpenAt: string | null;
  rounds: number;
  status: TournamentStatus;
  /** The intercom. A column the host writes, not a forgeable broadcast. */
  notice: string | null;
  hostId: string | null;
}

/** Where one player stands in line. Computed server-side, rendered here. */
export interface Standing {
  position: number | null;
  vipsAhead: number;
  total: number;
  aboveCut: boolean;
  status: string | null;
  round: number | null;
  tableId: string | null;
}

export interface QueueRow {
  userId: string;
  username: string;
  tier: string;
  signedUpAt: string;
  status: string;
  round: number | null;
  tableId: string | null;
  position: number;
  aboveCut: boolean;
}

function db() {
  if (!supabase) throw new Error('Tournaments need online mode — set VITE_SUPABASE_URL');
  return supabase;
}

function shape(row: any): Tournament {
  return {
    id: row.id,
    loungeId: row.lounge_id ?? null,
    name: row.name,
    mode: row.mode,
    format: row.format,
    seatCount: row.seat_count,
    theme: (row.theme ?? 'open') as TournamentTheme,
    startsAt: row.starts_at,
    signupsOpenAt: row.signups_open_at ?? null,
    rounds: row.rounds,
    status: row.status,
    notice: row.notice ?? null,
    hostId: row.host_id ?? null,
  };
}

/**
 * The one to put on screen: the soonest event that has not been called off.
 *
 * `running` is included on purpose — the tournament you are in the middle of is
 * far more interesting than next week's, and a banner that vanishes the moment
 * play begins takes the intercom with it.
 */
export async function nextTournament(): Promise<Tournament | null> {
  const { data, error } = await db().from('tournaments')
    .select('*')
    .in('status', ['announced', 'signups_open', 'seating', 'running'])
    .order('starts_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? shape(data) : null;
}

/** Every event a host can still act on, soonest first. */
export async function hostableTournaments(): Promise<Tournament[]> {
  const { data, error } = await db().from('tournaments')
    .select('*')
    .in('status', ['announced', 'signups_open', 'seating', 'running'])
    .order('starts_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data as any[]).map(shape);
}

async function call<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await db().functions.invoke(fn, { body });
  if (error) throw new Error(error.message);
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as T;
}

interface SignupReply { entered: boolean; standing: Standing }

/** Read-only: where the signed-in player stands, without changing anything. */
export const myStanding = (tournamentId: string) =>
  call<SignupReply>('tournament-signup', { tournamentId, action: 'status' });

export const enterTournament = (tournamentId: string) =>
  call<SignupReply>('tournament-signup', { tournamentId, action: 'enter' });

export const withdrawFromTournament = (tournamentId: string) =>
  call<SignupReply>('tournament-signup', { tournamentId, action: 'withdraw' });

// ------------------------------------------------------------------ host ----
// Every one of these is refused server-side unless `profiles.is_host` is true.
// The check is not here, and a patched client gains nothing by removing the
// buttons' `disabled` attribute.

export interface NewTournament {
  name: string;
  mode: GameMode;
  format: string;
  seatCount: number;
  clock: string;
  theme?: TournamentTheme;
  startsAt: string;
  signupsOpenAt?: string | null;
  rounds?: number;
  loungeId?: string | null;
}

export const createTournament = (input: NewTournament) =>
  call<{ tournamentId: string }>('tournament-host', { action: 'create', ...input });

export const setNotice = (tournamentId: string, notice: string | null) =>
  call<{ notice: string | null }>('tournament-host', { action: 'notice', tournamentId, notice });

export const setSignups = (tournamentId: string, open: boolean) =>
  call<{ status: string }>('tournament-host', {
    action: open ? 'open' : 'close', tournamentId,
  });

export const cancelTournament = (tournamentId: string) =>
  call<{ status: string }>('tournament-host', { action: 'cancel', tournamentId });

export const finishTournament = (tournamentId: string) =>
  call<{ ok: true }>('tournament-host', { action: 'finish', tournamentId });

/**
 * Un-draw a round: abandon the tables nobody ever started and put those players
 * back in the queue.
 *
 * The escape hatch for the one state a host cannot otherwise leave. A table
 * where nobody turned up stays 'waiting' for ever — nothing in the app writes
 * 'abandoned', and a table only reaches 'finished' when a set completes — so it
 * blocks every future draw. No-shows are expected here; the substitutes line
 * exists for them.
 *
 * Only un-started tables are touched, so this can never void a hand in play.
 */
export const clearRound = (tournamentId: string) =>
  call<{ cleared: number }>('tournament-host', { action: 'clear', tournamentId });

/** Draw one round: order the queue, cut it into full tables, open them. */
export const drawRound = (tournamentId: string) =>
  call<{
    round: number;
    tables: { tableId: string; joinCode: string; players: string[] }[];
    substitutes: string[];
  }>('tournament-host', { action: 'start', tournamentId });

/**
 * Set one player's standing by hand.
 *
 * `out` is how a round advances in v1 — the host marks whoever lost and draws
 * the next round from the rest. `disqualified` is the penalty, and it strips
 * THIS event only: ratings are deliberately left alone while "strip a player's
 * runs" is still ambiguous between a Sunday result and a permanent record.
 */
export const markPlayer = (
  tournamentId: string,
  userId: string,
  status: 'signed_up' | 'out' | 'disqualified',
) => call<{ ok: true }>('tournament-host', { action: 'mark', tournamentId, userId, status });

export const hostQueue = (tournamentId: string) =>
  call<{
    queue: QueueRow[];
    wouldSeat: number;
    substitutes: number;
    standing: Standing;
  }>('tournament-host', { action: 'queue', tournamentId });
