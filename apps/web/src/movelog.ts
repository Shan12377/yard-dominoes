import type { Move } from '@yard/engine';
import type { SeatInfo } from './onlinetable.ts';

/** The exact display-name expression standingsPanel/seatCard already use
 *  (onlinetableview.ts) — kept identical here rather than introducing a
 *  shared helper for a two-line expression used in three places, matching
 *  how this codebase already handles the duplication. */
/**
 * What to call a seat.
 *
 * Duppies are named by seat alone. The level used to hang off the name
 * ("Duppy 2 · ranker") and it was a poor trade: the player chose it in the
 * setup form, it does not change mid-hand, and on a phone it ate the width the
 * name needed — a two-hander's card truncated to "Du…". It is still on the
 * seat's own aria-label and card title, which is where it belongs, since the
 * one case where levels genuinely differ is a seat someone walked out of
 * (leave-seat fills it with a 'yard' duppy).
 */
export function seatName(seat: SeatInfo): string {
  return seat.userId
    ? (seat.username ?? `Player ${seat.seatIndex + 1}`)
    : `Duppy ${seat.seatIndex + 1}`;
}

/** The name plus its level, for the places with room to say both. */
export function seatNameWithLevel(seat: SeatInfo): string {
  return seat.userId ? seatName(seat) : `${seatName(seat)} · ${seat.duppyLevel}`;
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
