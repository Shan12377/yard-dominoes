/**
 * How long until a tournament starts, in words.
 *
 * Split out of `tournaments.ts` because that file imports `online.ts`, which
 * reads Vite's `import.meta.env` at module scope — that throws under plain
 * `node --test`, so nothing in that import chain is unit-testable. Same split
 * as `name-cache.ts`, `voice.ts`'s pure half, and `clock.ts` in the engine.
 *
 * This is display only. Whether sign-ups are actually open is decided by the
 * server (`signupsOpen()` in `functions/_shared/tournament.ts`), which is the
 * only clock anybody's device cannot argue with.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * A countdown a person would say out loud.
 *
 * Deliberately coarse above an hour: "in 3 days" is what somebody planning
 * their Sunday needs, and a ticking seconds display two days out is noise that
 * also forces a re-render every second for no reason. Seconds appear only in
 * the last minute, which is the one time they matter.
 *
 * Returns 'now' at or past the start rather than a negative number — a
 * countdown that goes below zero reads as a bug even when it is not.
 */
export function untilLabel(startsAt: string, now: number): string {
  const ms = Date.parse(startsAt) - now;
  if (!Number.isFinite(ms) || ms <= 0) return 'now';

  const days = Math.floor(ms / DAY);
  if (days >= 1) return days === 1 ? 'in 1 day' : `in ${days} days`;

  const hours = Math.floor(ms / HOUR);
  if (hours >= 1) return hours === 1 ? 'in 1 hour' : `in ${hours} hours`;

  const minutes = Math.floor(ms / MINUTE);
  if (minutes >= 1) return minutes === 1 ? 'in 1 minute' : `in ${minutes} minutes`;

  const seconds = Math.max(1, Math.floor(ms / 1000));
  return `in ${seconds}s`;
}

/**
 * How often the countdown needs redrawing, in milliseconds.
 *
 * A label reading "in 3 days" does not change for hours, so redrawing it every
 * second would wake the whole lounge view — chat log, roster, presence — sixty
 * times a minute to write the same string. The interval tightens as the start
 * approaches and only reaches one second inside the final minute.
 *
 * Returns null once there is nothing left to count, so the caller can stop the
 * timer entirely rather than spin on 'now' forever.
 */
export function tickInterval(startsAt: string, now: number): number | null {
  const ms = Date.parse(startsAt) - now;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  if (ms > DAY) return HOUR;
  if (ms > HOUR) return MINUTE;
  if (ms > MINUTE) return 15_000;
  return 1000;
}
