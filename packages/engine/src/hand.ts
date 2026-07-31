import {
  tileCount,
  DOUBLE_SIX,
  dealPlan,
  handCount,
  halves,
  isDouble,
  matches,
  nextSeat,
  otherHalf,
  sideOf,
} from './tiles.ts';
import type {
  AnyBoard,
  Board,
  CrossBoard,
  CrossArm,
  End,
  GameMode,
  HandResult,
  HandState,
  Move,
  Pip,
  SetFormat,
  TileId,
} from './types.ts';

const ARM_DIRECTIONS: CrossArm['direction'][] = ['right', 'left', 'up', 'down'];

/** Deep-copy either board shape; null passes through. */
function cloneBoard(board: AnyBoard | null): AnyBoard | null {
  if (!board) return null;
  if (board.kind === 'linear') {
    return {
      kind: 'linear',
      line: board.line.map((p) => ({ ...p })),
      leftEnd: board.leftEnd,
      rightEnd: board.rightEnd,
    };
  }
  return {
    kind: 'cross',
    center: board.center,
    arms: board.arms.map((a) => ({ ...a, tiles: a.tiles.map((p) => ({ ...p })) })),
    suitLed: [...board.suitLed],
  };
}

/** Every currently-open pip on the board, regardless of board shape. */
export function openEnds(board: AnyBoard): Pip[] {
  return board.kind === 'linear'
    ? [board.leftEnd, board.rightEnd]
    : board.arms.map((a) => a.openEnd);
}

export interface DealInput {
  order: TileId[];
  seatCount: 2 | 3 | 4;
  mode: GameMode;
  useBoneyard: boolean;
  /** Poser for this hand. Ignored when poseMustBeDoubleSix is set. */
  poser?: number;
  poseMustBeDoubleSix: boolean;
  /**
   * Which tile must lead the opening pose when poseMustBeDoubleSix is true.
   * Defaults to 6-6 for every format except French, where it's the chucha
   * (0-0). If nobody holds the requested tile, the engine falls back to
   * highest-double / heaviest-tile just as it does for a missing 6-6.
   */
  openingTile?: TileId;
  /** Format defaults to 'sixlove'. Only 'french' changes engine behavior. */
  format?: SetFormat;
}

export function findOpeningHolder(hands: TileId[][], openingTile: TileId): number {
  return hands.findIndex((h) => h.includes(openingTile));
}

/**
 * Who opens the hand.
 *
 * Normally the holder of the required opening tile (6-6 for sixlove /
 * firstToSix, 0-0 for French). If the tile wasn't dealt at all — as can
 * happen in the two-hander played with a boneyard — the convention is that
 * the highest double opens, falling back to the heaviest tile if nobody
 * holds one.
 */
export function findOpener(
  hands: TileId[][],
  openingTile: TileId = DOUBLE_SIX,
): { seat: number; canForceOpening: boolean } {
  const held = findOpeningHolder(hands, openingTile);
  if (held >= 0) return { seat: held, canForceOpening: true };

  let bestSeat = 0;
  let bestScore = -1;
  hands.forEach((hand, seat) => {
    for (const tile of hand) {
      // Doubles outrank everything; among equals, the heavier tile wins.
      const score = (isDouble(tile) ? 100 : 0) + tileCount(tile);
      if (score > bestScore) {
        bestScore = score;
        bestSeat = seat;
      }
    }
  });
  return { seat: bestSeat, canForceOpening: false };
}

