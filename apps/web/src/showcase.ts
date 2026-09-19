/**
 * Yard TV: a private, never-ending teaching table for a 24/7 stream.
 *
 * Owner, 2026-09-17: stream on YouTube around the clock, teaching people all
 * five games. The games take turns, each opening with a card that says how it
 * is played. Every hand is shuffled and dealt on screen, all hands are face
 * up, and the side panel says what each move means and why a player chose it
 * over the alternative (the engine's own move advice). Duppies talk in speech
 * bubbles, one of them with the game's recorded Jamaican voice, and the cast
 * changes every game.
 *
 * Music is deliberately NOT here: the licence forbids serving the raw files
 * from a website, so it is added in OBS on the streaming computer.
 *
 * Opens only with the secret key in the link (?k=...). That keeps strangers
 * out; it is not account security, and the page holds nothing private. Runs
 * entirely in the streaming computer's browser. A fixed 1920x1080 stage, scaled
 * to the window, for an OBS browser source.
 */
import {
  adviseMoves, applyHandResult, applyMove, createSet, deal, duppyLine, duppyMove, isDouble,
  legalMoves, openEnds, publicView, TALK_CHANCE,
} from '@yard/engine';
import type {
  DuppyLevel, GameMode, HandState, Move, MoveAdvice, SetFormat, SetState, TalkTrigger, TileId,
} from '@yard/engine';
import { ACROSS_CLIMB, deskRouteGeometry, el, penaltyLines, renderBoard, tileEl } from './render.ts';
import { DUPPY_PERSONAS, duppyPersonaUrl } from './duppy-persona.ts';
import type { DuppyPersona } from './duppy-persona.ts';
import { lineFor, speak } from './speak.ts';
import './styles.css';
import './showcase.css';

/** The link must carry this. Change it to retire an old link. */
const SHOWCASE_KEY = 'ayaO-XrikQn1SBTzq7mBHV0w';

interface GameSpec {
  title: string;
  intro: string[];
  mode: GameMode;
  format: SetFormat;
}

const GAMES: GameSpec[] = [
  {
    title: 'Partner',
    intro: [
      'Two against two. Partners sit opposite each other.',
      'Play goes anticlockwise. Match a number on either end.',
      'Win six hands while the other side is still on love: six love!',
    ],
    mode: 'partner', format: 'sixlove',
  },
  {
    title: 'Cut throat',
    intro: [
      'Every player for themself. No partners.',
      'Seven bones each. Match a number on either end.',
      'First to win six hands takes the game.',
    ],
    mode: 'cutthroat', format: 'firstToSix',
  },
  {
    title: 'Open hand',
    intro: [
      'Partner rules, but partners can see each other\'s bones.',
      'Play to help your partner, and block the other side.',
      'Win six hands while the other side is still on love.',
    ],
    mode: 'openhand', format: 'sixlove',
  },
  {
    title: 'Across',
    intro: [
      'One player plays both hands of a partnership.',
      'Partner rules, and the line climbs three bones between rows.',
      'Win six hands while the other side is still on love.',
    ],
    mode: 'across', format: 'sixlove',
  },
  {
    title: 'French',
    intro: [
      'Every player for themself. The double-blank opens the first hand.',
      'The board grows four arms. The bones left in your hand count against you.',
      'Shut everyone out and they each take 10: a board pass.',
      'When someone reaches 100, the lowest score wins.',
    ],
    mode: 'cutthroat', format: 'french',
  },
];

const NAMES: Record<DuppyPersona, string> = {
  breeze: 'Breeze', rally: 'Rally', miss_mavis: 'Miss Mavis', tyrone: 'Tyrone', auntie_vee: 'Auntie Vee',
  uncle_desmond: 'Uncle Desmond', miss_joy: 'Miss Joy', mr_chen: 'Mr Chen', keisha: 'Keisha', owen: 'Owen',
};
const ALL_PERSONAS = Object.keys(NAMES) as DuppyPersona[];
/** Which duppy tier a persona talks like; they all play at Don strength. */
const TALK_LEVEL = (persona: DuppyPersona): DuppyLevel =>
  (Object.keys(DUPPY_PERSONAS) as DuppyLevel[]).find((level) => DUPPY_PERSONAS[level].includes(persona)) ?? 'yard';

