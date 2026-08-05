// POST /french-reshuffle  { tableId }
//
// French's paid mid-hand reshuffle — 2 coins, once per set, only available
// while your own running score sits between 50 and 70. No boneyard exists
// in 4-player French (all 28 tiles are always somebody's), so there is no
// spare pile to draw fresh tiles from: the only honest way to give you new
// ones is to pool every seat's still-unplayed tiles and redeal a fresh
// hand-sized set to you from that pool, handing the rest back to the other
// three in the same sizes they already held. Their hands change as a side
// effect; only you were told why. Deterministic from the hand's own
// already-committed serverSeed, so it is provable once that seed is
// revealed at hand end — the same trust mechanism as the deal itself, not
// a new one.

import { handled, json, requireUser, serviceClient, persist, toState, Conflict, HttpError } from '../_shared/lib.ts';
import { shufflePool } from '../_shared/engine/shuffle.ts';

Deno.serve(handled(async (req) => {
  const user = await requireUser(req);
  const { tableId } = await req.json();
  const db = serviceClient();

  const { data: table } = await db.from('tables').select('*').eq('id', tableId).single();
  if (!table) throw new HttpError(404, 'no such table');
  if (table.format !== 'french') throw new HttpError(422, 'the reshuffle is a French table only');

  const { data: seats } = await db.from('seats').select('*').eq('table_id', tableId).order('seat_index');
  const seatUsers: (string | null)[] = seats!.map((s: any) => s.user_id);
  const mySeat = seatUsers.indexOf(user.id);
  if (mySeat < 0) throw new HttpError(403, 'you are not seated here');

  const { data: set } = await db.from('sets')
    .select('*').eq('table_id', tableId).is('winner_side', null)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!set) throw new HttpError(409, 'no set in progress');

  const score = set.scores[mySeat] ?? 0;
  if (score < 50 || score > 70) {
    throw new HttpError(409, 'the reshuffle only shows up while your score sits between 50 and 70');
  }

  const { data: row } = await db.from('hands').select('*')
    .eq('set_id', set.id).eq('status', 'active').maybeSingle();
  if (!row) throw new HttpError(409, 'no hand is being played right now');

  // Keyed on the SET, not the hand — "once per player per set" means once,
  // however many hands the set runs. Doubling as the idempotency key: a
  // retried request or a second click never charges twice.
  const reference = `french-reshuffle:${set.id}:${mySeat}`;
  const already = await db.from('coin_ledger').select('id')
    .eq('user_id', user.id).eq('kind', 'spend').eq('reference', reference).maybeSingle();
  if (already.data) throw new HttpError(409, 'you already reshuffled once this set');

  const { error: spendError } = await db.rpc('spend_coins', {
    p_user_id: user.id, p_amount: 2, p_kind: 'spend', p_reference: reference,
  });
  if (spendError) throw new HttpError(402, 'not enough coins');

  const state = toState(row, table.seat_count, table.mode, table.format);
  const sizes = state.hands.map((h) => h.length);
  const pool = state.hands.flat();
  const shuffled = await shufflePool(pool, {
    serverSeed: row.server_seed,
    clientSeeds: row.client_seeds,
    // Seat alone is enough to make this unique: a seat reshuffles at most
    // once per SET, so at most once across every hand that set ever plays.
    handId: `${row.id}:reshuffle:${mySeat}`,
  });

  const mine = shuffled.slice(0, sizes[mySeat]);
  let cursor = sizes[mySeat];
  const newHands: string[][] = [];
  for (let seat = 0; seat < table.seat_count; seat++) {
    if (seat === mySeat) { newHands.push(mine); continue; }
    newHands.push(shuffled.slice(cursor, cursor + sizes[seat]));
    cursor += sizes[seat];
  }

  try {
    // expiresOverride preserves the currently-running turn clock — this
    // isn't a move, so it must not hand whoever's on turn a free extra
    // turnSeconds.
    await persist(
      db, row.id, tableId, set.id, { ...state, hands: newHands }, seatUsers,
      table.turn_seconds, row.version, row.turn_expires_at,
    );
  } catch (err) {
    if (err instanceof Conflict) throw new HttpError(409, 'the hand moved on — try again');
    throw err;
  }

  return json({ ok: true });
}));
