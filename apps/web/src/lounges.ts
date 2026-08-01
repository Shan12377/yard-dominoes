/**
 * Lounges: the social layer.
 *
 * A lounge is a place, not a table — regulars, chat, and the tables running
 * inside it. This is JamDom's actual moat (their community lives in lounges),
 * so the mechanics here mirror what their players already know, minus the
 * waiting: presence via Realtime channel presence, chat via a table with RLS,
 * and tier gates enforced by the database rather than the client.
 *
 * Voice: real, and it rides this channel. `voice.ts` runs a peer-to-peer
 * WebRTC audio mesh and signals over this channel's broadcast events, so
 * there is no media server and no per-minute bill. Guests hear the room;
 * talking is what membership buys.
 */

import type { RealtimeChannel } from '@supabase/supabase-js';
import type { GameMode } from '@yard/engine';
import { supabase, online } from './online.ts';
import { newestPresence } from './voice.ts';

export type Tier = 'guest' | 'yardie' | 'vip';

export const TIER_LABEL: Record<Tier, string> = {
  guest: 'Guest',
  yardie: 'Yardie',
  vip: 'VIP',
};

export const TIER_RANK: Record<Tier, number> = { guest: 0, yardie: 1, vip: 2 };

/** What each rung buys. Rendered on the upgrade page; keep it honest. */
export const TIER_PITCH: Record<Tier, { price: string; points: string[] }> = {
  guest: {
    price: 'Free forever',
    points: [
      'Full game, every mode, ranked play',
      'The whole first three Academy belts',
      'One Coach review a day',
      'Verify every deal',
    ],
  },
  yardie: {
    price: '$24 / year',
    points: [
      'Rank badge and profile photo',
      'Weekly tournament entry',
      'Belts four and five — the tracking and tournament craft',
      'Rankers Row lounge',
      'Priority matchmaking',
    ],
  },
  vip: {
    price: '$69 / year',
    points: [
      'Walk into any lounge, even full ones',
      'Bredrins list — see where your people are',
      'Unlimited Coach reviews',
      'Red Carpet lounge and VIP-only events',
      'Front of the tournament substitutes line',
    ],
  },
};

export interface Lounge {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  // null = any mode welcome. `GameMode` from the engine covers the three
  // playable modes so a new mode does not need a second edit here.
  mode: GameMode | null;
  min_tier: Tier;
  capacity: number;
  sort_order: number;
}

export interface LoungeMessage {
  id: number;
  lounge_id: string;
  user_id: string;
  body: string;
  created_at: string;
  username?: string;
}

export interface PresenceEntry {
  user_id: string;
  username: string;
  tier: Tier;
  /**
   * In the lounge is not the same as on the mic. A voice mesh must only dial
   * people who actually joined voice — otherwise every speaker opens a dead
   * peer connection to every reader in the room.
   */
  voice?: boolean;
  /**
   * Publishing video right now. Unlike `voice`, this is not just a mesh
   * roster key — it is also the signal that tells other seats a Cloudflare
   * Realtime session exists to pull a track from. `videoSessionId` and
   * `videoTrackName` are only meaningful when this is true.
   */
  video?: boolean;
  /** This seat's own Cloudflare Realtime session, once video is on. */
  videoSessionId?: string;
  /** The trackName Cloudflare knows this seat's camera track by. */
  videoTrackName?: string;
  /**
   * The table this person currently has open, or absent for anyone sitting in
   * the lounge itself. A yard game has an audience — people lean on the table
   * and watch, and knowing they are there is most of what makes it feel like a
   * yard rather than a solitaire screen.
   *
   * It rides on lounge presence rather than a second per-table channel: the
   * lounge channel is already open, already synced, and already the thing the
   * voice mesh and reactions run on. A table-scoped channel would be a whole
   * subscription lifecycle to get wrong for a list of names.
   */
  table?: string | null;
}

function db() {
  if (!supabase) throw new Error('Lounges need online mode — set VITE_SUPABASE_URL');
  return supabase;
}

export const loungesAvailable = online;

/**
 * Yard or foreign — self-declared, never inferred, and never required.
 *
 * The business partner asked for this by name, and it is the one piece of
 * identity in the product no rival has: the audience genuinely is split
 * between the island and the diaspora, and a Jamaican in London wants to be
 * read as foreign without anyone thinking she is any less Jamaican. It is a
 * separate axis from `flag` (a territory code): you can fly jm and be foreign.
 */
export type Origin = 'yardie' | 'foreign';
export type Gender = 'f' | 'm';

export const ORIGIN_LABEL: Record<Origin, string> = {
  yardie: 'Yardie',
  foreign: 'Foreign',
};