/** Seats go anticlockwise, so seat + 1 sits on the physical right. */
const SLOTS = ['bottom', 'right', 'top', 'left'] as const;

/** Beats, in ms. Slow enough for a newcomer to follow on a stream. */
const MOVE_MS = 3600;
const REASON_MS = 2400;
const PASS_MS = 2800;
const HAND_END_MS = 9000;
const SET_END_MS = 14000;
const INTRO_MS = 14000;
const TIP_MS = 22000;
/** A game hands over to the next after this long, at the end of a hand. */
const GAME_MS = 25 * 60 * 1000;

const TIPS = [
  'Play goes anticlockwise, to your right.',
  'A pass tells the whole table you hold none of the numbers showing.',
  'Blocked? Nobody can play. The lowest count in a single hand wins it.',
  'Bruk: if the side on love wins, it\'s back to love-all, and the next hand is worth 2.',
  'There are seven of each number in the set. Count what has gone.',
  'Doubles are hard to get rid of. Play them early.',
  'If your partner passed on a number, don\'t leave that number on the board.',
  'Hold a variety of numbers. A hand full of one number is easy to block.',
  'Play free at yaaddominoes.com, no sign-up needed to practice.',
];

function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  const random = new Uint32Array(out.length);
  crypto.getRandomValues(random);
  for (let i = out.length - 1; i > 0; i--) {
    const j = random[i] % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function fullSet(): TileId[] {
  const tiles: TileId[] = [];
  for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) tiles.push(`${a}-${b}`);
  return tiles;
}

/** `&fast=1` runs the whole rotation quickly, to check it before going live. */
const FAST = new URLSearchParams(location.search).has('fast');
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, FAST ? ms / 12 : ms));

/** The subscribe nudge's rhythm: once every few minutes, held long enough to
 *  read twice, then gone. `?fast` shortens it the same way every other beat
 *  on this page is shortened, so it can be checked without a five-minute
 *  wait. */
const SUBSCRIBE_FIRST_MS = FAST ? 6_000 : 75_000;
const SUBSCRIBE_EVERY_MS = FAST ? 20_000 : 210_000;
const SUBSCRIBE_HOLD_MS = FAST ? 4_000 : 18_000;
const bone = (tile: TileId) => tile.replace('-', '/');
const pipWord = (pip: number) => (pip === 0 ? 'blank' : String(pip));
const listOr = (words: string[]) => (words.length > 1 ? `${words.slice(0, -1).join(', ')} or ${words.at(-1)}` : words[0] ?? '');
const listAnd = (words: string[]) => (words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : words[0] ?? '');
const partnered = (spec: GameSpec) => spec.mode !== 'cutthroat';

class Showcase {
  private cast: DuppyPersona[] = ALL_PERSONAS.slice(0, 4);
  private spec: GameSpec = GAMES[0];
  private readonly stage = el('div', 'showcase-stage');
  private readonly table = el('div', 'showcase-table');
  private readonly felt = el('div', 'showcase-felt table-felt');
  private readonly boardStage = el('div', 'showcase-board');
  private readonly line = el('div', 'line');
  private readonly seats: { box: HTMLElement; face: HTMLImageElement; name: HTMLElement; points: HTMLElement; hand: HTMLElement; bubble: HTMLElement }[] = [];
  private readonly title = el('div', 'showcase-sub');
  private readonly score = el('div', 'showcase-score');
  private readonly caption = el('div', 'showcase-caption');
  private readonly reason = el('div', 'showcase-reason');
  private readonly tip = el('div', 'showcase-tip-text');
  /**
   * The subscribe nudge. Deliberately occasional rather than permanent: a
   * badge that is always there stops being read after a minute, and a stream
   * that begs constantly is the thing people mute. It slides in under the
   * play line, holds long enough to read twice, and goes away.
   */
  private readonly subscribe = el('div', 'showcase-subscribe');

