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
      { id: '2-4', x: 215, y: 120, rotate: 90 }, { id: '1-3', x: 420, y: 120, rotate: 90 },
      { id: '2-5', x: 115, y: 120, rotate: 90, tone: 'muted' }, { id: '3-6', x: 520, y: 120, rotate: 90, tone: 'muted' },
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

const out = new URL('../apps/web/public/art/boards/', import.meta.url);
await mkdir(out, { recursive: true });
for (const [id, spec] of Object.entries(diagrams)) {
  await writeFile(new URL(`${id}.svg`, out), renderDiagram(spec));
}
console.log(`Generated ${Object.keys(diagrams).length} Academy diagrams.`);
