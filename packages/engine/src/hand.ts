import {
  tileCount,
  DOUBLE_SIX,
  dealPlan,
  fullSet,
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
  PenaltyEvent,
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
   * Defaults to 6-6 for every format except French, where it's the double blank
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
   * double blank, or a tie-break reshuffle), this forces ANY double.
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
  const lastPenalties: PenaltyEvent[] = [];

  if (input.poseMustBeAnyDouble) {
    // French, round 2+: the previous winner poses a double of their choice.
    // If they hold none they are not skipped here: on their turn they are
    // fined 10 and ask someone to pose (an `askpose` move), and a seat asked
    // with no double is fined and asks again (owner, 2026-09-15).
    poser = input.poser ?? 0;
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
    lastPenalties,
    penaltyLog: [...lastPenalties],
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
    penaltyLog: [...(s.penaltyLog ?? [])],
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
      // French, round 2+: pose any double you hold. With none, ask a seat
      // that has not been asked yet (the winner and everyone who already
      // asked are out). Only if every seat has been asked, which a full
      // deal cannot reach, may this seat open with anything.
      const doubles = hand.filter((t) => isDouble(t));
      if (doubles.length > 0) {
        return doubles.map((tile) => ({ kind: 'pose', seat, tile }) as Move);
      }
      const asked = new Set(s.moveLog.flatMap((m) => m.kind === 'askpose' ? [m.seat] : []));
      asked.add(seat);
      const targets: Move[] = [];
      for (let i = 1; i < s.seatCount; i++) {
        const target = (seat + i) % s.seatCount;
        if (!asked.has(target)) targets.push({ kind: 'askpose', seat, target });
      }
      if (targets.length > 0) return targets;
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
 * centre's own pip value (the double blank's own blank in round 1, or whatever double
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
  if (a.kind === 'askpose' && b.kind === 'askpose') return a.target === b.target;
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
 * The KEY tile: `preBoard`'s two open ends need two DIFFERENT pip values and
 * `tile` is the one bone bearing both of them, closing the game.
 *
 * A board whose two ends share the SAME value is NOT a key, even when a lone
 * double is the only tile that could still play there. That exclusion is
 * unchanged.
 *
 * IT USED TO REQUIRE MORE, and that was wrong. It also demanded that no other
 * tile bearing either value remained anywhere off the board — "provably the
 * last bone in the set that could have closed either end", read off pagat.com.
 * The owner won a key in partner and was paid 1 (2026-09-12). Measured over
 * 3,000 simulated partner hands: the strict reading fires on 2.9% of wins
 * against 13.1% for this one, so it was rejecting roughly four key wins in
 * five. At a real table the key is the bone that shuts both ends when they
 * want different numbers; what is left in other people's hands is not part of
 * it, and cannot be, since nobody can see them.
 */
function isKeyTile(_postBoard: Board, preBoard: Board, tile: TileId): boolean {
  const l = preBoard.leftEnd;
  const r = preBoard.rightEnd;
  if (l === r) return false;
  const [a, b] = halves(tile);
  return (a === l && b === r) || (a === r && b === l);
}

/**
 * Apply a French cross-board play. Filling phase (arm === arms.length)
 * creates a new arm. Post-fill extends an existing arm and, when the play IS
 * a double, adds its value to board.doublesPlayed — a board-wide unlock, not
 * scoped to this arm; see CrossBoard.doublesPlayed. There is only one copy
 * of any double, so this can only ever add a value once per hand.
 */
function placeCross(board: CrossBoard, tile: TileId, armIdx: number, seat: number): CrossBoard {
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
      // Whoever laid the opening bone owns this arm's direction from here on.
      seat,
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

function resolve(
  s: HandState, status: 'domino' | 'blocked', winnerPlayedDouble = false, keyWin = false,
): HandResult {
  const counts = s.hands.map(handCount);
  // Per seat: does it still hold a double, and how many pips are on those
  // doubles? French counts a held double twice and nothing else in the hand;
  // other formats ignore both.
  const doublesRemaining = s.hands.map((h) => h.some(isDouble));
  const doublePips = s.hands.map((h) =>
    h.filter(isDouble).reduce((total, tile) => total + tileCount(tile), 0));
  const penalties = [...s.penalties];
  const penaltyLog = [...(s.penaltyLog ?? [])];

  if (status === 'domino') {
    const seat = s.hands.findIndex((h) => h.length === 0);
    return {
      status,
      winnerSeat: seat,
      winnerSide: sideOf(seat, s.mode),
      tie: false,
      counts,
      doublesRemaining,
      doublePips,
      winnerPlayedDouble,
      penalties,
      penaltyLog,
      keyWin,
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
      status, winnerSeat: null, winnerSide: null, tie: true, counts, doublesRemaining, doublePips, penalties,
      penaltyLog,
    };
  }
  const seat = counts.indexOf(lowest);
  return {
    status, winnerSeat: seat, winnerSide: sideOf(seat, s.mode), tie: false, counts,
    doublesRemaining, doublePips, penalties, penaltyLog,
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
  // A board pass needs the mover to be able to play again. If nobody at all
  // can answer the board, mover included, the hand is blocked and everyone
  // counts; that is not a board pass (owner, 2026-09-16).
  if (legalMoves({ ...s, turn: mover }).every((m) => m.kind === 'pass')) return false;
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
  // Fresh every call, never accumulated — see PenaltyEvent. Pushed into
  // below rather than reassigned, so `s.lastPenalties` stays this exact
  // array through every branch and both penalty sites end up in it.
  const penaltyEvents: PenaltyEvent[] = [];
  s.lastPenalties = penaltyEvents;
  // Set only by the 'play' case below, only when that play empties the
  // mover's hand — see isKeyTile.
  let keyWinTile = false;
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
      // Every French pose is a double — round 1 forces the double blank
      // specifically (poseMustBeDoubleSix + openingTile '0-0'), round 2+
      // forces the winner's own choice of double (poseMustBeAnyDouble) —
      // so any French pose builds a fresh cross centred on whatever was
      // posed, not just the double blank. Per pagat.com/domino/cross/french.html,
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
      const preBoard = s.board;
      s.hands[move.seat] = s.hands[move.seat].filter((t) => t !== move.tile);
      s.board = place(s.board, move.tile, move.end);
      s.consecutivePasses = 0;
      // Only matters if this play empties the hand — checked below once we
      // know the hand actually ended, so a non-winning play never pays for
      // the fullSet() scan.
      if (s.hands[move.seat].length === 0) {
        keyWinTile = isKeyTile(s.board, preBoard, move.tile);
      }
      break;
    }
    case 'playcross': {
      if (!s.board || s.board.kind !== 'cross') throw new Error('playcross requires cross board');
      s.hands[move.seat] = s.hands[move.seat].filter((t) => t !== move.tile);
      s.board = placeCross(s.board, move.tile, move.arm, move.seat);
      s.consecutivePasses = 0;
      break;
    }
    case 'askpose': {
      // No double to pose: fined 10, and the named seat is now due to pose.
      // Nothing else about the hand changes, so return before the board and
      // end-of-hand checks below.
      s.penalties[move.seat] += 10;
      penaltyEvents.push({ seat: move.seat, amount: 10, reason: 'no-double-to-pose' });
      s.penaltyLog = [...(s.penaltyLog ?? []), ...penaltyEvents];
      s.turn = move.target;
      return s;
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
        let own = s.moveLog.filter((m) => m.seat === move.seat);
        // A board pass resets the run (owner, 2026-09-15). The pass a seat
        // is forced into by a board pass is already fined 10 there, so
        // neither it nor any pass before it counts towards three in a row:
        // the next pass after it is the first of a new run. The board-pass
        // pass is always that seat's first move after the blocking move,
        // because every other seat has to pass it in turn.
        // Read from the saved move log (see Move.boardPass): the server
        // rebuilds each hand from it, so a separate state field was lost
        // between moves online.
        let boardPassAt = -1;
        for (let i = s.moveLog.length - 1; i >= 0; i--) {
          const m = s.moveLog[i];
          if ((m.kind === 'pose' || m.kind === 'play' || m.kind === 'playcross') && m.boardPass) { boardPassAt = i; break; }
        }
        if (boardPassAt >= 0 && s.moveLog[boardPassAt].seat !== move.seat) {
          const after = s.moveLog.filter((m, index) => m.seat === move.seat && index > boardPassAt);
          own = after.slice(1);
        }
        const last3 = own.slice(-3);
        if (last3.length === 3 && last3.every((m) => m.kind === 'pass')) {
          s.penalties[move.seat] += 10;
          penaltyEvents.push({ seat: move.seat, amount: 10, reason: 'triple-pass' });
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
    const last = s.moveLog.length - 1;
    s.moveLog[last] = { ...s.moveLog[last], boardPass: true } as Move;
    const ends = s.board ? [...new Set(openEnds(s.board))].sort((a, b) => a - b) : [];
    for (let seat = 0; seat < s.seatCount; seat++) {
      if (seat !== move.seat) {
        s.penalties[seat] += 10;
        penaltyEvents.push({ seat, amount: 10, reason: 'board-pass', by: move.seat, tile: move.tile, ends });
      }
    }
  }

  if (penaltyEvents.length > 0) {
    s.penaltyLog = [...(s.penaltyLog ?? []), ...penaltyEvents];
  }

  if (s.hands[move.seat].length === 0) {
    s.status = 'domino';
    s.result = resolve(s, 'domino', 'tile' in move && isDouble(move.tile), keyWinTile);
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