  constructor(root: HTMLElement) {
    document.title = 'Yard TV · YaadDominoes';
    document.body.classList.add('showcase-body');
    root.replaceChildren(this.stage);
    const fit = () => {
      const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
      this.stage.style.transform = `scale(${scale})`;
    };
    window.addEventListener('resize', fit);
    fit();

    const table = this.table;
    this.boardStage.appendChild(this.line);
    this.felt.appendChild(this.boardStage);
    table.appendChild(this.felt);
    SLOTS.forEach((slot) => {
      const box = el('div', `showcase-seat showcase-seat-${slot}`);
      const face = document.createElement('img');
      face.className = 'showcase-face';
      face.alt = '';
      const name = el('div', 'showcase-name');
      // Points at the seat, not only in the side panel (owner, 2026-09-18).
      // A viewer watching the table should never have to look away from it to
      // know where the game stands — and in French, where the whole game is a
      // race to 100, the number beside the player IS the game.
      const points = el('div', 'showcase-points');
      const head = el('div', 'showcase-seat-head');
      head.append(face, name, points);
      const hand = el('div', 'showcase-hand');
      const bubble = el('div', 'showcase-bubble');
      bubble.hidden = true;
      box.append(head, hand, bubble);
      table.appendChild(box);
      this.seats.push({ box, face, name, points, hand, bubble });
    });

    const side = el('aside', 'showcase-side');
    const brand = el('div', 'showcase-brand');
    brand.append(el('span', 'word-yaad', 'YAAD'), ' ', el('span', 'word-dominoes', 'DOMINOES'));
    const tipBox = el('div', 'showcase-tip');
    tipBox.append(el('div', 'showcase-tip-head', 'Yard tip'), this.tip);
    side.append(brand, this.title, this.score, this.caption, this.reason, tipBox,
      el('div', 'showcase-cta', 'Play free at yaaddominoes.com'),
      this.subscribe);
    this.stage.append(table, side);

    this.subscribe.append(el('span', 'showcase-subscribe-mark', '\u25b6'),
      el('span', undefined, 'Like & subscribe for more Jamaican dominoes'));
    this.subscribe.setAttribute('role', 'note');
    // Every SUBSCRIBE_EVERY_MS, visible for SUBSCRIBE_HOLD_MS. The first one
    // waits, so it never lands over the opening card a new viewer is reading.
    const showSubscribe = () => {
      this.subscribe.classList.add('showcase-subscribe-in');
      setTimeout(() => this.subscribe.classList.remove('showcase-subscribe-in'), SUBSCRIBE_HOLD_MS);
    };
    setTimeout(() => { showSubscribe(); setInterval(showSubscribe, SUBSCRIBE_EVERY_MS); }, SUBSCRIBE_FIRST_MS);

    let tipIndex = 0;
    this.tip.textContent = TIPS[0];
    setInterval(() => {
      tipIndex = (tipIndex + 1) % TIPS.length;
      this.tip.textContent = TIPS[tipIndex];
    }, TIP_MS);
  }

  private name(seat: number): string {
    return NAMES[this.cast[seat]];
  }

  private team(seat: number): string {
    const a = this.name(seat % 2 === 0 ? 0 : 1).split(' ').at(-1);
    const b = this.name(seat % 2 === 0 ? 2 : 3).split(' ').at(-1);
    return `${a} & ${b}`;
  }

  private say(seat: number, trigger: TalkTrigger, force = false) {
    const roll = Math.random();
    // Seat 1 has the game's recorded voice; its bubble shows exactly what it says.
    const voiced = seat === 1 ? lineFor(1, trigger, roll) : null;
    const level = TALK_LEVEL(this.cast[seat]);
    const text = voiced ?? duppyLine(level, trigger, roll, force ? 1 : TALK_CHANCE[level]);
    if (!text) return;
    if (voiced) speak(1, trigger, roll);
    const { bubble } = this.seats[seat];
    bubble.textContent = text;
    bubble.hidden = false;
    window.setTimeout(() => { if (bubble.textContent === text) bubble.hidden = true; }, 3200);
  }

