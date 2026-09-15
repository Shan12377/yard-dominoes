import { halves } from '@yard/engine';
import type { Board, Move, Pip, PlacedTile } from '@yard/engine';
import { PHONE_ROUTE_CORPUS } from './phone-route-corpus.ts';

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
  /** French-only metadata used to attach a legal-choice marker to the
   * actual exposed bone instead of rendering an abstract button elsewhere. */
  crossArm?: number;
  crossStep?: number;
}

const TILE_LONG = 4;
const TILE_SHORT = 2;
// Two ordinary bones make a believable table run before an elbow. Requiring
// three made each French arm spend twelve half-bone cells in a straight ray,
// so a four-arm board could only fit by turning every bone into a counter.
export const MIN_WIDTH_UNITS = 2 * TILE_LONG;

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

/** Fixed height for the history-driven route. Keep this shared with render.ts. */
export function playedRouteHeightUnits(widthUnits: number): number {
  const width = Math.max(MIN_WIDTH_UNITS, widthUnits - (widthUnits % 2));
  return Math.max(48, Math.floor(width / 2)) * 2 + 10;
}

/** JamDom-style two-ended table route. The fixed grid keeps the pose anchored. */
export function layoutPlayedRoute(line: OrientedTile[], moves: Move[], widthUnits: number): TilePlacement[] {
  const width = Math.max(MIN_WIDTH_UNITS, widthUnits - (widthUnits % 2));
  const centre = Math.floor(width / 2);
  const centreRow = Math.max(48, Math.floor(width / 2));
  const bottomRow = playedRouteHeightUnits(width);
  const byTile = new Map(line.map((tile) => [tile.placed.tile, tile]));
  const positions = new Map<string, TilePlacement>();
  type Direction = 'left' | 'up' | 'right' | 'down';
  const paths: Record<'left' | 'right', {
    x: number; y: number; turn: number; legBones: number; lastDouble: boolean; dirs: Direction[];
  }> = {
    left: {
      x: centre - 1, y: centreRow, turn: 0, legBones: 0, lastDouble: false,
      // Once the first arm rises, each later band keeps climbing away from
      // the pose instead of curling back into the centre run.
      dirs: ['left', 'up', 'right', 'up', 'left', 'up', 'right', 'up'],
    },
    right: {
      x: centre + 1, y: centreRow, turn: 0, legBones: 0, lastDouble: false,
      // Every return band steps farther down the table. Turning upward here
      // sends a late right-end play straight back into the pose.
      dirs: ['right', 'down', 'left', 'down', 'right', 'down', 'left', 'down'],
    },
  };
  const add = (tile: OrientedTile, col: number, row: number, orient: 'h' | 'v', faces: [Pip, Pip]) => {
    positions.set(tile.placed.tile, {
      placed: tile.placed, orient, faces,
      col, row, colSpan: orient === 'h' ? TILE_LONG : TILE_SHORT,
      rowSpan: orient === 'h' ? TILE_SHORT : TILE_LONG,
    });
  };

  for (const move of moves) {
    if (move.kind !== 'pose' && move.kind !== 'play') continue;
    const tile = byTile.get(move.tile);
    if (!tile) continue;
    if (move.kind === 'pose') {
      add(tile, centre - 1, centreRow - 2, tile.inPip === tile.outPip ? 'v' : 'h', [tile.inPip, tile.outPip]);
      continue;
    }
    const path = paths[move.end];
    const along = tile.inPip === tile.outPip ? TILE_SHORT : TILE_LONG;
    const fits = (direction: Direction) => direction === 'left' ? path.x - along >= 0
      : direction === 'right' ? path.x + along <= width
        : direction === 'up' ? path.y - along >= 0
          : path.y + along <= bottomRow;
    const oldDirection = path.dirs[path.turn % path.dirs.length];
    // The familiar phone route has a short right-hand drop: two bones down,
    // then the line heads left along the lower band. Waiting for the bottom
    // boundary made that leg consume the player's hand space.
    const rightDropComplete = move.end === 'right'
      && oldDirection === 'down'
      && path.legBones >= 2;
    // The owner-confirmed left route rises for three complete ordinary bones
    // before crossing the top. This leaves room for the returning right arm.
    const leftRiseComplete = move.end === 'left'
      && oldDirection === 'up'
      && path.legBones >= (path.turn === 1 ? 3 : 2);
    if (!fits(oldDirection) || rightDropComplete || leftRiseComplete) {
      path.turn += 1;
      path.legBones = 0;
      const nextDirection = path.dirs[path.turn % path.dirs.length];
      // A 90-degree turn cannot reuse the old centreline: doing so puts one
      // half of the new bone on top of the previous bone. Move the exposed
      // join by one half-bone so the two rectangles meet cleanly at the elbow.
      if (oldDirection === 'left' && nextDirection === 'up') {
        path.y -= path.lastDouble ? 2 : 1;
        if (path.lastDouble) path.x += 1;
      }
      if (oldDirection === 'right' && nextDirection === 'down') {
        path.y += path.lastDouble ? 2 : 1;
        if (path.lastDouble) path.x -= 1;
      }
      if (oldDirection === 'right' && nextDirection === 'up') {
        path.y -= path.lastDouble ? 2 : 1;
        if (path.lastDouble) path.x -= 1;
      }
      if (oldDirection === 'up' && nextDirection === 'right') {
        path.x += path.lastDouble ? 2 : 1;
        if (path.lastDouble) path.y += 1;
      }
      if (oldDirection === 'up' && nextDirection === 'left') {
        path.x -= path.lastDouble ? 2 : 1;
        if (path.lastDouble) path.y += 1;
      }
      if (oldDirection === 'down' && nextDirection === 'left') {
        path.x -= path.lastDouble ? 2 : 1;
        if (path.lastDouble) path.y -= 1;
      }
      if (oldDirection === 'left' && nextDirection === 'down') {
        path.y += path.lastDouble ? 2 : 1;
        if (path.lastDouble) path.x += 1;
      }
      if (oldDirection === 'down' && nextDirection === 'right') {
        path.x += path.lastDouble ? 2 : 1;
        if (path.lastDouble) path.y -= 1;
      }
    }
    const direction = path.dirs[path.turn % path.dirs.length];
    const horizontal = direction === 'left' || direction === 'right';
    const orient: 'h' | 'v' = tile.inPip === tile.outPip
      ? (horizontal ? 'v' : 'h')
      : (horizontal ? 'h' : 'v');
    // A double is crosswise and therefore two half-bones wider than an
    // ordinary tile at the same turn. Clamp that cross-axis centre before
    // placing it; otherwise a double arriving exactly at an elbow can hang
    // outside the grid or cover the preceding bone.
    if (horizontal) {
      const half = orient === 'v' ? 2 : 1;
      path.y = Math.max(half, Math.min(bottomRow - half, path.y));
    } else {
      const half = orient === 'h' ? 2 : 1;
      path.x = Math.max(half, Math.min(width - half, path.x));
    }
    let col = path.x;
    let row = path.y;
    if (direction === 'left') { col -= along; row -= orient === 'v' ? 2 : 1; path.x -= along; }
    if (direction === 'right') { row -= orient === 'v' ? 2 : 1; path.x += along; }
    if (direction === 'up') { row -= along; col -= orient === 'h' ? 2 : 1; path.y -= along; }
    if (direction === 'down') { col -= orient === 'h' ? 2 : 1; path.y += along; }
    const reverse = move.end === 'left'
      ? direction === 'right' || direction === 'down'
      : direction === 'left' || direction === 'up';
    add(tile, col, row, orient, reverse ? [tile.outPip, tile.inPip] : [tile.inPip, tile.outPip]);
    if (direction === 'down') row = path.y - along;
    if (direction === 'right') col = path.x - along;
    // col/row are placement coordinates; x/y above are the exposed endpoint.
    if (direction === 'down' || direction === 'right') {
      const placed = positions.get(tile.placed.tile)!;
      placed.col = col;
      placed.row = row;
    }
    path.legBones += 1;
    path.lastDouble = tile.inPip === tile.outPip;
  }
  const placed = line.map((tile) => positions.get(tile.placed.tile)).filter((tile): tile is TilePlacement => Boolean(tile));
  return placed.length === line.length ? placed : layoutLine(line, width);
}

