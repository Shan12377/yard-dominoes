/**
 * Reading the table — the live coach.
 *
 * The post-hand Coach (`coach.ts`) solves finished positions with perfect
 * information. This is the opposite: what a player can legitimately work out
 * WHILE the hand is running, from nothing but what everyone at the table can
 * see.
 *
 * THE INVARIANT, AND WHY THIS IS A SEPARATE FILE. Every function here takes a
 * `PublicView` and nothing else. `PublicView` has no field capable of holding
 * another seat's tiles (see the block at the top of `bots.ts`), so a read
 * produced here cannot be based on information the player does not have.
 *
 * That matters more than it looks. Practice runs entirely in the browser, so
 * the client genuinely holds every duppy's hand in memory. A live coach that
 * reached for it would be easy to write, would feel astonishing, and would
 * teach reads that evaporate the moment the player sits at a real table where
 * the tiles are on a server. It would be worse than useless — it would train
 * a habit that loses games. This file never imports `HandState` for exactly
 * that reason: the leak is not guarded against, it is unwritable.
 *
 * The split below is deliberate and pedagogical:
 *
 *   - `readTable` returns COUNTED facts. Arithmetic over the board and your
 *     own hand — no guessing, no sampling. Seven tiles carry each pip; the
 *     ones you cannot see are somewhere. Tracking this by hand is tedious
 *     bookkeeping, not skill, which is why it is given away for free.
 *   - `outlookFor` returns PROVEN consequences. A pass is permanent evidence
 *     (`voidsFromLog`), so "close both ends to 6 and seat 2 must pass" is a
 *     fact, not a hunch.
 *
 * What is NOT here is the recommendation — "play this tile". That needs the
 * sampler (`sampleConsistentDeal`) or a solve, it costs real time, and handing
 * it over on every turn trains dependence rather than reading. It belongs
 * behind a deliberate tap, using `chooseMove` at the `general` tier.
 */

import { openEnds } from './hand.ts';
import { tileCount, tilesCarrying, unaccountedFor } from './tiles.ts';
import {
  deadDoubles,
  endsAfter,
  factorTotal,
  partnerSeatOf,
  scoreFactors,
  suitStrength,
  suitsSeen,
  voidsFromLog,
  type DuppyLevel,
  type MoveFactors,
  type PublicView,
} from './bots.ts';
import type { Move, Pip, TileId } from './types.ts';

/** One suit's arithmetic, from the player's own side of the table. */
export interface SuitCount {
  pip: Pip;
  /** Tiles in my hand showing this pip. Doubles count once, as everywhere. */
  mine: number;
  /** Carrying this pip and visible to me — on the board, or in my hand. */
  seen: number;
  /**
   * Carrying this pip and NOT visible: in another seat's hand, or in the
   * boneyard where one exists. See `TableRead.boneyardSize` before telling a
   * player these are all in opponents' hands.
   */
  out: number;
  /** How many exist at all — 7, or 6 for blanks in a three-hander. */
  total: number;
  /**
   * Exactly one copy unaccounted for anywhere. If this suit is also an open
   * end, whoever faces it either holds that lone tile or passes — nobody can
   * ever answer it again. Jamaican players call that a hard end.
   */
  lastOne: boolean;
}

/** What the passes have proven about one seat. */
export interface SeatRead {
  seat: number;
  handSize: number;
  /** Suits this seat has proven it cannot play, by passing on them. */
  voids: Pip[];
  /**
   * Void in every end currently open, so it cannot move at all right now.
   * Certain — derived from passes, never guessed.
   */
  mustPassNow: boolean;
}

export interface TableRead {
  suits: SuitCount[];
  /** Every seat but the reader's own. */
  seats: SeatRead[];
  openEnds: Pip[];
  /** My doubles whose suit is spent and which no open end exposes. */
  deadDoubles: TileId[];
  /**
   * Tiles nobody has been dealt. Zero at a four-hander, where all 28 go out.
   * Non-zero means `SuitCount.out` is not the same as "in opponents' hands".
   */
  boneyardSize: number;
}

/**
 * The counted facts. Instant — no sampling, no solve, safe to run on every
 * render.
 */
export function readTable(view: PublicView): TableRead {
  const seen = suitsSeen(view);
  const mine = suitStrength(view.myHand);
  const voids = voidsFromLog(view);
  const ends = view.board ? openEnds(view.board) : [];

  const suits: SuitCount[] = [];
  for (let pip = 0 as Pip; pip <= 6; pip = (pip + 1) as Pip) {
    const total = tilesCarrying(pip, view.seatCount);
    const out = unaccountedFor(pip, seen[pip], view.seatCount);
    suits.push({ pip, mine: mine[pip], seen: seen[pip], out, total, lastOne: out === 1 });
  }

  const seats: SeatRead[] = [];
  for (let seat = 0; seat < view.seatCount; seat++) {
    if (seat === view.seat) continue;
    const theirVoids = [...voids[seat]].sort((a, b) => a - b);
    seats.push({
      seat,
      handSize: view.handSizes[seat] ?? 0,
      voids: theirVoids,
      mustPassNow: blockedBy(voids[seat], ends),
    });
  }

  return { suits, seats, openEnds: ends, deadDoubles: deadDoubles(view), boneyardSize: view.boneyardSize };
}

