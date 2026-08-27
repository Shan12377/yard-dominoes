/**
 * Banked turn time.
 *
 * A flat allowance punishes the fast player twice over: moving quickly earns
 * them nothing, and on the one hand that genuinely needs reading they hit the
 * same wall as somebody who has dawdled all game. So the time they did not
 * spend is kept for them.
 *
 * Every turn grants `base` seconds. Whatever is left at the end of the turn
 * goes into a bank the seat can draw on later, and a single turn can never run
 * longer than `cap` however full that bank is. The bank empties when a new
 * hand is dealt, so nobody arrives at the last hand of a set with a hoard.
 *
 * This is the mechanic JamDom's speed tables use, and the reason their fast
 * rooms stay fast without feeling unfair.
 */

export interface Clock {
  /** Seconds granted fresh at the start of every turn. */
  base: number;
  /** The most seconds a single turn may ever last, bank included. */
  cap: number;
}

export type ClockName = 'blitz' | 'speed' | 'yard' | 'relaxed';

/**
 * The clocks a table may be started on. Named rather than numeric on purpose:
 * the client picks a name and the server looks up the seconds, so nobody can
 * post themselves a table with a ten-minute turn.
 */
export const CLOCKS: Record<ClockName, Clock> = {
  blitz: { base: 5, cap: 20 },
  speed: { base: 10, cap: 40 },
  yard: { base: 20, cap: 40 },
  relaxed: { base: 30, cap: 60 },
};

export const CLOCK_LABELS: Record<ClockName, string> = {
  blitz: 'Blitz — 5s, bank up to 20s',
  speed: 'Speed — 10s, bank up to 40s',
  yard: 'Yard — 20s, bank up to 40s',
  relaxed: 'Relaxed — 30s, bank up to 60s',
};

export const CLOCK_NAMES = Object.keys(CLOCKS) as ClockName[];

/**
 * A Duppy gets a clear, visible beat between moves in a live table. This is
 * deliberately separate from the human clock: it gives people time to read
 * the board, the pass markers, and who laid each tile before the next seat
 * moves. The pace belongs to the table, not to the browser running it.
 */
export type DuppyPace = 'quick' | 'yard' | 'relaxed';

/** Named, accessible Duppy reading beats. Clients choose a name; servers
 * resolve the duration, so no one can quietly speed an AI up. */
export const DUPPY_PACE_SECONDS: Record<DuppyPace, number> = {
  quick: 3.5,
  yard: 10,
  relaxed: 20,
};

export const DUPPY_PACE_LABELS: Record<DuppyPace, string> = {
  quick: 'Quick — 3.5 seconds per move',
  yard: 'Yard — 10 seconds per move',
  relaxed: 'Relaxed — 20 seconds per move',
};

export const DUPPY_PACE_NAMES = Object.keys(DUPPY_PACE_SECONDS) as DuppyPace[];
export const DEFAULT_DUPPY_PACE: DuppyPace = 'yard';

export function duppyPaceByName(name: unknown): DuppyPace {
  return typeof name === 'string' && DUPPY_PACE_NAMES.includes(name as DuppyPace)
    ? name as DuppyPace
    : DEFAULT_DUPPY_PACE;
}

export function duppyThinkSeconds(pace: unknown): number {
  return DUPPY_PACE_SECONDS[duppyPaceByName(pace)];
}

/** Fast rooms: think ahead or lose the tempo. */
export const SPEED_CLOCK: Clock = CLOCKS.speed;

/** The ordinary room. Still capped, so a table cannot be held hostage. */
export const YARD_CLOCK: Clock = CLOCKS.yard;

/** A name from an untrusted caller, resolved to real seconds. */
export function clockByName(name: unknown): Clock {
  return typeof name === 'string' && name in CLOCKS
    ? CLOCKS[name as ClockName]
    : CLOCKS.yard;
}

/** A bank starts empty every hand. */
export const FRESH_BANK = 0;

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

/** A clock whose numbers are usable, whatever a table row happens to hold. */
function sane(clock: Clock): Clock {
  const base = Number.isFinite(clock.base) ? Math.max(1, Math.floor(clock.base)) : SPEED_CLOCK.base;
  const cap = Number.isFinite(clock.cap) ? Math.floor(clock.cap) : SPEED_CLOCK.cap;
  // A cap below the base would hand out less than the base every turn.
  return { base, cap: Math.max(base, cap) };
}

/**
 * The most that can sit in a bank. Held to exactly the distance between base
 * and cap, so a full bank reaches the ceiling and never overshoots it — the
 * bank cannot grow into time the player would not be allowed to spend.
 */
export function maxBank(clock: Clock): number {
  const c = sane(clock);
  return c.cap - c.base;
}

/** The seconds this seat has for the turn it is about to take. */
export function allowance(clock: Clock, bank: number): number {
  const c = sane(clock);
  const held = Number.isFinite(bank) ? clamp(bank, 0, maxBank(c)) : 0;
  return Math.min(c.base + held, c.cap);
}

/**
 * The bank once a turn has taken `used` seconds. Spending less than the base
 * banks the difference; spending more draws the rest down. Never negative,
 * never above `maxBank`.
 */
export function afterTurn(clock: Clock, bank: number, used: number): number {
  const c = sane(clock);
  const spent = Number.isFinite(used) ? Math.max(0, used) : allowance(c, bank);
  return clamp(allowance(c, bank) - spent, 0, maxBank(c));
}

/** Epoch ms by which a turn starting at `startedAt` must be finished. */
export function deadline(clock: Clock, bank: number, startedAt: number): number {
  return startedAt + allowance(clock, bank) * 1000;
}

/**
 * Seconds a turn actually consumed. Clamped to the allowance so a late cron
 * sweep cannot bill a seat for the minutes the job was asleep — the player
 * only ever loses the time they were given.
 */
export function usedBy(clock: Clock, bank: number, startedAt: number, now: number): number {
  const elapsed = Math.max(0, (now - startedAt) / 1000);
  return Math.min(elapsed, allowance(clock, bank));
}
