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

/**
 * `openhand` is partner mode with one visibility change: each seat sees its
 * partner's tiles. Everything else about pairing, play order, format, and
 * scoring is identical to `partner`. Use `isPartnered(mode)` from tiles.ts
 * anywhere the code branches on "is this a paired game" — a bare
 * `mode === 'partner'` comparison silently excludes openhand and is a bug.
 */
export type GameMode = 'cutthroat' | 'partner' | 'openhand';

/**
 * sixlove     — six consecutive wins while every opponent stays at zero.
 *               A win by a side on zero BRUKS the score back to 0-0.
 * firstToSix  — best of six. Plain race to six, no reset.
 * single      — one hand, one winner. Used for drills.
 * french      — race to 100 where LOWER is better. Losers add their remaining
 *               pip count to their own running total (doubles left in hand
 *               double that hand's score). First seat to hit target loses;
 *               winner is the seat with the lowest score at that moment. The
 *               chucha (0-0) opens round 1 and sits at the centre of a
 *               4-armed cross board (see CrossBoard below) — this REPLACES
 *               the earlier linear-French shim. Coin-tied shuffle-at-50 and
 *               the +10 pass penalty are still deferred to phase 3.
 */
export type SetFormat = 'sixlove' | 'firstToSix' | 'single' | 'french';

export type End = 'left' | 'right';

export interface PlacedTile {
  tile: TileId;
  /** True when laid crosswise (a double). Cosmetic in standard play. */
  crosswise: boolean;
}

export interface Board {
  kind: 'linear';
  /** Tiles in physical order, left end first. */
  line: PlacedTile[];
  leftEnd: Pip;
  rightEnd: Pip;
}

/**
 * One arm of a French cross board, extending outward from the centre tile.
 * Arms are fixed at right (0), left (1), up (2), down (3) in fill order.
 * openEnd is the pip currently exposed at the far end of the arm.
 */
export interface CrossArm {
  direction: 'right' | 'left' | 'up' | 'down';
  tiles: PlacedTile[];
  openEnd: Pip;
}

/**
 * French cross board. The chucha (0-0) sits in the centre; up to 4 arms
 * extend outward, one per blank corner of the chucha.
 *
 * suitLed tracks which suits' doubles have been played anywhere on the board.
 * Once a suit's double is down, non-doubles of that suit are legal on any arm
 * whose openEnd matches. Until then only the double itself can play on such
 * an arm — this is the "doubles run tings" rule. Blank (0) starts in the set
 * because the chucha IS the double-blank.
 */
export interface CrossBoard {
  kind: 'cross';
  center: TileId;
  arms: CrossArm[];
  suitLed: Pip[];
}

export type AnyBoard = Board | CrossBoard;

export type Move =
  | { kind: 'pose'; seat: number; tile: TileId }
  | { kind: 'play'; seat: number; tile: TileId; end: End }
  /**
   * French cross-board play. arm is an index into CrossBoard.arms. During the
   * filling phase (arms.length < 4) arm equals arms.length — the engine
   * appends a new arm attached to the chucha. Post-fill arm is 0..3.
   */
  | { kind: 'playcross'; seat: number; tile: TileId; arm: number }
  | { kind: 'draw'; seat: number; tile: TileId }
  /**
   * `ends` is stamped by the engine when the pass is applied. A pass is the
   * highest-value inference in the game — it proves the passer held nothing
   * matching either open end at that moment — so we record the evidence on
   * the move rather than reconstructing it by replaying the board. For a
   * cross-board pass, `ends` is a list of the currently open pips across
   * however many arms exist (0-4).
   */
  | { kind: 'pass'; seat: number; ends?: Pip[] };

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
  /**
   * True at each seat that still held any double when the hand ended. French
   * doubles the pip count of a seat left with any double, so this is the
   * per-seat flag scoring needs; other formats ignore the field. Made optional
   * so old fixtures still typecheck.
   */
  doublesRemaining?: boolean[];
}

export interface HandState {
  seatCount: number;
  mode: GameMode;
  /** Tiles held, indexed by seat. */
  hands: TileId[][];
  boneyard: TileId[];
  board: AnyBoard | null;
  /**
   * Only used for French. The engine needs to know the format to build a
   * CrossBoard on the chucha pose and to branch legalMoves/applyMove on cross
   * rules. Defaults are set in deal().
   */
  format: SetFormat;
  /** Seat to act. */
  turn: number;
  /** Consecutive passes; equals seatCount when the board is blocked. */
  consecutivePasses: number;
  moveLog: Move[];
  status: HandStatus;
  result: HandResult | null;
  /**
   * When true the poser must lead the OPENING TILE specifically (see
   * openingTile below). Set on the opening hand of a set in tournament mode,
   * on every hand that follows a bruk, a tied replay, a one-all playoff, and
   * always on round 1 of a French set. The field is misnamed for legacy DB
   * reasons — the actual tile is openingTile, not necessarily 6-6.
   */
  poseMustBeDoubleSix: boolean;
  /**
   * The tile the poser must lead when poseMustBeDoubleSix is true. Defaults
   * to 6-6 for every format except French, where round 1 is opened by the
   * chucha (0-0) holder leading the 0-0. Derived from format at rehydration
   * time; not persisted to the DB.
   */
  openingTile: TileId;
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
