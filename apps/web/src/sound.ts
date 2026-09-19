/**
 * What a visitor hears, and when they get asked.
 *
 * The rule (owner, 2026-09-19): a page nobody asked should never make a
 * noise. Somebody opening this at work, on a bus, or in a house with a
 * sleeping baby must be able to play without a slam and a duppy's voice
 * announcing them. So silence is the default and the choice is offered on
 * the way in, not hunted for afterwards.
 *
 * Two separate things can make sound, and a player may well want one without
 * the other:
 *   - table sound: the knock, the shuffle, the six-love horn (`sfx.ts`)
 *   - voices: the duppies talking (`speak.ts`)
 *
 * Storage is the two existing keys, untouched, so anybody who already made a
 * choice keeps it. '1' means muted, '0' means explicitly allowed, and ABSENT
 * now means silent — that last part is the change. An absent key used to
 * mean "make noise", which is how a first visit ended up loud.
 */

export type SoundChoice = 'off' | 'table' | 'all';

export const SOUND_LABELS: Record<SoundChoice, string> = {
  off: 'Silent',
  table: 'Table sound',
  all: 'Sound and voices',
};

export const SOUND_HINTS: Record<SoundChoice, string> = {
  off: 'Nothing at all. Safe anywhere.',
  table: 'The knock and the shuffle. No talking.',
  all: 'The duppies talk as they play.',
};

/** Stored values for a choice: `['1' | '0', '1' | '0']` as [table, voices]. */
export function storedFor(choice: SoundChoice): [string, string] {
  if (choice === 'all') return ['0', '0'];
  if (choice === 'table') return ['0', '1'];
  return ['1', '1'];
}

/**
 * Which choice the stored values add up to. Anything not explicitly allowed
 * is silent, including a missing key — the whole point of the change.
 */
export function choiceFrom(tableStored: string | null, voiceStored: string | null): SoundChoice {
  const table = tableStored === '0';
  const voices = voiceStored === '0';
  if (table && voices) return 'all';
  if (table) return 'table';
  return 'off';
}

/** Has this browser ever actually answered? Used to ask once, quietly. */
export function soundAnswered(tableStored: string | null, voiceStored: string | null): boolean {
  return tableStored !== null || voiceStored !== null;
}