/**
 * Across is still one connected Jamaican domino line, but it has its own
 * table camera.  Keeping this entry point separate is deliberate: the Across
 * table locks a wide, shallow set of lanes before the first play, whereas
 * ordinary linear tables are free to use the whole measured rectangle.
 *
 * The physical elbows are identical to a real line (and to `layoutLine`), so
 * a preview and a committed tile meet at exactly the same pip.  What changes
 * is the contract at the call site: the lane width is chosen once from the
 * dedicated Across stage and never from a transient hand/action panel.
 */
export function layoutAcrossLine(line: OrientedTile[], laneUnits: number): TilePlacement[] {
  return layoutLine(line, laneUnits);
}

type RouteDirection = 'left' | 'right' | 'up' | 'down';
/** A bone's rectangle in units, relative to the centre of the pose (y grows downward). */
export interface RouteRect { x: number; y: number; w: number; h: number }

const ROUTE_STEP: Record<RouteDirection, readonly [number, number]> = {
  left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1],
};

export const PHONE_ROUTE_MIN_COLS = 12;
export const PHONE_ROUTE_MIN_ROWS = 16;

/** Where a phone board's pose sits and what no bone may touch, all in grid units. */
export interface PhoneRouteOptions {
  /** The pose's centre. Defaults to the middle of the grid. */
  origin?: { x: number; y: number };
  /**
   * Rectangles no bone may cover: the players' portraits and racks. The board
   * uses the whole felt and flows round them instead of shrinking to the strip
   * between them (owner, 2026-09-14: bigger bones, no wasted wood).
   */
  blocked?: readonly RouteRect[];
  /**
   * How many dominoes stand in every climb between rows (default 2). One left
   * the rows squashed together (owner, 2026-09-14: "at least 2 vertical
   * dominoes"), and the count must be the same in every climb of every hand.
   * Doubles in a climb are extra: they are only half a domino tall.
   */
  climb?: number;
  /**
   * Bones each end lays along the centre row before its first climb (owner,
   * 2026-09-15: "center ... 3 or 4 across then down from the right and then
   * left, and the other side the opposite", a centre row of 7 or 8). Unset,
   * the centre row runs to the edge as on a phone. Later rows use the width.
   */
  firstRowBones?: number;
  /**
   * Sizing only: how many corpus hands may outgrow the board. Phones accept
   * PHONE_ROUTE_CORPUS_TOLERANCE; desktop accepts none, because a bone that
   * outgrows the wood there is clipped under the table edge or the hand
   * (owner, 2026-09-15: "6/1 ... does not show").
   */
  tolerance?: number;
}

