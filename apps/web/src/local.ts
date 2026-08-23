/**
 * Local table.
 *
 * Runs the whole game in the browser against duppies. It exists for three
 * reasons: it is the offline practice mode the Academy sends beginners to, it
 * is how the engine gets exercised end to end without a backend, and it means
 * the app is playable the moment someone opens it — no account, no waiting for
 * three strangers.
 *
 * The online table swaps this controller for Edge Function calls. The view
 * layer does not change.
 */

import {
  createSet, applyHandResult, deal, legalMoves, applyMove, dealPlan,
  provablyFairShuffle, commit, randomSeed, verifyHand,
  duppyMove, reviewHand, accuracy, isPartnered, sideOf,
} from '@yard/engine';
import type {
  DuppyLevel, GameMode, HandReview, HandState, Move, PenaltyEvent, SetFormat, SetState, TileId,
} from '@yard/engine';

export interface LocalOptions {
  mode: GameMode;
  format: SetFormat;
  seatCount: 2 | 3 | 4;
  duppy: DuppyLevel;
  tournament: boolean;
  oneAllPlayTwo: boolean;
}

export interface HandFairness {
  commitment: string;
  serverSeed: string;
  clientSeeds: string[];
  handId: string;
  dealt: TileId[][];
  removeDoubleBlank: boolean;
}

export type LocalEvent =
  | { type: 'state' }
  | { type: 'played'; seat: number; tile: TileId }
  | { type: 'passed'; seat: number }
  | { type: 'handOver' }
  | { type: 'setOver' }
  /** A French penalty just landed somewhere at the table — see PenaltyEvent. */
  | { type: 'penalty'; events: PenaltyEvent[] };

export class LocalGame {
  set: SetState;
  hand: HandState | null = null;
  dealt: TileId[][] = [];
  fairness: HandFairness | null = null;
  /** The seat the human is sitting in. Always 0. */
  readonly mySeat = 0;
  lastResultBruk = false;
  /**
   * Every side's score immediately BEFORE the hand that just finished was
   * folded in — snapshotted in finishHand(), read by handResult() to show
   * "N pips → +N, now total" per seat for French. Doubling as the source for
   * lastResultBruk's own before/after comparison rather than a second field.
   */
  scoresBeforeHand: number[] = [];
  private listeners: ((e: LocalEvent) => void)[] = [];

  constructor(public options: LocalOptions) {
    this.set = createSet({
      mode: options.mode,
      format: options.format,
      seatCount: options.seatCount,
      tournament: options.tournament,
      oneAllPlayTwo: options.oneAllPlayTwo,
    });
  }

  on(fn: (e: LocalEvent) => void) { this.listeners.push(fn); }
  private emit(e: LocalEvent) { for (const fn of this.listeners) fn(e); }

  get mySide() { return sideOf(this.mySeat, this.options.mode); }

  isMyTurn(): boolean {
    return this.hand?.status === 'active' && this.hand.turn === this.mySeat;
  }

  /** Deal the next hand, committing to the shuffle before any tile is dealt. */
  async startHand(): Promise<void> {
    const serverSeed = randomSeed();
    const commitment = await commit(serverSeed);
    const clientSeeds = [randomSeed(8)];
    const handId = `local:${this.set.handsPlayed + 1}`;
    const { removeDoubleBlank } = dealPlan(this.options.seatCount, false);

    const order = await provablyFairShuffle({ serverSeed, clientSeeds, handId, removeDoubleBlank });

    this.hand = deal({
      order,
      seatCount: this.options.seatCount,
      mode: this.options.mode,
      useBoneyard: false,
      poser: this.set.poseMustBeDoubleSix ? undefined : this.set.poser,
      poseMustBeDoubleSix: this.set.poseMustBeDoubleSix || this.options.tournament,
      // French, round 2+ only — round 1 (and a tie-break reshuffle) already
      // forces the chucha specifically via poseMustBeDoubleSix above; this
      // is the "any double, your choice, or you're fined and it passes to
      // someone who has one" rule for every hand after that.
      poseMustBeAnyDouble:
        this.options.format === 'french' && !(this.set.poseMustBeDoubleSix || this.options.tournament),
      openingTile: this.options.format === 'french' ? '0-0' : '6-6',
      format: this.options.format,
    });
    this.dealt = this.hand.hands.map((h) => [...h]);
    this.fairness = {
      commitment, serverSeed, clientSeeds, handId,
      dealt: this.dealt, removeDoubleBlank,
    };
    this.lastResultBruk = false;
    if (this.hand.lastPenalties?.length) this.emit({ type: 'penalty', events: this.hand.lastPenalties });
    this.emit({ type: 'state' });
    await this.runDuppies();
  }

