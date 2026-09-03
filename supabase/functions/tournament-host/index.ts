// POST /tournament-host  { action, ... }
//
// Everything a host does. One function rather than six, deliberately: every
// action shares the same gate — is the caller `profiles.is_host` — and six
// copies of a permission check is how one of them ends up missing. The gate is
// written once, at the top, and nothing below it runs until it passes.
//
// A host holds NO database privilege. `is_host` is a boolean this function
// reads under service_role; it appears in no grant and no RLS policy, and there
// is no Postgres role behind it. That is the narrow scoping the requirement
// asked for, and it is narrow by construction rather than by discipline.
//
// v1 is the tournament a human runs by hand. There is no bracket generator and
// no auto-advance: the host draws a round, the players play it, the host marks
// who is out, and the host draws the next round. The results already live in
// `sets`, so automating that later is cheap — and by then one real Sunday will
// have shown which assumptions were wrong.

import { handled, json, requireUser, serviceClient, HttpError } from '../_shared/lib.ts';
import { drawForTheme, type TournamentTheme } from '../_shared/tournament-queue.ts';
import { loadQueue, standingFor } from '../_shared/tournament.ts';
import { clockByName } from '../_shared/engine/clock.ts';

const MODES = ['cutthroat', 'partner', 'openhand'];
const FORMATS = ['sixlove', 'firstToSix', 'single', 'french'];
/** Mirrors CLOCKS in the engine, and the check constraint in 0015/0048. */
const CLOCKS = ['blitz', 'speed', 'yard', 'relaxed'];
/**
 * Mirrors `theme_is_known` in 0056 and `TournamentTheme` in tournament-queue.
 * Only themes whose seating is actually built belong here — a theme the draw
 * cannot seat is a host scheduling an event that seats nobody.
 */
const THEMES = ['open', 'battle_of_the_sexes'];

/**
 * The statuses a host may set on a signup by hand.
 *
 * `out` is how a round advances in v1 — the host marks the players who lost and
 * draws the next round from whoever is left. `disqualified` is the penalty, and
 * the difference between them is only that one is a result and the other is a
 * judgement; both remove a player from the queue.
 *
 * `signed_up` is here so a mistake is reversible. A host who marks the wrong
 * person out at nine on a Sunday morning must not need a database console.
 */
const HOST_SETTABLE = ['signed_up', 'out', 'disqualified'];

/** Fills a seat nobody has claimed yet, until a real player joins it. */
const PLACEHOLDER_DUPPY = 'yard';

