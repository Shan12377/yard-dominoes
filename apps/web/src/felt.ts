/**
 * The colour of the table.
 *
 * Brown is the default because that is what a real yard table is — plywood,
 * or a board laid over a drum — and because the business partner asked for it
 * twice, unprompted, in two separate calls. Green is the casino baize the
 * rival app uses; it stays available, but it is no longer what a new player
 * sees first.
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
  { id: 'brown', label: 'Yard brown' },
  { id: 'clay', label: 'Clay' },
  { id: 'green', label: 'Green' },
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

/** Called once at boot and again on every change. */
export function applyFelt() {
  document.documentElement.dataset.felt = felt();
}
