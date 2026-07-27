# Online Play Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire real multiplayer into the app — creating/joining tables inside lounges, playing a live hand against real people, spectating, and surviving a reload or disconnect — using the Edge Function backend that already works.

**Architecture:** Tables live inside lounges (`tables.lounge_id`). A new `OnlineGame` class (parallel to the existing `LocalGame`) subscribes to Realtime and calls the existing `create-table` / `join-table` / `start-hand` / `play-move` Edge Functions plus one new one (`pass-pose`). The live table reuses the exact same rendering primitives local play already uses (`tileEl`, `renderBoard`, `scoreTrack`, `backsEl`) — only the data source changes.

**Tech Stack:** TypeScript, Vite, `@supabase/supabase-js` v2.110.8, Supabase Edge Functions (Deno), Postgres/PostgREST, Supabase Realtime.

## Global Constraints

- **No new dependency to `packages/engine`.** Ask first if one seems needed (it won't for this plan — the engine is unchanged).
- **Client never decides game state.** Every write goes through an Edge Function; the client only renders what streams back and sends move intents.
- **`hands` (full tile state) is never fetched by the client**, directly or indirectly. Only `hand_public` and `seat_hands` (RLS-filtered to the caller's own row).
- **No static import of `online.ts`, `lounges.ts`, `loungeview.ts`, or the new files in this plan into `main.ts`.** They load lazily via the existing dynamic `import('./loungeview.ts')` in `ensureLoungeModule()`. Verify with `npm run build` after every client task — two chunks, `index` stays under ~50 kB raw.
- **Portrait-first.** Every view in this plan gets checked at 390×844 before anything wider.
- **This codebase has no client-side unit test runner** (`apps/web` has no test script; only `packages/engine` runs `node --test`). Each client task's "test cycle" is: `npm run typecheck`, `npm run build`, then a concrete manual verification step given in that task — not a placeholder, an actual sequence to run. Do not introduce a new test framework as a side effect of this plan.
- **Commit after every task**, following this repo's commit style (`type: short description`, no scope creep in the diff).

---

## Task 1: `create-table` accepts a lounge, and both create/join enforce its tier gate

**Decision (resolves the open "table tier gating" question):** lounge chat is
already gated by `min_tier` via `effective_tier()` — a guest can't read Rankers
Row's chat. Nothing gated who could sit at a *table* inside that same lounge,
which is a leak in the exact security model this project insists on
everywhere else ("a tier check in client code is a suggestion, not a paywall,"
`CLAUDE.md` → Money). Best practice, matching the existing pattern exactly:
enforce it server-side, in the two places a human occupies a seat —
`create-table` and `join-table` — the same way `checkout` and every RLS policy
already treat tier as a server-decided fact, never a client-supplied one.
Spectating (read-only) stays open to everyone, matching how `hand_public`'s
own RLS already works — the gate is about *participating*, not *watching*.

**Files:**
- Modify: `supabase/functions/_shared/lib.ts` (add `effectiveTier`, `TIER_RANK`)
- Modify: `supabase/functions/create-table/index.ts`
- Modify: `supabase/functions/join-table/index.ts`
- Modify: `apps/web/src/online.ts:50-61` (`CreateTableInput`, `createTable`)

**Interfaces:**
- Produces: `effectiveTier(profile: { tier: string; tier_expires_at: string | null }): string` and `TIER_RANK: Record<string, number>` in `_shared/lib.ts` — mirrors the SQL `effective_tier()` function and the client's existing `TIER_RANK` in `lounges.ts`, kept as plain inline logic rather than an RPC call to avoid PostgREST's composite-type argument handling for a two-line check.
- Produces: `CreateTableInput.loungeId?: string` — when present, the created `tables` row has `lounge_id` set to it, and the caller's tier is checked against that lounge's `min_tier` before the insert happens.

- [ ] **Step 1: Add the shared tier helper**

In `supabase/functions/_shared/lib.ts`, add near the other exported helpers:

```ts
export const TIER_RANK: Record<string, number> = { guest: 0, yardie: 1, vip: 2 };

/** Mirrors the SQL effective_tier() function: expired paid tiers read as guest. */
export function effectiveTier(profile: { tier: string; tier_expires_at: string | null }): string {
  if (profile.tier === 'guest') return 'guest';
  if (!profile.tier_expires_at || Date.parse(profile.tier_expires_at) > Date.now()) return profile.tier;
  return 'guest';
}
```

- [ ] **Step 2: Add `loungeId` to `create-table`, and gate it**

In `supabase/functions/create-table/index.ts`, add the tier check before the insert, and set `lounge_id` on it:

```ts
import { handled, json, requireUser, serviceClient, HttpError, effectiveTier, TIER_RANK } from '../_shared/lib.ts';

Deno.serve(handled(async (req) => {
  const user = await requireUser(req);
  const body = await req.json();
  const db = serviceClient();

  const seatCount = Number(body.seatCount ?? 4);
  if (![2, 3, 4].includes(seatCount)) throw new HttpError(422, 'seat count must be 2, 3 or 4');

  if (body.loungeId) {
    const { data: lounge } = await db.from('lounges').select('min_tier').eq('id', body.loungeId).single();
    if (!lounge) throw new HttpError(404, 'no such lounge');
    const { data: profile } = await db.from('profiles').select('tier, tier_expires_at').eq('id', user.id).single();
    const mine = effectiveTier(profile ?? { tier: 'guest', tier_expires_at: null });
    if (TIER_RANK[mine] < TIER_RANK[lounge.min_tier]) {
      throw new HttpError(403, `${lounge.min_tier} membership required to start a table here`);
    }
  }

  const { data: code } = await db.rpc('generate_join_code');

  const { data: table, error } = await db.from('tables').insert({
    join_code: code,
    mode: body.mode ?? 'partner',
    // Cut throat six love runs to a median of ~196 hands. Never default to it.
    format: body.format ?? (body.mode === 'cutthroat' ? 'firstToSix' : 'sixlove'),
    seat_count: seatCount,
    tournament: !!body.tournament,
    one_all_play_two: body.oneAllPlayTwo ?? true,
    use_boneyard: !!body.useBoneyard,
    is_private: !!body.isPrivate,
    lounge_id: body.loungeId ?? null,
    created_by: user.id,
  }).select().single();
  if (error) throw new HttpError(500, error.message);

  const duppies: string[] = body.duppies ?? [];
  const seats: any[] = [{
    table_id: table.id, seat_index: 0, user_id: user.id,
    connected_at: new Date().toISOString(),
  }];
  for (let i = 1; i < seatCount; i++) {
    seats.push({
      table_id: table.id, seat_index: i,
      user_id: null, duppy_level: duppies[i - 1] ?? null,
    });
  }
  await db.from('seats').insert(seats);

  return json({ ok: true, tableId: table.id, joinCode: table.join_code });
}));
```

- [ ] **Step 3: Gate `join-table` the same way**

In `supabase/functions/join-table/index.ts`, add the same check once the table is resolved (a table's lounge, if any, is fixed at creation — check it regardless of whether joining by code or by id):

```ts
import { handled, json, requireUser, serviceClient, HttpError, effectiveTier, TIER_RANK } from '../_shared/lib.ts';

Deno.serve(handled(async (req) => {
  const user = await requireUser(req);
  const { joinCode, tableId, seatIndex } = await req.json();
  const db = serviceClient();

  const query = joinCode
    ? db.from('tables').select('*').eq('join_code', String(joinCode).toUpperCase())
    : db.from('tables').select('*').eq('id', tableId);
  const { data: table } = await query.single();
  if (!table) throw new HttpError(404, 'no table with that code');
  if (table.status !== 'waiting') throw new HttpError(409, 'that game has already started');

  if (table.lounge_id) {
    const { data: lounge } = await db.from('lounges').select('min_tier').eq('id', table.lounge_id).single();
    const { data: profile } = await db.from('profiles').select('tier, tier_expires_at').eq('id', user.id).single();
    const mine = effectiveTier(profile ?? { tier: 'guest', tier_expires_at: null });
    if (lounge && TIER_RANK[mine] < TIER_RANK[lounge.min_tier]) {
      throw new HttpError(403, `${lounge.min_tier} membership required to sit at a table here`);
    }
  }

  const { data: seats } = await db.from('seats').select('*').eq('table_id', table.id).order('seat_index');
  const existing = seats!.find((s: any) => s.user_id === user.id);
  if (existing) return json({ ok: true, tableId: table.id, seatIndex: existing.seat_index });

  const target = seatIndex != null
    ? seats!.find((s: any) => s.seat_index === seatIndex && !s.user_id)
    : seats!.find((s: any) => !s.user_id);
  if (!target) throw new HttpError(409, 'no free seat');

  await db.from('seats').update({
    user_id: user.id, duppy_level: null, connected_at: new Date().toISOString(),
  }).eq('table_id', table.id).eq('seat_index', target.seat_index);

  return json({ ok: true, tableId: table.id, seatIndex: target.seat_index });
}));
```

Note this also closes a second leak for free: previously, joining by a shared join-code bypassed the lounge gate entirely even for chat-equivalent participation, since join-code lookup never looked at `lounge_id` at all.

- [ ] **Step 4: Add `loungeId` to the client input type**

In `apps/web/src/online.ts`, update:

```ts
export interface CreateTableInput {
  mode: GameMode;
  format: 'sixlove' | 'firstToSix';
  seatCount: 2 | 3 | 4;
  tournament?: boolean;
  oneAllPlayTwo?: boolean;
  isPrivate?: boolean;
  duppies?: string[];
  loungeId?: string;
}
```

`createTable` itself is already generic (`call<...>('create-table', { ...input })`), so no change needed to the function body — only the type. The 403 from either function surfaces to the caller as a plain `Error` via the existing `call<T>` error handling — Task 6's `openTablesPanel`/`startTableForm` should let that message reach the player as-is (it's already human-readable: `"vip membership required to start a table here"`), not swallow it.

- [ ] **Step 5: Deploy and verify**

Deploy both functions via the Supabase MCP `deploy_edge_function` tool (bundle `index.ts` + `../_shared/lib.ts` + `../_shared/engine/types.ts` for each, same pattern as every other deploy this session). Then:

```bash
cd "/Users/higgi/Jamaican Domino/yard-dominoes" && npm run typecheck
```

Expected: clean, no errors.

- [ ] **Step 6: Manual verification**

Using an anonymous (guest-tier) session token, attempt `create-table` with `loungeId` set to Red Carpet's id (`select id from public.lounges where slug = 'red-carpet'`). Expect: `403`, message containing `"vip membership required"`. Then manually set that test profile's `tier` to `'vip'` and `tier_expires_at` to a year out via SQL, retry — expect success, and:

```sql
select id, lounge_id from public.tables order by created_at desc limit 1;
```

`lounge_id` matches. Delete the test row after. Repeat the same guest-then-vip check against `join-table` using a table already created in Red Carpet by another (VIP) session. Also confirm the **negative** case still works: `create-table` with `loungeId` pointing at Yard Gate (`min_tier: 'guest'`) succeeds for a plain guest — the gate must only bind where a lounge actually requires it.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/lib.ts supabase/functions/create-table/index.ts supabase/functions/join-table/index.ts apps/web/src/online.ts
git commit -m "feat: create-table accepts a loungeId; both create/join enforce its tier gate"
```

---

## Task 2: `pass-pose` Edge Function

**Why this needs a new function, not just client wiring:** the engine already has `passPoseToPartner(s: SetState): SetState`, but `sets` has no client write policy at all (`create policy "sets are visible to anyone who can see the table" on sets for select` — select only, migration 0001). There is currently no path, anywhere, for a client to change `sets.poser`. This function is that path.

**Files:**
- Create: `supabase/functions/pass-pose/index.ts`
- Modify: `supabase/config.toml` (register `verify_jwt = true` for the new function, matching the existing block for every other user-facing function)
- Modify: `apps/web/src/online.ts` (add `passPose`)

**Interfaces:**
- Produces: `POST /pass-pose { tableId: string }` → `{ ok: true }` on success, `HttpError` otherwise.
- Produces (client): `passPose(tableId: string): Promise<{ ok: true }>`
- Consumes: `requireUser`, `serviceClient`, `HttpError`, `handled` from `../_shared/lib.ts` (all exist already).

- [ ] **Step 1: Write the Edge Function**

```ts
// supabase/functions/pass-pose/index.ts
//
// The engine has passPoseToPartner(), but `sets` has no client write policy —
// this is the only path a client has to change who poses next. Only the side
// that just won may call it, only in Partner mode, and never when the
// double-six is forced (the engine itself throws on that; this mirrors the
// same guard so the error is a 422, not a 500).

import { handled, json, requireUser, serviceClient, HttpError } from '../_shared/lib.ts';

Deno.serve(handled(async (req) => {
  const user = await requireUser(req);
  const { tableId } = await req.json() as { tableId: string };
  const db = serviceClient();

  const { data: table } = await db.from('tables').select('*').eq('id', tableId).single();
  if (!table) throw new HttpError(404, 'no such table');
  if (table.mode !== 'partner') throw new HttpError(422, 'only partners can pass the pose');

  const { data: seats } = await db.from('seats').select('*').eq('table_id', tableId);
  const mySeat = seats!.find((s: any) => s.user_id === user.id);
  if (!mySeat) throw new HttpError(403, 'you are not seated at this table');

  const { data: set } = await db.from('sets')
    .select('*').eq('table_id', tableId).is('winner_side', null)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!set) throw new HttpError(409, 'no open set on this table');
  if (set.pose_must_be_double_six) throw new HttpError(422, 'the double-six opens this hand — the pose is not yours to pass');
  if (set.hands_played === 0) throw new HttpError(422, 'the double-six opens this hand — the pose is not yours to pass');

  // Only the side that just won (the current poser's side) may pass it.
  const poserSide = mySeat.seat_index % 2 === set.poser % 2;
  if (mySeat.seat_index !== set.poser && !poserSide) throw new HttpError(403, 'only the side that just won may pass the pose');

  const partner = (set.poser + 2) % table.seat_count;
  await db.from('sets').update({ poser: partner }).eq('id', set.id);

  return json({ ok: true });
}));
```

- [ ] **Step 2: Register `verify_jwt` in config.toml**

In `supabase/config.toml`, add alongside the other function blocks:

```toml
[functions.pass-pose]
verify_jwt = true
```

- [ ] **Step 3: Add the client call**

In `apps/web/src/online.ts`, alongside the other `call<T>` wrappers:

```ts
export const passPose = (tableId: string) =>
  call<{ ok: true }>('pass-pose', { tableId });
```

- [ ] **Step 4: Deploy**

Deploy via the Supabase MCP `deploy_edge_function` tool with `verify_jwt: true`, bundling `index.ts` + `../_shared/lib.ts` + `../_shared/engine/types.ts` (same minimal bundle as `create-table`/`join-table` — this function never touches engine logic beyond types `lib.ts` itself imports).

- [ ] **Step 5: Manual verification**

Using two real seated anon sessions on a partner-mode table (or one session for both seats 0 and 2, for the purposes of this check), play a hand to completion so a side wins with `pose_must_be_double_six = false`. Then:

```bash
curl -s -w "\nHTTP %{http_code}\n" -X POST "https://iqixdijhckgilvyhduxb.supabase.co/functions/v1/pass-pose" \
  -H "apikey: <anon key>" -H "Authorization: Bearer <winning seat's token>" \
  -H "content-type: application/json" -d '{"tableId":"<id>"}'
```

Expected: `{"ok":true}`, HTTP 200. Then:

```sql
select poser from public.sets where table_id = '<id>' and winner_side is null;
```

Expected: `poser` now equals the partner seat, not the winner seat. Also verify a 422 when attempting this on a `pose_must_be_double_six = true` set (e.g., the very first hand of a fresh table).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/pass-pose supabase/config.toml apps/web/src/online.ts
git commit -m "feat: add pass-pose Edge Function — sets had no client write path at all"
```

---

## Task 3: `online.ts` — conflict detection and rejoin lookup

**Files:**
- Modify: `apps/web/src/online.ts`

**Interfaces:**
- Produces: `export class ConflictError extends Error {}`
- Produces: `findActiveSeat(): Promise<{ tableId: string; seatIndex: number } | null>`
- Consumes: `FunctionsHttpError` from `@supabase/supabase-js` (confirmed exported, v2.110.8).

- [ ] **Step 1: Add `ConflictError` and detect 409 in `call<T>`**

`play-move` returns HTTP 409 (via `HttpError(409, ...)`) when the optimistic version check in `commit_move` rejects a stale write. The generic `call<T>` helper currently collapses every error into a plain `Error`, which loses the status code. Fix that:

```ts
import { createClient, type SupabaseClient, type RealtimeChannel, FunctionsHttpError } from '@supabase/supabase-js';

// ... existing code ...

export class ConflictError extends Error {
  constructor() { super('someone else moved first'); }
}

async function call<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await client().functions.invoke(fn, { body });
  if (error) {
    if (error instanceof FunctionsHttpError && error.context?.status === 409) {
      throw new ConflictError();
    }
    throw new Error(error.message);
  }
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as T;
}
```

- [ ] **Step 2: Add the rejoin lookup**

```ts
/**
 * Find a table this user is currently seated at with a hand in progress.
 * Used on load to offer "rejoin" instead of losing a live game to a reload.
 */
export async function findActiveSeat(): Promise<{ tableId: string; seatIndex: number } | null> {
  const db = client();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return null;
  const { data } = await db.from('seats')
    .select('table_id, seat_index, tables!inner(status)')
    .eq('user_id', auth.user.id)
    .eq('tables.status', 'playing')
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return { tableId: data.table_id as string, seatIndex: data.seat_index as number };
}
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 4: Manual verification**

With a seat already sitting at a `status = 'playing'` table (create one via `create-table` + `start-hand` using the curl pattern from earlier verification), call `findActiveSeat()` from the browser console after signing in as that same user (or verify the equivalent query directly via SQL):

```sql
select s.table_id, s.seat_index from public.seats s
join public.tables t on t.id = s.table_id
where s.user_id = '<user id>' and t.status = 'playing'
limit 1;
```

Expected: returns the row. Then set that table's `status` to `'finished'` and confirm the query returns nothing — rejoin should only fire for genuinely live games.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/online.ts
git commit -m "feat: conflict detection (ConflictError) and rejoin lookup in online.ts"
```

---

## Task 4: `lounges.ts` — list open tables in a lounge

**Files:**
- Modify: `apps/web/src/lounges.ts`

**Interfaces:**
- Produces: `export interface OpenTable { id: string; joinCode: string; mode: GameMode; format: string; seatCount: number; status: 'waiting' | 'playing'; occupiedSeats: number }`
- Produces: `listLoungeTables(loungeId: string): Promise<OpenTable[]>`

- [ ] **Step 1: Write the query**

Add to `apps/web/src/lounges.ts`, alongside `listLounges`:

```ts
export interface OpenTable {
  id: string;
  joinCode: string;
  mode: GameMode;
  format: string;
  seatCount: number;
  status: 'waiting' | 'playing';
  occupiedSeats: number;
}

/** Tables currently running or waiting for players inside one lounge. */
export async function listLoungeTables(loungeId: string): Promise<OpenTable[]> {
  const { data, error } = await db().from('tables')
    .select('id, join_code, mode, format, seat_count, status, seats(user_id)')
    .eq('lounge_id', loungeId)
    .in('status', ['waiting', 'playing'])
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data as any[]).map((t) => ({
    id: t.id,
    joinCode: t.join_code,
    mode: t.mode,
    format: t.format,
    seatCount: t.seat_count,
    status: t.status,
    occupiedSeats: (t.seats as { user_id: string | null }[]).filter((s) => s.user_id).length,
  }));
}
```

`GameMode` is already imported at the top of `lounges.ts`? Check — it currently imports nothing from `@yard/engine`; add:

```ts
import type { GameMode } from '@yard/engine';
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 3: Manual verification**

Create two test tables via curl in the same lounge (`loungeId` from Task 1's Yard Gate lookup), one left `waiting`, one advanced to `playing` via `start-hand`. Call `listLoungeTables` from the browser console (or verify the equivalent SQL directly):

```sql
select t.id, t.status, count(s.user_id) filter (where s.user_id is not null) as occupied
from public.tables t left join public.seats s on s.table_id = t.id
where t.lounge_id = '<lounge id>' and t.status in ('waiting','playing')
group by t.id, t.status;
```

Expected: both test tables appear with correct occupied counts. Clean up both test tables after (`delete from public.tables where id in (...)`).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lounges.ts
git commit -m "feat: listLoungeTables query for the open-tables panel"
```

---

## Task 5: `onlinetable.ts` — the `OnlineGame` class

**Files:**
- Create: `apps/web/src/onlinetable.ts`

**Interfaces:**
- Consumes: `supabase`, `createTable`, `joinTable`, `startHand`, `playMove`, `watchTable`, `passPose`, `ConflictError`, `type PublicHand`, `type CreateTableInput` from `./online.ts`; `legalMoves`, `sideOf` from `@yard/engine`; `type Board, GameMode, Move, TileId` from `@yard/engine`.
- Produces: `export class OnlineGame` with the shape below, consumed by `onlinetableview.ts` (Task 6) and `loungeview.ts` (Task 7).

- [ ] **Step 1: Write the class**

```ts
// apps/web/src/onlinetable.ts
//
// Online counterpart to LocalGame (local.ts). Same view-facing shape — state
// plus an event emitter the view re-renders on — but state arrives over
// Realtime instead of from the engine directly. The server is the only thing
// that ever decides whether a move is legal; legalMovesForMe() exists purely
// to enable/disable tiles and prompt "which end?", exactly like LocalGame,
// using the same stub-state trick bots.ts uses to enumerate one seat's moves
// without needing to see anyone else's tiles.

import {
  supabase, startHand as apiStartHand, playMove as apiPlayMove, passPose as apiPassPose,
  watchTable, ConflictError, type PublicHand, type TableSubscription,
} from './online.ts';
import { legalMoves, sideOf } from '@yard/engine';
import type { GameMode, Move, TileId } from '@yard/engine';

export interface TableInfo {
  id: string;
  loungeId: string | null;
  mode: GameMode;
  format: string;
  seatCount: 2 | 3 | 4;
  tournament: boolean;
  status: 'waiting' | 'playing' | 'finished';
  turnSeconds: number;
  joinCode: string;
}

export interface SeatInfo {
  seatIndex: number;
  userId: string | null;
  username: string | null;
  duppyLevel: string | null;
}

export type OnlineEvent = { type: 'state' } | { type: 'error'; message: string };

function db() {
  if (!supabase) throw new Error('online mode needs Supabase configured');
  return supabase;
}

export class OnlineGame {
  table: TableInfo;
  seats: SeatInfo[] = [];
  mySeat: number | null = null;
  get isSpectator() { return this.mySeat === null; }

  hand: PublicHand | null = null;
  myTiles: TileId[] = [];

  scores: number[] = [];
  handValue = 1;
  poser = 0;
  poseMustBeDoubleSix = true;
  handsPlayed = 0;
  winnerSide: number | null = null;
  sixLove = false;

  private myUserId: string | null = null;
  private sub: TableSubscription | null = null;
  private listeners: ((e: OnlineEvent) => void)[] = [];
  private visListener = () => {
    if (document.visibilityState === 'visible') this.resubscribe();
  };

  private constructor(table: TableInfo) {
    this.table = table;
  }

  on(fn: (e: OnlineEvent) => void) { this.listeners.push(fn); }
  private emit(e: OnlineEvent) { for (const fn of this.listeners) fn(e); }

  get mySide(): number | null {
    return this.mySeat === null ? null : sideOf(this.mySeat, this.table.mode);
  }

  isMyTurn(): boolean {
    return this.hand?.status === 'active' && this.mySeat !== null && this.hand.turn === this.mySeat;
  }

  /** Whichever side just won and may choose to pass or keep the pose. */
  canChoosePose(): boolean {
    return this.table.mode === 'partner'
      && this.hand?.status !== 'active'
      && this.winnerSide === null
      && !this.poseMustBeDoubleSix
      && this.handsPlayed > 0
      && this.mySide === sideOf(this.poser, 'partner');
  }

  /** Join a table: one parallel read (table + seats + open set), then a
   * dependent read for the current hand (needs table_id, which we now have)
   * and, if seated, this seat's tiles (needs the hand's id). Two waves, not
   * four sequential round trips. */
  static async open(tableId: string): Promise<OnlineGame> {
    const conn = db();
    const [tableRes, seatsRes, setRes] = await Promise.all([
      conn.from('tables').select('*').eq('id', tableId).single(),
      conn.from('seats').select('*').eq('table_id', tableId).order('seat_index'),
      conn.from('sets').select('*').eq('table_id', tableId).is('winner_side', null)
        .order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (tableRes.error || !tableRes.data) throw new Error(tableRes.error?.message ?? 'no such table');
    if (seatsRes.error) throw new Error(seatsRes.error.message);

    const t = tableRes.data;
    const game = new OnlineGame({
      id: t.id, loungeId: t.lounge_id, mode: t.mode, format: t.format, seatCount: t.seat_count,
      tournament: t.tournament, status: t.status, turnSeconds: t.turn_seconds, joinCode: t.join_code,
    });

    const { data: auth } = await conn.auth.getUser();
    game.myUserId = auth.user?.id ?? null;
    game.applySeats(seatsRes.data ?? []);

    const set = setRes.data;
    if (set) {
      game.scores = set.scores; game.handValue = set.hand_value; game.poser = set.poser;
      game.poseMustBeDoubleSix = set.pose_must_be_double_six; game.handsPlayed = set.hands_played;
      game.winnerSide = set.winner_side; game.sixLove = set.six_love;
    }

    const { data: hand } = await conn.from('hand_public').select('*')
      .eq('table_id', tableId).order('updated_at', { ascending: false }).limit(1).maybeSingle();
    if (hand) {
      game.hand = hand as PublicHand;
      if (!game.isSpectator) {
        const { data: seatHand } = await conn.from('seat_hands').select('tiles')
          .eq('hand_id', hand.hand_id).eq('seat_index', game.mySeat!).maybeSingle();
        game.myTiles = (seatHand?.tiles as TileId[]) ?? [];
      }
    }

    game.subscribe();
    document.addEventListener('visibilitychange', game.visListener);
    return game;
  }

  private applySeats(rows: any[]) {
    this.seats = rows.map((s) => ({
      seatIndex: s.seat_index, userId: s.user_id, username: null, duppyLevel: s.duppy_level,
    }));
    this.mySeat = this.myUserId
      ? this.seats.find((s) => s.userId === this.myUserId)?.seatIndex ?? null
      : null;
  }

  private subscribe() {
    this.sub = watchTable(this.table.id, {
      onPublic: (hand) => {
        this.hand = hand;
        this.emit({ type: 'state' });
      },
      onMyTiles: (tiles) => {
        this.myTiles = tiles;
        this.emit({ type: 'state' });
      },
      onSet: (set) => {
        this.scores = set.scores as number[]; this.handValue = set.hand_value as number;
        this.poser = set.poser as number; this.poseMustBeDoubleSix = set.pose_must_be_double_six as boolean;
        this.handsPlayed = set.hands_played as number; this.winnerSide = set.winner_side as number | null;
        this.sixLove = set.six_love as boolean;
        this.emit({ type: 'state' });
      },
      onSeats: () => { void this.refetchSeats(); },
    });
  }

  private async refetchSeats() {
    const { data } = await db().from('seats').select('*').eq('table_id', this.table.id).order('seat_index');
    this.applySeats(data ?? []);
    this.emit({ type: 'state' });
  }

  /** After a 409: someone else moved first. Reload the public state, show
   * nothing alarming — this is the concurrency control working correctly. */
  private async refetchHand() {
    const { data } = await db().from('hand_public').select('*')
      .eq('table_id', this.table.id).order('updated_at', { ascending: false }).limit(1).maybeSingle();
    if (data) this.hand = data as PublicHand;
    if (!this.isSpectator && this.hand) {
      const { data: seatHand } = await db().from('seat_hands').select('tiles')
        .eq('hand_id', this.hand.hand_id).eq('seat_index', this.mySeat!).maybeSingle();
      this.myTiles = (seatHand?.tiles as TileId[]) ?? [];
    }
    this.emit({ type: 'state' });
  }

  private resubscribe() {
    this.sub?.stop();
    this.subscribe();
    void this.refetchHand();
  }

  /** Legal moves for MY turn only — a stub state with my real tiles and
   * placeholder-length arrays for everyone else, the same trick bots.ts uses.
   * `turn` must be set to my own seat: legalMoves() reads hands[state.turn]. */
  legalMovesForMe(): Move[] {
    if (!this.hand || this.mySeat === null || this.hand.turn !== this.mySeat) return [];
    const hands: TileId[][] = this.hand.hand_sizes.map((n, i) =>
      i === this.mySeat ? this.myTiles : new Array(n).fill('0-0'));
    return legalMoves({
      seatCount: this.table.seatCount,
      mode: this.table.mode,
      hands,
      boneyard: new Array(this.hand.boneyard_size).fill('0-0'),
      board: this.hand.board,
      turn: this.mySeat,
      consecutivePasses: 0,
      moveLog: this.hand.move_log,
      status: this.hand.status as 'active' | 'domino' | 'blocked',
      result: this.hand.result as any,
      poseMustBeDoubleSix: this.poseMustBeDoubleSix,
      poser: this.poser,
    });
  }

  async play(move: Move): Promise<void> {
    if (!this.hand) return;
    try {
      await apiPlayMove(this.hand.hand_id, move);
    } catch (err) {
      if (err instanceof ConflictError) { await this.refetchHand(); return; }
      this.emit({ type: 'error', message: err instanceof Error ? err.message : 'move failed' });
    }
  }

  async dealNext(pass: boolean): Promise<void> {
    try {
      if (pass) await apiPassPose(this.table.id);
      await apiStartHand(this.table.id);
    } catch (err) {
      this.emit({ type: 'error', message: err instanceof Error ? err.message : 'could not start hand' });
    }
  }

  leave() {
    this.sub?.stop();
    document.removeEventListener('visibilitychange', this.visListener);
  }
}
```

`TableSubscription.stop` — check `watchTable`'s return shape in `online.ts:90-93`: `{ channel, stop: () => void }`. Matches.

`PublicHand` already exported from `online.ts:76-88`. Matches.

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: clean. If `legalMoves`'s `HandState.status`/`result` typing complains about the cast, check `packages/engine/src/types.ts` — `HandStatus` and `HandResult` are the exact shapes; the `as any` on `result` is acceptable here since `hand_public.result` is `jsonb` and its shape is only ever what the engine itself wrote.

- [ ] **Step 3: Manual verification**

This class has no view yet (Task 6), so verify it directly from the browser console after Task 6 wires an entry point — **defer full verification to Task 7's manual pass**. For now, confirm the file compiles and exports the expected shape:

```bash
npm run build
```

Expected: build succeeds, `onlinetable.ts` is not in the main `index` chunk listing (it's only reachable via the dynamic lounge import, same as `lounges.ts`).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/onlinetable.ts
git commit -m "feat: OnlineGame — realtime-driven table state, parallel-fetch join, 409 recovery"
```

---

## Task 6: `onlinetableview.ts` — rendering

**Files:**
- Create: `apps/web/src/onlinetableview.ts`

**Interfaces:**
- Consumes: `OnlineGame`, `TableInfo` from `./onlinetable.ts`; `listLoungeTables`, `type OpenTable` from `./lounges.ts`; `createTable`, `joinTable` from `./online.ts`; `tileEl`, `renderBoard`, `scoreTrack`, `backsEl`, `el` from `./render.ts`; `DUPPY_LABELS`, `DUPPY_LEVELS` from `@yard/engine`.
- Produces: `openTablesPanel(loungeId: string, onJoin: (tableId: string) => void, rerender: () => void): Promise<HTMLElement>`, `joinByCodeField(onJoin: (tableId: string) => void): HTMLElement`, `liveTableView(game: OnlineGame, rerender: () => void, onLeave: () => void): DocumentFragment` — all consumed by `loungeview.ts` (Task 7).

- [ ] **Step 1: Open-tables panel and config form**

```ts
// apps/web/src/onlinetableview.ts
//
// Rendering only — same DOM-building style as loungeview.ts and main.ts.
// No state lives here; OnlineGame (onlinetable.ts) owns it, this module only
// reads it and calls back into it.

import { OnlineGame, type TableInfo } from './onlinetable.ts';
import { listLoungeTables, type OpenTable } from './lounges.ts';
import { createTable, joinTable } from './online.ts';
import { tileEl, renderBoard, scoreTrack, backsEl, el } from './render.ts';
import { DUPPY_LABELS, DUPPY_LEVELS, knownVoids } from '@yard/engine';
import type { GameMode, Move } from '@yard/engine';

export async function openTablesPanel(
  loungeId: string,
  onJoin: (tableId: string) => void,
  rerender: () => void,
): Promise<HTMLElement> {
  const wrap = el('div', 'panel');
  wrap.append(el('div', 'eyebrow', 'Open tables'), el('h2', undefined, 'Sit down'));

  let tables: OpenTable[] = [];
  try { tables = await listLoungeTables(loungeId); } catch { /* shown as empty below */ }

  if (tables.length === 0) {
    wrap.append(el('p', 'muted', 'No tables running here yet. Start one.'));
  } else {
    const list = el('div', 'stack');
    for (const t of tables) {
      const row = el('div', 'row');
      row.append(el('span', undefined, `${t.mode === 'partner' ? 'Partner' : 'Cut throat'} · ${t.format === 'sixlove' ? 'Six love' : 'First to six'}`));
      row.append(el('span', 'muted', `${t.occupiedSeats}/${t.seatCount}`));
      const join = document.createElement('button');
      join.className = 'act ghost';
      join.textContent = t.status === 'waiting' ? 'Sit down' : 'Watch';
      join.onclick = () => void (async () => {
        if (t.status === 'waiting') await joinTable(t.joinCode);
        onJoin(t.id);
      })();
      row.appendChild(join);
      list.appendChild(row);
    }
    wrap.appendChild(list);
  }

  wrap.appendChild(startTableForm(loungeId, onJoin));
  return wrap;
}

function startTableForm(loungeId: string, onJoin: (tableId: string) => void): HTMLElement {
  const form = el('div', 'row');
  const mode = document.createElement('select');
  mode.innerHTML = `<option value="partner">Partner — 2 v 2</option><option value="cutthroat">Cut throat</option>`;
  const seatCount = document.createElement('select');
  seatCount.innerHTML = `<option value="4">4 players</option><option value="3">3 players</option><option value="2">2 players</option>`;
  const duppy = document.createElement('select');
  duppy.innerHTML = DUPPY_LEVELS.map((d) => `<option value="${d}">${DUPPY_LABELS[d]}</option>`).join('');

  for (const [label, control] of [['Game', mode], ['Seats', seatCount], ['Fill empty seats with', duppy]] as const) {
    const field = el('label', 'field');
    field.append(el('span', undefined, label), control);
    form.appendChild(field);
  }

  const go = document.createElement('button');
  go.className = 'act';
  go.textContent = 'Start table';
  go.onclick = () => void (async () => {
    go.disabled = true;
    try {
      const seats = Number(seatCount.value);
      const fill = new Array(Math.max(0, seats - 1)).fill(duppy.value);
      const { tableId } = await createTable({
        mode: mode.value as GameMode,
        format: mode.value === 'cutthroat' ? 'firstToSix' : 'sixlove',
        seatCount: seats as 2 | 3 | 4,
        duppies: fill,
        loungeId,
      });
      onJoin(tableId);
    } finally {
      go.disabled = false;
    }
  })();
  form.appendChild(go);
  return form;
}

export function joinByCodeField(onJoin: (tableId: string) => void): HTMLElement {
  const row = el('div', 'row');
  const input = document.createElement('input');
  input.placeholder = 'Join code';
  input.maxLength = 6;
  const go = document.createElement('button');
  go.className = 'act ghost';
  go.textContent = 'Join';
  go.onclick = () => void (async () => {
    const code = input.value.trim();
    if (!code) return;
    const { tableId } = await joinTable(code);
    onJoin(tableId);
  })();
  row.append(input, go);
  return row;
}
```

- [ ] **Step 2: Live table view**

Append to the same file:

```ts
let pendingTile: string | null = null;

export function liveTableView(game: OnlineGame, rerender: () => void, onLeave: () => void): DocumentFragment {
  const frag = document.createDocumentFragment();

  const head = el('div', 'panel');
  const top = el('div', 'spread');
  top.append(el('h2', undefined, `Table ${game.table.joinCode}`));
  const leave = document.createElement('button');
  leave.className = 'act ghost';
  leave.textContent = 'Leave';
  leave.onclick = () => { game.leave(); onLeave(); };
  top.appendChild(leave);
  head.appendChild(top);
  if (game.isSpectator) head.append(el('div', 'muted', 'Watching — spectators never see anyone\'s tiles'));
  frag.appendChild(head);

  const board = el('div', 'scoreboard');
  if (game.table.mode === 'partner') {
    board.append(
      scoreTrack('You & partner', game.scores[(game.mySide ?? 0)] ?? 0, { us: true }),
      scoreTrack('Them', game.scores[1 - (game.mySide ?? 0)] ?? 0),
    );
  } else {
    game.scores.forEach((s, i) => board.append(scoreTrack(`Seat ${i}`, s, { us: i === game.mySeat })));
  }
  frag.appendChild(board);

  const felt = el('div', 'table-felt');
  const line = el('div', 'line');
  renderBoard(line, game.hand?.board ?? null);
  felt.appendChild(line);
  frag.appendChild(felt);

  if (game.hand?.status === 'active' && game.hand.turn_expires_at) {
    frag.appendChild(countdown(game.hand.turn_expires_at, rerender));
  }

  const seatsRow = el('div', 'seats');
  game.seats.forEach((s) => {
    const card = el('div', 'seat');
    if (game.hand?.turn === s.seatIndex && game.hand.status === 'active') card.classList.add('turn');
    card.append(el('h3', undefined, s.userId ? (s.username ?? `Seat ${s.seatIndex}`) : `Duppy · ${s.duppyLevel}`));
    const count = game.hand?.hand_sizes[s.seatIndex] ?? 0;
    card.append(el('div', 'meta', `${count} tile${count === 1 ? '' : 's'}`));
    if (s.seatIndex !== game.mySeat) card.append(backsEl(count));
    seatsRow.appendChild(card);
  });
  frag.appendChild(seatsRow);

  if (!game.isSpectator) frag.appendChild(myHandPanel(game, rerender));

  if (game.hand?.status !== 'active' && game.hand?.result) {
    frag.appendChild(handResultPanel(game, rerender));
  }

  return frag;
}

function countdown(expiresAt: string, rerender: () => void): HTMLElement {
  const remaining = Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000));
  const bar = el('div', 'panel');
  bar.append(el('div', 'muted', remaining > 0 ? `${remaining}s to play` : 'time\'s up — a duppy will play for this seat'));
  if (remaining > 0) setTimeout(rerender, 1000);
  return bar;
}

