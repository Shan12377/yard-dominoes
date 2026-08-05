import { applyMove } from '@yard/engine';
import type { AnyBoard, GameMode, HandResult, HandStatus, Move, SetFormat, TileId, HandState } from '@yard/engine';

export interface PredictInput {
  seatCount: 2 | 3 | 4;
  mode: GameMode;
  format: SetFormat;
  myTiles: TileId[];
  mySeat: number;
  handSizes: number[];
  boneyardSize: number;
  board: AnyBoard | null;
  moveLog: Move[];
  status: HandStatus;
  result: HandResult | null;
  poseMustBeDoubleSix: boolean;
  poser: number;
}

export interface Prediction {
  board: AnyBoard | null;
  myTiles: TileId[];
}

/**
 * Optimistically applies MY OWN move locally, the moment it's tapped,
 * using the exact same stub-state trick legalMovesForMe() already uses —
 * my real tiles, placeholder-length arrays for every other seat. This can
 * only ever predict MY tile landing, never what a duppy or another player
 * does next: the client is never handed another seat's tiles (the whole
 * point of the redaction model in supabase.md), so there is nothing to
 * predict with beyond this one move. Whatever happens after arrives for
 * real over realtime a moment later, same as before.
 *
 * Returns null if applyMove throws — should never happen in practice,
 * since the caller only ever predicts a move legalMovesForMe() already
 * said was legal, but failing closed here means a bug in this prediction
 * path degrades to "no optimistic update," never a wrong one.
 */
export function predictMyMove(input: PredictInput, move: Move): Prediction | null {
  const hands: TileId[][] = input.handSizes.map((n, i) =>
    i === input.mySeat ? input.myTiles : new Array(n).fill('0-0'));
  const state: HandState = {
    seatCount: input.seatCount,
    mode: input.mode,
    format: input.format,
    hands,
    boneyard: new Array(input.boneyardSize).fill('0-0'),
    board: input.board,
    turn: input.mySeat,
    consecutivePasses: 0,
    moveLog: input.moveLog,
    penalties: new Array(input.seatCount).fill(0),
    status: input.status,
    result: input.result,
    poseMustBeDoubleSix: input.poseMustBeDoubleSix,
    openingTile: input.format === 'french' ? '0-0' : '6-6',
    poser: input.poser,
  };
  try {
    const next = applyMove(state, move);
    return { board: next.board, myTiles: next.hands[input.mySeat] };
  } catch {
    return null;
  }
}
