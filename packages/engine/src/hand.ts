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

/**
 * Deep-copy either board shape; null passes through.
 *
 * Checks `=== 'cross'` and falls back to linear, NOT the other way round.
 * Every `hands.board`/`hand_public.board` row written before the cross
 * board shipped has no `kind` field at all — `undefined`. Checking
 * `=== 'linear'` and defaulting to cross would send every such legacy row
 * into the cross branch, which reads `board.arms` off an object that
 * doesn't have one and throws. Linear is the historical shape; it must be
 * the default a missing tag falls back to, not the exceptional case.
 */
function cloneBoard(board: AnyBoard | null): AnyBoard | null {
  if (!board) return null;
  if (board.kind === 'cross') {
    return {
      kind: 'cross',
      center: board.center,
      arms: board.arms.map((a) => ({ ...a, tiles: a.tiles.map((p) => ({ ...p })) })),
      // Legacy rows dealt before doublesPlayed shipped have no such field —
      // same defensive default as the kind check above.
      doublesPlayed: [...(board.doublesPlayed ?? [])],
    };
  }
  return {
    kind: 'linear',
    line: board.line.map((p) => ({ ...p })),
    leftEnd: board.leftEnd,
    rightEnd: board.rightEnd,
  };
}

/**
 * Every currently-open pip on the board, regardless of board shape.
 *
 * Same legacy-data hazard as `cloneBoard` — checks `=== 'cross'` and
 * defaults to linear, so a pre-cross-board row (no `kind` field) reads
 * its real `leftEnd`/`rightEnd` instead of crashing on a missing `arms`.
 */