Deno.serve(handled(async (req) => {
  const user = await requireUser(req);
  const body = await req.json() as Record<string, any>;
  const action = String(body.action ?? '');
  const db = serviceClient();

  // The gate. Read server-side, from the database, before anything else.
  const { data: me } = await db.from('profiles').select('is_host').eq('id', user.id).single();
  if (!me?.is_host) throw new HttpError(403, 'only a host can run a tournament');

  // ------------------------------------------------------------- create --
  if (action === 'create') {
    const mode = String(body.mode ?? 'cutthroat');
    const format = String(body.format ?? 'firstToSix');
    const seatCount = Number(body.seatCount ?? 4);
    if (!MODES.includes(mode)) throw new HttpError(422, 'unknown mode');
    if (!FORMATS.includes(format)) throw new HttpError(422, 'unknown format');
    if (![2, 3, 4].includes(seatCount)) throw new HttpError(422, 'seat count must be 2, 3 or 4');
    // Same rule create-table enforces: partner is inherently 2-vs-2, and
    // sideOf() would split three seats into a nonsensical 2-vs-1.
    if ((mode === 'partner' || mode === 'openhand') && seatCount !== 4) {
      throw new HttpError(422, 'partner needs exactly 4 seats');
    }
    if (!body.startsAt) throw new HttpError(422, 'a tournament needs a start time');

    const theme = String(body.theme ?? 'open');
    if (!THEMES.includes(theme)) throw new HttpError(422, `unknown theme: ${theme}`);
    // Battle of the sexes IS two against two. 0056 constrains this as well —
    // both, so neither a host nor a direct insert can schedule an event whose
    // draw could never seat a single table.
    if (theme === 'battle_of_the_sexes' && !(mode === 'partner' && seatCount === 4)) {
      throw new HttpError(422, 'battle of the sexes is a four-handed partner event');
    }

    const { data, error } = await db.from('tournaments').insert({
      name: String(body.name ?? '').trim(),
      mode,
      format,
      seat_count: seatCount,
      theme,
      // Named, not numeric — the server looks the seconds up when it opens the
      // tables, exactly as create-table does, so nobody can schedule a
      // ten-minute turn by posting a number.
      clock: CLOCKS.includes(String(body.clock)) ? String(body.clock) : 'yard',
      starts_at: body.startsAt,
      signups_open_at: body.signupsOpenAt ?? null,
      rounds: Number(body.rounds ?? 3),
      lounge_id: body.loungeId ?? null,
      host_id: user.id,
    }).select().single();
    if (error) throw new HttpError(422, error.message);
    return json({ ok: true, tournamentId: data.id });
  }

  // Everything below acts on an existing event.
  const tournamentId = body.tournamentId;
  if (!tournamentId) throw new HttpError(422, 'which tournament?');
  const { data: t } = await db.from('tournaments').select('*').eq('id', tournamentId).single();
  if (!t) throw new HttpError(404, 'no such tournament');

  // ------------------------------------------------------------- notice --
  // The intercom. A column, not a Realtime broadcast: broadcast is
  // peer-to-peer, so a patched client could put words in the host's mouth.
  if (action === 'notice') {
    const notice = body.notice === null || body.notice === ''
      ? null
      : String(body.notice).slice(0, 280);
    const { error } = await db.from('tournaments').update({ notice }).eq('id', t.id);
    if (error) throw new HttpError(500, error.message);
    return json({ ok: true, notice });
  }

  // ------------------------------------------------------ open / close --
  if (action === 'open' || action === 'close' || action === 'cancel') {
    const status = action === 'open' ? 'signups_open'
      : action === 'close' ? 'seating'
        : 'cancelled';
    const { error } = await db.from('tournaments').update({ status }).eq('id', t.id);
    if (error) throw new HttpError(500, error.message);
    return json({ ok: true, status });
  }

  // --------------------------------------------------------------- mark --
  if (action === 'mark') {
    const status = String(body.status ?? '');
    if (!HOST_SETTABLE.includes(status)) throw new HttpError(422, 'not a status a host sets');
    if (!body.userId) throw new HttpError(422, 'which player?');
    // Scoped to THIS event. Ratings in `profiles` are deliberately untouched —
    // "strip a player's runs" is ambiguous between a Sunday result and a
    // permanent record, and the smaller blast radius is right while that
    // question is open.
    //
    // `table_id` is cleared whichever way this goes. It means "the table you
    // are sitting at right now", so leaving it set on a player the host just
    // marked out points them at a table they are no longer in — and the client
    // reads exactly that field to decide whether to offer "Take your seat".
    // `round` is kept on out/disqualified because it records WHICH round they
    // went out in, which is worth having; only a return to the queue clears it.
    const { error } = await db.from('tournament_signups')
      .update({ status, table_id: null, ...(status === 'signed_up' ? { round: null } : {}) })
      .eq('tournament_id', t.id).eq('user_id', body.userId);
    if (error) throw new HttpError(500, error.message);
    return json({ ok: true });
  }

  // -------------------------------------------------------------- clear --
  // Un-draw a round.
  //
  // Without this the event can reach a state no host action can leave. The
  // `start` guard below refuses to draw while any table is 'waiting' or
  // 'playing', and NOTHING in this codebase ever writes 'abandoned' — a table
  // only becomes 'finished' when a set completes through play-move or
  // expire-turns, and expire-turns walks hands, so a table where no hand was
  // ever started is invisible to it.
  //
  // So a table nobody turned up to sits at 'waiting' for ever and blocks every
  // future draw with "a round is still running". No-shows are not an edge case
  // here — the substitutes line exists because they are expected. The same dead
  // end has a second entrance: the draw loop below is a sequence of separate
  // writes, so a failure partway leaves live tables behind and the retry hits
  // the same guard.
  //
  // Only 'waiting' tables are cleared. 'waiting' means start-hand was never
  // called, so nothing was played and nothing is lost. A 'playing' table has a
  // live hand and is expire-turns' business, not a host's — it force-plays an
  // abandoned hand to a real finish rather than voiding it.
  if (action === 'clear') {
    const { data: dead, error: findError } = await db.from('tables')
      .select('id').eq('tournament_id', t.id).eq('status', 'waiting');
    if (findError) throw new HttpError(500, findError.message);
    if (!dead?.length) throw new HttpError(409, 'no un-started tables to clear');

    const ids = dead.map((r: any) => r.id as string);

    // Players first. If the table update failed after this, the worst case is
    // players back in the queue and tables still marked dead — recoverable by
    // clearing again. The other order strands players pointing at a table that
    // no longer exists in any round.
    const { error: seatError } = await db.from('tournament_signups')
      .update({ status: 'signed_up', round: null, table_id: null })
      .eq('tournament_id', t.id).in('table_id', ids);
    if (seatError) throw new HttpError(500, seatError.message);

    const { error: tableError } = await db.from('tables')
      .update({ status: 'abandoned' }).in('id', ids);
    if (tableError) throw new HttpError(500, tableError.message);

    return json({ ok: true, cleared: ids.length });
  }

  // -------------------------------------------------------------- start --
  // Draw one round: order the queue, cut it into full tables of real people,
  // and open a table for each. Everyone past the cut is a substitute, which is
  // a benefit this app already sells rather than an overflow to apologise for.
  if (action === 'start') {
    // Drawing again while a round is still being played would open a second set
    // of tables for the same people and quietly split the event in half. The
    // host has to wait for the round to end — which in v1 means marking the
    // losers out — before the next draw.
    //
    // 'abandoned' is deliberately not in this list: that is what `clear` writes,
    // and the whole point of `clear` is to get a stuck event past this guard.
    const { data: live } = await db.from('tables').select('id, status')
      .eq('tournament_id', t.id).in('status', ['waiting', 'playing']).limit(1);
    if (live?.length) {
      // Two different problems wear the same 409, so say which one this is. A
      // table still 'waiting' was never started — nobody turned up, or nobody
      // pressed start — and waiting for it to finish on its own never happens.
      throw new HttpError(409, live[0].status === 'waiting'
        ? 'a table from the last round was never started — clear the round first'
        : 'a round is still being played — mark the players who are out first');
    }

    const ordered = await loadQueue(db, t.id);
    const { tables: draw, substitutes } = drawForTheme(
      ordered, t.seat_count, (t.theme ?? 'open') as TournamentTheme);

    if (draw.length === 0) {
      // Fewer entrants than one full table. Partner needs exactly four seats,
      // so three people is not a small tournament — it is not a tournament.
      throw new HttpError(409,
        `not enough players for a full table of ${t.seat_count}`);
    }

    // Which round this is. v1 has no auto-advance, so the round number simply
    // counts the draws the host has made: whoever is still in line after the
    // host marked the losers out is round N+1.
    //
    // Note that last round's SUBSTITUTES are still in line and will be drawn
    // into this one alongside the winners. That is deliberate rather than
    // overlooked — they turned up and never got a seat — but a host who wants a
    // pure winners' bracket marks them out too, which is one click each.
    const { data: rounds } = await db.from('tournament_signups')
      .select('round').eq('tournament_id', t.id).not('round', 'is', null)
      .order('round', { ascending: false }).limit(1);
    const roundNo = ((rounds?.[0]?.round as number | undefined) ?? 0) + 1;

    const clock = clockByName(t.clock);
    const opened: { tableId: string; joinCode: string; players: string[] }[] = [];

    for (const group of draw) {
      const { data: code } = await db.rpc('generate_join_code');
      const { data: table, error } = await db.from('tables').insert({
        join_code: code,
        mode: t.mode,
        format: t.format,
        seat_count: t.seat_count,
        turn_seconds: clock.base,
        turn_cap_seconds: clock.cap,
        one_all_play_two: true,
        use_boneyard: false,
        is_private: false,
        lounge_id: t.lounge_id,
        created_by: user.id,
        tournament_id: t.id,
        round_no: roundNo,
      }).select().single();
      if (error) throw new HttpError(500, error.message);

      // Every seat starts as a placeholder duppy, and the drawn players
      // displace them by calling `join-table` themselves — the ordinary path,
      // which naturally proves they turned up. A seat cannot be empty: the
      // `seat_is_person_or_duppy` check from 0001 forbids a row that is neither.
      //
      // Auto-seating an absent player would be worse than not seating them: the
      // table would wait on somebody who is not at their phone. A no-show seat
      // stays claimable, which is what the substitutes line is for.
      const seats = [];
      for (let i = 0; i < t.seat_count; i++) {
        seats.push({
          table_id: table.id, seat_index: i,
          user_id: null, duppy_level: PLACEHOLDER_DUPPY,
        });
      }
      const { error: seatsError } = await db.from('seats').insert(seats);
      // create-table swallows this error — a known open thread in
      // docs/memory.md. It must not be swallowed here: a half-seated table is a
      // round that nobody can play.
      if (seatsError) {
        await db.from('tables').delete().eq('id', table.id);
        throw new HttpError(500, seatsError.message);
      }

      await db.from('tournament_signups')
        .update({ status: 'seated', round: roundNo, table_id: table.id })
        .eq('tournament_id', t.id).in('user_id', group);

      opened.push({ tableId: table.id, joinCode: table.join_code, players: group });
    }

    if (substitutes.length) {
      await db.from('tournament_signups')
        .update({ status: 'substitute', round: roundNo, table_id: null })
        .eq('tournament_id', t.id).in('user_id', substitutes);
    }

    await db.from('tournaments').update({ status: 'running' }).eq('id', t.id);
    return json({ ok: true, round: roundNo, tables: opened, substitutes });
  }

  // -------------------------------------------------------------- finish --
  if (action === 'finish') {
    const { error } = await db.from('tournaments')
      .update({ status: 'finished' }).eq('id', t.id);
    if (error) throw new HttpError(500, error.message);
    return json({ ok: true });
  }

  // -------------------------------------------------------------- queue --
  // What the host sees: the ordered list with the cut line already drawn.
  if (action === 'queue') {
    const ordered = await loadQueue(db, t.id);
    const { tables: draw, substitutes } = drawForTheme(
      ordered, t.seat_count, (t.theme ?? 'open') as TournamentTheme);
    const seatedIds = new Set(draw.flat());
    return json({
      ok: true,
      // Membership of the drawn set, not the first N of the queue — a themed
      // draw seats by side, so those are different lists (see standingFor).
      queue: ordered.map((p, i) => ({
        userId: p.userId, username: p.username, tier: p.tier,
        signedUpAt: p.signedUpAt, status: p.status,
        round: p.round, tableId: p.tableId,
        position: i + 1,
        aboveCut: seatedIds.has(p.userId),
      })),
      wouldSeat: seatedIds.size,
      substitutes: substitutes.length,
      standing: standingFor(ordered, t.seat_count, user.id, Date.now(),
        (t.theme ?? 'open') as TournamentTheme),
    });
  }

  throw new HttpError(422, `unknown action ${action}`);
}));
