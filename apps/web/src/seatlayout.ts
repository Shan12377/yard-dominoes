// Where each seat sits in the cross grid around the felt — spec
// docs/superpowers/specs/2026-08-01-table-layout-design.md §2. Anchored on
// the viewer's own seat (always "bottom", closest to the thumb), the rest
// placed using the same seat-numbering invariant CLAUDE.md already states:
// seat+1 is the player to your physical right, so partners (seat+2 in a
// 4-hander) land opposite for free — nothing partner-specific to compute.

export type SeatSlot = 'top' | 'left' | 'right' | 'bottom';

/** Order slots fill in, walking anti-clockwise from "me" at the bottom. */
const FOUR_SEAT_ORDER: SeatSlot[] = ['bottom', 'right', 'top', 'left'];
const THREE_SEAT_ORDER: (SeatSlot | null)[] = ['bottom', 'right', 'left'];
const TWO_SEAT_ORDER: SeatSlot[] = ['bottom', 'top'];

export function seatPosition(
  seatIndex: number, mySeat: number | null, seatCount: 2 | 3 | 4,
): SeatSlot | null {
  const anchor = mySeat ?? 0;
  const offset = ((seatIndex - anchor) % seatCount + seatCount) % seatCount;
  if (seatCount === 4) return FOUR_SEAT_ORDER[offset];
  if (seatCount === 3) return THREE_SEAT_ORDER[offset] ?? null;
  return TWO_SEAT_ORDER[offset] ?? null;
}
