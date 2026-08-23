import type { Move } from '@yard/engine';
import type { SeatInfo } from './onlinetable.ts';

/** The exact display-name expression standingsPanel/seatCard already use
 *  (onlinetableview.ts) — kept identical here rather than introducing a
 *  shared helper for a two-line expression used in three places, matching
 *  how this codebase already handles the duplication. */
export function seatName(seat: SeatInfo): string {
  return seat.userId
    ? (seat.username ?? `Player ${seat.seatIndex + 1}`)
    : `Duppy ${seat.seatIndex + 1} · ${seat.duppyLevel}`;
}

/**
 * Names a seat relative to the viewer — "You", "Partner", or their actual
 * name/duppy label. Shared by describeMoveLine (the turn log) and
 * handResultPanel (naming who won a blocked hand) — genuinely the same
 * semantic in both places, not just superficially similar, which is what
 * makes this worth extracting rather than a fourth inline copy.
 */
export function describeSeat(
  seatIndex: number,
  seats: SeatInfo[],
  mySeat: number | null,
  isPartnerMode: boolean,
  mySide: number | null,
): string {
  if (seatIndex === mySeat) return 'You';
  if (isPartnerMode && mySide !== null && seatIndex % 2 === mySide) {
    // sideOf() in the engine is seat % 2 for a partnered table — mySide is
    // already resolved by the caller (OnlineGame.mySide), so this only
    // needs to compare the seat against it, not re-derive sideOf.
    return 'Partner';
  }
  const seat = seats.find((s) => s.seatIndex === seatIndex);
  return seat ? seatName(seat) : `Player ${seatIndex + 1}`;
}

/**
 * One line per Move, for the live table's turn-by-turn log. Pure and
 * DOM-free so it can be tested without a browser — see movelog.test.ts.
 */
export function describeMoveLine(
  move: Move,
  seats: SeatInfo[],
  mySeat: number | null,
  isPartnerMode: boolean,
  mySide: number | null,
): string {
  const name = describeSeat(move.seat, seats, mySeat, isPartnerMode, mySide);
  switch (move.kind) {
    case 'pose': return `${name} posed ${move.tile}`;
    case 'play': return `${name} played ${move.tile}`;
    case 'playcross': return `${name} played ${move.tile}`;
    case 'draw': return `${name} drew a tile`;
    case 'pass': return `${name} passed`;
  }
}
