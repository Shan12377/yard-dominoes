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
  leaveSeat as apiLeaveSeat, watchTable, ConflictError, type PublicHand, type TableSubscription,
} from './online.ts';
import * as sfx from './sfx.ts';
import { staleUserIds } from './name-cache.ts';
import { legalMoves, sideOf } from '@yard/engine';
import type { GameMode, Move, TileId } from '@yard/engine';

export interface TableInfo {
  id: string;
  loungeId: string | null;
  mode: GameMode;
  format: string;
  seatCount: 2 | 3 | 4;
  tournament: boolean;
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
  duppyLevel: string | null;
  /** Unspent seconds this seat carries into its next turn. Server-owned. */
  timeBank: number;
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

  scores: number[] = [];
  handValue = 1;
  poser = 0;
  poseMustBeDoubleSix = true;
  handsPlayed = 0;
  winnerSide: number | null = null;
  sixLove = false;

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
    return this.table.mode === 'partner'
      && this.hand?.status !== 'active'
      && this.winnerSide === null
      && !this.poseMustBeDoubleSix
      && this.handsPlayed > 0
      && this.mySide === sideOf(this.poser, 'partner');
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
    });

    const { data: auth } = await conn.auth.getUser();
    game.myUserId = auth.user?.id ?? null;
    game.applySeats(seatsRes.data ?? []);

    const set = setRes.data;
    if (set) {
      game.scores = set.scores; game.handValue = set.hand_value; game.poser = set.poser;
      game.poseMustBeDoubleSix = set.pose_must_be_double_six; game.handsPlayed = set.hands_played;
      game.winnerSide = set.winner_side; game.sixLove = set.six_love;
    }

    const { data: hand } = await conn.from('hand_public').select('*')
      .eq('table_id', tableId).order('updated_at', { ascending: false }).limit(1).maybeSingle();
    if (hand) {
      game.hand = hand as PublicHand;
      if (!game.isSpectator) {
        const { data: seatHand } = await conn.from('seat_hands').select('tiles')
          .eq('hand_id', hand.hand_id).eq('seat_index', game.mySeat!).maybeSingle();
        game.myTiles = (seatHand?.tiles as TileId[]) ?? [];
      }
    }

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
  private names = new Map<string, { username: string; origin: string | null; fetchedAt: number }>();

  private applySeats(rows: any[]) {
    this.seats = rows.map((s) => ({
      seatIndex: s.seat_index,
      userId: s.user_id,
      username: s.user_id ? this.names.get(s.user_id)?.username ?? null : null,
      origin: s.user_id ? this.names.get(s.user_id)?.origin ?? null : null,
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
    const { data } = await db().from('profiles').select('id, username, origin').in('id', due);
    if (!data?.length) return;
    for (const row of data) {
      this.names.set(row.id as string, {
        username: row.username as string,
        origin: (row.origin ?? null) as string | null,
        fetchedAt: now,
      });
    }
    this.seats = this.seats.map((s) => {
      const known = s.userId ? this.names.get(s.userId) : undefined;
      return known ? { ...s, username: known.username, origin: known.origin } : s;
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
        const laid = (h: PublicHand | null) => h?.board?.line.length ?? 0;
        if (prev && hand.hand_id === prev.hand_id) {
          if (laid(hand) > laid(prev)) sfx.play('knock');
        } else if (laid(hand) === 0) {
          // A fresh deal. An opening board with tiles already on it means we
          // arrived in the middle of somebody else's hand — no shuffle for
          // that, it did not just happen.
          sfx.play('shuffle');
        }
        this.hand = hand;
        // Piggybacks the staleness sweep on a move that was already going to
        // redraw the table — see the comment on `names` for why this exists
        // instead of a dedicated subscription.
        void this.loadNames();
        this.emit({ type: 'state' });
      },
      onMyTiles: (handId, tiles) => {
        if (handId !== this.hand?.hand_id) return;
        this.myTiles = tiles;
        this.emit({ type: 'state' });
      },
      onSet: (set) => {
        // Only on the edge into six love — `sets` rows update on every hand,
        // and a flag that is already true must not re-fire the sound.
        if (!this.sixLove && set.six_love) sfx.play('sixLove');
        this.scores = set.scores as number[]; this.handValue = set.hand_value as number;
        this.poser = set.poser as number; this.poseMustBeDoubleSix = set.pose_must_be_double_six as boolean;
        this.handsPlayed = set.hands_played as number; this.winnerSide = set.winner_side as number | null;
        this.sixLove = set.six_love as boolean;
        this.emit({ type: 'state' });
      },
      onSeats: () => { void this.refetchSeats(); },
    });
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
      const { data: seatHand } = await db().from('seat_hands').select('tiles')
        .eq('hand_id', this.hand.hand_id).eq('seat_index', this.mySeat!).maybeSingle();
      this.myTiles = (seatHand?.tiles as TileId[]) ?? [];
    }
    this.emit({ type: 'state' });
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
      poser: this.poser,
    });
  }

  async play(move: Move): Promise<void> {
    if (!this.hand) return;
    try {
      await apiPlayMove(this.hand.hand_id, move);
    } catch (err) {
      if (err instanceof ConflictError) { await this.refetchHand(); return; }
      this.emit({ type: 'error', message: err instanceof Error ? err.message : 'move failed' });
    }
  }

  async dealNext(pass: boolean): Promise<void> {
    try {
      if (pass) await apiPassPose(this.table.id);
      await apiStartHand(this.table.id);
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
