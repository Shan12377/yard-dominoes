import { isPartnered, seatsOfSide, sideCount, sideOf } from './tiles.ts';
import type { HandResult, SetOptions, SetState } from './types.ts';

export function createSet(options: Partial<SetOptions> = {}): SetState {
  const opts: SetOptions = {
    mode: 'partner',
    format: 'sixlove',
    seatCount: 4,
    tournament: false,
    oneAllPlayTwo: true,
    useBoneyard: false,
    target: 6,
    ...options,
  };
  return {
    options: opts,
    scores: new Array(sideCount(opts.seatCount, opts.mode)).fill(0),
    handValue: 1,
    poser: 0,
    // The opening hand of every set is opened by the double-six holder. In
    // tournament play he must actually LEAD it; in casual play he may declare
    // "sporting" and open with any tile instead.
    poseMustBeDoubleSix: opts.tournament,
    playoff: false,
    handsPlayed: 0,
    winnerSide: null,
    sixLove: false,
  };
}

/** Index of the side currently holding points, or null when all are on zero. */
export function leadingSide(s: SetState): number | null {
  let lead: number | null = null;
  for (let i = 0; i < s.scores.length; i++) {
    if (s.scores[i] > 0 && (lead === null || s.scores[i] > s.scores[lead])) lead = i;
  }
  return lead;
}

/**
 * Fold a finished hand into the set score.
 *
 * Six Love, in full:
 *
 *   - A side that already holds points and wins again ADDS to its total.
 *   - A side on zero that wins while another side leads BRUKS the score:
 *     everything resets to 0-0 and the double-six holder opens the next hand.
 *   - Under "one all play two", a bruk that would happen while the leader sits
 *     on exactly 1 is replaced by a playoff hand worth two points, so the
 *     winner jumps straight to 2-0 rather than starting over.
 *   - A blocked hand with no unique lowest count is REPLAYED, and the replay is
 *     worth one more point than the hand that tied. Tie again and it climbs
 *     again — 2, then 3, then 4.
 *   - Winning means reaching the target with every opponent still on zero.
 */
export function applyHandResult(prev: SetState, result: HandResult): SetState {
  if (prev.winnerSide !== null) throw new Error('set is already decided');

  const s: SetState = { ...prev, scores: [...prev.scores] };
  s.handsPlayed += 1;

  const { mode, seatCount, format, target, oneAllPlayTwo } = s.options;

  // --- Tied blocked hand: replay at a higher value -------------------------
  if (result.tie) {
    s.handValue += 1;
    const lead = leadingSide(s);
    if (lead === null) {
      // Score is level, so the double-six opens the replay.
      s.poseMustBeDoubleSix = true;
    } else {
      // The side already holding points opens the replay. A partner team may
      // agree between themselves which of the two poses, so the UI offers the
      // choice; the engine defaults to their lower seat.
      s.poseMustBeDoubleSix = false;
      s.poser = seatsOfSide(lead, seatCount, mode)[0];
    }
    return s;
  }

  const winnerSide = result.winnerSide!;
  const winnerSeat = result.winnerSeat!;

  if (format === 'single') {
    s.winnerSide = winnerSide;
    s.sixLove = false;
    return s;
  }

  if (format === 'firstToSix') {
    // Best of six. No reset mechanic — a plain race.
    s.scores[winnerSide] += s.handValue;
    s.handValue = 1;
    s.poser = winnerSeat;
    s.poseMustBeDoubleSix = false;
    if (s.scores[winnerSide] >= target) {
      s.winnerSide = winnerSide;
      s.sixLove = s.scores.every((v, i) => i === winnerSide || v === 0);
    }
    return s;
  }

  // --- Six Love ------------------------------------------------------------
  const lead = leadingSide(s);

  if (lead === null || lead === winnerSide) {
    // Nobody was ahead, or the side that was ahead has won again. Add on.
    s.scores[winnerSide] += s.handValue;
    s.handValue = 1;
    s.playoff = false;
    s.poser = winnerSeat;
    s.poseMustBeDoubleSix = false;

    if (s.scores[winnerSide] >= target && s.scores.every((v, i) => i === winnerSide || v === 0)) {
      s.winnerSide = winnerSide;
      s.sixLove = true;
    }
    return s;
  }

  // A side on zero has beaten the leader. The run is broken.
  const leaderScore = s.scores[lead];
  s.scores = s.scores.map(() => 0);
  s.poseMustBeDoubleSix = true;

  if (oneAllPlayTwo && leaderScore === 1) {
    // One all, play two: no reset to a fresh set, a two-point decider instead.
    s.handValue = 2;
    s.playoff = true;
  } else {
    s.handValue = 1;
    s.playoff = false;
  }
  return s;
}

/** Human-readable scoreline, e.g. "5-0" or "under love". */
export function scoreline(s: SetState): string {
  if (s.scores.every((v) => v === 0)) return 'love all';
  return s.scores.join('-');
}

export function sideName(seat: number, mode: SetState['options']['mode']): number {
  return sideOf(seat, mode);
}

/**
 * Pass the pose.
 *
 * In Partner, the side that earned the pose may agree between themselves which
 * of the two leads the next hand. The engine records the entitled seat; this
 * hands it across the table. Only valid in partner mode, only before the next
 * hand is dealt, and never when the double-six is forced.
 */
export function passPoseToPartner(s: SetState): SetState {
  // Openhand is a partnered mode, so the pose-pass belongs to it too.
  if (!isPartnered(s.options.mode)) throw new Error('only partners can pass the pose');
  if (s.poseMustBeDoubleSix || s.handsPlayed === 0) {
    throw new Error('the double-six opens this hand — the pose is not yours to pass');
  }
  const partner = (s.poser + 2) % s.options.seatCount;
  return { ...s, scores: [...s.scores], poser: partner };
}