function myHandPanel(game: OnlineGame, rerender: () => void): HTMLElement {
  const panel = el('div', 'panel');
  panel.append(el('div', 'eyebrow', game.isMyTurn() ? 'Your play' : 'Your hand'));
  const legal = game.legalMovesForMe();
  const playable = new Set(legal.flatMap((m) => ('tile' in m ? [m.tile] : [])));
  const hand = el('div', 'hand');

  for (const tile of game.myTiles) {
    const node = tileEl(tile);
    const can = playable.has(tile);
    node.classList.add(can ? 'playable' : 'dead');
    if (pendingTile === tile) node.classList.add('chosen');
    if (can) {
      node.tabIndex = 0;
      const choose = () => {
        const options = legal.filter((m) => 'tile' in m && m.tile === tile);
        if (options.length === 1) { pendingTile = null; void game.play(options[0]); }
        else { pendingTile = pendingTile === tile ? null : tile; rerender(); }
      };
      node.onclick = choose;
      node.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); } };
    }
    hand.appendChild(node);
  }
  panel.appendChild(hand);

  if (pendingTile) {
    const choice = el('div', 'row');
    choice.append(el('span', 'muted', 'Which end?'));
    for (const move of legal.filter((m) => 'tile' in m && m.tile === pendingTile)) {
      const b = document.createElement('button');
      b.className = 'act ghost';
      b.textContent = (move as any).end === 'left' ? 'Left end' : 'Right end';
      b.onclick = () => { pendingTile = null; void game.play(move); };
      choice.appendChild(b);
    }
    panel.appendChild(choice);
  }

  const onlyPass = legal.length === 1 && legal[0].kind === 'pass';
  if (game.isMyTurn() && onlyPass) {
    const b = document.createElement('button');
    b.className = 'act';
    b.textContent = 'Pass';
    b.onclick = () => void game.play(legal[0]);
    panel.appendChild(b);
  }
  return panel;
}