/**
 * Presence without a photo — docs/avatar-set.md. `plain` is the deliberate
 * default: some players want presence without a character too, not just
 * without their own face.
 */
export type Avatar = 'tam' | 'wrap' | 'granny' | 'straw' | 'hoops' | 'cap' | 'phones' | 'plain';

export const AVATARS: Avatar[] = ['tam', 'wrap', 'granny', 'straw', 'hoops', 'cap', 'phones', 'plain'];

/** What each character is wearing — read aloud by a screen reader in place
 *  of a filename, and shown as the caption under the picker grid. */
export const AVATAR_LABEL: Record<Avatar, string> = {
  tam: 'Knitted tam',
  wrap: 'Gold head-wrap',
  granny: 'Curlers and glasses',
  straw: 'Straw yard hat',
  hoops: 'Gold hoops',
  cap: 'Flat cap',
  phones: 'Headphones',
  plain: 'Plain',
};

/** `apps/web/public/avatars/<id>.webp` is the only thing that ever renders one. */
export function avatarUrl(avatar: Avatar): string {
  return `/avatars/${avatar}.webp`;
}

/**
 * Cosmetic yard-scene backdrop, worn behind a seat card — plan §7.1. Purely
 * decorative, no new real-time infra, generated once by `gen_backgrounds.py`.
 */
export type Background = 'midday' | 'evening' | 'rain' | 'beach' | 'shop';

export const BACKGROUNDS: Background[] = ['midday', 'evening', 'rain', 'beach', 'shop'];

export const BACKGROUND_LABEL: Record<Background, string> = {
  midday: 'Midday yard',
  evening: 'Evening string-lights',
  rain: 'Rain on the zinc',
  beach: 'Beach game',
  shop: 'Corner shop',
};

/** `apps/web/public/backgrounds/<id>.webp` is the only thing that ever renders one. */
export function backgroundUrl(background: Background): string {
  return `/backgrounds/${background}.webp`;
}

export interface MyProfile {
  id: string;
  username: string;
  tier: Tier;
  origin: Origin | null;
  gender: Gender | null;
  avatar: Avatar | null;
  background: Background | null;
  /**
   * Runs tournaments. Read here only to decide whether to draw the host
   * controls — it grants nothing. Every host action is an Edge Function that
   * re-reads this column server-side, so a patched client that flips this flag
   * gets a panel full of buttons that all answer 403.
   */
  isHost: boolean;
  /**
   * Reviews player conduct reports. Same non-privilege as isHost — grants
   * nothing by itself, report-admin re-checks it server-side on every call.
   * Deliberately a separate flag from isHost: running a tournament and
   * reading conduct reports are different trust levels.
   */
  isAdmin: boolean;
}

export async function myProfile(): Promise<MyProfile | null> {
  const { data: auth } = await db().auth.getUser();
  if (!auth.user) return null;
  const { data } = await db().from('profiles')
    .select('id, username, tier, tier_expires_at, origin, gender, avatar, background, is_host, is_admin')
    .eq('id', auth.user.id).single();
  if (!data) return null;
  const expired = data.tier_expires_at && Date.parse(data.tier_expires_at) < Date.now();
  return {
    id: data.id,
    username: data.username,
    tier: (expired ? 'guest' : data.tier) as Tier,
    origin: (data.origin ?? null) as Origin | null,
    gender: (data.gender ?? null) as Gender | null,
    avatar: (data.avatar ?? null) as Avatar | null,
    background: (data.background ?? null) as Background | null,
    isHost: Boolean(data.is_host),
    isAdmin: Boolean(data.is_admin),
  };
}

/**
 * Save what a member owns. Only these keys, ever — `tier` is granted to
 * service_role alone (0012), and this is a good place to be reminded why: the
 * paywall was decorative for a while because a table-wide UPDATE grant let
 * anyone PATCH their own tier to 'vip'.
 *
 * Throws on a taken username, which is the one failure a player can actually
 * fix, so the caller must show it rather than swallow it.
 */
export async function saveProfile(
  patch: {
    username?: string; origin?: Origin | null; gender?: Gender | null;
    avatar?: Avatar | null; background?: Background | null;
  },
): Promise<void> {
  const { data: auth } = await db().auth.getUser();
  if (!auth.user) throw new Error('Sign in first');
  if (patch.username !== undefined) {
    const name = patch.username.trim();
    if (name.length < 2 || name.length > 24) {
      throw new Error('A name is between 2 and 24 characters');
    }
    patch = { ...patch, username: name };
  }
  const { error } = await db().from('profiles').update(patch).eq('id', auth.user.id);
  if (error) {
    // 23505 is the unique violation on username. Everything else is ours.
    throw new Error(error.code === '23505'
      ? 'Somebody already has that name'
      : error.message);
  }
}

