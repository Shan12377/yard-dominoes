/**
 * Skill rating — Glicko (Glickman 1995), not Elo and not a JamDom-style
 * bucket ladder.
 *
 * JamDom's own ranking tutorial (their public "Ranks Tutorial" video series)
 * solves two real problems worth keeping: a lucky short streak should not
 * plant a brand-new account at #1, and the system should trust a rating
 * more from a player who has actually proven it repeatedly. Their mechanism
 * for that is a hand-tuned score (`frequency * loveRatio * diverseLoveRatio`)
 * plus a hard wall of four rank divisions that a lower division can never
 * outrank regardless of skill. Both are ad hoc — no principled grounding for
 * the multiplier, and the division wall means a genuinely better player can
 * be permanently capped below a worse one just for being in the "wrong"
 * bucket.
 *
 * Glicko solves the same problem a cleaner way: every player carries a
 * rating AND a ratings deviation (RD) — how much to trust that rating. A
 * new account starts at maximum RD, so its rating swings hard until enough
 * games pin it down; a player who has proven themselves over many games has
 * a low RD and moves only a little per result. Nobody reaches the top of
 * the ladder off two wins, without an arbitrary frequency wall — the
 * uncertainty itself does that job, and it is a well-studied formula
 * (Glickman, "The Glicko system", http://www.glicko.net/glicko.html),
 * not a bucket wall invented for this app.
 *
 * This module is the pure Glicko-1 math only — one player's rating/RD
 * update given their opponents this rating period. How a domino SET turns
 * into an opponent list (team averaging for partner mode, multi-opponent
 * for cutthroat's free-for-all) is game-specific glue that lives in the
 * server, not here; this file has zero domino-specific knowledge, matching
 * every other file in this package.
 */

/** A player's rating and its trustworthiness (Glickman's "ratings deviation"). */
export interface RatingState {
  rating: number;
  rd: number;
}

/** A brand-new, never-played account. */
export const UNRATED: RatingState = { rating: 1200, rd: 350 };

/**
 * RD never drops below this. Glickman's own recommendation: without a
 * floor, a very active player's RD shrinks so small that no result can
 * move their rating appreciably, even one that should.
 */
export const RD_FLOOR = 30;

const Q = Math.log(10) / 400;

/**
 * Down-weights an opponent's rating gap by how uncertain THEIR rating is —
 * a win over someone whose rating cannot be trusted teaches less than a
 * win over someone whose rating is precisely known.
 */
function g(rd: number): number {
  return 1 / Math.sqrt(1 + (3 * Q * Q * rd * rd) / (Math.PI * Math.PI));
}

/** Expected score (0 to 1) against one opponent, accounting for their RD. */
function expectedScore(rating: number, oppRating: number, oppRd: number): number {
  return 1 / (1 + Math.pow(10, (-g(oppRd) * (rating - oppRating)) / 400));
}

export interface Opponent {
  rating: number;
  rd: number;
  /** 1 for a win, 0 for a loss. Dominoes has no draws. */
  score: 0 | 1;
}

/**
 * Update one player's rating after a rating period (here: one completed
 * set) against however many opponents they faced in it. Multiple games
 * against the same opponent are just multiple entries in `opponents` —
 * Glicko treats them as independent evidence, per Glickman's own spec.
 *
 * No time-based RD growth for inactivity (Glickman's "Step 1b") — that
 * needs a calibrated decay constant and a notion of elapsed rating
 * periods, which this app has no pressing need for yet. RD here only ever
 * decreases toward the floor as a player proves themselves; it does not
 * widen back out from not playing. A deliberate scope cut, not an
 * oversight — revisit if stale ratings from inactive accounts ever
 * actually become a problem worth the added complexity.
 */
export function updateRating(player: RatingState, opponents: Opponent[]): RatingState {
  if (opponents.length === 0) return player;

  let dInvSq = 0;
  let sum = 0;
  for (const opp of opponents) {
    const gj = g(opp.rd);
    const e = expectedScore(player.rating, opp.rating, opp.rd);
    dInvSq += gj * gj * e * (1 - e);
    sum += gj * (opp.score - e);
  }
  dInvSq *= Q * Q;
  // dInvSq is 0 only when every expected score was exactly 0 or 1 — an
  // extreme rating gap. 1/0 is +Infinity in IEEE 754, not a crash, and
  // 1/Infinity below is 0, which correctly means "this rating period alone
  // does not shrink RD any further."
  const dSq = 1 / dInvSq;

  const rdInvSq = 1 / (player.rd * player.rd) + 1 / dSq;
  const newRd = Math.sqrt(1 / rdInvSq);
  const newRating = player.rating + (Q / rdInvSq) * sum;

  return {
    rating: Math.round(newRating),
    rd: Math.max(RD_FLOOR, Math.round(newRd)),
  };
}
