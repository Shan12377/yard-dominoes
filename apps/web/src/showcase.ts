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
  DuppyLevel, GameMode, HandState, Move, SetFormat, SetState, TalkTrigger, TileId,
} from '@yard/engine';
import { ACROSS_CLIMB, deskRouteGeometry, el, penaltyLines, renderBoard, tileEl } from './render.ts';
import { DUPPY_PERSONAS, duppyPersonaUrl } from './duppy-persona.ts';
import type { DuppyPersona } from './duppy-persona.ts';
import { dealOverlay, DEAL_ANIMATION_MS } from './table-experience.ts';
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
const bone = (tile: TileId) => tile.replace('-', '/');
const pipWord = (pip: number) => (pip === 0 ? 'blank' : String(pip));
const listOr = (words: string[]) => (words.length > 1 ? `${words.slice(0, -1).join(', ')} or ${words.at(-1)}` : words[0] ?? '');
const listAnd = (words: string[]) => (words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : words[0] ?? '');
const partnered = (spec: GameSpec) => spec.mode !== 'cutthroat';

class Showcase {
  private cast: DuppyPersona[] = ALL_PERSONAS.slice(0, 4);
  private spec: GameSpec = GAMES[0];
  private readonly stage = el('div', 'showcase-stage');
  private readonly felt = el('div', 'showcase-felt table-felt');
  private readonly boardStage = el('div', 'showcase-board');
  private readonly line = el('div', 'line');
  private readonly seats: { box: HTMLElement; face: HTMLImageElement; name: HTMLElement; hand: HTMLElement; bubble: HTMLElement }[] = [];
  private readonly title = el('div', 'showcase-sub');
  private readonly score = el('div', 'showcase-score');
  private readonly caption = el('div', 'showcase-caption');
  private readonly reason = el('div', 'showcase-reason');
  private readonly tip = el('div', 'showcase-tip-text');

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

    const table = el('div', 'showcase-table');
    this.boardStage.appendChild(this.line);
    this.felt.appendChild(this.boardStage);
    table.appendChild(this.felt);
    SLOTS.forEach((slot) => {
      const box = el('div', `showcase-seat showcase-seat-${slot}`);
      const face = document.createElement('img');
      face.className = 'showcase-face';
      face.alt = '';
      const name = el('div', 'showcase-name');
      const head = el('div', 'showcase-seat-head');
      head.append(face, name);
      const hand = el('div', 'showcase-hand');
      const bubble = el('div', 'showcase-bubble');
      bubble.hidden = true;
      box.append(head, hand, bubble);
      table.appendChild(box);
      this.seats.push({ box, face, name, hand, bubble });
    });

    const side = el('aside', 'showcase-side');
    const brand = el('div', 'showcase-brand');
    brand.append(el('span', 'word-yaad', 'YAAD'), ' ', el('span', 'word-dominoes', 'DOMINOES'));
    const tipBox = el('div', 'showcase-tip');
    tipBox.append(el('div', 'showcase-tip-head', 'Yard tip'), this.tip);
    side.append(brand, this.title, this.score, this.caption, this.reason, tipBox,
      el('div', 'showcase-cta', 'Play free at yaaddominoes.com'));
    this.stage.append(table, side);

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
    const box = { width: 880, height: 680 };
    return this.spec.mode === 'across'
      ? deskRouteGeometry(box, [], 12, 26, ACROSS_CLIMB)
      : deskRouteGeometry(box, [], 12, 26);
  }

  private draw(hand: HandState | null, set: SetState) {
    const board = hand?.board ?? null;
    if (board?.kind === 'cross') {
      this.line.removeAttribute('style');
      renderBoard(this.line, board, {
        box: { width: 880, height: 680 }, unit: 16, maxUnit: 16, minUnit: 8,
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
    this.seats.forEach(({ box, hand: rack }, seat) => {
      box.classList.toggle('showcase-turn', !!hand && hand.status === 'active' && hand.turn === seat);
      rack.replaceChildren(...(hand?.hands[seat] ?? []).map((t) => tileEl(t)));
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
      if (move.tile === '0-0') return `${who} poses the double-blank, the chucha. It opens French.`;
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
  private why(before: HandState, move: Move): string | null {
    if (move.kind !== 'play' && move.kind !== 'playcross') return null;
    const legal = legalMoves(before);
    const tiles = new Set(legal.flatMap((m) => ('tile' in m ? [m.tile] : [])));
    if (tiles.size < 2) return null;
    const advice = adviseMoves(publicView(before, move.seat), legal, 'general');
    const chosen = advice.find((a) => a.tile === move.tile);
    const other = advice.find((a) => a.tile !== move.tile);
    if (!chosen || !other) return null;
    const who = this.name(move.seat);
    const names = (seats: number[]) => listAnd(seats.map((s) => this.name(s)));
    const reasons: string[] = [];
    if (chosen.goesOut) reasons.push('it is the last bone, so it wins the hand');
    if (chosen.forcesOpponents.length) {
      reasons.push(`it leaves ${listAnd([...new Set(chosen.endsAfter)].map(pipWord))} open, and ${names(chosen.forcesOpponents)} cannot play on that`);
    }
    if (partnered(this.spec) && other.strandsPartner.length && !chosen.strandsPartner.length) {
      reasons.push(`the ${bone(other.tile)} would leave a ${listOr([...new Set(other.strandsPartner)].map(pipWord))}, and ${who}'s partner has already passed on it`);
    }
    if (chosen.unloadsDouble) reasons.push('it gets the double off before it can get stuck');
    if (!chosen.cannotAnswer.length && other.cannotAnswer.length) {
      reasons.push(`${who} can still answer whatever it leaves, but the ${bone(other.tile)} would leave a ${listOr([...new Set(other.cannotAnswer)].map(pipWord))} ${who} has no more of`);
    }
    if (!reasons.length && chosen.pipsShed >= other.pipsShed + 3) {
      reasons.push(`it drops ${chosen.pipsShed} pips, a heavier bone, in case the board blocks`);
    }
    if (!reasons.length) return null;
    return `Why the ${bone(move.tile)}, not the ${bone(other.tile)}? Because ${reasons[0]}.`;
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

  private async shuffleAndDeal() {
    this.stage.classList.add('showcase-dealing');
    this.caption.textContent = 'Shuffling and dealing.';
    this.reason.textContent = '';
    const overlay = dealOverlay(() => {});
    this.felt.appendChild(overlay);
    await wait(DEAL_ANIMATION_MS);
    overlay.remove();
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
