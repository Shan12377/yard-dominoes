import { halves, isDouble, matches } from '@yard/engine';
import type { AnyBoard, Board, CrossBoard, HandResult, Move, PenaltyEvent, Pip, TileId } from '@yard/engine';
import {
  layoutAcrossLine, layoutLine, layoutPlayedRoute, MIN_WIDTH_UNITS, orientLine,
  PHONE_ROUTE_MIN_COLS, PHONE_ROUTE_MIN_ROWS, phoneRouteFits, phoneRoutePlacements, playedRouteHeightUnits,
} from './layout.ts';
import type { OrientedTile, RouteRect, TilePlacement } from './layout.ts';

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
  /** Live standard-play history fixes the pose and grows each end independently. */
  moveLog?: Move[];
  /**
   * Phone Practice: one fixed grid, measured once per hand, that holds the
   * whole route for ANY hand with the pose in the middle. The board then never
   * scrolls and no played bone ever moves. Needs `moveLog` and `unit`; see
   * phonePracticeGeometry().
   */
  phoneRoute?: PhoneRouteGrid;
  /**
   * Mobile French: rectangles, in the phone cross grid's units, that no bone
   * may cover — the players' collapsed tabs at the rim (see
   * phoneFrenchPinwheel()).
   */
  phoneCrossBlocked?: ReadonlyArray<{ x: number; y: number; w: number; h: number }>;
  /** Cap the width in units — the hero uses it to keep its demo line short. */
  maxUnits?: number;
  /** Use the dedicated Across route. Its lane is locked independently of the
   * two hand docks, preventing a turn/selection from changing the chain. */
  across?: boolean;
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
  /**
   * French only. Shrink the rigid 450x390 canvas until it fits `box` instead
   * of letting it overflow.
   *
   * TRUE on a landscape table, where it costs nothing: 1368x900 lands on a
   * 28px bone, the same size the linear game uses.
   *
   * FALSE on a phone, deliberately and after getting this wrong twice.
   * Fitting a late cross there works out at a 20px bone, and 16px on a 360px
   * screen, against 28px for the linear game. Dominoes is played by older
   * people and the owner has ruled on this twice: a board that is fully
   * visible but unreadable is worse than one that is readable and pans.
   *
   * So the phone keeps its readable bone and routes inside its own width
   * instead (phoneCrossRoute). The desktop reference route is 30 units wide
   * and turned every arm in columns a phone could not show, which hid the
   * joining bones. Only a rare long arm pans, vertically, still joined to the
   * centre; centreCrossOnPose() keeps the chucha in the middle when it does.
   */
  fitCrossToBox?: boolean;
  /**
   * Lay French as the JamDom pinwheel at the pinned bone size, whatever the
   * screen. Desktop Practice sets it (owner, 2026-09-15: a desktop table has
   * room to spare, doubles should stand across and nothing should scroll).
   */
  frenchPinwheel?: boolean;
  /**
   * Where the person looking at this board is sitting. A French arm runs
   * towards whoever opened it, which is only meaningful relative to the
   * viewer -- see armDirectionFor(). Omit it (a replay, the hero demo, a
   * spectator with no seat) and arms keep their stored fill-order direction.
   */
  viewerSeat?: number;
}

/** The box the grid has to live inside, in CSS pixels. */
export interface BoardBox { width: number; height: number }

/** The live board's pre-deal physical size, in half-bone units. */
/** Desktop French: viewport height not available to the up and down arms (bars, rack, hand). */
const FRENCH_DESK_CHROME_PX = 360;
/** Units of height the up and down arms need together: chucha, two bones and a double each, with felt. */
const FRENCH_DESK_BAND_UNITS = 28;

