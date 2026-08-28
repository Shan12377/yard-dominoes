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
      'Profile photo',
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
 * Presence without a photo — docs/avatar-set.md. The original ids remain
 * stable so an existing profile never breaks when the art direction evolves.
 */
export type Avatar = 'tam' | 'wrap' | 'granny' | 'straw' | 'hoops' | 'cap'
  | 'phones' | 'plain' | 'afro' | 'braids' | 'twists' | 'goldtooth'
  | 'marigold' | 'cedar' | 'sonia' | 'devon' | 'otis' | 'nadia' | 'kyro' | 'levi'
  | 'harold' | 'mei' | 'imani' | 'tariq';

export const AVATARS: Avatar[] = [
  'hoops', 'plain', 'granny', 'tam',
  'wrap', 'straw', 'phones', 'afro',
  'braids', 'cap', 'twists', 'goldtooth',
  'marigold', 'cedar', 'sonia', 'devon',
  'otis', 'nadia', 'kyro', 'levi',
  'harold', 'mei', 'imani', 'tariq',
];

/** What each character is wearing — read aloud by a screen reader in place
 *  of a filename, and shown as the caption under the picker grid. */
export const AVATAR_LABEL: Record<Avatar, string> = {
  tam: 'Short locs and knitted tam',
  wrap: 'Gold headwrap',
  granny: 'Silver curls and reading glasses',
  straw: 'Straw yard hat',
  hoops: 'Bantu knots and gold hoops',
  cap: 'Grey beard and flat cap',
  phones: 'High-top curls and headphones',
  plain: 'Close-cropped hair and beard',
  afro: 'Natural afro and gold studs',
  braids: 'Long braids and coral bandana',
  twists: 'Short twists and clear glasses',
  goldtooth: 'Big laugh and gold tooth',
  marigold: 'Braided updo and gold hoops',
  cedar: 'Curly fade and full beard',
  sonia: 'Sleek hair and gold earrings',
  devon: 'Close-cropped hair and round glasses',
  otis: 'Silver beard and warm smile',
  nadia: 'Natural curls and bright smile',
  kyro: 'Short curls and stud earring',
  levi: 'Loose locs and kind eyes',
  harold: 'Silver hair and kind eyes',
  mei: 'Silver bob and round glasses',
  imani: 'Curly puff and bright yellow top',
  tariq: 'Curly fade and green hoodie',
};

/** `apps/web/public/avatars/<id>.webp` is the only thing that ever renders one. */
export function avatarUrl(avatar: Avatar): string {
  return `/avatars/${avatar}.webp`;
}

export type AvatarAccessory = 'shades' | 'crown' | 'flower' | 'headphones' | 'flagpin'
  | 'canadapin' | 'ukpin' | 'bandana' | 'beanie' | 'necklace';

export const AVATAR_ACCESSORIES: AvatarAccessory[] = [
  'shades', 'crown', 'flower', 'headphones', 'flagpin',
  'canadapin', 'ukpin', 'bandana', 'beanie', 'necklace',
];

export const AVATAR_ACCESSORY_LABEL: Record<AvatarAccessory, string> = {
  shades: 'Black shades',
  crown: 'Gold crown',
  flower: 'Pink flower',
  headphones: 'Teal headphones',
  flagpin: 'Jamaica flag pin',
  canadapin: 'Canada flag pin',
  ukpin: 'United Kingdom flag pin',
  bandana: 'Red, gold and green bandana',
  beanie: 'Knitted beanie',
  necklace: 'Gold necklace',
};

export function avatarAccessoryUrl(accessory: AvatarAccessory): string {
  return `/accessories/${accessory}.svg`;
}

const LOCAL_ACCESSORY_PREFIX = 'yard:avatar-accessory:';
// Accessories are public cosmetics, just like the selected avatar and seat
// backdrop. Keeping them only in a browser meant a player could save shades
// then lose them on a preview, another device, or at a live table.
const SHARE_AVATAR_ACCESSORIES = true;

function localAccessory(userId: string): AvatarAccessory | null {
  const value = localStorage.getItem(`${LOCAL_ACCESSORY_PREFIX}${userId}`);
  return AVATAR_ACCESSORIES.includes(value as AvatarAccessory)
    ? value as AvatarAccessory
    : null;
}

function missingAccessoryColumn(error: { code?: string; message?: string } | null): boolean {
  return Boolean(error && (
    error.code === '42703'
    || error.code === 'PGRST204'
    || error.message?.includes('avatar_accessory')
  ));
}