  private setCast() {
    this.cast = shuffled(ALL_PERSONAS).slice(0, 4);
    this.seats.forEach((seat, index) => {
      seat.face.src = duppyPersonaUrl(this.cast[index]);
      seat.name.textContent = this.name(index);
    });
  }

  private geometry() {
    const box = { width: 880, height: 660 };
    return this.spec.mode === 'across'
      ? deskRouteGeometry(box, [], 12, 26, ACROSS_CLIMB)
      : deskRouteGeometry(box, [], 12, 26);
  }

  private draw(hand: HandState | null, set: SetState) {
    const board = hand?.board ?? null;
    if (board?.kind === 'cross') {
      this.line.removeAttribute('style');
      renderBoard(this.line, board, {
        box: { width: 880, height: 660 }, unit: 16, maxUnit: 16, minUnit: 8,
        fitCrossToBox: true, frenchPinwheel: true, moveLog: hand?.moveLog, viewerSeat: 0,
      });
    } else {
      const geo = this.geometry();
      this.boardStage.style.setProperty('--table-bone-short', `${geo.unit * 2}px`);
      renderBoard(this.line, board, {
        unit: geo.unit, maxUnit: geo.unit, minUnit: geo.unit,
        moveLog: hand?.moveLog,
        phoneRoute: { cols: geo.cols, rows: geo.rows, origin: geo.origin, blocked: geo.blocked, climb: geo.climb },
        viewerSeat: 0,
      });
      this.line.style.position = 'absolute';
      this.line.style.left = `${geo.left}px`;
      this.line.style.top = `${geo.top}px`;
      this.line.style.margin = '0';
    }
    const french = this.spec.format === 'french';
    this.seats.forEach(({ box, hand: rack, points }, seat) => {
      box.classList.toggle('showcase-turn', !!hand && hand.status === 'active' && hand.turn === seat);
      rack.replaceChildren(...(hand?.hands[seat] ?? []).map((t) => tileEl(t)));
      // A partner's points belong to the side, so both seats of a side show
      // the same number — that is what the pair is actually playing for.
      const score = partnered(this.spec) ? set.scores[seat % 2] ?? 0 : set.scores[seat] ?? 0;
      points.textContent = score === 0 && !french ? 'love' : String(score);
      points.classList.toggle('showcase-points-love', score === 0 && !french);
      // French counts UP to 100 and the lowest score wins, so a big number is
      // bad news there and must not wear the winning colour.
      points.classList.toggle('showcase-points-high', french && score >= 70);
      points.setAttribute('aria-label', `${this.name(seat)}: ${score} point${score === 1 ? '' : 's'}`);
    });
    const row = (label: string, value: string) => {
      const r = el('div', 'showcase-score-row');
      r.append(el('span', undefined, label), el('span', undefined, value));
      return r;
    };
    const rows: HTMLElement[] = [];
    if (partnered(this.spec)) {
      rows.push(row(this.team(0), set.scores[0] === 0 ? 'love' : String(set.scores[0])));
      rows.push(row(this.team(1), set.scores[1] === 0 ? 'love' : String(set.scores[1])));
    } else {
      this.cast.forEach((_, seat) => rows.push(row(this.name(seat), String(set.scores[seat]))));
    }
    if (this.spec.format !== 'french' && set.handValue > 1) rows.push(el('div', 'showcase-worth', `This hand is worth ${set.handValue}`));
    this.score.replaceChildren(...rows);
  }

