/**
 * Rank tiers from Yard Rating (owner, 2026-09-17). Display only: the tier is
 * read straight off the rating a player already has, so it can never disagree
 * with the number beside it. Play frequency never changes a tier.
 */
export interface RankTier {
  key: 'bench' | 'corner' | 'boss' | 'don' | 'legend';
  name: string;
  badge: 'Bronze' | 'Silver' | 'Gold' | 'Platinum' | 'Diamond';
}

const TIERS: readonly (RankTier & { from: number })[] = [
  { key: 'legend', name: 'Yaad Legend', badge: 'Diamond', from: 1800 },
  { key: 'don', name: 'Domino Don', badge: 'Platinum', from: 1600 },
  { key: 'boss', name: 'Table Boss', badge: 'Gold', from: 1400 },
  { key: 'corner', name: 'Corner Regular', badge: 'Silver', from: 1200 },
  { key: 'bench', name: 'Benchwarmer', badge: 'Bronze', from: -Infinity },
];

export function rankTier(rating: number): RankTier {
  const tier = TIERS.find((t) => rating >= t.from)!;
  return { key: tier.key, name: tier.name, badge: tier.badge };
}

/**
 * A tier chip. Guests are "Unranked": ranking is the member perk. A member
 * whose rating is still provisional shows the tier with "(new)".
 */
export function rankChip(rating: number | null, opts: { guest?: boolean; provisional?: boolean } = {}): HTMLElement {
  const chip = document.createElement('span');
  if (opts.guest || rating === null) {
    chip.className = 'rank-chip rank-unranked';
    chip.textContent = 'Unranked';
    return chip;
  }
  const tier = rankTier(rating);
  chip.className = `rank-chip rank-${tier.key}`;
  chip.textContent = opts.provisional ? `${tier.name} (new)` : tier.name;
  chip.title = `${tier.name} · ${tier.badge} · Yard Rating ${rating}`;
  return chip;
}

/** Table Trust levels (0066): sportsmanship, kept apart from Yard Rating. */
export function trustLevel(trust: number): { key: 'respect' | 'watch' | 'rough'; label: string } {
  if (trust >= 90) return { key: 'respect', label: 'Respect Due' };
  if (trust >= 75) return { key: 'watch', label: 'On Watch' };
  return { key: 'rough', label: 'Rough Play' };
}

export function trustChip(trust: number): HTMLElement {
  const level = trustLevel(trust);
  const chip = document.createElement('span');
  chip.className = `rank-chip trust-${level.key}`;
  chip.textContent = `${trust}% · ${level.label}`;
  return chip;
}