/** The pose's rectangle: a double stands crosswise, an ordinary bone lies along the line. */
export function phoneRoutePose(poseIsDouble: boolean): RouteRect {
  return poseIsDouble
    ? { x: -TILE_SHORT / 2, y: -TILE_LONG / 2, w: TILE_SHORT, h: TILE_LONG }
    : { x: -TILE_LONG / 2, y: -TILE_SHORT / 2, w: TILE_LONG, h: TILE_SHORT };
}

const routeNear = (a: RouteRect, b: RouteRect, gap: number) =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

/** The rectangle a bone of this length and width occupies leaving (x, y) in `d`, centred on the line. */
function routeRect(x: number, y: number, d: RouteDirection, along: number, across: number): RouteRect {
  if (d === 'right') return { x, y: y - across / 2, w: along, h: across };
  if (d === 'left') return { x: x - along, y: y - across / 2, w: along, h: across };
  if (d === 'down') return { x: x - across / 2, y, w: across, h: along };
  return { x: x - across / 2, y: y - along, w: across, h: along };
}

function routeGrown(r: RouteRect, d: RouteDirection, by: number): RouteRect {
  if (d === 'right') return { ...r, w: r.w + by };
  if (d === 'left') return { ...r, x: r.x - by, w: r.w + by };
  if (d === 'down') return { ...r, h: r.h + by };
  return { ...r, y: r.y - by, h: r.h + by };
}

