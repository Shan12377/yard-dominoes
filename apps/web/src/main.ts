import {
  BELTS, lessonByRef, knownVoids, GRADE_LABEL, duppyLine, halves, TALK_CHANCE,
  EMPTY_LEAKS, recordHand, standoutLeak, describeLeak, isPartnered, sideOf,
} from '@yard/engine';
import type { LeakStore, TalkTrigger } from '@yard/engine';
import type { Board, DuppyLevel, GameMode, HandReview, Move, SetFormat } from '@yard/engine';
import { LocalGame } from './local.ts';
import { tileEl, renderBoard, backsEl, scoreTrack, el } from './render.ts';
import { boardAfter, encodeHand, handFromUrl, shareUrl } from './replay.ts';
import type { ReplayHand } from './replay.ts';
import { hasVoice, lineFor, muted, setMuted, speak } from './speak.ts';
import * as sfx from './sfx.ts';
import { applyFelt, FELTS, felt, setFelt } from './felt.ts';
import {
  platform, promptInstall, watchInstallability, registerServiceWorker,
  applyUpdate, updatePending, IOS_STEPS,
} from './pwa.ts';

import {
  ageGate, privacyView, socialAllowed, termsView, tooYoungView,
} from './legal.ts';

type View = 'play' | 'lounges' | 'academy' | 'membership' | 'fair' | 'replay'
  | 'terms' | 'privacy';

const app = document.getElementById('app')!;

/**
 * The lounge layer pulls in the Supabase client, which is bigger than the
 * entire rest of the app. Local play never touches it, so it loads on demand
 * the first time someone opens Lounges or Membership — the offline game stays
 * a small, fast download.
 */
type LoungeModule = typeof import('./loungeview.ts');
let loungeModule: LoungeModule | null = null;
let loungeLoading = false;
const LOUNGES_VISITED_KEY = 'yard:visited-lounges';

async function ensureLoungeModule(isBootCheck = false) {
  if (loungeModule || loungeLoading) return;
  loungeLoading = true;
  localStorage.setItem(LOUNGES_VISITED_KEY, '1');
  try {
    loungeModule = await import('./loungeview.ts');
    await loungeModule.loadLounges(render);
    // Only the automatic boot-time rejoin check gets to redirect the view —
    // an explicit tab click (Lounges or Membership) must land where the
    // player clicked, never get silently overridden once the async load
    // resolves and finds a live game.
    if (isBootCheck && loungeModule.loungeState.onlineGame) view = 'lounges';
  } finally {
    loungeLoading = false;
    render();
  }
}
let view: View = 'play';
let game: LocalGame | null = null;
let review: HandReview | null = null;
/** The coach is running. It solves positions, so it is not instant. */
let reviewPending = false;
/** The full move-by-move breakdown, opened from the summary. */
let reviewOpen = false;
let openBelt: string | null = null;
let openLesson: string | null = null;
let verifyState: { ok: boolean; reason?: string } | null = null;
let installDismissed = false;
/** The link for the hand just played, once it has been asked for. */
let shareLink: { url: string; copied: boolean } | null = null;

/**
 * What this player keeps getting wrong, across every hand they have played.
 * On device for now — it moves to the account when there is one, which is
 * why the folding logic lives in the engine and only storage lives here.
 */
const LEAKS_KEY = 'yard:leaks';

function loadLeaks(): LeakStore {
  try {
    const raw = localStorage.getItem(LEAKS_KEY);
    if (!raw) return EMPTY_LEAKS;
    const parsed = JSON.parse(raw) as LeakStore;
    // Storage is editable and survives upgrades, so never trust its shape.
    if (typeof parsed?.hands !== 'number' || !Array.isArray(parsed?.entries)) return EMPTY_LEAKS;
    return parsed;
  } catch {
    return EMPTY_LEAKS;
  }
}

let leaks: LeakStore = loadLeaks();

