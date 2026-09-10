import { halves, isDouble, matches } from '@yard/engine';
import type { AnyBoard, Board, CrossBoard, HandResult, PenaltyEvent, Pip, TileId } from '@yard/engine';
import { layoutLine, MIN_WIDTH_UNITS, orientLine } from './layout.ts';
import type { OrientedTile, TilePlacement } from './layout.ts';

/** Pip positions on a 3x3 grid, per face value, for a vertical half. */
const LAYOUT: Record<number, number[]> = {
  0: [],
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

/** Same pip pattern rotated a quarter turn, for halves lying sideways. */
const rot90 = (i: number) => (i % 3) * 3 + (2 - Math.floor(i / 3));

/**
 * The engine is authoritative, but a renderer must still refuse a board that
 * cannot exist on a real table. This catches malformed fixtures, optimistic
 * views and future client regressions before they become a convincing-looking
 * but impossible chain.
 */
export function assertRenderableBoard(board: AnyBoard): void {
  const seen = new Set<TileId>();
  const add = (tile: TileId) => {
    if (seen.has(tile)) throw new Error(`duplicate rendered tile: ${tile}`);
    seen.add(tile);
  };

  if (board.kind === 'linear') {
    let exposed = board.leftEnd;
    for (const placed of board.line) {
      add(placed.tile);
      const [a, b] = halves(placed.tile);
      if (a !== exposed && b !== exposed) {
        throw new Error(`broken rendered join at ${placed.tile}: expected ${exposed}`);
      }
      exposed = (a === exposed ? b : a) as Pip;
    }
    if (board.line.length > 0 && exposed !== board.rightEnd) {
      throw new Error(`broken rendered right end: expected ${board.rightEnd}, got ${exposed}`);
    }
    return;
  }

  const [centreA, centreB] = halves(board.center);
  if (centreA !== centreB) throw new Error(`French centre is not a double: ${board.center}`);
  if (board.arms.length > 4) throw new Error(`French board has ${board.arms.length} arms`);
  add(board.center);
  const directions = ['right', 'left', 'up', 'down'] as const;
  for (let index = 0; index < board.arms.length; index++) {
    const arm = board.arms[index];
    if (arm.direction !== directions[index]) {
      throw new Error(`French arm ${index} is ${arm.direction}, expected ${directions[index]}`);
    }
    let exposed: Pip = centreA;
    for (const placed of arm.tiles) {
      add(placed.tile);
      const [a, b] = halves(placed.tile);
      if (a !== exposed && b !== exposed) {
        throw new Error(`broken rendered ${arm.direction} arm at ${placed.tile}: expected ${exposed}`);
      }
      exposed = (a === exposed ? b : a) as Pip;
    }
    if (arm.tiles.length > 0 && exposed !== arm.openEnd) {
      throw new Error(`broken rendered ${arm.direction} open end: expected ${arm.openEnd}, got ${exposed}`);
    }
  }
}

/** The viewer's own visible hand and the played board are disjoint objects. */
export function assertVisibleTilesDisjoint(board: AnyBoard | null, hand: readonly TileId[]): void {
  if (!board) return;
  const onBoard = board.kind === 'linear'
    ? new Set(board.line.map(({ tile }) => tile))
    : new Set([board.center, ...board.arms.flatMap((arm) => arm.tiles.map(({ tile }) => tile))]);
  const duplicate = hand.find((tile) => onBoard.has(tile));
  if (duplicate) throw new Error(`played tile still visible in hand: ${duplicate}`);
}

function face(value: number, sideways = false): HTMLElement {
  const half = document.createElement('div');
  half.className = 'half';
  const cells = (LAYOUT[value] ?? []).map((i) => (sideways ? rot90(i) : i));
  for (let i = 0; i < 9; i++) {
    const cell = document.createElement('span');
    if (cells.includes(i)) cell.appendChild(document.createElement('b'));
    half.appendChild(cell);
  }
  return half;
}

/** A vertical tile for the hand rack. Board tiles are built by renderBoard. */
export function tileEl(id: TileId): HTMLElement {
  const [a, b] = halves(id);
  const el = document.createElement('div');
  el.className = 'tile';
  el.dataset.tile = id;
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', `${a} ${b}`);
  el.appendChild(face(a));
  const bar = document.createElement('div');
  bar.className = 'bar';
  el.appendChild(bar);
  el.appendChild(face(b));
  return el;
}

/** A small board bone with its exact visible left and right halves supplied. */
export function horizontalTileEl(id: TileId, faces: [Pip, Pip]): HTMLElement {
  const canonical = halves(id);
  if ([...faces].sort().join('-') !== [...canonical].sort().join('-')) {
    throw new Error(`Faces ${faces.join('-')} do not belong to ${id}`);
  }
  const el = document.createElement('div');
  el.className = 'tile h';
  el.dataset.tile = id;
  el.dataset.visibleHalves = faces.join('-');
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', `${faces[0]} ${faces[1]}`);
  el.appendChild(face(faces[0], true));
  const bar = document.createElement('div');
  bar.className = 'bar';
  el.appendChild(bar);
  el.appendChild(face(faces[1], true));
  return el;
}

/**
 * Give a domino win one deliberate, theatrical beat without touching the
 * board state. The real winning bone remains in its legal position; this is
 * an aria-hidden visual clone that rises toward the player and disappears.
 * Keeping it here means local and online tables share exactly the same
 * treatment, and the clone always uses the canonical upright tile artwork.
 */
export function celebrateWinningTile(
  id: TileId,
  line: HTMLElement,
  felt: HTMLElement,
): void {
  const landed = line.querySelector(`[data-tile="${id}"]`);
  landed?.classList.add('final-spin');
  felt.classList.add('shake');

  // A resize can rebuild the line during the animation. Never stack a second
  // foreground bone inside the same felt when that happens.
  if (felt.querySelector('.final-bone-hero')) return;
  const hero = tileEl(id);
  hero.classList.add('final-bone-hero');
  hero.setAttribute('aria-hidden', 'true');
  hero.removeAttribute('role');
  felt.appendChild(hero);
}

function boardTile(p: TilePlacement): HTMLElement {
  const el = document.createElement('div');
  el.className = 'tile ' + (p.orient === 'h' ? 'h' : 'v');
  el.dataset.tile = p.placed.tile;
  if (p.crossArm !== undefined) el.dataset.crossArm = String(p.crossArm);
  if (p.crossStep !== undefined) el.dataset.crossStep = String(p.crossStep);
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', `${p.faces[0]} ${p.faces[1]}`);
  el.appendChild(face(p.faces[0], p.orient === 'h'));
  const bar = document.createElement('div');
  bar.className = 'bar';
  el.appendChild(bar);
  el.appendChild(face(p.faces[1], p.orient === 'h'));
  return el;
}

/**
 * One layout unit is half a tile's short side — a tile is 2 units across and
 * 4 long (see layout.ts). The unit is therefore the single number deciding
 * whether the board reads as real dominoes or as counters, which is why it is
 * measured rather than guessed: it used to be a hardcoded 13 or 15, so the
 * felt stretched to the screen while the bones stayed the same size on a
 * phone and a 27-inch monitor alike.
 */
const MIN_UNIT = 11;
/* A four-way French board spends units in every direction. Twelve remains the
   smallest useful half-bone unit on a constrained view; the live router bends
   arms into quadrants so ordinary boards stay well above that floor. */
const CROSS_MIN_UNIT = 12;
/* A hand is capped at a 56px short side on roomy screens. Keeping the board
   at that same ceiling makes an early played bone read as the same physical
   object as the one it just left, instead of ballooning 40% larger. */
const MAX_UNIT = 32;

/** Felt border + felt padding + the line's own padding, both sides. */
const CHROME_X = 2 * (6 + 12 + 10);
const CHROME_Y = 2 * (6 + 14 + 10);

export interface BoardFit {
  /** Cap the width in units — the hero uses it to keep its demo line short. */
  maxUnits?: number;
  /** Cap one layout unit. Live phone tables use this to keep a newly played
   *  bone the same physical size as the bone in the seven-tile hand. */
  maxUnit?: number;
  /** Pin one physical unit. Live tables use this to match hand, board and backs. */
  unit?: number;
  /**
   * The smallest readable unit this particular view may use. Live play keeps
   * the default so tiles stay generous to tap; Watch Back may go smaller to
   * show a completed line without making people pan across it.
   */
  minUnit?: number;
  /** The real box to lay the line out inside, measured by the caller from
   *  the actual attached DOM element. Falls back to feltBox()'s
   *  window-based guess when omitted (main.ts's local play, the hero demo,
   *  and the very first render before the felt has been measured). */
  box?: BoardBox;
}

/** The box the grid has to live inside, in CSS pixels. */
export interface BoardBox { width: number; height: number }

/** The live board's pre-deal physical size, in half-bone units. */
export function liveTableUnit(
  viewportWidth: number,
  board: AnyBoard | null,
  french = false,
): number {
  if (french || board?.kind === 'cross') {
    // The approved reference is JamDom's 30×60 bone on a 1000×800 desktop
    // surface. Preserve that ratio as the table grows and, critically, do not
    // consult the number played. A bone is one physical object from deal to
    // final play; the route must absorb a crowded board, never the bone size.
    if (viewportWidth <= 700) return 14; // 28px short side on a phone.
    return Math.max(15, Math.min(30, Math.round(viewportWidth * .0125)));
  }
  if (viewportWidth <= 700) {
    // Flat, exactly like the French branch above, and for the same reason: the
    // bone is one physical object from deal to final play. This used to step
    // 14 → 12 → 10 as the chain filled, so a player watched their own hand
    // shrink under their thumb as the hand went on — the single loudest
    // difference between this table and the one JamDom players know.
    // A crowded board is the ROUTE's problem: the line turns and snakes, and
    // the stage pans. See docs/prototypes/french-reference/CLAUDE.md.
    return 14; // 28px short side, matching French on the same viewport.
  }
  if (viewportWidth <= 960) return 20;
  if (viewportWidth <= 1440) return 26;
  return 32;
}

/** What the felt actually offers: app column capped at 940, felt at 64vh. */
function feltBox(): BoardBox {
  return {
    width: Math.min(window.innerWidth, 1200) - 32 - CHROME_X,
    height: Math.min(window.innerHeight * 0.72, 680) - CHROME_Y,
  };
}

export function rowsOf(placements: TilePlacement[]): number {
  const min = Math.min(...placements.map((p) => p.row));
  const max = Math.max(...placements.map((p) => p.row + p.rowSpan));
  return max - min;
}

/**
 * The largest tiles this line fits in at. Pure, so it can be tested without
 * a browser — `feltBox()` is the only part that reads the window, and
 * `renderBoard` hands its result in.
 *
 * Bigger tiles mean fewer units across, which means more rows, which needs
 * more height — so the size cannot be solved directly and is searched for
 * instead, largest first. `layoutLine` is pure and a hand is at most 28
 * tiles, so trying every size costs nothing measurable.
 *
 * A four-tile opening therefore renders big and a full board still fits,
 * where before both rendered identically small.
 */
export function chooseUnit(
  line: OrientedTile[], box: BoardBox, opts: BoardFit = {},
): { u: number; placements: TilePlacement[] } {
  const cap = opts.maxUnits ?? Infinity;
  const minUnit = opts.minUnit ?? MIN_UNIT;

  const at = (u: number) => {
    const across = Math.min(Math.floor(box.width / u), cap);
    // Narrower than this and layoutLine has no room to turn the elbow.
    return across < MIN_WIDTH_UNITS ? null : layoutLine(line, across);
  };

  if (opts.unit) {
    const placements = at(opts.unit);
    if (placements) return { u: opts.unit, placements };
  }

  let last: { u: number; placements: TilePlacement[] } | null = null;
  const maxUnit = Math.min(MAX_UNIT, opts.maxUnit ?? MAX_UNIT);
  for (let u = maxUnit; u >= minUnit; u--) {
    const placements = at(u);
    if (!placements) continue;
    last = { u, placements };
    if (rowsOf(placements) * u <= box.height) return last;
  }
  // Nothing fit the height budget — take the smallest and let the felt
  // scroll, which is what it did for every board before this.
  return last ?? { u: minUnit, placements: layoutLine(line, MIN_WIDTH_UNITS) };
}

/**
 * Draw the line the way it sits on a real Jamaican table: tiles end to end
 * with touching halves matching, doubles crosswise in the line, and the line
 * snaking 90° at the table edge. Layout math lives in layout.ts.
 */
export function renderBoard(host: HTMLElement, board: AnyBoard | null, opts: BoardFit = {}) {
  host.innerHTML = '';
  if (!board) {
    host.style.gridTemplateColumns = '';
    host.style.gridTemplateRows = '';
    return opts.unit ?? opts.maxUnit ?? null;
  }
  assertRenderableBoard(board);
  if (board.kind === 'cross') return renderCross(host, board, opts);
  if (board.line.length === 0) {
    host.style.gridTemplateColumns = '';
    host.style.gridTemplateRows = '';
    return opts.unit ?? opts.maxUnit ?? null;
  }

  const { u, placements } = chooseUnit(orientLine(board), opts.box ?? feltBox(), opts);

  const maxCol = Math.max(...placements.map((p) => p.col + p.colSpan));
  const minRow = Math.min(...placements.map((p) => p.row));
  const maxRow = Math.max(...placements.map((p) => p.row + p.rowSpan));

  host.style.gridTemplateColumns = `repeat(${maxCol}, ${u}px)`;
  host.style.gridTemplateRows = `repeat(${maxRow - minRow}, ${u}px)`;

  placements.forEach((p, i) => {
    const node = boardTile(p);
    node.style.gridColumn = `${p.col + 1} / span ${p.colSpan}`;
    node.style.gridRow = `${p.row - minRow + 1} / span ${p.rowSpan}`;
    node.style.setProperty('--i', String(i));
    host.appendChild(node);
  });
  return u;
}

interface CrossLayout {
  totalCols: number;
  totalRows: number;
  /**
   * Unlike TilePlacement's col/row (0-based, +1'd at DOM-application time —
   * see renderBoard's linear path), these are 1-based CSS grid line numbers,
   * applied directly. The cross board's centring math reads more clearly
   * that way, since the chucha's own position (centerCol/centerRow) is
   * naturally a 1-based grid line to begin with.
   */
  placements: TilePlacement[];
}

/**
 * Lay one canonical French arm east from the spinner, turn it south at most
 * once, then keep travelling south. The caller rotates that route into the
 * arm's real quadrant. Two ordinary bones (8 half-bone units) fit before the
 * earliest elbow. Unlike layoutLine(), this route can never snake back into
 * the spinner or cross a neighbouring arm after a second turn.
 */
function layoutSingleTurnArm(line: OrientedTile[], laneUnits: number): TilePlacement[] {
  const lane = Math.max(MIN_WIDTH_UNITS, laneUnits);
  const placements: TilePlacement[] = [];
  let x = 0;
  let turned = false;
  let tailCol = 0;
  let tailRow = 0;
  let previousStraightDouble = false;

  for (let index = 0; index < line.length; index++) {
    const tile = line[index];
    const double = tile.inPip === tile.outPip;
    const advance = double ? 2 : 4;

    // A double remains crosswise on the current run; wait for the next
    // ordinary bone to make the physical elbow.
    if (!turned && index >= 2 && !double && x + advance > lane) {
      tailCol = x - 2;
      const elbowRow = previousStraightDouble ? 4 : 3;
      tailRow = elbowRow + 4;
      placements.push({
        placed: tile.placed,
        orient: 'v',
        faces: [tile.inPip, tile.outPip],
        col: tailCol,
        row: elbowRow,
        colSpan: 2,
        rowSpan: 4,
      });
      turned = true;
      continue;
    }

    if (!turned) {
      placements.push(double ? {
        placed: tile.placed,
        orient: 'v',
        faces: [tile.inPip, tile.outPip],
        col: x,
        row: 0,
        colSpan: 2,
        rowSpan: 4,
      } : {
        placed: tile.placed,
        orient: 'h',
        faces: [tile.inPip, tile.outPip],
        col: x,
        row: 1,
        colSpan: 4,
        rowSpan: 2,
      });
      x += advance;
      previousStraightDouble = double;
      continue;
    }

    placements.push(double ? {
      placed: tile.placed,
      orient: 'h',
      faces: [tile.inPip, tile.outPip],
      col: tailCol - 1,
      row: tailRow,
      colSpan: 4,
      rowSpan: 2,
    } : {
      placed: tile.placed,
      orient: 'v',
      faces: [tile.inPip, tile.outPip],
      col: tailCol,
      row: tailRow,
      colSpan: 2,
      rowSpan: 4,
    });
    tailRow += advance;
  }
  return placements;
}

/**
 * French cross board, pure layout math — same split as chooseUnit/layoutLine
 * for the linear board, so this is unit-testable without a DOM.
 *
 * Whatever double opened the hand sits at centre — the chucha (0-0) in
 * round 1, or the winner's own choice in round 2+ (see
 * HandState.poseMustBeAnyDouble) — with up to 4 arms beginning outward in
 * fixed order: right (0), left (1), up (2), down (3). Each arm then turns
 * clockwise inside its own quadrant, so a played-out hand uses the table's
 * area instead of becoming four long rays that can only fit as tiny bones.
 * Non-doubles lie along their route and occupy a 4×2 footprint; doubles lie
 * crosswise with the long side perpendicular to that route. Pip halves are
 * ordered after every rotation so the touching pips at each junction match.
 *
 * The finished route is shifted into a positive grid with one unit of clear
 * buffer around its measured bounds. The centre and all arm tiles keep the
 * same unit, material, and pip geometry as the visible hand.
 */
export function crossPlacements(
  board: CrossBoard,
  laneUnits: number | { horizontal: number; vertical: number } = MIN_WIDTH_UNITS,
): CrossLayout {
  const centerValue = halves(board.center)[0]; // center is always a double
  // Work around a centre at (0,0), then shift the finished four-quadrant
  // route into a positive CSS grid. Each arm reuses the proven Jamaican
  // snake layout: right bends down, down bends left, left bends up, and up
  // bends right. Long arms therefore occupy their own quadrant instead of
  // becoming four indefinitely straight rays that force the whole set tiny.
  const placements: TilePlacement[] = [{
    placed: { tile: board.center, crosswise: true },
    orient: 'v',
    faces: [centerValue, centerValue],
    col: -1, row: -1, colSpan: 2, rowSpan: 2,
  }];

  const rotatePoint = (x: number, y: number, turns: number): [number, number] => {
    if (turns === 1) return [-y, x];
    if (turns === 2) return [-x, -y];
    if (turns === 3) return [y, -x];
    return [x, y];
  };
  const origins: Record<CrossBoard['arms'][number]['direction'], [number, number, number]> = {
    right: [1, 0, 0], down: [0, 1, 1], left: [-1, 0, 2], up: [0, -1, 3],
  };

  for (const [armIndex, arm] of board.arms.entries()) {
    let anchor: Pip = centerValue;
    const oriented: OrientedTile[] = arm.tiles.map((p) => {
      const [a, b] = halves(p.tile);
      const inPip = (a === anchor ? a : b) as Pip;
      const outPip = (a === anchor ? b : a) as Pip;
      anchor = outPip;
      return { placed: p, inPip, outPip };
    });
    const [originX, originY, turns] = origins[arm.direction];
    const lane = typeof laneUnits === 'number'
      ? laneUnits
      : arm.direction === 'right' || arm.direction === 'left'
        ? laneUnits.horizontal : laneUnits.vertical;
    layoutSingleTurnArm(oriented, lane).forEach((p, index) => {
      // The canonical first run is centred on zero before rotation around the
      // chucha. Every arm then occupies exactly one private quadrant.
      const localX = p.col;
      const localY = p.row - 2;
      const corners = [
        rotatePoint(localX, localY, turns),
        rotatePoint(localX + p.colSpan, localY, turns),
        rotatePoint(localX, localY + p.rowSpan, turns),
        rotatePoint(localX + p.colSpan, localY + p.rowSpan, turns),
      ];
      const xs = corners.map(([x]) => x);
      const ys = corners.map(([, y]) => y);
      const col = originX + Math.min(...xs);
      const row = originY + Math.min(...ys);
      const colSpan = Math.max(...xs) - Math.min(...xs);
      const rowSpan = Math.max(...ys) - Math.min(...ys);

      const centres: [[number, number], [number, number]] = p.orient === 'h'
        ? [[localX + p.colSpan * .25, localY + p.rowSpan / 2], [localX + p.colSpan * .75, localY + p.rowSpan / 2]]
        : [[localX + p.colSpan / 2, localY + p.rowSpan * .25], [localX + p.colSpan / 2, localY + p.rowSpan * .75]];
      const [first, second] = centres.map(([x, y]) => rotatePoint(x, y, turns)) as [[number, number], [number, number]];
      const orient = colSpan > rowSpan ? 'h' : 'v';
      const firstComesFirst = orient === 'h' ? first[0] < second[0] : first[1] < second[1];
      placements.push({
        ...p, orient, col, row, colSpan, rowSpan,
        faces: firstComesFirst ? p.faces : [p.faces[1], p.faces[0]],
        crossArm: armIndex,
        crossStep: index,
      });
    });
  }

  const minCol = Math.min(...placements.map((p) => p.col));
  const minRow = Math.min(...placements.map((p) => p.row));
  const maxCol = Math.max(...placements.map((p) => p.col + p.colSpan));
  const maxRow = Math.max(...placements.map((p) => p.row + p.rowSpan));
  const shiftCol = 2 - minCol;
  const shiftRow = 2 - minRow;
  for (const p of placements) { p.col += shiftCol; p.row += shiftRow; }
  return {
    totalCols: maxCol - minCol + 2,
    totalRows: maxRow - minRow + 2,
    placements,
  };
}

/**
 * Why `tile` can't be played on a French cross board right now — the message
 * behind the hand panel's "doesn't fit" line. Returns null when the tile
 * actually IS legal (callers only reach for this once legality already
 * failed, but staying honest here means a caller mistake shows up loudly
 * instead of lying to the player).
 *
 * A tile with a matching half is playable on an arm once that suit's own
 * double has been played anywhere on the board (board.doublesPlayed) — a
 * board-wide unlock, not scoped to whichever arm the double landed on. So
 * the only way a matching tile gets rejected here is when NO suit it carries
 * has had its double played yet at all.
 */
export function crossRejectReason(board: CrossBoard, tile: TileId): string | null {
  const [a, b] = halves(tile);
  if (board.arms.length < 4) {
    const centerValue = halves(board.center)[0];
    if (a === centerValue || b === centerValue) return null;
    return `Doesn't touch the ${centerValue} in the middle — a new arm has to start there.`;
  }
  const lockedEnds = new Set<Pip>();
  for (const arm of board.arms) {
    if (!matches(tile, arm.openEnd)) continue;
    const isSuitDouble = isDouble(tile) && halves(tile)[0] === arm.openEnd;
    if (isSuitDouble || board.doublesPlayed.includes(arm.openEnd)) return null;
    lockedEnds.add(arm.openEnd);
  }
  if (lockedEnds.size > 0) {
    const which = [...lockedEnds].join(' or ');
    return `The ${which} needs its own double played before anything else of that number can join the board.`;
  }
  return "Doesn't match any open end on the board.";
}

export interface CrossFit extends CrossLayout { u: number }

/** Number of real route changes in the rendered arms. Comparing placement
 * centres avoids mistaking a crosswise double for a bend. */
function crossBendCount(placements: TilePlacement[]): number {
  const hub = placements[0];
  const centre = (p: TilePlacement): [number, number] => [
    p.col + p.colSpan / 2,
    p.row + p.rowSpan / 2,
  ];
  let bends = 0;
  const arms = new Set(placements.flatMap((p) => p.crossArm === undefined ? [] : [p.crossArm]));
  for (const arm of arms) {
    const route = placements.filter((p) => p.crossArm === arm)
      .sort((a, b) => (a.crossStep ?? 0) - (b.crossStep ?? 0));
    let previous = hub;
    let previousAxis: 'h' | 'v' | null = null;
    for (const step of route) {
      const [x1, y1] = centre(previous);
      const [x2, y2] = centre(step);
      const axis = Math.abs(x2 - x1) >= Math.abs(y2 - y1) ? 'h' : 'v';
      if (previousAxis && axis !== previousAxis) bends += 1;
      previousAxis = axis;
      previous = step;
    }
  }
  return bends;
}

/**
 * Fit a four-way board by choosing both physical size and route. A live table
 * is normally much wider than it is tall, so forcing all four arms to turn at
 * one distance either wastes the width or wastes the height. Search a small
 * set of whole-bone lanes and let horizontal and vertical arms use different
 * turn points. This is deterministic and the set has at most 27 arm tiles.
 */
export function chooseCrossFit(board: CrossBoard, box: BoardBox, opts: BoardFit = {}): CrossFit {
  const minUnit = opts.minUnit ?? CROSS_MIN_UNIT;
  const maxUnit = Math.min(MAX_UNIT, opts.maxUnit ?? MAX_UNIT);
  // Every whole short-side step is a possible elbow. Searching the complete
  // range costs at most 13×13 tiny layouts for a 28-bone set and avoids
  // throwing away readable pixels because the best turn fell between coarse
  // 8/12/16-unit presets.
  const maxLane = Math.max(MIN_WIDTH_UNITS, Math.min(32, opts.maxUnits ?? 32));
  const lanes = Array.from(
    { length: Math.floor((maxLane - MIN_WIDTH_UNITS) / 2) + 1 },
    (_, index) => MIN_WIDTH_UNITS + index * 2,
  );
  let best: (CrossFit & { fits: boolean; overflow: number; fill: number; bends: number }) | null = null;
  for (const horizontal of lanes) for (const vertical of lanes) {
    const layout = crossPlacements(board, { horizontal, vertical });
    const wantU = Math.min(
      Math.floor(box.width / layout.totalCols),
      Math.floor(box.height / layout.totalRows),
    );
    const u = opts.unit
      ? Math.max(minUnit, Math.min(maxUnit, opts.unit))
      : Math.max(minUnit, Math.min(maxUnit, wantU || minUnit));
    const width = layout.totalCols * u;
    const height = layout.totalRows * u;
    const fits = width <= box.width && height <= box.height;
    const overflow = Math.max(width / box.width, height / box.height);
    const fill = (width / box.width) * (height / box.height);
    const bends = crossBendCount(layout.placements);
    const candidate = { ...layout, u, fits, overflow, fill, bends };
    if (!best
      || (candidate.fits && !best.fits)
      || (candidate.fits === best.fits && candidate.u > best.u)
      || (candidate.fits === best.fits && candidate.u === best.u
        && candidate.bends < best.bends)
      || (candidate.fits === best.fits && candidate.u === best.u
        && candidate.bends === best.bends
        && (candidate.fits ? candidate.fill > best.fill : candidate.overflow < best.overflow))) {
      best = candidate;
    }
  }
  return best!;
}

/** The largest unit a four-way board can use inside a particular felt box. */
export function chooseCrossUnit(board: CrossBoard, box: BoardBox, opts: BoardFit = {}): number {
  return chooseCrossFit(board, box, opts).u;
}

type ReferenceRoutePoint = readonly [x: number, y: number, orientation: 'h' | 'v'];

/** Measured from JamDom's public 450×390 French board (30×60 bones). */
const FRENCH_REFERENCE_ROUTES: Record<CrossBoard['arms'][number]['direction'], readonly ReferenceRoutePoint[]> = {
  right: [[270,195,'h'],[330,195,'h'],[390,195,'h'],[435,210,'v'],[435,270,'v'],[435,330,'v'],[420,375,'h'],[360,375,'h'],[300,375,'h'],[270,330,'v'],[270,270,'v'],[315,240,'h'],[375,240,'h'],[400,285,'v'],[385,330,'h'],[325,340,'h'],[305,295,'v']],
  left: [[180,195,'h'],[120,195,'h'],[60,195,'h'],[15,180,'v'],[15,120,'v'],[15,60,'v'],[30,15,'h'],[90,15,'h'],[150,15,'h'],[180,60,'v'],[180,120,'v'],[135,150,'h'],[75,150,'h'],[50,105,'v'],[65,60,'h'],[125,50,'h'],[145,95,'v'],[100,110,'h']],
  up: [[225,135,'v'],[225,75,'v'],[240,30,'h'],[300,30,'h'],[360,30,'h'],[420,30,'h'],[435,75,'v'],[435,135,'v'],[390,160,'h'],[330,160,'h'],[285,145,'v'],[270,85,'v'],[315,65,'h'],[375,65,'h'],[400,110,'v'],[355,125,'h']],
  down: [[225,255,'v'],[225,315,'v'],[210,360,'h'],[150,360,'h'],[90,360,'h'],[30,360,'h'],[15,315,'v'],[15,255,'v'],[60,230,'h'],[120,230,'h'],[165,245,'v'],[180,305,'v'],[135,325,'h'],[75,325,'h'],[50,280,'v'],[95,265,'h']],
};

function renderCross(host: HTMLElement, board: CrossBoard, opts: BoardFit) {
  const box = opts.box ?? feltBox();
  // One half-short-side unit is 15px in the 30×60 reference. Live callers
  // pin this before the deal; Watch Back may choose one smaller receipt size.
  const requested = opts.unit ?? Math.floor(Math.min(box.width / 30, box.height / 26));
  const u = Math.max(opts.minUnit ?? CROSS_MIN_UNIT, Math.min(opts.maxUnit ?? MAX_UNIT, requested));
  const short = u * 2;
  const scale = short / 30;
  host.classList.add('french-reference-route');
  host.style.gridTemplateColumns = '';
  host.style.gridTemplateRows = '';
  host.style.width = `${450 * scale}px`;
  host.style.height = `${390 * scale}px`;

  const pose = tileEl(board.center);
  pose.classList.add('hub');
  pose.style.width = `${short}px`;
  pose.style.height = `${short * 2}px`;
  pose.style.left = `${225 * scale - short / 2}px`;
  pose.style.top = `${195 * scale - short}px`;
  host.appendChild(pose);

  const centerValue = halves(board.center)[0];
  board.arms.forEach((arm, armIndex) => {
    let anchor = centerValue;
    let previous: readonly [number, number] = [225, 195];
    const route = FRENCH_REFERENCE_ROUTES[arm.direction];
    arm.tiles.forEach((placed, step) => {
      const point = route[step];
      if (!point) throw new Error(`French ${arm.direction} arm exceeds the measured route`);
      const [x, y, orient] = point;
      const [a, b] = halves(placed.tile);
      const inward = (a === anchor ? a : b) as Pip;
      const outward = (a === anchor ? b : a) as Pip;
      const forward = orient === 'h' ? x > previous[0] : y > previous[1];
      const faces: [Pip, Pip] = forward ? [inward, outward] : [outward, inward];
      const node = boardTile({
        placed, orient, faces,
        col: 0, row: 0,
        colSpan: orient === 'h' ? 4 : 2,
        rowSpan: orient === 'h' ? 2 : 4,
        crossArm: armIndex, crossStep: step,
      });
      const width = orient === 'h' ? short * 2 : short;
      const height = orient === 'h' ? short : short * 2;
      node.style.width = `${width}px`;
      node.style.height = `${height}px`;
      node.style.left = `${x * scale - width / 2}px`;
      node.style.top = `${y * scale - height / 2}px`;
      host.appendChild(node);
      anchor = outward;
      previous = [x, y];
    });
  });
  return u;
}

/**
 * Move a temporary "which end?" choice onto the exposed bones themselves.
 * The rendered grid is the source of truth here: French arms can turn as the
 * table fills, so a fixed compass button can point the wrong way after an
 * elbow. The marker follows the final two DOM placements and therefore stays
 * attached to the real open end at every fitted size in Practice and Lounge.
 */
export function placeBoardChoices(boardStage: HTMLElement, dock: HTMLElement | null): HTMLElement | null {
  if (!dock) return null;
  const row = dock.querySelector<HTMLElement>('[data-board-choice]');
  if (!row) return dock;

  const overlay = document.createElement('div');
  overlay.className = 'board-choice-overlay';
  overlay.setAttribute('aria-label', 'Choose where to play');
  const prompt = row.querySelector<HTMLElement>('.muted');
  if (prompt) {
    prompt.classList.add('sr-only');
    overlay.appendChild(prompt);
  }
  [...row.querySelectorAll<HTMLButtonElement>('button')].forEach((button) => {
    button.classList.add('board-end-choice');
    overlay.appendChild(button);
  });
  row.remove();
  boardStage.appendChild(overlay);

  const centre = (rect: DOMRect) => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  // The table's own first-frame measurement can resize the protected board
  // stage and rerender the line. Position one frame after that settles.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const stageRect = boardStage.getBoundingClientRect();
    const line = boardStage.querySelector<HTMLElement>('.line');
    if (!line || !stageRect.width || !stageRect.height) return;
    const hub = line.querySelector<HTMLElement>('.tile.hub');

    overlay.querySelectorAll<HTMLButtonElement>('.board-end-choice').forEach((button) => {
      let end: HTMLElement | null = null;
      let previous: HTMLElement | null = null;
      const arm = button.dataset.crossArm;
      if (arm !== undefined) {
        const tiles = [...line.querySelectorAll<HTMLElement>(`[data-cross-arm="${arm}"]`)]
          .sort((a, b) => Number(a.dataset.crossStep) - Number(b.dataset.crossStep));
        end = tiles.at(-1) ?? hub;
        previous = tiles.at(-2) ?? hub;
      } else if (button.dataset.linearEnd === 'left') {
        const tiles = [...line.querySelectorAll<HTMLElement>('.tile')];
        end = tiles[0] ?? null;
        previous = tiles[1] ?? null;
        if (tiles.length === 1) previous = null;
      } else if (button.dataset.linearEnd === 'right') {
        const tiles = [...line.querySelectorAll<HTMLElement>('.tile')];
        end = tiles.at(-1) ?? null;
        previous = tiles.at(-2) ?? null;
        if (tiles.length === 1) previous = null;
      }
      if (!end) return;

      const e = centre(end.getBoundingClientRect());
      const p = previous ? centre(previous.getBoundingClientRect()) : centre(stageRect);
      let dx = e.x - p.x;
      let dy = e.y - p.y;
      if (!previous && button.dataset.linearEnd) {
        dx = button.dataset.linearEnd === 'left' ? -1 : 1;
        dy = 0;
      }
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
        dx = button.dataset.linearEnd === 'left' ? -1 : 1;
        dy = 0;
      }
      const horizontal = Math.abs(dx) >= Math.abs(dy);
      const ux = horizontal ? Math.sign(dx) : 0;
      const uy = horizontal ? 0 : Math.sign(dy);
      const endRect = end.getBoundingClientRect();
      const distance = (horizontal ? endRect.width : endRect.height) / 2 + 22;
      const x = Math.max(24, Math.min(stageRect.width - 24, e.x - stageRect.left + ux * distance));
      const y = Math.max(24, Math.min(stageRect.height - 24, e.y - stageRect.top + uy * distance));
      const arrow = horizontal ? (ux < 0 ? '←' : '→') : (uy < 0 ? '↑' : '↓');
      const pip = button.dataset.openPip;
      button.textContent = pip ? `${arrow} ${pip}` : arrow;
      button.style.left = `${x}px`;
      button.style.top = `${y}px`;
    });
  }));

  return dock.childElementCount ? dock : null;
}

