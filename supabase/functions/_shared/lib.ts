// Shared helpers for every Edge Function.
//
// The engine is vendored into ../_shared/engine by `npm run sync:engine`, so
// the exact same rules code that the tests cover is what validates live moves.

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { GameMode, HandState, Move, PenaltyEvent, SetFormat, TileId } from '../_shared/engine/types.ts';

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...cors },
  });

export const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

export function preflight(req: Request): Response | null {
  return req.method === 'OPTIONS' ? new Response('ok', { headers: cors }) : null;
}

/** Service-role client. Bypasses RLS — never expose this key to a browser. */
export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );
}

/** Resolve the caller from their bearer token. */
export async function requireUser(req: Request): Promise<{ id: string; email: string | null; emailConfirmed: boolean }> {
  const auth = req.headers.get('Authorization');
  if (!auth) throw new HttpError(401, 'sign in first');
  const anon = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: auth } }, auth: { persistSession: false } },
  );
  const { data, error } = await anon.auth.getUser();
  if (error || !data.user) throw new HttpError(401, 'sign in first');
  return {
    id: data.user.id,
    email: data.user.email ?? null,
    // Supabase keeps is_anonymous true until the confirmation link is clicked,
    // so this is "reachable at a real address", not merely "typed one in".
    emailConfirmed: !!data.user.email && data.user.is_anonymous !== true,
  };
}

/**
 * The Lounge needs somebody reachable behind each seat — a ban a cleared
 * browser undoes is not a ban, and a table dispute with an anonymous account
 * has nobody to answer it. Owner's partner, 2026-09-12: "for people to use
 * lounge, they must have an email."
 *
 * RLS carries this for the lounge tables (0062's has_lounge_email), but these
 * functions run as the SERVICE ROLE, which RLS does not apply to — so anything
 * that seats a player online has to ask for itself. Practice is untouched and
 * stays anonymous: this is an identity floor on the social room, not a wall in
 * front of a first game.
 */
export function requireLoungeEmail(user: { emailConfirmed: boolean }): void {
  if (!user.emailConfirmed) {
    throw new HttpError(403, 'add an email to your account to play in the Lounge');
  }
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const TIER_RANK: Record<string, number> = { guest: 0, yardie: 1, vip: 2 };

/** Mirrors the SQL effective_tier() function: expired paid tiers read as guest. */
export function effectiveTier(profile: { tier: string; tier_expires_at: string | null }): string {
  if (profile.tier === 'guest') return 'guest';
  if (!profile.tier_expires_at || Date.parse(profile.tier_expires_at) > Date.now()) return profile.tier;
  return 'guest';
}

export function handled(fn: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    const pre = preflight(req);
    if (pre) return pre;
    try {
      return await fn(req);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: 'something went wrong' }, 500);
    }
  };
}

export interface HandRow {
  id: string;
  set_id: string;
  hand_no: number;
  commitment: string;
  server_seed: string | null;
  client_seeds: string[];
  deal: string[][];
  hands: string[][];
  boneyard: string[];
  board: HandState['board'];
  turn: number;
  consecutive_passes: number;
  move_log: Move[];
  status: string;
  result: HandState['result'];
  poser: number;
  pose_must_be_double_six: boolean;
  pose_must_be_any_double: boolean;
  version: number;
  penalties: number[];
  penalty_log: PenaltyEvent[];
}

/**
 * Which tile the forced-pose branch must lead. French round 1 uses the double blank
 * (0-0); every other format uses the double-six. Derived from format so no new
 * database column is needed and there is only ever one place to change if the
 * rule ever splits further.
 */
/**
 * One table at a time (owner, 2026-09-17). Two open tables means one of them
 * is running your turn clock while you think at the other, so the seat you
 * are not looking at collects timed-out moves and stall-outs.
 *
 * Both doors ask this: join-table and create-table, which seats its creator
 * itself. A seat you LEFT does not count — leave-seat nulls `user_id`, so a
 * rejoin inside the window still passes — and neither does the table you are
 * already sitting at, via `exceptTableId`.
 */
export async function requireNoOtherLiveTable(
  db: SupabaseClient,
  userId: string,
  exceptTableId?: string,
): Promise<void> {
  let query = db.from('seats').select('table_id, tables!inner(status)')
    .eq('user_id', userId).neq('tables.status', 'finished');
  if (exceptTableId) query = query.neq('table_id', exceptTableId);
  const { data, error } = await query;
  if (error) {
    console.error('requireNoOtherLiveTable: could not read seats', error);
    return; // never block a legitimate sit-down on a read failure
  }
  if (data && data.length > 0) {
    throw new HttpError(409, 'you are already seated at another table — leave that one first');
  }
}

export function openingTileForFormat(format: SetFormat): TileId {
  return format === 'french' ? '0-0' : '6-6';
}

/**
 * Target score for a set — how many points end it. First-to-six for the
 * standard formats; race-to-100 for French (where the seat that CROSSES it
 * loses, and the winner is the seat with the lowest score at that moment).
 */
export function targetForFormat(format: SetFormat): number {
  return format === 'french' ? 100 : 6;
}