export function deal(input: DealInput): HandState {
  const { perPlayer } = dealPlan(input.seatCount, input.useBoneyard);
  const hands: TileId[][] = [];
  for (let s = 0; s < input.seatCount; s++) {
    hands.push(input.order.slice(s * perPlayer, (s + 1) * perPlayer));
  }
  const boneyard = input.order.slice(input.seatCount * perPlayer);

  // When the score is fresh, has just bruk, or a replay is due, the hand is
  // opened by whoever holds the required opening tile (6-6 for standard
  // play, 0-0 for French) — not by the previous winner.
  const openingTile = input.openingTile ?? DOUBLE_SIX;
  const opener = findOpener(hands, openingTile);
  const openerLed = input.poseMustBeDoubleSix || input.poser === undefined;
  const poser = openerLed ? opener.seat : input.poser!;
  // Can't force a lead of a tile nobody was dealt.
  const forceOpening = input.poseMustBeDoubleSix && opener.canForceOpening;

  return {
    seatCount: input.seatCount,
    mode: input.mode,
    hands,
    boneyard,
    board: null,
    turn: poser,
    consecutivePasses: 0,
    moveLog: [],
    status: 'active',
    result: null,
    poseMustBeDoubleSix: forceOpening,
    openingTile,
    poser,
    format: input.format ?? 'sixlove',
  };
}

function clone(s: HandState): HandState {
  return {
    ...s,
    hands: s.hands.map((h) => [...h]),
    boneyard: [...s.boneyard],
    board: cloneBoard(s.board),
    moveLog: [...s.moveLog],
    result: s.result ? { ...s.result, counts: [...s.result.counts] } : null,
  };
}

/** Every move the seat on turn may legally make. */
export function legalMoves(s: HandState): Move[] {
  if (s.status !== 'active') return [];
  const seat = s.turn;
  const hand = s.hands[seat];

  // Opening the hand.
  if (s.board === null) {
    if (s.poseMustBeDoubleSix) {
      // Tournament / post-bruk / French-round-1 opening: the required
      // opening tile must actually be led, not merely held. "Sporting" is
      // not available here. Field name is legacy — the tile is openingTile,
      // 6-6 outside French, 0-0 inside it.
      return hand.includes(s.openingTile) ? [{ kind: 'pose', seat, tile: s.openingTile }] : [];
    }
    // Casual opening, or any hand opened by the previous winner: any tile.
    return hand.map((tile) => ({ kind: 'pose', seat, tile }) as Move);
  }

  const plays: Move[] = s.board.kind === 'cross'
    ? crossLegalPlays(hand, s.board, seat)
    : linearLegalPlays(hand, s.board, seat);
  if (plays.length > 0) return plays;

  // Nothing playable. Draw if there is a boneyard, otherwise pass.
  if (s.boneyard.length > 0) return [{ kind: 'draw', seat, tile: s.boneyard[0] }];
  return [{ kind: 'pass', seat }];
}

function linearLegalPlays(hand: TileId[], board: Board, seat: number): Move[] {
  const plays: Move[] = [];
  for (const tile of hand) {
    if (matches(tile, board.leftEnd)) plays.push({ kind: 'play', seat, tile, end: 'left' });
    if (matches(tile, board.rightEnd)) plays.push({ kind: 'play', seat, tile, end: 'right' });
  }
  return plays;
}

/**
 * French cross-board legal plays.
 *
 * Filling phase (arms.length < 4): must play a tile with a blank half. Each
 * such play creates the next arm attached to a chucha corner. Because blank
 * is already in suitLed (the chucha IS the double-blank), the suit-led rule
 * is satisfied automatically.
 *
 * Post-fill: each arm exposes its openEnd. A tile with a matching half is
 * legal on that arm iff either the tile IS the double of that suit (i.e.
 * leads the suit) OR the suit is already in board.suitLed. This is the
 * "doubles must lead" rule from the JamDom tutorial — until a suit's double
 * is on the board, only the double itself can play on an arm exposing that
 * suit.
 */
function crossLegalPlays(hand: TileId[], board: CrossBoard, seat: number): Move[] {
  const plays: Move[] = [];
  if (board.arms.length < 4) {
    const armIdx = board.arms.length;
    for (const tile of hand) {
      const [a, b] = halves(tile);
      if (a === 0 || b === 0) plays.push({ kind: 'playcross', seat, tile, arm: armIdx });
    }
    return plays;
  }
  for (let armIdx = 0; armIdx < board.arms.length; armIdx++) {
    const arm = board.arms[armIdx];
    for (const tile of hand) {
      if (!matches(tile, arm.openEnd)) continue;
      const isSuitLed = board.suitLed.includes(arm.openEnd);
      const isSuitDouble = isDouble(tile) && halves(tile)[0] === arm.openEnd;
      if (isSuitDouble || isSuitLed) {
        plays.push({ kind: 'playcross', seat, tile, arm: armIdx });
      }
    }
  }
  return plays;
}