export function liveTableUnit(
  viewportWidth: number,
  board: AnyBoard | null,
  french = false,
  viewportHeight = Number.POSITIVE_INFINITY,
): number {
  if (french || board?.kind === 'cross') {
    // The approved reference is JamDom's 30×60 bone on a 1000×800 desktop
    // surface. Preserve that ratio as the table grows and, critically, do not
    // consult the number played. A bone is one physical object from deal to
    // final play; the route must absorb a crowded board, never the bone size.
    if (viewportWidth <= 700) return 14; // 28px short side on a phone.
    // Desktop French bones are up to a quarter bigger than JamDom's ratio
    // (owner, 2026-09-15: "scale bones up about 25-30%"), but never so big
    // that the up and down arms, which run between the top player's rack and
    // my hand, turn before two bones and a double (the owner's other ask: arms
    // straight before turning). The height is binding on a laptop: 19px at
    // 1440x900, 25px at 1920x1080.
    const byWidth = Math.round(viewportWidth * .0156);
    const byHeight = Math.floor((viewportHeight - FRENCH_DESK_CHROME_PX) / FRENCH_DESK_BAND_UNITS);
    return Math.max(18, Math.min(38, byWidth, byHeight));
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

/**
 * Lock a complete linear hand to one measured desktop route before density can
 * influence it. A double-six line has at most seven doubles; exhaustive
 * placement across their possible positions needs no more than 32 columns by
 * 22 rows with layoutLine(). Phones keep their readable tier and deliberate
 * board pan, while desktop fits that complete route and never exposes a
 * mystery scrollbar midway through the hand.
 */
export function liveLinearGeometry(
  viewportWidth: number,
  box?: BoardBox | null,
  minUnit = MIN_UNIT,
  maxUnits = 32,
): { unit: number; maxUnits: number } {
  const base = liveTableUnit(viewportWidth, null, false);
  if (viewportWidth <= 700 || !box || box.width <= 0 || box.height <= 0) {
    return { unit: Math.max(base, minUnit), maxUnits: viewportWidth <= 700 ? 20 : maxUnits };
  }
  return {
    unit: Math.max(minUnit, Math.min(base,
      Math.floor(box.width / 32),
      Math.floor(box.height / 22))),
    maxUnits,
  };
}

/**
 * Across keeps a large, fixed bone while using two controlled hands below the
 * felt. Its route therefore has to be derived from the width that remains
 * inside the measured player-station guard, using the ACTUAL locked unit.
 *
 * The previous calculation divided by the 22px readability floor and then
 * forced at least 64 units. On a tall desktop the locked unit can be 26–32px,
 * so that described a 1,664–2,048px line inside a much narrower stage. The
 * browser could only clip or pan it, which is why the far end and its arrow
 * appeared and disappeared as the hand grew.
 *
 * Before the stage is measured, use the proven complete-hand lane. Once it is
 * measured, clamp the straight run to the visible width and cap it so a wide
 * felt wraps predictably. The destination target is transparent and clamped
 * to that same camera; a wider route only reduces rows, never bone size.
 */
export function liveAcrossRouteUnits(
  box: Pick<BoardBox, 'width'> | null | undefined,
  unit: number,
): number {
  if (!box || box.width <= 0 || unit <= 0) return 32;
  // The destination target is transparent and lives inside the same visible
  // camera as the line, so taking route cells away for it would create an
  // unnecessary extra row. Cap an ultra-wide felt instead: it should add
  // breathing room, not turn a complete hand into one hard-to-read strip.
  const MAX_ACROSS_RUN_UNITS = 40;
  return Math.max(MIN_WIDTH_UNITS, Math.min(
    MAX_ACROSS_RUN_UNITS,
    Math.floor(box.width / unit),
  ));
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

  const route = opts.across
    ? layoutAcrossLine
    : opts.moveLog
      ? (tiles: OrientedTile[], width: number) => layoutPlayedRoute(tiles, opts.moveLog!, width)
      : layoutLine;
  const at = (u: number) => {
    const across = Math.min(Math.floor(box.width / u), cap);
    // Narrower than this and layoutLine has no room to turn the elbow.
    return across < MIN_WIDTH_UNITS ? null : route(line, across);
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
  return last ?? { u: minUnit, placements: route(line, MIN_WIDTH_UNITS) };
}

/**
 * Anchor the board stage once on its pose. Played bones must never make the
 * camera follow them: that makes a fixed table feel as if the dominoes jump.
 *
 * The bone no longer shrinks to keep a whole chain on screen, so on a phone a
 * long chain is taller than its stage — measured at roughly 602px of board in
 * a 352px stage on a 390px viewport. The stage pans instead, and a player must
 * never have to find their own play: whatever just landed is scrolled to.
 *
 * Deliberately not `scrollIntoView`, which walks up and scrolls ancestors too
 * — that would jerk the whole page mid-hand. This only ever touches the stage's
 * own scroll offset, and only when the stage can actually scroll.
 */
export function keepTileInView(stage: HTMLElement | null, tile: HTMLElement | null): void {
  if (!stage || !tile) return;
  if (stage.dataset.routeCameraReady === 'true') return;
  if (stage.scrollHeight <= stage.clientHeight + 1) return; // nothing to pan

  // Bounding rectangles are unreliable while the grid is flex-centred and
  // its content is taller than the stage. offsetTop is the grid's stable
  // logical coordinate, so calculate the one-time camera position directly.
  const target = tile.offsetTop + tile.offsetHeight / 2 - stage.clientHeight / 2;
  const max = Math.max(0, stage.scrollHeight - stage.clientHeight);
  const next = Math.max(0, Math.min(max, target));
  if (Math.abs(stage.scrollTop - next) < 1) return;
  stage.scrollTop = next;
  stage.dataset.routeCameraReady = 'true';
}

/**
 * Draw the line the way it sits on a real Jamaican table: tiles end to end
 * with touching halves matching, doubles crosswise in the line, and the line
 * snaking 90° at the table edge. Layout math lives in layout.ts.
 */
/**
 * Bones already on the table, by the key that identifies one: its tile and
 * the way it lies. A redraw claims them instead of building new ones (owner,
 * 2026-09-15: "the dominoes in the middle thats played" flicker). Every render
 * used to wipe the board and rebuild every bone, so one new domino re-created
 * the whole chain, which is what flickers. Reused nodes keep their exact
 * pixels; only position and span are re-applied.
 */
function claimBones(host: HTMLElement): Map<string, HTMLElement> {
  const kept = new Map<string, HTMLElement>();
  for (const child of [...host.children]) {
    const node = child as HTMLElement;
    const tile = node.dataset?.tile;
    if (!tile) { node.remove(); continue; }
    const key = `${tile}:${node.classList.contains('h') ? 'h' : 'v'}:${node.classList.contains('hub') ? 'hub' : node.dataset.visibleHalves ?? ''}`;
    if (kept.has(key)) { node.remove(); continue; }
    kept.set(key, node);
    node.remove();
  }
  return kept;
}

/** The key a bone is claimed by; see claimBones. */
function boneKey(node: HTMLElement): string {
  return `${node.dataset.tile}:${node.classList.contains('h') ? 'h' : 'v'}:${node.classList.contains('hub') ? 'hub' : node.dataset.visibleHalves ?? ''}`;
}

/** Put `built` on the board, reusing the identical bone already drawn if there is one. */
function placeBone(host: HTMLElement, built: HTMLElement, kept: Map<string, HTMLElement>): HTMLElement {
  const key = boneKey(built);
  const reused = kept.get(key);
  if (!reused) { host.appendChild(built); return built; }
  kept.delete(key);
  reused.style.cssText = built.style.cssText;
  reused.className = built.className;
  host.appendChild(reused);
  return reused;
}

export function renderBoard(host: HTMLElement, board: AnyBoard | null, opts: BoardFit = {}) {
  const keptBones = claimBones(host);
  host.innerHTML = '';
  if (!board) {
    host.style.gridTemplateColumns = '';
    host.style.gridTemplateRows = '';
    return opts.unit ?? opts.maxUnit ?? null;
  }
  assertRenderableBoard(board);
  if (board.kind === 'cross') return renderCross(host, board, opts, keptBones);
  if (board.line.length === 0) {
    host.style.gridTemplateColumns = '';
    host.style.gridTemplateRows = '';
    return opts.unit ?? opts.maxUnit ?? null;
  }

  if (opts.phoneRoute && opts.moveLog && opts.unit) {
    const { cols, rows, origin, blocked, climb } = opts.phoneRoute;
    const fixed = phoneRoutePlacements(orientLine(board), opts.moveLog, cols, rows, { origin, blocked, climb, firstRowBones: opts.phoneRoute?.firstRowBones });
    if (fixed) {
      host.classList.add('phone-route');
      host.style.gridTemplateColumns = `repeat(${cols}, ${opts.unit}px)`;
      host.style.gridTemplateRows = `repeat(${rows}, ${opts.unit}px)`;
      // A bone with no room left is the caller's cue to lay the hand again
      // one size smaller (main.ts); it must never sit under a player.
      host.dataset.phoneRouteOverflow = String(fixed.overflow);
      appendPlacements(host, fixed.placements, 0, 0, keptBones);
      return opts.unit;
    }
  }

  const fitBox = opts.box ?? feltBox();
  const { u, placements } = chooseUnit(orientLine(board), fitBox, opts);

  // layoutLine currently starts at column zero, but a turn/elbow algorithm is
  // allowed to produce negative logical coordinates.  Size and place from the
  // complete bounds, not merely the farthest positive column.  Ignoring the
  // left bound made an end bone collapse into a clipped sliver whenever a
  // reverse run crossed column zero.
  // A live history-driven route owns a fixed table grid. Tight-wrapping only
  // the bones already played would recenter the grid after every left/right
  // extension and make the pose drift even though its logical cell is fixed.
  const routeCols = opts.moveLog
    ? Math.max(MIN_WIDTH_UNITS, Math.min(Math.floor(fitBox.width / u), opts.maxUnits ?? Infinity)) & ~1
    : null;
  const minCol = routeCols ? 0 : Math.min(...placements.map((p) => p.col));
  const maxCol = routeCols ?? Math.max(...placements.map((p) => p.col + p.colSpan));
  const minRow = routeCols ? 0 : Math.min(...placements.map((p) => p.row));
  const maxRow = routeCols
    ? playedRouteHeightUnits(routeCols)
    : Math.max(...placements.map((p) => p.row + p.rowSpan));

  host.style.gridTemplateColumns = `repeat(${maxCol - minCol}, ${u}px)`;
  host.style.gridTemplateRows = `repeat(${maxRow - minRow}, ${u}px)`;

  appendPlacements(host, placements, minCol, minRow);
  return u;
}

function appendPlacements(
  host: HTMLElement, placements: TilePlacement[], minCol: number, minRow: number,
  kept?: Map<string, HTMLElement>,
): void {
  placements.forEach((p, i) => {
    const node = boardTile(p);
    node.style.gridColumn = `${p.col - minCol + 1} / span ${p.colSpan}`;
    node.style.gridRow = `${p.row - minRow + 1} / span ${p.rowSpan}`;
    node.style.setProperty('--i', String(i));
    if (kept) placeBone(host, node, kept);
    else host.appendChild(node);
  });
}

/** A phone Practice board: its grid, where the pose sits and what bones avoid, in grid units. */
export interface PhoneRouteGrid {
  cols: number;
  rows: number;
  origin: { x: number; y: number };
  blocked: RouteRect[];
  /** Full dominoes in every climb between rows. */
  climb: number;
  /** Desktop only: bones each end lays on the centre row before it climbs. */
  firstRowBones?: number;
}

/** Desktop centre row: the pose and three bones each side (owner, 2026-09-15). */
export const DESK_FIRST_ROW_BONES = 4;

/** A rectangle in px, relative to the board stage's padding box. */
export interface StageRect { left: number; top: number; right: number; bottom: number }

/**
 * The largest board bone for a phone Practice stage, chosen once per hand.
 *
 * Owner, 2026-09-14: bigger bones for older players, the whole wood used, and
 * every played bone staying where it landed. The stage is the whole felt above
 * the tray; the players' portraits and racks are `blockedPx`, which the route
 * flows round rather than the board shrinking to the strip between them. A
 * unit is accepted when the route holds the sizing hands (see phoneRouteFits).
 */
const phoneRouteFitCache = new Map<string, boolean>();
/**
 * Dominoes in every climb between rows, in every hand, no matter what (owner,
 * 2026-09-14: "set a rule that it goes up by 2 no matter what ... keep the size
 * the same as now"). The bone size is still chosen as if climbs were one domino,
 * which is the size the owner approved; a long hand that then runs out of room
 * is laid again one size smaller by main.ts's overflow fallback.
 */
const PHONE_CLIMB = 2;
/** Across stands three dominoes in each climb, so its turns sit clear of the middle. */
export const ACROSS_CLIMB = 3;

/** The climb the bone size is chosen with. */
const PHONE_SIZING_CLIMB = 1;
/** True when a chosen fixed-board grid holds the sizing hands with its own rules. */
export function phoneRouteGeometryFits(grid: PhoneRouteGrid): boolean {
  return phoneRouteFits(grid.cols, grid.rows, {
    origin: grid.origin, blocked: grid.blocked, climb: PHONE_SIZING_CLIMB, firstRowBones: grid.firstRowBones,
  });
}

const DESK_EDGE_SLACK = 32;
/** Felt left between the board band and the top rack or my hand. */
const DESK_BAND_GAP = 6;

/** A desktop double-six stage's inset inside the felt: the whole wood, less a reveal. */
export const DESK_ROUTE_STAGE_INSET = '10px';

/** The biggest desktop bone's half (a 76px domino): big enough to feel like wood. */
export const DESK_ROUTE_MAX_UNIT = 38;
/** The smallest desktop bone a long hand may be laid again at. */
export const DESK_ROUTE_MIN_UNIT = 11;

/**
 * Desktop double-six board (owner, 2026-09-15: "dominoes are too small ...
 * domino should play until it fills the board", "consistent ... direction").
 * The rows run the whole width between the side players, in the band between
 * the top player's rack and my hand: a row cannot pass through either, so the
 * wood above and below them only cost bone size when it was counted. Every
 * hand turns its centre row after DESK_FIRST_ROW_BONES, and the bone is sized
 * with the climb it is really laid with, so a long hand does not run off the
 * table (the rare one that would is laid again a size smaller, never clipped).
 */
export function deskRouteGeometry(
  box: BoardBox, blockedPx: readonly StageRect[], minUnit: number, maxUnit = DESK_ROUTE_MAX_UNIT,
  layoutClimb = PHONE_CLIMB,
): PhoneRouteGrid & { unit: number; left: number; top: number } {
  let bandTop = 0;
  let bandBottom = box.height;
  for (const b of blockedPx) {
    const middle = (b.left + b.right) / 2;
    if (middle < box.width / 4 || middle > box.width * 3 / 4) continue;
    if (b.top < box.height / 3) bandTop = Math.max(bandTop, Math.ceil(b.bottom) + DESK_BAND_GAP);
    else if (b.bottom > box.height * 2 / 3) bandBottom = Math.min(bandBottom, Math.floor(b.top) - DESK_BAND_GAP);
  }
  const band = { width: box.width, height: Math.max(0, bandBottom - bandTop) };
  const shifted = blockedPx
    .map((b) => ({ left: b.left, right: b.right, top: b.top - bandTop, bottom: b.bottom - bandTop }))
    .filter((b) => b.bottom > 0 && b.top < band.height);
  const grid = phonePracticeGeometry(band, maxUnit, minUnit, shifted, DESK_FIRST_ROW_BONES, true, undefined, layoutClimb, layoutClimb);
  return { ...grid, top: grid.top + bandTop, blocked: grid.blocked.map((b) => ({ ...b })) };
}

export function phonePracticeGeometry(
  box: BoardBox, maxUnit: number, minUnit: number, blockedPx: readonly StageRect[] = [], firstRowBones?: number,
  /**
   * Desktop only. A corner card or side rack standing on the board's left or
   * right edge trims that edge instead of blocking the rows that must reach
   * it (2026-09-15: an 8px sliver of the Lounge's top-right card, and Practice's
   * right rack, kept the S from fitting at the desktop bone). Phones keep
   * their narrow tabs as blockers, so their layout does not change.
   */
  trimEdges = false,
  /** Corpus hands allowed to outgrow the board; see PhoneRouteOptions.tolerance. */
  tolerance?: number,
  /** The climb the bone is sized with. Phones size as if one domino (see PHONE_SIZING_CLIMB). */
  sizingClimb = PHONE_SIZING_CLIMB,
  /**
   * Dominoes standing in each climb between rows. Across uses three (owner,
   * 2026-09-15: "go up by one more domino when ready to turn up or down so
   * not close to the middle ... it will also show fuller"); every other game
   * keeps two. Measured over the 400 sizing hands, the third bone costs
   * nothing at the sizes these tables actually use.
   */
  layoutClimb = PHONE_CLIMB,
): PhoneRouteGrid & { unit: number; left: number; top: number } {
  let edgeLeft = 0;
  let edgeRight = box.width;
  if (trimEdges) {
    for (const b of blockedPx) {
      if (b.right - b.left > box.width / 4) continue;
      // Within DESK_EDGE_SLACK of the edge counts as on it: a whole-felt stage
      // leaves the felt's own padding between a card and the stage edge.
      if (b.right >= box.width - DESK_EDGE_SLACK && b.left > box.width / 2) edgeRight = Math.min(edgeRight, b.left);
      else if (b.left <= DESK_EDGE_SLACK && b.right < box.width / 2) edgeLeft = Math.max(edgeLeft, b.right);
    }
    blockedPx = blockedPx.filter((b) => b.left < edgeRight && b.right > edgeLeft);
  }
  const usableWidth = edgeRight - edgeLeft;
  const gridAt = (u: number, climb: number) => {
    const cols = Math.max(PHONE_ROUTE_MIN_COLS, Math.floor(usableWidth / u));
    const rows = Math.max(PHONE_ROUTE_MIN_ROWS, Math.floor(box.height / u));
    const left = edgeLeft + Math.floor((usableWidth - cols * u) / 2);
    const top = Math.floor((box.height - rows * u) / 2);
    const blocked = blockedPx.map((b) => {
      const x = Math.floor((b.left - left) / u);
      const y = Math.floor((b.top - top) / u);
      return { x, y, w: Math.ceil((b.right - left) / u) - x, h: Math.ceil((b.bottom - top) / u) - y };
    });
    const origin = { x: Math.floor(cols / 2), y: Math.floor(rows / 2) };
    return { unit: u, cols, rows, left, top, origin, blocked, climb, ...(firstRowBones === undefined ? {} : { firstRowBones }) };
  };
  for (let u = maxUnit; u >= minUnit; u -= 1) {
    const grid = gridAt(u, layoutClimb);
    const key = JSON.stringify([grid.cols, grid.rows, grid.origin, grid.blocked, firstRowBones ?? null, tolerance ?? null, sizingClimb]);
    let fits = phoneRouteFitCache.get(key);
    if (fits === undefined) {
      fits = phoneRouteFits(grid.cols, grid.rows, { origin: grid.origin, blocked: grid.blocked, climb: sizingClimb, firstRowBones, tolerance });
      phoneRouteFitCache.set(key, fits);
    }
    if (fits) return grid;
  }
  return gridAt(minUnit, layoutClimb);
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

/**
 * The largest unit whose French canvas still fits `box`.
 *
 * The French board is a fixed 450x390 logical canvas scaled from the bone, so
 * it measures 30u by 26u. That is the whole reason a French bone cannot be
 * chosen from the viewport the way a linear one can: the canvas is rigid, and
 * whatever does not fit is simply cut off.
 */
export function frenchCanvasUnit(box: BoardBox): number {
  return Math.floor(Math.min(box.width / 30, box.height / 26));
}

/**
 * Which way an arm opened by `seat` runs, for a player sitting at `viewerSeat`.
 *
 * On a real table you push your bone out in front of you, so an arm runs
 * towards whoever opened it. That is relative to the person LOOKING at the
 * board -- my right is the opposite seat's left -- which is exactly why the
 * engine records the seat and leaves the compass to the client.
 *
 * Play is anti-clockwise and seats are numbered in play order, so seat+1 is
 * the player on my physical right. See CLAUDE.md, "Rules competitors get
 * wrong".
 */
export function armDirectionFor(seat: number, viewerSeat: number): CrossBoard['arms'][number]['direction'] {
  const around = ['down', 'right', 'up', 'left'] as const;
  const step = ((seat - viewerSeat) % 4 + 4) % 4;
  return around[step];
}

/**
 * Directions for a whole cross, resolving the one collision the rule allows:
 * a seat holding two of the four opening bones opens two arms, and both would
 * otherwise claim the same lane and draw on top of each other. First claim
 * wins; the next takes the nearest free lane, going round the table.
 *
 * An arm with no recorded seat predates CrossArm.seat and keeps its stored
 * fill-order direction.
 */
export function crossArmDirections(
  arms: ReadonlyArray<{ seat?: number; direction?: CrossBoard['arms'][number]['direction'] }>,
  viewerSeat: number,
): Array<CrossBoard['arms'][number]['direction']> {
  const order = ['down', 'right', 'up', 'left'] as const;
  const taken = new Set<string>();
  const out: Array<CrossBoard['arms'][number]['direction']> = [];
  for (const arm of arms) {
    if (arm.seat === undefined) {
      const fallback = arm.direction ?? order[out.length % 4];
      taken.add(fallback);
      out.push(fallback);
      continue;
    }
    const want = armDirectionFor(arm.seat, viewerSeat);
    let chosen = want;
    if (taken.has(chosen)) {
      const from = order.indexOf(want);
      for (let i = 1; i < 4; i++) {
        const next = order[(from + i) % 4];
        if (!taken.has(next)) { chosen = next; break; }
      }
    }
    taken.add(chosen);
    out.push(chosen);
  }
  return out;
}

type ReferenceRoutePoint = readonly [x: number, y: number, orientation: 'h' | 'v'];

/** Measured from JamDom's public 450×390 French board (30×60 bones). */
const FRENCH_REFERENCE_ROUTES: Record<CrossBoard['arms'][number]['direction'], readonly ReferenceRoutePoint[]> = {
  right: [[270,195,'h'],[330,195,'h'],[390,195,'h'],[435,210,'v'],[435,270,'v'],[435,330,'v'],[420,375,'h'],[360,375,'h'],[300,375,'h'],[270,330,'v'],[270,270,'v'],[315,240,'h'],[375,240,'h'],[400,285,'v'],[385,330,'h'],[325,340,'h'],[305,295,'v']],
  left: [[180,195,'h'],[120,195,'h'],[60,195,'h'],[15,180,'v'],[15,120,'v'],[15,60,'v'],[30,15,'h'],[90,15,'h'],[150,15,'h'],[180,60,'v'],[180,120,'v'],[135,150,'h'],[75,150,'h'],[50,105,'v'],[65,60,'h'],[125,50,'h'],[145,95,'v'],[100,110,'h']],
  up: [[225,135,'v'],[225,75,'v'],[240,30,'h'],[300,30,'h'],[360,30,'h'],[420,30,'h'],[435,75,'v'],[435,135,'v'],[390,160,'h'],[330,160,'h'],[285,145,'v'],[270,85,'v'],[315,65,'h'],[375,65,'h'],[400,110,'v'],[355,125,'h']],
  down: [[225,255,'v'],[225,315,'v'],[210,360,'h'],[150,360,'h'],[90,360,'h'],[30,360,'h'],[15,315,'v'],[15,255,'v'],[60,230,'h'],[120,230,'h'],[165,245,'v'],[180,305,'v'],[135,325,'h'],[75,325,'h'],[50,280,'v'],[95,265,'h']],
};

type CrossDirection = CrossBoard['arms'][number]['direction'];

/** One slot on a phone French board, in layout units (half a short side). */
export interface PhoneCrossSlot { x: number; y: number; w: number; h: number; orient: 'h' | 'v' }

/** One unit of felt between neighbouring arms, so touching bones never read as a join. */
const PHONE_CROSS_GAP = 1;
/** A band too narrow for a row keeps climbing its own column, so any phone fits. */
const PHONE_CROSS_MIN_COLS = 12;
const PHONE_CROSS_MIN_ROWS = 16;

/**
 * The grid a phone French board is routed in, from its measured stage.
 *
 * The desktop reference canvas is 30u wide, which at the readable 28px phone
 * bone is 420px against a ~290-320px phone stage. Every arm turned in the
 * columns that fell off the screen, so the joining bones were hidden and a
 * turned-back run looked like dominoes floating on their own (owner's
 * screenshot, 2026-09-13). The phone therefore routes inside its OWN width.
 */
export function phoneCrossGrid(box: BoardBox, unit: number): { cols: number; rows: number } {
  // Even columns keep the chucha on a whole unit.
  const cols = Math.max(PHONE_CROSS_MIN_COLS, Math.floor(box.width / unit / 2) * 2);
  const rows = Math.max(PHONE_CROSS_MIN_ROWS, Math.floor(box.height / unit));
  return { cols, rows };
}

export function phoneCrossGridKey(box: BoardBox, unit: number): string {
  const { cols, rows } = phoneCrossGrid(box, unit);
  return `${cols}x${rows}`;
}

/**
 * The slots one arm of a phone French board fills, in play order.
 *
 * The first bone always heads towards the player who opened the arm. After
 * that each arm owns one pinwheel quarter of the board: it runs rows back
 * and forth across its band and grows away from the chucha. Nothing ever
 * leaves the board's width. An unusually long arm grows past the top or
 * bottom instead, which is a short vertical pan that stays joined to the
 * centre, never a run that disappears off the side and comes back.
 */
export function phoneCrossRoute(
  direction: CrossDirection, cols: number, rows: number, count: number,
): PhoneCrossSlot[] {
  const cx = cols / 2;
  const cy = Math.floor(rows / 2);
  // Up and down own the centre column, so their bands are the wider pair; the
  // left and right rows stop one gap short of it.
  const band = {
    up: { x0: cx - 1, x1: cols, rowX0: cx - 1, rowX1: cols, grow: 'up', back: 'right' },
    right: { x0: cx + 1, x1: cols, rowX0: cx + 1 + PHONE_CROSS_GAP, rowX1: cols, grow: 'down', back: 'left' },
    down: { x0: 0, x1: cx + 1, rowX0: 0, rowX1: cx + 1, grow: 'down', back: 'left' },
    left: { x0: 0, x1: cx - 1, rowX0: 0, rowX1: cx - 1 - PHONE_CROSS_GAP, grow: 'up', back: 'right' },
  }[direction] as { x0: number; x1: number; rowX0: number; rowX1: number; grow: CrossDirection; back: CrossDirection };

  type Rect = { x: number; y: number; w: number; h: number };
  const along = (half: Rect, d: CrossDirection): Rect => ({
    x: half.x + (d === 'right' ? 2 : d === 'left' ? -2 : 0),
    y: half.y + (d === 'down' ? 2 : d === 'up' ? -2 : 0),
    w: 2, h: 2,
  });
  // The tile whose inward half is `inward` and which travels in `d`.
  const tileFrom = (inward: Rect, d: CrossDirection): Rect =>
    d === 'right' ? { x: inward.x, y: inward.y, w: 4, h: 2 }
      : d === 'left' ? { x: inward.x - 2, y: inward.y, w: 4, h: 2 }
        : d === 'down' ? { x: inward.x, y: inward.y, w: 2, h: 4 }
          : { x: inward.x, y: inward.y - 2, w: 2, h: 4 };
  const outwardHalf = (r: Rect, d: CrossDirection): Rect =>
    d === 'right' ? { x: r.x + 2, y: r.y, w: 2, h: 2 }
      : d === 'down' ? { x: r.x, y: r.y + 2, w: 2, h: 2 }
        : { x: r.x, y: r.y, w: 2, h: 2 };
  const slot = (r: Rect): PhoneCrossSlot => ({ ...r, orient: r.w === 4 ? 'h' : 'v' });

  const first: Rect = direction === 'right' ? { x: cx + 1, y: cy - 1, w: 4, h: 2 }
    : direction === 'left' ? { x: cx - 5, y: cy - 1, w: 4, h: 2 }
      : direction === 'up' ? { x: cx - 1, y: cy - 6, w: 2, h: 4 }
        : { x: cx - 1, y: cy + 2, w: 2, h: 4 };
  const out: PhoneCrossSlot[] = count > 0 ? [slot(first)] : [];
  let travel: CrossDirection = direction;
  let head = outwardHalf(first, travel);
  let rowDir: CrossDirection = direction === 'up' || direction === 'down' ? band.back : direction;
  // The first row (and an up/down arm's first turn out of its column) may use
  // the whole band; every later row keeps the gap to the neighbouring arm.
  let firstRow = true;
  const fits = (r: Rect) => r.x >= (firstRow ? band.x0 : band.rowX0)
    && r.x + r.w <= (firstRow ? band.x1 : band.rowX1);

  while (out.length < count) {
    let next: Rect;
    if (travel === 'left' || travel === 'right') {
      const straight = tileFrom(along(head, travel), travel);
      if (fits(straight)) {
        next = straight;
      } else {
        // Turn at the end of the row: beside the end face when a column is
        // free there, otherwise on the side of the last half.
        const beside = along(head, travel);
        const endOn: Rect = band.grow === 'down'
          ? { ...beside, h: 4 }
          : { ...beside, y: beside.y - 2, h: 4 };
        next = fits(endOn) ? endOn : tileFrom(along(head, band.grow), band.grow);
        rowDir = travel === 'left' ? 'right' : 'left';
        travel = band.grow;
        firstRow = false;
      }
    } else {
      const row = tileFrom(along(head, rowDir), rowDir);
      if (fits(row)) {
        next = row;
        travel = rowDir;
      } else {
        // A band too narrow for another row (a 360px phone): keep going
        // straight up or down the arm's own column rather than leave the width.
        next = tileFrom(along(head, travel), travel);
      }
    }
    out.push(slot(next));
    head = outwardHalf(next, travel);
  }
  return out;
}

/**
 * Mobile French as JamDom lays it (owner, 2026-09-14): a four-way clockwise
 * pinwheel. Each arm heads out from the chucha towards its player, runs to the
 * table edge and turns clockwise, and keeps turning clockwise inside its own
 * quarter, so no arm folds back and forth into stacked rows ("a comb"). The
 * comb in `phoneCrossRoute()` also laid doubles along the arm; here a double
 * stands across the arm it arrives on, using half a bone of its length, and a
 * double on a turn makes the L: past the end of the line, one half level with
 * it and the other out into the turn.
 *
 * Bones are laid in play order (`order` holds the arm index of each play), and
 * a bone's place depends only on bones already down, so nothing ever moves.
 * Every lane is a double's width with one unit of look-ahead; arms keep a unit
 * of felt between them and never cover a player's tab (`blocked`). Only an arm
 * with nowhere clockwise to go borrows free felt outside its quarter, then may
 * turn the other way, and last of all grows past the bottom of the board (the
 * stage scrolls down to it). Growing downward keeps every bone already down
 * exactly where it was. A bone with no room even then counts in `stuck`.
 *
 * Coordinates are grid units from the top-left; the chucha stands upright in
 * the middle, as `phoneCrossRoute()` places it.
 */
/**
 * How many bones each arm lays straight out from the chucha before its first
 * clockwise turn, as JamDom lays French (owner, 2026-09-15, with a JamDom
 * table for reference): left and right lay two then turn up and down, up and
 * down lay three then turn right and left. The short legs keep the pinwheel
 * tight around the middle instead of running every arm to the rim first.
 */
export type FrenchPinwheelLegs = Readonly<Record<CrossDirection, number | readonly number[]>>;

// Owner, 2026-09-15 (second try): three out to each side then turn, and the
// side arms lay three more before their second clockwise turn; up and down lay
// two then turn. A number is the first leg only; a list is consecutive legs.
export const FRENCH_PINWHEEL_LEGS: FrenchPinwheelLegs = { left: [3, 3], right: [3, 3], up: [2], down: [2] };

/**
 * Desktop's wider felt lays four bones out to each side and two up and down
 * before the first clockwise turn (owner, 2026-09-15). A phone cannot: at its
 * 28px floor three side bones already reach the rim. Simulated over 400 real
 * hands on a 58x39 desktop grid, all 400 fit (two sides and three up: 366).
 */
export const FRENCH_DESK_PINWHEEL_LEGS: FrenchPinwheelLegs = { left: 4, right: 4, up: 3, down: 3 };

export function phoneFrenchPinwheel(input: {
  arms: ReadonlyArray<{ direction: CrossDirection; doubles: readonly boolean[] }>;
  legs?: FrenchPinwheelLegs;
  order: readonly number[];
  cols: number;
  rows: number;
  blocked?: ReadonlyArray<{ x: number; y: number; w: number; h: number }>;
  /**
   * Desktop: stand the chucha halfway between the top player's rack and my
   * hand rather than halfway down the felt, so the up and down arms get the
   * same room (owner, 2026-09-15: all four arms 3-4 bones before turning).
   */
  centreBetweenBlocks?: boolean;
}): { slots: PhoneCrossSlot[][]; stuck: number; cy: number } {
  type Rect = { x: number; y: number; w: number; h: number };
  type Placed = Rect & { arm: number };
  const { cols, rows } = input;
  const cx = cols / 2;
  let cy = Math.floor(rows / 2);
  if (input.centreBetweenBlocks) {
    let bandTop = 0;
    let bandBottom = rows;
    for (const b of input.blocked ?? []) {
      if (b.x > cx || b.x + b.w < cx) continue;
      if (b.y + b.h <= rows / 2) bandTop = Math.max(bandTop, b.y + b.h);
      else if (b.y >= rows / 2) bandBottom = Math.min(bandBottom, b.y);
    }
    cy = Math.floor((bandTop + bandBottom) / 2);
  }
  const minX = -cx;
  const maxX = cols - cx;
  const minY = -cy;
  const maxY = rows - cy;
  const step: Record<CrossDirection, readonly [number, number]> = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] };
  const clockwise: Record<CrossDirection, CrossDirection> = { up: 'right', right: 'down', down: 'left', left: 'up' };
  const anticlockwise: Record<CrossDirection, CrossDirection> = { up: 'left', left: 'down', down: 'right', right: 'up' };
  const rect = (x: number, y: number, d: CrossDirection, along: number, across: number): Rect =>
    d === 'right' ? { x, y: y - across / 2, w: along, h: across }
      : d === 'left' ? { x: x - along, y: y - across / 2, w: along, h: across }
        : d === 'down' ? { x: x - across / 2, y, w: across, h: along }
          : { x: x - across / 2, y: y - along, w: across, h: along };
  const grown = (r: Rect, d: CrossDirection, by: number): Rect =>
    d === 'right' ? { ...r, w: r.w + by } : d === 'left' ? { ...r, x: r.x - by, w: r.w + by }
      : d === 'down' ? { ...r, h: r.h + by } : { ...r, y: r.y - by, h: r.h + by };
  const near = (a: Rect, b: Rect, gap: number) =>
    a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
  // Each arm's clockwise quarter, relative to the chucha (x -1..1, y -2..2).
  // Neighbouring quarters meet on an edge, so lanes of different arms never
  // overlap; the bones inside them keep a unit of felt from each other.
  const quarter: Record<CrossDirection, (l: Rect) => boolean> = {
    up: (l) => l.x >= -2 && l.y + l.h <= -2,
    right: (l) => l.y >= -2 && l.x >= (l.y + l.h > 2 ? 2 : 1),
    down: (l) => l.y >= 2 && l.x + l.w <= 2,
    left: (l) => l.y + l.h <= 2 && l.x + l.w <= (l.y < -2 ? -2 : -1),
  };
  const hub: Rect = { x: -1, y: -2, w: 2, h: 4 };
  const blocked = (input.blocked ?? []).map((b) => ({ ...b, x: b.x - cx, y: b.y - cy }));
  const arms = input.arms.map(({ direction }) => {
    const start: readonly [number, number] = direction === 'up' ? [0, -2] : direction === 'down' ? [0, 2]
      : direction === 'right' ? [1, 0] : [-1, 0];
    return {
      direction, x: start[0], y: start[1], dir: direction,
      lastAcross: direction === 'up' || direction === 'down' ? 2 : 4, own: [] as Placed[],
      turns: 0, legBones: 0,
    };
  });
  const all: Placed[] = [];
  const slots: PhoneCrossSlot[][] = input.arms.map(() => []);
  let stuck = 0;

  for (const armIndex of input.order) {
    const arm = arms[armIndex];
    if (!arm) continue;
    const index = arm.own.length;
    const double = input.arms[armIndex].doubles[index] ?? false;
    const joins = arm.own[index - 1];
    const elbow = arm.own[index - 2];
    const clear = (lane: Rect, bone: Rect, ownQuarter: boolean, pastBottom = false) => {
      // The bone itself must be on the board; the felt ahead of it may be the
      // rim. That lets a side arm lay its last bone right to the edge.
      if (bone.x < minX || bone.x + bone.w > maxX || bone.y < minY) return false;
      if (!pastBottom && bone.y + bone.h > maxY) return false;
      if (ownQuarter && !quarter[arm.direction](lane)) return false;
      for (const b of blocked) if (near(lane, b, 0)) return false;
      if (index > 0 && near(bone, hub, 0)) return false;
      for (const other of all) {
        if (other === joins) continue;
        if (other === elbow) {
          if (near(bone, other, 0)) return false;
          continue;
        }
        const felt = other.arm === armIndex && double ? 0 : 1;
        if (near(bone, other, felt) || near(lane, other, 0)) return false;
      }
      return true;
    };
    const along = double ? 2 : 4;
    const across = double ? 4 : 2;
    const [dx, dy] = step[arm.dir];
    const straightFits = (length: number, width: number, ownQuarter: boolean, pastBottom = false) => clear(
      grown(rect(arm.x, arm.y, arm.dir, length, 4), arm.dir, 1), rect(arm.x, arm.y, arm.dir, length, width), ownQuarter, pastBottom);
    const straight = (ownQuarter: boolean, pastBottom = false) => straightFits(along, across, ownQuarter, pastBottom)
      ? { x: arm.x, y: arm.y, d: arm.dir, bone: rect(arm.x, arm.y, arm.dir, along, across), advance: along }
      : null;
    const turn = (to: CrossDirection, ownQuarter: boolean, pastBottom = false) => {
      const [tx, ty] = step[to];
      const leg = (x: number, y: number) => {
        const bone = rect(x, y, to, 4, 2);
        return clear(grown(rect(x, y, to, 4, 4), to, 1), bone, ownQuarter, pastBottom) ? { x, y, d: to, bone, advance: 4 } : null;
      };
      // A double on a turn is the L; an ordinary bone turns beside the
      // outward half of the bone it joins.
      const corner = double ? leg(arm.x + dx - tx, arm.y + dy - ty) : null;
      return corner ?? leg(arm.x - dx + tx * (arm.lastAcross / 2), arm.y - dy + ty * (arm.lastAcross / 2));
    };
    const plan = (input.legs ?? FRENCH_PINWHEEL_LEGS)[arm.direction];
    const legLength = (typeof plan === 'number' ? [plan] : plan)[arm.turns];
    let chosen: ReturnType<typeof straight> = null;
    if (index === 0) {
      chosen = straight(true);
    } else if (legLength !== undefined && arm.legBones === legLength) {
      // The first leg is done: turn clockwise now, straight only if the turn
      // has no room.
      chosen = turn(clockwise[arm.dir], true) ?? straight(true);
      chosen ??= turn(clockwise[arm.dir], false) ?? straight(false)
        ?? turn(clockwise[arm.dir], false, true) ?? straight(false, true);
    } else {
      const turnsHere = double && !straightFits(4, 2, true);
      chosen = turnsHere
        ? turn(clockwise[arm.dir], true) ?? straight(true)
        : straight(true) ?? turn(clockwise[arm.dir], true);
      chosen ??= straight(false) ?? turn(clockwise[arm.dir], false)
        ?? turn(anticlockwise[arm.dir], true) ?? turn(anticlockwise[arm.dir], false);
      chosen ??= straight(false, true) ?? turn(clockwise[arm.dir], false, true)
        ?? turn(anticlockwise[arm.dir], false, true);
    }
    if (!chosen) {
      stuck += 1;
      chosen = { x: arm.x, y: arm.y, d: arm.dir, bone: rect(arm.x, arm.y, arm.dir, along, across), advance: along };
    }
    const placed: Placed = Object.assign(chosen.bone, { arm: armIndex });
    arm.own.push(placed);
    all.push(placed);
    const [sx, sy] = step[chosen.d];
    arm.x = chosen.x + sx * chosen.advance;
    arm.y = chosen.y + sy * chosen.advance;
    const turned = chosen.d !== arm.dir;
    arm.dir = chosen.d;
    arm.lastAcross = chosen.bone.w === chosen.advance ? chosen.bone.h : chosen.bone.w;
    if (turned) {
      arm.turns += 1;
      arm.legBones = 1;
    } else {
      arm.legBones += 1;
    }
    slots[armIndex].push({
      x: placed.x + cx, y: placed.y + cy, w: placed.w, h: placed.h, orient: placed.w > placed.h ? 'h' : 'v',
    });
  }
  return { slots, stuck, cy };
}

/** Which pip faces which way when `placed` joins `anchor` at (x, y) from `previous`. */
function crossFaces(
  placed: CrossBoard['arms'][number]['tiles'][number], anchor: Pip, orient: 'h' | 'v',
  x: number, y: number, previous: readonly [number, number],
): { faces: [Pip, Pip]; outward: Pip } {
  const [a, b] = halves(placed.tile);
  const inward = (a === anchor ? a : b) as Pip;
  const outward = (a === anchor ? b : a) as Pip;
  const forward = orient === 'h' ? x > previous[0] : y > previous[1];
  return { faces: forward ? [inward, outward] : [outward, inward], outward };
}

/**
 * The narrowest phone that lays French as the pinwheel on the whole felt. A
 * 375px phone gets 26 columns once the French board stops reserving the
 * linear line's 18px padding it never uses; a narrower one (a 360px screen)
 * gets 24 and keeps the row route and keeps the players'
 * tabs off its width, the way it always kept their full badges off. Decided by
 * viewport width, not a measured stage: the first measurement of a hand can
 * come in narrower than the settled one, and deciding from it drew the chucha
 * on the row route and then moved it onto the pinwheel.
 */
export const PHONE_FRENCH_PINWHEEL_MIN_WIDTH = 370;

/**
 * Whether this phone lays French as the pinwheel. Uses the smaller of the
 * layout width and the screen width: a page wider than the screen (Practice's
 * felt reaches past both edges) let `innerWidth` read 375 on one draw and
 * nearer 400 on the next, and a 375px phone flipped between the pinwheel and
 * the row route in one hand.
 */
export function frenchPinwheelPhone(): boolean {
  const screenWidth = window.screen?.width || window.innerWidth;
  const width = Math.min(window.innerWidth, screenWidth);
  return window.innerWidth <= 700 && width >= PHONE_FRENCH_PINWHEEL_MIN_WIDTH;
}

/**
 * Mobile French: the collapsed player tabs (see frenchPhoneTab) as rectangles
 * in the phone cross grid's units, with a unit of felt around each.
 *
 * Measured against where the grid WILL sit, not against a drawn board: the
 * stage centres a board smaller than itself (`safe center`), so the grid's
 * corner follows from the stage and the grid size alone. That lets the tabs
 * be known before the first bone goes down, so no bone is ever re-laid when
 * they are found. Measure once per hand, before the stage can scroll.
 */
export function frenchTabBlocks(
  stage: HTMLElement, root: ParentNode, box: BoardBox, unit: number, selector = '.station-tab',
): Array<{ x: number; y: number; w: number; h: number }> {
  if (!unit) return [];
  const { cols, rows } = phoneCrossGrid(box, unit);
  const view = stage.getBoundingClientRect();
  if (!view.width) return [];
  // Centred across; top-aligned down (`.french-phone-stage`), so a board that
  // grows past the bottom never moves.
  const left = view.left + stage.clientLeft + Math.max(0, (stage.clientWidth - cols * unit) / 2) - stage.scrollLeft;
  const top = view.top + stage.clientTop - stage.scrollTop;
  return [...root.querySelectorAll<HTMLElement>(selector)].filter((tab) => tab.getBoundingClientRect().width > 0).map((tab) => {
    // The whole collapsed tab: photo, count badge and its "View" cue. Its open
    // panel is positioned outside it and never counts.
    const r = tab.getBoundingClientRect();
    // A unit of felt around each tab. Without it a rare arm that had to
    // borrow room laid a bone against a tab and clipped it (390px, 2026-09-14).
    const x = Math.floor((r.left - left) / unit) - 1;
    const y = Math.floor((r.top - top) / unit) - 1;
    return {
      x, y,
      w: Math.ceil((r.right - left) / unit) + 1 - x,
      h: Math.ceil((r.bottom - top) / unit) + 1 - y,
    };
  });
}

/**
 * The pinwheel also needs this many columns, as a guard for an unusually
 * narrow stage. A 360px phone's whole felt gives 24x25: in a real Practice
 * hand an arm ran out of room at 20 bones, a bone landed above the board and
 * shifted every bone down a unit, and bones sat under a player's tab. A 390px
 * phone gives 26 and a 430px phone 28, and both held two full hands with
 * nothing moving (2026-09-14). The choice itself follows
 * PHONE_FRENCH_PINWHEEL_MIN_WIDTH, so every draw of a hand agrees.
 */
const PHONE_PINWHEEL_MIN_COLS = 26;

function renderPhoneCross(host: HTMLElement, board: CrossBoard, opts: BoardFit, box: BoardBox, u: number, kept?: Map<string, HTMLElement>) {
  const { cols, rows } = phoneCrossGrid(box, u);
  const armDirections = opts.viewerSeat === undefined
    ? board.arms.map((arm) => arm.direction)
    : crossArmDirections(board.arms, opts.viewerSeat);
  // The pinwheel needs the order bones went down so none of them ever moves.
  // A replay or the Coach shows a finished board with no move history; there
  // the arms are taken in turn, which draws the same shape.
  const played = (opts.moveLog ?? []).flatMap((move) => move.kind === 'playcross' ? [move.arm] : []);
  const counts = board.arms.map((arm) => arm.tiles.length);
  const order = played.length === counts.reduce((sum, n) => sum + n, 0)
    ? played
    : (() => {
      const turns: number[] = [];
      const left = [...counts];
      while (left.some((n) => n > 0)) left.forEach((n, arm) => { if (n > 0) { turns.push(arm); left[arm] -= 1; } });
      return turns;
    })();
  // Chosen from the viewport, like the stage: the first draw of a hand can
  // work from a guessed stage, and choosing by its columns started a hand on
  // the row route and then moved the chucha onto the pinwheel.
  const pinwheel = (opts.frenchPinwheel || frenchPinwheelPhone())
    && Math.max(cols, PHONE_PINWHEEL_MIN_COLS) === cols
    ? phoneFrenchPinwheel({
      arms: board.arms.map((arm, index) => ({
        direction: armDirections[index], doubles: arm.tiles.map((placed) => isDouble(placed.tile)),
      })),
      order, cols, rows, blocked: opts.phoneCrossBlocked,
      ...(opts.frenchPinwheel ? { legs: FRENCH_DESK_PINWHEEL_LEGS, centreBetweenBlocks: true } : {}),
    })
    : null;
  // A phone too narrow for the pinwheel keeps the older row-by-row route for
  // the whole hand. The pinwheel is never swapped for it mid-hand: that re-laid
  // every bone on the table (owner's rule, 2026-09-14: played bones never move).
  const routes = pinwheel
    ? pinwheel.slots
    : board.arms.map((arm, index) => phoneCrossRoute(armDirections[index], cols, rows, arm.tiles.length));
  host.dataset.frenchRoute = pinwheel ? 'pinwheel' : 'rows';
  // A rare long arm grows past the top or bottom; the board grows with it and
  // the stage pans vertically, still joined to the centre.
  let top = 0;
  let bottom = rows;
  for (const route of routes) for (const s of route) {
    // The pinwheel grows only past the bottom. A bone it could not place
    // anywhere must never shift every other bone down to make room above.
    if (!pinwheel) top = Math.min(top, s.y);
    bottom = Math.max(bottom, s.y + s.h);
  }
  host.classList.add('french-reference-route', 'french-phone-route');
  host.style.gridTemplateColumns = '';
  host.style.gridTemplateRows = '';
  host.style.width = `${cols * u}px`;
  host.style.height = `${(bottom - top) * u}px`;
  host.dataset.crossGrid = `${cols}x${rows}`;
  const place = (node: HTMLElement, r: { x: number; y: number; w: number; h: number }) => {
    node.style.width = `${r.w * u}px`;
    node.style.height = `${r.h * u}px`;
    node.style.left = `${r.x * u}px`;
    node.style.top = `${(r.y - top) * u}px`;
  };

  const cx = cols / 2;
  const cy = pinwheel?.cy ?? Math.floor(rows / 2);
  const pose = tileEl(board.center);
  pose.classList.add('hub');
  place(pose, { x: cx - 1, y: cy - 2, w: 2, h: 4 });
  if (kept) placeBone(host, pose, kept); else host.appendChild(pose);

  const centerValue = halves(board.center)[0];
  board.arms.forEach((arm, armIndex) => {
    let anchor = centerValue;
    let previous: readonly [number, number] = [cx, cy];
    arm.tiles.forEach((placed, step) => {
      const s = routes[armIndex][step];
      const x = s.x + s.w / 2;
      const y = s.y + s.h / 2;
      const { faces, outward } = crossFaces(placed, anchor, s.orient, x, y, previous);
      const node = boardTile({
        placed, orient: s.orient, faces,
        col: 0, row: 0,
        colSpan: s.orient === 'h' ? 4 : 2,
        rowSpan: s.orient === 'h' ? 2 : 4,
        crossArm: armIndex, crossStep: step,
      });
      place(node, s);
      if (kept) placeBone(host, node, kept); else host.appendChild(node);
      anchor = outward;
      previous = [x, y];
    });
  });
  return u;
}

function renderCross(host: HTMLElement, board: CrossBoard, opts: BoardFit, kept?: Map<string, HTMLElement>) {
  const box = opts.box ?? feltBox();
  // One half-short-side unit is 15px in the 30×60 reference. Live callers
  // pin this before the deal; Watch Back may choose one smaller receipt size.
  // The canvas is RIGID -- 30u by 26u for any number of bones -- so a pin that
  // does not fit does not overflow gracefully, it clips, and it clips for the
  // whole hand. Cap the pin at what the measured board can hold. Because the
  // canvas never grows, fitting it once fits it forever: no French board pans,
  // at any size, at any point in a hand.
  // Fitting the canvas is capped BY THE READABLE MINIMUM, never the other way
  // round. A landscape table has room to shrink into (1368x900 lands on 28px),
  // so there it costs nothing. A phone does not: fitting a late cross there
  // works out at 20px, and 16px on a 360px screen, against the linear game's
  // 28px.
  //
  // That is not a trade this game can make. Dominoes is played by older
  // people, and the owner has now said so twice — a board that is fully
  // visible and unreadable is worse than one that is readable and pans. So a
  // phone keeps its readable bone and routes inside its own width instead
  // (renderPhoneCross below); the fixed reference canvas is desktop only.
  const fitCap = frenchCanvasUnit(box);
  const readableFloor = opts.minUnit ?? CROSS_MIN_UNIT;
  const pinned = opts.unit ?? fitCap;
  const requested = opts.fitCrossToBox === false || opts.frenchPinwheel ? pinned : Math.min(pinned, fitCap);
  const u = Math.max(readableFloor, Math.min(opts.maxUnit ?? MAX_UNIT, requested));
  // A phone keeps the readable bone and routes inside its own width.
  if (opts.fitCrossToBox === false || opts.frenchPinwheel) return renderPhoneCross(host, board, opts, box, u, kept);
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
  // An arm belongs to the seat that opened it and runs towards them, so the
  // compass is resolved here, per viewer, rather than read off the board.
  const armDirections = opts.viewerSeat === undefined
    ? board.arms.map((arm) => arm.direction)
    : crossArmDirections(board.arms, opts.viewerSeat);
  board.arms.forEach((arm, armIndex) => {
    let anchor = centerValue;
    let previous: readonly [number, number] = [225, 195];
    const route = FRENCH_REFERENCE_ROUTES[armDirections[armIndex]];
    arm.tiles.forEach((placed, step) => {
      const point = route[step];
      if (!point) throw new Error(`French ${armDirections[armIndex]} arm exceeds the measured route`);
      const [x, y, orient] = point;
      const { faces, outward } = crossFaces(placed, anchor, orient, x, y, previous);
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
export function placeBoardChoices(
  boardStage: HTMLElement,
  dock: HTMLElement | null,
  handHost: HTMLElement | null = null,
): HTMLElement | null {
  if (!dock) return null;
  const row = dock.querySelector<HTMLElement>('[data-board-choice]');
  if (!row) return dock;

  const overlay = document.createElement('div');
  overlay.className = 'board-choice-overlay';
  overlay.setAttribute('aria-label', 'Choose where to play');
  const prompt = row.querySelector<HTMLElement>('.muted');
  const buttons = [...row.querySelectorAll<HTMLButtonElement>('button')];
  // An invalid-tile explanation belongs beside the hand. Only a real board
  // destination choice is lifted onto the open end.
  if (!buttons.length) return dock;
  // The endpoint markers are a spatial aid, but they must never be the only
  // way to finish a move: a long pannable board can put an endpoint outside
  // the current camera. Mirror the same real controls beside the active hand,
  // where they remain visible and keep their original click handlers.
  if (handHost) {
    const handChoices = document.createElement('div');
    handChoices.className = 'hand-end-choice-bar';
    handChoices.setAttribute('role', 'group');
    handChoices.setAttribute('aria-label', 'Choose where to play the selected bone');
    buttons.forEach((button) => {
      const choice = button.cloneNode(true) as HTMLButtonElement;
      choice.classList.add('hand-end-choice');
      const side = button.dataset.linearEnd;
      const pip = button.dataset.openPip;
      if (side === 'left') choice.textContent = `← Left${pip ? ` · ${pip}` : ''}`;
      else if (side === 'right') choice.textContent = `Right${pip ? ` · ${pip}` : ''} →`;
      else if (buttons.length === 1) choice.textContent = 'Play selected bone';
      choice.onclick = () => button.click();
      handChoices.appendChild(choice);
    });
    handHost.appendChild(handChoices);
  }
  if (prompt) {
    // The destination buttons carry the visible instruction beside the open
    // bone. Keep this sentence for the overlay's accessible name only.
    prompt.hidden = true;
    overlay.appendChild(prompt);
  }
  buttons.forEach((button) => {
    button.classList.add('board-end-choice');
    overlay.appendChild(button);
  });
  row.remove();
  boardStage.appendChild(overlay);

  const centre = (rect: DOMRect) => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  // The table's own first-frame measurement can resize the protected board
  // stage and rerender the line. Position one frame after that settles.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    // When a long Across line overflows its stage, the browser normally keeps
    // the scroll position at the left edge. A two-end choice would then leave
    // the opposite arrow outside the viewport (the exact failure reported in
    // the live capture). Centre the board camera before measuring endpoints so
    // both legal destinations have the best possible chance of being visible;
    // the stage remains independently pannable for exceptionally long lines.
    if (buttons.length > 1 && boardStage.scrollWidth > boardStage.clientWidth + 1) {
      boardStage.scrollLeft = Math.max(0, (boardStage.scrollWidth - boardStage.clientWidth) / 2);
    }
    if (buttons.length > 1 && boardStage.scrollHeight > boardStage.clientHeight + 1) {
      boardStage.scrollTop = Math.max(0, (boardStage.scrollHeight - boardStage.clientHeight) / 2);
    }
    const stageRect = boardStage.getBoundingClientRect();
    const line = boardStage.querySelector<HTMLElement>('.line');
    if (!line || !stageRect.width || !stageRect.height) return;
    const hub = line.querySelector<HTMLElement>('.tile.hub');

    const placedChoices: Array<{ x: number; y: number }> = [];
    overlay.querySelectorAll<HTMLButtonElement>('.board-end-choice').forEach((button, choiceIndex) => {
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
      if (!end) {
        // Opening pose: there is no rendered end yet. Keep one transparent
        // arrow in the centre as the confirmation target; the accessible name
        // carries the full instruction without covering the domino beneath it.
        if (buttons.length === 1) {
          button.textContent = '→';
          button.dataset.openingChoice = 'true';
          button.setAttribute('aria-label', 'Play the selected bone here');
          button.style.left = '50%';
          button.style.top = '50%';
        }
        return;
      }

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
      // `overlay` is positioned in the board-stage's scroll-content
      // coordinate system, while DOMRects are viewport coordinates. Include
      // the current scroll offset or a panned Across board sends the arrow
      // behind the wrong tile (or entirely outside the visible stage).
      const contentX = e.x - stageRect.left + boardStage.scrollLeft + ux * distance;
      const contentY = e.y - stageRect.top + boardStage.scrollTop + uy * distance;
      // Clamp to the VISIBLE camera, not the full scrollable canvas.  Using
      // scrollWidth/scrollHeight as the upper bound let the marker be legally
      // positioned hundreds of pixels off-screen on an overflowing late hand.
      // The button is the move's commit target, so it must never hide even when
      // its endpoint is just beyond the current camera.
      const visibleLeft = 24 + boardStage.scrollLeft;
      const visibleRight = boardStage.scrollLeft + boardStage.clientWidth - 24;
      const visibleTop = 24 + boardStage.scrollTop;
      const visibleBottom = boardStage.scrollTop + boardStage.clientHeight - 24;
      let x = Math.max(visibleLeft, Math.min(visibleRight, contentX));
      let y = Math.max(visibleTop, Math.min(visibleBottom, contentY));
      // Two legal destinations must remain two distinct, tappable targets.
      // A turned line can put both endpoint vectors on the same pixel (the
      // old overlay then painted one arrow directly over the other). Nudge a
      // collision along the perpendicular axis while staying inside the
      // protected stage.
      if (placedChoices.some((p) => Math.abs(p.x - x) < 8 && Math.abs(p.y - y) < 8)) {
        const nudge = 34 + choiceIndex * 8;
        if (horizontal) y = Math.max(visibleTop,
          Math.min(visibleBottom, y + (choiceIndex % 2 ? nudge : -nudge)));
        else x = Math.max(visibleLeft,
          Math.min(visibleRight, x + (choiceIndex % 2 ? nudge : -nudge)));
      }
      placedChoices.push({ x, y });
      const arrow = horizontal ? (ux < 0 ? '←' : '→') : (uy < 0 ? '↑' : '↓');
      const direction = horizontal ? (ux < 0 ? 'left' : 'right') : (uy < 0 ? 'up' : 'down');
      const pip = button.dataset.openPip;
      button.textContent = arrow;
      button.dataset.direction = direction;
      button.setAttribute('aria-label', buttons.length === 1
        ? `Play the selected bone here, ${direction}${pip ? `, open ${pip}` : ''}`
        : `Play on the ${direction} end${pip ? `, open ${pip}` : ''}`);
      button.style.left = `${x}px`;
      button.style.top = `${y}px`;
    });
  }));

  return dock.childElementCount ? dock : null;
}

type GuardRect = Pick<DOMRect, 'top' | 'right' | 'bottom' | 'left'>;
type GuardEdge = 'top' | 'right' | 'bottom' | 'left';

/**
 * The box a child's CSS `inset` actually resolves against.
 *
 * getBoundingClientRect() returns the BORDER box, but `inset` on an absolutely
 * positioned child is measured from its containing block's PADDING box. The
 * live felt carries a 7-10px border, so measuring obstacles in one box and
 * writing the answer in the other over-insets the board by the border width on
 * every edge at once.
 */
export function paddingBoxOf(
  rect: GuardRect,
  border: { top: number; right: number; bottom: number; left: number },
): GuardRect {
  return {
    top: rect.top + border.top,
    right: rect.right - border.right,
    bottom: rect.bottom - border.bottom,
    left: rect.left + border.left,
  };
}

/** Pure geometry behind the invisible square central-table guard. */
export function boardGuardInsets(
  felt: GuardRect,
  stage: GuardRect,
  obstacles: ReadonlyArray<{ edge: GuardEdge; rect: GuardRect }>,
  gap: number,
  /**
   * Square the playable rectangle. TRUE only for a French cross, whose four
   * arms need equal clearance in every direction.
   *
   * A linear chain does not: it snakes in rows and wants every pixel of height
   * it can get. Squaring it was measured on a real 430x932 phone as the single
   * biggest loss on the table — the felt offered ~400px of clear height and the
   * square cut the board to 247x246, so from 20 bones down EVERY board
   * overflowed and the player scrolled the back half of each hand.
   */
  square = true,
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
  // Obstacles define the largest safe rectangle. For French, centre the largest
  // SQUARE inside it so its four arms have equal, guaranteed clearance and can
  // never drift toward the hand on a wide table. A linear board keeps the whole
  // rectangle — the obstacles already hold it off every station and the hand.
  const availableWidth = (felt.right - felt.left) - inset.left - inset.right;
  const availableHeight = (felt.bottom - felt.top) - inset.top - inset.bottom;
  if (!square) return inset;
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
/**
 * Hold a French cross centred on its own pose inside a stage it overflows.
 *
 * `align-items: safe center` falls back to START alignment once content is
 * bigger than its box — correct for a snaking line, wrong for a cross, whose
 * whole shape is read outward from the centre. Measured on a 430px phone: a
 * 420px canvas in a 332px stage put the chucha 44px right of centre and left
 * the entire right arm off-screen with nothing to say so.
 *
 * Centring the SCROLL instead keeps the pose where the eye expects it and
 * makes both sides equally reachable. Only runs while the viewer has not
 * panned themselves.
 */
/**
 * Tell the stylesheet which way this board can be moved, so the edge with more
 * behind it can be faded.
 *
 * A scrollbar is not an answer here: it never appears on a touch screen until
 * you are already scrolling, and this game's players should not have to know
 * what one is. The faded edge is the affordance people read without being
 * taught.
 */
export function markPannable(stage: HTMLElement | null): void {
  if (!stage) return;
  const ways: string[] = [];
  if (stage.scrollWidth > stage.clientWidth + 1) ways.push('x');
  if (stage.scrollHeight > stage.clientHeight + 1) ways.push('y');
  // Desktop hides overflow only after this measured proof. A short landscape
  // or Across table that cannot hold the complete fixed-size route keeps its
  // controlled board pan instead of silently clipping late bones.
  stage.classList.toggle('board-stage-fitted', ways.length === 0);
  if (ways.length) stage.dataset.pans = ways.join(' ');
  else delete stage.dataset.pans;
}

export function centreCrossOnPose(stage: HTMLElement | null, line: HTMLElement | null): void {
  if (!stage || !line) return;
  const pose = line.querySelector<HTMLElement>('.tile.hub');
  if (!pose) return;
  const panX = stage.scrollWidth - stage.clientWidth;
  const panY = stage.scrollHeight - stage.clientHeight;
  markPannable(stage);
  if (panX <= 1 && panY <= 1) return;
  if (stage.scrollLeft > 1 || stage.scrollTop > 1) return;
  const view = stage.getBoundingClientRect();
  const bone = pose.getBoundingClientRect();
  if (!view.width || !bone.width) return;
  const dx = (bone.left + bone.width / 2) - (view.left + view.width / 2);
  const dy = (bone.top + bone.height / 2) - (view.top + view.height / 2);
  if (panX > 1) stage.scrollLeft = Math.max(0, Math.min(panX, Math.round(dx)));
  if (panY > 1) stage.scrollTop = Math.max(0, Math.min(panY, Math.round(dy)));
}

/**
 * Put the turn strip beside my own hand (owner, 2026-09-16: it belongs "next
 * to my hand to indicate when domino is sending"). Measured, not pinned: the
 * hand is centred and its width changes with the bones left, and an earlier
 * fixed offset put the strip behind the side player's rack. The bottom band
 * already belongs to the hand, so a strip beside it costs the board nothing.
 */
export function placeSideInfo(felt: HTMLElement, side: HTMLElement): void {
  const feltRect = felt.getBoundingClientRect();
  if (!feltRect.height) return;
  const hand = felt.querySelector<HTMLElement>('.my-hand-panel.in-felt-hand, .in-felt-across-hands > .across-hand-own');
  const size = side.getBoundingClientRect();
  const width = size.width || 96;
  const height = size.height || 48;
  const clear = (left: number, top: number) => !([...felt.querySelectorAll<HTMLElement>('.table-seat-identity, .table-rack, .desktop-self-identity')]
    .some((node) => {
      if (node === side || side.contains(node)) return false;
      const r = node.getBoundingClientRect();
      if (!r.width) return false;
      const x = r.left - feltRect.left;
      const y = r.top - feltRect.top;
      return left < x + r.width + 8 && x < left + width + 8 && top < y + r.height + 8 && y < top + height + 8;
    }));
  if (hand) {
    const handRect = hand.getBoundingClientRect();
    const handLeft = handRect.left - feltRect.left;
    const handRight = handRect.right - feltRect.left;
    const top = Math.round(handRect.top - feltRect.top + (handRect.height - height) / 2);
    const leftSide = Math.round(handLeft - width - 12);
    const rightSide = Math.round(handRight + 12);
    for (const left of [leftSide, rightSide]) {
      if (left >= 8 && left + width <= feltRect.width - 8 && clear(left, top)) {
        side.style.left = `${left}px`;
        side.style.right = 'auto';
        side.style.top = `${Math.max(8, top)}px`;
        side.style.bottom = 'auto';
        return;
      }
    }
  }
  // No room beside the hand: the tallest free gap in my own side column.
  const column = [...felt.querySelectorAll<HTMLElement>('.table-seat-identity, .table-rack, .desktop-self-identity')]
    .filter((node) => node !== side && !side.contains(node))
    .map((node) => node.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.left - feltRect.left < feltRect.width / 3)
    .map((r) => ({ top: r.top - feltRect.top, bottom: r.bottom - feltRect.top }))
    .sort((a, b) => a.top - b.top);
  const gaps: Array<{ top: number; bottom: number }> = [];
  let cursor = 8;
  for (const box of column) {
    if (box.top - cursor >= height + 12) gaps.push({ top: cursor, bottom: box.top });
    cursor = Math.max(cursor, box.bottom);
  }
  if (feltRect.height - 8 - cursor >= height + 12) gaps.push({ top: cursor, bottom: feltRect.height - 8 });
  const chosen = gaps[gaps.length - 1];
  side.style.left = '8px';
  side.style.right = 'auto';
  if (!chosen) {
    side.style.top = 'auto';
    side.style.bottom = '8px';
    return;
  }
  side.style.bottom = 'auto';
  side.style.top = `${Math.round(chosen.top + (chosen.bottom - chosen.top - height) / 2)}px`;
}

export function reserveBoardStage(
  felt: HTMLElement,
  boardStage: HTMLElement,
  stations: Iterable<HTMLElement>,
  hand: HTMLElement | null,
  /** Square the guard — French only. See boardGuardInsets. */
  square = true,
): void {
  if (felt === boardStage) return;
  // Every measurement starts from the stylesheet's broad board area. Keeping
  // the previous inline guard here makes the square ratchet smaller forever:
  // after a viewport or felt grows, that old square becomes the new baseline
  // and can never expand again.
  boardStage.style.removeProperty('inset');
  const feltBorderBox = felt.getBoundingClientRect();
  if (!feltBorderBox.width || !feltBorderBox.height) return;
  // Everything below is written back as boardStage.style.inset, so every
  // measurement has to happen in the box that inset resolves against.
  const edge = window.getComputedStyle(felt);
  const feltRect = paddingBoxOf(feltBorderBox, {
    top: parseFloat(edge.borderTopWidth) || 0,
    right: parseFloat(edge.borderRightWidth) || 0,
    bottom: parseFloat(edge.borderBottomWidth) || 0,
    left: parseFloat(edge.borderLeftWidth) || 0,
  });
  if (!(feltRect.right > feltRect.left) || !(feltRect.bottom > feltRect.top)) return;
  // Roomy tables get a full bone-edge breathing gap; phones retain 12px so
  // the guard protects the hand without making the board unreadably narrow.
  // 16px, not 24. This gap is applied on all four edges, so on a wide desktop
  // felt the old cap spent 48px of HEIGHT keeping bones off stations that are
  // nowhere near them vertically — and height is the scarce axis there. 16px is
  // still a clear reveal, and comfortably above the 12px phone floor.
  // Mobile Practice's fixed board keeps only a thin reveal from the racks: its
  // route already keeps felt between bones, and every pixel of width is board.
  const phoneRoute = boardStage.classList.contains('phone-route-stage');
  const gutter = phoneRoute ? 6 : Math.max(12, Math.min(16, (feltRect.right - feltRect.left) * 0.015));
  const actionDock = felt.querySelector<HTMLElement>('.in-felt-actions');
  const acrossOwn = felt.querySelector<HTMLElement>('.in-felt-across-hands > .across-hand-own');
  const acrossPartner = felt.querySelector<HTMLElement>('.in-felt-across-hands > .across-hand-partner');
  const lowerHand = hand ?? acrossOwn;

  // The hand owns the lower centre of the table. Keep Pass/reshuffle in view
  // on the felt, but lift that small dock above the hand if the viewport makes
  // their rectangles meet. This is based on the rendered boxes, not a desktop
  // breakpoint guess, so Practice and Lounge behave the same way.
  if (actionDock && lowerHand) {
    const actionRect = actionDock.getBoundingClientRect();
    const handRect = lowerHand.getBoundingClientRect();
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
    // Desktop corners and edge racks share ownership but not one enclosure.
    // Measure the visible children, since display:contents has no own box.
    // Match the CSS desktop composition exactly (min-width: 901px). Between
    // 901 and 1100 the station wrapper is already display:contents, so its own
    // rectangle is zero; measuring that wrapper collapsed the guarded board
    // to zero width on a 1024px laptop.
    if (window.innerWidth > 900) {
      const isTop = station.classList.contains('table-player-station-top');
      const isLeft = station.classList.contains('table-player-station-left');
      const identity = station.querySelector<HTMLElement>('.table-seat-identity');
      const rack = station.querySelector<HTMLElement>('.table-rack');
      if (identity) obstacles.push({ edge: isLeft ? 'left' : 'right', rect: identity.getBoundingClientRect() });
      if (rack) obstacles.push({ edge: isTop ? 'top' : isLeft ? 'left' : 'right', rect: rack.getBoundingClientRect() });
      continue;
    }
    const rect = station.getBoundingClientRect();
    if (station.classList.contains('table-player-station-left')) {
      obstacles.push({ edge: 'left', rect });
    } else if (station.classList.contains('table-player-station-right')) {
      obstacles.push({ edge: 'right', rect });
    } else if (station.classList.contains('table-player-station-top')) {
      obstacles.push({ edge: 'top', rect });
    }
  }
  if (window.innerWidth > 900) {
    const self = felt.parentElement?.querySelector<HTMLElement>('.desktop-self-identity')
      ?? felt.querySelector<HTMLElement>('.desktop-self-identity');
    if (self) obstacles.push({ edge: 'left', rect: self.getBoundingClientRect() });
    const acrossBottom = felt.parentElement?.querySelector<HTMLElement>('.across-controlled-identity.table-seat-identity-bottom');
    const acrossTop = felt.parentElement?.querySelector<HTMLElement>('.across-controlled-identity.table-seat-identity-top');
    if (acrossBottom) obstacles.push({ edge: 'left', rect: acrossBottom.getBoundingClientRect() });
    if (acrossTop) obstacles.push({ edge: 'right', rect: acrossTop.getBoundingClientRect() });
  }
  if (hand) obstacles.push({ edge: 'bottom', rect: hand.getBoundingClientRect() });
  // Across exposes the two hands controlled by this player at the two seats
  // they physically occupy. They are part of the table, but never part of the
  // playable board rectangle.
  if (acrossOwn) obstacles.push({ edge: 'bottom', rect: acrossOwn.getBoundingClientRect() });
  if (acrossPartner) obstacles.push({ edge: 'top', rect: acrossPartner.getBoundingClientRect() });
  if (actionDock) obstacles.push({ edge: 'bottom', rect: actionDock.getBoundingClientRect() });
  const guard = boardGuardInsets(feltRect, stageRect, obstacles, gutter, square);
  boardStage.dataset.boardGuard = square ? 'measured-square' : 'measured-rect';
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
  /**
   * `french` matters because French inverts the whole readout: it is a race to
   * 100 where the LOWEST score wins, so zero is the best seat at the table
   * rather than a hole to climb out of, and a rising score is bad news.
   */
  opts: { us?: boolean; bruk?: boolean; max?: number; tiles?: number; french?: boolean } = {},
) {
  const max = opts.max ?? 6;
  const wrap = document.createElement('div');
  wrap.className = 'side-score';

  const name = document.createElement('div');
  name.className = 'side-name' + (opts.us ? ' us' : '');
  name.textContent = label;
  wrap.appendChild(name);

  // No pip track for French. Six pips scaled by `max` LIGHT UP as the score
  // climbs, which reads as progress — true at six-love and first-to-six, and
  // exactly backwards in French, where climbing toward 100 is losing. A full
  // track would have meant "nearly beaten".
  if (!opts.french) {
    const pips = document.createElement('div');
    pips.className = 'pips' + (opts.bruk ? ' bruk' : '');
    for (let i = 0; i < 6; i++) {
      const pip = document.createElement('i');
      if (Math.round(i / 6 * max) < score) pip.classList.add('lit');
      pips.appendChild(pip);
    }
    wrap.appendChild(pips);
  }

  // Always render the number, not just above 6 points — mobile hides the
  // pip track to keep the pinned scoreboard from crowding out the felt (see
  // .sticky-scores in styles.css), so this is the only score readout left
  // there for sixlove/first-to-six too, not just French.
  const note = document.createElement('div');
  note.className = 'under-love';
  // Love is a six-love idea: on nothing while the other side scores, and the
  // side under love bruks the board by winning it. French has no such thing —
  // reported live as "Duppy 4 under love" on a French table, which is not a
  // rule this game has.
  note.textContent = score === 0 && !opts.french ? 'under love' : String(score);
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
  result: Pick<HandResult, 'counts' | 'doublePips' | 'winnerPlayedDouble' | 'winnerSeat'>,
  scoresBefore: number[],
  scoresAfter: number[],
  seatLabel: (seat: number) => string,
): HTMLElement {
  const wrap = el('div', 'french-breakdown');
  wrap.append(el('div', 'eyebrow', 'Count this hand'));
  result.counts.forEach((pips, seat) => {
    const tags: string[] = [];
    // Only a held double counts twice, never the whole hand (owner, 2026-09-13).
    const doublePips = result.doublePips?.[seat] ?? 0;
    if (doublePips > 0) tags.push(`double left in hand counts twice, +${doublePips}`);
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
