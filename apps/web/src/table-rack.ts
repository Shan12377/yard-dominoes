import type { GameMode, TileId } from '@yard/engine';

export type TableRackPresentation =
  | { kind: 'none' }
  | { kind: 'hidden'; count: number }
  | { kind: 'open'; tiles: TileId[] };

/** Pure privacy/layout decision for the felt-edge racks. */
export function tableRackPresentation(opts: {
  mode: GameMode;
  seat: number;
  mySeat: number | null;
  partnerSeat: number | null;
  count: number | undefined;
  partnerTiles: TileId[] | null;
}): TableRackPresentation {
  const { mode, seat, mySeat, partnerSeat, count, partnerTiles } = opts;
  if (count === undefined || seat === mySeat) return { kind: 'none' };
  if (mode === 'across' && seat === partnerSeat) return { kind: 'none' };

  // hand_public and seat_hands update on separate realtime streams. Reveal
  // the Open Hand rack only when both agree on its size; until then, the
  // public count is the safe, accurate fallback.
  if (mode === 'openhand' && partnerSeat !== null && seat === partnerSeat
      && partnerTiles !== null && partnerTiles.length === count) {
    return { kind: 'open', tiles: partnerTiles };
  }
  return { kind: 'hidden', count };
}