function sameMove(a: Move, b: Move): boolean {
  if (a.kind !== b.kind || a.seat !== b.seat) return false;
  if (a.kind === 'pass' || b.kind === 'pass') return true;
  if ('tile' in a && 'tile' in b && a.tile !== b.tile) return false;
  if (a.kind === 'play' && b.kind === 'play') return a.end === b.end;
  if (a.kind === 'playcross' && b.kind === 'playcross') return a.arm === b.arm;
  return true;
}

export function isLegal(s: HandState, move: Move): boolean {
  return legalMoves(s).some((m) => sameMove(m, move));
}

function place(board: Board, tile: TileId, end: End): Board {
  const anchor = end === 'left' ? board.leftEnd : board.rightEnd;
  const exposed = otherHalf(tile, anchor);
  const placed = { tile, crosswise: isDouble(tile) };
  return end === 'left'
    ? { kind: 'linear', line: [placed, ...board.line], leftEnd: exposed, rightEnd: board.rightEnd }
    : { kind: 'linear', line: [...board.line, placed], leftEnd: board.leftEnd, rightEnd: exposed };
}

/**
 * Apply a French cross-board play. Filling phase (arm === arms.length)
 * creates a new arm; post-fill extends an existing arm. In both cases we
 * update suitLed when a double is played, because that suit is now "led".
 */
function placeCross(board: CrossBoard, tile: TileId, armIdx: number): CrossBoard {
  const placed = { tile, crosswise: isDouble(tile) };
  const [a, b] = halves(tile);
  if (armIdx === board.arms.length) {
    // Filling phase: attach to chucha via blank half; other half is exposed.
    const exposed = (a === 0 ? b : a) as Pip;
    const newArm: CrossArm = {
      direction: ARM_DIRECTIONS[armIdx],
      tiles: [placed],
      openEnd: exposed,
    };
    const suitLed = isDouble(tile) && !board.suitLed.includes(exposed)
      ? [...board.suitLed, exposed] : board.suitLed;
    return { ...board, arms: [...board.arms, newArm], suitLed };
  }
  const arm = board.arms[armIdx];
  const exposed = otherHalf(tile, arm.openEnd);
  const nextArm: CrossArm = {
    ...arm,
    tiles: [...arm.tiles, placed],
    openEnd: exposed,
  };
  // A double leads its own suit (openEnd unchanged); non-doubles never lead.
  // The suit we may newly lead is the openEnd BEFORE this play — i.e. the
  // suit the arm was already exposing when the double was placed on it.
  const ledSuit = arm.openEnd;
  const suitLed = isDouble(tile) && !board.suitLed.includes(ledSuit)
    ? [...board.suitLed, ledSuit] : board.suitLed;
  const arms = board.arms.map((a2, i) => i === armIdx ? nextArm : a2);
  return { ...board, arms, suitLed };
}

function resolve(s: HandState, status: 'domino' | 'blocked'): HandResult {
  const counts = s.hands.map(handCount);
  // Per-seat "did this seat end the hand still holding any double?" — used
  // by French scoring to double that seat's pips. Other formats ignore it.
  const doublesRemaining = s.hands.map((h) => h.some(isDouble));

  if (status === 'domino') {
    const seat = s.hands.findIndex((h) => h.length === 0);
    return {
      status,
      winnerSeat: seat,
      winnerSide: sideOf(seat, s.mode),
      tie: false,
      counts,
      doublesRemaining,
    };
  }

  // Blocked board.
  //
  // THE RULE MOST APPS GET WRONG: the hand goes to the player whose OWN tiles
  // have the lowest pip count, and in Partner his TEAM wins on that basis
  // alone. His partner's tiles are irrelevant. A team can win a blocked hand
  // while holding more total pips than the opposition.
  const lowest = Math.min(...counts);
  const tied = counts.filter((c) => c === lowest).length > 1;
  if (tied) {
    return { status, winnerSeat: null, winnerSide: null, tie: true, counts, doublesRemaining };
  }
  const seat = counts.indexOf(lowest);
  return {
    status, winnerSeat: seat, winnerSide: sideOf(seat, s.mode), tie: false, counts,
    doublesRemaining,
  };
}