type GuardRect = Pick<DOMRect, 'top' | 'right' | 'bottom' | 'left'>;
type GuardEdge = 'top' | 'right' | 'bottom' | 'left';

/** Pure geometry behind the invisible square central-table guard. */
export function boardGuardInsets(
  felt: GuardRect,
  stage: GuardRect,
  obstacles: ReadonlyArray<{ edge: GuardEdge; rect: GuardRect }>,
  gap: number,
): { top: number; right: number; bottom: number; left: number } {
  const inset = {
    top: stage.top - felt.top,
    right: felt.right - stage.right,
    bottom: felt.bottom - stage.bottom,
    left: stage.left - felt.left,
  };
  for (const { edge, rect } of obstacles) {
    if (edge === 'top') inset.top = Math.max(inset.top, rect.bottom - felt.top + gap);
    if (edge === 'right') inset.right = Math.max(inset.right, felt.right - rect.left + gap);
    if (edge === 'bottom') inset.bottom = Math.max(inset.bottom, felt.bottom - rect.top + gap);
    if (edge === 'left') inset.left = Math.max(inset.left, rect.right - felt.left + gap);
  }
  // Obstacles first define the largest safe rectangle. Centre the largest
  // square inside it so French routing has equal, guaranteed clearance in
  // every direction and can never drift toward the hand on a wide table.
  const availableWidth = (felt.right - felt.left) - inset.left - inset.right;
  const availableHeight = (felt.bottom - felt.top) - inset.top - inset.bottom;
  const side = Math.max(0, Math.min(availableWidth, availableHeight));
  const horizontalSpare = Math.max(0, availableWidth - side);
  const verticalSpare = Math.max(0, availableHeight - side);
  inset.left += horizontalSpare / 2;
  inset.right += horizontalSpare / 2;
  inset.top += verticalSpare / 2;
  inset.bottom += verticalSpare / 2;
  return inset;
}