function handResultPanel(game: OnlineGame, rerender: () => void): HTMLElement {
  const panel = el('div', 'panel');
  const r = game.hand!.result as any;
  panel.append(el('h2', undefined, r.tie ? 'Tied on count — replay' : 'Hand over'));

  if (game.canChoosePose()) {
    const row = el('div', 'row');
    row.append(el('span', 'muted', 'Who should pose?'));
    const pass = document.createElement('button');
    pass.className = 'act ghost';
    pass.textContent = 'Pass pose';
    pass.onclick = () => void game.dealNext(true);
    const keep = document.createElement('button');
    keep.className = 'act';
    keep.textContent = 'Keep pose';
    keep.onclick = () => void game.dealNext(false);
    row.append(pass, keep);
    panel.appendChild(row);
    return panel;
  }

  if (game.winnerSide === null && !game.isSpectator) {
    const next = document.createElement('button');
    next.className = 'act';
    next.textContent = 'Deal next hand';
    next.onclick = () => void game.dealNext(false);
    panel.appendChild(next);
  } else if (game.winnerSide !== null) {
    panel.append(el('p', 'muted', 'Set over.'));
  }
  return panel;
}
```

`knownVoids` is imported but unused in this file if pass voids aren't surfaced here — remove that import if the compiler flags it unused (local play's `seats()` in `main.ts` shows void hints; this plan intentionally leaves that out of v1's live table to keep the file focused — it can be added later by importing `knownVoids` and mirroring `main.ts:270-276`'s pattern against `game.hand.move_log`).

- [ ] **Step 3: Typecheck and build**

```bash
npm run typecheck && npm run build
```

Expected: clean. If `knownVoids` is unused, delete it from the import line before this passes.

- [ ] **Step 4: Manual verification**

Deferred to Task 7 (needs `loungeview.ts` wiring to actually reach this view). Confirm only that the build output still shows two chunks and `onlinetableview.ts` is bundled into the lazy `loungeview` chunk, not `index`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/onlinetableview.ts
git commit -m "feat: online table rendering — open-tables panel, join by code, live table view"
```

