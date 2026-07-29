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
  mode: 'cutthroat' | 'partner' | null;
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

export async function myProfile(): Promise<{ id: string; username: string; tier: Tier } | null> {
  const { data: auth } = await db().auth.getUser();
  if (!auth.user) return null;
  const { data } = await db().from('profiles')
    .select('id, username, tier, tier_expires_at').eq('id', auth.user.id).single();
  if (!data) return null;
  const expired = data.tier_expires_at && Date.parse(data.tier_expires_at) < Date.now();
  return { id: data.id, username: data.username, tier: (expired ? 'guest' : data.tier) as Tier };
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
export async function addBredrin(bredrinId: string): Promise<void> {
  const { data: auth } = await db().auth.getUser();
  if (!auth.user) throw new Error('sign in first');
  await db().from('bredrins').insert({ user_id: auth.user.id, bredrin_id: bredrinId });
}

export async function whereAreMyBredrins(): Promise<{ username: string; lounge: string; last_seen: string }[]> {
  const { data: auth } = await db().auth.getUser();
  if (!auth.user) return [];
  const { data, error } = await db().from('bredrins')
    .select('bredrin_id, profiles!bredrins_bredrin_id_fkey(username), lounge_visits:bredrin_id(lounge_id, last_seen)')
    .eq('user_id', auth.user.id);
  if (error) return [];
  // Shape loosely; the view layer renders what it gets.
  return (data as any[]).flatMap((row) =>
    (row.lounge_visits ?? []).map((v: any) => ({
      username: row.profiles?.username ?? 'player',
      lounge: v.lounge_id,
      last_seen: v.last_seen,
    })));
}
