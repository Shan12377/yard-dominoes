// apps/web/src/onlinetable.ts
//
// Online counterpart to LocalGame (local.ts). Same view-facing shape — state
// plus an event emitter the view re-renders on — but state arrives over
// Realtime instead of from the engine directly. The server is the only thing
// that ever decides whether a move is legal; legalMovesForMe() exists purely
// to enable/disable tiles and prompt "which end?", exactly like LocalGame,
// using the same stub-state trick bots.ts uses to enumerate one seat's moves
// without needing to see anyone else's tiles.

import {
  supabase, startHand as apiStartHand, playMove as apiPlayMove, passPose as apiPassPose,
  leaveSeat as apiLeaveSeat, watchTable, ConflictError, revealHand as apiRevealHand,
  requestReview as apiRequestReview,
  type PublicHand, type TableSubscription,
} from './online.ts';
import * as sfx from './sfx.ts';
import { staleUserIds } from './name-cache.ts';
import { isPartnered, legalMoves, sideOf } from '@yard/engine';
import type { AnyBoard, GameMode, HandReview, Move, SetFormat, TileId } from '@yard/engine';
import { predictMyMove } from './predict.ts';

export interface TableInfo {
  id: string;
  loungeId: string | null;
  mode: GameMode;
  format: string;
  seatCount: 2 | 3 | 4;
  /**
   * The RULES flag, not the event: the double-six must actually be LED, not
   * merely held. It has meant that since 0001 and is set on plenty of casual
   * tables. `tournamentId` below is the different thing — which Sunday, if any,
   * this table belongs to.
   */
  tournament: boolean;
  /** The event this table was drawn for, or null for an ordinary table. */
  tournamentId: string | null;
  roundNo: number | null;
  /** Filled in only for a tournament table, so the banner can name it. */
  tournamentName: string | null;
  status: 'waiting' | 'playing' | 'finished';
  turnSeconds: number;
  /** Ceiling on a single turn, bank included. */
  turnCapSeconds: number;
  joinCode: string;
}

export interface SeatInfo {
  seatIndex: number;
  userId: string | null;
  username: string | null;
  /** 'yardie' | 'foreign' | null — self-declared, never inferred. */
  origin: string | null;
  /** One of the eight ids in docs/avatar-set.md, or null for no character. */
  avatar: string | null;
  /** One of midday/evening/rain, or null for the plain seat card. */
  background: string | null;
  duppyLevel: string | null;
  /** Unspent seconds this seat carries into its next turn. Server-owned. */
  timeBank: number;
  /** rating_partner or rating_cutthroat, whichever this table's mode uses. Null for a duppy. */
  rating: number | null;
  /** Lifetime average, from profiles.total_move_ms / total_moves — not this hand's pace. Null with no moves recorded yet. */
  avgMoveMs: number | null;
}

export type OnlineEvent = { type: 'state' } | { type: 'error'; message: string };

function db() {
  if (!supabase) throw new Error('online mode needs Supabase configured');
  return supabase;
}

export class OnlineGame {
  table: TableInfo;
  seats: SeatInfo[] = [];
  mySeat: number | null = null;
  get isSpectator() { return this.mySeat === null; }

  hand: PublicHand | null = null;
  myTiles: TileId[] = [];
  /**
   * Set the instant play() is called, cleared the moment real data arrives
   * (either the realtime broadcast in subscribe()'s onPublic, or a failure/
   * conflict in play() itself) — never anything a caller sets directly.
   * Only ever predicts MY OWN move; see predict.ts for why nothing beyond
   * it can be predicted client-side.
   */
  predictedBoard: AnyBoard | null = null;
  predictedMyTiles: TileId[] | null = null;
  /**
   * The partner's tiles, when the mode grants sight of them. Populated only
   * for `mode === 'openhand'` and only when the player is seated (a spectator
   * gets nothing extra). Null in every other case, so a bare read while
   * rendering a partner or cutthroat table returns nothing to display rather
   * than an accidental peek.
   */
  partnerTiles: TileId[] | null = null;

