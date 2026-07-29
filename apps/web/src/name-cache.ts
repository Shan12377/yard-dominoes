/**
 * The pure half of `OnlineGame`'s seated-player name/origin cache.
 *
 * Split out from `onlinetable.ts` because that file imports `online.ts`,
 * which reads Vite's `import.meta.env` at module scope — that throws under
 * plain `node --test`, so nothing in that import chain is unit-testable.
 * Every other cross-cutting pure rule in this app (`voice.ts`, `clock.ts` in
 * the engine, `_shared/billing.ts`) lives the same way, apart from whatever
 * actually needs the runtime it depends on.
 */

/** Seconds a fetched name/origin is trusted before it is re-checked. */
export const NAME_TTL_MS = 60_000;

/**
 * Which seated user ids need a profile fetch: never-seen ones, plus anyone
 * whose entry has outlived the TTL.
 *
 * Exists because a permanent cache means a player who edits their name or
 * origin mid-game — the profile editor now exists, so this is reachable —
 * stays wrong on every screen already open on them for the rest of that
 * viewer's session. The TTL is what lets a mid-game edit ever correct
 * itself without a second Realtime subscription just to watch profiles.
 */
export function staleUserIds(
  seatUserIds: (string | null)[],
  names: Map<string, { fetchedAt: number }>,
  now: number,
  ttlMs = NAME_TTL_MS,
): string[] {
  const due = new Set<string>();
  for (const id of seatUserIds) {
    if (!id) continue;
    const known = names.get(id);
    if (!known || now - known.fetchedAt > ttlMs) due.add(id);
  }
  return [...due];
}