  /** What just happened, in plain words. */
  private describe(before: HandState, move: Move, after: HandState): string {
    const who = this.name(move.seat);
    if (move.kind === 'pass') {
      const ends = before.board ? [...new Set(openEnds(before.board))].map(pipWord) : [];
      return `${who} passes. Now everyone knows ${who} has no ${listOr(ends)}.`;
    }
    if (move.kind === 'askpose') {
      return `${who} has no double to pose, so takes 10 and asks ${this.name(move.target)} to pose.`;
    }
    if (!('tile' in move)) return `${who} plays.`;
    if (move.kind === 'pose') {
      if (move.tile === '6-6') return `${who} poses the double-six. It opens the first hand.`;
      if (move.tile === '0-0') return `${who} poses the double-blank, the double blank. It opens French.`;
      return `${who} poses the ${bone(move.tile)} to start the hand.`;
    }
    const ends = after.board ? [...new Set(openEnds(after.board))].map(pipWord) : [];
    const left = after.hands[move.seat].length;
    const double = isDouble(move.tile) ? ' A double goes down crosswise.' : '';
    const last = left === 1 ? ` ${who} has one bone left!` : '';
    const endsText = ends.length ? ` Open ends: ${listAnd(ends)}.` : '';
    return `${who} plays the ${bone(move.tile)}.${double}${endsText}${last}`;
  }

  /** Why this bone and not another: the engine's own advice for this seat. */
  /**
   * Why this bone and not another. `adviseMoves` comes back ranked best
   * first, and that ranking is the whole basis of the sentence.
   *
   * Two cases, because a duppy does not always take the strongest line and
   * this is a teaching channel (owner, 2026-09-19, after reading a caption
   * that did not make sense): if the played bone IS the top-ranked one, the
   * sentence compares it with the genuine runner-up — the play somebody
   * would actually have argued for. If it is NOT, the caption says which
   * bone was stronger instead of inventing a defence of a weaker move.
   * The old version compared against whatever alternative happened to come
   * first in the list, which is how you end up explaining why a good bone
   * beats one nobody was considering.
   */
  private why(before: HandState, move: Move): string | null {
    if (move.kind !== 'play' && move.kind !== 'playcross') return null;
    const legal = legalMoves(before);
    const tiles = new Set(legal.flatMap((m) => ('tile' in m ? [m.tile] : [])));
    if (tiles.size < 2) return null;
    const ranked = adviseMoves(publicView(before, move.seat), legal, 'general');
    const index = ranked.findIndex((a) => a.tile === move.tile);
    const chosen = ranked[index];
    if (!chosen) return null;
    const who = this.name(move.seat);
    const names = (seats: number[]) => listAnd(seats.map((s) => this.name(s)));

    /** The strongest single reason to prefer `pick` over `instead`, or null. */
    const reasonFor = (pick: MoveAdvice, instead: MoveAdvice): string | null => {
      if (pick.goesOut) return 'it is the last bone, so it wins the hand';
      // The two strongest things a yard player actually plays for, above any
      // talk of heavy bones: shutting the table out so the board comes
      // straight back, and refusing to open a number you cannot answer.
      if (pick.comesBackToMe) {
        return `every other seat is stuck on what it leaves, so the board comes straight back to ${who}`;
      }
      if (pick.forcesOpponents.length) {
        return `it leaves ${listAnd([...new Set(pick.endsAfter)].map((pip) => pipWord(pip)))} open, and ${names(pick.forcesOpponents)} cannot play on that`;
      }
      if (partnered(this.spec) && instead.strandsPartner.length && !pick.strandsPartner.length) {
        return `the ${bone(instead.tile)} would leave a ${listOr([...new Set(instead.strandsPartner)].map((pip) => pipWord(pip)))}, and ${who}'s partner has already passed on it`;
      }
      if (!pick.cannotAnswer.length && instead.cannotAnswer.length) {
        return `${who} can still answer whatever it leaves, but the ${bone(instead.tile)} would leave a ${listOr([...new Set(instead.cannotAnswer)].map((pip) => pipWord(pip)))} ${who} has no more of`;
      }
      if (!pick.opensNew.length && instead.opensNew.length) {
        return `it puts out no new number, while the ${bone(instead.tile)} would open a ${listOr([...new Set(instead.opensNew)].map((pip) => pipWord(pip)))} for the whole table`;
      }
      if (pick.unloadsDouble) return 'it gets the double off before it can get stuck';
      if (pick.pipsShed >= instead.pipsShed + 3) {
        return `it drops ${pick.pipsShed} pips, a heavier bone, in case the board blocks`;
      }
      return null;
    };

    if (index === 0) {
      const runnerUp = ranked.find((a) => a.tile !== move.tile);
      if (!runnerUp) return null;
      const reason = reasonFor(chosen, runnerUp);
      return reason ? `Why the ${bone(move.tile)}, not the ${bone(runnerUp.tile)}? Because ${reason}.` : null;
    }

    const best = ranked[0];
    if (!best || best.tile === move.tile) return null;
    const reason = reasonFor(best, chosen);
    return reason ? `The ${bone(best.tile)} was the stronger play: ${reason}.` : null;
  }