/**
 * Cosmetic yard-scene backdrop, worn behind a seat card — plan §7.1. Purely
 * decorative, no new real-time infra, generated once by `gen_backgrounds.py`.
 */
export type Background = 'midday' | 'evening' | 'rain' | 'beach' | 'shop';

export const BACKGROUNDS: Background[] = ['midday', 'evening', 'rain', 'beach', 'shop'];

export const BACKGROUND_LABEL: Record<Background, string> = {
  midday: 'Kingston midday',
  evening: 'Evening lights',
  rain: 'Rain on the zinc',
  beach: 'South coast',
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
  avatarAccessory: AvatarAccessory | null;
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
  /**
   * Narrower than isAdmin, on purpose (0052): sees referral financials —
   * who's owed what, cash-out requests, marking them paid. An admin
   * granted for ordinary report/feedback moderation does not automatically
   * get this too. Same non-privilege as isAdmin/isHost: referral-admin
   * re-checks it server-side on every call.
   */
  isOwner: boolean;
  /** Optional, player-typed — never inferred from IP/GPS. Null if unset. */
  location: string | null;
}

export async function myProfile(): Promise<MyProfile | null> {
  const { data: auth } = await db().auth.getUser();
  if (!auth.user) return null;
  let { data, error } = await (db().from('profiles') as any)
    .select(SHARE_AVATAR_ACCESSORIES
      ? 'id, username, tier, tier_expires_at, origin, gender, avatar, avatar_accessory, background, is_host, is_admin, is_owner, location'
      : 'id, username, tier, tier_expires_at, origin, gender, avatar, background, is_host, is_admin, is_owner, location')
    .eq('id', auth.user.id).single();
  if (missingAccessoryColumn(error)) {
    ({ data, error } = await (db().from('profiles') as any)
      .select('id, username, tier, tier_expires_at, origin, gender, avatar, background, is_host, is_admin, is_owner, location')
      .eq('id', auth.user.id).single());
  }
  if (!data) return null;
  const expired = data.tier_expires_at && Date.parse(data.tier_expires_at) < Date.now();
  return {
    id: data.id,
    username: data.username,
    tier: (expired ? 'guest' : data.tier) as Tier,
    origin: (data.origin ?? null) as Origin | null,
    gender: (data.gender ?? null) as Gender | null,
    avatar: (data.avatar ?? null) as Avatar | null,
    avatarAccessory: ((data as any).avatar_accessory ?? localAccessory(auth.user.id)) as AvatarAccessory | null,
    background: (data.background ?? null) as Background | null,
    isHost: Boolean(data.is_host),
    isAdmin: Boolean(data.is_admin),
    isOwner: Boolean(data.is_owner),
    location: (data.location ?? null) as string | null,
  };
}

/** Read-only card for someone else's profile — never includes anything
 *  privileged (no isAdmin/isHost, no tier_expires_at). Ratings/hands/etc
 *  are already public per "profiles are readable by everyone" RLS. */
export interface PublicProfile {
  id: string;
  username: string;
  tier: Tier;
  origin: Origin | null;
  avatar: Avatar | null;
  avatarAccessory: AvatarAccessory | null;
  location: string | null;
  createdAt: string;
  ratingPartner: number;
  ratingCutthroat: number;
  rdPartner: number;
  rdCutthroat: number;
  handsPlayed: number;
  sixLovesGiven: number;
  sixLovesTaken: number;
}