export async function listLounges(): Promise<Lounge[]> {
  const { data, error } = await db().from('lounges').select('*').order('sort_order');
  if (error) throw new Error(error.message);
  return data as Lounge[];
}

export interface OpenTable {
  id: string;
  joinCode: string;
  mode: GameMode;
  format: string;
  seatCount: number;
  status: 'waiting' | 'playing';
  occupiedSeats: number;
}

/** Tables currently running or waiting for players inside one lounge. */
export async function listLoungeTables(loungeId: string): Promise<OpenTable[]> {
  const { data, error } = await db().from('tables')
    .select('id, join_code, mode, format, seat_count, status, seats(user_id)')
    .eq('lounge_id', loungeId)
    .in('status', ['waiting', 'playing'])
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data as any[]).map((t) => ({
    id: t.id,
    joinCode: t.join_code,
    mode: t.mode,
    format: t.format,
    seatCount: t.seat_count,
    status: t.status,
    occupiedSeats: (t.seats as { user_id: string | null }[]).filter((s) => s.user_id).length,
  }));
}

export function canEnter(lounge: Lounge, tier: Tier, occupancy: number): { ok: boolean; why?: string } {
  if (TIER_RANK[tier] < TIER_RANK[lounge.min_tier]) {
    return { ok: false, why: `${TIER_LABEL[lounge.min_tier]} lounge` };
  }
  // The single most-praised JamDom VIP perk, inverted into our gate: VIPs are
  // never turned away from a full room.
  if (occupancy >= lounge.capacity && tier !== 'vip') {
    return { ok: false, why: 'Full — VIPs walk straight in' };
  }
  return { ok: true };
}

export async function recentMessages(loungeId: string, limit = 50): Promise<LoungeMessage[]> {
  const { data, error } = await db().from('lounge_messages')
    .select('id, lounge_id, user_id, body, created_at, profiles(username)')
    .eq('lounge_id', loungeId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data as any[]).reverse().map((m) => ({
    ...m, username: m.profiles?.username ?? 'player',
  }));
}

export async function sendMessage(loungeId: string, body: string): Promise<void> {
  const { data: auth } = await db().auth.getUser();
  if (!auth.user) throw new Error('sign in to talk');
  const { error } = await db().from('lounge_messages')
    .insert({ lounge_id: loungeId, user_id: auth.user.id, body: body.trim() });
  if (error) throw new Error(error.message);
}

export interface LoungeRoom {
  channel: RealtimeChannel;
  /** Re-announce yourself, e.g. when you pick up or put down the mic. */
  setVoice: (voice: boolean) => void;
  /** Re-announce your Cloudflare Realtime session so peers know to pull it,
   *  or clear it (pass nulls) when video stops. */
  setVideo: (video: boolean, sessionId?: string, trackName?: string) => void;
  /** The table you are watching, or null back in the lounge. */
  setTable: (tableId: string | null) => void;
  leave: () => void;
}

/**
 * Enter a lounge: join channel presence (who's here, live) and subscribe to
 * chat inserts. `onPresence` fires with the full roster on every change.
 */
/**
 * Table talk for people who cannot or will not talk — free for guests, because
 * a silent table is the incumbent's table.
 *
 * These live here rather than in a view module because both the lounge roster
 * and the four-seat table render them, and a view importing another view is a
 * circular import. Art comes from `docs/art-direction.md`; the words live in
 * code rather than baked into the pictures so they stay readable at any size.
 */
export const REACTIONS = [
  { id: 'tek-dat', label: 'Tek dat' },
  { id: 'mi-pass', label: 'Mi pass' },
  { id: 'yah-suh', label: 'Yah suh' },
  { id: 'six-love', label: 'Six love' },
  { id: 'hold-dat', label: 'Hold dat' },
  { id: 'cho-man', label: 'Cho man' },
  // Fill emotional gaps against JamDom's VIP emoticon set (shock, disbelief,
  // unbothered confidence, boredom, sarcasm) — named in patois, not
  // translated from their generic labels. See scripts/gen_reactions.py.
  { id: 'lawd', label: 'Lawd!' },
  { id: 'yuh-mad', label: 'Yuh mad?' },
  { id: 'cool-runnings', label: 'Cool runnings' },
  { id: 'mi-tired', label: 'Mi tired' },
  { id: 'big-up', label: 'Big up yuhself' },
] as const;

