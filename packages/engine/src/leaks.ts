import type { HandReview } from './coach.ts';

/**
 * Leak detection.
 *
 * The coach grades one hand. This watches every hand and finds the mistake
 * you keep making — which is a different thing, and the one that actually
 * changes how somebody plays. Being told "that was loose" once is a note;
 * being told "that is the fourth time this week" is a habit you can break.
 *
 * It is also the part that compounds. The longer someone plays, the better
 * this knows their game, and the more they lose by starting again somewhere
 * else. A rival can copy a board renderer in a fortnight; they cannot copy
 * the record of your last two hundred decisions.
 *
 * Everything here is pure. The client owns storage and decides where it
 * lives — on device today, on an account when there is one.
 */

export interface LeakEntry {
  /** Curriculum reference, e.g. "Belt 4 · Lesson 1". */
  lesson: string;
  /** Times this cost a hand something. */
  count: number;
  /** Total value thrown away, so a rare disaster can outrank a frequent slip. */
  cost: number;
  /** Hand index this was last seen at, for "you did it again". */
  lastSeen: number;
}

export interface LeakStore {
  /** Hands reviewed, ever. Also the clock for `lastSeen`. */
  hands: number;
  entries: LeakEntry[];
}

export const EMPTY_LEAKS: LeakStore = { hands: 0, entries: [] };

/**
 * Fold one hand's review into the record. Returns a new store — the caller
 * persists it.
 *
 * Only decisions that actually cost something are counted. A move graded
 * `fine` is acceptable play, and counting it here would tell someone they
 * have a leak when the coach just told them the hand was clean.
 */
export function recordHand(store: LeakStore, review: HandReview): LeakStore {
  const hands = store.hands + 1;
  const entries = store.entries.map((e) => ({ ...e }));

  for (const move of review.reviews) {
    if (move.grade !== 'loose' && move.grade !== 'blunder') continue;
    if (!move.lesson) continue;
    const found = entries.find((e) => e.lesson === move.lesson);
    if (found) {
      found.count += 1;
      found.cost += move.loss;
      found.lastSeen = hands;
    } else {
      entries.push({ lesson: move.lesson, count: 1, cost: move.loss, lastSeen: hands });
    }
  }
  return { hands, entries };
}

/**
 * Leaks worst first — by what they have cost, not how often they happen, so
 * one hand-losing habit outranks a frequent cheap one. Ties break towards the
 * more recent, because a leak you fixed months ago is not the one to work on.
 */
export function topLeaks(store: LeakStore, limit = 3): LeakEntry[] {
  return [...store.entries]
    .sort((a, b) => (b.cost - a.cost) || (b.lastSeen - a.lastSeen))
    .slice(0, limit);
}

/**
 * How many hands must be seen before a pattern is worth naming. Calling one
 * mistake a habit is how a coach loses credibility, and a beginner making
 * every mistake once needs encouragement, not a diagnosis.
 */
export const MIN_HANDS_FOR_A_PATTERN = 5;
export const MIN_REPEATS_FOR_A_PATTERN = 2;

/**
 * The one leak worth telling somebody about right now, or null when there is
 * not yet enough evidence to say anything honest.
 */
export function standoutLeak(store: LeakStore): LeakEntry | null {
  if (store.hands < MIN_HANDS_FOR_A_PATTERN) return null;
  const [worst] = topLeaks(store, 1);
  if (!worst || worst.count < MIN_REPEATS_FOR_A_PATTERN) return null;
  return worst;
}

/** Plain English for a leak, in the coach's voice. */
export function describeLeak(leak: LeakEntry, store: LeakStore): string {
  const share = Math.round((leak.count / store.hands) * 100);
  return `${leak.count} times in ${store.hands} hands — about ${share}% of the hands you play.`;
}
