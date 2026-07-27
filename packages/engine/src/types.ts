/**
 * Core types for the Jamaican dominoes rules engine.
 *
 * Seat numbering convention: seats are numbered in PLAY order, which is
 * anti-clockwise around the physical table. Seat (n+1) sits to the physical
 * RIGHT of seat n. In a four-hander, partners are seats 0&2 and 1&3, which
 * places them directly opposite each other — they never play consecutively.
 */

export type Pip = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Canonical tile id, always "low-high", e.g. "0-0", "2-5", "6-6". */
export type TileId = string;

export type GameMode = 'cutthroat' | 'partner';

/**
 * sixlove     — six consecutive wins while every opponent stays at zero.
 *               A win by a side on zero BRUKS the score back to 0-0.
 * firstToSix  — best of six. Plain race to six, no reset.
 * single      — one hand, one winner. Used for drills.
 */
export type SetFormat = 'sixlove' | 'firstToSix' | 'single';

export type End = 'left' | 'right';

export interface PlacedTile {
  tile: TileId;
  /** True when laid crosswise (a double). Cosmetic in standard play. */
  crosswise: boolean;
}

export interface Board {
  /** Tiles in physical order, left end first. */
  line: PlacedTile[];
  leftEnd: Pip;
  rightEnd: Pip;
}

export type Move =
  | { kind: 'pose'; seat: number; tile: TileId }
  | { kind: 'play'; seat: number; tile: TileId; end: End }
  | { kind: 'draw'; seat: number; tile: TileId }
  /**
   * `ends` is stamped by the engine when the pass is applied. A pass is the
   * highest-value inference in the game — it proves the passer held nothing
   * matching either open end at that moment — so we record the evidence on
   * the move rather than reconstructing it by replaying the board.
   */
  | { kind: 'pass'; seat: number; ends?: [Pip, Pip] };

export type HandStatus = 'active' | 'domino' | 'blocked';

export interface HandResult {
  status: 'domino' | 'blocked';
  /** Seat that emptied its hand, or the lowest individual count in a block. */
  winnerSeat: number | null;
  /** Null when a blocked hand ties on lowest individual count. */
  winnerSide: number | null;
  tie: boolean;
  /** Pip count remaining per seat at the moment the hand ended. */
  counts: number[];
}

export interface HandState {
  seatCount: number;
  mode: GameMode;
  /** Tiles held, indexed by seat. */
  hands: TileId[][];
  boneyard: TileId[];
  board: Board | null;
  /** Seat to act. */
  turn: number;
  /** Consecutive passes; equals seatCount when the board is blocked. */
  consecutivePasses: number;
  moveLog: Move[];
  status: HandStatus;
  result: HandResult | null;
  /**
   * When true the poser must lead the 6-6 specifically. Set on the opening
   * hand of a set in tournament mode, and on every hand that follows a bruk,
   * a tied replay, or a one-all playoff.
   */
  poseMustBeDoubleSix: boolean;
  /** Seat that poses this hand. */
  poser: number;
}

export interface SetOptions {
  mode: GameMode;
  format: SetFormat;
  seatCount: 2 | 3 | 4;
  /**
   * Tournament mode forces the 6-6 holder to actually LEAD the 6-6 on the
   * opening hand. Casual mode allows that player to declare "sporting" and
   * open with any tile instead.
   */
  tournament: boolean;
  /** At 1-1, play a two-point playoff hand instead of bruking to 0-0. */
  oneAllPlayTwo: boolean;
  /** 2-player only: deal 7 each and leave a boneyard rather than 14 each. */
  useBoneyard: boolean;
  target: number;
}

export interface SetState {
  options: SetOptions;
  /** One entry per SIDE. Partner: 2 sides. Cutthroat: one side per seat. */
  scores: number[];
  /**
   * Points the next hand is worth. Normally 1. Escalates on tied blocked
   * hands (2, 3, 4...) and is set to 2 for a one-all playoff.
   */
  handValue: number;
  poser: number;
  poseMustBeDoubleSix: boolean;
  /** True while a one-all playoff hand is being played. */
  playoff: boolean;
  handsPlayed: number;
  winnerSide: number | null;
  /** Set when the winning side took it six-love, i.e. every opponent on zero. */
  sixLove: boolean;
}