/**
 * Convert the real, rendered player stations, visible hand and live actions
 * into one invisible central guard square. This is measured rather than guessed because a phone,
 * tablet and wide monitor give the same rack very different proportions.
 * The line renderer then fits only inside the remaining rectangle, making a
 * collision structurally impossible in both Practice and Lounge.
 */
export function reserveBoardStage(
  felt: HTMLElement,
  boardStage: HTMLElement,
  stations: Iterable<HTMLElement>,
  hand: HTMLElement | null,
): void {
  if (felt === boardStage) return;
  // Every measurement starts from the stylesheet's broad board area. Keeping
  // the previous inline guard here makes the square ratchet smaller forever:
  // after a viewport or felt grows, that old square becomes the new baseline
  // and can never expand again.
  boardStage.style.removeProperty('inset');
  const feltRect = felt.getBoundingClientRect();
  if (!feltRect.width || !feltRect.height) return;
  // Roomy tables get a full bone-edge breathing gap; phones retain 12px so
  // the guard protects the hand without making the board unreadably narrow.
  const gutter = Math.max(12, Math.min(24, feltRect.width * 0.015));
  const actionDock = felt.querySelector<HTMLElement>('.in-felt-actions');

  // The hand owns the lower centre of the table. Keep Pass/reshuffle in view
  // on the felt, but lift that small dock above the hand if the viewport makes
  // their rectangles meet. This is based on the rendered boxes, not a desktop
  // breakpoint guess, so Practice and Lounge behave the same way.
  if (actionDock && hand) {
    const actionRect = actionDock.getBoundingClientRect();
    const handRect = hand.getBoundingClientRect();
    const overlapsHand = actionRect.left < handRect.right
      && actionRect.right > handRect.left
      && actionRect.top < handRect.bottom
      && actionRect.bottom > handRect.top;
    if (overlapsHand) {
      actionDock.style.bottom = `${Math.ceil(feltRect.bottom - handRect.top + 8)}px`;
    }
  }

  const stageRect = boardStage.getBoundingClientRect();
  if (!stageRect.width || !stageRect.height) return;
  const obstacles: Array<{ edge: GuardEdge; rect: DOMRect }> = [];
  for (const station of stations) {
    const rect = station.getBoundingClientRect();
    if (station.classList.contains('table-player-station-left')) {
      obstacles.push({ edge: 'left', rect });
    } else if (station.classList.contains('table-player-station-right')) {
      obstacles.push({ edge: 'right', rect });
    } else if (station.classList.contains('table-player-station-top')) {
      obstacles.push({ edge: 'top', rect });
    }
  }
  if (hand) obstacles.push({ edge: 'bottom', rect: hand.getBoundingClientRect() });
  if (actionDock) obstacles.push({ edge: 'bottom', rect: actionDock.getBoundingClientRect() });
  const guard = boardGuardInsets(feltRect, stageRect, obstacles, gutter);
  boardStage.dataset.boardGuard = 'measured-square';
  boardStage.style.inset = `${Math.ceil(guard.top)}px ${Math.ceil(guard.right)}px ${Math.ceil(guard.bottom)}px ${Math.ceil(guard.left)}px`;
}

