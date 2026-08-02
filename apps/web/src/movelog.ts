import type { Move } from '@yard/engine';
import type { SeatInfo } from './onlinetable.ts';

/** The exact display-name expression standingsPanel/seatCard already use
 *  (onlinetableview.ts) — kept identical here rather than introducing a
 *  shared helper for a two-line expression used in three places, matching
 *  how this codebase already handles the duplication. */
function seatName(seat: SeatInfo): string {
  return seat.userId ? (seat.username ?? `Seat ${seat.seatIndex}`) : `Duppy · ${seat.duppyLevel}`;
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
  const seat = seats.find((s) => s.seatIndex === move.seat);
  let name: string;
  if (move.seat === mySeat) {
    name = 'You';
  } else if (isPartnerMode && mySide !== null && move.seat % 2 === mySide) {
    // sideOf() in the engine is seat % 2 for a partnered table — mySide is
    // already resolved by the caller (OnlineGame.mySide), so this only
    // needs to compare the move's seat against it, not re-derive sideOf.
    name = 'Partner';
  } else {
    name = seat ? seatName(seat) : `Seat ${move.seat}`;
  }

  switch (move.kind) {
    case 'pose': return `${name} posed ${move.tile}`;
    case 'play': return `${name} played ${move.tile}`;
    case 'playcross': return `${name} played ${move.tile}`;
    case 'draw': return `${name} drew a tile`;
    case 'pass': return `${name} passed`;
  }
}
