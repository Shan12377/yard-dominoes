/**
 * The tournament banner, the queue position, and the host's controls.
 *
 * A section of the lounge list rather than a sixth nav tab, and rendered above
 * the lounge cards. Two reasons: the Lounges tab is already where a signed-in
 * player goes looking for a game, and the tournament itself is played in an
 * ordinary lounge (seeded by 0015) — so a separate tab would advertise a room
 * that already has a door.
 *
 * It takes `onJoinTable` rather than importing it: `loungeview.ts` owns the
 * live game and the Realtime channel, and a view importing another view is a
 * circular import. Same shape as `openTablesPanel`.
 *
 * **Nothing here decides anything.** Position, VIPs-ahead and the cut line all
 * arrive from the server. `apps/web` cannot import
 * `supabase/functions/_shared/tournament-queue.ts`, so any sorting in this file
 * would be a second copy of the rule VIP is sold on — free to drift from the
 * one that actually seats people.
 */

import { el } from './render.ts';
import { tickInterval, untilLabel } from './countdown.ts';
import {
  cancelTournament, clearRound, createTournament, drawRound, enterTournament, finishTournament,
  hostQueue, hostableTournaments, markPlayer, myStanding, nextTournament,
  setNotice, setSignups, withdrawFromTournament,
  THEME_LABEL,
} from './tournaments.ts';
import { joinTableById } from './online.ts';
import type { QueueRow, Standing, Tournament, TournamentTheme } from './tournaments.ts';
import type { MyProfile } from './lounges.ts';
import type { GameMode } from '@yard/engine';

interface State {
  tournament: Tournament | null;
  standing: Standing | null;
  /** Host view of the whole queue. Only ever populated for a host. */
  queue: QueueRow[] | null;
  wouldSeat: number;
  loaded: boolean;
  busy: boolean;
  error: string | null;
  hostOpen: boolean;
  /**
   * The partner name being typed for a couples event. Module state, not DOM
   * state: the countdown re-renders this panel every second, and an input
   * rebuilt mid-word would lose what somebody was typing. Same reason the
   * chat draft lives outside the DOM — see .claude/rules/client.md.
   */
  partnerDraft: string;
  /** Caret inside partnerDraft, restored with it. */
  partnerCaret: number;
  /** Chosen side for a team_vs_team sign-up, before it is submitted. */
  teamDraft: 'a' | 'b' | null;
  /**
   * Team names being typed on the host's "Schedule another" form. This panel
   * rebuilds on the same countdown tick as everything else here (as often as
   * once a second near another event's start time), so these need the same
   * outside-the-DOM treatment as partnerDraft above.
   */
  newTeamAName: string;
  newTeamACaret: number;
  newTeamBName: string;
  newTeamBCaret: number;
  // The rest of "Schedule another" has the exact same problem and had it
  // before team_vs_team existed — a select's `.value` gets silently reset to
  // its first option on every rebuild too, which is a worse loss than a lost
  // caret position: the host picked a mode or theme, a tick fires, and it is
  // quietly back to "Open to all" with no signal anything changed.
  newName: string;
  newNameCaret: number;
  newStarts: string;
  newMode: GameMode;
  newTheme: TournamentTheme;
}

const state: State = {
  tournament: null, standing: null, queue: null, wouldSeat: 0,
  loaded: false, busy: false, error: null, hostOpen: false, partnerDraft: '', partnerCaret: 0, teamDraft: null,
  newTeamAName: '', newTeamACaret: 0, newTeamBName: '', newTeamBCaret: 0,
  newName: '', newNameCaret: 0, newStarts: '', newMode: 'cutthroat', newTheme: 'open',
};

let timer: ReturnType<typeof setTimeout> | null = null;

/** Stop the countdown. Called when the lounge view goes away. */
export function stopTournamentClock(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}

/**
 * Load the next event and, if signed in, where this player stands in it.
 *
 * Failures are swallowed into `state.error` and never rethrown: a tournament
 * banner is decoration on a lounge list that has to work without it. Before the
 * migration is applied these queries 404, and the lounges must still open.
 */