/**
 * Quick chat — the eight things people actually say at a domino table, as
 * buttons. The business partner named these off the top of his head watching
 * the rival app, and they are the cheapest culture in the product: eleven
 * characters of patois carry more of a yard than a paragraph of interface copy.
 *
 * They ride the SAME broadcast and the SAME on-screen slot as reactions, which
 * is not just less code — it means one person can only be saying one thing at
 * a time, so nobody can stack a reaction and a line on top of each other.
 *
 * **These are public by design, and that is the anti-cheat.** "ME", "YOU" and
 * "ANY" are real signals in partner play, and a private channel carrying them
 * between two seated players is exactly how a hand gets thrown. Broadcast to
 * the whole table, they are what they are across a real table: everyone hears
 * it, including the people it would hurt. See the private-message rule in
 * docs/superpowers/plans — nobody seated in a live hand may send or receive a
 * private message, and that rule has to be enforced on the server, not here.
 */
export const QUICK_CHAT = [
  { id: 'me', label: 'ME' },
  { id: 'you', label: 'YOU' },
  { id: 'any', label: 'ANY' },
  { id: 'bless', label: 'BLESS' },
  { id: 'gg', label: 'GG' },
  { id: 'dwl', label: 'DWL' },
  { id: 'kmt', label: 'KMT' },
  { id: 'brb', label: 'BRB' },
] as const;

export const REACTION_EVENT = 'reaction';

/** The label for a reaction id, or '' for one a peer invented. */
export function reactionLabel(id: string): string {
  return REACTIONS.find((r) => r.id === id)?.label ?? '';
}

/** The words for a quick-chat id, or '' if it is not one. Callers use the
 *  empty string to tell the two kinds of signal apart when rendering. */
export function quickChatLabel(id: string): string {
  return QUICK_CHAT.find((q) => q.id === id)?.label ?? '';
}

/** True for anything we are willing to render. A peer can broadcast whatever
 *  it likes; only these ids ever reach the screen. */
export function knownSignal(id: string): boolean {
  return reactionLabel(id) !== '' || quickChatLabel(id) !== '';
}

export function enterLounge(
  lounge: Lounge,
  me: PresenceEntry,
  handlers: {
    onPresence?: (roster: PresenceEntry[]) => void;
    onMessage?: (msg: LoungeMessage) => void;
  },
): LoungeRoom {
  const channel = db().channel(`lounge:${lounge.slug}`, {
    config: { presence: { key: me.user_id } },
  });

  // `track` replaces the whole entry rather than merging, so the announcement
  // has to be built from one running copy. Spreading the original `me` in each
  // setter instead means picking up the mic silently clears which table you
  // are watching, and vice versa — whichever fired last wins.
  let mine: PresenceEntry = { ...me };
  const announce = (patch: Partial<PresenceEntry>) => {
    mine = { ...mine, ...patch };
    void channel.track(mine);
  };

  channel
    .on('presence', { event: 'sync' }, () => {
      // newestPresence, never entries[0] — see the note on it in voice.ts.
      // The oldest meta predates anyone picking up a microphone, so reading it
      // left `voice` false for everyone and the mesh dialled nobody.
      handlers.onPresence?.(newestPresence(channel.presenceState<PresenceEntry>()));
    })
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'lounge_messages', filter: `lounge_id=eq.${lounge.id}` },
      (payload) => handlers.onMessage?.(payload.new as LoungeMessage))
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await channel.track(mine);
        // Durable last-seen for bredrins lists.
        await db().from('lounge_visits').upsert({
          lounge_id: lounge.id, user_id: me.user_id, last_seen: new Date().toISOString(),
        });
      }
    });

  return {
    channel,
    setVoice: (voice: boolean) => announce({ voice }),
    setVideo: (video: boolean, sessionId?: string, trackName?: string) =>
      announce({ video, videoSessionId: sessionId, videoTrackName: trackName }),
    setTable: (table: string | null) => announce({ table }),
    leave: () => { void db().removeChannel(channel); },
  };
}

/** Kick off a Stripe checkout for a paid tier. Resolves to a redirect URL. */
export async function startCheckout(tier: 'yardie' | 'vip'): Promise<string> {
  const { data, error } = await db().functions.invoke('checkout', { body: { tier } });
  if (error) throw new Error(error.message);
  if ((data as any)?.error) throw new Error((data as any).error);
  return (data as { url: string }).url;
}

// --------------------------------------------------------------- bredrins --
// VIP only — see 0020_bredrins_vip.sql. A Guest or Yardie calling any of
// these gets an RLS-empty read or a rejected write; the UI is expected to
// hide the affordance rather than rely on the server error reading well.
export interface Bredrin {
  bredrinId: string;
  username: string;
  /** Lounge they were last seen in, or null if never seen anywhere. */
  lounge: string | null;
  lastSeen: string | null;
}

