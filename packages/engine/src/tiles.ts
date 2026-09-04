import type { Pip, TileId, GameMode } from './types.ts';

export const DOUBLE_SIX: TileId = '6-6';
export const DOUBLE_BLANK: TileId = '0-0';

/** Canonical id for a tile. Always ordered low-high so "5-2" and "2-5" agree. */
export function tileId(a: Pip, b: Pip): TileId {
  return a <= b ? `${a}-${b}` : `${b}-${a}`;
}

export function halves(id: TileId): [Pip, Pip] {
  const [a, b] = id.split('-').map(Number) as [Pip, Pip];
  return [a, b];
}

export function isDouble(id: TileId): boolean {
  const [a, b] = halves(id);
  return a === b;
}

/** Pip total of a single tile. */
export function tileCount(id: TileId): number {
  const [a, b] = halves(id);
  return a + b;
}

/** Pip total of a hand. This is the number that decides a blocked hand. */
export function handCount(tiles: TileId[]): number {
  return tiles.reduce((sum, t) => sum + tileCount(t), 0);
}

/** The full double-six set: 28 tiles, seven of each suit. */
export function fullSet(): TileId[] {
  const out: TileId[] = [];
  for (let a = 0; a <= 6; a++) {
    for (let b = a; b <= 6; b++) out.push(tileId(a as Pip, b as Pip));
  }
  return out;
}

/** Can this tile be laid against an open end showing `end`? */
export function matches(id: TileId, end: Pip): boolean {
  const [a, b] = halves(id);
  return a === end || b === end;
}

/** The half left exposed after laying `id` against `end`. */
export function otherHalf(id: TileId, end: Pip): Pip {
  const [a, b] = halves(id);
  if (a === end) return b;
  if (b === end) return a;
  throw new Error(`tile ${id} does not match end ${end}`);
}

/**
 * Side index for a seat.
 * Partner: seats 0&2 are side 0, seats 1&3 are side 1.
 * Cutthroat: every seat is its own side.
 */
/**
 * True when the mode pairs seats into sides — partner, openhand, and across
 * all do; cutthroat does not. Every play-rules branch that used to compare
 * `mode === 'partner'` reads this instead, so adding a new paired variant
 * does not silently exclude itself from the rules that make it a paired game.
 */
export function isPartnered(mode: GameMode): boolean {
  return mode === 'partner' || mode === 'openhand' || mode === 'across';
}

export function sideOf(seat: number, mode: GameMode): number {
  return isPartnered(mode) ? seat % 2 : seat;
}

export function sideCount(seatCount: number, mode: GameMode): number {
  return isPartnered(mode) ? 2 : seatCount;
}

/** Seats belonging to a side. */
export function seatsOfSide(side: number, seatCount: number, mode: GameMode): number[] {
  const out: number[] = [];
  for (let s = 0; s < seatCount; s++) if (sideOf(s, mode) === side) out.push(s);
  return out;
}

/**
 * Next seat to act. Seats are numbered in play order (anti-clockwise), so the
 * next player is simply seat+1 — which is the player to the physical RIGHT.
 */
export function nextSeat(seat: number, seatCount: number): number {
  return (seat + 1) % seatCount;
}

/** Tiles per player, and whether the double-blank is removed. */
export function dealPlan(seatCount: number, useBoneyard: boolean): {
  perPlayer: number;
  removeDoubleBlank: boolean;
} {
  switch (seatCount) {
    case 4:
      return { perPlayer: 7, removeDoubleBlank: false };
    case 3:
      // Three-handers drop the double-blank so 27 tiles divide evenly.
      return { perPlayer: 9, removeDoubleBlank: true };
    case 2:
      return { perPlayer: useBoneyard ? 7 : 14, removeDoubleBlank: false };
    default:
      throw new Error(`unsupported seat count: ${seatCount}`);
  }
}

/**
 * How many tiles in play carry a given pip.
 *
 * Seven, always — except the blanks at a three-handed table, where `dealPlan`
 * above removes the double-blank so 27 tiles divide evenly, leaving six.
 *
 * Anything reasoning about "how many of this suit are unaccounted for" has to
 * go through this rather than assuming seven. Testing `seen === 6` for "one
 * copy left" is right at four seats and wrong at three: for blanks it means
 * none are left, and it misses the case where one actually is. That bug was
 * live in `hardEnds`, `deadDoubles` and `hasKey` — the duppies' blocking logic
 * — until 2026-09-04.
 *
 * Derived from `dealPlan` rather than repeating its `seatCount === 3` test, so
 * the two cannot drift apart.
 */
export function tilesCarrying(pip: Pip, seatCount: number): number {
  // useBoneyard does not affect removeDoubleBlank at any seat count.
  const { removeDoubleBlank } = dealPlan(seatCount, false);
  return removeDoubleBlank && pip === 0 ? 6 : 7;
}

/** Tiles carrying `pip` that are still unaccounted for, given how many are visible. */
export function unaccountedFor(pip: Pip, seen: number, seatCount: number): number {
  return Math.max(0, tilesCarrying(pip, seatCount) - seen);
}
