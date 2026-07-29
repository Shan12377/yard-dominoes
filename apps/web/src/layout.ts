import { halves } from '@yard/engine';
import type { Board, Pip, PlacedTile } from '@yard/engine';

/**
 * Board geometry, the way a real Jamaican table lays it: tiles end to end
 * with touching halves showing the SAME pip count, doubles crosswise in the
 * line (the line does not turn at them), and the line turning 90° only when
 * it runs out of table — an elbow tile drops down and the line doubles back
 * the other way, exactly like the chain snaking around a physical table.
 *
 * Everything here is pure and DOM-free so it can run under `node --test`.
 *
 * Units: one unit = half a tile's short side stacked twice — i.e. a tile is
 * 4 units long by 2 units wide. Working in half-tile squares keeps every
 * position an integer: a crosswise double centres on the line by protruding
 * exactly one unit each side, and an elbow lines up flush under the last
 * tile's outer half.
 */

export interface OrientedTile {
  placed: PlacedTile;
  /** Pip on the face touching the previous tile (left end of the line first). */
  inPip: Pip;
  /** Pip on the face touching the next tile. */
  outPip: Pip;
}

/**
 * Walk the line from the left end and work out which way each tile faces,
 * so touching halves render with matching pips. The engine stores only the
 * canonical "low-high" id; physical orientation is derived here.
 */
export function orientLine(board: Board): OrientedTile[] {
  const out: OrientedTile[] = [];
  let exposed = board.leftEnd;
  for (const placed of board.line) {
    const [a, b] = halves(placed.tile);
    const inPip = a === exposed ? a : b;
    const outPip = a === exposed ? b : a;
    out.push({ placed, inPip, outPip });
    exposed = outPip;
  }
  return out;
}

export interface TilePlacement {
  placed: PlacedTile;
  orient: 'h' | 'v';
  /** Faces in render order: left→right for 'h', top→bottom for 'v'. */
  faces: [Pip, Pip];
  /** Grid rect in units, 0-based, spans inclusive of start. */
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
}

const TILE_LONG = 4;
const TILE_SHORT = 2;
export const MIN_WIDTH_UNITS = 3 * TILE_LONG;

export function layoutLine(line: OrientedTile[], widthUnits: number): TilePlacement[] {
  const w = Math.max(MIN_WIDTH_UNITS, widthUnits);
  const placements: TilePlacement[] = [];
  let y = 1; // row 0 is headroom for a crosswise double in the first band
  let x = 0; // next free column in the direction of travel
  let dir: 1 | -1 = 1;
  let bandStart = true; // first tile after an elbow sits flush against it
  let prevCentredDouble = false; // last tile was a crosswise double centred on the band

  for (const t of line) {
    const isDouble = t.inPip === t.outPip;
    const len = isDouble ? TILE_SHORT : TILE_LONG;
    const fits = dir === 1 ? x + len <= w : x - len >= -1;

    if (!fits && !bandStart) {
      // Elbow: this tile turns the corner, dropping flush under the outer
      // half of the last tile, then the line doubles back. A centred double
      // already protrudes one unit below the band, so the corner tile hangs
      // one unit lower, flush under the double — same as on a real table.
      const drop = prevCentredDouble ? TILE_SHORT + 1 : TILE_SHORT;
      const col = dir === 1 ? x - TILE_SHORT : x + 1;
      placements.push({
        placed: t.placed, orient: 'v', faces: [t.inPip, t.outPip],
        col, row: y + drop, colSpan: TILE_SHORT, rowSpan: TILE_LONG,
      });
      y += drop + TILE_LONG;
      x = dir === 1 ? x - 1 : x + 1;
      dir = dir === 1 ? -1 : 1;
      bandStart = true;
      prevCentredDouble = false;
      continue;
    }

    if (isDouble) {
      // Crosswise, centred on the line — except flush under the elbow when
      // it opens a band, where centring would clip the elbow's bottom row.
      const col = dir === 1 ? x : x - 1;
      placements.push({
        placed: t.placed, orient: 'v', faces: [t.inPip, t.outPip],
        col, row: bandStart ? y : y - 1, colSpan: TILE_SHORT, rowSpan: TILE_LONG,
      });
      x += TILE_SHORT * dir;
      prevCentredDouble = !bandStart;
    } else {
      const col = dir === 1 ? x : x - (TILE_LONG - 1);
      placements.push({
        placed: t.placed, orient: 'h',
        faces: dir === 1 ? [t.inPip, t.outPip] : [t.outPip, t.inPip],
        col, row: y, colSpan: TILE_LONG, rowSpan: TILE_SHORT,
      });
      x += TILE_LONG * dir;
      prevCentredDouble = false;
    }
    bandStart = false;
  }
  return placements;
}
