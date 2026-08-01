// Turning one completed SET into Glicko rating updates. Pure — no Deno, no
// network, no database — so `npm test` covers this without a live project,
// same discipline as billing.ts. The actual Glicko-1 math lives in
// packages/engine/src/rating.ts and knows nothing about dominoes; this file
// is the domino-specific glue: how a set's winnerSide becomes an opponent
// list for each seat.
//
// Only fully-human tables are rated. Duppies have no profile and therefore
// no rating to update or to serve as a "real" opponent — averaging a bot's
// non-existent rating into a partner-side calculation would be nonsense, and
// crediting a human with beating three bots would be free rating inflation.
// A table with even one duppy seat is skipped entirely, not partially rated.

import { isPartnered, seatsOfSide, sideOf } from './engine/tiles.ts';
import { updateRating } from './engine/rating.ts';
import type { Opponent, RatingState } from './engine/rating.ts';
import type { GameMode } from './engine/types.ts';

export interface RatedSeat {
  userId: string | null;
  rating: RatingState;
}

export interface RatingUpdate {
  userId: string;
  next: RatingState;
}

/**
 * Ratings for every seat after this set, or [] if the set should not be
 * rated at all. Snapshots every seat's pre-set rating before computing
 * anyone's update — Glickman's own spec requires this ("the following two
 * steps are computed in parallel for all players"); using an already-updated
 * teammate's or opponent's rating mid-calculation would make the result
 * depend on iteration order, which Glicko is not defined to do.
 */
export function ratingUpdatesForSet(
  mode: GameMode,
  seats: RatedSeat[],
  winnerSide: number,
): RatingUpdate[] {
  if (seats.some((s) => s.userId === null)) return [];

  const seatCount = seats.length;
  const updates: RatingUpdate[] = [];

  for (let seat = 0; seat < seatCount; seat++) {
    const mySide = sideOf(seat, mode);
    const won = mySide === winnerSide;

    let opponents: Opponent[];
    if (isPartnered(mode)) {
      // One virtual opponent: the average rating and RD of the other side.
      // A standard simplification for team ratings without decomposing
      // individual skill from a team result — Glicko has no native notion
      // of a team, so this is domino-specific glue, not part of the engine.
      const otherSeats = seatsOfSide(1 - mySide, seatCount, mode)
        .map((s) => seats[s].rating);
      const avgRating = otherSeats.reduce((sum, r) => sum + r.rating, 0) / otherSeats.length;
      const avgRd = otherSeats.reduce((sum, r) => sum + r.rd, 0) / otherSeats.length;
      opponents = [{ rating: avgRating, rd: avgRd, score: won ? 1 : 0 }];
    } else if (won) {
      // Cutthroat winner: beat every other seat individually. Real,
      // independent evidence against each of them.
      opponents = seats
        .filter((_, i) => i !== seat)
        .map((s) => ({ rating: s.rating.rating, rd: s.rating.rd, score: 1 as const }));
    } else {
      // Cutthroat loser: only rated against the winner. The other losers'
      // relative order among themselves is unknown — cutthroat only
      // resolves a single winnerSide, not a full placement — so there is no
      // evidence to rate a loser against another loser.
      const winner = seats[winnerSide].rating;
      opponents = [{ rating: winner.rating, rd: winner.rd, score: 0 }];
    }

    updates.push({ userId: seats[seat].userId!, next: updateRating(seats[seat].rating, opponents) });
  }

  return updates;
}
