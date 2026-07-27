/**
 * The Coach.
 *
 * Once a hand is finished the server knows every tile, so it can go back and
 * work out what each decision was actually worth. For every move the reviewed
 * player made, we solve the position exactly — trying each legal alternative
 * and playing the rest out under best defence — and compare.
 *
 * This is tractable here in a way it is not in most games. A hand is at most
 * 28 tiles, each player holds seven, and the branching factor is usually one
 * to three. Full search is normally exhaustive; a node budget catches the rare
 * position that isn't.
 *
 * The output is the product loop: play, get graded, get sent to the lesson
 * that names the mistake, play better.
 */

import { legalMoves, applyMove } from './hand.ts';
import { handCount, halves, isDouble, sideOf, tileCount } from './tiles.ts';
import { suitStrength } from './bots.ts';
import type { HandState, Move, Pip, TileId } from './types.ts';

export type Grade = 'best' | 'fine' | 'loose' | 'blunder';

export const GRADE_LABEL: Record<Grade, string> = {
  best: 'Best',
  fine: 'Fine',
  loose: 'Loose',
  blunder: 'Blunder',
};

export interface MoveReview {
  ply: number;
  seat: number;
  move: Move;
  best: Move;
  /** +1 the reviewed side wins the hand, 0 a tied block, -1 they lose. */
  valueActual: number;
  valueBest: number;
  loss: number;
  grade: Grade;
  note: string;
  /** Curriculum reference, e.g. "Belt 4 · Lesson 1". */
  lesson: string | null;
  exact: boolean;
}

export interface HandReview {
  seat: number;
  side: number;
  reviews: MoveReview[];
  /** The one decision that cost the most. Null when nothing was thrown away. */
  criticalPly: number | null;
  summary: string;
  exact: boolean;
  counts: { best: number; fine: number; loose: number; blunder: number };
}

interface Budget { nodes: number; limit: number; exhausted: boolean }

function memoKey(s: HandState): string {
  const hands = s.hands.map((h) => [...h].sort().join(',')).join('|');
  const ends = s.board ? `${s.board.leftEnd}/${s.board.rightEnd}` : 'x';
  return `${hands}#${ends}#${s.turn}#${s.consecutivePasses}`;
}

/**
 * Exact value of a position for `side`, under the paranoid assumption that
 * every other side plays to beat them. In Partner this is plain minimax; in
 * Cut Throat it is the conservative reading, which is the right one to grade
 * against.
 */
function solve(s: HandState, side: number, memo: Map<string, number>, budget: Budget): number {
  if (s.status !== 'active') {
    if (s.result!.tie) return 0;
    return s.result!.winnerSide === side ? 1 : -1;
  }
  if (budget.nodes++ > budget.limit) {
    budget.exhausted = true;
    return heuristicValue(s, side);
  }

  const key = memoKey(s);
  const hit = memo.get(key);
  if (hit !== undefined) return hit;

  const moves = legalMoves(s);
  const mine = sideOf(s.turn, s.mode) === side;
  let value = mine ? -Infinity : Infinity;

  for (const move of moves) {
    const v = solve(applyMove(s, move), side, memo, budget);
    if (mine) {
      if (v > value) value = v;
      if (value === 1) break; // cannot do better
    } else {
      if (v < value) value = v;
      if (value === -1) break;
    }
  }
  if (!Number.isFinite(value)) value = 0;
  memo.set(key, value);
  return value;
}

/** Fallback when a position is too large to solve exactly. */
function heuristicValue(s: HandState, side: number): number {
  let mine = 0;
  let theirs = 0;
  for (let seat = 0; seat < s.seatCount; seat++) {
    const c = handCount(s.hands[seat]);
    if (sideOf(seat, s.mode) === side) mine += c;
    else theirs += c;
  }
  if (mine === theirs) return 0;
  return mine < theirs ? 0.4 : -0.4;
}

function gradeFor(loss: number): Grade {
  if (loss <= 0.01) return 'best';
  if (loss < 1) return 'fine';
  if (loss < 2) return 'loose';
  return 'blunder';
}

function endsOf(s: HandState): [Pip, Pip] | null {
  return s.board ? [s.board.leftEnd, s.board.rightEnd] : null;
}

function voidsAt(s: HandState, seatCount: number): Set<Pip>[] {
  const voids: Set<Pip>[] = Array.from({ length: seatCount }, () => new Set<Pip>());
  for (const m of s.moveLog) {
    if (m.kind === 'pass' && m.ends) {
      voids[m.seat].add(m.ends[0]);
      voids[m.seat].add(m.ends[1]);
    }
  }
  return voids;
}

/**
 * Say WHY the better move was better, in the language of the curriculum, and
 * point at the lesson. A grade without a reason teaches nothing.
 */
