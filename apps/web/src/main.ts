import { BELTS, lessonByRef, knownVoids, GRADE_LABEL } from '@yard/engine';
import type { DuppyLevel, GameMode, HandReview, Move, SetFormat } from '@yard/engine';
import { LocalGame } from './local.ts';
import { tileEl, renderBoard, backsEl, scoreTrack, el } from './render.ts';
import {
  platform, promptInstall, watchInstallability, registerServiceWorker,
  applyUpdate, updatePending, IOS_STEPS,
} from './pwa.ts';

type View = 'play' | 'lounges' | 'academy' | 'membership' | 'fair';

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

async function ensureLoungeModule() {
  if (loungeModule || loungeLoading) return;
  loungeLoading = true;
  try {
    loungeModule = await import('./loungeview.ts');
    await loungeModule.loadLounges(render);
  } finally {
    loungeLoading = false;
    render();
  }
}
let view: View = 'play';
let game: LocalGame | null = null;
let review: HandReview | null = null;
let openBelt: string | null = null;
let openLesson: string | null = null;
let verifyState: { ok: boolean; reason?: string } | null = null;
let installDismissed = false;

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

  const card = el('div', 'install-card');
  card.append(el('div', 'eyebrow', 'Put it on your phone'));

  if (p === 'prompt') {
    card.append(el('h2', undefined, 'Install Yard'));
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
    card.append(el('h2', undefined, 'Add Yard to your home screen'));
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
      'On iPhone, only Safari can add an app to the home screen. Open yard in Safari, then tap Share and Add to Home Screen.'));
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
    midHand ? 'A new version is ready — it will apply after this hand.' : 'A new version of Yard is ready.'));
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
  const h1 = el('h1', undefined, 'Yard');
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
      view = id as View;
      if (id === 'lounges' || id === 'membership') void ensureLoungeModule();
      render();
    };
    nav.appendChild(b);
  }
  bar.append(brand, nav);
  return bar;
}

// ----------------------------------------------------------------- lobby --
function lobby(): HTMLElement {
  const panel = el('div', 'panel');
  panel.append(
    el('div', 'eyebrow', 'Start a game'),
    el('h2', undefined, 'Sit down'),
  );

  const form = el('div', 'row');
  form.style.marginTop = '14px';

  const mode = document.createElement('select');
  mode.innerHTML = `<option value="partner">Partner — 2 v 2</option>
                    <option value="cutthroat">Cut throat — every man for himself</option>`;

  const format = document.createElement('select');
  const syncFormat = () => {
    // Cut throat six love runs to a median of ~196 hands. Never make it the
    // default on a phone; players abandon halfway and everyone loses.
    format.innerHTML = mode.value === 'partner'
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
  go.onclick = async () => {
    game = new LocalGame({
      mode: mode.value as GameMode,
      format: format.value as SetFormat,
      seatCount: 4,
      duppy: duppy.value as DuppyLevel,
      tournament: tournament.value === '1',
      oneAllPlayTwo: true,
    });
    game.on(() => render());
    review = null;
    verifyState = null;
    await game.startHand();
    render();
  };

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

  if (g.options.mode === 'partner') {
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
    if (g.options.mode === 'partner' && seat !== g.mySeat && seat % 2 === g.mySeat % 2) {
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
    wrap.appendChild(card);
  }
  return wrap;
}

let pendingTile: string | null = null;

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
    if (g.options.mode === 'partner') {
      panel.append(el('p', 'muted',
        'Lowest single hand takes it — a partner\'s tiles never come into it.'));
    }
  }
  if (g.lastResultBruk) {
    panel.append(el('p', 'muted', 'Score bruk. Back to love all, and the six opens.'));
  }

  const row = el('div', 'row');

  if (g.set.winnerSide === null) {
    const next = document.createElement('button');
    next.className = 'act';
    next.textContent = 'Next hand';
    next.onclick = async () => { review = null; verifyState = null; await g.startHand(); render(); };
    row.appendChild(next);
  } else {
    const again = document.createElement('button');
    again.className = 'act';
    again.textContent = 'New set';
    again.onclick = () => { game = null; review = null; render(); };
    row.appendChild(again);
  }

  const coach = document.createElement('button');
  coach.className = 'act ghost';
  coach.textContent = review ? 'Hide review' : 'Review this hand';
  coach.onclick = () => { review = review ? null : g.review(); render(); };
  row.appendChild(coach);

  const check = document.createElement('button');
  check.className = 'act ghost';
  check.textContent = 'Verify this deal';
  check.onclick = async () => { verifyState = await g.verify(); render(); };
  row.appendChild(check);

  panel.appendChild(row);

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

function tableView(g: LocalGame): DocumentFragment {
  const frag = document.createDocumentFragment();
  frag.appendChild(scoreboard(g));

  const felt = el('div', 'table-felt');
  const line = el('div', 'line');
  renderBoard(line, g.hand?.board ?? null);
  felt.appendChild(line);
  frag.appendChild(felt);
  requestAnimationFrame(() => { felt.scrollLeft = (felt.scrollWidth - felt.clientWidth) / 2; });

  frag.appendChild(seats(g));
  frag.appendChild(myHand(g));
  const result = handResult(g);
  if (result) frag.appendChild(result);
  if (review) frag.appendChild(coachPanel(g, review));
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

  if (view === 'play') {
    if (!game) {
      const card = installCard();
      if (card) app.appendChild(card);
    }
    app.appendChild(game ? tableView(game) : lobby());
  } else if (view === 'lounges') {
    app.appendChild(loungeModule ? loungeModule.loungesView(render) : pending('Opening the lounges'));
  } else if (view === 'academy') {
    app.appendChild(academyView());
  } else if (view === 'membership') {
    app.appendChild(loungeModule ? loungeModule.membershipView(render) : pending('Loading membership'));
  } else {
    app.appendChild(fairView());
  }
}

// --- bootstrap --------------------------------------------------------------
watchInstallability(render);
registerServiceWorker(render);
render();
