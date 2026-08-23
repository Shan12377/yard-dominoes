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
import type { AnyBoard, ClockName, GameMode, HandReceipt, HandReview, Move, PenaltyEvent, TileId } from '@yard/engine';
import { takeReferralCode } from './referral.ts';

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
  // Consumed exactly once, here — the only place a brand-new auth.users row
  // (and with it, handle_new_user()'s profile insert) actually gets created.
  // See referral.ts and 0045_referrals.sql.
  const referralCode = takeReferralCode();
  const { data, error } = await client().auth.signInAnonymously(
    referralCode ? { options: { data: { referral_code: referralCode } } } : undefined,
  );
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

/**
 * A guest session lives in one browser's storage — clear it, and the account
 * (and anything staff-granted on it, like is_admin) is gone with no way back
 * in. This attaches a real email + password to the CURRENT session, keeping
 * the same user id — profile, tier, and any admin/host grant all carry over
 * unchanged. Supabase emails a confirmation link to the new address before
 * the account actually stops being anonymous; `isAnonymousUser()` stays true
 * until that link is clicked.
 */
export async function secureAccount(email: string, password: string): Promise<void> {
  // Explicit, rather than trusting the dashboard's Site URL to be current —
  // a stale one silently sends the confirmation link to localhost. This
  // matches signInWithProvider's redirectTo below.
  const { error } = await client().auth.updateUser(
    { email, password },
    { emailRedirectTo: window.location.origin },
  );
  if (error) throw error;
}

/** Switch the current browser session to an already-secured account. */
export async function signInWithPassword(email: string, password: string): Promise<void> {
  const { error } = await client().auth.signInWithPassword({ email, password });
  if (error) throw error;
}

/**
 * Forgot-password: emails a reset link. `?recovery=1` is our own marker, not
 * anything Supabase requires — the SDK parses its own tokens out of the
 * redirect URL regardless of format, but main.ts's boot sequence needs a
 * plain, unambiguous signal it can check synchronously, before the lounge
 * module (and the Supabase client living inside it) has even loaded, to
 * decide whether to force that module in early. A recovery link landing on
 * a version of the app that never loads online.ts would silently strand it.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const { error } = await client().auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/?recovery=1`,
  });
  if (error) throw error;
}

/** Sets a new password on the temporary session a recovery link establishes. */
export async function updatePassword(newPassword: string): Promise<void> {
  const { error } = await client().auth.updateUser({ password: newPassword });
  if (error) throw error;
}

/**
 * Fires once the Supabase SDK has parsed a recovery link from the URL and
 * established the temporary session it grants — not before, since that
 * parsing happens asynchronously against whatever's in the URL at client
 * creation time. Returns an unsubscribe function; there is currently only
 * ever one caller (loungeview.ts, once, on first load) so leaking the
 * subscription for the page's lifetime is a non-issue in practice, but
 * callers that might mount more than once should still call it.
 */
export function watchForPasswordRecovery(onRecovery: () => void): () => void {
  const { data } = client().auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') onRecovery();
  });
  return () => data.subscription.unsubscribe();
}

/** True for a guest session never attached to a real email. */
export async function isAnonymousUser(): Promise<boolean> {
  const { data } = await client().auth.getUser();
  return data.user?.is_anonymous ?? true;
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
    // HttpError's message (lib.ts's `handled()`) lands in the response body,
    // not on `error.message` — the SDK only ever sets that to a generic
    // "non-2xx status code" string. Read the real text out of the body so a
    // caller-facing reason (a tier gate, a daily limit) actually reaches
    // the player instead of a placeholder.
    if (error instanceof FunctionsHttpError) {
      const parsed = await error.context.json().catch(() => null);
      throw new Error(parsed?.error ?? error.message);
    }
    throw new Error(error.message);
  }
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as T;
}

export interface CreateTableInput {
  mode: GameMode;
  format: 'sixlove' | 'firstToSix' | 'french';
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
  call<{ review: HandReview; accuracy: number }>('review-hand', { handId });

/** 2 coins for every seat's starting tiles on a finished hand — see
 *  reveal-hand's own header for what this adds beyond the free replay. */
export const revealHand = (handId: string) =>
  call<{ ok: true; deal: TileId[][]; receipt: HandReceipt }>('reveal-hand', { handId });

/** French's paid mid-hand reshuffle — 2 coins, once per set, only while your
 *  own score sits between 50 and 70. See french-reshuffle's own header. */
export const frenchReshuffle = (tableId: string) =>
  call<{ ok: true }>('french-reshuffle', { tableId });

/** video.ts is injected this rather than importing online.ts directly, so
 *  it has no Supabase client dependency of its own. */
export const videoSessionCall = (action: string, body: Record<string, unknown>) =>
  call<any>('video-session', { action, ...body });

/** voice.ts and video.ts are both injected this — same reasoning as
 *  videoSessionCall above. */
export const turnCredentialsCall = () =>
  call<{ iceServers: RTCIceServer[] }>('turn-credentials', {});

/** The redacted state every seat is allowed to see. */
export interface PublicHand {
  hand_id: string;
  commitment: string;
  server_seed: string | null;
  board: AnyBoard | null;
  turn: number;
  hand_sizes: number[];
  boneyard_size: number;
  move_log: Move[];
  status: string;
  result: unknown;
  /** This row's most recent penalty events only — see PenaltyEvent. */
  last_penalties: PenaltyEvent[];
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