---

## Task 7: Wire it into `loungeview.ts`, plus rejoin on load

**Files:**
- Modify: `apps/web/src/loungeview.ts`

**Interfaces:**
- Consumes: everything from Tasks 5 and 6.
- Modifies `loungeState` shape to add: `onlineGame: OnlineGame | null`.

- [ ] **Step 1: Extend state and imports**

At the top of `loungeview.ts`, add:

```ts
import { OnlineGame } from './onlinetable.ts';
import { openTablesPanel, joinByCodeField, liveTableView } from './onlinetableview.ts';
import { findActiveSeat } from './online.ts';
```

Extend `LoungeState`:

```ts
interface LoungeState {
  lounges: Lounge[];
  me: { id: string; username: string; tier: Tier } | null;
  current: Lounge | null;
  roster: PresenceEntry[];
  messages: LoungeMessage[];
  room: { leave: () => void } | null;
  error: string | null;
  loading: boolean;
  onlineGame: OnlineGame | null;
}
```

Update the `loungeState` initializer to include `onlineGame: null`.

- [ ] **Step 2: Rejoin check in `loadLounges`**

```ts
export async function loadLounges(rerender: () => void) {
  if (!loungesAvailable || loungeState.loading) return;
  loungeState.loading = true;
  try {
    await ensureSignedIn();
    const [lounges, me] = await Promise.all([listLounges(), myProfile()]);
    loungeState.lounges = lounges;
    loungeState.me = me;
    loungeState.error = null;

    if (!loungeState.onlineGame) {
      const active = await findActiveSeat();
      if (active) loungeState.onlineGame = await OnlineGame.open(active.tableId);
    }
  } catch (err) {
    loungeState.error = err instanceof Error ? err.message : 'could not load lounges';
  } finally {
    loungeState.loading = false;
    rerender();
  }
}
```