function explain(
  before: HandState,
  played: Move,
  best: Move,
  seat: number,
): { note: string; lesson: string | null } {
  const afterBest = applyMove(before, best);
  const afterPlayed = applyMove(before, played);

  if (afterBest.status === 'domino' && afterBest.result!.winnerSeat === seat && afterPlayed.status === 'active') {
    return {
      note: 'You were holding the tile that finished the hand. Play it and the hand is over.',
      lesson: 'Belt 3 · Lesson 1',
    };
  }

  if (played.kind === 'pass' || best.kind === 'pass') {
    return {
      note: 'The board left you nothing to work with here.',
      lesson: null,
    };
  }

  const voids = voidsAt(before, before.seatCount);
  const mySide = sideOf(seat, before.mode);
  const opponents: number[] = [];
  for (let s = 0; s < before.seatCount; s++) if (sideOf(s, before.mode) !== mySide) opponents.push(s);

  const bestEnds = endsOf(afterBest);
  const playedEnds = endsOf(afterPlayed);

  if (bestEnds && playedEnds) {
    const bestBlocks = opponents.filter((o) => bestEnds.some((e) => voids[o].has(e))).length;
    const playedBlocks = opponents.filter((o) => playedEnds.some((e) => voids[o].has(e))).length;
    if (bestBlocks > playedBlocks) {
      return {
        note:
          'The other move leaves the board on a suit an opponent has already passed on. ' +
          'A pass is permanent — once they show a void, that suit is a weapon for the rest of the hand.',
        lesson: 'Belt 4 · Lesson 1',
      };
    }

    const remainingBest = before.hands[seat].filter((t) => t !== (best as any).tile);
    const remainingPlayed = before.hands[seat].filter((t) => t !== (played as any).tile);
    const controlBest = suitStrength(remainingBest)[bestEnds[0]] + suitStrength(remainingBest)[bestEnds[1]];
    const controlPlayed =
      suitStrength(remainingPlayed)[playedEnds[0]] + suitStrength(remainingPlayed)[playedEnds[1]];
    if (controlBest > controlPlayed) {
      return {
        note:
          'That play gave up control of the board. The other tile leaves ends you can still answer, ' +
          'so the game keeps coming back to you.',
        lesson: 'Belt 3 · Lesson 3',
      };
    }
  }

  const pipsBest = tileCount((best as any).tile);
  const pipsPlayed = tileCount((played as any).tile);
  if (pipsBest > pipsPlayed && before.hands[seat].length <= 4) {
    return {
      note:
        'You held on to the heavy tile too long. This late, if the board jams, that count is what beats you.',
      lesson: 'Belt 4 · Lesson 6',
    };
  }

  if (isDouble((played as any).tile) && !isDouble((best as any).tile)) {
    return {
      note:
        'A double leaves the same suit showing, so it does not move the board on. ' +
        'It was worth keeping while you still owned that suit.',
      lesson: 'Belt 3 · Lesson 6',
    };
  }

  return {
    note: 'There was a stronger tile here.',
    lesson: 'Belt 3 · Lesson 4',
  };
}

export interface ReviewOptions {
  /** Node ceiling per decision. Raise for exactness, lower for speed. */
  nodeLimit?: number;
}

/**
 * Review one seat's play across a completed hand.
 *
 * `initial` must be the state as dealt, before any move was applied.
 */
export function reviewHand(
  initial: HandState,
  moveLog: Move[],
  seat: number,
  options: ReviewOptions = {},
): HandReview {
  const limit = options.nodeLimit ?? 120_000;
  const side = sideOf(seat, initial.mode);
  const reviews: MoveReview[] = [];
  let exactOverall = true;

  let s = initial;
  for (let ply = 0; ply < moveLog.length; ply++) {
    const move = moveLog[ply];

    if (move.seat === seat && move.kind !== 'draw') {
      const options_ = legalMoves(s);
      if (options_.length > 1) {
        const memo = new Map<string, number>();
        const budget: Budget = { nodes: 0, limit, exhausted: false };

        let bestMove = options_[0];
        let bestValue = -Infinity;
        let actualValue = 0;

        for (const candidate of options_) {
          const v = solve(applyMove(s, candidate), side, memo, budget);
          if (v > bestValue) { bestValue = v; bestMove = candidate; }
          const same =
            candidate.kind === move.kind &&
            (candidate as any).tile === (move as any).tile &&
            (candidate as any).end === (move as any).end;
          if (same) actualValue = v;
        }

        const loss = Math.max(0, bestValue - actualValue);
        const grade = gradeFor(loss);
        const { note, lesson } =
          grade === 'best'
            ? { note: 'Correct.', lesson: null }
            : explain(s, move, bestMove, seat);

        if (budget.exhausted) exactOverall = false;

        reviews.push({
          ply, seat, move, best: bestMove,
          valueActual: actualValue, valueBest: bestValue,
          loss, grade, note, lesson, exact: !budget.exhausted,
        });
      }
    }

    s = applyMove(s, move);
  }

  const counts = { best: 0, fine: 0, loose: 0, blunder: 0 };
  for (const r of reviews) counts[r.grade]++;

  let criticalPly: number | null = null;
  let worst = 0;
  for (const r of reviews) {
    if (r.loss > worst) { worst = r.loss; criticalPly = r.ply; }
  }

  const summary =
    criticalPly === null
      ? reviews.length === 0
        ? 'You were never given a real choice this hand.'
        : 'Clean hand. Every decision you had, you got right.'
      : counts.blunder > 0
        ? 'One move threw this hand away. Everything before it was fine.'
        : 'You gave up ground here — the hand was winnable.';

  return { seat, side, reviews, criticalPly, summary, exact: exactOverall, counts };
}

/** Percentage of decisions graded best or fine. The number to show a player. */
export function accuracy(review: HandReview): number {
  const total = review.reviews.length;
  if (total === 0) return 100;
  return Math.round(((review.counts.best + review.counts.fine) / total) * 100);
}
