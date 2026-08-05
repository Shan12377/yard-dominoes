/**
 * The duppies.
 *
 * Difficulty scales by DEPTH OF REASONING, never by information. Every tier
 * receives the same `PublicView` — a structure that contains the bot's own
 * hand, the board, the move log, and opponents' hand SIZES, and which has no
 * field capable of holding another seat's tiles.
 *
 * That is deliberate. "The computer cheats" is the most corrosive complaint in
 * this category, and the only durable answer is an architecture where cheating
 * is not expressible. A duppy cannot peek because there is nowhere for the
 * information to arrive.
 *
 * INVARIANT, RESTATED FOR OPEN HAND. `PublicView.partnerHand` is set only when
 * the mode is `openhand`, where the human in that seat also sees their
 * partner's tiles. A bot in that mode receiving the field is not cheating — it
 * is receiving information the rules grant it. Any code path that populates
 * `partnerHand` in another mode, or reads a *cutthroat* opponent's tiles into
 * a bot's view under any mode, breaks the invariant. There are two producers
 * of this field, both in this file, both gated on `isPartnered(mode)` AND
 * `mode === 'openhand'` — do not add a third without repeating both checks.
 */

import {
  handCount,
  halves,
  isDouble,
  isPartnered,
  matches,
  nextSeat,
  otherHalf,
  sideOf,
  tileCount,
  fullSet,
} from './tiles.ts';
import { legalMoves, applyMove, knownVoids, openEnds } from './hand.ts';
import type { AnyBoard, GameMode, HandState, Move, Pip, SetFormat, TileId } from './types.ts';

