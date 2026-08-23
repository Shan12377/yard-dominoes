import {
  BELTS, lessonByRef, knownVoids, duppyLine, halves, TALK_CHANCE,
  EMPTY_LEAKS, recordHand, standoutLeak, describeLeak, isPartnered, sideOf,
} from '@yard/engine';

function formatLabel(format: SetFormat): string {
  switch (format) {
    case 'sixlove': return 'Six love';
    case 'firstToSix': return 'First to six';
    case 'french': return 'French — race to 100';
    case 'single': return 'Single hand';
  }
}
import type { LeakStore, TalkTrigger } from '@yard/engine';
import type { DuppyLevel, GameMode, HandReview, Move, PenaltyEvent, SetFormat, TileId } from '@yard/engine';
import { LocalGame } from './local.ts';
import { coachReviewView } from './coachview.ts';
import { ACADEMY_VISUALS, GAME_GUIDES, scenarioFor } from './academycontent.ts';
import { tileEl, renderBoard, backsEl, scoreTrack, el, crossRejectReason, penaltyBanner, frenchScoreBreakdown, frenchPenaltyLog, celebrateWinningTile } from './render.ts';
import { boardAfter, encodeHand, handFromUrl, shareUrl } from './replay.ts';
import type { ReplayHand } from './replay.ts';
import { hasVoice, lineFor, muted, setMuted, speak } from './speak.ts';
import * as sfx from './sfx.ts';
import { applyFelt, FELTS, felt, setFelt } from './felt.ts';
import {
  platform, promptInstall, watchInstallability, registerServiceWorker,
  applyUpdate, updatePending, checkForUpdate, IOS_STEPS,
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
    await loungeModule.loadLounges(scheduleRender);
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
/**
 * Site-wide hands-played tally, shown on the hero once the count is high
 * enough to read as momentum rather than an empty room. A raw PostgREST
 * fetch — not the Supabase client — because the offline bundle must stay
 * small and this is the only online.ts-touching thing on the whole page.
 */
const SITE_STATS_MIN_TO_SHOW = 500;
let siteHandsPlayed: number | null = null;
let siteHandsFetched = false;
let siteHandsScheduled = false;

async function fetchSiteHandsPlayed() {
  if (siteHandsFetched) return;
  siteHandsFetched = true;
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !anon) return;
  try {
    const res = await fetch(`${url}/rest/v1/site_stats?id=eq.1&select=total_hands_played`, {
      headers: { apikey: anon, Authorization: `Bearer ${anon}` },
    });
    if (!res.ok) return;
    const rows = await res.json() as { total_hands_played: number }[];
    if (rows[0]) { siteHandsPlayed = rows[0].total_hands_played; render(); }
  } catch {
    // Social proof, not critical — the hero reads fine without it.
  }
}

/** Social proof is optional and must never join the critical render chain. */
function scheduleSiteHandsFetch(): void {
  if (siteHandsFetched || siteHandsScheduled) return;
  siteHandsScheduled = true;
  // Ten seconds keeps this optional request outside Lighthouse's critical
  // navigation window and, more importantly, outside a real visitor's first
  // interaction window on a slow phone.
  const start = () => setTimeout(() => void fetchSiteHandsPlayed(), 10_000);
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
}

let view: View = 'play';
let game: LocalGame | null = null;
let review: HandReview | null = null;
/**
 * A French penalty (+10) that just landed, shown as a banner and cleared
 * after PENALTY_BANNER_MS — see local.ts's 'penalty' event. Module-scoped
 * like `pendingTile` below: render() rebuilds the whole view on every event,
 * so this has to live outside it or it would vanish the instant the very
 * next state event redraws the table.
 */
let penaltyEvents: PenaltyEvent[] | null = null;
const PENALTY_BANNER_MS = 6000;
/** The coach is running. It solves positions, so it is not instant. */
let reviewPending = false;
/** The full move-by-move breakdown, opened from the summary. */
let reviewOpen = false;
let openBelt: string | null = null;
let openLesson: string | null = null;
let openDrill: string | null = null;
const drillAnswers = new Map<string, number>();
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
    card.append(el('h2', undefined, 'Install YaadDominoes'));
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
    card.append(el('h2', undefined, 'Add YaadDominoes to your home screen'));
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
      'On iPhone, only Safari can add an app to the home screen. Open YaadDominoes in Safari, then tap Share and Add to Home Screen.'));
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
    midHand ? 'A new version is ready — it will apply after this hand.' : 'A new version of YaadDominoes is ready.'));
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
  const mark = document.createElement('img');
  mark.className = 'brand-mark';
  mark.src = '/art/yaaddominoes-mark.svg';
  mark.alt = '';
  const brandCopy = el('div', 'brand-copy');
  const h1 = el('h1');
  h1.setAttribute('aria-label', 'YaadDominoes');
  h1.append(
    el('span', 'word-yaad', 'Yaad'),
    el('span', 'word-dominoes', 'Dominoes'),
  );
  const tag = el('span', 'eyebrow', 'Jamaican dominoes');
  brandCopy.append(h1, tag);
  brand.append(mark, brandCopy);

  const nav = el('div', 'nav');
  const tabs = [
    ['play', 'Play'], ['lounges', 'Lounges'], ['academy', 'Academy'],
    ['membership', 'Membership'], ['fair', 'Fair deal'],
  ] as const;
  for (const [id, label] of tabs) {
    const b = document.createElement('button');
    b.textContent = label;
    b.dataset.view = id;
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
  // Also in the footer (legalFooter()), but nobody thinks to scroll to the
  // bottom of the page to check whether the app they're already using is
  // current — same control, reachable from the top too. If checking finds
  // one, updateBar() (rendered right below this) already carries its own
  // "Reload now" button, so there's nothing further to hunt for once you've
  // clicked this.
  bar.append(brand, nav, checkForUpdateLink());
  return bar;
}