function saveLeaks(next: LeakStore) {
  leaks = next;
  try { localStorage.setItem(LEAKS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
}

/**
 * Install card. Shown above the lobby, never over a live hand.
 *
 * Android gets a real one-tap button. iOS gets the three taps written out,
 * because Safari has no install event and most people never find the option
 * on their own. iOS users in Chrome or Firefox get told to switch to Safari,
 * since those browsers cannot add to the home screen at all.
 */
function installCard(): HTMLElement | null {
  if (installDismissed) return null;
  const p = platform();
  if (p === 'installed' || p === 'unsupported') return null;

  const card = el('div', 'install-card door');
  card.append(el('div', 'eyebrow', 'Put it on your phone'));

  if (p === 'prompt') {
    card.append(el('h2', undefined, 'Install Beat Di Table'));
    card.append(el('p', 'muted',
      'Add it to your home screen — opens full screen, loads instantly, and works offline against the duppies.'));
    const b = document.createElement('button');
    b.className = 'act';
    b.textContent = 'Install';
    b.onclick = async () => {
      const accepted = await promptInstall();
      if (accepted) installDismissed = true;
      render();
    };
    card.appendChild(b);
  } else if (p === 'ios-safari') {
    card.append(el('h2', undefined, 'Add Beat Di Table to your home screen'));
    card.append(el('p', 'muted', 'Three taps, and it opens like any other app.'));
    const list = el('ul', 'steps');
    for (const step of IOS_STEPS) {
      const li = document.createElement('li');
      li.append(el('span', 'n', String(step.n)), el('span', undefined, step.text));
      list.appendChild(li);
    }
    card.appendChild(list);
  } else {
    card.append(el('h2', undefined, 'Open in Safari to install'));
    card.append(el('p', 'muted',
      'On iPhone, only Safari can add an app to the home screen. Open Beat Di Table in Safari, then tap Share and Add to Home Screen.'));
  }

  const skip = document.createElement('button');
  skip.className = 'dismiss';
  skip.textContent = 'Not now';
  skip.onclick = () => { installDismissed = true; render(); };
  card.appendChild(skip);
  return card;
}

/**
 * Update bar. A new build is never applied automatically — reloading someone
 * mid-hand would lose their game — so it waits until they are between hands.
 */
function updateBar(): HTMLElement | null {
  if (!updatePending()) return null;
  const midHand = game?.hand?.status === 'active';
  const bar = el('div', 'update-bar');
  bar.append(el('span', undefined,
    midHand ? 'A new version is ready — it will apply after this hand.' : 'A new version of Beat Di Table is ready.'));
  if (!midHand) {
    const b = document.createElement('button');
    b.className = 'act ghost';
    b.textContent = 'Reload now';
    b.onclick = () => applyUpdate();
    bar.appendChild(b);
  }
  return bar;
}

// ---------------------------------------------------------------- chrome --
function chrome(): HTMLElement {
  const bar = el('div', 'topbar');
  const brand = el('div', 'brand');
  const h1 = el('h1', undefined, 'Beat Di Table');
  const tag = el('span', 'eyebrow', 'Jamaican dominoes');
  brand.append(h1, tag);

  const nav = el('div', 'nav');
  const tabs = [
    ['play', 'Play'], ['lounges', 'Lounges'], ['academy', 'Academy'],
    ['membership', 'Membership'], ['fair', 'Fair deal'],
  ] as const;
  for (const [id, label] of tabs) {
    const b = document.createElement('button');
    b.textContent = label;
    b.setAttribute('aria-current', String(view === id));
    b.onclick = () => {
      if (view === 'lounges' && id !== 'lounges') loungeModule?.leaveCurrentLounge();
      // A duppy calling you slow from a screen you have left is a bug, not
      // atmosphere. The timer restarts from the next event when you come back.
      if (id !== 'play') stopNagging();
      view = id as View;
      if (id === 'lounges' || id === 'membership') void ensureLoungeModule();
      render();
    };
    nav.appendChild(b);
  }
  bar.append(brand, nav);
  return bar;
}

// ------------------------------------------------------------------ hero --
/**
 * A scripted line for the front door: pip-matched junctions, three crosswise
 * doubles, and enough length to snake a corner at hero width — the board
 * demonstrating itself before anyone taps a thing.
 */
const DEMO_BOARD: Board = {
  line: [
    { tile: '2-4', crosswise: false },
    { tile: '4-5', crosswise: false },
    { tile: '5-5', crosswise: true },
    { tile: '5-6', crosswise: false },
    { tile: '6-6', crosswise: true },
    { tile: '3-6', crosswise: false },
    { tile: '3-3', crosswise: true },
    { tile: '1-3', crosswise: false },
    { tile: '1-4', crosswise: false },
    { tile: '0-4', crosswise: false },
  ],
  leftEnd: 2,
  rightEnd: 0,
};

/**
 * What each duppy just said, by seat. A yard is loud, and a domino game in
 * silence is not the game — the incumbent's tables are silent. Lines live in
 * the engine (`talk.ts`) and are keyed to the duppy's level, so how an
 * opponent speaks tells you what you are up against.
 */
let talk = new Map<number, string>();

function say(seat: number, trigger: TalkTrigger, level: DuppyLevel, always = false) {
  const roll = Math.random();
  // A seat with a recorded voice says the recorded words, so the caption on
  // screen is exactly what is heard — and stays right with the sound off.
  const spoken = hasVoice(seat) ? lineFor(seat, trigger, roll) : null;
  if (spoken) speak(seat, trigger, roll);
  const line = spoken ?? duppyLine(level, trigger, roll, always ? 1 : TALK_CHANCE[level]);
  const next = new Map(talk);
  if (line) next.set(seat, line); else next.delete(seat);
  talk = next;
}

/**
 * How long the table will sit quietly before somebody says something. Long
 * enough that reading the board is not nagged at — a beginner counting what is
 * still out there needs those first seconds — and capped at two lines, because
 * a duppy that keeps going stops being a yard and becomes an alarm clock.
 */
const NAG_AFTER_MS = 14_000;
const NAG_AGAIN_MS = 16_000;
const NAG_LIMIT = 2;

let nagTimer = 0;

function stopNagging() {
  clearTimeout(nagTimer);
  nagTimer = 0;
}

/**
 * Every other line here is triggered by a move. This one is triggered by the
 * absence of one, so it needs its own timer — and local play has no turn clock
 * at all, which is exactly why it is worth having: it is the only pressure a
 * solo player ever feels.
 */
function nagLater(g: LocalGame, level: DuppyLevel, sent = 0) {
  stopNagging();
  if (!g.isMyTurn() || sent >= NAG_LIMIT) return;
  nagTimer = window.setTimeout(() => {
    if (!g.isMyTurn()) return;
    const others: number[] = [];
    for (let s = 0; s < g.options.seatCount; s++) if (s !== g.mySeat) others.push(s);
    // One seat speaks, not the whole table rounding on you at once.
    say(others[Math.floor(Math.random() * others.length)], 'waiting', level);
    render();
    nagLater(g, level, sent + 1);
  }, sent === 0 ? NAG_AFTER_MS : NAG_AGAIN_MS);
}

async function startGame(opts: {
  mode: GameMode; format: SetFormat; duppy: DuppyLevel; tournament: boolean;
}) {
  const g = new LocalGame({ ...opts, seatCount: 4, oneAllPlayTwo: true });
  game = g;
  talk = new Map();

  g.on((e) => {
    const level = opts.duppy;

    // Every tile knocks, mine included — the sound is bone hitting board, not
    // an opponent doing something to me. The talk below is what's theirs.
    if (e.type === 'played') sfx.play('knock');
    // Six love is the loudest thing that happens in this game and it ends the
    // set, so it gets its own sound rather than sharing the win line's.
    if (e.type === 'setOver' && g.set.sixLove) sfx.play('sixLove');

    if (e.type === 'passed' && e.seat !== g.mySeat) {
      say(e.seat, 'iPass', level);
    } else if (e.type === 'passed' && e.seat === g.mySeat) {
      // Your pass is the loudest thing you do — it proves what you don't
      // hold. Every duppy at the table gets to notice.
      for (let s = 0; s < g.options.seatCount; s++) {
        if (s !== g.mySeat) say(s, 'theyPass', level);
      }
    } else if (e.type === 'played' && e.seat !== g.mySeat) {
      // A line hangs in the air until that seat says something else, the way
      // it does at a real table. Clearing it on the next ordinary play meant
      // nobody ever saw one.
      const [a, b] = halves(e.tile);
      const left = g.hand?.hands[e.seat].length ?? 0;
      if (left === 1) say(e.seat, 'lastTile', level, true);
      else if (a === b) say(e.seat, 'slam', level);
    } else if (e.type === 'handOver') {
      // The coach is the reason to play here rather than anywhere else, so it
      // runs on every hand instead of waiting to be asked. It solves
      // positions — a few hundred milliseconds on a phone — so it is deferred
      // past this paint: the result lands immediately and the verdict fills
      // in a moment later, rather than the whole screen freezing first.
      reviewPending = true;
      reviewOpen = false;
      setTimeout(() => {
        review = g.review();
        if (review) saveLeaks(recordHand(leaks, review));
        reviewPending = false;
        render();
      }, 0);

      const r = g.hand?.result;
      // Nobody won a tied hand, so nobody gets to gloat or concede.
      for (let s = 0; s < g.options.seatCount; s++) {
        if (s === g.mySeat || !r || r.tie) continue;
        const won = r.winnerSide === sideOf(s, g.options.mode);
        const trigger: TalkTrigger = won
          ? (r.status === 'blocked' ? 'winCount' : 'win')
          : 'lose';
        say(s, trigger, level, true);
      }
    }

    // Restart the wait on every event: the turn either just became mine (start
    // counting) or just stopped being mine (stop). A hand that ended stops it
    // too, since isMyTurn() is false once the status leaves 'active'.
    nagLater(g, level);
    render();
  });

  review = null;
  reviewOpen = false;
  verifyState = null;
  shareLink = null;
  sfx.play('shuffle');
  await g.startHand();
  render();
}

function hero(): HTMLElement {
  const felt = el('div', 'table-felt hero');

  const copy = el('div', 'hero-copy');
  // "Yard and foreign" is deliberate and the partner asked for it: most of the
  // people who will pay for this are Jamaicans in London, New York and Toronto,
  // and a front door that speaks only to the island tells them it is not for
  // them. Same rules, same table, wherever the player is sitting.
  copy.append(el('div', 'eyebrow', 'Jamaican dominoes — yard and foreign'));
  copy.append(el('h2', undefined, 'Slam dem down.'));
  copy.append(el('p', undefined,
    'Doubles lie crosswise, the line snakes round the table, and six love ' +
    'bruks the score back to nothing. Yard rules from wherever you\'re ' +
    'playing — a deal you can verify, free.'));
  copy.append(el('p', 'hero-claim',
    'And when the hand is done, it shows you the move you missed.'));

  const row = el('div', 'row');
  const deal = document.createElement('button');
  deal.className = 'act';
  deal.textContent = 'Deal me in';
  deal.onclick = () => void startGame({
    mode: 'partner', format: 'sixlove', duppy: 'ranker', tournament: false,
  });
  const fair = document.createElement('button');
  fair.className = 'act ghost';
  fair.textContent = 'How the deal stays fair';
  fair.onclick = () => { view = 'fair'; render(); };
  row.append(deal, fair);
  copy.appendChild(row);

  const line = el('div', 'line demo');
  renderBoard(line, DEMO_BOARD, { maxUnits: 22, unit: 15 });

  felt.append(copy, line);
  return felt;
}

// ---------------------------------------------------------------- replay --
/**
 * A shared hand, replayed tile by tile.
 *
 * The link carries the whole hand, so this needs no account, no install and
 * no server — someone opens it from a message and watches the board build
 * itself on the real renderer. It is the argument-settler: this is what
 * actually happened, in order.
 */
let replayHand: ReplayHand | null = null;
let replayStep = 0;
let replayTimer = 0;

function stopReplay() {
  clearInterval(replayTimer);
  replayTimer = 0;
}

function playReplay() {
  stopReplay();
  replayTimer = window.setInterval(() => {
    if (!replayHand || replayStep >= replayHand.steps.length) { stopReplay(); render(); return; }
    replayStep++;
    render();
  }, 900);
}

function replayView(): HTMLElement {
  const frag = el('div');
  const r = replayHand!;
  const step = r.steps[replayStep - 1] ?? null;

  const head = el('div', 'panel');
  head.append(el('div', 'eyebrow', 'A hand from Beat Di Table'));
  head.append(el('h2', undefined, 'Watch it back'));
  head.append(el('p', 'muted',
    'Every tile, in the order it went down. Nobody\'s hand is in this link — ' +
    'only what the table already saw.'));
  frag.appendChild(head);

  const felt = el('div', 'table-felt');
  const line = el('div', 'line');
  renderBoard(line, boardAfter(r, replayStep));
  felt.appendChild(line);
  frag.appendChild(felt);

  const bar = el('div', 'panel');
  const caption = el('div', 'replay-caption');
  if (!step) {
    caption.textContent = 'Before the first tile.';
  } else if (step.kind === 'pass') {
    caption.textContent = `${seatName(r, step.seat)} passed.`;
  } else if (step.kind === 'draw') {
    caption.textContent = `${seatName(r, step.seat)} drew.`;
  } else {
    caption.textContent = `${seatName(r, step.seat)} ${step.kind === 'pose' ? 'posed' : 'played'} ${step.tile}.`;
  }
  bar.appendChild(caption);
  bar.append(el('div', 'muted', `Move ${replayStep} of ${r.steps.length}`));

  const controls = el('div', 'row');
  const back = document.createElement('button');
  back.className = 'act ghost';
  back.textContent = 'Back';
  back.disabled = replayStep === 0;
  back.onclick = () => { stopReplay(); replayStep = Math.max(0, replayStep - 1); render(); };

  const toggle = document.createElement('button');
  toggle.className = 'act';
  const atEnd = replayStep >= r.steps.length;
  toggle.textContent = replayTimer ? 'Pause' : atEnd ? 'Watch again' : 'Play';
  toggle.onclick = () => {
    if (replayTimer) { stopReplay(); render(); return; }
    if (replayStep >= r.steps.length) replayStep = 0;
    playReplay();
    render();
  };

  const fwd = document.createElement('button');
  fwd.className = 'act ghost';
  fwd.textContent = 'Forward';
  fwd.disabled = atEnd;
  fwd.onclick = () => { stopReplay(); replayStep = Math.min(r.steps.length, replayStep + 1); render(); };

  controls.append(back, toggle, fwd);
  bar.appendChild(controls);
  frag.appendChild(bar);

  const cta = el('div', 'panel door');
  cta.append(el('h2', undefined, 'Your turn.'));
  cta.append(el('p', 'muted',
    'Yard rules, a deal you can check, and a coach that tells you the move ' +
    'you missed. Free.'));
  const deal = document.createElement('button');
  deal.className = 'act';
  deal.textContent = 'Deal me in';
  deal.onclick = () => {
    stopReplay();
    replayHand = null;
    history.replaceState(null, '', location.pathname);
    view = 'play';
    void startGame({ mode: 'partner', format: 'sixlove', duppy: 'ranker', tournament: false });
  };
  cta.appendChild(deal);
  frag.appendChild(cta);
  return frag;
}

function seatName(r: ReplayHand, seat: number): string {
  if (seat === r.seat) return 'They';
  return `Seat ${seat + 1}`;
}

// ----------------------------------------------------------------- lobby --
function lobby(): HTMLElement {
  const panel = el('div', 'panel door');
  panel.append(
    el('div', 'eyebrow', 'Start a game'),
    el('h2', undefined, 'Sit down'),
  );

  const form = el('div', 'lobby-form');

  const mode = document.createElement('select');
  mode.innerHTML = `<option value="partner">Partner — 2 v 2</option>
                    <option value="openhand">Open hand — partner sees your tiles</option>
                    <option value="cutthroat">Cut throat — every man for himself</option>`;

  const format = document.createElement('select');
  const syncFormat = () => {
    // Cut throat six love runs to a median of ~196 hands. Never make it the
    // default on a phone; players abandon halfway and everyone loses.
    format.innerHTML = isPartnered(mode.value as GameMode)
      ? `<option value="sixlove">Six love</option><option value="firstToSix">First to six</option>`
      : `<option value="firstToSix">First to six</option><option value="sixlove">Six love — very long</option>`;
  };
  syncFormat();
  mode.onchange = syncFormat;

  const duppy = document.createElement('select');
  duppy.innerHTML = `
    <option value="pickney">Pickney — plays anything legal</option>
    <option value="yard">Yard — sheds heavy tiles</option>
    <option value="ranker" selected>Ranker — remembers who passed</option>
    <option value="don">Don — counts suits out and blocks</option>
    <option value="general">General — reads the whole table</option>`;

  const tournament = document.createElement('select');
  tournament.innerHTML = `<option value="0">Casual — sporting allowed</option>
                          <option value="1">Tournament — must lead the six</option>`;

  for (const [label, control] of [
    ['Game', mode], ['Set', format], ['Duppies', duppy], ['Rules', tournament],
  ] as const) {
    const field = el('label', 'field');
    field.append(el('span', undefined, label), control);
    form.appendChild(field);
  }

  const go = document.createElement('button');
  go.className = 'act';
  go.textContent = 'Deal';
  go.onclick = () => void startGame({
    mode: mode.value as GameMode,
    format: format.value as SetFormat,
    duppy: duppy.value as DuppyLevel,
    tournament: tournament.value === '1',
  });

  panel.append(form, el('div', 'stack'), go);

  const note = el('p', 'muted');
  note.style.fontSize = '13px';
  note.textContent =
    'Every deal is committed before the tiles go out and can be checked afterwards. ' +
    'The duppies never see your hand — only the board, and who passed on what.';
  panel.appendChild(note);
  return panel;
}

// ----------------------------------------------------------------- table --
function scoreboard(g: LocalGame): HTMLElement {
  const panel = el('div', 'panel');
  const board = el('div', 'scoreboard');

  if (isPartnered(g.options.mode)) {
    board.append(
      scoreTrack('You & partner', g.set.scores[g.mySide], { us: true, bruk: g.lastResultBruk }),
      scoreTrack('Them', g.set.scores[1 - g.mySide], { bruk: g.lastResultBruk }),
    );
  } else {
    g.set.scores.forEach((score, seat) => {
      board.append(scoreTrack(g.seatLabel(seat), score, {
        us: seat === g.mySeat, bruk: g.lastResultBruk,
      }));
    });
  }

  const meta = el('div', 'stack');
  meta.style.marginLeft = 'auto';
  meta.style.textAlign = 'right';
  meta.append(el('div', 'eyebrow', g.options.format === 'sixlove' ? 'Six love' : 'First to six'));
  if (g.set.handValue > 1) {
    meta.append(el('div', 'side-name', g.set.playoff
      ? 'One all — this hand plays two'
      : `Replay — worth ${g.set.handValue}`));
  }
  board.appendChild(meta);
  panel.appendChild(board);
  return panel;
}

function seats(g: LocalGame): HTMLElement {
  const wrap = el('div', 'seats');
  const passes = g.passesBySeat();
  const voids = g.hand ? knownVoids(g.hand) : [];

  for (let seat = 0; seat < g.options.seatCount; seat++) {
    const card = el('div', 'seat');
    if (g.hand?.turn === seat && g.hand.status === 'active') card.classList.add('turn');
    if (isPartnered(g.options.mode) && seat !== g.mySeat && seat % 2 === g.mySeat % 2) {
      card.classList.add('partner');
    }
    card.append(el('h3', undefined, g.seatLabel(seat)));
    const count = g.hand?.hands[seat].length ?? 0;
    card.append(el('div', 'meta', `${count} tile${count === 1 ? '' : 's'}`));
    if (seat !== g.mySeat) card.append(backsEl(count));

    // Show what their passes gave away. This is Belt 4 Lesson 1, surfaced in
    // the table itself so the habit forms by seeing it, not by being told.
    const v = voids[seat];
    if (v && v.size > 0) {
      card.append(el('div', 'passed',
        `passed on ${[...v].sort().join(', ')} — void`));
    } else if (passes.get(seat)) {
      card.append(el('div', 'passed', 'passed'));
    }

    const line = talk.get(seat);
    if (line && seat !== g.mySeat) card.append(el('div', 'talk', line));
    wrap.appendChild(card);
  }
  return wrap;
}

let pendingTile: string | null = null;

function partnerHandPanel(tiles: string[]): HTMLElement {
  const panel = el('div', 'panel partner-hand');
  panel.append(el('div', 'eyebrow', 'Partner'));
  const row = el('div', 'hand');
  for (const tile of tiles) {
    const node = tileEl(tile);
    node.classList.add('sm', 'dead');
    row.appendChild(node);
  }
  panel.appendChild(row);
  return panel;
}

function myHand(g: LocalGame): HTMLElement {
  const panel = el('div', 'panel');
  panel.append(el('div', 'eyebrow', g.isMyTurn() ? 'Your play' : 'Your hand'));

  const playable = g.playableTiles();
  const legal = g.legal();
  const hand = el('div', 'hand');

  for (const tile of g.hand?.hands[g.mySeat] ?? []) {
    const node = tileEl(tile);
    const can = playable.has(tile);
    node.classList.add(can ? 'playable' : 'dead');
    if (pendingTile === tile) node.classList.add('chosen');
    if (can) {
      node.tabIndex = 0;
      const choose = () => {
        const options = legal.filter((m) => 'tile' in m && m.tile === tile);
        if (options.length === 1) {
          pendingTile = null;
          void g.play(options[0]);
        } else {
          // Fits both ends — make the player say which. Auto-placing here is a
          // top complaint against every rival app.
          pendingTile = pendingTile === tile ? null : tile;
          render();
        }
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
      b.onclick = () => { pendingTile = null; void g.play(move); };
      choice.appendChild(b);
    }
    panel.appendChild(choice);
  }

  const onlyPass = legal.length === 1 && legal[0].kind === 'pass';
  if (g.isMyTurn() && onlyPass) {
    const b = document.createElement('button');
    b.className = 'act';
    b.textContent = 'Pass';
    b.onclick = () => void g.play(legal[0]);
    panel.appendChild(b);
    panel.append(el('p', 'muted', 'Nothing fits either end. Passing tells the table you are void in both.'));
  }
  return panel;
}

function handResult(g: LocalGame): HTMLElement | null {
  if (!g.hand?.result) return null;
  const r = g.hand.result;
  const panel = el('div', 'panel');

  if (g.set.winnerSide !== null && g.set.sixLove) {
    panel.append(el('div', 'banner six-love',
      g.set.winnerSide === g.mySide ? 'SIX LOVE' : 'Six love against you'));
  }

  const won = r.winnerSide === g.mySide;
  const headline = r.tie
    ? 'Tied on count — replay'
    : r.status === 'blocked'
      ? `Board jammed. ${g.seatLabel(r.winnerSeat!)} took it on count.`
      : `${g.seatLabel(r.winnerSeat!)} played out.`;
  panel.append(el('h2', undefined, headline));

  if (r.status === 'blocked' && !r.tie) {
    const counts = r.counts
      .map((c, seat) => `${g.seatLabel(seat)} ${c}`)
      .join('  ·  ');
    panel.append(el('p', 'muted', counts));
    if (isPartnered(g.options.mode)) {
      panel.append(el('p', 'muted',
        'Lowest single hand takes it — a partner\'s tiles never come into it.'));
    }
  }
  if (g.lastResultBruk) {
    panel.append(el('p', 'muted', 'Score bruk. Back to love all, and the six opens.'));
  }

  // The "these tiles were rigged" feeling arrives at exactly one moment: when
  // you have just lost, and hardest when six love has just gone against you.
  // That is the only point where a provably fair deal means anything
  // emotionally, so it is the only point worth naming it. Explaining the
  // cryptography anywhere else is a lecture nobody asked for — which is why
  // the Fair Deal page alone was not converting this into something felt.
  //
  // Eighteen years of the incumbent arguing with players about "bad hands" on
  // Facebook is the thing this one line replaces.
  const sixLoveAgainst = g.set.sixLove
    && g.set.winnerSide !== null && g.set.winnerSide !== g.mySide;
  if (!r.tie && (!won || sixLoveAgainst)) {
    panel.append(el('p', 'check-it', sixLoveAgainst
      ? 'Six love against you. Think the deal was rigged? Check it.'
      : 'Think the deal was against you? Check it.'));
  }

  const row = el('div', 'row');

  if (g.set.winnerSide === null) {
    const next = document.createElement('button');
    next.className = 'act';
    next.textContent = 'Next hand';
    next.onclick = async () => {
      review = null; reviewOpen = false; verifyState = null;
      // Last hand's gloating and last hand's link must not carry over.
      talk = new Map();
      shareLink = null;
      sfx.play('shuffle');
      await g.startHand(); render();
    };
    row.appendChild(next);
  } else {
    const again = document.createElement('button');
    again.className = 'act';
    again.textContent = 'New set';
    again.onclick = () => {
      game = null; review = null; reviewOpen = false;
      stopNagging();
      talk = new Map(); shareLink = null; render();
    };
    row.appendChild(again);
  }

  const check = document.createElement('button');
  check.className = 'act ghost';
  check.textContent = 'Verify this deal';
  check.onclick = async () => { verifyState = await g.verify(); render(); };
  row.appendChild(check);

  if (g.hand) {
    const share = document.createElement('button');
    share.className = 'act ghost';
    share.textContent = 'Share this hand';
    share.onclick = async () => {
      const url = shareUrl(
        encodeHand(g.hand!.moveLog, g.hand!.poser, g.mySeat, g.options.seatCount));
      let copied = false;
      try {
        await navigator.clipboard.writeText(url);
        copied = true;
      } catch {
        // Clipboard access is refused in plenty of browsers and contexts.
        // Showing the link so it can be copied by hand is a working answer;
        // an error message is not.
      }
      shareLink = { url, copied };
      render();
    };
    row.appendChild(share);
  }

  panel.appendChild(row);

  if (shareLink) {
    const box = el('div', 'share-box');
    box.append(el('div', 'eyebrow',
      shareLink.copied ? 'Link copied — send it to somebody' : 'Copy this link'));
    const field = document.createElement('input');
    field.readOnly = true;
    field.value = shareLink.url;
    field.onfocus = () => field.select();
    box.appendChild(field);
    box.append(el('div', 'muted',
      'It replays the board tile by tile. Nobody\'s hand is in the link.'));
    panel.appendChild(box);
  }

  if (verifyState) {
    const v = el('div', 'verify ' + (verifyState.ok ? 'ok' : 'bad'));
    v.append(el('span', 'dot'));
    v.append(el('span', undefined, verifyState.ok
      ? 'Deal matches the commitment published before the tiles went out.'
      : `Check failed: ${verifyState.reason}`));
    panel.appendChild(v);
    if (g.fairness) {
      panel.append(el('div', 'muted', 'Seed'), Object.assign(
        el('code', 'seed', g.fairness.serverSeed), {}));
    }
  }
  return panel;
}

/**
 * The verdict, in one screen: how much of the hand you got right, and the one
 * decision that turned it. No other domino game can tell you this — it needs
 * a solver, not a rules engine — so it is stated plainly on every hand rather
 * than hidden behind a button nobody presses.
 *
 * The move-by-move list is still there, one tap away. Twelve grades is a
 * report; one decision is something you can actually take to the next hand.
 */
function coachSummary(g: LocalGame): HTMLElement | null {
  if (reviewPending) {
    const panel = el('div', 'panel coach-summary');
    panel.append(el('div', 'eyebrow', 'The coach'));
    panel.append(el('div', 'muted', 'Working out where the hand turned…'));
    return panel;
  }
  if (!review) return null;
  const r = review;

  const panel = el('div', 'panel coach-summary');
  const head = el('div', 'spread');
  const left = el('div', 'stack');
  left.append(el('div', 'eyebrow', 'The coach'));
  left.append(el('h2', undefined, r.summary));
  const acc = el('div', 'stack');
  acc.style.textAlign = 'right';
  acc.append(el('div', 'accuracy', `${g.reviewAccuracy(r)}%`), el('div', 'side-name', 'accuracy'));
  head.append(left, acc);
  panel.appendChild(head);

  const critical = r.reviews.find((m) => m.ply === r.criticalPly);
  if (critical) {
    const turn = el('div', 'turning-point');
    const played = 'tile' in critical.move ? critical.move.tile : 'a pass';
    const best = 'tile' in critical.best ? critical.best.tile : 'passing';
    turn.append(el('div', 'eyebrow', 'Where it turned'));
    turn.append(el('div', 'note',
      `Move ${critical.ply + 1}: you played ${played} — ${best} was stronger. ${critical.note}`));
    if (critical.lesson) {
      const link = document.createElement('button');
      link.className = 'lesson';
      link.textContent = `→ ${critical.lesson}`;
      link.onclick = () => {
        const lesson = lessonByRef(critical.lesson!);
        if (lesson) { view = 'academy'; openLesson = lesson.id; render(); }
      };
      turn.appendChild(link);
    }
    panel.appendChild(turn);
  }

  // One hand's mistake is a note. The same mistake across many hands is the
  // thing actually worth fixing, and no rival can tell you it.
  const leak = standoutLeak(leaks);
  if (leak) {
    const box = el('div', 'leak');
    box.append(el('div', 'eyebrow', 'Your leak'));
    box.append(el('div', 'note', `${leak.lesson}. ${describeLeak(leak, leaks)}`));
    const drill = document.createElement('button');
    drill.className = 'lesson';
    drill.textContent = '\u2192 Work on this';
    drill.onclick = () => {
      const lesson = lessonByRef(leak.lesson);
      if (lesson) { view = 'academy'; openLesson = lesson.id; render(); }
    };
    box.appendChild(drill);
    panel.appendChild(box);
  }

  const more = document.createElement('button');
  more.className = 'act ghost';
  more.textContent = reviewOpen
    ? 'Hide the detail'
    : `See all ${r.reviews.length} decision${r.reviews.length === 1 ? '' : 's'}`;
  more.onclick = () => { reviewOpen = !reviewOpen; render(); };
  panel.appendChild(more);
  return panel;
}

function coachPanel(g: LocalGame, r: HandReview): HTMLElement {
  const panel = el('div', 'panel');
  panel.append(el('div', 'eyebrow', 'The coach'));

  const head = el('div', 'spread');
  const left = el('div', 'stack');
  left.append(el('h2', undefined, r.summary));
  left.append(el('div', 'muted',
    `${r.reviews.length} real decision${r.reviews.length === 1 ? '' : 's'} this hand`));
  const acc = el('div', 'stack');
  acc.style.textAlign = 'right';
  acc.append(el('div', 'accuracy', `${g.reviewAccuracy(r)}%`), el('div', 'side-name', 'accuracy'));
  head.append(left, acc);
  panel.appendChild(head);

  if (!r.exact) {
    panel.append(el('p', 'muted',
      'One position was too big to solve exactly, so part of this is an estimate.'));
  }

  for (const move of r.reviews) {
    const row = el('div', 'review-move');
    if (move.ply === r.criticalPly) row.classList.add('critical');
    row.append(el('div', 'ply', `#${move.ply + 1}`));
    row.append(el('span', `grade ${move.grade}`, GRADE_LABEL[move.grade]));

    const body = el('div', 'stack');
    const played = 'tile' in move.move ? move.move.tile : 'pass';
    const best = 'tile' in move.best ? move.best.tile : 'pass';
    body.append(el('div', 'note',
      move.grade === 'best'
        ? `You played ${played}. Correct.`
        : `You played ${played} — ${best} was stronger. ${move.note}`));

    if (move.lesson) {
      const link = document.createElement('button');
      link.className = 'lesson';
      link.textContent = `→ ${move.lesson}`;
      link.onclick = () => {
        const lesson = lessonByRef(move.lesson!);
        if (lesson) { view = 'academy'; openLesson = lesson.id; render(); }
      };
      body.appendChild(link);
    }
    row.appendChild(body);
    panel.appendChild(row);
  }
  return panel;
}

/**
 * Turning the sound off. One tap, and it stays off — people play this in bed
 * at two in the morning, and audio they cannot silence is an uninstall.
 *
 * ONE toggle for the duppy's voice and the table's noise together. Two
 * separate mutes is how someone ends up hunting for whichever one is still
 * making a sound, so `sfx.ts` deliberately reads this same flag.
 */
function soundToggle(): HTMLElement {
  const bar = el('div', 'sound-bar');
  bar.appendChild(feltPicker());

  const off = muted();
  const b = document.createElement('button');
  b.className = 'dismiss';
  b.textContent = off ? 'Sound off' : 'Sound on';
  b.setAttribute('aria-pressed', String(!off));
  b.onclick = () => { setMuted(!off); if (!off) sfx.silence(); render(); };
  bar.appendChild(b);
  return bar;
}

/** Pick the colour of the table. Persisted, and applied everywhere at once. */
function feltPicker(): HTMLElement {
  const wrap = el('div', 'felt-pick');
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', 'Table colour');
  const current = felt();
  for (const f of FELTS) {
    const b = document.createElement('button');
    b.dataset.felt = f.id;
    b.title = f.label;
    b.setAttribute('aria-label', f.label);
    b.setAttribute('aria-pressed', String(f.id === current));
    b.onclick = () => { setFelt(f.id); render(); };
    wrap.appendChild(b);
  }
  return wrap;
}

function tableView(g: LocalGame): DocumentFragment {
  const frag = document.createDocumentFragment();
  frag.appendChild(scoreboard(g));

  const felt = el('div', 'table-felt');
  const line = el('div', 'line');
  renderBoard(line, g.hand?.board ?? null);
  felt.appendChild(line);
  frag.appendChild(felt);

  frag.appendChild(seats(g));
  frag.appendChild(soundToggle());
  // Openhand: your partner's tiles above your own, on the same terms as the
  // online table — small, non-interactive, labelled. LocalGame holds the full
  // engine state, so this is a direct read; no RLS or subscription involved.
  if (g.options.mode === 'openhand' && g.hand) {
    const partnerSeat = g.mySeat ^ 2;
    frag.appendChild(partnerHandPanel(g.hand.hands[partnerSeat]));
  }
  frag.appendChild(myHand(g));
  const result = handResult(g);
  if (result) frag.appendChild(result);
  const summary = coachSummary(g);
  if (summary) frag.appendChild(summary);
  if (reviewOpen && review) frag.appendChild(coachPanel(g, review));
  return frag;
}

// --------------------------------------------------------------- academy --
function academyView(): DocumentFragment {
  const frag = document.createDocumentFragment();
  const intro = el('div', 'panel');
  intro.append(el('div', 'eyebrow', 'The academy'));
  intro.append(el('h2', undefined, 'Toddler to table general'));
  intro.append(el('p', 'muted',
    'Five belts. Belt one is voiced and needs no reading. By belt four you are ' +
    'tracking what every pass gave away; by belt five the scoreline is changing ' +
    'how you play.'));

  // The curriculum is the same for everyone; which part of it you need is not.
  const leak = standoutLeak(leaks);
  if (leak) {
    const box = el('div', 'leak');
    box.append(el('div', 'eyebrow', 'Start here'));
    box.append(el('div', 'note',
      `${leak.lesson} is costing you more than anything else. ${describeLeak(leak, leaks)}`));
    const go = document.createElement('button');
    go.className = 'lesson';
    go.textContent = '\u2192 Open it';
    go.onclick = () => {
      const lesson = lessonByRef(leak.lesson);
      if (lesson) { openLesson = lesson.id; render(); }
    };
    box.appendChild(go);
    intro.appendChild(box);
  } else if (leaks.hands > 0) {
    intro.append(el('div', 'muted',
      `${leaks.hands} hand${leaks.hands === 1 ? '' : 's'} reviewed so far. ` +
      'Keep playing and the coach will tell you which lesson you personally need.'));
  }
  frag.appendChild(intro);

  for (const b of BELTS) {
    const card = el('div', 'belt');
    const isOpen = openBelt === b.id || b.lessons.some((l) => l.id === openLesson);
    if (isOpen) card.classList.add('open');

    const head = el('div', 'row');
    head.style.cursor = 'pointer';
    head.append(el('div', 'num', String(b.index)));
    const titles = el('div', 'stack');
    titles.append(el('h2', undefined, b.title), el('div', 'muted', b.subtitle));
    head.append(titles);
    head.onclick = () => { openBelt = isOpen ? null : b.id; openLesson = null; render(); };
    card.appendChild(head);

    if (isOpen) {
      for (const lesson of b.lessons) {
        const item = el('div', 'lesson');
        if (lesson.id === openLesson) item.classList.add('critical');
        item.append(el('h3', undefined, lesson.title));
        item.append(el('p', undefined, lesson.body));
        if (lesson.terms?.length) {
          const terms = el('div', 'terms');
          for (const t of lesson.terms) terms.append(el('span', undefined, t));
          item.appendChild(terms);
        }
        card.appendChild(item);
      }
      const drills = el('div', 'lesson');
      drills.append(el('h3', undefined, 'Drills'));
      for (const d of b.drills) drills.append(el('p', 'muted', d.prompt));
      card.appendChild(drills);
    }
    frag.appendChild(card);
  }
  return frag;
}

// -------------------------------------------------------------- fairness --
function fairView(): HTMLElement {
  const panel = el('div', 'panel');
  panel.append(el('div', 'eyebrow', 'Fair deal'));
  panel.append(el('h2', undefined, 'The tiles are not against you'));
  panel.append(el('p', undefined,
    'Every domino app gets the same accusation, and most of them deserve it. ' +
    'Here is how you can check ours instead of taking our word.'));

  const steps: [string, string][] = [
    ['Before the deal', 'We generate a secret seed and publish its fingerprint. The seed is now locked — we cannot change it without the fingerprint changing.'],
    ['Your seed', 'Your device adds a seed of its own. We cannot know it in advance, so we cannot hunt for a shuffle that suits us.'],
    ['The shuffle', 'Both seeds together decide the order, by a fixed calculation with no room for a thumb on the scale.'],
    ['After the hand', 'We reveal the seed. Tap Verify this deal and your device redoes the whole shuffle and checks it matches what you were dealt.'],
  ];
  for (const [title, body] of steps) {
    const item = el('div', 'lesson');
    item.append(el('h3', undefined, title), el('p', undefined, body));
    panel.appendChild(item);
  }

  const note = el('div', 'lesson');
  note.append(el('h3', undefined, 'And the duppies'));
  note.append(el('p', undefined,
    'They are handed the board, the tile counts and the record of who passed on ' +
    'what. They are never handed your tiles. The harder ones are harder because ' +
    'they think further, not because they see more.'));
  panel.appendChild(note);
  return panel;
}

/**
 * Terms and privacy belong within reach of every screen but nowhere near the
 * five things people came to do, so they sit in a footer rather than taking a
 * sixth slot in the nav.
 */
function legalFooter(): HTMLElement {
  const foot = el('footer', 'legal-footer');
  const links: [View, string][] = [['terms', 'Terms'], ['privacy', 'Privacy']];
  for (const [id, label] of links) {
    const link = document.createElement('button');
    link.className = 'linky';
    link.textContent = label;
    link.onclick = () => { view = id; render(); };
    foot.appendChild(link);
  }
  foot.appendChild(el('span', undefined, `© ${new Date().getFullYear()} Beat Di Table`));
  return foot;
}

function pending(message: string): HTMLElement {
  const panel = el('div', 'panel');
  panel.append(el('div', 'eyebrow', 'One moment'), el('h2', undefined, message));
  return panel;
}

// ---------------------------------------------------------------- render --
function render() {
  app.innerHTML = '';
  app.appendChild(chrome());
  const update = updateBar();
  if (update) app.appendChild(update);

  if (view === 'replay' && replayHand) {
    app.appendChild(replayView());
  } else if (view === 'play') {
    if (game) {
      app.appendChild(tableView(game));
    } else {
      // The table sells the game; the install card waits its turn below it.
      app.appendChild(hero());
      // Carries the green of the felt down into the cream page, so the half
      // below the fold reads as the same yard rather than a separate site.
      app.appendChild(el('div', 'yard-band'));
      const card = installCard();
      if (card) app.appendChild(card);
      app.appendChild(lobby());
    }
  } else if (view === 'lounges') {
    // The lounges are the only place strangers can talk to you, so the age
    // screen sits here rather than at sign-in — sign-in is silent and
    // anonymous by design, and solo play against the duppies involves nobody
    // else and stays open to everyone.
    const allowed = socialAllowed();
    if (allowed === null) {
      app.appendChild(ageGate(() => render()));
    } else if (!allowed) {
      app.appendChild(tooYoungView(() => { view = 'play'; render(); }));
    } else {
      app.appendChild(loungeModule ? loungeModule.loungesView(render) : pending('Opening the lounges'));
    }
  } else if (view === 'terms') {
    app.appendChild(termsView());
  } else if (view === 'privacy') {
    app.appendChild(privacyView());
  } else if (view === 'academy') {
    app.appendChild(academyView());
  } else if (view === 'membership') {
    app.appendChild(loungeModule ? loungeModule.membershipView(render) : pending('Loading membership'));
  } else {
    app.appendChild(fairView());
  }

  // Not during a live hand — the table is full-bleed and a footer under it
  // reads as the game having ended.
  if (!(view === 'play' && game)) app.appendChild(legalFooter());
}

// --- bootstrap --------------------------------------------------------------
// The board line snakes to fit the felt, so a rotate or window resize needs a
// re-render to pick the new width.
let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(render, 150);
});

watchInstallability(render);
registerServiceWorker(render);

applyFelt();

/**
 * Browsers only let audio start inside a user gesture, and iOS will not play
 * an element that has never been played inside one — so the very first touch
 * anywhere primes every clip. `once` means this costs one listener, and
 * `pointerdown` fires before the click that deals the first hand, so the
 * shuffle that follows is already unlocked.
 */
for (const evt of ['pointerdown', 'keydown'] as const) {
  window.addEventListener(evt, () => sfx.unlock(), { once: true });
}

/**
 * A link someone was sent opens straight into the replay — on a cold load,
 * and also when the app is already open. Following a link that only changes
 * the fragment does not reload the page, so without this a shared hand
 * silently does nothing for anyone who already had Yard on screen.
 */
function openSharedHand() {
  const shared = handFromUrl();
  if (!shared) return;
  stopReplay();
  replayHand = shared;
  replayStep = 0;
  view = 'replay';
  playReplay();
  render();
}

window.addEventListener('hashchange', openSharedHand);
openSharedHand();

render();
if (localStorage.getItem(LOUNGES_VISITED_KEY)) {
  void ensureLoungeModule(true);
}