export async function loadTournament(me: MyProfile | null): Promise<void> {
  try {
    state.tournament = await nextTournament();
    state.error = null;
    if (state.tournament && me) {
      state.standing = (await myStanding(state.tournament.id)).standing;
    } else {
      state.standing = null;
    }
  } catch (err) {
    state.tournament = null;
    state.standing = null;
    state.error = err instanceof Error ? err.message : null;
  } finally {
    state.loaded = true;
  }
}

/**
 * Redraw when the countdown label would actually change, and no sooner.
 *
 * Once the host is drawing tables or a round is running, this also re-reads the
 * event every fifteen seconds. Without it, "Take your seat" would never appear:
 * the host draws the tables on her screen and the player's banner would sit on
 * "the host is drawing the tables" until they thought to reload the page.
 *
 * A poll rather than a Realtime subscription on purpose. `tournaments` and
 * `tournament_signups` are published (0015) so the upgrade is there when it is
 * wanted, but a second channel lifecycle to get wrong — subscribe, resubscribe
 * on iOS wake, tear down on leave — is not worth it for a banner, and this
 * timer already exists and is already stopped when the view goes away.
 */
function scheduleTick(t: Tournament, me: MyProfile | null, rerender: () => void): void {
  stopTournamentClock();
  const live = t.status === 'seating' || t.status === 'running';
  const every = live ? 15_000 : tickInterval(t.startsAt, Date.now());
  if (every === null) return;
  timer = setTimeout(() => {
    if (live) void loadTournament(me).then(rerender, rerender);
    else rerender();
  }, every);
}

async function run(action: () => Promise<unknown>, me: MyProfile | null, rerender: () => void) {
  if (state.busy) return;
  state.busy = true;
  state.error = null;
  rerender();
  try {
    await action();
    await loadTournament(me);
    if (state.hostOpen && state.tournament) await loadHostQueue();
  } catch (err) {
    state.error = err instanceof Error ? err.message : 'that did not work';
  } finally {
    state.busy = false;
    rerender();
  }
}

async function loadHostQueue(): Promise<void> {
  if (!state.tournament) return;
  const reply = await hostQueue(state.tournament.id);
  state.queue = reply.queue;
  state.wouldSeat = reply.wouldSeat;
}

/** "Sunday 2 August, 5:00 pm" — the date said the way somebody would say it. */
function whenLabel(startsAt: string): string {
  const d = new Date(startsAt);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString([], {
    weekday: 'long', day: 'numeric', month: 'long',
    hour: 'numeric', minute: '2-digit',
  });
}

/**
 * The banner.
 *
 * The requirement said "flashing". It renders as a slow pulse instead, and
 * static for anyone who has asked for reduced motion: more than three flashes a
 * second is a seizure risk and fails WCAG 2.3.1. "Flashing" here means *make it
 * impossible to miss*, and a bold banner at the top of the page does that
 * without the hazard.
 */
