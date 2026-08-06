import { halves, isDouble, otherHalf } from '@yard/engine';
import type { AnyBoard, CrossArm, CrossBoard, Move, Pip, SetFormat, TileId } from '@yard/engine';

/** Mirrors hand.ts's own ARM_DIRECTIONS. Duplicated rather than imported —
 *  this file already reimplements place()'s linear logic below rather than
 *  importing hand.ts internals, since replay works from a decoded step list
 *  with no seat-hand state, not a live HandState. Same convention here. */
const ARM_DIRECTIONS: CrossArm['direction'][] = ['right', 'left', 'up', 'down'];

/**
 * Shareable hands.
 *
 * A finished hand encodes into a short string that rides in the URL, so a
 * link replays the board tile by tile for anyone who opens it — no account,
 * no install, no server round trip. This is how an argument about whether
 * somebody should have held the six gets settled in a WhatsApp group, and
 * every share lands the reader on our board.
 *
 * What travels is only what the table already saw: the tiles that were
 * played, and in what order. A tile drawn from the boneyard and never played
 * stays hidden — the draw is recorded as "they drew" with no tile attached,
 * because encoding it would publish a tile that no opponent was ever entitled
 * to see. Nobody's hand is in this string.
 */

/** Every tile, canonical low-high, in a fixed order. Index = one character. */
const TILES: TileId[] = (() => {
  const out: TileId[] = [];
  for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) out.push(`${a}-${b}`);
  return out;
})();

/** 28 URL-safe characters, one per tile. */
const ALPHABET = '0123456789abcdefghijklmnopqr';

const VERSION = '1';

/**
 * Format matters to `boardAfter` for exactly one decision: does the opening
 * pose build a cross board or a linear one. Encoded as a single digit in the
 * header so a decoded replay knows without guessing. Order is arbitrary but
 * fixed — changing it would break every share link already handed out.
 */
const FORMAT_CODES: SetFormat[] = ['sixlove', 'firstToSix', 'single', 'french'];

export type ReplayStep =
  | { kind: 'pose'; seat: number; tile: TileId }
  | { kind: 'play'; seat: number; tile: TileId; end: 'left' | 'right' }
  | { kind: 'playcross'; seat: number; tile: TileId; arm: number }
  | { kind: 'draw'; seat: number }
  | { kind: 'pass'; seat: number };

/** A step before its seat is worked out. Spelled out because `Omit` over a
 *  union collapses it to the keys they share. */
type StepBody =
  | { kind: 'pose'; tile: TileId }
  | { kind: 'play'; tile: TileId; end: 'left' | 'right' }
  | { kind: 'playcross'; tile: TileId; arm: number }
  | { kind: 'draw' }
  | { kind: 'pass' };

export interface ReplayHand {
  /** Seat that opened. Turn order runs from here, one seat per step. */
  poser: number;
  /** Whose hand this is being shared from, so the replay can say "you". */
  seat: number;
  seatCount: number;
  /** Only 'french' changes anything here — see FORMAT_CODES. */
  format: SetFormat;
  steps: ReplayStep[];
}

/**
 * Turn order is fixed and anti-clockwise, and every seat either plays, passes
 * or draws when its turn comes — so the seat for each step is implied by its
 * position and never needs encoding. A draw does not end a turn, so the same
 * seat acts again.
 */
function seatsFor(poser: number, seatCount: number, kinds: string[]): number[] {
  const seats: number[] = [];
  let seat = poser;
  for (const kind of kinds) {
    seats.push(seat);
    if (kind !== 'draw') seat = (seat + 1) % seatCount;
  }
  return seats;
}

export function encodeHand(
  moves: Move[], poser: number, seat: number, seatCount = 4, format: SetFormat = 'sixlove',
): string {
  const formatIdx = FORMAT_CODES.indexOf(format);
  let out = VERSION + poser + seat + seatCount + (formatIdx < 0 ? 0 : formatIdx);
  for (const move of moves) {
    if (move.kind === 'pass') { out += 'X'; continue; }
    if (move.kind === 'draw') { out += 'D'; continue; }
    const idx = TILES.indexOf(move.tile);
    if (idx < 0) continue;
    if (move.kind === 'playcross') { out += move.arm + ALPHABET[idx]; continue; }
    const prefix = move.kind === 'pose' ? 'P' : move.end === 'left' ? 'L' : 'R';
    out += prefix + ALPHABET[idx];
  }
  return out;
}