/**
 * Void in every one of these ends, so provably stuck.
 *
 * An empty end list means the board is not posed yet and nobody is stuck, so
 * it answers false rather than vacuously true.
 */
function blockedBy(voids: Set<Pip>, ends: Pip[]): boolean {
  if (ends.length === 0) return false;
  return ends.every((end) => voids.has(end));
}

/** What a move would force, proven from the passes already made. */
export interface MoveOutlook {
  /** The open pips after this move — however many arms a cross exposes. */
  endsAfter: Pip[];
  /**
   * Seats that could not answer any of those ends. Certain knowledge from
   * their own passes, not a probability.
   */
  forcedPasses: number[];
  /**
   * Every other seat still holding tiles is in `forcedPasses`, so the board
   * returns to you untouched and you play again. This is the read the whole
   * feature exists for: locking both ends and going round.
   */
  comesBackToMe: boolean;
}

/**
 * Look ahead one move, using only what passes have proven.
 *
 * Deliberately takes a single move rather than enumerating them: legal-move
 * generation needs a `HandState`, and building a stub here would put the type
 * this file refuses to import back in reach. The caller already knows its own
 * legal moves — it renders them — so it maps over them itself.
 */
export function outlookFor(view: PublicView, move: Move): MoveOutlook {
  const ends = endsAfter(view.board, move, view.format);
  const voids = voidsFromLog(view);

  const forcedPasses: number[] = [];
  let everyoneElseStuck = true;
  for (let seat = 0; seat < view.seatCount; seat++) {
    if (seat === view.seat) continue;
    if ((view.handSizes[seat] ?? 0) === 0) continue;
    if (blockedBy(voids[seat], ends)) forcedPasses.push(seat);
    else everyoneElseStuck = false;
  }

  return {
    endsAfter: ends,
    forcedPasses,
    // A hand where nobody else is left holding tiles is over; that is not the
    // board coming back around, so it must not be reported as such.
    comesBackToMe: everyoneElseStuck && forcedPasses.length > 0,
  };
}

/**
 * A double in my hand that is running out of chances to go down.
 *
 * Jamaican players warn about this one constantly: hold the 6-6 while the
 * other sixes get played out and it is stranded — unplayable, and twelve pips
 * against you when the board blocks, where the count that decides it is the
 * LOWEST INDIVIDUAL hand, not the team's. The engine already has
 * `deadDoubles` for one that is beyond saving; this is the warning that comes
 * before it, while there is still something to be done.
 */
export interface DoubleRisk {
  tile: TileId;
  pip: Pip;
  /** Pips it costs me if the board blocks with it still in my hand. */
  pips: number;
  /** Other tiles carrying this suit still unaccounted for anywhere. */
  othersOut: number;
  /** That suit is an open end right now, so it can go down this turn. */
  openNow: boolean;
  /** Nothing left to open it and it is not open now — already stranded. */
  dead: boolean;
  /**
   * Every remaining copy is with seats that could still play it. Empty when
   * nobody who could open the suit is left holding one.
   */
  couldOpenIt: number[];
}

/**
 * Doubles I hold whose suit is thinning out, worst first.
 *
 * "Thinning" is deliberately generous — a double with two copies of its suit
 * still out is already worth thinking about, because both could land in the
 * same turn and then it is too late to do anything.
 */
export function doubleRisks(view: PublicView): DoubleRisk[] {
  const seen = suitsSeen(view);
  const open = new Set(view.board ? openEnds(view.board) : []);
  const read = readTable(view);
  const risks: DoubleRisk[] = [];

  for (const tile of view.myHand) {
    const [a, b] = tile.split('-').map(Number) as [Pip, Pip];
    if (a !== b) continue;
    // My own double is one of the copies I can see, so the others still out
    // are whatever is unaccounted for.
    const othersOut = unaccountedFor(a, seen[a], view.seatCount);
    const openNow = open.has(a);
    if (!openNow && othersOut > 2) continue; // plenty of chances left
    risks.push({
      tile,
      pip: a,
      pips: a * 2,
      othersOut,
      openNow,
      dead: !openNow && othersOut === 0,
      couldOpenIt: couldHold(a, read),
    });
  }
  // Worst first: stranded, then heaviest, then thinnest suit.
  return risks.sort((x, y) =>
    Number(y.dead) - Number(x.dead) || y.pips - x.pips || x.othersOut - y.othersOut);
}