// ------------------------------------------------------------------ hero --
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

/** Back to the setup screen — same reset whether a set just finished
 *  ("New set") or a player wants out mid-hand ("Leave"). Local play against
 *  duppies has nobody to strand, unlike the online table, so there is no
 *  reason to gate this on the hand being over. */
function leaveLocalGame() {
  game = null; review = null; reviewOpen = false;
  stopNagging();
  talk = new Map(); shareLink = null;
  render();
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

let recentPlayedTile: string | null = null;
let recentPassSeat: number | null = null;
let winningTile: string | null = null;
/** The hero line makes its entrance once per page load, not on every render. */
let heroHasEntered = false;

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
    if (e.type === 'played') {
      sfx.play('knock');
      recentPlayedTile = e.tile;
      window.setTimeout(() => {
        if (recentPlayedTile === e.tile) { recentPlayedTile = null; scheduleRender(); }
      }, 420);
    }
    // Six love is the loudest thing that happens in this game and it ends the
    // set, so it gets its own sound rather than sharing the win line's.
    if (e.type === 'setOver' && g.set.sixLove) sfx.play('sixLove');

    if (e.type === 'penalty') {
      penaltyEvents = e.events;
      setTimeout(() => { penaltyEvents = null; render(); }, PENALTY_BANNER_MS);
    }

    if (e.type === 'passed' && e.seat !== g.mySeat) {
      recentPassSeat = e.seat;
      window.setTimeout(() => {
        if (recentPassSeat === e.seat) { recentPassSeat = null; scheduleRender(); }
      }, 520);
      say(e.seat, 'iPass', level);
    } else if (e.type === 'passed' && e.seat === g.mySeat) {
      recentPassSeat = e.seat;
      window.setTimeout(() => {
        if (recentPassSeat === e.seat) { recentPassSeat = null; scheduleRender(); }
      }, 520);
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
      // A tile tapped right before the hand ended (legal or not) must not
      // linger into the result screen — myHand() already stops rendering
      // the chooser once the hand isn't active, but clearing this too stops
      // it from wrongly pre-selecting a same-id tile if the next deal
      // happens to include it again.
      pendingTile = null;
      const lastMove = g.hand?.moveLog[g.hand.moveLog.length - 1];
      winningTile = g.hand?.status === 'domino' && lastMove && 'tile' in lastMove
        ? lastMove.tile
        : null;
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
    // A single duppy move fires 'played'/'passed' AND 'state' back to back
    // (local.ts) — scheduleRender() coalesces both into one actual render
    // instead of blanking and rebuilding the whole page twice per move.
    scheduleRender();
  });

  review = null;
  reviewOpen = false;
  verifyState = null;
  shareLink = null;
  recentPlayedTile = null;
  recentPassSeat = null;
  winningTile = null;
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
  copy.append(el('h2', undefined, 'Beat di table.'));
  copy.append(el('p', undefined,
    'Real yard rules. Free play. Every deal can be checked.'));
  copy.append(el('p', 'hero-claim',
    'After the hand, your coach shows the move you missed.'));

  scheduleSiteHandsFetch();
  if (siteHandsPlayed !== null && siteHandsPlayed >= SITE_STATS_MIN_TO_SHOW) {
    copy.append(el('p', 'hero-tally',
      `${siteHandsPlayed.toLocaleString()} hands played and counting.`));
  }

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

  const line = el('div', `hero-domino-cascade${heroHasEntered ? '' : ' entering'}`);
  heroHasEntered = true;
  line.setAttribute('role', 'img');
  line.setAttribute('aria-label', 'A connected line of dominoes with doubles laid crosswise');

  const dominoImage = (className: string) => {
    const image = document.createElement('img');
    image.className = className;
    image.src = '/art/hero-domino-line-360.webp';
    image.srcset = '/art/hero-domino-line-360.webp 360w, /art/hero-domino-line.webp 720w';
    image.sizes = '(max-width: 807px) calc(100vw - 66px), 720px';
    image.alt = '';
    image.width = 720;
    image.height = 230;
    image.decoding = 'async';
    return image;
  };
  const base = dominoImage('hero-domino-line');
  base.fetchPriority = 'high';
  line.append(base);
  for (let step = 1; step <= 7; step++) {
    const pulse = dominoImage(`hero-domino-pulse hero-domino-pulse-${step}`);
    pulse.setAttribute('aria-hidden', 'true');
    line.append(pulse);
  }

  felt.append(copy, line);
  return felt;
}