export function tournamentPanel(
  me: MyProfile | null,
  onJoinTable: (tableId: string) => void,
  rerender: () => void,
): HTMLElement | null {
  const t = state.tournament;
  if (!t) {
    // Nothing on the calendar is the common case for a brand-new lounge, and
    // a host still needs a way to schedule the very first event — newEventForm
    // already handles t === null (only the "Repeat" button needs a real one),
    // it was simply unreachable while this whole panel required an existing
    // tournament just to render. Found live 2026-09-04: a real host, freshly
    // granted is_host, had no path to create anything at all.
    if (!me?.isHost) return null;
    const panel = el('div', 'panel tourney');
    panel.append(el('div', 'eyebrow', 'Tournament'));
    panel.append(el('h2', undefined, 'Nothing on the calendar'));
    panel.append(el('p', 'muted small', 'Schedule the next one below.'));
    if (state.error) panel.append(el('div', 'banner', state.error));
    panel.append(newEventForm(me, null, rerender));
    return panel;
  }

  scheduleTick(t, me, rerender);

  const panel = el('div', 'panel tourney');
  panel.append(el('div', 'eyebrow', 'Tournament'));
  panel.append(el('h2', undefined, t.name));

  // What kind of event this is, said before the countdown — somebody deciding
  // whether to sign up needs to know it is women against men BEFORE they
  // commit, not when the draw refuses them.
  if (t.theme !== 'open') {
    const label = t.theme === 'team_vs_team' && t.teamAName && t.teamBName
      ? `${t.teamAName} vs ${t.teamBName}`
      : THEME_LABEL[t.theme];
    panel.append(el('div', 'tourney-theme', label));
  }

  const when = el('div', 'tourney-when');
  when.append(el('span', undefined, whenLabel(t.startsAt)));
  when.append(el('span', 'tourney-countdown', untilLabel(t.startsAt, Date.now())));
  panel.append(when);

  // The intercom. A column the host writes and everybody reads — not a
  // broadcast, which a patched client could forge in her name.
  if (t.notice) panel.append(el('div', 'tourney-notice', t.notice));

  if (state.error) panel.append(el('div', 'banner', state.error));

  panel.append(body(t, me, onJoinTable, rerender));

  if (me?.isHost) panel.append(hostControls(t, me, rerender));
  return panel;
}

function body(
  t: Tournament,
  me: MyProfile | null,
  onJoinTable: (tableId: string) => void,
  rerender: () => void,
): HTMLElement {
  const wrap = el('div', 'tourney-body');

  if (!me) {
    wrap.append(el('p', 'muted', 'Sign in to take a place in the queue.'));
    return wrap;
  }

  const standing = state.standing;
  const entered = standing?.position !== null && standing?.position !== undefined;

  if (t.status === 'announced') {
    wrap.append(el('p', 'muted', 'Sign-ups open shortly. The countdown is running.'));
    return wrap;
  }

  if (t.status === 'signups_open' && !entered) {
    wrap.append(el('p', undefined,
      'Enter now. VIPs are seated first, then everybody else in the order they '
      + 'signed up — so the earlier you are in, the better your place.'));
    // A couples event is entered two by two, so the partner is named here.
    // Held in module state like every other in-progress input, because
    // render() rebuilds this panel whenever the countdown ticks — see
    // .claude/rules/client.md.
    let partnerField: HTMLInputElement | null = null;
    if (t.theme === 'couples') {
      wrap.append(el('p', 'muted small',
        'Name who you are entering with. You are only seated together once they '
        + 'enter and name you back.'));
      partnerField = document.createElement('input');
      partnerField.className = 'field';
      partnerField.placeholder = "Your partner's name";
      partnerField.maxLength = 24;
      partnerField.value = state.partnerDraft;
      partnerField.setAttribute('aria-label', 'Partner name');
      partnerField.oninput = () => {
        state.partnerDraft = partnerField!.value;
        state.partnerCaret = partnerField!.selectionStart ?? state.partnerDraft.length;
      };
      // This panel rebuilds every second while the countdown runs, so without
      // restoring focus and caret the field would drop out from under whoever
      // is typing in it, once a second. Only when they had already started —
      // otherwise opening the tab would steal focus. Same pattern as the chat
      // draft in loungeview.ts.
      if (state.partnerDraft) {
        const field = partnerField;
        requestAnimationFrame(() => {
          field.focus();
          field.setSelectionRange(state.partnerCaret, state.partnerCaret);
        });
      }
      wrap.append(partnerField);
    }

    // A team-vs-team event needs a side. No focus/caret concerns like the
    // text fields above — it is a two-way choice, same pattern as the
    // rankings tab toggle.
    if (t.theme === 'team_vs_team') {
      wrap.append(el('p', 'muted small', 'Pick your side.'));
      const choices = el('div', 'choices');
      for (const [value, label] of [
        ['a', t.teamAName ?? 'Team A'], ['b', t.teamBName ?? 'Team B'],
      ] as const) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'choice';
        btn.textContent = label;
        btn.setAttribute('aria-pressed', String(state.teamDraft === value));
        btn.onclick = () => { state.teamDraft = value; rerender(); };
        choices.appendChild(btn);
      }
      wrap.append(choices);
    }

    const go = document.createElement('button');
    // `pulse` is a slow breath, and CSS turns it off entirely under
    // prefers-reduced-motion. See the note on tournamentPanel.
    go.className = 'act pulse';
    go.textContent = state.busy ? 'Signing you up…' : 'Sign up';
    go.disabled = state.busy;
    go.onclick = () => void run(async () => {
      const reply = await enterTournament(
        t.id, state.partnerDraft.trim() || undefined, state.teamDraft ?? undefined);
      state.partnerDraft = '';
      state.partnerCaret = 0;
      state.teamDraft = null;
      return reply;
    }, me, rerender);
    wrap.append(go);
    return wrap;
  }

  if (entered && standing) wrap.append(position(standing, t));

  if (t.status === 'signups_open' && entered) {
    const out = document.createElement('button');
    out.className = 'dismiss';
    out.textContent = 'Withdraw';
    out.disabled = state.busy;
    out.onclick = () => void run(() => withdrawFromTournament(t.id), me, rerender);
    wrap.append(out);
    return wrap;
  }

  if (t.status === 'seating') {
    wrap.append(el('p', 'muted', 'Sign-ups are closed. The host is drawing the tables.'));
    return wrap;
  }

  if (t.status === 'running' && standing?.status === 'seated' && standing.tableId) {
    const seat = document.createElement('button');
    seat.className = 'act pulse';
    seat.textContent = state.busy ? 'Sitting down…' : 'Take your seat';
    seat.disabled = state.busy;
    // Actually take the seat, through the ordinary `join-table` function —
    // which is also what proves the player turned up. Opening the table view
    // without joining first would put them at their own table as a SPECTATOR,
    // watching three duppies play the round they had qualified for.
    //
    // Auto-seating them at draw time would be worse still: the other three
    // would sit waiting on somebody who is not at their phone.
    seat.onclick = () => void run(async () => {
      await joinTableById(standing.tableId!);
      onJoinTable(standing.tableId!);
    }, me, rerender);
    wrap.append(seat);
    wrap.append(el('p', 'muted small',
      'Your table is open. Take the seat and the hand starts when all four are down.'));
    return wrap;
  }

  if (t.status === 'running' && standing?.status === 'substitute') {
    wrap.append(el('p', 'muted',
      'You are in the substitutes line. If somebody does not turn up you can '
      + 'take their seat — VIPs get first refusal.'));
    return wrap;
  }

  return wrap;
}