- [ ] **Step 3: Route the view**

Replace `loungesView` and the `room()` integration so a live game takes over the screen when one exists, regardless of which lounge is "current":

```ts
export function loungesView(rerender: () => void): DocumentFragment | HTMLElement {
  if (!loungesAvailable) {
    const frag = document.createDocumentFragment();
    const panel = el('div', 'panel');
    panel.append(el('div', 'eyebrow', 'Lounges'));
    panel.append(el('h2', undefined, 'Not connected yet'));
    panel.append(el('div', 'offline-note',
      'Lounges need a Supabase project. Copy .env.example to .env, fill in your ' +
      'project URL and anon key, run the migrations, then reload. Local play ' +
      'against duppies works without any of that.'));
    frag.appendChild(panel);
    return frag;
  }
  if (loungeState.onlineGame) {
    return liveTableView(loungeState.onlineGame, rerender, () => {
      loungeState.onlineGame = null;
      rerender();
    });
  }
  return loungeState.current ? room(loungeState.current, rerender) : loungeList(rerender);
}
```

- [ ] **Step 4: Add the open-tables panel and join-by-code to the lounge room**

In `room(lounge, rerender)`, after the existing `head` block and before the `grid` (chat + roster), insert:

```ts
  const tablesPanel = document.createElement('div');
  void openTablesPanel(lounge.id, (tableId) => void (async () => {
    loungeState.onlineGame = await OnlineGame.open(tableId);
    rerender();
  })(), rerender).then((panel) => {
    tablesPanel.replaceWith(panel);
  });
  frag.appendChild(tablesPanel);
```

