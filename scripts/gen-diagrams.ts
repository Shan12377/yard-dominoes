import { mkdir, writeFile } from 'node:fs/promises';
import { renderDiagram, type DiagramSpec } from '../packages/engine/art/render.ts';

const diagrams: Record<string, DiagramSpec> = {
  B1L2: {
    title: 'Matching the open pip',
    description: 'A three-one tile matches the open three. A four-two tile does not match and is rejected.',
    tiles: [
      { id: '3-5', x: 270, y: 130, rotate: 90, tone: 'gold' },
      { id: '1-3', x: 405, y: 130, rotate: 90, tone: 'gold' },
      { id: '2-4', x: 90, y: 230, rotate: 90, tone: 'muted' },
    ],
    lines: [{ x1: 341, y1: 188, x2: 390, y2: 188, tone: 'gold' }],
    badges: [{ text: '3 matches 3', x: 380, y: 74, tone: 'gold' }, { text: 'No match', x: 145, y: 310, tone: 'coral' }],
  },
  B2L6: {
    title: 'Lowest individual count wins the block',
    description: 'South has the lowest individual count at two, so the north-south team wins even though that team holds more pips overall.',
    tiles: [
      { id: '5-5', x: 352, y: 45 }, { id: '2-2', x: 615, y: 140, rotate: 90 },
      { id: '1-1', x: 352, y: 225, tone: 'gold' }, { id: '1-5', x: 90, y: 140, rotate: 90 },
    ],
    labels: [
      { text: 'NORTH · 10', x: 380, y: 35, anchor: 'middle' },
      { text: 'EAST · 4', x: 735, y: 205, anchor: 'end' },
      { text: 'SOUTH · 2', x: 380, y: 360, anchor: 'middle', tone: 'gold' },
      { text: 'WEST · 6', x: 25, y: 205 },
      { text: 'North + South win', x: 380, y: 205, anchor: 'middle', tone: 'gold', size: 25, weight: 900 },
      { text: 'Lowest single hand — not lowest team total', x: 380, y: 232, anchor: 'middle', size: 15 },
    ],
    lines: [{ x1: 380, y1: 120, x2: 380, y2: 220, tone: 'gold', dash: true }],
  },
  B4L1: {
    title: 'A pass is permanent',
    description: 'East passes when four and one are open. Permanent badges record that East has no fours and no ones while the board continues changing.',
    tiles: [
      { id: '2-4', x: 215, y: 120, rotate: -90 }, { id: '1-3', x: 420, y: 120, rotate: -90 },
      { id: '2-5', x: 115, y: 120, rotate: 90, tone: 'muted' }, { id: '3-6', x: 520, y: 120, rotate: -90, tone: 'muted' },
    ],
    badges: [
      { text: 'EAST PASSED', x: 625, y: 65, tone: 'coral' },
      { text: 'No 4s', x: 610, y: 285, tone: 'gold' }, { text: 'No 1s', x: 610, y: 330, tone: 'gold' },
    ],
    labels: [
      { text: '4 open', x: 300, y: 105, anchor: 'middle', tone: 'gold' },
      { text: '1 open', x: 455, y: 105, anchor: 'middle', tone: 'gold' },
      { text: 'The board changes. What the pass proved does not.', x: 36, y: 330, size: 18 },
    ],
    lines: [{ x1: 550, y1: 88, x2: 585, y2: 250, tone: 'coral', dash: true }],
  },
};

const row = (ids: string[], y = 145, tone?: 'normal' | 'gold' | 'muted' | 'coral') =>
  ids.map((id, index) => ({ id, x: 90 + index * 95, y, rotate: 90 as const, tone }));
const label = (text: string, x = 380, y = 330, tone: 'bone' | 'gold' | 'green' | 'coral' | 'muted' = 'bone') =>
  ({ text, x, y, anchor: 'middle' as const, tone, size: 19, weight: 800 });
const simple = (
  title: string, description: string, tiles: DiagramSpec['tiles'],
  footer: string, badges: DiagramSpec['badges'] = [], labels: DiagramSpec['labels'] = [],
): DiagramSpec => ({ title, description, tiles, badges, labels: [...labels, label(footer)] });

