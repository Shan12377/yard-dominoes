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
import { tilesCarrying, unaccountedFor } from './tiles.ts';
import {
  deadDoubles,
  endsAfter,
  suitStrength,
  suitsSeen,
  voidsFromLog,
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
