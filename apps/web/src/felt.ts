/**
 * The colour of the table.
 *
 * Wood is the default because players confirmed the physical yard-table
 * reference is what makes the board immediately readable. Green remains a
 * personal option, not the first impression.
 *
 * Being able to change it at all matters more than which one wins. Players
 * sit at this table for hours, and the rival app lets them pick — this is one
 * of the few places where matching a competitor is the whole point.
 *
 * The choice is an attribute on <html> rather than a class on each felt so a
 * single write recolours the hero, the live table, and the replay together.
 * Tokens live in styles.css under `:root[data-felt="..."]`.
 */

export interface Felt {
  id: string;
  label: string;
}

export const FELTS: Felt[] = [
  { id: 'green', label: 'Yaad green' },
  { id: 'brown', label: 'Yard wood' },
  { id: 'clay', label: 'Clay' },
  { id: 'blue', label: 'Blue' },
];

const KEY = 'yard:felt';
const DEFAULT = 'brown';

/**
 * An unknown stored value falls back to the default rather than being written
 * through to the DOM — otherwise a stale key from an older build leaves the
 * table with no felt tokens at all, and the board renders on bare page
 * background.
 */
export function felt(): string {
  try {
    const saved = localStorage.getItem(KEY);
    return FELTS.some((f) => f.id === saved) ? saved! : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

export function setFelt(id: string) {
  try { localStorage.setItem(KEY, id); } catch { /* private mode */ }
  applyFelt();
}

const NIGHT_KEY = 'yard:night-table';

/**
 * Night table (owner, 2026-09-17): dims the wood for late play instead of a
 * brightness slider. The app is already dark; only the table glares.
 */
export function nightTable(): boolean {
  try { return localStorage.getItem(NIGHT_KEY) === '1'; } catch { return false; }
}

export function setNightTable(on: boolean) {
  try { localStorage.setItem(NIGHT_KEY, on ? '1' : '0'); } catch { /* private mode */ }
  applyFelt();
}

/** The moon button that sits after the colour swatches. */
export function nightTableButton(after: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'night-toggle';
  b.textContent = '☾';
  b.title = 'Night table';
  b.setAttribute('aria-label', 'Night table');
  b.setAttribute('aria-pressed', String(nightTable()));
  b.onclick = () => { setNightTable(!nightTable()); after(); };
  return b;
}

/** Called once at boot and again on every change. */
export function applyFelt() {
  document.documentElement.dataset.felt = felt();
  if (nightTable()) document.documentElement.dataset.nightTable = 'true';
  else delete document.documentElement.dataset.nightTable;
}