/** The sentence that sells VIP, and the only number a player really wants. */
function position(standing: Standing, t: Tournament): HTMLElement {
  const wrap = el('div', 'tourney-position');
  wrap.append(el('div', 'queue-number', `#${standing.position}`));

  const detail = el('div');
  detail.append(el('div', undefined, standing.vipsAhead === 0
    ? 'Nobody with VIP is ahead of you.'
    : standing.vipsAhead === 1
      ? 'One VIP is ahead of you.'
      : `${standing.vipsAhead} VIPs are ahead of you.`));
  detail.append(el('div', 'muted small',
    `${standing.total} signed up · tables of ${t.seatCount}`));
  // Honest about being provisional: it moves every time somebody signs up,
  // withdraws, or upgrades. It answers "would I get a seat if it started now",
  // which is the question somebody watching a countdown is actually asking.
  detail.append(el('div', 'muted small', standing.aboveCut
    ? 'You would get a seat if it started now.'
    : 'You would be in the substitutes line if it started now.'));
  wrap.append(detail);
  return wrap;
}

// ------------------------------------------------------------------ host ----
/**
 * The host's controls.
 *
 * Drawn only for `profiles.is_host`, and that is a rendering decision, not a
 * permission: every button below calls an Edge Function that re-reads the
 * column server-side. A patched client that flips the flag gets a panel of
 * buttons that all answer 403.
 */