export async function addBredrin(bredrinId: string): Promise<void> {
  const { data: auth } = await db().auth.getUser();
  if (!auth.user) throw new Error('sign in first');
  const { error } = await db().from('bredrins').insert({ user_id: auth.user.id, bredrin_id: bredrinId });
  // 23505 is the unique violation on (user_id, bredrin_id) — tapping "add"
  // on somebody already in the list is not a failure the caller needs to see.
  if (error && error.code !== '23505') throw new Error(error.message);
}

export async function removeBredrin(bredrinId: string): Promise<void> {
  const { data: auth } = await db().auth.getUser();
  if (!auth.user) throw new Error('sign in first');
  const { error } = await db().from('bredrins').delete()
    .eq('user_id', auth.user.id).eq('bredrin_id', bredrinId);
  if (error) throw new Error(error.message);
}

/**
 * One row per bredrin, with their most recent lounge sighting if they have
 * one. Two queries, not a nested PostgREST embed: `bredrins` and
 * `lounge_visits` share no foreign key with each other (both merely point
 * at `profiles`), so a single `.select()` cannot join them — an earlier
 * version tried exactly that and would have failed the moment it was
 * actually called, which nothing did until this list got a view.
 */
export async function whereAreMyBredrins(): Promise<Bredrin[]> {
  const { data: auth } = await db().auth.getUser();
  if (!auth.user) return [];
  const { data: rows, error } = await db().from('bredrins')
    .select('bredrin_id, profiles!bredrins_bredrin_id_fkey(username)')
    .eq('user_id', auth.user.id);
  if (error || !rows?.length) return [];

  const ids = rows.map((r: any) => r.bredrin_id as string);
  const { data: visits } = await db().from('lounge_visits')
    .select('user_id, lounge_id, last_seen')
    .in('user_id', ids)
    .order('last_seen', { ascending: false });
  // First row per user_id is the latest, since visits is already ordered.
  const latest = new Map<string, { lounge_id: string; last_seen: string }>();
  for (const v of (visits ?? []) as any[]) {
    if (!latest.has(v.user_id)) latest.set(v.user_id, v);
  }

  return rows
    .map((row: any) => {
      const v = latest.get(row.bredrin_id);
      return {
        bredrinId: row.bredrin_id as string,
        username: row.profiles?.username ?? 'player',
        lounge: v?.lounge_id ?? null,
        lastSeen: v?.last_seen ?? null,
      };
    })
    .sort((a, b) => a.username.localeCompare(b.username));
}

// -------------------------------------------------------------- coins --
// Coins never cash out — money in, utility only. See
// docs/superpowers/plans/2026-07-29-partner-feedback-roadmap.md,
// "Settled decisions": this is what keeps the whole economy out of a
// licensing regime, and it is load-bearing. Nothing in this client may ever
// surface a way to convert a coin back into money.

/**
 * Enforced server-side in `gift_coins` (0021_coin_economy.sql) — this copy
 * is for disabling the UI early, not the actual rule. Change both together.
 */
export const MIN_GIFT_COINS = 20;

/** The only pack today: $5 for 25 coins. A plain client-side label — the
 *  price itself lives in Stripe, never duplicated here. */
export const COIN_PACK_LABEL = '25 coins — $5';

export async function myCoinBalance(): Promise<number> {
  const { data: auth } = await db().auth.getUser();
  if (!auth.user) return 0;
  const { data } = await db().rpc('coin_balance', { p_user_id: auth.user.id });
  return typeof data === 'number' ? data : Number(data ?? 0);
}

/** Kick off a Stripe checkout for the one coin pack. Resolves to a redirect
 *  URL, same shape as `startCheckout`. */
export async function buyCoins(): Promise<string> {
  const { data, error } = await db().functions.invoke('checkout', { body: { coins: 'coins25' } });
  if (error) throw new Error(error.message);
  if ((data as any)?.error) throw new Error((data as any).error);
  return (data as { url: string }).url;
}

/**
 * Send coins to another player. The floor and every other rule are
 * enforced again server-side in `gift_coins` — this just relays the RPC's
 * own error message rather than inventing a second copy of the rules.
 */
export async function giftCoins(toUserId: string, amount: number): Promise<number> {
  const { data, error } = await db().functions.invoke('gift-coins', { body: { toUserId, amount } });
  if (error) throw new Error(error.message);
  if ((data as any)?.error) throw new Error((data as any).error);
  return (data as { balance: number }).balance;
}