export function backsEl(count: number): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'backs';
  for (let i = 0; i < count; i++) wrap.appendChild(document.createElement('i'));
  return wrap;
}

/** Six pips per side. They light one at a time and go out all together. */
export function scoreTrack(
  label: string,
  score: number,
  opts: { us?: boolean; bruk?: boolean; max?: number; tiles?: number } = {},
) {
  const max = opts.max ?? 6;
  const wrap = document.createElement('div');
  wrap.className = 'side-score';

  const name = document.createElement('div');
  name.className = 'side-name' + (opts.us ? ' us' : '');
  name.textContent = label;
  wrap.appendChild(name);

  const pips = document.createElement('div');
  pips.className = 'pips' + (opts.bruk ? ' bruk' : '');
  for (let i = 0; i < 6; i++) {
    const pip = document.createElement('i');
    if (Math.round(i / 6 * max) < score) pip.classList.add('lit');
    pips.appendChild(pip);
  }
  wrap.appendChild(pips);

  // Always render the number, not just above 6 points — mobile hides the
  // pip track to keep the pinned scoreboard from crowding out the felt (see
  // .sticky-scores in styles.css), so this is the only score readout left
  // there for sixlove/first-to-six too, not just French.
  const note = document.createElement('div');
  note.className = 'under-love';
  note.textContent = score === 0 ? 'under love' : String(score);
  wrap.appendChild(note);

  // Reading the board is reading who's close to going out — this is the
  // one place that stays on screen the whole hand (the pinned scoreboard),
  // so the tile count belongs right here next to the score, not only in a
  // seat card elsewhere on the board that a player has to go looking for.
  if (opts.tiles !== undefined) {
    const count = document.createElement('div');
    count.className = 'tile-count';
    count.textContent = `${opts.tiles} tile${opts.tiles === 1 ? '' : 's'}`;
    wrap.appendChild(count);
  }
  return wrap;
}