function hostControls(t: Tournament, me: MyProfile, rerender: () => void): HTMLElement {
  const wrap = el('div', 'tourney-host');

  const toggle = document.createElement('button');
  toggle.className = 'act ghost small';
  toggle.textContent = state.hostOpen ? 'Hide host controls' : 'Host controls';
  toggle.onclick = () => {
    state.hostOpen = !state.hostOpen;
    // Redraw immediately so the panel opens/closes on the first tap — the
    // queue fetch below is a second, later redraw that fills the list in,
    // not the one that has to happen before anything moves. Without this,
    // nothing changed until loadHostQueue() resolved, so a second tap
    // during that gap flipped state.hostOpen back before the first tap's
    // own rerender ever landed. Reported directly, 2026-09-04: "I was
    // double tapping before it was selected."
    rerender();
    if (state.hostOpen) void loadHostQueue().then(rerender).catch(() => rerender());
  };
  wrap.append(toggle);
  if (!state.hostOpen) return wrap;

  // --- the intercom -------------------------------------------------------
  const noticeRow = el('div', 'row');
  const noticeField = document.createElement('input');
  noticeField.className = 'field';
  noticeField.placeholder = 'Round 2 starts in five minutes';
  noticeField.maxLength = 280;
  noticeField.value = t.notice ?? '';
  noticeField.setAttribute('aria-label', 'Notice to everyone');
  const say = document.createElement('button');
  say.className = 'act ghost';
  say.textContent = 'Say it';
  say.onclick = () => void run(() => setNotice(t.id, noticeField.value.trim() || null), me, rerender);
  noticeRow.append(noticeField, say);
  wrap.append(el('label', 'field-label', 'Intercom'), noticeRow);

  // --- the event itself ---------------------------------------------------
  const controls = el('div', 'row');
  const button = (label: string, fn: () => Promise<unknown>) => {
    const b = document.createElement('button');
    b.className = 'act ghost small';
    b.textContent = label;
    b.disabled = state.busy;
    b.onclick = () => void run(fn, me, rerender);
    return b;
  };
  if (t.status === 'announced') controls.append(button('Open sign-ups', () => setSignups(t.id, true)));
  if (t.status === 'signups_open') controls.append(button('Close sign-ups', () => setSignups(t.id, false)));
  if (t.status === 'seating' || t.status === 'running') {
    controls.append(button('Draw the tables', () => drawRound(t.id)));
    // Sits beside Draw on purpose. The 409 a host hits when a no-show table
    // blocks the next round names this button, and it should be under their
    // thumb when they read that, not somewhere they have to go looking.
    controls.append(button('Clear un-started tables', () => clearRound(t.id)));
  }
  if (t.status === 'running') controls.append(button('Finish', () => finishTournament(t.id)));
  controls.append(button('Cancel', () => cancelTournament(t.id)));
  wrap.append(controls);

  // --- the queue, with the cut line drawn --------------------------------
  if (state.queue) {
    wrap.append(el('div', 'eyebrow',
      `Queue — ${state.queue.length}, seating ${state.wouldSeat}`));
    const list = el('div', 'tourney-queue');
    for (const row of state.queue) {
      const line = el('div', 'queue-row' + (row.aboveCut ? '' : ' below-cut'));
      line.append(el('span', 'queue-pos', `${row.position}`));
      line.append(el('span', undefined, row.username));
      if (row.tier !== 'guest') line.append(el('span', `badge ${row.tier}`, row.tier));
      line.append(el('span', 'muted small', row.status.replace('_', ' ')));
      // "Out" is how a round advances in v1: mark whoever lost, then draw the
      // next round. "DQ" is the penalty and strips this event only — ratings
      // are deliberately untouched.
      const out = document.createElement('button');
      out.className = 'act ghost small';
      out.textContent = row.status === 'out' ? 'Back in' : 'Out';
      out.disabled = state.busy;
      out.onclick = () => void run(
        () => markPlayer(t.id, row.userId, row.status === 'out' ? 'signed_up' : 'out'),
        me, rerender);
      const dq = document.createElement('button');
      dq.className = 'dismiss small';
      dq.textContent = 'DQ';
      dq.disabled = state.busy;
      dq.onclick = () => void run(() => markPlayer(t.id, row.userId, 'disqualified'), me, rerender);
      line.append(out, dq);
      list.append(line);
    }
    wrap.append(list);
  }

  wrap.append(newEventForm(me, t, rerender));
  return wrap;
}

