/**
 * Yard TV: a private, never-ending teaching table for a 24/7 stream.
 *
 * Owner, 2026-09-17: a Practice-style section to show on YouTube around the
 * clock, teaching people how to play. Four Don-level duppies play partner six
 * love with every hand face up, and a caption panel says what each move means
 * in plain words. It runs entirely in the browser of the streaming computer:
 * no account, no server, nothing the live site has to carry.
 *
 * Reached only at /showcase, which is kept out of search and the sitemap.
 * It draws a fixed 1920x1080 stage scaled to the window, so an OBS browser
 * source at 1920x1080 captures it pixel for pixel.
 */
import {
  applyHandResult, applyMove, createSet, deal, duppyMove, isDouble, openEnds,
} from '@yard/engine';
import type { HandState, Move, SetState, TileId } from '@yard/engine';
import { deskRouteGeometry, el, renderBoard, tileEl } from './render.ts';
import { duppyPersonaUrl } from './duppy-persona.ts';
import type { DuppyPersona } from './duppy-persona.ts';
import './styles.css';
import './showcase.css';

const PLAYERS: { persona: DuppyPersona; name: string }[] = [
  { persona: 'auntie_vee', name: 'Auntie Vee' },
  { persona: 'uncle_desmond', name: 'Uncle Desmond' },
  { persona: 'miss_mavis', name: 'Miss Mavis' },
  { persona: 'mr_chen', name: 'Mr Chen' },
];
/** Seats go anticlockwise, so seat + 1 sits on the physical right. */
const SLOTS = ['bottom', 'right', 'top', 'left'] as const;
const TEAM = (seat: number) => (seat % 2 === 0 ? 'Vee & Mavis' : 'Desmond & Chen');

/** Beats, in ms. Slow enough for a newcomer to follow on a stream. */
const MOVE_MS = 3200;
const PASS_MS = 2600;
const HAND_END_MS = 9000;
const SET_END_MS = 14000;
const TIP_MS = 22000;

const TIPS = [
  'Partners sit opposite. Play goes anticlockwise, to your right.',
  'The double-six opens every new set.',
  'A pass tells the whole table you hold none of the numbers showing.',
  'Blocked? Nobody can play. The single lowest count in any hand wins it for their side.',
  'Six love: win six hands while the other side is still on love.',
  'Bruk: if the side on love wins, the score goes back to love-all, and the next hand is worth 2.',
  'Count the numbers. There are seven of each number in the set, doubles included.',
  'Doubles are laid crosswise. They are the hardest bones to get rid of, so play them early.',
  'Watch your partner. If they passed on a number, feed them something else.',
  'Hold a variety of numbers. A hand full of one number is easy to block.',
  'Play free at yaaddominoes.com, with no sign-up needed to practice.',
];

