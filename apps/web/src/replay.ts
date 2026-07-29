import { halves } from '@yard/engine';
import type { Board, Move, Pip, TileId } from '@yard/engine';

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

export type ReplayStep =
  | { kind: 'pose'; seat: number; tile: TileId }
  | { kind: 'play'; seat: number; tile: TileId; end: 'left' | 'right' }
  | { kind: 'draw'; seat: number }
  | { kind: 'pass'; seat: number };

/** A step before its seat is worked out. Spelled out because `Omit` over a
 *  union collapses it to the keys they share. */
type StepBody =
  | { kind: 'pose'; tile: TileId }
  | { kind: 'play'; tile: TileId; end: 'left' | 'right' }
  | { kind: 'draw' }
  | { kind: 'pass' };

export interface ReplayHand {
  /** Seat that opened. Turn order runs from here, one seat per step. */
  poser: number;
  /** Whose hand this is being shared from, so the replay can say "you". */
  seat: number;
  seatCount: number;
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
  moves: Move[], poser: number, seat: number, seatCount = 4,
): string {
  let out = VERSION + poser + seat + seatCount;
  for (const move of moves) {
    if (move.kind === 'pass') { out += 'X'; continue; }
    if (move.kind === 'draw') { out += 'D'; continue; }
    const idx = TILES.indexOf(move.tile);
    if (idx < 0) continue;
    const prefix = move.kind === 'pose' ? 'P' : move.end === 'left' ? 'L' : 'R';
    out += prefix + ALPHABET[idx];
  }
  return out;
}

/** Decode a shared hand. Returns null for anything malformed — never throws. */
export function decodeHand(code: string): ReplayHand | null {
  if (!code || code[0] !== VERSION || code.length < 4) return null;
  const poser = Number(code[1]);
  const seat = Number(code[2]);
  const seatCount = Number(code[3]);
  if (!Number.isInteger(seatCount) || seatCount < 2 || seatCount > 4) return null;
  if (!Number.isInteger(poser) || poser < 0 || poser >= seatCount) return null;
  if (!Number.isInteger(seat) || seat < 0 || seat >= seatCount) return null;

  const partial: StepBody[] = [];
  for (let i = 4; i < code.length; i++) {
    const c = code[i];
    if (c === 'X') { partial.push({ kind: 'pass' }); continue; }
    if (c === 'D') { partial.push({ kind: 'draw' }); continue; }
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
  return { poser, seat, seatCount, steps };
}

/**
 * The board as it stood after `count` steps. Rebuilt from the played tiles
 * alone — no hidden state is needed to draw a board, which is exactly why a
 * replay can be public.
 *
 * Returns null when a step does not fit the board, so a hand-edited URL
 * renders nothing rather than a nonsense line.
 */
export function boardAfter(replay: ReplayHand, count: number): Board | null {
  let board: Board | null = null;
  for (const step of replay.steps.slice(0, count)) {
    if (step.kind === 'pass' || step.kind === 'draw') continue;
    const [a, b] = halves(step.tile);
    if (!board) {
      board = { line: [{ tile: step.tile, crosswise: a === b }], leftEnd: a, rightEnd: b };
      continue;
    }
    if (step.kind !== 'play') return null;
    const placed = { tile: step.tile, crosswise: a === b };
    const open: Pip = step.end === 'left' ? board.leftEnd : board.rightEnd;
    const exposed: Pip | null = a === open ? b : b === open ? a : null;
    if (exposed === null) return null;
    board = step.end === 'left'
      ? { line: [placed, ...board.line], leftEnd: exposed, rightEnd: board.rightEnd }
      : { line: [...board.line, placed], leftEnd: board.leftEnd, rightEnd: exposed };
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
