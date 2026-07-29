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
  leave: () => void;
}

/**
 * Enter a lounge: join channel presence (who's here, live) and subscribe to
 * chat inserts. `onPresence` fires with the full roster on every change.
 */
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

  channel
    .on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState<PresenceEntry>();
      const roster = Object.values(state).map((entries) => entries[0]);
      handlers.onPresence?.(roster);
    })
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'lounge_messages', filter: `lounge_id=eq.${lounge.id}` },
      (payload) => handlers.onMessage?.(payload.new as LoungeMessage))
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await channel.track(me);
        // Durable last-seen for bredrins lists.
        await db().from('lounge_visits').upsert({
          lounge_id: lounge.id, user_id: me.user_id, last_seen: new Date().toISOString(),
        });
      }
    });

  return {
    channel,
    setVoice: (voice: boolean) => { void channel.track({ ...me, voice }); },
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