export function applyMove(prev: HandState, move: Move): HandState {
  if (prev.status !== 'active') throw new Error('hand is already over');
  if (move.seat !== prev.turn) throw new Error(`not seat ${move.seat}'s turn`);
  if (!isLegal(prev, move)) throw new Error(`illegal move: ${JSON.stringify(move)}`);

  const s = clone(prev);
  // Stamp the evidence onto a pass at the moment it happens.
  const logged: Move =
    move.kind === 'pass' && s.board
      ? { kind: 'pass', seat: move.seat, ends: openEnds(s.board) }
      : move;
  s.moveLog.push(logged);

  switch (move.kind) {
    case 'pose': {
      const [a, b] = halves(move.tile);
      s.hands[move.seat] = s.hands[move.seat].filter((t) => t !== move.tile);
      // French round-1 chucha pose builds the cross board; standard poses
      // build a linear board. A non-chucha pose in French (openingTile
      // fallback) still uses the linear board — French cross rules require
      // the chucha specifically as centre.
      if (s.format === 'french' && move.tile === '0-0') {
        s.board = { kind: 'cross', center: move.tile, arms: [], suitLed: [0] };
      } else {
        s.board = {
          kind: 'linear',
          line: [{ tile: move.tile, crosswise: isDouble(move.tile) }],
          leftEnd: a as Pip,
          rightEnd: b as Pip,
        };
      }
      s.consecutivePasses = 0;
      break;
    }
    case 'play': {
      if (!s.board || s.board.kind !== 'linear') throw new Error('play requires linear board');
      s.hands[move.seat] = s.hands[move.seat].filter((t) => t !== move.tile);
      s.board = place(s.board, move.tile, move.end);
      s.consecutivePasses = 0;
      break;
    }
    case 'playcross': {
      if (!s.board || s.board.kind !== 'cross') throw new Error('playcross requires cross board');
      s.hands[move.seat] = s.hands[move.seat].filter((t) => t !== move.tile);
      s.board = placeCross(s.board, move.tile, move.arm);
      s.consecutivePasses = 0;
      break;
    }
    case 'draw': {
      const tile = s.boneyard.shift()!;
      s.hands[move.seat].push(tile);
      // Drawing does not end the turn — the seat acts again.
      return s;
    }
    case 'pass': {
      s.consecutivePasses += 1;
      break;
    }
  }

  if (s.hands[move.seat].length === 0) {
    s.status = 'domino';
    s.result = resolve(s, 'domino');
    return s;
  }
  if (s.consecutivePasses >= s.seatCount) {
    s.status = 'blocked';
    s.result = resolve(s, 'blocked');
    return s;
  }

  s.turn = nextSeat(s.turn, s.seatCount);
  return s;
}

/**
 * Which suits a seat is now KNOWN to be void in, derived from its passes.
 *
 * A pass is permanent information: at the moment a player passes he holds
 * nothing matching either open end, and nothing he draws later can undo what
 * that pass revealed about the tiles he held at the time. This is the single
 * highest-value inference in the game and the engine exposes it so the Coach
 * and the stronger duppies can both use it.
 */
export function knownVoids(s: HandState): Set<Pip>[] {
  const voids: Set<Pip>[] = Array.from({ length: s.seatCount }, () => new Set<Pip>());
  for (const move of s.moveLog) {
    if (move.kind === 'pass' && move.ends) {
      for (const p of move.ends) voids[move.seat].add(p);
    }
  }
  return voids;
}