  /**
   * Every seat's starting tiles for the just-finished hand, bought with
   * `reveal()` for 2 coins — the one thing the free share-link replay
   * deliberately never shows (see replay.ts). Cleared the moment a new
   * hand begins (a fresh hand_id in onPublic), not on every board update,
   * so it survives whatever else changes about the current hand's row.
   */
  revealedDeal: TileId[][] | null = null;
  revealPending = false;

  /** The Coach, requested for the just-finished hand. Cleared on a new deal
   *  the same way revealedDeal is — see that field's own comment. */
  review: HandReview | null = null;
  reviewAccuracy: number | null = null;
  reviewPending = false;

  scores: number[] = [];
  /** True for one render after a bruk — every side's points went to zero at
   *  once, having held some before. Mirrors LocalGame's lastResultBruk. */
  lastResultBruk = false;
  /**
   * The hand id that just transitioned into 'domino', so the view can tag
   * the winning tile and shake the felt. An identity comparison
   * (`justWonByDominoHandId === hand?.hand_id`) rather than a one-shot
   * "consumed" boolean on purpose: `hands`/`hand_public` and `sets` update
   * in the same server transaction, so the `onSet` broadcast below almost
   * always follows this one within milliseconds and triggers its own full
   * re-render (render() rebuilds everything — client.md) — a consume-once
   * flag gets cleared by the FIRST render and is already gone by the
   * SECOND, so the tag never survives to what's actually left on screen.
   * Tying it to the hand's own id instead means every render of this same
   * still-finished hand reapplies it, which is correct: renderBoard wipes
   * and rebuilds the tile elements from scratch on every render regardless
   * of this feature, so "reapply the class every time" is just how a
   * freshly created element keeps its animation, not a repeat firing.
   */
  justWonByDominoHandId: string | null = null;
  /**
   * The hand id `dealNext()` most recently started, so the shuffle plays
   * even when duppies race a pose (and sometimes a reply) onto the board
   * before this client's first broadcast for that hand ever arrives.
   * `laid(hand) === 0` alone — the original check — assumes the very first
   * broadcast a client sees for a new hand still has an empty board, which
   * is only true when nobody at the table can move faster than the
   * network; a duppy poser plus a duppy's own quick reply routinely beats
   * it, and the shuffle silently never fires. Real bug, caught by actually
   * dealing hands and watching for it, not by re-reading the code.
   */
  justDealtHandId: string | null = null;
  handValue = 1;
  poser = 0;
  poseMustBeDoubleSix = true;
  handsPlayed = 0;
  winnerSide: number | null = null;
  sixLove = false;

  /**
   * Rating transparency — the "+23" a set-deciding hand is worth, read off
   * the same columns `_shared/apply-rating.ts` writes. `ratingBefore` is
   * this seat's rating snapshotted at table-open; `ratingAfter` is filled in
   * only once `winnerSide` actually decides the set (see `onSet` below), so
   * a hand that merely ends without deciding the set shows nothing. Stays
   * null on a duppy-mixed table, where nothing is ever rated, or for a
   * spectator, who has no rating of their own to show.
   */
  ratingBefore: number | null = null;
  ratingAfter: number | null = null;

  private ratingColumn(): 'rating_partner' | 'rating_cutthroat' {
    return this.table.mode === 'cutthroat' ? 'rating_cutthroat' : 'rating_partner';
  }

  private myUserId: string | null = null;
  private sub: TableSubscription | null = null;
  private listeners: ((e: OnlineEvent) => void)[] = [];
  private visListener = () => {
    if (document.visibilityState === 'visible') this.resubscribe();
  };

  private constructor(table: TableInfo) {
    this.table = table;
  }

  on(fn: (e: OnlineEvent) => void) { this.listeners.push(fn); }
  private emit(e: OnlineEvent) { for (const fn of this.listeners) fn(e); }

