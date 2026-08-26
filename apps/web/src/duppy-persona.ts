import type { DuppyLevel } from '@yard/engine';

/** Dedicated 3D animated opponent art, distinct from human profile avatars. */
export type DuppyPersona = 'breeze' | 'rally' | 'miss_mavis' | 'tyrone' | 'auntie_vee';

/**
 * Duppies need to read as the same table opponents throughout a hand, replay,
 * and coaching view. This is deliberately deterministic: no random face on a
 * rerender, and no connection to a real person's profile or photo.
 */
export const DUPPY_PERSONAS: Record<DuppyLevel, readonly [DuppyPersona, DuppyPersona]> = {
  pickney: ['breeze', 'rally'],
  yard: ['rally', 'tyrone'],
  ranker: ['tyrone', 'auntie_vee'],
  don: ['auntie_vee', 'miss_mavis'],
  general: ['miss_mavis', 'breeze'],
};

export function duppyPersona(level: DuppyLevel, seatIndex: number): DuppyPersona {
  const choices = DUPPY_PERSONAS[level];
  return choices[Math.abs(seatIndex) % choices.length];
}

/** Duppies never resolve to a person's profile photo or selectable avatar. */
export function duppyPersonaUrl(persona: DuppyPersona): string {
  return `/duppies/${persona}.webp`;
}