export type PhoneRoutePlay = { end: 'left' | 'right'; double: boolean };

/**
 * Mobile Practice's board, laid the way the owner's JamDom video lays a real
 * table (2026-09-14): the line runs along the centre row to the edge; the LEFT
 * end then climbs the left side and runs right across the top, the RIGHT end
 * drops down the right side and runs left across the bottom, and each keeps
 * turning inward round its own half.
 *
 * Plays are laid in the order they were made, and a bone's place depends only
 * on the bones already down, so no bone ever moves.
 *
 * Every lane is a double's width (4 units) so a double can always stand across
 * it, and a straight bone must leave one unit before whatever it heads into so
 * the next leg has its lane. Bones meet edge to edge. A turning bone lies
 * across the end of the line, flush with the outer half of the bone it joins,
 * as in the JamDom recording.
 *
 * Doubles always stand across the line they arrive on. A double with room goes
 * straight and the next leg leaves from its end; a double with no room ahead is
 * the corner itself, laid where a turning bone goes -- still across the line it
 * arrived on, never lying along it (owner, 2026-09-14: a 3-3 had been laid
 * along the end bone and the line bent off its side).
 *
 * Bones keep a unit of felt from every bone except the one they join; the bone
 * before that may touch at an elbow. Each end prefers its own half. If a very
 * long end runs out of room there, it takes free space anywhere rather than
 * overflow.
 */