  private describeEnd(hand: HandState, set: SetState, before: SetState): string {
    const r = hand.result!;
    if (this.spec.format === 'french') {
      const leader = set.scores.indexOf(Math.min(...set.scores));
      const opening = r.tie ? 'Blocked and tied: the hand is shuffled again.'
        : r.status === 'domino' ? `Domino! ${this.name(r.winnerSeat!)} plays out and adds nothing.`
          : 'Blocked! Everyone adds the pips left in their hand.';
      if (set.winnerSide !== null) return `${opening} Someone reached 100, so ${this.name(set.winnerSide)} wins French with the lowest score!`;
      return `${opening} Lowest score so far: ${this.name(leader)} on ${set.scores[leader]}.`;
    }
    if (r.tie) return 'Blocked, and the lowest counts are tied. The hand is played again, worth 2.';
    const who = this.name(r.winnerSeat!);
    const side = partnered(this.spec) ? this.team(r.winnerSeat!) : who;
    const opening = r.status === 'domino'
      ? `Domino! ${who} plays out.`
      : `Blocked! Nobody can play. ${who} has the lowest count, ${r.counts[r.winnerSeat!]}.`;
    if (set.winnerSide !== null) {
      return set.sixLove ? `${opening} SIX LOVE for ${side}!` : `${opening} ${side} win the game!`;
    }
    const bruk = set.scores.every((v) => v === 0) && before.scores.some((v) => v > 0);
    if (bruk) return `${opening} BRUK! It's back to love-all, and the next hand is worth 2.`;
    return `${opening} ${side} score.`;
  }

  private async intro() {
    const card = el('div', 'showcase-intro');
    card.append(el('div', 'showcase-intro-now', 'Now playing'), el('div', 'showcase-intro-title', this.spec.title));
    for (const text of this.spec.intro) card.append(el('div', 'showcase-intro-line', text));
    this.felt.appendChild(card);
    this.caption.textContent = `Next up: ${this.spec.title}.`;
    this.reason.textContent = '';
    await wait(INTRO_MS);
    card.remove();
  }