const PENALTY_REASON_TEXT: Record<PenaltyEvent['reason'], string> = {
  'board-pass': 'had no answer to the board',
  'triple-pass': 'passed three times running',
  'no-double-to-pose': 'had no double to pose',
};

/**
 * "X just got a 10, and why" — the live counterpart to the hand-result
 * panel's after-the-fact "Penalties this hand" breakdown. Every seat at the
 * table sees the same PenaltyEvent[] (hand_public.last_penalties online,
 * HandState.lastPenalties locally), so this renders identically for
 * everyone, not just the seat it happened to.
 */
export function penaltyBanner(events: PenaltyEvent[], seatLabel: (seat: number) => string): HTMLElement {
  const line = events
    .map((e) => `${seatLabel(e.seat)} ${PENALTY_REASON_TEXT[e.reason]} — +${e.amount}`)
    .join('  ·  ');
  return el('div', 'banner penalty', line);
}

/**
 * "Penalties this hand — and why", the persistent counterpart to
 * penaltyBanner()'s 6-second live banner. Reads HandResult.penaltyLog (the
 * full ordered event log for the whole hand), not `penalties` (a per-seat
 * running total with no memory of why) — the gap that made a player who got
 * fined unable to tell, after the fact, what actually happened: the banner
 * had already vanished and the old "Penalties this hand" line only ever
 * showed a bare `+10`, never the reason. Returns null when nothing fired, so
 * callers can skip appending it entirely.
 */