/**
 * Schedule next Sunday. Deliberately a form and not a recurrence scheduler —
 * a host filling this in weekly is thirty seconds and no code, and `pg_cron` is
 * already there (0005) if it ever becomes tedious.
 */
/** "2026-12-08T17:00" — what a `datetime-local` input's `.value` needs, in
 *  the browser's own local time, not UTC. `toISOString()` would silently
 *  shift the clock by the viewer's offset. */
function localDateTimeValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    + `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Fill the draft from an existing event, one week later — the whole of
 *  "Repeat next Sunday". Nothing is submitted; the host still reviews and
 *  confirms via the ordinary Schedule button, free to change anything that
 *  is different this time. */
function prefillFromTournament(t: Tournament): void {
  state.newName = t.name;
  state.newNameCaret = state.newName.length;
  state.newStarts = localDateTimeValue(new Date(Date.parse(t.startsAt) + 7 * 24 * 60 * 60 * 1000));
  state.newMode = t.mode;
  state.newTheme = t.theme;
  state.newTeamAName = t.teamAName ?? '';
  state.newTeamACaret = state.newTeamAName.length;
  state.newTeamBName = t.teamBName ?? '';
  state.newTeamBCaret = state.newTeamBName.length;
}

function newEventForm(me: MyProfile, t: Tournament | null, rerender: () => void): HTMLElement {
  const form = el('div', 'tourney-new');
  form.append(el('div', 'eyebrow', 'Schedule another'));

  if (t) {
    const repeat = document.createElement('button');
    repeat.type = 'button';
    repeat.className = 'linky';
    repeat.textContent = `Repeat "${t.name}" next week`;
    repeat.onclick = () => { prefillFromTournament(t); rerender(); };
    form.append(repeat);
  }

  // Every field below rebuilds from scratch on the countdown tick this panel
  // already runs on — as often as once a second near another event's start
  // time (scheduleTick) — so each one reads its value from `state` and writes
  // straight back on every change. Without that, the Repeat button above
  // would appear to work and then silently un-fill itself the moment a tick
  // fired, and a host who was mid-select on the mode/theme dropdowns would
  // find them reset to the first option with no signal anything happened.
  const name = document.createElement('input');
  name.className = 'field';
  name.placeholder = 'Sunday Six Love';
  name.maxLength = 80;
  name.setAttribute('aria-label', 'Tournament name');
  name.value = state.newName;
  name.oninput = () => {
    state.newName = name.value;
    state.newNameCaret = name.selectionStart ?? state.newName.length;
  };

  const starts = document.createElement('input');
  starts.type = 'datetime-local';
  starts.className = 'field';
  starts.setAttribute('aria-label', 'Start time');
  starts.value = state.newStarts;
  starts.oninput = () => { state.newStarts = starts.value; };

  const mode = document.createElement('select');
  mode.innerHTML = '<option value="cutthroat">Cut throat</option>'
    + '<option value="partner">Partner — 2 v 2</option>'
    + '<option value="openhand">Open hand — partner sees your tiles</option>';
  mode.value = state.newMode;
  mode.onchange = () => { state.newMode = mode.value as GameMode; };

  // Battle of the sexes is two-against-two, so picking it settles the mode as
  // well — the server and 0056 both refuse it on anything but a four-handed
  // partner table, and offering a combination that would be rejected is a
  // worse form than one that decides for you.
  const theme = document.createElement('select');
  theme.innerHTML = '<option value="open">Open to all</option>'
    + '<option value="battle_of_the_sexes">Battle of the sexes — women v men</option>'
    + '<option value="couples">Couple\'s tourney — pairs</option>'
    + '<option value="team_vs_team">Team vs team</option>';
  theme.setAttribute('aria-label', 'Kind of event');
  theme.value = state.newTheme;

  // Only team_vs_team needs these, and they need the same focus/caret
  // treatment as the sign-up panel's partner field — see State's comment.
  const teamAField = document.createElement('input');
  teamAField.className = 'field';
  teamAField.placeholder = 'Team A name';
  teamAField.maxLength = 40;
  teamAField.hidden = state.newTheme !== 'team_vs_team';
  teamAField.setAttribute('aria-label', 'Team A name');
  teamAField.value = state.newTeamAName;
  teamAField.oninput = () => {
    state.newTeamAName = teamAField.value;
    state.newTeamACaret = teamAField.selectionStart ?? state.newTeamAName.length;
  };
  const teamBField = document.createElement('input');
  teamBField.className = 'field';
  teamBField.placeholder = 'Team B name';
  teamBField.maxLength = 40;
  teamBField.hidden = state.newTheme !== 'team_vs_team';
  teamBField.setAttribute('aria-label', 'Team B name');
  teamBField.value = state.newTeamBName;
  teamBField.oninput = () => {
    state.newTeamBName = teamBField.value;
    state.newTeamBCaret = teamBField.selectionStart ?? state.newTeamBName.length;
  };
  for (const [field, draft, caret] of [
    [name, state.newName, state.newNameCaret],
    [teamAField, state.newTeamAName, state.newTeamACaret],
    [teamBField, state.newTeamBName, state.newTeamBCaret],
  ] as const) {
    if (draft) {
      requestAnimationFrame(() => {
        field.focus();
        field.setSelectionRange(caret, caret);
      });
    }
  }

  theme.onchange = () => {
    state.newTheme = theme.value as TournamentTheme;
    // All three themes seat partners opposite each other, which only works at
    // a four-handed partner table — the server and 0056/0057/0059 refuse
    // anything else, so decide it here rather than offering a combination
    // that would be rejected.
    const paired = state.newTheme !== 'open';
    if (paired) { mode.value = 'partner'; state.newMode = 'partner'; }
    mode.disabled = paired;
    const teams = state.newTheme === 'team_vs_team';
    teamAField.hidden = !teams;
    teamBField.hidden = !teams;
  };
  mode.disabled = state.newTheme !== 'open';

  const row = el('div', 'row');
  row.append(name, starts, mode, theme);
  form.append(row);
  form.append(teamAField, teamBField);

  const go = document.createElement('button');
  go.className = 'act ghost small';
  go.textContent = 'Schedule';
  go.disabled = state.busy;
  go.onclick = () => void run(async () => {
    if (!starts.value) throw new Error('A tournament needs a start time');
    // Both paired modes (partner, openhand) default to sixlove and take four
    // seats. Openhand also uses sideOf() with 2-vs-2 pairing — see
    // `isPartnered` in the engine.
    const paired = mode.value === 'partner' || mode.value === 'openhand';
    await createTournament({
      name: name.value.trim() || 'Sunday tournament',
      mode: mode.value as GameMode,
      // Cut throat six love runs to a median of ~196 hands, so a round would
      // still be going on Tuesday. Never default a bracket to it.
      format: paired ? 'sixlove' : 'firstToSix',
      seatCount: 4,
      theme: theme.value as TournamentTheme,
      teamAName: theme.value === 'team_vs_team' ? state.newTeamAName.trim() : undefined,
      teamBName: theme.value === 'team_vs_team' ? state.newTeamBName.trim() : undefined,
      clock: 'yard',
      startsAt: new Date(starts.value).toISOString(),
      loungeId: state.tournament?.loungeId ?? null,
    });
    state.newName = ''; state.newNameCaret = 0;
    state.newStarts = ''; state.newMode = 'cutthroat'; state.newTheme = 'open';
    state.newTeamAName = ''; state.newTeamACaret = 0;
    state.newTeamBName = ''; state.newTeamBCaret = 0;
    // A newly scheduled event is usually later than the one on screen, so it
    // will not become `nextTournament()` — say so rather than looking inert.
    const all = await hostableTournaments();
    state.error = `Scheduled. ${all.length} event${all.length === 1 ? '' : 's'} on the calendar.`;
  }, me, rerender);
  form.append(go);
  return form;
}