  get mySide(): number | null {
    return this.mySeat === null ? null : sideOf(this.mySeat, this.table.mode);
  }

  isMyTurn(): boolean {
    return this.hand?.status === 'active' && this.mySeat !== null && this.hand.turn === this.mySeat;
  }

  /** Whichever side just won and may choose to pass or keep the pose. */
  canChoosePose(): boolean {
    return isPartnered(this.table.mode)
      && this.hand?.status !== 'active'
      && this.winnerSide === null
      && !this.poseMustBeDoubleSix
      && this.handsPlayed > 0
      && this.mySide === sideOf(this.poser, this.table.mode);
  }

  /**
   * Seat 0 pairs with 2, 1 with 3, matching `sideOf` for paired modes. Returns
   * null under cutthroat (no partner) or if the player is a spectator.
   */
  partnerSeat(): number | null {
    if (!isPartnered(this.table.mode) || this.mySeat === null) return null;
    return this.mySeat ^ 2;
  }

  /** Join a table: one parallel read (table + seats + open set), then a
   * dependent read for the current hand (needs table_id, which we now have)
   * and, if seated, this seat's tiles (needs the hand's id). Two waves, not
   * four sequential round trips. */
  static async open(tableId: string): Promise<OnlineGame> {
    const conn = db();
    const [tableRes, seatsRes, setRes] = await Promise.all([
      conn.from('tables').select('*').eq('id', tableId).single(),
      conn.from('seats').select('*').eq('table_id', tableId).order('seat_index'),
      conn.from('sets').select('*').eq('table_id', tableId).is('winner_side', null)
        .order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (tableRes.error || !tableRes.data) throw new Error(tableRes.error?.message ?? 'no such table');
    if (seatsRes.error) throw new Error(seatsRes.error.message);

    const t = tableRes.data;
    const game = new OnlineGame({
      id: t.id, loungeId: t.lounge_id, mode: t.mode, format: t.format, seatCount: t.seat_count,
      tournament: t.tournament, status: t.status, turnSeconds: t.turn_seconds,
      turnCapSeconds: t.turn_cap_seconds ?? t.turn_seconds, joinCode: t.join_code,
      tournamentId: t.tournament_id ?? null, roundNo: t.round_no ?? null,
      tournamentName: null,
    });

    // One extra read, and only for a table that is actually part of an event.
    // Fire-and-forget would be wrong here: the banner is the only thing telling
    // a player which round they are in, so it is worth the round trip before
    // the first render rather than a name that pops in afterwards.
    if (t.tournament_id) {
      const { data: event } = await conn.from('tournaments')
        .select('name').eq('id', t.tournament_id).maybeSingle();
      game.table = { ...game.table, tournamentName: (event?.name as string) ?? null };
    }

    const { data: auth } = await conn.auth.getUser();
    game.myUserId = auth.user?.id ?? null;
    game.applySeats(seatsRes.data ?? []);

    const set = setRes.data;
    if (set) {
      game.scores = set.scores; game.handValue = set.hand_value; game.poser = set.poser;
      game.poseMustBeDoubleSix = set.pose_must_be_double_six; game.handsPlayed = set.hands_played;
      game.winnerSide = set.winner_side; game.sixLove = set.six_love;
    }

    const ratingColumn = game.ratingColumn();
    const [handRes, ratingRes] = await Promise.all([
      conn.from('hand_public').select('*')
        .eq('table_id', tableId).order('updated_at', { ascending: false }).limit(1).maybeSingle(),
      game.isSpectator
        ? Promise.resolve({ data: null as any })
        : conn.from('profiles').select(ratingColumn).eq('id', game.myUserId!).maybeSingle(),
    ]);
    const hand = handRes.data;
    if (hand) {
      game.hand = hand as PublicHand;
      if (!game.isSpectator) {
        await game.loadPrivateTiles(hand.hand_id);
      }
    }
    if (ratingRes.data) game.ratingBefore = (ratingRes.data as any)[ratingColumn] ?? null;

    game.subscribe();
    document.addEventListener('visibilitychange', game.visListener);
    return game;
  }

  /**
   * Names, cached across re-seats. `seats` rows carry a user id and nothing
   * else, so without this every human at every online table renders as "Seat
   * 0" — which is what shipped, because the field existed and the view read
   * it and nothing ever wrote it.
   *
   * Entries carry a fetch time and go stale after NAME_TTL_MS (see
   * `staleUserIds`, the pure decision this makes). A permanent cache means a
   * player who edits their name or origin mid-game — the editor now exists,
   * so this is reachable — stays wrong on every screen already open on them
   * until that viewer leaves and re-enters the table. `loadNames()` is
   * called again from `onPublic` below, which already fires on every move,
   * so a stale entry corrects itself within a hand or two without a second
   * Realtime subscription just to watch profiles.
   */
  private names = new Map<string, {
    username: string; origin: string | null; avatar: string | null;
    background: string | null; rating: number | null; avgMoveMs: number | null;
    fetchedAt: number;
  }>();

  private applySeats(rows: any[]) {
    this.seats = rows.map((s) => ({
      seatIndex: s.seat_index,
      userId: s.user_id,
      username: s.user_id ? this.names.get(s.user_id)?.username ?? null : null,
      origin: s.user_id ? this.names.get(s.user_id)?.origin ?? null : null,
      avatar: s.user_id ? this.names.get(s.user_id)?.avatar ?? null : null,
      background: s.user_id ? this.names.get(s.user_id)?.background ?? null : null,
      rating: s.user_id ? this.names.get(s.user_id)?.rating ?? null : null,
      avgMoveMs: s.user_id ? this.names.get(s.user_id)?.avgMoveMs ?? null : null,
      duppyLevel: s.duppy_level,
      timeBank: s.time_bank ?? 0,
    }));
    this.mySeat = this.myUserId
      ? this.seats.find((s) => s.userId === this.myUserId)?.seatIndex ?? null
      : null;
    void this.loadNames();
  }

  /**
   * Fill in whoever we do not know yet or have not re-checked recently, then
   * redraw. Fire-and-forget on purpose: a name is decoration on a hand that
   * is already playable, so a failed lookup leaves the last name known
   * rather than blocking the table.
   */
  private async loadNames() {
    const now = Date.now();
    const due = staleUserIds(this.seats.map((s) => s.userId), this.names, now);
    if (due.length === 0) return;
    const ratingColumn = this.ratingColumn();
    const { data } = await db().from('profiles')
      .select(`id, username, origin, avatar, background, total_move_ms, total_moves, ${ratingColumn}`)
      .in('id', due);
    if (!data?.length) return;
    for (const row of data) {
      const totalMoves = (row.total_moves ?? 0) as number;
      this.names.set(row.id as string, {
        username: row.username as string,
        origin: (row.origin ?? null) as string | null,
        avatar: (row.avatar ?? null) as string | null,
        background: (row.background ?? null) as string | null,
        rating: ((row as any)[ratingColumn] ?? null) as number | null,
        avgMoveMs: totalMoves > 0 ? (row.total_move_ms as number) / totalMoves : null,
        fetchedAt: now,
      });
    }
    this.seats = this.seats.map((s) => {
      const known = s.userId ? this.names.get(s.userId) : undefined;
      return known
        ? {
            ...s, username: known.username, origin: known.origin, avatar: known.avatar,
            background: known.background, rating: known.rating, avgMoveMs: known.avgMoveMs,
          }
        : s;
    });
    this.emit({ type: 'state' });
  }

  private subscribe() {
    this.sub = watchTable(this.table.id, {
      onPublic: (hand) => {
        // Online has no 'played' event — the server sends whole states, not
        // moves — so the sound comes off the diff. A longer line under the
        // same hand id is a tile that just landed; a new hand id is a deal.
        // Both are true for my own move too, which is what we want: one knock
        // per tile, whoever played it.
        const prev = this.hand;
        const laid = (h: PublicHand | null) => {
          const b = h?.board;
          if (!b) return 0;
          // `=== 'cross'`, not `=== 'linear'` — a hand_public row from before
          // the cross board shipped has no `kind` at all and must fall
          // through to linear, or `b.arms` is read off an object that never
          // had one.
          if (b.kind === 'cross') return 1 + b.arms.reduce((n, a) => n + a.tiles.length, 0);
          return b.line.length;
        };
        if (prev && hand.hand_id === prev.hand_id) {
          if (laid(hand) > laid(prev)) sfx.play('knock');
        } else if (prev || hand.hand_id === this.justDealtHandId) {
          // A fresh deal. `prev` already existing means this client was
          // actively watching this table across the transition — a new
          // hand_id is unambiguous evidence a deal just happened here, no
          // matter how many tiles already landed on it before this
          // broadcast arrived (see justDealtHandId's own comment for why
          // checking for an empty board doesn't reliably catch that
          // moment). `prev === null` covers the one ambiguous case — the
          // very first broadcast this OnlineGame instance has ever seen,
          // which looks identical whether this client just dealt it or
          // arrived mid-hand as a late joiner — justDealtHandId resolves
          // that by checking whether THIS client is the one who dealt it.
          sfx.play('shuffle');
        }
        if (!prev || hand.hand_id !== prev.hand_id) {
          this.revealedDeal = null;
          this.review = null;
          this.reviewAccuracy = null;
        }
        if (prev?.status === 'active' && hand.status === 'domino') this.justWonByDominoHandId = hand.hand_id;
        this.hand = hand;
        // Real data has arrived — whatever was predicted in play() is either
        // already confirmed by this or superseded by it, either way this is
        // the truth now.
        this.predictedBoard = null;
        this.predictedMyTiles = null;
        // Piggybacks the staleness sweep on a move that was already going to
        // redraw the table — see the comment on `names` for why this exists
        // instead of a dedicated subscription.
        void this.loadNames();
        this.emit({ type: 'state' });
      },
      onSeatTiles: (handId, seatIndex, tiles) => {
        // RLS decides which seat_hands rows reach me: my own always, and my
        // partner's when the mode is openhand. Route by seat_index — writing
        // partner tiles into `myTiles` is the bug this callback shape exists
        // to make impossible. A row I do not recognise gets dropped.
        if (handId !== this.hand?.hand_id) return;
        if (seatIndex === this.mySeat) {
          this.myTiles = tiles;
        } else if (seatIndex === this.partnerSeat() && this.table.mode === 'openhand') {
          this.partnerTiles = tiles;
        } else {
          return;
        }
        this.emit({ type: 'state' });
      },
      onSet: (set) => {
        // Only on the edge into six love — `sets` rows update on every hand,
        // and a flag that is already true must not re-fire the sound.
        if (!this.sixLove && set.six_love) sfx.play('sixLove');
        const justDecided = this.winnerSide === null && set.winner_side !== null;
        const beforeScores = this.scores;
        this.scores = set.scores as number[]; this.handValue = set.hand_value as number;
        // A bruk is the moment every pip goes out at once — worth animating.
        this.lastResultBruk = beforeScores.some((v) => v > 0) && this.scores.every((v) => v === 0);
        this.poser = set.poser as number; this.poseMustBeDoubleSix = set.pose_must_be_double_six as boolean;
        this.handsPlayed = set.hands_played as number; this.winnerSide = set.winner_side as number | null;
        this.sixLove = set.six_love as boolean;
        if (justDecided && !this.isSpectator) void this.loadRatingAfter();
        this.emit({ type: 'state' });
      },
      onSeats: () => { void this.refetchSeats(); },
    });
  }

  /**
   * The rating write (`_shared/apply-rating.ts`) happens server-side after
   * the `sets` row that triggers this method's caller already committed and
   * broadcast — so reading `profiles` the instant `winnerSide` flips can
   * land before the write does. Retry a few times rather than trust the
   * first read: a duppy-mixed table (never rated) and "the write just
   * hasn't landed yet" look identical after one failed read, and only the
   * first one should end in silence.
   */
  private async loadRatingAfter(): Promise<void> {
    const userId = this.myUserId;
    if (userId === null || this.ratingBefore === null) return;
    const column = this.ratingColumn();
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 400));
      const { data } = await db().from('profiles').select(column).eq('id', userId).maybeSingle();
      const value = data ? ((data as any)[column] as number | undefined) ?? null : null;
      if (value !== null && value !== this.ratingBefore) {
        this.ratingAfter = value;
        this.emit({ type: 'state' });
        return;
      }
    }
    // Unchanged after retries — a duppy-mixed table, most likely. Showing
    // nothing here is more honest than a fabricated "+0".
  }

  private async refetchSeats() {
    const { data } = await db().from('seats').select('*').eq('table_id', this.table.id).order('seat_index');
    this.applySeats(data ?? []);
    this.emit({ type: 'state' });
  }

  /** After a 409: someone else moved first. Reload the public state, show
   * nothing alarming — this is the concurrency control working correctly. */
  private async refetchHand() {
    const { data } = await db().from('hand_public').select('*')
      .eq('table_id', this.table.id).order('updated_at', { ascending: false }).limit(1).maybeSingle();
    if (data) this.hand = data as PublicHand;
    if (!this.isSpectator && this.hand) {
      await this.loadPrivateTiles(this.hand.hand_id);
    }
    this.emit({ type: 'state' });
  }

  /**
   * Read this seat's tiles — and, in openhand, the partner's tiles too.
   *
   * One round trip, not two: the extended seat_hands RLS in 0016 lets both
   * rows come back from a single `.in('seat_index', [me, partner])`, so a
   * partner-open table pays no extra network cost over an ordinary partner
   * table. A seat not covered by RLS is simply not returned; there is no
   * client-side filtering step that could be wrong.
   */
  private async loadPrivateTiles(handId: string): Promise<void> {
    if (this.mySeat === null) return;
    const partner = this.partnerSeat();
    const wantOpenhand = this.table.mode === 'openhand' && partner !== null;
    const seats = wantOpenhand ? [this.mySeat, partner!] : [this.mySeat];
    const { data } = await db().from('seat_hands').select('seat_index, tiles')
      .eq('hand_id', handId).in('seat_index', seats);
    const rows = data ?? [];
    this.myTiles = (rows.find((r: any) => r.seat_index === this.mySeat)?.tiles as TileId[]) ?? [];
    this.partnerTiles = wantOpenhand
      ? (rows.find((r: any) => r.seat_index === partner)?.tiles as TileId[]) ?? null
      : null;
  }

  private resubscribe() {
    this.sub?.stop();
    this.subscribe();
    void this.refetchHand();
  }

  /** Legal moves for MY turn only — a stub state with my real tiles and
   * placeholder-length arrays for everyone else, the same trick bots.ts uses.
   * `turn` must be set to my own seat: legalMoves() reads hands[state.turn]. */
  legalMovesForMe(): Move[] {
    if (!this.hand || this.mySeat === null || this.hand.turn !== this.mySeat) return [];
    const hands: TileId[][] = this.hand.hand_sizes.map((n, i) =>
      i === this.mySeat ? this.myTiles : new Array(n).fill('0-0'));
    return legalMoves({
      seatCount: this.table.seatCount,
      mode: this.table.mode,
      hands,
      boneyard: new Array(this.hand.boneyard_size).fill('0-0'),
      board: this.hand.board,
      turn: this.mySeat,
      consecutivePasses: 0,
      moveLog: this.hand.move_log,
      status: this.hand.status as 'active' | 'domino' | 'blocked',
      result: this.hand.result as any,
      poseMustBeDoubleSix: this.poseMustBeDoubleSix,
      // Chucha opens French, double-six opens every other format. Derived
      // from format so the legal-move enumeration matches the server's,
      // without persisting yet another column.
      openingTile: this.table.format === 'french' ? '0-0' : '6-6',
      poser: this.poser,
      format: this.table.format as SetFormat,
    });
  }

  async play(move: Move): Promise<void> {
    if (!this.hand || this.mySeat === null) return;
    // Show my own tile landing immediately — legalMovesForMe() already
    // proved this move legal, so predictMyMove() only ever fails closed
    // (see predict.ts), never shows something that turns out wrong.
    const prediction = predictMyMove({
      seatCount: this.table.seatCount,
      mode: this.table.mode,
      format: this.table.format as SetFormat,
      myTiles: this.myTiles,
      mySeat: this.mySeat,
      handSizes: this.hand.hand_sizes,
      boneyardSize: this.hand.boneyard_size,
      board: this.hand.board,
      moveLog: this.hand.move_log,
      status: this.hand.status as 'active' | 'domino' | 'blocked',
      result: this.hand.result as any,
      poseMustBeDoubleSix: this.poseMustBeDoubleSix,
      poser: this.poser,
    }, move);
    if (prediction) {
      this.predictedBoard = prediction.board;
      this.predictedMyTiles = prediction.myTiles;
      this.emit({ type: 'state' });
    }
    try {
      await apiPlayMove(this.hand.hand_id, move);
    } catch (err) {
      // The real state never changed, so the prediction must not linger —
      // clear it and let the last-known-true board/hand show through again.
      this.predictedBoard = null;
      this.predictedMyTiles = null;
      if (err instanceof ConflictError) { await this.refetchHand(); return; }
      this.emit({ type: 'error', message: err instanceof Error ? err.message : 'move failed' });
      this.emit({ type: 'state' });
    }
  }

  /** 2 coins, once per finished hand — see revealedDeal's own comment. */
  async reveal(): Promise<void> {
    if (!this.hand || this.revealPending || this.revealedDeal) return;
    this.revealPending = true;
    this.emit({ type: 'state' });
    try {
      const { deal } = await apiRevealHand(this.hand.hand_id);
      this.revealedDeal = deal;
    } catch (err) {
      this.emit({ type: 'error', message: err instanceof Error ? err.message : 'could not reveal the hand' });
    } finally {
      this.revealPending = false;
      this.emit({ type: 'state' });
    }
  }

  /** Grades every decision on the just-finished hand. Free (rate-limited
   *  server-side for guests) — unlike reveal(), no coin spend here. */
  async requestCoachReview(): Promise<void> {
    if (!this.hand || this.reviewPending || this.review) return;
    this.reviewPending = true;
    this.emit({ type: 'state' });
    try {
      const { review, accuracy } = await apiRequestReview(this.hand.hand_id);
      this.review = review;
      this.reviewAccuracy = accuracy;
    } catch (err) {
      this.emit({ type: 'error', message: err instanceof Error ? err.message : 'could not review the hand' });
    } finally {
      this.reviewPending = false;
      this.emit({ type: 'state' });
    }
  }

  async dealNext(pass: boolean): Promise<void> {
    try {
      if (pass) await apiPassPose(this.table.id);
      const { handId } = await apiStartHand(this.table.id);
      // See justDealtHandId's own comment: this covers the one case the
      // realtime handler can't tell apart on its own.
      this.justDealtHandId = handId;
    } catch (err) {
      this.emit({ type: 'error', message: err instanceof Error ? err.message : 'could not start hand' });
    }
  }

  leave() {
    this.sub?.stop();
    document.removeEventListener('visibilitychange', this.visListener);
  }

  async leaveSeat(): Promise<void> {
    if (!this.isSpectator) {
      try { await apiLeaveSeat(this.table.id); } catch { /* seat may already be gone; proceed to teardown regardless */ }
    }
    this.leave();
  }
}
