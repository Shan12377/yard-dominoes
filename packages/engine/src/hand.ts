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
  Board,
  End,
  GameMode,
  HandResult,
  HandState,
  Move,
  Pip,
  TileId,
} from './types.ts';

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
  };
}

function clone(s: HandState): HandState {
  return {
    ...s,
    hands: s.hands.map((h) => [...h]),
    boneyard: [...s.boneyard],
    board: s.board ? { line: s.board.line.map((p) => ({ ...p })), leftEnd: s.board.leftEnd, rightEnd: s.board.rightEnd } : null,
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

  const plays: Move[] = [];
  for (const tile of hand) {
    if (matches(tile, s.board.leftEnd)) plays.push({ kind: 'play', seat, tile, end: 'left' });
    if (matches(tile, s.board.rightEnd)) plays.push({ kind: 'play', seat, tile, end: 'right' });
  }
  if (plays.length > 0) return plays;

  // Nothing playable. Draw if there is a boneyard, otherwise pass.
  if (s.boneyard.length > 0) return [{ kind: 'draw', seat, tile: s.boneyard[0] }];
  return [{ kind: 'pass', seat }];
}

function sameMove(a: Move, b: Move): boolean {
  if (a.kind !== b.kind || a.seat !== b.seat) return false;
  if (a.kind === 'pass' || b.kind === 'pass') return true;
  if ('tile' in a && 'tile' in b && a.tile !== b.tile) return false;
  if (a.kind === 'play' && b.kind === 'play') return a.end === b.end;
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
    ? { line: [placed, ...board.line], leftEnd: exposed, rightEnd: board.rightEnd }
    : { line: [...board.line, placed], leftEnd: board.leftEnd, rightEnd: exposed };
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
      ? { kind: 'pass', seat: move.seat, ends: [s.board.leftEnd, s.board.rightEnd] }
      : move;
  s.moveLog.push(logged);

  switch (move.kind) {
    case 'pose': {
      const [a, b] = halves(move.tile);
      s.hands[move.seat] = s.hands[move.seat].filter((t) => t !== move.tile);
      s.board = {
        line: [{ tile: move.tile, crosswise: isDouble(move.tile) }],
        leftEnd: a as Pip,
        rightEnd: b as Pip,
      };
      s.consecutivePasses = 0;
      break;
    }
    case 'play': {
      s.hands[move.seat] = s.hands[move.seat].filter((t) => t !== move.tile);
      s.board = place(s.board!, move.tile, move.end);
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
      voids[move.seat].add(move.ends[0]);
      voids[move.seat].add(move.ends[1]);
    }
  }
  return voids;
}