export function openEnds(board: AnyBoard): Pip[] {
  return board.kind === 'cross'
    ? board.arms.map((a) => a.openEnd)
    : [board.leftEnd, board.rightEnd];
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
  /**
   * French, round 2 onward: `poser` names who is NOMINALLY due to pose (the
   * previous hand's winner), but they must lead some double they hold, not
   * a specific tile. If they hold none, deal() searches seat order from
   * them for the first seat that does, reassigns `poser` to that seat, and
   * fines the original 10 points (folded into the returned HandState's own
   * `penalties`, same as every other French penalty). Never combine with
   * poseMustBeDoubleSix — that one forces a SPECIFIC tile (round 1's
   * chucha, or a tie-break reshuffle), this forces ANY double.
   */
  poseMustBeAnyDouble?: boolean;
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
  const penalties = new Array(input.seatCount).fill(0);
  const openingTile = input.openingTile ?? DOUBLE_SIX;

  let poser: number;
  let forceOpening: boolean;

  if (input.poseMustBeAnyDouble) {
    // French, round 2+: the nominal poser (the previous winner) must lead
    // SOME double they hold — free choice among however many they have. If
    // they hold none, seat order from them decides who actually poses, and
    // the nominal poser is fined for it.
    const nominal = input.poser ?? 0;
    let found = -1;
    for (let i = 0; i < input.seatCount; i++) {
      const seat = (nominal + i) % input.seatCount;
      if (hands[seat].some(isDouble)) { found = seat; break; }
    }
    // found < 0 only if nobody at the table holds a double at all —
    // vanishingly rare (a 28-tile set always has 7), but never strand a
    // live table on it: fall back to the nominal poser, who legalMoves()'s
    // own defensive fallback then lets open with anything.
    poser = found >= 0 ? found : nominal;
    if (found >= 0 && found !== nominal) penalties[nominal] += 10;
    forceOpening = false;
  } else {
    // When the score is fresh, has just bruk, or a replay is due, the hand
    // is opened by whoever holds the required opening tile (6-6 for
    // standard play, 0-0 for French) — not by the previous winner.
    const opener = findOpener(hands, openingTile);
    const openerLed = input.poseMustBeDoubleSix || input.poser === undefined;
    poser = openerLed ? opener.seat : input.poser!;
    // Can't force a lead of a tile nobody was dealt.
    forceOpening = input.poseMustBeDoubleSix && opener.canForceOpening;
  }

  return {
    seatCount: input.seatCount,
    mode: input.mode,
    hands,
    boneyard,
    board: null,
    turn: poser,
    consecutivePasses: 0,
    moveLog: [],
    penalties,
    status: 'active',
    result: null,
    poseMustBeDoubleSix: forceOpening,
    poseMustBeAnyDouble: !!input.poseMustBeAnyDouble,
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
    penalties: [...s.penalties],
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
    if (s.poseMustBeAnyDouble) {
      // French, round 2+: deal() already searched for a seat holding a
      // double before assigning `poser` — this seat holding none should be
      // unreachable — but never strand a live table on an invariant a
      // caller could theoretically violate; fall through to any tile
      // rather than returning zero legal moves.
      const doubles = hand.filter((t) => isDouble(t));
      if (doubles.length > 0) {
        return doubles.map((tile) => ({ kind: 'pose', seat, tile }) as Move);
      }
    }
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
 * Filling phase (arms.length < 4): must play a tile with a half matching the
 * centre's own pip value (the chucha's blank in round 1, or whatever double
 * the winner posed in round 2+ — see HandState.poseMustBeAnyDouble). Each
 * such play creates the next arm attached to a centre corner.
 *
 * Post-fill: each arm exposes its own openEnd. A tile with a matching half is
 * legal on that arm iff either the tile IS the double of that suit (i.e.
 * leads it right now) OR that suit's double has already been played anywhere
 * on the board this hand (board.doublesPlayed) — once a suit's double lands,
 * every tile of that suit is live on every arm showing it, for the rest of
 * the hand. See CrossBoard.doublesPlayed.
 */
function crossLegalPlays(hand: TileId[], board: CrossBoard, seat: number): Move[] {
  const plays: Move[] = [];
  const centerValue = halves(board.center)[0]; // center is always a double
  if (board.arms.length < 4) {
    const armIdx = board.arms.length;
    for (const tile of hand) {
      const [a, b] = halves(tile);
      if (a === centerValue || b === centerValue) plays.push({ kind: 'playcross', seat, tile, arm: armIdx });
    }
    return plays;
  }
  for (let armIdx = 0; armIdx < board.arms.length; armIdx++) {
    const arm = board.arms[armIdx];
    for (const tile of hand) {
      if (!matches(tile, arm.openEnd)) continue;
      const isSuitDouble = isDouble(tile) && halves(tile)[0] === arm.openEnd;
      if (isSuitDouble || board.doublesPlayed.includes(arm.openEnd)) {
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
 * creates a new arm. Post-fill extends an existing arm and, when the play IS
 * a double, adds its value to board.doublesPlayed — a board-wide unlock, not
 * scoped to this arm; see CrossBoard.doublesPlayed. There is only one copy
 * of any double, so this can only ever add a value once per hand.
 */
function placeCross(board: CrossBoard, tile: TileId, armIdx: number): CrossBoard {
  const placed = { tile, crosswise: isDouble(tile) };
  const [a, b] = halves(tile);
  if (armIdx === board.arms.length) {
    // Filling phase: attach to the centre via the matching half; the other
    // half is exposed.
    const centerValue = halves(board.center)[0];
    const exposed = (a === centerValue ? b : a) as Pip;
    const newArm: CrossArm = {
      direction: ARM_DIRECTIONS[armIdx],
      tiles: [placed],
      openEnd: exposed,
    };
    return { ...board, arms: [...board.arms, newArm] };
  }
  const arm = board.arms[armIdx];
  const exposed = otherHalf(tile, arm.openEnd);
  const nextArm: CrossArm = { ...arm, tiles: [...arm.tiles, placed], openEnd: exposed };
  const arms = board.arms.map((a2, i) => i === armIdx ? nextArm : a2);
  const doublesPlayed = isDouble(tile) && !board.doublesPlayed.includes(arm.openEnd)
    ? [...board.doublesPlayed, arm.openEnd]
    : board.doublesPlayed;
  return { ...board, arms, doublesPlayed };
}

function resolve(s: HandState, status: 'domino' | 'blocked', winnerPlayedDouble = false): HandResult {
  const counts = s.hands.map(handCount);
  // Per-seat "did this seat end the hand still holding any double?" — used
  // by French scoring to double that seat's pips. Other formats ignore it.
  const doublesRemaining = s.hands.map((h) => h.some(isDouble));
  const penalties = [...s.penalties];

  if (status === 'domino') {
    const seat = s.hands.findIndex((h) => h.length === 0);
    return {
      status,
      winnerSeat: seat,
      winnerSide: sideOf(seat, s.mode),
      tie: false,
      counts,
      doublesRemaining,
      winnerPlayedDouble,
      penalties,
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
    return {
      status, winnerSeat: null, winnerSide: null, tie: true, counts, doublesRemaining, penalties,
    };
  }
  const seat = counts.indexOf(lowest);
  return {
    status, winnerSeat: seat, winnerSide: sideOf(seat, s.mode), tie: false, counts,
    doublesRemaining, penalties,
  };
}

/**
 * True the instant a just-applied board-changing move leaves EVERY other
 * seat with no legal response — the "board pass" case: pagat's French rules
 * score +10 against each of those seats. Probed with a stub `turn`, same
 * trick bots.ts uses to enumerate one seat's options without touching whose
 * turn it "really" is.
 */
function blocksEveryoneElse(s: HandState, mover: number): boolean {
  for (let seat = 0; seat < s.seatCount; seat++) {
    if (seat === mover) continue;
    const options = legalMoves({ ...s, turn: seat });
    if (!options.every((m) => m.kind === 'pass')) return false;
  }
  return true;
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
      // Every French pose is a double — round 1 forces the chucha
      // specifically (poseMustBeDoubleSix + openingTile '0-0'), round 2+
      // forces the winner's own choice of double (poseMustBeAnyDouble) —
      // so any French pose builds a fresh cross centred on whatever was
      // posed, not just the chucha. Per pagat.com/domino/cross/french.html,
      // "the first double played [in a hand] acts as a spinner" generally,
      // not only the double-blank.
      if (s.format === 'french' && isDouble(move.tile)) {
        // The centre tile IS that value's double, physically on the board —
        // seed doublesPlayed with it so an arm that later cycles back to
        // exposing the centre's own value doesn't wrongly need a second
        // copy of a double that can't exist.
        s.board = { kind: 'cross', center: move.tile, arms: [], doublesPlayed: [a as Pip] };
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
      // `=== 'cross'`, not `!== 'linear'` — a legacy board row (no `kind`
      // field, every row written before the cross board shipped) must fall
      // through to linear here too, matching legalMoves' dispatch. The
      // exact-match guard would reject a legal 'play' move against every
      // pre-existing hand with "play requires linear board".
      if (!s.board || s.board.kind === 'cross') throw new Error('play requires linear board');
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
      // French: a seat's own third real pass in a row (every legal-move
      // check already forces a pass only when nothing else was playable, so
      // every pass here is by definition "real") costs 10 points. Read off
      // the seat's own trailing moves rather than a separate counter — same
      // derive-from-moveLog approach knownVoids() already uses.
      if (s.format === 'french') {
        const own = s.moveLog.filter((m) => m.seat === move.seat);
        const last3 = own.slice(-3);
        if (last3.length === 3 && last3.every((m) => m.kind === 'pass')) {
          s.penalties[move.seat] += 10;
        }
      }
      break;
    }
  }

  // French "board pass": a pose/play/playcross that leaves every OTHER seat
  // with nothing to answer costs each of them 10 points, on top of however
  // the hand itself resolves. Checked before the domino/blocked branches
  // below so it still fires even when this same move happens to end the
  // hand outright. `draw` already returned above, so only pose/play/
  // playcross/pass reach here.
  if (s.format === 'french' && move.kind !== 'pass' && blocksEveryoneElse(s, move.seat)) {
    for (let seat = 0; seat < s.seatCount; seat++) {
      if (seat !== move.seat) s.penalties[seat] += 10;
    }
  }

  if (s.hands[move.seat].length === 0) {
    s.status = 'domino';
    s.result = resolve(s, 'domino', 'tile' in move && isDouble(move.tile));
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