// Same legacy-data hazard as cloneBoard in hand.ts (separate copy here since
// hand.ts's isn't exported) — check `=== 'cross'` and default to linear, so
// a row written before the cross board shipped (no `kind` field) doesn't
// crash reading `.arms` off an object that never had one.
function cloneAnyBoard(board: AnyBoard | null): AnyBoard | null {
  if (!board) return null;
  if (board.kind === 'cross') {
    return {
      kind: 'cross',
      center: board.center,
      arms: board.arms.map((a) => ({ ...a, tiles: a.tiles.map((p) => ({ ...p })) })),
      suitLed: [...board.suitLed],
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
 * Every placed tile on either board shape, order-agnostic.
 *
 * `=== 'cross'`, not `=== 'linear'` — same legacy-data hazard as
 * `cloneAnyBoard` above: a board with no `kind` field must fall through to
 * linear, or `board.arms` is read off an object that never had one.
 */
export function allBoardTiles(board: AnyBoard): TileId[] {
  if (board.kind === 'cross') {
    return [board.center, ...board.arms.flatMap((a) => a.tiles.map((p) => p.tile))];
  }
  return board.line.map((p) => p.tile);
}

export type DuppyLevel = 'pickney' | 'yard' | 'ranker' | 'don' | 'general';

export const DUPPY_LEVELS: DuppyLevel[] = ['pickney', 'yard', 'ranker', 'don', 'general'];

export const DUPPY_LABELS: Record<DuppyLevel, string> = {
  pickney: 'Pickney — plays anything legal',
  yard: 'Yard — sheds heavy tiles, favours its long suit',
  ranker: 'Ranker — remembers who passed on what',
  don: 'Don — counts suits out and blocks',
  general: 'General — reads the whole table',
};

/**
 * Everything a duppy is allowed to know. Note what is absent: there is no
 * field for another seat's tiles.
 */
export interface PublicView {
  seat: number;
  seatCount: number;
  mode: GameMode;
  myHand: TileId[];
  board: AnyBoard | null;
  turn: number;
  handSizes: number[];
  boneyardSize: number;
  moveLog: Move[];
  poseMustBeDoubleSix: boolean;
  /** French, round 2+ — see HandState's own field. A duppy due to pose
   *  needs this to restrict its own stub's legalMoves() to doubles. */
  poseMustBeAnyDouble?: boolean;
  /** Format is needed so bot stubs re-enter the engine's cross vs linear branches. */
  format: SetFormat;
  /**
   * Which tile the forced pose must be — 6-6 outside French, 0-0 (chucha)
   * inside French round 1. Legal-move enumeration needs this: the bot's stub
   * hand goes through the same `legalMoves` path players do, and without the
   * right opening tile the forced-pose branch returns no moves.
   */
  openingTile: TileId;
  /**
   * Present only when `mode === 'openhand'`. `undefined` in every other mode —
   * this shape is the anti-cheat invariant expressed in the type. A caller
   * should reach for `partnerHandOf(view)` rather than reading this field
   * directly, so the mode gate is enforced at every read site.
   */
  partnerHand?: TileId[];
}

/**
 * The safe read for `partnerHand`: returns the tiles only when the mode grants
 * them, `null` otherwise. Point it at every strategy site that might one day
 * want to use partner information; a bare `view.partnerHand` read past a test
 * that filled the field under the wrong mode would silently leak.
 */
export function partnerHandOf(view: PublicView): TileId[] | null {
  if (view.mode !== 'openhand') return null;
  return view.partnerHand ?? null;
}

export function publicView(s: HandState, seat: number): PublicView {
  // Openhand producer #1 of 2. See the invariant comment at the top of the
  // file and `partnerHandOf` — a bare partner-hand copy under any other mode
  // would leak. Cutthroat has no partner concept, so `partnerSeatOf` returns
  // null there and the field stays undefined.
  const partnerHand = s.mode === 'openhand'
    ? (() => {
        const p = partnerSeatOf(seat, s.seatCount, s.mode);
        return p === null ? undefined : [...s.hands[p]];
      })()
    : undefined;
  return {
    seat,
    seatCount: s.seatCount,
    mode: s.mode,
    myHand: [...s.hands[seat]],
    board: cloneAnyBoard(s.board),
    turn: s.turn,
    handSizes: s.hands.map((h) => h.length),
    boneyardSize: s.boneyard.length,
    moveLog: s.moveLog.map((m) => ({ ...m })),
    poseMustBeDoubleSix: s.poseMustBeDoubleSix,
    poseMustBeAnyDouble: s.poseMustBeAnyDouble,
    openingTile: s.openingTile,
    format: s.format,
    ...(partnerHand !== undefined ? { partnerHand } : {}),
  };
}

export type Rng = () => number;

/** How many of my tiles show each pip. My strength in every suit. */
export function suitStrength(hand: TileId[]): number[] {
  const strength = new Array(7).fill(0);
  for (const tile of hand) {
    const [a, b] = halves(tile);
    strength[a]++;
    if (a !== b) strength[b]++;
  }
  return strength;
}

/** Tiles of each suit already visible on the board (seven of each exist). */
export function suitsSeen(view: PublicView): number[] {
  const seen = new Array(7).fill(0);
  const onBoard = view.board ? allBoardTiles(view.board) : [];
  for (const tile of [...onBoard, ...view.myHand]) {
    const [a, b] = halves(tile);
    seen[a]++;
    if (a !== b) seen[b]++;
  }
  return seen;
}

/** Suits each seat is known void in, from its passes. */
export function voidsFromLog(view: PublicView): Set<Pip>[] {
  const voids: Set<Pip>[] = Array.from({ length: view.seatCount }, () => new Set<Pip>());
  for (const m of view.moveLog) {
    if (m.kind === 'pass' && m.ends) {
      for (const p of m.ends) voids[m.seat].add(p);
    }
  }
  return voids;
}

/**
 * Suits where exactly one tile is unaccounted for — not on the board, not
 * in my own hand, so it is somewhere in an opponent's hand or the
 * boneyard. Jamaican players call an open end like this a "hard end": only
 * one copy of that suit is left anywhere, so whoever is forced to face it
 * either holds that lone tile or must pass — nobody else can ever answer
 * it again. `openEnds()` is shape-agnostic, so this reads a cross board
 * exactly the same way as a linear one.
 */
export function hardEnds(view: PublicView): Pip[] {
  if (!view.board) return [];
  const seen = suitsSeen(view);
  return openEnds(view.board).filter((suit) => seen[suit] === 6);
}

/**
 * Doubles in my own hand that cannot be played right now and are unlikely
 * to open again: every tile of that suit but one unaccounted-for copy is
 * already visible (on the board or in my hand — the double itself counts
 * as one of the six), and no currently open end exposes that suit.
 */
export function deadDoubles(view: PublicView): TileId[] {
  const seen = suitsSeen(view);
  const open = new Set(view.board ? openEnds(view.board) : []);
  return view.myHand.filter((t) => {
    const [a, b] = halves(t);
    if (a !== b) return false; // only doubles can be dead in this sense
    return seen[a] === 6 && !open.has(a);
  });
}

/**
 * True when my hand holds a tile in two DIFFERENT suits that are each down
 * to their last unaccounted-for copy — an unbeatable "key" position, since
 * I effectively control where the board can go in both suits at once.
 */
export function hasKey(view: PublicView): boolean {
  const seen = suitsSeen(view);
  const mySuits = new Set<Pip>();
  for (const t of view.myHand) {
    const [a, b] = halves(t);
    if (seen[a] === 6) mySuits.add(a);
    if (seen[b] === 6) mySuits.add(b);
  }
  return mySuits.size >= 2;
}

/**
 * The open pips AFTER this move, regardless of board shape. Bots use this to
 * reason about what suits opponents would face next. Linear boards return two
 * pips; cross boards return however many arms are exposed.
 */
function endsAfter(board: AnyBoard | null, move: Move): Pip[] {
  if (move.kind === 'pose') {
    const [a, b] = halves(move.tile);
    if (move.tile === '0-0') return [0];
    return [a as Pip, b as Pip];
  }
  if (move.kind === 'play' && board && board.kind === 'linear') {
    const anchor = move.end === 'left' ? board.leftEnd : board.rightEnd;
    const exposed = otherHalf(move.tile, anchor);
    return move.end === 'left' ? [exposed, board.rightEnd] : [board.leftEnd, exposed];
  }
  if (move.kind === 'playcross' && board && board.kind === 'cross') {
    if (move.arm === board.arms.length) {
      const [a, b] = halves(move.tile);
      const exposed = (a === 0 ? b : a) as Pip;
      return [...board.arms.map((a) => a.openEnd), exposed];
    }
    const arm = board.arms[move.arm];
    const exposed = otherHalf(move.tile, arm.openEnd);
    return board.arms.map((a, i) => i === move.arm ? exposed : a.openEnd);
  }
  return board ? openEnds(board) : [];
}

function opponentSeats(view: PublicView): number[] {
  const mine = sideOf(view.seat, view.mode);
  const out: number[] = [];
  for (let s = 0; s < view.seatCount; s++) if (sideOf(s, view.mode) !== mine) out.push(s);
  return out;
}

/**
 * Pairing-only. Openhand pairs 0&2, 1&3 exactly like partner mode, so this
 * gates on `isPartnered`, not the string 'partner' — a bare comparison would
 * make an openhand bot think it had no partner and skip every strategy weight
 * that fed one.
 */
function partnerSeat(view: PublicView): number | null {
  return partnerSeatOf(view.seat, view.seatCount, view.mode);
}

function partnerSeatOf(seat: number, seatCount: number, mode: GameMode): number | null {
  if (!isPartnered(mode)) return null;
  for (let s = 0; s < seatCount; s++) {
    if (s !== seat && sideOf(s, mode) === sideOf(seat, mode)) return s;
  }
  return null;
}

interface Weights {
  shedPips: number;
  control: number;
  blockOpponents: number;
  feedPartner: number;
  exhaustion: number;
  goOut: number;
  holdDouble: number;
}

const WEIGHTS: Record<Exclude<DuppyLevel, 'pickney'>, Weights> = {
  yard:    { shedPips: 1.0, control: 0.5, blockOpponents: 0,   feedPartner: 0,   exhaustion: 0,   goOut: 50, holdDouble: 0 },
  ranker:  { shedPips: 0.8, control: 1.2, blockOpponents: 2.0, feedPartner: 0,   exhaustion: 0,   goOut: 50, holdDouble: 0.3 },
  don:     { shedPips: 0.7, control: 1.5, blockOpponents: 3.0, feedPartner: 2.5, exhaustion: 2.0, goOut: 50, holdDouble: 0.5 },
  general: { shedPips: 0.7, control: 1.5, blockOpponents: 3.0, feedPartner: 2.5, exhaustion: 2.0, goOut: 50, holdDouble: 0.5 },
};

/** Heuristic value of a candidate move. Higher is better. */
export function scoreMove(view: PublicView, move: Move, level: Exclude<DuppyLevel, 'pickney'>): number {
  const w = WEIGHTS[level];
  if (move.kind === 'pass' || move.kind === 'draw') return -1000;

  let score = 0;
  const tile = move.tile;

  // Going out ends the hand in my favour. Nothing outranks it.
  if (view.myHand.length === 1) score += w.goOut;

  // Heavy tiles are a liability if the board blocks.
  score += tileCount(tile) * w.shedPips * 0.1;

  const ends = endsAfter(view.board, move);
  const remaining = view.myHand.filter((t) => t !== tile);
  const strength = suitStrength(remaining);

  // Suit control: can I answer the board I am about to leave?
  for (const end of ends) score += strength[end] * w.control;

  // A double leaves its own suit exposed, so it does not advance the board.
  // Worth holding while I still control that suit.
  if (isDouble(tile) && ends.length > 0 && strength[ends[0]] > 0) score -= w.holdDouble;

  if (w.blockOpponents > 0 || w.feedPartner > 0) {
    const voids = voidsFromLog(view);
    const opps = opponentSeats(view);
    const mate = partnerSeat(view);

    // Leaving ends my opponents are void in forces passes.
    for (const opp of opps) {
      for (const end of ends) if (voids[opp].has(end)) score += w.blockOpponents;
    }
    // Leaving ends my partner is void in strands him.
    if (mate !== null) {
      for (const end of ends) if (voids[mate].has(end)) score -= w.feedPartner;
    }
  }

  if (w.exhaustion > 0) {
    // Seven tiles carry each suit. If I can see six of them and hold the rest,
    // that suit is mine — leaving it open is safe and strands everyone else.
    const seen = suitsSeen(view);
    for (const end of ends) {
      const unseen = 7 - seen[end];
      if (unseen <= 1 && strength[end] > 0) score += w.exhaustion;
    }
  }

  return score;
}

/**
 * Sample a full deal consistent with everything publicly known: my own tiles,
 * the tiles on the board, each opponent's hand size, and the voids their
 * passes revealed. Used by the top tier to reason about what is still out
 * there — WITHOUT ever being told.
 */
export function sampleConsistentDeal(view: PublicView, rng: Rng): TileId[][] | null {
  const onBoard = new Set(view.board ? allBoardTiles(view.board) : []);
  const mine = new Set(view.myHand);
  const pool = fullSet().filter((t) => !onBoard.has(t) && !mine.has(t));
  const voids = voidsFromLog(view);

  const hands: TileId[][] = Array.from({ length: view.seatCount }, () => []);
  hands[view.seat] = [...view.myHand];

  const others = [];
  for (let s = 0; s < view.seatCount; s++) if (s !== view.seat) others.push(s);

  for (let attempt = 0; attempt < 40; attempt++) {
    const bag = [...pool];
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    const trial: TileId[][] = hands.map((h) => [...h]);
    let ok = true;

    for (const seat of others) {
      const need = view.handSizes[seat];
      const taken: TileId[] = [];
      for (let i = 0; i < bag.length && taken.length < need; i++) {
        const tile = bag[i];
        if (tile === '') continue;
        const [a, b] = halves(tile);
        // A seat that passed on a suit cannot hold that suit.
        if (voids[seat].has(a as Pip) || voids[seat].has(b as Pip)) continue;
        taken.push(tile);
        bag[i] = '';
      }
      if (taken.length < need) { ok = false; break; }
      trial[seat] = taken;
    }
    if (ok) return trial;
  }
  return null;
}

function stateFromDeal(view: PublicView, deal: TileId[][]): HandState {
  return {
    seatCount: view.seatCount,
    mode: view.mode,
    hands: deal.map((h) => [...h]),
    boneyard: [],
    board: cloneAnyBoard(view.board),
    turn: view.turn,
    consecutivePasses: 0,
    moveLog: [],
    penalties: new Array(view.seatCount).fill(0),
    status: 'active',
    result: null,
    poseMustBeDoubleSix: view.poseMustBeDoubleSix,
    poseMustBeAnyDouble: view.poseMustBeAnyDouble,
    openingTile: view.openingTile,
    poser: view.seat,
    format: view.format,
  };
}

/** Play a sampled hand to the end with the `don` policy and report the winner. */
function rollout(state: HandState, rng: Rng): number | null {
  let s = state;
  let guard = 0;
  while (s.status === 'active' && guard++ < 200) {
    const view = publicView(s, s.turn);
    const moves = legalMoves(s);
    if (moves.length === 0) break;
    let best = moves[0];
    let bestScore = -Infinity;
    for (const m of moves) {
      const sc = scoreMove(view, m, 'don') + rng() * 0.01;
      if (sc > bestScore) { bestScore = sc; best = m; }
    }
    s = applyMove(s, best);
  }
  return s.result ? s.result.winnerSide : null;
}

/** Pick a move. This is the only entry point a table needs. */
export function chooseMove(view: PublicView, level: DuppyLevel, rng: Rng = Math.random): Move {
  // In openhand the partner's tiles are known — plug them into the stub in the
  // partner's slot rather than the placeholder '0-0'. Without this the stub is
  // consistent-looking but false, and a later rollout calling publicView on
  // that stub would happily set partnerHand from fake tiles. A future bot that
  // learns to use partnerHand would then be scoring on lies. See the invariant
  // block at the top of the file — this is the second producer it warns about.
  const partner = partnerSeat(view);
  const deal = view.handSizes.map((n, i) => {
    if (i === view.seat) return view.myHand;
    if (i === partner && view.partnerHand) return view.partnerHand;
    return new Array(n).fill('0-0');
  });
  const stub = stateFromDeal(view, deal);
  // Legal move generation only needs MY hand and the board, so a stub with
  // placeholder tiles for the others is enough to enumerate my own options.
  stub.turn = view.seat;
  const moves = legalMoves(stub).filter((m) => m.seat === view.seat);
  if (moves.length === 0) throw new Error('no legal move available');
  if (moves.length === 1) return moves[0];

  if (level === 'pickney') return moves[Math.floor(rng() * moves.length)];

  if (level === 'general') {
    const mySide = sideOf(view.seat, view.mode);
    const scored = moves.map((move) => {
      let wins = 0;
      let samples = 0;
      for (let i = 0; i < 12; i++) {
        const deal = sampleConsistentDeal(view, rng);
        if (!deal) continue;
        const s = stateFromDeal(view, deal);
        let next: HandState;
        try { next = applyMove(s, move); } catch { continue; }
        samples++;
        const winner = next.status !== 'active' ? next.result!.winnerSide : rollout(next, rng);
        if (winner === mySide) wins++;
      }
      // Fall back to the heuristic when the position is too constrained to sample.
      const rate = samples > 0 ? wins / samples : 0;
      return { move, value: samples > 0 ? rate * 100 : scoreMove(view, move, 'don') };
    });
    scored.sort((a, b) => b.value - a.value);
    return scored[0].move;
  }

  let best = moves[0];
  let bestScore = -Infinity;
  for (const m of moves) {
    const sc = scoreMove(view, m, level) + rng() * 0.001;
    if (sc > bestScore) { bestScore = sc; best = m; }
  }
  return best;
}

/** Convenience: pick a move straight from a full hand state for a given seat. */
export function duppyMove(s: HandState, level: DuppyLevel, rng: Rng = Math.random): Move {
  return chooseMove(publicView(s, s.turn), level, rng);
}