  /**
   * The real 28 bones, face down on the real table, jumbled and then dealt
   * one at a time round the seats — not the app's branded deal animation,
   * which covered the felt with an abstract card and showed nothing that was
   * actually happening (owner, 2026-09-18: "I don't like the fake shuffle").
   *
   * Positions are worked out in the table's own layout coordinates
   * (offsetLeft/offsetTop), never getBoundingClientRect: the whole stage is
   * scaled to fit the viewport, so measured boxes are in scaled pixels and
   * would put every bone in the wrong place at any size but 1920x1080.
   *
   * Deals round the table, seven each, the way a person deals. The engine
   * hands out `order.slice(seat * 7, ...)` in blocks, which is the same 28
   * bones to the same four seats — nothing here decides who gets what, it
   * only shows the count going round.
   */
  private async shuffleAndDeal() {
    this.stage.classList.add('showcase-dealing');
    this.caption.textContent = 'Shuffling.';
    this.reason.textContent = '';
    const layer = el('div', 'showcase-shuffle');
    // The wordmark the app's own deal carries, so Yard TV's shuffle is branded
    // like every other game's (owner, 2026-09-18). It sits over the jumble and
    // clears the moment the dealing starts, so it never hides a bone landing.
    const mark = el('div', 'showcase-shuffle-mark');
    mark.append(el('strong', undefined, 'YAAD'), el('span', undefined, 'DOMINOES'));
    layer.appendChild(mark);
    this.table.appendChild(layer);

    const left = this.felt.offsetLeft, top = this.felt.offsetTop;
    const width = this.felt.offsetWidth, height = this.felt.offsetHeight;
    const centreX = left + width / 2, centreY = top + height / 2;
    const place = (bone: HTMLElement, x: number, y: number, turn: number) => {
      bone.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) rotate(${Math.round(turn)}deg)`;
    };
    // Where a bone sits in the spread. Kept per bone so the swirl can move
    // each one a little at a time instead of teleporting the whole set.
    const at = Array.from({ length: 28 }, () => ({ x: 0, y: 0, turn: 0 }));

    const bones: HTMLElement[] = [];
    for (let i = 0; i < 28; i += 1) {
      const bone = el('i', 'showcase-shuffle-bone');
      layer.appendChild(bone);
      bones.push(bone);
    }
    // Spread face down across the middle of the table, the way a set is
    // tipped out before anyone touches it.
    const spread = (bone: HTMLElement, i: number) => {
      const s = at[i];
      s.x = centreX - 18 + (Math.random() - 0.5) * width * 0.56;
      s.y = centreY - 36 + (Math.random() - 0.5) * height * 0.46;
      s.turn = (Math.random() - 0.5) * 120;
      place(bone, s.x, s.y, s.turn);
    };
    bones.forEach(spread);
    await wait(80);

    // The swirl (owner, 2026-09-19: the old version stacked them into a neat
    // pack and left the last pair sitting in the middle, which is not what a
    // yard shuffle looks like). Hands keep moving over the spread: each pass
    // nudges every bone a short distance and turns it, so the whole set is
    // always in motion and never lines up.
    const swirl = (strength: number) => {
      bones.forEach((bone, i) => {
        const s = at[i];
        const angle = Math.random() * Math.PI * 2;
        const reach = (30 + Math.random() * 90) * strength;
        s.x = Math.max(left + 20, Math.min(left + width - 56, s.x + Math.cos(angle) * reach));
        s.y = Math.max(top + 20, Math.min(top + height - 92, s.y + Math.sin(angle) * reach));
        s.turn += (Math.random() - 0.5) * 140;
        place(bone, s.x, s.y, s.turn);
      });
    };
    for (let pass = 0; pass < 6; pass += 1) {
      swirl(1);
      await wait(360);
    }

    // Drawn straight out of the spread, one at a time round the table — never
    // off a stack. The bones still on the table keep shifting under the hands
    // while the drawing happens, so nothing is ever left sitting abandoned.
    mark.classList.add('showcase-shuffle-mark-out');
    this.caption.textContent = 'Dealing — seven each.';
    const drop = (slot: number, nth: number): [number, number] => {
      const along = (nth - 3) * 26;
      if (slot === 0) return [centreX - 18 + along, top + height - 96];
      if (slot === 1) return [left + width - 66, centreY - 36 + along];
      if (slot === 2) return [centreX - 18 + along, top + 24];
      return [left + 30, centreY - 36 + along];
    };
    // Whichever bone is nearest the seat being dealt to is the one that hand
    // would actually pick up.
    const undealt = bones.map((bone, i) => ({ bone, i }));
    for (let n = 0; n < 28; n += 1) {
      const seat = n % 4;
      const [x, y] = drop(seat, Math.floor(n / 4));
      let pick = 0;
      let best = Infinity;
      undealt.forEach((entry, index) => {
        const s = at[entry.i];
        const d = (s.x - x) ** 2 + (s.y - y) ** 2;
        if (d < best) { best = d; pick = index; }
      });
      const [taken] = undealt.splice(pick, 1);
      taken.bone.classList.add('showcase-shuffle-dealt');
      place(taken.bone, x, y, 0);
      // Every few draws the remaining bones shift again — a real table never
      // holds still while somebody is dealing off it.
      if (n % 4 === 3 && undealt.length) {
        undealt.forEach(({ bone, i }) => {
          const s = at[i];
          const angle = Math.random() * Math.PI * 2;
          s.x = Math.max(left + 20, Math.min(left + width - 56, s.x + Math.cos(angle) * 22));
          s.y = Math.max(top + 20, Math.min(top + height - 92, s.y + Math.sin(angle) * 22));
          s.turn += (Math.random() - 0.5) * 40;
          place(bone, s.x, s.y, s.turn);
        });
      }
      await wait(110);
    }
    await wait(380);
    layer.remove();
    this.stage.classList.remove('showcase-dealing');
  }

  private async playGame() {
    const started = Date.now();
    const french = this.spec.format === 'french';
    let set = createSet({ mode: this.spec.mode, format: this.spec.format, seatCount: 4, oneAllPlayTwo: false });
    this.title.textContent = `${this.spec.title} · Learn Jamaican dominoes`;
    this.line.replaceChildren();
    this.draw(null, set);
    await this.intro();
    while (set.winnerSide === null) {
      let hand = deal({
        order: shuffled(fullSet()),
        seatCount: 4,
        mode: this.spec.mode,
        useBoneyard: false,
        poser: set.poseMustBeDoubleSix || set.handsPlayed === 0 ? undefined : set.poser,
        poseMustBeDoubleSix: set.poseMustBeDoubleSix,
        poseMustBeAnyDouble: french && !set.poseMustBeDoubleSix,
        openingTile: french ? '0-0' : '6-6',
        format: this.spec.format,
      });
      this.line.replaceChildren();
      this.draw(null, set);
      await this.shuffleAndDeal();
      this.draw(hand, set);
      this.caption.textContent = 'New hand. Seven bones each.';
      await wait(MOVE_MS);
      while (hand.status === 'active') {
        const before = hand;
        const move = duppyMove(hand, 'don');
        hand = applyMove(hand, move);
        this.caption.textContent = this.describe(before, move, hand);
        const penalties = hand.lastPenalties?.length ? penaltyLines(hand.lastPenalties, (s) => this.name(s)) : [];
        const why = this.why(before, move);
        this.reason.textContent = penalties.length ? penalties.join(' ') : why ?? '';
        if (move.kind === 'pass') this.say((move.seat + 1) % 4, 'theyPass');
        else if (move.kind === 'pose') this.say(move.seat, 'pose');
        else if ('tile' in move && isDouble(move.tile)) this.say(move.seat, 'slam');
        if ('tile' in move && hand.hands[move.seat].length === 1) this.say(move.seat, 'lastTile');
        this.draw(hand, set);
        await wait(move.kind === 'pass' ? PASS_MS : MOVE_MS + (why ? REASON_MS : 0));
      }
      const previous = set;
      set = applyHandResult(set, hand.result!);
      this.caption.textContent = this.describeEnd(hand, set, previous);
      this.reason.textContent = '';
      const r = hand.result!;
      if (r.winnerSeat !== null && !r.tie) this.say(r.winnerSeat, r.status === 'domino' ? 'win' : 'winCount', true);
      this.draw(hand, set);
      await wait(set.winnerSide === null ? HAND_END_MS : SET_END_MS);
      if (set.winnerSide === null && Date.now() - started > (FAST ? 90_000 : GAME_MS)) {
        this.caption.textContent = `That's ${this.spec.title} for now.`;
        await wait(HAND_END_MS);
        return;
      }
    }
  }

  async run() {
    // `&game=french` (or partner, cutthroat, openhand, across) starts there.
    const startAt = GAMES.findIndex((g) => g.title.toLowerCase().replace(' ', '') === new URLSearchParams(location.search).get('game'));
    for (let index = Math.max(0, startAt); ; index = (index + 1) % GAMES.length) {
      this.spec = GAMES[index];
      this.setCast();
      await this.playGame();
    }
  }
}

const root = document.getElementById('app');
if (root && new URLSearchParams(location.search).get('k') === SHOWCASE_KEY) {
  void new Showcase(root).run();
}