And in `loungeList(rerender)`, right after the `head` block (before the `if (loungeState.error)` check), add the join-by-code field so it's reachable without entering any specific lounge first:

```ts
  frag.appendChild(joinByCodeField((tableId) => void (async () => {
    loungeState.onlineGame = await OnlineGame.open(tableId);
    rerender();
  })()));
```

- [ ] **Step 5: Typecheck and build**

```bash
npm run typecheck && npm run build
```

Expected: clean, two chunks, `index` still under ~50 kB raw.

- [ ] **Step 6: Manual verification — the full scenario list from the spec**

Deploy to Vercel (push to `main`; auto-deploys) and run every one of these against the **live production URL**, not `npm run dev` — Realtime and cross-session behavior need the real deployment:

1. **Happy path.** Two separate browser profiles (or one normal + one incognito window), each signed in as a different anonymous guest. Both open the same lounge. One starts a table with 1 duppy and 2 empty seats set to duppy fill, seat count 4. The other joins via the open-tables list. Play a full hand to completion. Expect: both screens show the same board in real time, tiles update live, hand resolves correctly, "Deal next hand" (and "Pass pose" if Partner mode and eligible) works.
2. **Simultaneous moves.** With both sessions seated and it being seat A's turn, have seat A and a third spectating/replayed request both attempt a move at nearly the same instant (simplest repro: fire two `playMove` calls back-to-back via curl using the same hand's current state before either lands). Expect: one succeeds, the other's client-side call throws `ConflictError`, `refetchHand()` runs, no error is shown to the losing caller — confirm via browser console that no uncaught error or visible error banner appears.
3. **Disconnect mid-hand.** With a hand active and it your turn, turn off wifi (or use browser devtools' network throttling set to "Offline") for over `turnSeconds` (30s) plus the cron's up-to-60s window. Reconnect. Expect: the turn was played by a duppy server-side (confirm via `expire-turns` logs or by checking `hand_public.move_log` grew), and reloading the page lands you back at the live table via the rejoin check in Task 7 Step 2, not back at the lobby.
4. **Background on iOS.** On a real iPhone (not simulator — `.claude/rules/pwa.md` and this session's own testing both confirm the simulator does not reproduce this), open a live table in Safari, background the tab for at least two minutes, then foreground it. Expect: the board reflects any moves that happened while backgrounded, within a few seconds of foregrounding — this proves the `visibilitychange` resubscribe actually recovered a silently-dead WebSocket rather than leaving the view stale.
5. **Portrait, 390×844 first.** Per the spec's scope decision, portrait mobile is the primary target, not a later polish pass. Resize the browser (or use devtools' device toolbar) to exactly 390×844 and run the happy-path scenario (#1) at that size specifically, both for the open-tables/config panel and the live table itself — tiles, the score track, the seat roster, and the pass-the-pose buttons all need to be reachable and readable without horizontal scrolling. Only after this passes, spot-check one wider size (e.g. 768×1024) to confirm nothing broke going up.

Record the outcome of all five before calling this task done. If any fail, fix before moving on — this task's deliverable is "online play works," not "the code compiles."

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/loungeview.ts
git commit -m "feat: wire online tables into lounges — open-tables list, join by code, rejoin on load"
```

---

## Task 8: Leave a seat mid-game (gap #5)

**Why this is its own task:** the existing "Leave" button in `liveTableView` (Task 6) only calls `game.leave()`, which is purely client-side unsubscribe — it never frees the seat, converts it to a duppy, or records an abandon. There is currently no server path for a seated player to vacate at all. Without this, a player who leaves mid-set silently strands their partner/opponents with a seat that never acts and never times out into a duppy the normal way, because `duppy_level` was never set on it.

**Files:**
- Create: `supabase/functions/leave-seat/index.ts`
- Modify: `supabase/config.toml`
- Modify: `apps/web/src/online.ts` (add `leaveSeat`)
- Modify: `apps/web/src/onlinetable.ts` (add `OnlineGame.leaveSeat()`)
- Modify: `apps/web/src/onlinetableview.ts` (Leave button calls it when seated)

**Interfaces:**
- Produces: `POST /leave-seat { tableId } → { ok: true }`
- Produces (client): `leaveSeat(tableId: string): Promise<{ ok: true }>`
- Produces: `OnlineGame.leaveSeat(): Promise<void>` — calls the API, then `this.leave()` for local teardown.

- [ ] **Step 1: Write the Edge Function**

```ts
// supabase/functions/leave-seat/index.ts
//
// Waiting tables: the seat just opens back up for someone else to join.
// Playing tables: the seat becomes a duppy (so the existing duppy-turn
// looping already in start-hand/play-move/expire-turns picks it up with no
// further changes there) and the departing player's abandons count goes up.
// Score is untouched — it lives on `sets`, not per-seat, so anyone who later
// joins that vacated seat inherits the running score automatically.

import { handled, json, requireUser, serviceClient, HttpError } from '../_shared/lib.ts';

Deno.serve(handled(async (req) => {
  const user = await requireUser(req);
  const { tableId } = await req.json() as { tableId: string };
  const db = serviceClient();

  const { data: table } = await db.from('tables').select('*').eq('id', tableId).single();
  if (!table) throw new HttpError(404, 'no such table');

  const { data: seat } = await db.from('seats')
    .select('*').eq('table_id', tableId).eq('user_id', user.id).maybeSingle();
  if (!seat) throw new HttpError(403, 'you are not seated at this table');

  if (table.status === 'waiting') {
    await db.from('seats').update({ user_id: null, connected_at: null })
      .eq('table_id', tableId).eq('seat_index', seat.seat_index);
  } else {
    await db.from('seats').update({ user_id: null, duppy_level: 'yard' })
      .eq('table_id', tableId).eq('seat_index', seat.seat_index);
    const { data: profile } = await db.from('profiles').select('abandons').eq('id', user.id).single();
    await db.from('profiles').update({ abandons: (profile?.abandons ?? 0) + 1 }).eq('id', user.id);
  }

  return json({ ok: true });
}));
```

- [ ] **Step 2: Register in config.toml**

```toml
[functions.leave-seat]
verify_jwt = true
```

- [ ] **Step 3: Client call and `OnlineGame.leaveSeat()`**

In `apps/web/src/online.ts`:

```ts
export const leaveSeat = (tableId: string) =>
  call<{ ok: true }>('leave-seat', { tableId });
```

In `apps/web/src/onlinetable.ts`, on the `OnlineGame` class, add (import `leaveSeat as apiLeaveSeat` alongside the other `online.ts` imports at the top of the file):

```ts
  async leaveSeat(): Promise<void> {
    if (!this.isSpectator) {
      try { await apiLeaveSeat(this.table.id); } catch { /* seat may already be gone; proceed to teardown regardless */ }
    }
    this.leave();
  }
```

- [ ] **Step 4: Wire the Leave button**

In `apps/web/src/onlinetableview.ts`, in `liveTableView`, change the leave button's handler from calling `game.leave()` directly to calling the new method:

```ts
  leave.onclick = () => void (async () => { await game.leaveSeat(); onLeave(); })();
```

- [ ] **Step 5: Deploy**

Deploy `leave-seat` via the Supabase MCP `deploy_edge_function` tool, `verify_jwt: true`, same minimal bundle (`index.ts` + `../_shared/lib.ts` + `../_shared/engine/types.ts`).

- [ ] **Step 6: Typecheck and build**

```bash
npm run typecheck && npm run build
```

Expected: clean.

- [ ] **Step 7: Manual verification**

Seat two test users at a table, advance it to `playing` via `start-hand`. Call `leave-seat` for one of them via curl (same pattern as every other function test this session). Confirm:

```sql
select seat_index, user_id, duppy_level from public.seats where table_id = '<id>' order by seat_index;
select abandons from public.profiles where id = '<departing user id>';
```

Expected: that seat now has `user_id = null`, `duppy_level = 'yard'`; `abandons` incremented by exactly 1. Then confirm the game keeps moving: call `play-move` for whichever seat is actually on turn (human or otherwise) and verify the vacated seat's duppy plays automatically when its turn comes, via the existing duppy-loop in `play-move` — no new server logic needed there, this is confirming the existing loop correctly picks up the newly-set `duppy_level`.

Also verify the `waiting`-table case: create a fresh table, don't start a hand, call `leave-seat` for its creator, confirm that seat's `user_id` is `null` and `duppy_level` is still `null` (open for a new human to join, not converted).

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/leave-seat supabase/config.toml apps/web/src/online.ts apps/web/src/onlinetable.ts apps/web/src/onlinetableview.ts
git commit -m "feat: leave-seat — vacate to duppy mid-game, record abandonment, free an open seat"
```

---

## Task 9: Update project docs

**Files:**
- Modify: `docs/memory.md`
- Modify: `README.md` ("Still open" section)

- [ ] **Step 1: Update `memory.md`**

Move "Online play" from "Build phases" (in progress) to done, with a one-line note on what shipped and what's explicitly still deferred (rankings UI, per doc #1's own scope decision).

- [ ] **Step 2: Update README's "Still open" list**

Remove "Online lobby views (`online.ts` has the calls; the table view is local-only)" — it no longer applies. Leave the other three items (Drill UI, French mode, Belt 4-5 review) as-is; this plan doesn't touch them.

- [ ] **Step 3: Commit**

```bash
git add docs/memory.md README.md
git commit -m "docs: online play shipped — update memory and README"
```