export function phoneRouteRects(
  plays: readonly PhoneRoutePlay[], widthUnits: number, heightUnits: number, poseIsDouble: boolean,
  options: PhoneRouteOptions = {},
): { rects: Array<RouteRect & { end: 'left' | 'right' }>; overflow: number } {
  const pose = phoneRoutePose(poseIsDouble);
  const origin = options.origin ?? { x: widthUnits / 2, y: heightUnits / 2 };
  const minX = -origin.x;
  const maxX = widthUnits - origin.x;
  const minY = -origin.y;
  const maxY = heightUnits - origin.y;
  const blocked = (options.blocked ?? []).map((b) => ({ ...b, x: b.x - origin.x, y: b.y - origin.y }));
  const ends = {
    left: { x: pose.x, y: 0, dir: 'left' as RouteDirection, lastAcross: pose.h, lastRun: 'left' as RouteDirection, climbed: 0, rowBones: 0, firstRow: true, own: [] as RouteRect[] },
    right: { x: pose.x + pose.w, y: 0, dir: 'right' as RouteDirection, lastAcross: pose.h, lastRun: 'right' as RouteDirection, climbed: 0, rowBones: 0, firstRow: true, own: [] as RouteRect[] },
  };
  const climb = options.climb ?? 2;
  const placed: RouteRect[] = [];
  const out: Array<RouteRect & { end: 'left' | 'right' }> = [];
  let overflow = 0;
  const OPPOSITE: Record<RouteDirection, RouteDirection> = { left: 'right', right: 'left', up: 'down', down: 'up' };

  for (const play of plays) {
    const state = ends[play.end];
    const along = play.double ? TILE_SHORT : TILE_LONG;
    const across = play.double ? TILE_LONG : TILE_SHORT;
    // The left end works upward from the centre row, the right end downward.
    const away: RouteDirection = play.end === 'left' ? 'up' : 'down';
    // The left end owns the upper half and the centre row left of the pose;
    // the right end owns the lower half and the centre row right of it.
    const ownHalf = (r: RouteRect) => play.end === 'left'
      ? !(r.y + r.h > 2 || (r.x + r.w > pose.x + pose.w && r.y + r.h > -2))
      : !(r.y < -2 || (r.x < pose.x && r.y < 2));
    const joins = state.own[state.own.length - 1];
    const elbow = state.own[state.own.length - 2];
    const inBounds = (r: RouteRect) => r.x >= minX && r.x + r.w <= maxX && r.y >= minY && r.y + r.h <= maxY;
    // `lane` is the double-wide strip the bone reserves, plus the unit the
    // next leg needs to turn; `bone` is the bone itself. The lane may touch
    // other bones but never cover them; the bone keeps a unit of felt.
    const clear = (lane: RouteRect, bone: RouteRect, keepToHalf: boolean) => {
      if (!inBounds(lane)) return false;
      if (keepToHalf && !ownHalf(lane)) return false;
      for (const b of blocked) if (routeNear(lane, b, 0)) return false;
      if (state.own.length > 0 && (routeNear(bone, pose, 1) || routeNear(lane, pose, 0))) return false;
      for (const other of placed) {
        if (other === joins) continue;
        if (other === elbow) {
          if (routeNear(bone, other, 0)) return false;
          continue;
        }
        // A double may touch the row beside it where two doubles line up:
        // keeping a unit of felt there bent the row off its line.
        if (routeNear(bone, other, play.double ? 0 : 1) || routeNear(lane, other, 0)) return false;
      }
      return true;
    };
    const straightFits = (length: number, width: number, keepToHalf: boolean) => clear(
      routeGrown(routeRect(state.x, state.y, state.dir, length, TILE_LONG), state.dir, 1),
      routeRect(state.x, state.y, state.dir, length, width), keepToHalf);
    const straight = (keepToHalf: boolean) => straightFits(along, across, keepToHalf)
      ? { x: state.x, y: state.y, d: state.dir, bone: routeRect(state.x, state.y, state.dir, along, across), advance: along }
      : null;
    const turn = (to: RouteDirection, keepToHalf: boolean) => {
      const [dx, dy] = ROUTE_STEP[state.dir];
      const [tx, ty] = ROUTE_STEP[to];
      const leg = (x: number, y: number) => {
        const bone = routeRect(x, y, to, TILE_LONG, TILE_SHORT);
        const lane = routeGrown(routeRect(x, y, to, TILE_LONG, TILE_LONG), to, 1);
        return clear(lane, bone, keepToHalf) ? { x, y, d: to, bone, advance: TILE_LONG } : null;
      };
      // A double on a turn makes the L, as in the JamDom recording: it lies
      // past the end of the line, one half level with the line it arrived on
      // and the other half out into the turn, and the line carries on from
      // that outer half. Never docked at its waist like a T.
      const lDouble = play.double ? leg(state.x + dx - tx, state.y + dy - ty) : null;
      // An ordinary bone turns from the side of the last bone's outward half.
      return lDouble ?? leg(state.x - dx + tx * (state.lastAcross / 2), state.y - dy + ty * (state.lastAcross / 2));
    };
    const horizontal = state.dir === 'left' || state.dir === 'right';
    let chosen: { x: number; y: number; d: RouteDirection; bone: RouteRect; advance: number } | null = null;
    for (const keepToHalf of [true, false]) {
      // Rows run to the edge, then the line climbs and comes back across, so
      // the bones snake in rows and a long end never walls itself in.
      if (horizontal) {
        // A double arriving where an ordinary bone could not go on is the turn.
        const rowFull = options.firstRowBones !== undefined && state.firstRow
          && state.rowBones >= options.firstRowBones;
        const turnsHere = rowFull || (play.double && !straightFits(TILE_LONG, TILE_SHORT, keepToHalf));
        chosen = turnsHere
          ? turn(away, keepToHalf) ?? straight(keepToHalf) ?? turn(OPPOSITE[away], keepToHalf)
          : straight(keepToHalf) ?? turn(away, keepToHalf) ?? turn(OPPOSITE[away], keepToHalf);
      } else {
        // Every climb between rows is exactly `climb` full dominoes, so rows
        // keep the same wood between them in every hand; then the line comes
        // back across. Counting height instead let a double (half a domino
        // tall) make one climb three dominoes and a corner double make the
        // next one look like a single domino.
        // A climb turns early only where the table stops it: the partner's rack
        // or the top or bottom edge, in the last row of a long hand. Forcing
        // two dominoes there too made one hand in seven resize mid-hand
        // (measured 2026-09-14), against one in twenty with this exception.
        chosen = state.climbed < climb
          ? straight(keepToHalf) ?? turn(OPPOSITE[state.lastRun], keepToHalf) ?? turn(state.lastRun, keepToHalf)
          : turn(OPPOSITE[state.lastRun], keepToHalf) ?? straight(keepToHalf) ?? turn(state.lastRun, keepToHalf);
      }
      if (chosen) break;
    }
    if (!chosen) {
      overflow += 1;
      chosen = {
        x: state.x, y: state.y, d: state.dir,
        bone: routeRect(state.x, state.y, state.dir, along, across), advance: along,
      };
    }
    const [dx, dy] = ROUTE_STEP[chosen.d];
    state.x = chosen.x + dx * chosen.advance;
    state.y = chosen.y + dy * chosen.advance;
    const climbing = chosen.d === 'up' || chosen.d === 'down';
    if (climbing) { state.firstRow = false; state.rowBones = 0; } else { state.rowBones += 1; }
    const fullDomino = !play.double;
    state.climbed = !climbing ? 0 : (chosen.d === state.dir ? state.climbed : 0) + (fullDomino ? 1 : 0);
    state.dir = chosen.d;
    if (chosen.d === 'left' || chosen.d === 'right') state.lastRun = chosen.d;
    state.lastAcross = chosen.bone.w === chosen.advance ? chosen.bone.h : chosen.bone.w;
    state.own.push(chosen.bone);
    placed.push(chosen.bone);
    out.push({ ...chosen.bone, end: play.end });
  }
  return { rects: out, overflow };
}