function brandStories(): HTMLElement {
  const section = el('section', 'brand-stories');
  section.setAttribute('aria-labelledby', 'brand-stories-title');
  const intro = el('div', 'brand-stories-copy');
  intro.append(
    el('div', 'eyebrow', 'More than a game'),
    el('h2', undefined, 'The table travels.'),
    el('p', 'muted',
      'Play with your people, learn the reads elders grew up with, and carry yard rules wherever you live.'),
  );
  intro.querySelector('h2')!.id = 'brand-stories-title';

  const cards = el('div', 'brand-story-grid');
  const deferredImages: HTMLImageElement[] = [];
  const stories = [
    {
      src: '/marketing/veranda-game.webp',
      alt: 'Four adults sharing a competitive domino game on a Kingston veranda',
      title: 'Same table. Any distance.',
      copy: 'Free play first. Lounges bring the regulars, voice and rivalry.',
    },
    {
      src: '/marketing/academy-generations.webp',
      alt: 'A grandmother teaching her granddaughter how to read a domino hand',
      title: 'Learn the reads.',
      copy: 'The academy starts at the pips and builds up to tournament decisions.',
    },
    {
      src: '/marketing/night-game.webp',
      alt: 'Friends reacting as the winning domino lands at a night yard game',
      title: 'Every last bone matters.',
      copy: 'The final tile lands with the sound, movement and pressure it deserves.',
    },
  ];
  for (const story of stories) {
    const figure = document.createElement('figure');
    figure.className = 'brand-story';
    const image = document.createElement('img');
    image.dataset.src = story.src;
    image.alt = story.alt;
    image.width = 1280;
    image.height = 720;
    image.loading = 'lazy';
    image.decoding = 'async';
    deferredImages.push(image);
    const caption = document.createElement('figcaption');
    caption.append(el('h3', undefined, story.title), el('p', undefined, story.copy));
    figure.append(image, caption);
    cards.appendChild(figure);
  }
  section.append(intro, cards);
  // Native lazy-loading intentionally starts fetching images several
  // viewports early. These large editorial scenes are below the primary
  // action, so wait until the section is genuinely visible instead of making
  // a first-time player download and decode them before they scroll.
  const revealImages = () => {
    for (const image of deferredImages) {
      if (image.dataset.src) image.src = image.dataset.src;
      delete image.dataset.src;
    }
  };
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      revealImages();
      observer.disconnect();
    });
    observer.observe(section);
  } else {
    revealImages();
  }
  return section;
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
  head.append(el('div', 'eyebrow', 'A hand from YaadDominoes'));
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

/** One line under the Set picker — where a player actually needs to know
 *  what they're choosing, not a standalone guide bolted onto the lounge. */
const FORMAT_HINTS: Record<string, string> = {
  sixlove: 'Six wins in a row while the other side stays at zero — a bruk resets it.',
  firstToSix: 'Best of six. Straight race, no reset.',
  french: 'Race to 100 — lowest score wins. Doubles cost you double.',
};