export function frenchPenaltyLog(
  events: PenaltyEvent[],
  seatLabel: (seat: number) => string,
): HTMLElement | null {
  if (events.length === 0) return null;
  const wrap = el('div', 'french-penalties');
  wrap.append(el('div', 'eyebrow', 'Penalties this hand'));
  events.forEach((e) => {
    wrap.append(el('div', 'muted small', `${seatLabel(e.seat)} ${PENALTY_REASON_TEXT[e.reason]} — +${e.amount}`));
  });
  return wrap;
}

/**
 * "Did the losing hands add up right" — every seat's pip count from the
 * hand that just ended, any doubling that applied, what it actually added
 * to their score, and their new running total. The delta (`after - before`)
 * is read off the real scores the engine/server already computed rather
 * than reimplementing applyHandResult()'s doubling formula here, so this
 * can never drift out of sync with the number that actually landed —
 * including penalties folded into the same hand, which a hand-count-only
 * view would otherwise leave unexplained.
 */
export function frenchScoreBreakdown(
  result: Pick<HandResult, 'counts' | 'doublesRemaining' | 'winnerPlayedDouble' | 'winnerSeat'>,
  scoresBefore: number[],
  scoresAfter: number[],
  seatLabel: (seat: number) => string,
): HTMLElement {
  const wrap = el('div', 'french-breakdown');
  wrap.append(el('div', 'eyebrow', 'Count this hand'));
  result.counts.forEach((pips, seat) => {
    const tags: string[] = [];
    if (result.doublesRemaining?.[seat]) tags.push('held a double ×2');
    if (result.winnerPlayedDouble && seat !== result.winnerSeat) tags.push('winner played a double ×2');
    const tagText = tags.length ? ` (${tags.join(', ')})` : '';
    const added = (scoresAfter[seat] ?? 0) - (scoresBefore[seat] ?? 0);
    const line = `${seatLabel(seat)} — ${pips} pip${pips === 1 ? '' : 's'}${tagText} → `
      + `+${added}, now ${scoresAfter[seat] ?? 0}`;
    wrap.append(el('div', 'muted small', line));
  });
  return wrap;
}

export function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