/**
 * How many of the PHONE_ROUTE_CORPUS hands a board may fail to hold. The corpus
 * is the 400 hardest of 20,000 simulated hands, and its failures track the
 * whole population's closely (at 390px and 14px units: 16 of 400 here, 15 in a
 * fresh 20,000), so 20 is roughly one hand in a thousand. Such a hand is laid
 * again one size smaller when it runs out of room (see main.ts); holding every
 * hand instead cost the owner's older players four pixels of bone on every
 * hand (owner, 2026-09-14: "dominoes much bigger").
 */
export const PHONE_ROUTE_CORPUS_TOLERANCE = 20;

let phoneRouteCorpusCache: Array<{ poseIsDouble: boolean; plays: PhoneRoutePlay[] }> | null = null;
function phoneRouteCorpus() {
  phoneRouteCorpusCache ??= PHONE_ROUTE_CORPUS.map((code) => ({
    poseIsDouble: code[0] === 'D',
    plays: [...code.slice(1)].map((c) => ({ end: c.toLowerCase() === 'l' ? 'left' as const : 'right' as const, double: c === 'L' || c === 'R' })),
  }));
  return phoneRouteCorpusCache;
}

/** True when the board holds all but PHONE_ROUTE_CORPUS_TOLERANCE of the sizing hands. */
export function phoneRouteFits(widthUnits: number, heightUnits: number, options: PhoneRouteOptions = {}): boolean {
  if (widthUnits < PHONE_ROUTE_MIN_COLS || heightUnits < PHONE_ROUTE_MIN_ROWS) return false;
  const origin = options.origin ?? { x: widthUnits / 2, y: heightUnits / 2 };
  const pose = { x: origin.x - TILE_LONG / 2, y: origin.y - TILE_LONG / 2, w: TILE_LONG, h: TILE_LONG };
  if ((options.blocked ?? []).some((b) => routeNear(pose, b, 2))) return false;
  let failures = 0;
  for (const hand of phoneRouteCorpus()) {
    if (phoneRouteRects(hand.plays, widthUnits, heightUnits, hand.poseIsDouble, options).overflow === 0) continue;
    failures += 1;
    if (failures > (options.tolerance ?? PHONE_ROUTE_CORPUS_TOLERANCE)) return false;
  }
  return true;
}