/**
 * The seats that could still be holding a given suit: not proven void in it,
 * and still holding tiles.
 *
 * When this comes back with exactly one seat and `SuitCount.out` is above
 * zero, every remaining tile of that suit is in one known hand — the strongest
 * read available from public information alone, and the reason the passes are
 * worth tracking at all.
 *
 * Returns seat indices rather than a sentence on purpose. The client already
 * names seats (`seatName`/`describeSeat` in `movelog.ts`, duppy personas at a
 * practice table), and an engine that spelled out "seat 2" would either
 * duplicate that or contradict it.
 */
export function couldHold(pip: Pip, read: TableRead): number[] {
  return read.seats
    .filter((s) => s.handSize > 0 && !s.voids.includes(pip))
    .map((s) => s.seat);
}

/** One candidate play, ranked, with everything needed to say why. */
export interface MoveAdvice {
  move: Move;
  tile: TileId;
  /** Higher is better. The duppies' own scoring, so advice and bots agree. */
  score: number;
  factors: MoveFactors;
  endsAfter: Pip[];
  /**
   * Suits this move puts on the board that were not open before — "putting
   * out a new number". Cheap when you can answer it, dangerous when you
   * cannot: it hands everybody else a fresh way in.
   */
  opensNew: Pip[];
  /** Ends I would leave that I hold nothing for, having played this tile. */
  cannotAnswer: Pip[];
  /** Every other seat provably unable to answer any resulting end. */
  forcedPasses: number[];
  /**
   * The same, minus your own partner.
   *
   * This is the one worth boasting about. `forcedPasses` counts everybody, and
   * in Partner that includes your mate — blocking him is a mistake, not an
   * achievement, which is why `feedPartner` scores it negatively. Never present
   * a stranded partner as a reason to play something.
   */
  forcesOpponents: number[];
  /** Every other seat is stuck, so the board returns to me untouched. */
  comesBackToMe: boolean;
  /** Ends I would leave that my own partner has already passed on. */
  strandsPartner: Pip[];
  /** This play is my last bone — it ends the hand. */
  goesOut: boolean;
  /** Pips this gets off my hand before the board can block. */
  pipsShed: number;
  /** An at-risk double this play unloads, if any. */
  unloadsDouble: TileId | null;
}

/**
 * Every legal play, best first, with the reasoning attached.
 *
 * Ranked by the duppies' own `scoreMove` at the tier given, so the advice a
 * player gets is the same reasoning the strongest duppy uses — take its
 * suggestion every time and you play at that tier. Defaults to `general`.
 *
 * Deliberately the heuristic rather than `chooseMove`'s sampler: the sampler
 * returns a win rate and no reason, and a number a player cannot interrogate
 * teaches nothing and cannot be argued with. This one can always say why.
 *
 * The caller supplies its own legal moves — see `outlookFor` for why this file
 * refuses to build a HandState to enumerate them.
 */
export function adviseMoves(
  view: PublicView,
  legal: Move[],
  level: Exclude<DuppyLevel, 'pickney'> = 'general',
): MoveAdvice[] {
  const before = new Set(view.board ? openEnds(view.board) : []);
  const voids = voidsFromLog(view);
  const mate = partnerSeatOf(view.seat, view.seatCount, view.mode);
  const atRisk = new Set(doubleRisks(view).filter((r) => r.openNow).map((r) => r.tile));

  const advice: MoveAdvice[] = [];
  for (const move of legal) {
    if (move.kind === 'pass' || move.kind === 'draw' || !('tile' in move)) continue;
    const tile = move.tile;
    const outlook = outlookFor(view, move);
    const remaining = view.myHand.filter((t) => t !== tile);
    const strength = suitStrength(remaining);
    const factors = scoreFactors(view, move, level);

    advice.push({
      move,
      tile,
      score: factorTotal(factors),
      factors,
      endsAfter: outlook.endsAfter,
      opensNew: outlook.endsAfter.filter((e) => !before.has(e)),
      cannotAnswer: outlook.endsAfter.filter((e) => strength[e] === 0),
      forcedPasses: outlook.forcedPasses,
      forcesOpponents: outlook.forcedPasses.filter((s) => s !== mate),
      comesBackToMe: outlook.comesBackToMe,
      strandsPartner: mate === null
        ? []
        : outlook.endsAfter.filter((e) => voids[mate].has(e)),
      goesOut: view.myHand.length === 1,
      pipsShed: tileCount(tile),
      unloadsDouble: atRisk.has(tile) ? tile : null,
    });
  }

  return advice.sort((a, b) => b.score - a.score);
}