/** Decode a shared hand. Returns null for anything malformed — never throws. */
export function decodeHand(code: string): ReplayHand | null {
  if (!code || code[0] !== VERSION || code.length < 5) return null;
  const poser = Number(code[1]);
  const seat = Number(code[2]);
  const seatCount = Number(code[3]);
  const format = FORMAT_CODES[Number(code[4])];
  if (!Number.isInteger(seatCount) || seatCount < 2 || seatCount > 4) return null;
  if (!Number.isInteger(poser) || poser < 0 || poser >= seatCount) return null;
  if (!Number.isInteger(seat) || seat < 0 || seat >= seatCount) return null;
  if (!format) return null;

  const partial: StepBody[] = [];
  for (let i = 5; i < code.length; i++) {
    const c = code[i];
    if (c === 'X') { partial.push({ kind: 'pass' }); continue; }
    if (c === 'D') { partial.push({ kind: 'draw' }); continue; }
    if (c === '0' || c === '1' || c === '2' || c === '3') {
      const tile = TILES[ALPHABET.indexOf(code[++i] ?? '')];
      if (!tile) return null;
      partial.push({ kind: 'playcross', tile, arm: Number(c) });
      continue;
    }
    if (c !== 'P' && c !== 'L' && c !== 'R') return null;
    const tile = TILES[ALPHABET.indexOf(code[++i] ?? '')];
    if (!tile) return null;
    partial.push(c === 'P'
      ? { kind: 'pose', tile }
      : { kind: 'play', tile, end: c === 'L' ? 'left' as const : 'right' as const });
  }
  if (partial.length === 0) return null;

  const seats = seatsFor(poser, seatCount, partial.map((p) => p.kind));
  const steps = partial.map((p, i) => ({ ...p, seat: seats[i] })) as ReplayStep[];
  return { poser, seat, seatCount, format, steps };
}

/**
 * The board as it stood after `count` steps. Rebuilt from the played tiles
 * alone — no hidden state is needed to draw a board, which is exactly why a
 * replay can be public.
 *
 * Returns null when a step does not fit the board, so a hand-edited URL
 * renders nothing rather than a nonsense line.
 */
export function boardAfter(replay: ReplayHand, count: number): AnyBoard | null {
  let board: AnyBoard | null = null;
  for (const step of replay.steps.slice(0, count)) {
    if (step.kind === 'pass' || step.kind === 'draw') continue;
    const [a, b] = halves(step.tile);

    if (!board) {
      // Every French pose is a double (round 1 forces the chucha, round 2+
      // forces the winner's own choice — see poseMustBeAnyDouble in
      // hand.ts), so any French pose builds a cross centred on whatever was
      // posed, matching applyMove's own pose branch.
      if (replay.format === 'french' && step.kind === 'pose' && a === b) {
        board = { kind: 'cross', center: step.tile, arms: [], doublesPlayed: [a] };
      } else {
        board = { kind: 'linear', line: [{ tile: step.tile, crosswise: a === b }], leftEnd: a, rightEnd: b };
      }
      continue;
    }

    if (board.kind === 'cross') {
      // Stable narrowed binding, explicitly typed — `board` itself gets
      // reassigned below, which defeats plain control-flow narrowing (TS
      // infers `any` here without the annotation, since `board` is a
      // reassigned `let` of a union type).
      const cross: CrossBoard = board;
      if (step.kind !== 'playcross') return null;
      const placed = { tile: step.tile, crosswise: a === b };
      if (step.arm === cross.arms.length) {
        // Filling phase: the tile must actually carry a half matching the
        // centre's own pip value, or a hand-edited URL could claim an
        // impossible arm.
        const centerValue = halves(cross.center)[0];
        if (a !== centerValue && b !== centerValue) return null;
        const exposed = (a === centerValue ? b : a) as Pip;
        const newArm: CrossArm = { direction: ARM_DIRECTIONS[step.arm], tiles: [placed], openEnd: exposed };
        board = { ...cross, arms: [...cross.arms, newArm] };
        continue;
      }
      const arm = cross.arms[step.arm];
      if (!arm) return null;
      let exposed: Pip;
      try { exposed = otherHalf(step.tile, arm.openEnd); } catch { return null; }
      const nextArm: CrossArm = { ...arm, tiles: [...arm.tiles, placed], openEnd: exposed };
      const arms = cross.arms.map((a2, i) => i === step.arm ? nextArm : a2);
      const doublesPlayed = isDouble(step.tile) && !cross.doublesPlayed.includes(arm.openEnd)
        ? [...cross.doublesPlayed, arm.openEnd]
        : cross.doublesPlayed;
      board = { ...cross, arms, doublesPlayed };
      continue;
    }

    if (step.kind !== 'play') return null;
    const placed = { tile: step.tile, crosswise: a === b };
    const open: Pip = step.end === 'left' ? board.leftEnd : board.rightEnd;
    const exposed: Pip | null = a === open ? b : b === open ? a : null;
    if (exposed === null) return null;
    board = step.end === 'left'
      ? { kind: 'linear', line: [placed, ...board.line], leftEnd: exposed, rightEnd: board.rightEnd }
      : { kind: 'linear', line: [...board.line, placed], leftEnd: board.leftEnd, rightEnd: exposed };
  }
  return board;
}

/** The share link for a hand. */
export function shareUrl(code: string): string {
  const base = `${location.origin}${location.pathname}`;
  return `${base}#hand=${code}`;
}

/** The shared hand in the current URL, if there is one. */
export function handFromUrl(): ReplayHand | null {
  const match = /[#&]hand=([^&]+)/.exec(location.hash);
  return match ? decodeHand(decodeURIComponent(match[1])) : null;
}
