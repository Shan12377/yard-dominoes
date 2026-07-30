/**
 * Online tables.
 *
 * Everything here is a request or a subscription. The client never computes
 * game state — it asks the server to apply a move and then renders whatever
 * comes back. That is what makes the anti-cheat guarantees real rather than
 * aspirational.
 */

/// <reference types="vite/client" />
import { createClient, type SupabaseClient, type RealtimeChannel, FunctionsHttpError } from '@supabase/supabase-js';
import type { Board, ClockName, GameMode, Move, TileId } from '@yard/engine';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const online = Boolean(url && anon);

export const supabase: SupabaseClient | null = online
  ? createClient(url!, anon!, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;

function client(): SupabaseClient {
  if (!supabase) throw new Error('Online play needs VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY');
  return supabase;
}

/** Guest play. No Facebook, no email, no wall in front of a first game. */
export async function signInAsGuest() {
  const { data, error } = await client().auth.signInAnonymously();
  if (error) throw error;
  return data.user;
}

/**
 * Whoever is here already, or a fresh guest. Lounges and membership need a
 * signed-in user for RLS to resolve anything at all, and the product rule is
 * that nobody sees a sign-in wall — so this runs silently before either view
 * loads, never as something the player has to click.
 */
export async function ensureSignedIn() {
  const { data } = await client().auth.getUser();
  if (data.user) return data.user;
  return signInAsGuest();
}

export async function signInWithProvider(provider: 'apple' | 'google') {
  const { error } = await client().auth.signInWithOAuth({
    provider,
    options: { redirectTo: window.location.origin },
  });
  if (error) throw error;
}

export class ConflictError extends Error {
  constructor() { super('someone else moved first'); }
}

async function call<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await client().functions.invoke(fn, { body });
  if (error) {
    if (fn === 'play-move' && error instanceof FunctionsHttpError && error.context?.status === 409) {
      throw new ConflictError();
    }
    throw new Error(error.message);
  }
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as T;
}

export interface CreateTableInput {
  mode: GameMode;
  format: 'sixlove' | 'firstToSix';
  seatCount: 2 | 3 | 4;
  tournament?: boolean;
  oneAllPlayTwo?: boolean;
  isPrivate?: boolean;
  duppies?: string[];
  loungeId?: string;
  /** Named, not numeric — the server owns the seconds. */
  clock?: ClockName;
}

export const createTable = (input: CreateTableInput) =>
  call<{ tableId: string; joinCode: string }>('create-table', { ...input });

export const joinTable = (joinCode: string) =>
  call<{ tableId: string; seatIndex: number }>('join-table', { joinCode });

/** Sit at a table you already know the id of — a tournament seat you were
 *  drawn to, where nobody read a code aloud. Same function, same checks. */
export const joinTableById = (tableId: string) =>
  call<{ tableId: string; seatIndex: number }>('join-table', { tableId });

export const passPose = (tableId: string) =>
  call<{ ok: true }>('pass-pose', { tableId });

export const leaveSeat = (tableId: string) =>
  call<{ ok: true }>('leave-seat', { tableId });

export const startHand = (tableId: string, clientSeed?: string) =>
  call<{ handId: string; commitment: string; turn: number }>('start-hand', { tableId, clientSeed });

export const playMove = (handId: string, move: Move) =>
  call<{ handOver: boolean; turn?: number }>('play-move', { handId, move });

export const requestReview = (handId: string) =>
  call<{ review: unknown; accuracy: number }>('review-hand', { handId });

/** The redacted state every seat is allowed to see. */
export interface PublicHand {
  hand_id: string;
  commitment: string;
  server_seed: string | null;
  board: Board | null;
  turn: number;
  hand_sizes: number[];
  boneyard_size: number;
  move_log: Move[];
  status: string;
  result: unknown;
  turn_expires_at: string | null;
}

export interface TableSubscription {
  channel: RealtimeChannel;
  stop: () => void;
}

/**
 * Watch a table. Two streams: the public state everyone sees, and this seat's
 * private tiles. RLS decides which `seat_hands` rows a client is allowed to
 * see — historically only its own, but openhand mode (0016) also lets a seat
 * read its partner's row. The callback therefore takes the seat_index and the
 * caller routes: their own row updates `myTiles`, the partner's updates
 * `partnerTiles`. Reading a row and dropping it is fine; storing partner tiles
 * into `myTiles` would silently render the wrong hand.
 */
export function watchTable(
  tableId: string,
  handlers: {
    onPublic?: (hand: PublicHand) => void;
    onSeatTiles?: (handId: string, seatIndex: number, tiles: TileId[]) => void;
    onSet?: (set: Record<string, unknown>) => void;
    onSeats?: () => void;
  },
): TableSubscription {
  const db = client();
  const channel = db.channel(`table:${tableId}`)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'hand_public', filter: `table_id=eq.${tableId}` },
      (payload) => handlers.onPublic?.(payload.new as PublicHand))
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'seat_hands' },
      (payload) => handlers.onSeatTiles?.(
        (payload.new as any).hand_id as string,
        (payload.new as any).seat_index as number,
        (payload.new as any).tiles as TileId[]))
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'sets', filter: `table_id=eq.${tableId}` },
      (payload) => handlers.onSet?.(payload.new as Record<string, unknown>))
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'seats', filter: `table_id=eq.${tableId}` },
      () => handlers.onSeats?.())
    .subscribe();

  return { channel, stop: () => { void db.removeChannel(channel); } };
}

/** Record that a player checked a deal. Useful trust signal to publish. */
export async function logVerification(handId: string, ok: boolean, reason?: string) {
  const { data: user } = await client().auth.getUser();
  if (!user.user) return;
  await client().from('verifications').insert({
    hand_id: handId, user_id: user.user.id, ok, reason,
  });
}

/**
 * Find a table this user is currently seated at with a hand in progress.
 * Used on load to offer "rejoin" instead of losing a live game to a reload.
 */
export async function findActiveSeat(): Promise<{ tableId: string; seatIndex: number } | null> {
  const db = client();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return null;
  const { data } = await db.from('seats')
    .select('table_id, seat_index, tables!inner(status)')
    .eq('user_id', auth.user.id)
    .eq('tables.status', 'playing')
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return { tableId: data.table_id as string, seatIndex: data.seat_index as number };
}