/**
 * Place a whole phone Practice line on a `widthUnits` x `heightUnits` grid.
 * Returns null when the moves do not describe `line`.
 */
export function layoutPhoneRoute(
  line: OrientedTile[], moves: readonly Move[], widthUnits: number, heightUnits: number,
  options: PhoneRouteOptions = {},
): TilePlacement[] | null {
  return phoneRoutePlacements(line, moves, widthUnits, heightUnits, options)?.placements ?? null;
}

/** layoutPhoneRoute, also saying how many bones found no room (0 on a board the sizing accepted). */
export function phoneRoutePlacements(
  line: OrientedTile[], moves: readonly Move[], widthUnits: number, heightUnits: number,
  options: PhoneRouteOptions = {},
): { placements: TilePlacement[]; overflow: number } | null {
  const byTile = new Map(line.map((tile) => [tile.placed.tile, tile]));
  const poseMove = moves.find((move) => move.kind === 'pose');
  const poseTile = poseMove && poseMove.kind === 'pose' ? byTile.get(poseMove.tile) : undefined;
  if (!poseTile) return null;
  const isDouble = (tile: OrientedTile) => tile.inPip === tile.outPip;
  const order: Array<{ tile: OrientedTile; end: 'left' | 'right' }> = [];
  for (const move of moves) {
    if (move.kind !== 'play') continue;
    const tile = byTile.get(move.tile);
    if (!tile) return null;
    order.push({ tile, end: move.end });
  }
  const poseIsDouble = isDouble(poseTile);
  const { rects, overflow } = phoneRouteRects(
    order.map(({ tile, end }) => ({ end, double: isDouble(tile) })), widthUnits, heightUnits, poseIsDouble, options);
  const originCol = options.origin?.x ?? widthUnits / 2;
  const originRow = options.origin?.y ?? heightUnits / 2;
  const positions = new Map<string, TilePlacement>();
  const place = (tile: OrientedTile, rect: RouteRect, reverse: boolean) => {
    positions.set(tile.placed.tile, {
      placed: tile.placed,
      orient: rect.w === TILE_LONG ? 'h' : 'v',
      faces: reverse ? [tile.outPip, tile.inPip] : [tile.inPip, tile.outPip],
      col: rect.x + originCol,
      row: rect.y + originRow,
      colSpan: rect.w,
      rowSpan: rect.h,
    });
  };
  place(poseTile, phoneRoutePose(poseIsDouble), false);
  const previous: Partial<Record<'left' | 'right', RouteRect>> = {};
  order.forEach(({ tile, end }, i) => {
    const rect = rects[i];
    const before = previous[end];
    const travel: RouteDirection = before ? directionBetween(before, rect) : end;
    // Faces are stored in line order (left end first). Reading left-to-right or
    // top-to-bottom, a bone is reversed when it travels back towards the pose's
    // side of the line: rightward or downward on the left end, leftward or
    // upward on the right end.
    const reverse = end === 'left'
      ? travel === 'right' || travel === 'down'
      : travel === 'left' || travel === 'up';
    place(tile, rect, reverse);
    previous[end] = rect;
  });
  const result = line.map((tile) => positions.get(tile.placed.tile));
  return result.every((tile): tile is TilePlacement => Boolean(tile)) ? { placements: result, overflow } : null;
}

/** Which way the line travelled from `from` to the bone `to` that joins it. */
function directionBetween(from: RouteRect, to: RouteRect): RouteDirection {
  if (to.x >= from.x + from.w) return 'right';
  if (to.x + to.w <= from.x) return 'left';
  if (to.y >= from.y + from.h) return 'down';
  return 'up';
}