  legal(): Move[] {
    if (!this.hand || !this.isMyTurn()) return [];
    return legalMoves(this.hand);
  }

  /** Which of my tiles can go down right now. */
  playableTiles(): Set<TileId> {
    return new Set(this.legal().flatMap((m) => ('tile' in m ? [m.tile] : [])));
  }

  async play(move: Move): Promise<void> {
    if (!this.hand) return;
    this.hand = applyMove(this.hand, move);
    if (move.kind === 'pass') this.emit({ type: 'passed', seat: move.seat });
    else if ('tile' in move) this.emit({ type: 'played', seat: move.seat, tile: move.tile });
    if (this.hand.lastPenalties?.length) this.emit({ type: 'penalty', events: this.hand.lastPenalties });
    this.emit({ type: 'state' });
    await this.afterMove();
  }

  private async afterMove() {
    if (!this.hand) return;
    if (this.hand.status !== 'active') return this.finishHand();
    await this.runDuppies();
  }

  private async runDuppies() {
    if (!this.hand) return;
    while (this.hand.status === 'active' && this.hand.turn !== this.mySeat) {
      // A beat of delay so the table reads like people playing, not a solver.
      await new Promise((r) => setTimeout(r, 420));
      const move = duppyMove(this.hand, this.options.duppy);
      this.hand = applyMove(this.hand, move);
      if (move.kind === 'pass') this.emit({ type: 'passed', seat: move.seat });
      else if ('tile' in move) this.emit({ type: 'played', seat: move.seat, tile: move.tile });
      if (this.hand.lastPenalties?.length) this.emit({ type: 'penalty', events: this.hand.lastPenalties });
      this.emit({ type: 'state' });
    }
    if (this.hand.status !== 'active') this.finishHand();
  }

  private finishHand() {
    if (!this.hand?.result) return;
    const before = [...this.set.scores];
    this.scoresBeforeHand = before;
    this.set = applyHandResult(this.set, this.hand.result);
    // A bruk is the moment every pip goes out at once — worth animating.
    this.lastResultBruk =
      before.some((v) => v > 0) && this.set.scores.every((v) => v === 0);
    this.emit({ type: 'handOver' });
    if (this.set.winnerSide !== null) this.emit({ type: 'setOver' });
  }

  /** Run the Coach over the hand just played. */
  review(): HandReview | null {
    if (!this.hand?.result || this.dealt.length === 0) return null;
    const initial: HandState = {
      seatCount: this.options.seatCount,
      mode: this.options.mode,
      hands: this.dealt.map((h) => [...h]),
      boneyard: [],
      board: null,
      turn: this.hand.poser,
      consecutivePasses: 0,
      moveLog: [],
      penalties: new Array(this.options.seatCount).fill(0),
      status: 'active',
      result: null,
      poseMustBeDoubleSix: this.hand.poseMustBeDoubleSix,
      openingTile: this.hand.openingTile,
      poser: this.hand.poser,
      format: this.hand.format,
    };
    return reviewHand(initial, this.hand.moveLog, this.mySeat);
  }

  reviewAccuracy(r: HandReview) { return accuracy(r); }

  /** What the "Verify this hand" button runs. */
  async verify(): Promise<{ ok: boolean; reason?: string }> {
    if (!this.fairness) return { ok: false, reason: 'no hand to check yet' };
    return verifyHand(this.fairness);
  }

  seatLabel(seat: number): string {
    if (seat === this.mySeat) return 'You';
    if (isPartnered(this.options.mode) && sideOf(seat, this.options.mode) === this.mySide) {
      return 'Partner';
    }
    return `Duppy ${seat + 1} · ${this.options.duppy}`;
  }

  /** Seats that have passed at least once, and what that revealed. */
  passesBySeat(): Map<number, number> {
    const out = new Map<number, number>();
    for (const m of this.hand?.moveLog ?? []) {
      if (m.kind === 'pass') out.set(m.seat, (out.get(m.seat) ?? 0) + 1);
    }
    return out;
  }
}