/** Rehydrate the engine's state object from a database row. */
export function toState(row: HandRow, seatCount: number, mode: GameMode, format: SetFormat): HandState {
  return {
    seatCount,
    mode,
    // Required on HandState — without it, applyMove's pose branch
    // (`s.format === 'french'`) is always false server-side even for a real
    // French table, so a double blank pose builds a linear board instead of a
    // cross one. openingTile alone isn't enough; this was missing here.
    format,
    hands: row.hands,
    boneyard: row.boneyard,
    board: row.board,
    turn: row.turn,
    consecutivePasses: row.consecutive_passes,
    moveLog: row.move_log,
    // Empty on a freshly-inserted row (column default) and on any hand
    // dealt before this column existed — both read the same as "nothing
    // accrued yet", not a data error.
    penalties: row.penalties && row.penalties.length > 0 ? row.penalties : new Array(seatCount).fill(0),
    // Same "empty reads as nothing accrued yet" story as `penalties` above —
    // and just as load-bearing: without this, a penalty earned earlier in
    // the hand vanished the moment the NEXT move rehydrated HandState from
    // this row, even though `penalties` (the numbers) survived via its own
    // column. Found live 2026-08-23 — see 0044_penalty_log.sql.
    penaltyLog: row.penalty_log ?? [],
    status: row.status as HandState['status'],
    result: row.result,
    poseMustBeDoubleSix: row.pose_must_be_double_six,
    poseMustBeAnyDouble: row.pose_must_be_any_double,
    openingTile: openingTileForFormat(format),
    poser: row.poser,
  };
}

/**
 * Write a new hand state back, fanning it out to the three tables.
 *
 * This function is the ONLY place the redaction happens, which is why it lives
 * alone here: if a seat's tiles ever leak, there is exactly one file to audit.
 */
export class Conflict extends Error {
  constructor() { super('someone else moved first'); }
}

export async function persist(
  db: SupabaseClient,
  handId: string,
  tableId: string,
  setId: string,
  state: HandState,
  seatUsers: (string | null)[],
  turnSeconds: number,
  expectedVersion: number,
  /**
   * Preserve an already-running turn clock instead of recomputing it fresh
   * from `turnSeconds` — needed by anything that persists WITHOUT the
   * current turn actually changing (French's reshuffle rewrites `hands`
   * only; it must not hand the seat on turn a free extra `turnSeconds`).
   * `undefined` keeps every existing caller's behavior unchanged.
   */
  expiresOverride?: string | null,
) {
  const finished = state.status !== 'active';
  const expires = finished
    ? null
    : expiresOverride !== undefined
      ? expiresOverride
      : new Date(Date.now() + turnSeconds * 1000).toISOString();

  // Conditional write. If the row advanced since we read it, this returns null
  // and we abort rather than clobbering another player's move.
  const { data: newVersion, error } = await db.rpc('commit_move', {
    p_hand_id: handId,
    p_expected_version: expectedVersion,
    p_hands: state.hands,
    p_boneyard: state.boneyard,
    p_board: state.board,
    p_turn: state.turn,
    p_passes: state.consecutivePasses,
    p_move_log: state.moveLog,
    p_status: state.status,
    p_result: state.result,
    p_expires: expires,
    p_penalties: state.penalties,
    p_penalty_log: state.penaltyLog ?? [],
  });
  if (error) throw new Error(error.message);
  if (newVersion === null) throw new Conflict();

  // Reveal the seed only once the hand can no longer be influenced by it.
  //
  // One round trip, not two, and CHECKED. The commitment used to be fetched
  // inline below as `.data!.commitment` with no error handling, on every move
  // — and it runs AFTER commit_move has already succeeded, so a transient
  // failure there threw a TypeError and 500'd a move that had in fact landed.
  // The player got "something went wrong" for a bone that was already down.
  // Seen in production 2026-09-12 alongside a play-move gateway timeout.
  const { data: seedRow, error: seedErr } = await db.from('hands')
    .select('commitment, server_seed').eq('id', handId).single();
  if (seedErr || !seedRow) {
    // The move is committed either way; say so plainly rather than crashing.
    // The caller's retry will come back as a conflict and refetch the truth.
    throw new Error(`hand ${handId} committed but its receipt could not be read: ${seedErr?.message ?? 'no row'}`);
  }
  const revealed: string | null = finished ? (seedRow.server_seed ?? null) : null;

  await db.from('hand_public').upsert({
    hand_id: handId,
    table_id: tableId,
    set_id: setId,
    commitment: seedRow.commitment,
    server_seed: revealed,
    board: state.board,
    turn: state.turn,
    hand_sizes: state.hands.map((h) => h.length),
    boneyard_size: state.boneyard.length,
    move_log: state.moveLog,
    status: state.status,
    result: state.result,
    // This move's penalty events only — see PenaltyEvent. Never the running
    // total (that's inside `penalties`/`result.penalties`, not broadcast
    // live); this is what lets every seat learn about a +10 the instant it
    // lands instead of only at hand-end.
    last_penalties: state.lastPenalties ?? [],
    turn_expires_at: expires,
    // Captures the mode this hand was actually dealt under — the openhand RLS
    // policy on seat_hands (0016) gates on THIS value, not on tables.mode, so
    // a table's mode being changed mid-set never retroactively reveals or
    // hides an already-played hand.
    mode: state.mode,
    updated_at: new Date().toISOString(),
  });

  await db.from('seat_hands').upsert(
    state.hands.map((tiles, seat_index) => ({
      hand_id: handId,
      seat_index,
      user_id: seatUsers[seat_index],
      tiles,
    })),
  );
}