// ----------------------------------------------------------------- lobby --
function lobby(): HTMLElement {
  const panel = el('div', 'panel door');
  panel.append(
    el('div', 'eyebrow', 'Start a game'),
    el('h2', undefined, 'Sit down'),
  );

  const form = el('div', 'lobby-form');

  // French used to live only as a third option inside Cut throat's "Set"
  // dropdown — a player who specifically wants French had no way to find it
  // without already knowing it was nested under Cut throat first. It's a
  // top-level Game choice now, same as Partner/Open hand/Cut throat, even
  // though under the hood it's still cutthroat mode + french format (see
  // resolvedMode/resolvedFormat below) — the engine's own createSet() forces
  // that pairing regardless of what this form sends.
  const mode = document.createElement('select');
  mode.innerHTML = `<option value="partner">Partner — 2 v 2</option>
                    <option value="openhand">Open hand — partner sees your tiles</option>
                    <option value="cutthroat">Cut throat — every man for himself</option>
                    <option value="french">French — race to 100, lowest wins</option>`;
  const resolvedMode = (): GameMode => mode.value === 'french' ? 'cutthroat' : (mode.value as GameMode);
  const resolvedFormat = (): SetFormat => mode.value === 'french' ? 'french' : (format.value as SetFormat);

  const format = document.createElement('select');
  const formatField = el('label', 'field');
  const syncFormat = () => {
    if (mode.value === 'french') {
      // French fully decides its own scoring — nothing left to pick here.
      formatField.style.display = 'none';
      return;
    }
    formatField.style.display = '';
    // Cut throat six love runs to a median of ~196 hands. Never make it the
    // default on a phone; players abandon halfway and everyone loses.
    const partnered = isPartnered(mode.value as GameMode);
    format.innerHTML = partnered
      ? `<option value="sixlove">Six love</option><option value="firstToSix">First to six</option>`
      : `<option value="firstToSix">First to six</option><option value="sixlove">Six love — very long</option>`;
  };
  // One line under the picker, not a standalone guide — this is where a
  // player actually needs to know what they're choosing.
  const formatHint = el('div', 'muted small');
  const syncFormatHint = () => { formatHint.textContent = FORMAT_HINTS[resolvedFormat()] ?? ''; };
  syncFormat();
  syncFormatHint();
  mode.onchange = () => { syncFormat(); syncFormatHint(); };
  format.onchange = syncFormatHint;

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
    ['Game', mode], ['Duppies', duppy], ['Rules', tournament],
  ] as const) {
    const field = el('label', 'field');
    field.append(el('span', undefined, label), control);
    form.appendChild(field);
  }
  formatField.append(el('span', undefined, 'Set'), format, formatHint);
  form.insertBefore(formatField, form.children[1] ?? null);

  const go = document.createElement('button');
  go.className = 'act';
  go.textContent = 'Deal';
  go.onclick = () => void startGame({
    mode: resolvedMode(),
    format: resolvedFormat(),
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
  const panel = el('div', 'panel sticky-scores');

  const top = el('div', 'spread');
  top.append(el('div', 'eyebrow', 'Practice'));
  const leave = document.createElement('button');
  leave.className = 'act ghost small';
  leave.textContent = 'Leave';
  leave.onclick = () => leaveLocalGame();
  top.appendChild(leave);
  panel.appendChild(top);

  const board = el('div', 'scoreboard');

  const trackOpts = { bruk: g.lastResultBruk, max: g.set.options.target };
  // How many tiles each side/seat has left — the pinned scoreboard is the
  // one place that stays on screen through the whole hand, so this is
  // where a player can actually track it without hunting the board.
  const tilesOfSeat = (seat: number) => g.hand?.hands[seat]?.length;
  if (isPartnered(g.options.mode)) {
    const tilesOfSide = (side: number) => {
      if (!g.hand) return undefined;
      let sum = 0;
      for (let seat = 0; seat < g.options.seatCount; seat++) {
        if (sideOf(seat, g.options.mode) === side) sum += g.hand.hands[seat].length;
      }
      return sum;
    };
    board.append(
      scoreTrack('You & partner', g.set.scores[g.mySide], { us: true, ...trackOpts, tiles: tilesOfSide(g.mySide) }),
      scoreTrack('Them', g.set.scores[1 - g.mySide], { ...trackOpts, tiles: tilesOfSide(1 - g.mySide) }),
    );
  } else {
    g.set.scores.forEach((score, seat) => {
      board.append(scoreTrack(g.seatLabel(seat), score, {
        us: seat === g.mySeat, ...trackOpts, tiles: tilesOfSeat(seat),
      }));
    });
  }

  const meta = el('div', 'stack');
  meta.style.marginLeft = 'auto';
  meta.style.textAlign = 'right';
  meta.append(el('div', 'eyebrow', formatLabel(g.options.format)));
  if (g.set.handValue > 1) {
    meta.append(el('div', 'side-name', g.set.playoff
      ? 'One all — this hand plays two'
      : `Replay — worth ${g.set.handValue}`));
  }
  // Format belongs in the table header, not a third scoreboard column. On a
  // phone that third column forced the two actual scores onto separate rows
  // and doubled the height of the sticky bar over the board.
  top.insertBefore(meta, leave);
  panel.appendChild(board);
  return panel;
}

function seats(g: LocalGame): HTMLElement {
  const wrap = el('div', 'seats practice-seats');
  const passes = g.passesBySeat();
  const voids = g.hand ? knownVoids(g.hand) : [];

  for (let seat = 0; seat < g.options.seatCount; seat++) {
    const card = el('div', 'seat');
    if (seat === recentPassSeat) card.classList.add('pass-pop');
    if (seat === g.mySeat) card.classList.add('mine');
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
/**
 * The felt's real measured size, cached across renders — see tableView()'s
 * requestAnimationFrame block. render() rebuilds the whole DOM on every
 * call (see client.md's rendering model), and duppy turns fire it every
 * ~420ms in a row; re-measuring AND fully rebuilding the board on each one
 * flashed visibly the moment several fired back to back. Once the real box
 * is known it very rarely changes (only an actual resize moves it), so the
 * fix is to trust the cache on every render after the first and only pay
 * for a real re-measure-and-rebuild when the box has actually changed.
 */
let lastFeltBox: { width: number; height: number } | null = null;

/**
 * Matches CrossArm['direction'] — the felt lays a French board's four arms
 * out in exactly these screen positions. An arrow needs no translating the
 * way "Right"/"Up" did — a player who couldn't place what "Up arm" meant
 * can still match an arrow glyph straight to the arm pointing that way on
 * the felt. `label` stays for screen readers, which can't see the glyph.
 */
const ARM_DIRECTION_ARROW: Record<'right' | 'left' | 'up' | 'down', { glyph: string; label: string }> = {
  right: { glyph: '→', label: 'right' },
  left: { glyph: '←', label: 'left' },
  up: { glyph: '↑', label: 'top' },
  down: { glyph: '↓', label: 'bottom' },
};

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
  const panel = el('div', 'panel my-hand-panel');
  panel.append(el('div', 'eyebrow', g.isMyTurn() ? 'Your play' : 'Your hand'));

  const playable = g.playableTiles();
  const legal = g.legal();
  const hand = el('div', 'hand');

  for (const tile of g.hand?.hands[g.mySeat] ?? []) {
    const node = tileEl(tile);
    const can = playable.has(tile);
    node.classList.add(can ? 'playable' : 'dead');
    if (pendingTile === tile) node.classList.add('chosen');
    // Every tile is selectable, playable or not — a real table never stops
    // your hand touching a tile that doesn't fit, it just won't land. The
    // 'playable' class is the hint; tapping a 'dead' one shows why it can't
    // be played instead of doing nothing.
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
    hand.appendChild(node);
  }
  panel.appendChild(hand);

  if (pendingTile && g.hand?.status === 'active') {
    const board = g.hand?.board ?? null;
    const linear = board?.kind === 'linear' ? board : null;
    const cross = board?.kind === 'cross' ? board : null;
    const options = legal.filter((m) => 'tile' in m && m.tile === pendingTile);
    const choice = el('div', 'row');
    if (options.length === 0) {
      const reason = cross ? crossRejectReason(cross, pendingTile) : null;
      choice.append(el('span', 'muted', reason ?? "That tile doesn't fit the board right now."));
    } else {
      choice.append(el('span', 'muted', 'Which end?'));
      for (const move of options) {
        const b = document.createElement('button');
        b.className = 'act ghost';
        if (cross && move.kind === 'playcross') {
          // Post-fill only — the fill phase always has exactly one legal arm
          // per tile, so a real choice here means two or more EXISTING arms
          // both expose the same pip. An arrow pointing the same way the arm
          // actually runs on the felt needs no reading — see the parallel
          // comment in onlinetableview.ts.
          const arm = cross.arms[move.arm];
          if (arm) {
            const dir = ARM_DIRECTION_ARROW[arm.direction];
            b.textContent = `${dir.glyph} (${arm.openEnd})`;
            b.setAttribute('aria-label', `${dir.label} arm, opens on ${arm.openEnd}`);
          } else {
            b.textContent = 'New arm';
          }
        } else {
          // Same arrow language as the cross board's arms — a linear board's
          // left/right end is exactly the same "which end?" question, and
          // the felt lays them out left-to-right on screen too.
          const isLeft = (move as any).end === 'left';
          const arrow = isLeft ? '←' : '→';
          const pip = linear ? (isLeft ? linear.leftEnd : linear.rightEnd) : null;
          b.textContent = pip !== null
            ? `${arrow} ${isLeft ? 'Left' : 'Right'} end (${pip})`
            : `${arrow} ${isLeft ? 'Left end' : 'Right end'}`;
        }
        b.onclick = () => { pendingTile = null; void g.play(move); };
        choice.appendChild(b);
      }
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

  // French scores every pip on every hand, not just blocked ones — this is
  // the one place a player can check the math for themselves, on domino
  // wins as much as blocked hands, which the old blocked-only counts line
  // below never covered.
  if (g.options.format === 'french') {
    panel.appendChild(frenchScoreBreakdown(r, g.scoresBeforeHand, g.set.scores, (seat) => g.seatLabel(seat)));
  } else if (r.status === 'blocked' && !r.tie) {
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

  // French penalties (board pass, three-in-a-row pass, no double to pose)
  // accrue silently mid-hand — the live banner names the reason but vanishes
  // after 6 seconds, so this is where a player can still see WHY each +10
  // landed once the hand is over, not just that it did.
  if (g.options.format === 'french') {
    const penaltyLog = frenchPenaltyLog(r.penaltyLog ?? [], (seat) => g.seatLabel(seat));
    if (penaltyLog) panel.appendChild(penaltyLog);
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
    again.onclick = () => leaveLocalGame();
    row.appendChild(again);
  }

  const check = document.createElement('button');
  check.className = 'act ghost';
  check.textContent = 'Verify the deal — free';
  check.onclick = async () => { verifyState = await g.verify(); render(); };
  row.appendChild(check);

  if (g.hand) {
    const share = document.createElement('button');
    share.className = 'act ghost';
    share.textContent = 'Share this hand';
    share.onclick = async () => {
      const url = shareUrl(
        encodeHand(g.hand!.moveLog, g.hand!.poser, g.mySeat, g.options.seatCount, g.options.format));
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
    const v = el('section', 'deal-check');
    const verdict = el('div', `deal-verdict ${verifyState.ok ? 'ok' : 'bad'}`);
    verdict.setAttribute('role', 'status');
    verdict.append(
      el('div', 'eyebrow', 'Visual deal check'),
      el('h2', undefined, verifyState.ok ? 'Deal verified' : 'Deal could not be verified'),
      el('p', 'muted', verifyState.ok
        ? 'Your browser rebuilt the locked shuffle. These are the exact starting hands it produced.'
        : `The reconstructed deal did not match: ${verifyState.reason}`),
    );
    v.appendChild(verdict);
    if (verifyState.ok) {
      const checks = el('div', 'deal-checks');
      for (const message of ['Shuffle locked before play', 'Revealed key matches that lock', 'Every starting hand matches', 'Every tile is accounted for']) {
        checks.append(el('div', undefined, `✓ ${message}`));
      }
      v.appendChild(checks);
      const table = el('div', 'verified-table');
      for (let seat = 0; seat < g.dealt.length; seat++) {
        const hand = el('div', `reveal-hand verified-seat seat-${seat}`);
        hand.append(el('strong', undefined, g.seatLabel(seat)));
        const tiles = el('div', 'hand');
        for (const id of g.dealt[seat]) { const tile = tileEl(id); tile.classList.add('sm'); tiles.append(tile); }
        hand.append(tiles); table.append(hand);
      }
      v.appendChild(table);
    }
    if (g.fairness) {
      const technical = document.createElement('details');
      technical.className = 'deal-technical';
      const summary = document.createElement('summary');
      summary.textContent = 'Technical details';
      technical.append(
        summary,
        el('div', 'muted', 'Commitment'), el('code', 'seed', g.fairness.commitment),
        el('div', 'muted', 'Revealed key'), el('code', 'seed', g.fairness.serverSeed),
        el('div', 'muted', 'Hand'), el('code', 'seed', g.fairness.handId),
      );
      v.appendChild(technical);
    }
    panel.appendChild(v);
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
  left.append(el('div', 'muted',
    r.reviews.length === 0
      ? 'No real choices this hand.'
      : `${r.reviews.length} decision${r.reviews.length === 1 ? '' : 's'} reviewed · ` +
        `${r.counts.best + r.counts.fine} held up`));
  const acc = el('div', 'stack');
  acc.style.textAlign = 'right';
  acc.append(el('div', 'accuracy', `${g.reviewAccuracy(r)}%`), el('div', 'side-name', 'decision score'));
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
  more.textContent = critical
    ? 'Review the key decision'
    : `Review ${r.reviews.length === 1 ? 'the decision' : `all ${r.reviews.length} decisions`}`;
  more.disabled = r.reviews.length === 0;
  more.onclick = () => { reviewOpen = !reviewOpen; render(); };
  panel.appendChild(more);
  return panel;
}

function coachPanel(g: LocalGame, r: HandReview): HTMLElement {
  return coachReviewView({
    review: r,
    score: g.reviewAccuracy(r),
    onClose: () => { reviewOpen = false; render(); },
    onLesson: (reference) => {
      const lesson = lessonByRef(reference);
      if (lesson) { reviewOpen = false; view = 'academy'; openLesson = lesson.id; render(); }
    },
  });
}

/**
 * Turning the sound off. One tap, and it stays off — people play this in bed
 * at two in the morning, and audio they cannot silence is an uninstall.
 *
 * Two independent toggles, not one — they used to share a flag on the theory
 * that separate mutes is how someone ends up hunting for whichever is still
 * making noise. In practice online play never triggers the duppy's voice at
 * all (that's offline-only), so muting it there silently killed the table's
 * knock/shuffle too, with no control anywhere online to notice or undo it.
 */
function soundToggle(): HTMLElement {
  const bar = el('div', 'sound-bar');
  bar.appendChild(feltPicker());

  const voiceOff = muted();
  const voiceBtn = document.createElement('button');
  voiceBtn.className = 'dismiss';
  voiceBtn.textContent = voiceOff ? 'Voice off' : 'Voice on';
  voiceBtn.setAttribute('aria-pressed', String(!voiceOff));
  voiceBtn.onclick = () => { setMuted(!voiceOff); render(); };
  bar.appendChild(voiceBtn);

  const sfxOff = sfx.muted();
  const sfxBtn = document.createElement('button');
  sfxBtn.className = 'dismiss';
  sfxBtn.textContent = sfxOff ? 'Table sound off' : 'Table sound on';
  sfxBtn.setAttribute('aria-pressed', String(!sfxOff));
  sfxBtn.onclick = () => { sfx.setMuted(!sfxOff); render(); };
  bar.appendChild(sfxBtn);

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
  if (penaltyEvents) frag.appendChild(penaltyBanner(penaltyEvents, (seat) => g.seatLabel(seat)));

  const room = el('div', 'practice-room');
  const felt = el('div', 'table-felt live-felt');
  const line = el('div', 'line');
  const displayBoard = g.hand?.board ?? null;
  // First pass: the cached real box once we have one (near-instant, no
  // flash), or feltBox()'s window-based guess before the felt has ever been
  // measured.
  renderBoard(line, displayBoard, lastFeltBox ? { box: lastFeltBox } : {});
  const animateTile = () => {
    const tile = winningTile ?? recentPlayedTile;
    if (!tile) return;
    if (winningTile) {
      celebrateWinningTile(winningTile, line, felt);
    } else {
      line.querySelector(`[data-tile="${tile}"]`)?.classList.add('placed-now');
    }
  };
  animateTile();
  felt.appendChild(line);
  room.appendChild(felt);
  // The felt isn't attached to the document yet at this point in the build,
  // so clientWidth/clientHeight would read zero here — wait a frame for real
  // layout, then correct the cache and re-render ONLY if the real box has
  // actually moved (a resize) — not on every render, or a run of duppy
  // turns (render() fires every ~420ms) tears down and rebuilds every tile
  // several times a second, which is the flash this guards against.
  requestAnimationFrame(() => {
    const box = { width: felt.clientWidth - 32, height: felt.clientHeight - 32 };
    if (box.width <= 0 || box.height <= 0) return;
    const changed = !lastFeltBox || lastFeltBox.width !== box.width || lastFeltBox.height !== box.height;
    lastFeltBox = box;
    if (changed) {
      renderBoard(line, displayBoard, { box });
      animateTile();
    }
  });

  // Hand docks right under the board, before seats/sound compete for the
  // fold — reading the board and reading your own hand is one motion, not
  // two, same reasoning as onlinetableview.ts's felt-slot placement. This
  // used to render after seats()/soundToggle(), which on a phone pushed the
  // hand below the board far enough that playing meant scrolling down to
  // read the hand, then back up to read the board.
  // Openhand: your partner's tiles above your own, on the same terms as the
  // online table — small, non-interactive, labelled. LocalGame holds the full
  // engine state, so this is a direct read; no RLS or subscription involved.
  if (g.options.mode === 'openhand' && g.hand) {
    const partnerSeat = g.mySeat ^ 2;
    room.appendChild(partnerHandPanel(g.hand.hands[partnerSeat]));
  }
  room.appendChild(myHand(g));

  room.appendChild(seats(g));
  room.appendChild(soundToggle());
  frag.appendChild(room);
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

  const guides = el('section', 'panel academy-game-guides');
  guides.append(el('div', 'eyebrow', 'Game guides'));
  guides.append(el('h2', undefined, 'Know which table you joined'));
  guides.append(el('p', 'muted', 'The belts teach the shared domino skills. These guides explain the modes that change the board or who controls each seat.'));
  const guideGrid = el('div', 'academy-guide-grid');
  for (const guide of GAME_GUIDES) {
    const card = el('article', `academy-guide academy-guide-${guide.id}`);
    const visual = el('div', `academy-guide-visual ${guide.id}`);
    visual.setAttribute('role', 'img');
    visual.setAttribute('aria-label', guide.id === 'french'
      ? 'French board with a double in the centre and four arms'
      : 'Across seating with one person controlling Players 1 and 3, and the opponent controlling Players 2 and 4');
    if (guide.id === 'french') {
      for (const [tile, place] of [['0-2', 'north'], ['0-3', 'east'], ['0-4', 'south'], ['0-5', 'west'], ['0-0', 'centre']] as const) {
        const bone = tileEl(tile);
        bone.classList.add(place);
        bone.setAttribute('aria-hidden', 'true');
        visual.append(bone);
      }
    } else {
      for (const [label, place, side] of [
        ['Player 3', 'north', 'you'], ['Player 2', 'east', 'them'],
        ['Player 1', 'south', 'you'], ['Player 4', 'west', 'them'],
      ] as const) {
        visual.append(el('span', `guide-seat ${place} ${side}`, label));
      }
      visual.append(el('span', 'guide-side you', 'You'), el('span', 'guide-side them', 'Opponent'));
    }
    card.append(
      visual,
      el('div', 'eyebrow', guide.eyebrow),
      el('h3', undefined, guide.title),
      el('p', undefined, guide.body),
      el('strong', 'academy-guide-takeaway', guide.takeaway),
    );
    guideGrid.append(card);
  }
  guides.append(guideGrid);
  frag.append(guides);

  for (const b of BELTS) {
    const card = el('div', 'belt');
    const isOpen = openBelt === b.id || b.lessons.some((l) => l.id === openLesson);
    if (isOpen) card.classList.add('open');

    const head = document.createElement('button');
    head.className = 'row belt-head';
    head.setAttribute('aria-expanded', String(isOpen));
    head.append(el('div', 'num', String(b.index)));
    const titles = el('div', 'stack');
    titles.append(el('h2', undefined, b.title), el('div', 'muted', b.subtitle));
    head.append(titles);
    head.onclick = () => { openBelt = isOpen ? null : b.id; openLesson = null; openDrill = null; render(); };
    card.appendChild(head);

    if (isOpen) {
      for (const lesson of b.lessons) {
        const item = el('div', 'lesson');
        const lessonIsOpen = lesson.id === openLesson;
        if (lessonIsOpen) item.classList.add('critical', 'lesson-open');
        const lessonHead = document.createElement('button');
        lessonHead.className = 'academy-lesson-head';
        lessonHead.setAttribute('aria-expanded', String(lessonIsOpen));
        lessonHead.append(
          el('span', 'academy-lesson-id', lesson.id),
          el('strong', undefined, lesson.title),
          el('span', 'academy-lesson-toggle', lessonIsOpen ? 'Close' : 'Open'),
        );
        lessonHead.onclick = () => { openLesson = lessonIsOpen ? null : lesson.id; openDrill = null; render(); };
        item.appendChild(lessonHead);

        if (lessonIsOpen) {
          const visual = ACADEMY_VISUALS[lesson.id];
          if (visual) {
            const figure = document.createElement('figure');
            figure.className = 'academy-figure';
            const image = document.createElement('img');
            image.src = `/art/boards/${lesson.id}.svg`;
            image.alt = visual.alt;
            image.width = 760;
            image.height = 380;
            figure.append(image);
            figure.append(el('figcaption', undefined, visual.notice));
            item.appendChild(figure);
          }
          const explanation = el('div', 'academy-explanation');
          explanation.append(el('div', 'eyebrow', 'Why it matters'));
          explanation.append(el('p', undefined, lesson.body));
          item.appendChild(explanation);
          if (visual) {
            const take = el('div', 'academy-takeaway');
            take.append(el('div', 'eyebrow', 'Take it to the table'));
            take.append(el('strong', undefined, visual.takeaway));
            item.appendChild(take);
            const check = document.createElement('details');
            check.className = 'academy-check';
            const prompt = document.createElement('summary');
            prompt.textContent = `Try it · ${visual.tryIt}`;
            check.append(prompt, el('p', undefined, visual.answer));
            item.appendChild(check);
          }
          if (lesson.terms?.length) {
            const terms = el('div', 'terms');
            for (const t of lesson.terms) terms.append(el('span', undefined, t));
            item.appendChild(terms);
          }
        }
        card.appendChild(item);
      }
      const drills = el('div', 'lesson');
      drills.append(el('div', 'eyebrow', 'Practise the read'), el('h3', undefined, 'Drills'));
      for (const d of b.drills) {
        const active = openDrill === d.id;
        const card = el('section', `academy-drill${active ? ' open' : ''}`);
        const trigger = document.createElement('button');
        trigger.className = 'academy-drill-head';
        trigger.setAttribute('aria-expanded', String(active));
        trigger.append(
          el('span', 'academy-lesson-id', d.id),
          el('strong', undefined, d.prompt),
          el('span', 'academy-lesson-toggle', active ? 'Close' : 'Start'),
        );
        trigger.onclick = () => {
          openDrill = active ? null : d.id;
          openLesson = null;
          if (!active) drillAnswers.delete(d.id);
          render();
        };
        card.appendChild(trigger);
        if (active) {
          const scenario = scenarioFor(d);
          card.append(el('p', 'academy-drill-setup', scenario.setup));
          const choices = el('div', 'academy-drill-choices');
          const selected = drillAnswers.get(d.id);
          scenario.choices.forEach((choice, index) => {
            const button = document.createElement('button');
            button.className = 'academy-drill-choice';
            if (selected === index) button.classList.add(choice.correct ? 'correct' : 'wrong');
            if (/^[0-6]-[0-6]$/.test(choice.label)) {
              button.setAttribute('aria-label', `Choose ${choice.label}`);
              const tile = tileEl(choice.label as TileId);
              tile.setAttribute('aria-hidden', 'true');
              tile.removeAttribute('role');
              button.append(tile, el('span', undefined, choice.label));
            } else {
              button.textContent = choice.label;
            }
            button.disabled = selected !== undefined;
            button.onclick = () => { drillAnswers.set(d.id, index); render(); };
            choices.appendChild(button);
          });
          card.appendChild(choices);
          if (selected !== undefined) {
            const choice = scenario.choices[selected];
            const result = el('div', `academy-drill-result ${choice.correct ? 'correct' : 'wrong'}`);
            result.setAttribute('role', 'status');
            result.append(
              el('strong', undefined, choice.correct ? 'You read it right.' : 'Look at the table again.'),
              el('p', undefined, choice.explanation),
            );
            if (!choice.correct) {
              const retry = document.createElement('button');
              retry.className = 'act ghost';
              retry.textContent = 'Try again';
              retry.onclick = () => { drillAnswers.delete(d.id); render(); };
              result.appendChild(retry);
            }
            card.appendChild(result);
          }
        }
        drills.appendChild(card);
      }
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
  foot.appendChild(checkForUpdateLink());
  foot.appendChild(el('span', undefined, `© ${new Date().getFullYear()} YaadDominoes`));
  return foot;
}

let checkingUpdate = false;
let checkedUpToDate = false;

/**
 * A manual "is there anything new" control, for an installed app with no
 * browser chrome to pull-to-refresh with. The automatic check on
 * visibilitychange (pwa.ts) covers the common case; this is the visible
 * escape hatch for "I don't want to wait, check right now."
 */
function checkForUpdateLink(): HTMLElement {
  const link = document.createElement('button');
  link.className = 'linky';
  link.textContent = checkingUpdate ? 'Checking…' : checkedUpToDate ? "You're up to date" : 'Check for updates';
  link.disabled = checkingUpdate;
  link.onclick = () => void (async () => {
    checkingUpdate = true;
    checkedUpToDate = false;
    render();
    await checkForUpdate();
    // `reg.update()` resolving only means the browser finished comparing
    // sw.js byte-for-byte — if it differs, installing the new worker and
    // firing the event that flips updatePending() true happens
    // asynchronously afterward, not before. Give that a moment before
    // trusting a negative result, or a genuine update can land a beat after
    // this already told the player they were up to date.
    await new Promise((r) => setTimeout(r, 1200));
    checkingUpdate = false;
    checkedUpToDate = !updatePending();
    render();
  })();
  return link;
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
      // Carries the green of the felt into the signal-blue room so the half
      // below the fold still reads as the same table rather than another site.
      app.appendChild(el('div', 'yard-band'));
      const card = installCard();
      if (card) app.appendChild(card);
      app.appendChild(lobby());
      app.appendChild(brandStories());
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
      app.appendChild(loungeModule
        ? loungeModule.loungesView(scheduleRender, () => { view = 'membership'; scheduleRender(); })
        : pending('Opening the lounges'));
    }
  } else if (view === 'terms') {
    app.appendChild(termsView());
  } else if (view === 'privacy') {
    app.appendChild(privacyView());
  } else if (view === 'academy') {
    app.appendChild(academyView());
  } else if (view === 'membership') {
    app.appendChild(loungeModule ? loungeModule.membershipView(scheduleRender) : pending('Loading membership'));
  } else {
    app.appendChild(fairView());
  }

  // Not during a live hand — the table is full-bleed and a footer under it
  // reads as the game having ended.
  if (!(view === 'play' && game)) app.appendChild(legalFooter());
}

/**
 * render() does `app.innerHTML = ''` then rebuilds the entire page from
 * scratch — necessarily, given this app's whole rendering model (see
 * client.md). That is fine for ONE render, but several event sources fire
 * more than one event per real thing that happened: a single duppy move
 * emits both 'played'/'passed' AND 'state' (local.ts), a single online move
 * can emit 'penalty' AND 'state' back to back (onlinetable.ts) — and each
 * one calling render() directly meant the whole page blanked and rebuilt
 * two or three times, synchronously, for one move. Invisible on a fast
 * machine, a visible flash on a slower one — which is exactly why this
 * reads as "flickering on the tablet, fine on the laptop" rather than a
 * clear-cut bug on every device. Coalescing to one render per tick, no
 * matter how many times it's requested, fixes both: the human-set 420ms
 * pacing between duppy moves still shows one clean render per move, it's
 * just never a double.
 */
let renderScheduled = false;
function scheduleRender() {
  if (renderScheduled) return;
  renderScheduled = true;
  queueMicrotask(() => {
    renderScheduled = false;
    render();
  });
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
} else if (new URLSearchParams(window.location.search).get('recovery') === '1') {
  // A password-reset link can land on a browser that has never opened
  // Lounges/Membership before (a different device, a cleared one) — the
  // lounge module owns the Supabase client that actually parses the
  // recovery tokens out of this URL, so it has to load regardless of
  // whether this visitor would otherwise have triggered it.
  view = 'membership';
  void ensureLoungeModule();
}