function shuffled(): TileId[] {
  const tiles: TileId[] = [];
  for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) tiles.push(`${a}-${b}`);
  const random = new Uint32Array(tiles.length);
  crypto.getRandomValues(random);
  for (let i = tiles.length - 1; i > 0; i--) {
    const j = random[i] % (i + 1);
    [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
  }
  return tiles;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const bone = (tile: TileId) => tile.replace('-', '/');
const pipWord = (pip: number) => (pip === 0 ? 'blank' : String(pip));

function scoreRow(team: string, points: number): HTMLElement {
  const row = el('div', 'showcase-score-row');
  row.append(el('span', undefined, team), el('span', undefined, points === 0 ? 'love' : String(points)));
  return row;
}

function describe(before: HandState, move: Move, after: HandState): string {
  const who = PLAYERS[move.seat].name;
  if (move.kind === 'pass') {
    const ends = before.board ? [...new Set(openEnds(before.board))].map(pipWord) : [];
    const list = ends.length > 1 ? `${ends.slice(0, -1).join(', ')} or ${ends.at(-1)}` : ends[0];
    return `${who} passes. Now everyone knows ${who} has no ${list}.`;
  }
  if (!('tile' in move)) return `${who} plays.`;
  if (move.kind === 'pose') {
    return move.tile === '6-6'
      ? `${who} poses the double-six. It opens every new set.`
      : `${who} poses the ${bone(move.tile)} to start the hand.`;
  }
  const ends = after.board ? [...new Set(openEnds(after.board))].map(pipWord) : [];
  const left = after.hands[move.seat].length;
  const double = isDouble(move.tile) ? ' A double goes down crosswise.' : '';
  const last = left === 1 ? ` ${who} has one bone left!` : '';
  return `${who} plays the ${bone(move.tile)}.${double} The ends are now ${ends.join(' and ')}.${last}`;
}

function describeEnd(hand: HandState, set: SetState, before: SetState): string {
  const r = hand.result!;
  if (r.tie) return 'Blocked, and the lowest counts are tied. The hand is played again, worth 2.';
  const who = PLAYERS[r.winnerSeat!].name;
  const team = TEAM(r.winnerSeat!);
  const opening = r.status === 'domino'
    ? `Domino! ${who} plays out.`
    : `Blocked! Nobody can play. ${who} has the lowest count, ${r.counts[r.winnerSeat!]}.`;
  if (set.winnerSide !== null) {
    return set.sixLove ? `${opening} SIX LOVE for ${team}!` : `${opening} ${team} win the set!`;
  }
  const bruk = set.scores.every((v) => v === 0) && before.scores.some((v) => v > 0);
  if (bruk) return `${opening} BRUK! The side on love won, so it's back to love-all. The next hand is worth 2.`;
  return `${opening} ${team} score. It's ${set.scores[0]}–${set.scores[1]}.`;
}

export function mountShowcase(root: HTMLElement): void {
  document.title = 'Yard TV · YaadDominoes';
  document.body.classList.add('showcase-body');
  root.innerHTML = '';
  const stage = el('div', 'showcase-stage');
  root.appendChild(stage);
  const fit = () => {
    const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    stage.style.transform = `scale(${scale})`;
  };
  window.addEventListener('resize', fit);
  fit();

  const table = el('div', 'showcase-table');
  const felt = el('div', 'showcase-felt table-felt');
  const boardStage = el('div', 'showcase-board');
  const line = el('div', 'line');
  boardStage.appendChild(line);
  felt.appendChild(boardStage);
  table.appendChild(felt);
  const seats = SLOTS.map((slot, seat) => {
    const box = el('div', `showcase-seat showcase-seat-${slot}`);
    const face = document.createElement('img');
    face.className = 'showcase-face';
    face.src = duppyPersonaUrl(PLAYERS[seat].persona);
    face.alt = '';
    const name = el('div', 'showcase-name', PLAYERS[seat].name);
    const hand = el('div', 'showcase-hand');
    const head = el('div', 'showcase-seat-head');
    head.append(face, name);
    box.append(head, hand);
    table.appendChild(box);
    return { box, hand };
  });

  const side = el('aside', 'showcase-side');
  const brand = el('div', 'showcase-brand');
  brand.innerHTML = '<span class="word-yaad">YAAD</span> <span class="word-dominoes">DOMINOES</span>';
  const sub = el('div', 'showcase-sub', 'Learn Jamaican dominoes · Partner · Six love');
  const score = el('div', 'showcase-score');
  const caption = el('div', 'showcase-caption', 'Shuffling…');
  const tipBox = el('div', 'showcase-tip');
  const tipHead = el('div', 'showcase-tip-head', 'Yard tip');
  const tip = el('div', 'showcase-tip-text', TIPS[0]);
  tipBox.append(tipHead, tip);
  const cta = el('div', 'showcase-cta', 'Play free at yaaddominoes.com');
  side.append(brand, sub, score, caption, tipBox, cta);
  stage.append(table, side);

  let tipIndex = 0;
  setInterval(() => {
    tipIndex = (tipIndex + 1) % TIPS.length;
    tip.textContent = TIPS[tipIndex];
  }, TIP_MS);

  const geo = deskRouteGeometry({ width: 880, height: 680 }, [], 12, 26);
  boardStage.style.setProperty('--table-bone-short', `${geo.unit * 2}px`);

  const draw = (hand: HandState, set: SetState) => {
    renderBoard(line, hand.board, {
      unit: geo.unit, maxUnit: geo.unit, minUnit: geo.unit,
      moveLog: hand.moveLog,
      phoneRoute: { cols: geo.cols, rows: geo.rows, origin: geo.origin, blocked: geo.blocked, climb: geo.climb },
      viewerSeat: 0,
    });
    line.style.position = 'absolute';
    line.style.left = `${geo.left}px`;
    line.style.top = `${geo.top}px`;
    line.style.margin = '0';
    seats.forEach(({ box, hand: rack }, seat) => {
      box.classList.toggle('showcase-turn', hand.status === 'active' && hand.turn === seat);
      rack.replaceChildren(...hand.hands[seat].map((t) => tileEl(t)));
    });
    score.replaceChildren(
      scoreRow(TEAM(0), set.scores[0]),
      scoreRow(TEAM(1), set.scores[1]),
    );
    if (set.handValue > 1) score.appendChild(el('div', 'showcase-worth', `This hand is worth ${set.handValue}`));
  };

  const run = async () => {
    for (;;) {
      let set = createSet({ mode: 'partner', format: 'sixlove', oneAllPlayTwo: false });
      while (set.winnerSide === null) {
        let hand = deal({
          order: shuffled(),
          seatCount: 4,
          mode: 'partner',
          useBoneyard: false,
          poser: set.poseMustBeDoubleSix || set.handsPlayed === 0 ? undefined : set.poser,
          poseMustBeDoubleSix: set.poseMustBeDoubleSix,
          openingTile: '6-6',
          format: 'sixlove',
        });
        caption.textContent = 'New hand. Seven bones each.';
        line.replaceChildren();
        draw(hand, set);
        await wait(MOVE_MS);
        while (hand.status === 'active') {
          const before = hand;
          const move = duppyMove(hand, 'don');
          hand = applyMove(hand, move);
          caption.textContent = describe(before, move, hand);
          draw(hand, set);
          await wait(move.kind === 'pass' ? PASS_MS : MOVE_MS);
        }
        const previous = set;
        set = applyHandResult(set, hand.result!);
        caption.textContent = describeEnd(hand, set, previous);
        draw(hand, set);
        await wait(set.winnerSide === null ? HAND_END_MS : SET_END_MS);
      }
    }
  };
  void run();
}

const root = document.getElementById('app');
if (root) mountShowcase(root);