export async function fetchPublicProfile(userId: string): Promise<PublicProfile | null> {
  const publicColumns = SHARE_AVATAR_ACCESSORIES
    ? `id, username, tier, tier_expires_at, origin, avatar, avatar_accessory, location, created_at,
      rating_partner, rating_cutthroat, rd_partner, rd_cutthroat, hands_played, six_loves_given, six_loves_taken`
    : `id, username, tier, tier_expires_at, origin, avatar, location, created_at,
      rating_partner, rating_cutthroat, rd_partner, rd_cutthroat, hands_played, six_loves_given, six_loves_taken`;
  let { data, error } = await (db().from('profiles') as any)
    .select(publicColumns)
    .eq('id', userId).single();
  if (missingAccessoryColumn(error)) {
    ({ data, error } = await (db().from('profiles') as any)
      .select(`id, username, tier, tier_expires_at, origin, avatar, location, created_at,
        rating_partner, rating_cutthroat, rd_partner, rd_cutthroat,
        hands_played, six_loves_given, six_loves_taken`)
      .eq('id', userId).single());
  }
  if (!data) return null;
  const expired = data.tier_expires_at && Date.parse(data.tier_expires_at) < Date.now();
  return {
    id: data.id,
    username: data.username,
    tier: (expired ? 'guest' : data.tier) as Tier,
    origin: (data.origin ?? null) as Origin | null,
    avatar: (data.avatar ?? null) as Avatar | null,
    avatarAccessory: ((data as any).avatar_accessory ?? localAccessory(userId)) as AvatarAccessory | null,
    location: (data.location ?? null) as string | null,
    createdAt: data.created_at,
    ratingPartner: data.rating_partner,
    ratingCutthroat: data.rating_cutthroat,
    rdPartner: data.rd_partner,
    rdCutthroat: data.rd_cutthroat,
    handsPlayed: data.hands_played,
    sixLovesGiven: data.six_loves_given,
    sixLovesTaken: data.six_loves_taken,
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
    avatar?: Avatar | null; avatar_accessory?: AvatarAccessory | null;
    background?: Background | null; location?: string | null;
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
  if (patch.location !== undefined) {
    const loc = patch.location?.trim() || null;
    if (loc && loc.length > 60) throw new Error('Location is a bit long — 60 characters max');
    patch = { ...patch, location: loc };
  }
  const accessory = patch.avatar_accessory;
  const dbPatch = SHARE_AVATAR_ACCESSORIES
    ? patch
    : (({ avatar_accessory: _localOnly, ...rest }) => rest)(patch);
  let { error } = await db().from('profiles').update(dbPatch).eq('id', auth.user.id);
  if (missingAccessoryColumn(error)) {
    const { avatar_accessory: _unsupported, ...compatiblePatch } = patch;
    ({ error } = await db().from('profiles').update(compatiblePatch).eq('id', auth.user.id));
  }
  if (accessory) localStorage.setItem(`${LOCAL_ACCESSORY_PREFIX}${auth.user.id}`, accessory);
  else localStorage.removeItem(`${LOCAL_ACCESSORY_PREFIX}${auth.user.id}`);
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
  // A table only leaves 'waiting'/'playing' when its full SET finishes
  // (tournaments.ts) or the hourly sweep (0047_stale_table_sweep.sql)
  // catches it — this cap is a second line of defense against the list
  // growing unbounded between sweeps, not the actual fix for staleness.
  const { data, error } = await db().from('tables')
    .select('id, join_code, mode, format, seat_count, status, seats(user_id)')
    .eq('lounge_id', loungeId)
    .in('status', ['waiting', 'playing'])
    .order('created_at', { ascending: false })
    .limit(30);
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

/**
 * Distinct players active anywhere in the last 15 minutes — the honest
 * answer to "how many people are live right now" without new
 * infrastructure. `lounge_visits.last_seen` is stamped once per successful
 * realtime (re)subscribe, not a continuous heartbeat, so a stable desktop
 * session sitting in one lounge the whole window still counts even though
 * its own timestamp is stale from whenever it first joined — the 15-minute
 * window exists specifically to not undercount those sessions. The cost is
 * the mirror case: someone who left a few minutes ago still counts too.
 * Directional, not exact — there is no true live presence aggregated
 * anywhere server-side (see voice.md's per-lounge Realtime presence, which
 * is real-time but client-side and never summed across lounges).
 */
export async function liveNowCount(): Promise<number> {
  const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { data, error } = await db().from('lounge_visits')
    .select('user_id').gte('last_seen', cutoff);
  if (error || !data) return 0;
  return new Set((data as { user_id: string }[]).map((r) => r.user_id)).size;
}

export interface LivePlayer {
  userId: string;
  username: string;
  lounge: string;
  lastSeen: string;
}

/**
 * Named counterpart to liveNowCount() — same 15-minute window, same
 * directional-not-exact caveat, but who, not just how many. `profiles` and
 * `lounge_visits` are both world-readable (0001/0002), so this needs no new
 * grant. One row per player: their most recent lounge sighting, deduped the
 * same way whereAreMyBredrins() already does (visits ordered by last_seen,
 * first hit per user_id wins).
 */
export async function liveNowPlayers(): Promise<LivePlayer[]> {
  const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { data, error } = await db().from('lounge_visits')
    .select('user_id, last_seen, profiles(username), lounges(name)')
    .gte('last_seen', cutoff)
    .order('last_seen', { ascending: false });
  if (error || !data) return [];
  const seen = new Set<string>();
  const out: LivePlayer[] = [];
  for (const row of data as any[]) {
    if (seen.has(row.user_id)) continue;
    seen.add(row.user_id);
    out.push({
      userId: row.user_id,
      username: row.profiles?.username ?? 'player',
      lounge: row.lounges?.name ?? 'a lounge',
      lastSeen: row.last_seen,
    });
  }
  return out.sort((a, b) => a.username.localeCompare(b.username));
}

// --------------------------------------------------------------- ranking --
// The two categories a set actually gets rated into — see
// _shared/apply-rating.ts's own column choice, which this mirrors exactly.
// 'partner' also covers openhand and across (they share one rating column);
// French shares 'cutthroat's column too, since French tables carry
// mode: 'cutthroat' under the hood (set.ts's createSet). There is no way to
// split French out for display without a schema change — don't invent a
// third category the data can't actually back.
export type RatingCategory = 'cutthroat' | 'partner';

export interface RankedPlayer {
  userId: string;
  username: string;
  rating: number;
  avatar: Avatar | null;
  avatarAccessory: AvatarAccessory | null;
}

/**
 * Top N by rating in one category. Excludes anyone still sitting on the
 * untouched default (1200 rating, RD 350 — Glicko's "never actually rated
 * here" state, see rating.ts's UNRATED) so a fresh account with zero games
 * doesn't crowd out real ranked play. `profiles` is world-readable
 * (0001/0002) — same plain-query shape as liveNowPlayers, no Edge Function
 * needed for a read this un-sensitive.
 */
export async function topRanked(category: RatingCategory, limit = 20): Promise<RankedPlayer[]> {
  const ratingCol = category === 'cutthroat' ? 'rating_cutthroat' : 'rating_partner';
  const rdCol = category === 'cutthroat' ? 'rd_cutthroat' : 'rd_partner';
  const { data, error } = await db().from('profiles')
    .select(`id, username, avatar, avatar_accessory, ${ratingCol}, ${rdCol}`)
    .lt(rdCol, 350)
    .order(ratingCol, { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return (data as any[]).map((row) => ({
    userId: row.id,
    username: row.username,
    rating: row[ratingCol],
    avatar: row.avatar,
    avatarAccessory: row.avatar_accessory,
  }));
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

// -------------------------------------------------------------- invites --
// The active counterpart to the bredrins list above: "come to this lounge,"
// not just "here is where they last were." See 0040_invites.sql — same VIP
// gate as bredrins, and you can only invite someone already on your list.
export interface Invite {
  id: string;
  fromUserId: string;
  fromUsername: string;
  loungeId: string;
}

/** Enforced again server-side (0040) — this call fails loudly for a Guest,
 *  a Yardie, or anyone not already a bredrin, rather than pretending to work. */
export async function sendInvite(toUserId: string, loungeId: string): Promise<void> {
  const { data: auth } = await db().auth.getUser();
  if (!auth.user) throw new Error('sign in first');
  const { error } = await db().from('invites')
    .insert({ from_user_id: auth.user.id, to_user_id: toUserId, lounge_id: loungeId });
  if (error) throw new Error(error.message);
}

export async function pendingInvites(): Promise<Invite[]> {
  const { data: auth } = await db().auth.getUser();
  if (!auth.user) return [];
  const { data, error } = await db().from('invites')
    .select('id, from_user_id, lounge_id, profiles!invites_from_user_id_fkey(username)')
    .eq('to_user_id', auth.user.id)
    .order('created_at', { ascending: false });
  if (error || !data) return [];
  return (data as any[]).map((row) => ({
    id: row.id as string,
    fromUserId: row.from_user_id as string,
    fromUsername: row.profiles?.username ?? 'a bredrin',
    loungeId: row.lounge_id as string,
  }));
}

/** Called on both "Join" and "Dismiss" — either way the nudge is consumed. */
export async function dismissInvite(id: string): Promise<void> {
  const { data: auth } = await db().auth.getUser();
  if (!auth.user) throw new Error('sign in first');
  const { error } = await db().from('invites').delete()
    .eq('id', id).eq('to_user_id', auth.user.id);
  if (error) throw new Error(error.message);
}

/**
 * Fires `onInsert` whenever a new invite lands for the signed-in player,
 * regardless of which lounge (or none) they are currently viewing — unlike
 * `enterLounge`'s channel, this one is not scoped to a single room. Started
 * once per session from `loadLounges`; RLS restricts delivery to this
 * player's own rows even without the `filter`, but the filter avoids the
 * server evaluating the policy against every insert on the table.
 */
export function watchInvites(onInsert: () => void): void {
  void (async () => {
    const { data: auth } = await db().auth.getUser();
    if (!auth.user) return;
    db().channel(`invites:${auth.user.id}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'invites', filter: `to_user_id=eq.${auth.user.id}` },
        () => onInsert())
      .subscribe();
  })();
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