const fullSet = Array.from({ length: 7 }, (_, high) =>
  Array.from({ length: high + 1 }, (_, low) => ({
    id: `${low}-${high}`, x: 110 + low * 76 + (6 - high) * 38, y: 35 + high * 43,
    rotate: 90 as const, scale: .55, tone: (low === 3 || high === 3 ? 'gold' : 'normal') as 'gold' | 'normal',
  }))).flat();

Object.assign(diagrams, {
  B1L1: simple('Two halves, one tile', 'A five-three tile has two separately counted halves.', [{ id: '3-5', x: 352, y: 92, scale: 1.65, tone: 'gold' }], 'Count each half', [
    { text: '3 pips', x: 260, y: 145, tone: 'gold' }, { text: '5 pips', x: 500, y: 245, tone: 'green' },
  ]),
  B1L3: { ...simple('The line has two open ends', 'Five legally connected tiles form one line; only the two outside ends accept a play.', row(['0-1', '1-3', '3-3', '3-5', '5-6']).map((tile) => ({ ...tile, rotate: -90 as const })), 'Play here or here', [
    { text: 'OPEN', x: 54, y: 202, tone: 'gold' }, { text: 'OPEN', x: 700, y: 202, tone: 'gold' },
  ]), lines: [{ x1: 55, y1: 202, x2: 90, y2: 202, tone: 'gold' }, { x1: 565, y1: 202, x2: 700, y2: 202, tone: 'gold' }], connectedLine: true },
  B1L4: {
    title: 'Only your hand faces you',
    description: 'Your seven tile faces are visible at the bottom. Each opponent has seven face-down tiles.',
    tiles: row(['0-2', '1-3', '2-4', '3-5', '4-6', '1-6', '0-4'], 220).map((tile) => ({ ...tile, scale: .72 })),
    backs: [
      { x: 380, y: 65, count: 7, scale: .78 },
      { x: 85, y: 140, count: 7, rotate: 90, scale: .78 },
      { x: 675, y: 140, count: 7, rotate: 90, scale: .78 },
    ],
    badges: [{ text: 'YOU · FACE UP', x: 380, y: 200, tone: 'gold' }],
    labels: [label('Your tiles stay private', 380, 355)],
  },
  B1L5: simple('Three, two, one—domino', 'The hand shrinks until the final tile leaves and the player has none.', [
    ...row(['1-2', '2-4', '4-6'], 75), ...row(['2-4', '4-6'], 165), ...row(['4-6'], 255, 'gold'),
  ], 'Empty hand wins', [{ text: 'DOMINO!', x: 630, y: 285, tone: 'gold' }], [
    label('3 tiles', 210, 62, 'muted'), label('2 tiles', 240, 155, 'muted'), label('last tile', 190, 250, 'gold'),
  ]),

  B2L1: { title: 'Seven of every suit', description: 'The full twenty-eight tile double-six set highlights all seven tiles carrying a three.', tiles: fullSet, labels: [label('All 28 tiles · exactly seven carry a 3', 380, 360, 'gold')] },
  B2L2: simple('Pose: tournament and casual', 'The double-six is forced in tournament play; casual sporting may name another opening.', [
    { id: '6-6', x: 205, y: 115, tone: 'gold' }, { id: '2-5', x: 500, y: 115, tone: 'normal' },
  ], 'Know the table rule before you pose', [
    { text: 'TOURNAMENT · MUST', x: 230, y: 75, tone: 'gold' }, { text: 'CASUAL · SPORTING', x: 530, y: 75, tone: 'green' },
  ]),
  B2L3: { ...simple('Play runs anticlockwise', 'Four seats surround the table; the right-hand seat plays next and partners sit opposite.', [{ id: '6-6', x: 352, y: 135, tone: 'gold' }], 'Partner sits straight across', [
    { text: 'PARTNER', x: 380, y: 50, tone: 'green' }, { text: 'RIGHT · NEXT', x: 660, y: 205, tone: 'gold' },
    { text: 'YOU', x: 380, y: 285, tone: 'gold' }, { text: 'LEFT', x: 100, y: 205, tone: 'green' },
  ]), lines: [{ x1: 380, y1: 80, x2: 380, y2: 275, tone: 'green', dash: true }, { x1: 480, y1: 285, x2: 640, y2: 220, tone: 'gold' }] },
  B2L4: simple('No match means pass', 'The open ends are two and five; every tile in the hand lacks both.', row(['0-1', '1-3', '3-4', '4-6'], 205, 'muted'), 'No 2 and no 5 · PASS', [
    { text: '2 OPEN', x: 205, y: 92, tone: 'gold' }, { text: '5 OPEN', x: 555, y: 92, tone: 'gold' }, { text: 'PASS', x: 380, y: 160, tone: 'coral' },
  ]),
  B2L5: { ...simple('Four passes block the board', 'A jammed line sits between four face-up hands, each with an individual count.', row(['1-4', '4-4', '3-4', '3-6'], 135).map((tile, index) => ({ ...tile, rotate: (index === 2 ? 90 : -90) as -90 | 90 })), 'Count each hand separately', [
    { text: 'PASS × 4', x: 380, y: 70, tone: 'coral' }, { text: '3 pips', x: 120, y: 285, tone: 'gold' }, { text: '8 pips', x: 640, y: 285, tone: 'green' },
  ]), connectedLine: true },
  B2L7: simple('Six-love and the bruk', 'One score track reaches six-nil; another five-nil run is cleared by one opponent win.', row(['0-6', '0-5'], 130), 'Their one win bruks your five to 0-0', [
    { text: '● ● ● ● ● ●', x: 250, y: 90, tone: 'gold' }, { text: '● ● ● ● ●', x: 510, y: 90, tone: 'green' }, { text: 'BRUK → 0-0', x: 510, y: 275, tone: 'coral' },
  ]),
  B2L8: simple('One all, play two', 'At one-all, the playoff hand sends its winner straight to two-zero.', [{ id: '1-1', x: 210, y: 130 }, { id: '2-2', x: 500, y: 130, tone: 'gold' }], '1-1 → playoff → 2-0', [
    { text: 'ONE ALL', x: 240, y: 90, tone: 'green' }, { text: 'PLAY TWO', x: 530, y: 90, tone: 'gold' },
  ]),
  B2L9: simple('Partner or cut throat', 'Partner joins opposite seats into two sides; cut throat leaves all four players separate.', [{ id: '2-2', x: 200, y: 125 }, { id: '4-4', x: 505, y: 125 }], 'Opposite together · or every tub alone', [
    { text: 'PARTNER · 2 SIDES', x: 230, y: 80, tone: 'green' }, { text: 'CUT THROAT · 4', x: 535, y: 80, tone: 'gold' },
  ]),

  B3L1: simple('Read the hand before playing', 'Seven tiles reveal a long five suit and no blanks.', row(['1-5', '2-5', '3-5', '5-5', '2-4', '4-6', '1-4'], 135).map((tile) => ({ ...tile, scale: .72 })), 'Long: 5 · Void: blank', [
    { text: '5s × 4', x: 260, y: 80, tone: 'gold' }, { text: '0s × 0', x: 500, y: 80, tone: 'coral' },
  ]),
  B3L2: simple('One pose, three jobs', 'Double-five opens a hand long in fives and creates three strategic benefits.', [{ id: '5-5', x: 352, y: 115, tone: 'gold', scale: 1.2 }], 'Way back · deny them · signal partner', [
    { text: 'WAY BACK', x: 170, y: 125, tone: 'green' }, { text: 'DENY 5', x: 590, y: 125, tone: 'coral' }, { text: 'SIGNAL', x: 380, y: 80, tone: 'gold' },
  ]),
  B3L3: simple('Keep control of the ends', 'The left branch exposes suits your hand answers; the right branch shuts it out.', [...row(['2-5', '5-6'], 115, 'gold'), ...row(['0-1', '3-4'], 225, 'muted')], 'Ends that come home beat ends that lock you out', [
    { text: 'CONTROL', x: 260, y: 75, tone: 'gold' }, { text: 'NO WAY IN', x: 510, y: 185, tone: 'coral' },
  ]),
  B3L4: simple('Do not feed the right', 'Two legal plays open different suits for the player who acts next.', [{ id: '2-5', x: 220, y: 125 }, { id: '2-4', x: 500, y: 125, tone: 'gold' }], 'Ask what your play gives the next seat', [
    { text: 'OPPONENT LONG IN 5', x: 235, y: 82, tone: 'coral' }, { text: 'LEAVE 4', x: 530, y: 82, tone: 'gold' },
  ]),
  B3L5: simple('Heavy tiles lose blocked hands', 'Six-six and five-six carry much more count than two-one.', row(['6-6', '5-6', '1-2'], 135), '12 + 11 pips are expensive weight', [
    { text: '12', x: 145, y: 90, tone: 'coral' }, { text: '11', x: 240, y: 90, tone: 'coral' }, { text: '3', x: 335, y: 90, tone: 'green' },
  ]),
  B3L6: simple('A double keeps the suit open', 'Four-four repeats the four end; four-one changes it to one.', [{ id: '4-4', x: 215, y: 125, rotate: 90, tone: 'gold' }, { id: '1-4', x: 500, y: 125, rotate: 90 }], '4-4 stays on 4 · 4-1 moves to 1', [
    { text: '4 → 4', x: 250, y: 90, tone: 'gold' }, { text: '4 → 1', x: 535, y: 90, tone: 'green' },
  ]),

  B4L2: simple('Count a suit out', 'Six fives are already visible and the seventh five glows in your hand.', [
    ...row(['0-5', '1-5', '2-5', '3-5', '4-5', '5-5'], 115, 'muted'),
    { id: '5-6', x: 585, y: 205, tone: 'gold' },
  ], 'You hold 5-6 · fives belong to you', [
    { text: 'SIX SEEN', x: 270, y: 75, tone: 'coral' }, { text: 'LAST 5', x: 620, y: 245, tone: 'gold' },
  ]),
  B4L3: simple('The void map only grows', 'Three opponent seats carry permanent suit lists built from their passes.', [{ id: '2-6', x: 352, y: 130, tone: 'muted' }], 'Three short lists—not twenty-eight guesses', [
    { text: 'NORTH · no 1, 4', x: 380, y: 70, tone: 'gold' }, { text: 'EAST · no 2, 6', x: 660, y: 205, tone: 'green' }, { text: 'WEST · no 3', x: 100, y: 205, tone: 'coral' },
  ]),
  B4L4: { ...simple('Partner talk without words', 'A signal, a pass and repeated suit plays guide what the partner should open.', row(['2-5', '3-5', '3-6', '5-6'], 130).map((tile, index) => ({ ...tile, rotate: (index % 2 === 0 ? -90 : 90) as -90 | 90 })), 'Name suit · heed pass · open partner · put partner out', [
    { text: 'SIGNAL 5', x: 140, y: 85, tone: 'gold' }, { text: 'PASS 2/4', x: 330, y: 85, tone: 'coral' }, { text: 'OPEN 6', x: 520, y: 85, tone: 'green' },
  ]), connectedLine: true },
  B4L5: { ...simple('Jam the board on purpose', 'Plays target known voids until passes stack and the board closes.', row(['1-6', '3-6', '3-4', '2-4'], 130).map((tile, index) => ({ ...tile, rotate: (index % 2 === 0 ? -90 : 90) as -90 | 90 })), 'Play their voids → force passes → win on count', [
    { text: 'PASS', x: 175, y: 85, tone: 'coral' }, { text: 'PASS', x: 380, y: 85, tone: 'coral' }, { text: 'BLOCK', x: 585, y: 85, tone: 'gold' },
  ]), connectedLine: true },
  B4L6: simple('The three-tile switch', 'Two branches compare racing out with protecting the lowest blocked count.', [{ id: '5-6', x: 215, y: 125, tone: 'coral' }, { id: '1-1', x: 500, y: 125, tone: 'gold' }], 'Late hand: compare exit speed with count', [
    { text: 'RACE · LOSE BLOCK', x: 240, y: 82, tone: 'coral' }, { text: 'SHED 11 · WIN', x: 530, y: 82, tone: 'gold' },
  ]),
  B4L7: { ...simple('Hard end, dead double, key', 'Scarce suits create three named reads on one board.', row(['1-6', '5-6', '4-5'], 130).map((tile, index) => ({ ...tile, rotate: (index === 0 ? -90 : 90) as -90 | 90 })), 'Count the seven, then name the read', [
    { text: 'HARD 6', x: 170, y: 82, tone: 'gold' }, { text: 'DEAD 5-5', x: 380, y: 82, tone: 'coral' }, { text: 'KEY: 4 & 6', x: 585, y: 82, tone: 'green' },
  ]), connectedLine: true },

  B5L1: simple('Eliminate the impossible', 'The board, your hand and void badges cross impossible tiles from the unseen set.', row(['2-5', '3-5', '4-6', '2-6'], 130), 'Public facts narrow hidden hands', [
    { text: 'WEST: no 2, no 6', x: 380, y: 80, tone: 'coral' }, { text: '2-5 ✕', x: 240, y: 275, tone: 'coral' }, { text: '3-5 ✓', x: 380, y: 275, tone: 'green' }, { text: '4-6 ✕', x: 520, y: 275, tone: 'coral' },
  ]),
  B5L2: { ...simple('The score changes the play', 'One position has different priorities at five-nil, nil-five and one-all.', row(['1-4', '4-6', '2-6'], 130).map((tile, index) => ({ ...tile, rotate: (index < 2 ? -90 : 90) as -90 | 90 })), '5-0 safe · 0-5 jam · 1-1 final', [
    { text: '5-0 · CLOSE', x: 180, y: 82, tone: 'gold' }, { text: '0-5 · BRUK', x: 380, y: 82, tone: 'coral' }, { text: '1-1 · PLAY TWO', x: 590, y: 82, tone: 'green' },
  ]), connectedLine: true },
  B5L3: simple('A false signal', 'A believable conventional signal is deliberately reversed and the opponent follows it.', [{ id: '5-5', x: 215, y: 125, tone: 'muted' }, { id: '2-4', x: 500, y: 125, tone: 'gold' }], 'First speak the language—then choose when to lie', [
    { text: 'THEY EXPECT 5', x: 240, y: 82, tone: 'coral' }, { text: 'REAL HOME: 2/4', x: 530, y: 82, tone: 'gold' },
  ]),
  B5L4: simple('Read the player over time', 'The same starting hand is played by heavy shedding or careful control.', [...row(['6-6', '5-6', '2-3'], 100), ...row(['2-3', '5-6', '6-6'], 215)], 'Pattern across hands—not one dramatic move', [
    { text: 'AGGRESSIVE', x: 180, y: 65, tone: 'coral' }, { text: 'CAREFUL', x: 180, y: 180, tone: 'green' },
  ]),
  B5L5: simple('Do not leak with tempo', 'Even timing hides hand strength; one long stall gives a hard decision away.', row(['1-2', '2-4', '4-6'], 125), 'Same deliberate rhythm, every hand', [
    { text: '━━ ━━ ━━ EVEN', x: 245, y: 85, tone: 'green' }, { text: '━━ ━━━━━━━ STALL', x: 520, y: 245, tone: 'coral' },
  ]),
  B5L6: simple('Tournament forces the six-six', 'The double-six opening is highlighted and the sporting alternative is rejected.', [{ id: '6-6', x: 215, y: 125, tone: 'gold' }, { id: '2-5', x: 500, y: 125, tone: 'muted' }], 'No sporting in tournament play', [
    { text: 'MUST LEAD', x: 240, y: 82, tone: 'gold' }, { text: 'NOT LEGAL', x: 530, y: 82, tone: 'coral' },
  ]),
});

const out = new URL('../apps/web/public/art/boards/', import.meta.url);
await mkdir(out, { recursive: true });
for (const [id, spec] of Object.entries(diagrams)) {
  await writeFile(new URL(`${id}.svg`, out), renderDiagram(spec));
}
console.log(`Generated ${Object.keys(diagrams).length} Academy diagrams.`);
