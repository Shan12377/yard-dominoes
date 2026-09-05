import { isPartnered, sideCount, sideOf } from './tiles.ts';
import type { HandResult, SetOptions, SetState } from './types.ts';

export function createSet(options: Partial<SetOptions> = {}): SetState {
  const inputFormat = options.format ?? 'sixlove';
  // French has fixed defaults that would otherwise be caller boilerplate on
  // every start-set call: target is 100 (first to hit it LOSES), the chucha
  // must lead round 1 regardless, and the whole thing is cutthroat-4.
  // Overrides still land because `...options` follows.
  const french = inputFormat === 'french';
  const opts: SetOptions = {
    mode: french ? 'cutthroat' : 'partner',
    format: inputFormat,
    seatCount: 4,
    oneAllPlayTwo: true,
    useBoneyard: false,
    target: french ? 100 : 6,
    ...options,
  };
  return {
    options: opts,
    scores: new Array(sideCount(opts.seatCount, opts.mode)).fill(0),
    handValue: 1,
    poser: 0,
    // The opening hand of EVERY set is opened by the required opening tile's
    // holder (6-6 outside French, 0-0 inside it), and he must actually LEAD
    // it — casual tables included. Sporting is real Jamaican vocabulary and
    // stays in the Academy, but it does not open a set here: confirmed as a
    // house rule after casual tables were seen posing anything to start.
    // Later hands are opened by the previous winner, who poses what he likes;
    // a bruk or a tied replay puts the six back on the open (see below).
    poseMustBeDoubleSix: true,
    playoff: false,
    handsPlayed: 0,
    winnerSide: null,
    sixLove: false,
    frenchTieBreak: false,
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
 *   - The score BRUKS — everything to zero, double-six holder opens next —
 *     when the LAST side still on love comes off it, because six love needs
 *     somebody to be at love for the race to mean anything.
 *
 *     In Partner that is the familiar rule: two sides, so the moment the side
 *     under love wins, nobody is at love and it goes back to 0-0.
 *
 *     At CUT THROAT it is not the same rule, and conflating them was a real
 *     bug (fixed 2026-09-04, reported by a player mid-set). Four players are
 *     four sides, so several can hold points at once and the board only wipes
 *     once every one of them has won a hand. Pagat: "If everyone wins a hand
 *     before anyone reaches 6, the score returns to zero points each."
 *     Previously ANY non-leader winning wiped the board, which made a cut
 *     throat six-love set close to unplayable.
 *   - Under "one all play two", a bruk that would happen while the leader sits
 *     on exactly 1 is replaced by a playoff hand worth two points, so the
 *     winner jumps straight to 2-0 rather than starting over.
 *   - A blocked hand with no unique lowest count is REPLAYED: the double-six
 *     holder is forced to open it (never "sporting", whatever the current
 *     score), and it is worth a flat 2 points to whoever wins it — not the
 *     escalating 2/3/4 an earlier version used, which real play doesn't do.
 *     A tie on the replay itself just repeats: forced double-six again,
 *     still worth 2, however many times in a row it happens.
 *   - Winning means reaching the target while ANOTHER side is still on zero
 *     (pagat: "provided that another player has zero"). In Partner that is the
 *     same as "every opponent on zero" since there is only one opponent; at
 *     cut throat it is looser, and `sixLove` keeps the strict reading for the
 *     whitewash worth celebrating.
 *   - A KEY win (hand.ts's isKeyTile — the board's two open ends needed
 *     different values and the winner's last tile was provably the only
 *     bone left in the whole set that could still close either one) scores
 *     a flat 2, never handValue + 1 and never stacking with a replay's own
 *     2. Confirmed directly: "key strictly means 2, full stop."
 */
export function applyHandResult(prev: SetState, result: HandResult): SetState {
  if (prev.winnerSide !== null) throw new Error('set is already decided');

  const s: SetState = { ...prev, scores: [...prev.scores] };
  s.handsPlayed += 1;

  const { seatCount, format, target, oneAllPlayTwo } = s.options;

  // --- French: race to 100 where LOWER wins -------------------------------
  // Every seat adds their remaining pip count to their own running total,
  // doubled if they held any double when the hand ended, doubled AGAIN
  // (stacking to ×4) if the winner's own final tile was itself a double —
  // that second doubling hits every OTHER seat regardless of what they
  // personally held. A domino winner's hand is empty so they add zero — the
  // "winner scores zero" property falls out for free.
  //
  // A blocked tie doesn't use the sixlove-style escalating replay — it
  // forces the chucha open and replays flat: the replay's winner takes +2,
  // nobody else scores anything for it, and a tie AGAIN just repeats the
  // reshuffle (frenchTieBreak stays true) rather than climbing in value.
  //
  // The set ends the instant ANY seat's score reaches or crosses `target` —
  // not "true elimination" (that earlier design let the other seats keep
  // racing until only one remained under target; confirmed wrong against
  // real play). The hand that crosses it always plays out to its natural
  // conclusion first — this only ever runs at hand-end — and whoever holds
  // the LOWEST score at that moment wins the whole set outright, even if
  // several seats crossed target in the very same hand.
  if (format === 'french') {
    const doubles = result.doublesRemaining ?? new Array(seatCount).fill(false);
    const penalties = result.penalties ?? new Array(seatCount).fill(0);
    const winnerHadDouble = result.winnerPlayedDouble ?? false;

    // Penalties (board-pass / three-real-passes-running) are earned by what
    // happened during THIS hand's play, independent of how its win/tie
    // result gets scored below — they land whether or not a reshuffle
    // follows.
    for (let seat = 0; seat < seatCount; seat++) s.scores[seat] += penalties[seat];

    if (s.frenchTieBreak) {
      if (result.tie) {
        // Still tied — reshuffle again. Flat +2 never escalates.
        s.poseMustBeDoubleSix = true;
        s.handValue = 1;
        return s;
      }
      s.scores[result.winnerSeat!] += 2;
      s.frenchTieBreak = false;
      s.poseMustBeDoubleSix = false;
      s.poser = result.winnerSeat!;
    } else if (result.tie) {
      s.frenchTieBreak = true;
      s.poseMustBeDoubleSix = true;
      s.handValue = 1;
      return s;
    } else {
      for (let seat = 0; seat < seatCount; seat++) {
        let factor = doubles[seat] ? 2 : 1;
        if (winnerHadDouble && seat !== result.winnerSeat) factor *= 2;
        s.scores[seat] += result.counts[seat] * factor;
      }
      if (result.winnerSeat !== null) s.poser = result.winnerSeat;
      s.poseMustBeDoubleSix = false;
    }

    s.handValue = 1;

    if (s.scores.some((v) => v >= target)) {
      s.winnerSide = s.scores.indexOf(Math.min(...s.scores));
    }
    return s;
  }

  // --- Tied blocked hand: forced double-six, flat +2 ------------------------
  // Confirmed against real play: the replay is ALWAYS opened by whoever
  // holds the double-six — never "sporting", regardless of who currently
  // leads — and is worth a flat 2 points, not an escalating value. A tie on
  // the replay itself just repeats this unchanged, so no state needs to be
  // tracked beyond handValue and poseMustBeDoubleSix themselves.
  if (result.tie) {
    s.handValue = 2;
    s.poseMustBeDoubleSix = true;
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
    s.scores[winnerSide] += result.keyWin ? 2 : s.handValue;
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

  // Six love needs somebody to BE at love, so the score only bruks when the
  // last side still on zero comes off it. Everyone else's score is untouched
  // by this hand, so that is exactly "every other side has already scored".
  //
  // In Partner there are two sides, so this is the familiar rule — the side
  // under love wins and it goes back to 0-0 (pagat: "If the other side wins a
  // hand, the score returns to 0 - 0"). At cut throat it is NOT the same
  // thing, and treating it as one was the bug: any non-leader winning wiped
  // the board, so two different players could never hold points at once.
  // Pagat, on cut throat: "Each player keeps a score of games won and the
  // first player to achieve 6 wins is the overall winner, provided that
  // ANOTHER player has zero" and "If EVERYONE wins a hand before anyone
  // reaches 6, the score returns to zero points each."
  const othersHaveAllScored = s.scores.every((v, i) => i === winnerSide || v > 0);

  if (!othersHaveAllScored) {
    // Somebody is still on love, so the run continues. Add on.
    // A key win (see hand.ts's isKeyTile) always scores a flat 2, never
    // stacking on top of handValue — confirmed directly: "key strictly
    // means 2, full stop."
    s.scores[winnerSide] += result.keyWin ? 2 : s.handValue;
    s.handValue = 1;
    s.playoff = false;
    s.poser = winnerSeat;
    s.poseMustBeDoubleSix = false;

    // Reaching the target wins provided another side is still on zero. That
    // is structurally guaranteed inside this branch — it is what put us here
    // — but it is spelled out because it IS the rule, not an implementation
    // detail. `sixLove` stays stricter: the whitewash is every other side on
    // zero, which in Partner is the same thing and at cut throat is the rarer,
    // louder result worth celebrating.
    const someoneAtLove = s.scores.some((v, i) => i !== winnerSide && v === 0);
    if (s.scores[winnerSide] >= target && someoneAtLove) {
      s.winnerSide = winnerSide;
      s.sixLove = s.scores.every((v, i) => i === winnerSide || v === 0);
    }
    return s;
  }

  // Nobody is left under love — the six-love race cannot be run from here, so
  // the board goes back to nothing and starts again.
  const leaderScore = lead === null ? 0 : s.scores[lead];
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
