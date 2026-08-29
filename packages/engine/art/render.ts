/** Deterministic SVG teaching diagrams. No DOM and no dependencies. */

export type DiagramTile = {
  id: string;
  x: number;
  y: number;
  rotate?: -90 | 0 | 90;
  /** Teaching overviews can fit a full set without inventing new tile art. */
  scale?: number;
  tone?: 'normal' | 'gold' | 'muted' | 'coral';
};

export type DiagramBacks = {
  x: number;
  y: number;
  count: number;
  rotate?: -90 | 0 | 90;
  scale?: number;
};

export type DiagramLabel = {
  text: string;
  x: number;
  y: number;
  anchor?: 'start' | 'middle' | 'end';
  tone?: 'bone' | 'gold' | 'green' | 'coral' | 'muted';
  size?: number;
  weight?: number;
};

export interface DiagramSpec {
  title: string;
  description: string;
  tiles: DiagramTile[];
  backs?: DiagramBacks[];
  labels?: DiagramLabel[];
  lines?: Array<{ x1: number; y1: number; x2: number; y2: number; tone?: 'gold' | 'green' | 'coral' | 'muted'; dash?: boolean }>;
  badges?: Array<{ text: string; x: number; y: number; tone?: 'gold' | 'green' | 'coral' }>;
  width?: number;
  height?: number;
  /** Validate a left-to-right domino line before generating teaching art. */
  connectedLine?: boolean;
}

const PIPS: Record<number, [number, number][]> = {
  0: [], 1: [[1, 1]], 2: [[0, 0], [2, 2]], 3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
};

const COLOR = {
  bone: '#FFF9EA', pip: '#17130F', signal: '#073B5C', deep: '#052B43',
  blue: '#10698F', gold: '#FFC928', green: '#2DD46F', coral: '#FF5A3C', muted: '#B9DCEB',
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);

export function visibleHorizontalHalves(tile: DiagramTile): [number, number] {
  const [a, b] = tile.id.split('-').map(Number);
  if (tile.rotate === -90) return [a, b];
  if (tile.rotate === 90) return [b, a];
  throw new Error(`Connected tile ${tile.id} must be horizontal`);
}

export function validateConnectedLine(tiles: DiagramTile[]): void {
  const ordered = [...tiles].sort((left, right) => left.x - right.x);
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const tile = ordered[index];
    const nextTile = ordered[index + 1];
    const scale = tile.scale ?? 1;
    const nextScale = nextTile.scale ?? 1;
    if (tile.y !== nextTile.y || scale !== nextScale) {
      throw new Error('Connected teaching tiles must share one baseline and scale');
    }
    const expectedStep = 110 * scale;
    if (Math.abs((nextTile.x - tile.x) - expectedStep) > .01) {
      throw new Error(`Connected teaching tiles must touch without overlap or gaps: ${tile.id} → ${nextTile.id}`);
    }
    const [, right] = visibleHorizontalHalves(tile);
    const [nextLeft] = visibleHorizontalHalves(nextTile);
    if (right !== nextLeft) {
      throw new Error(`Broken teaching line: ${tile.id} does not join ${nextTile.id}`);
    }
  }
}

function tileBounds(tile: DiagramTile): { left: number; top: number; right: number; bottom: number } {
  const scale = tile.scale ?? 1;
  if (tile.rotate === -90 || tile.rotate === 90) {
    return { left: tile.x - 28 * scale, top: tile.y + 28 * scale, right: tile.x + 82 * scale, bottom: tile.y + 82 * scale };
  }
  return { left: tile.x, top: tile.y, right: tile.x + 56 * scale, bottom: tile.y + 112 * scale };
}

export function validateNoTileOverlap(tiles: DiagramTile[]): void {
  for (let leftIndex = 0; leftIndex < tiles.length; leftIndex += 1) {
    const left = tileBounds(tiles[leftIndex]);
    for (let rightIndex = leftIndex + 1; rightIndex < tiles.length; rightIndex += 1) {
      const right = tileBounds(tiles[rightIndex]);
      const overlapX = Math.min(left.right, right.right) - Math.max(left.left, right.left);
      const overlapY = Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top);
      if (overlapX > .01 && overlapY > .01) {
        throw new Error(`Teaching tiles overlap and hide pips: ${tiles[leftIndex].id} and ${tiles[rightIndex].id}`);
      }
    }
  }
}

function tileSvg(tile: DiagramTile): string {
  const [a, b] = tile.id.split('-').map(Number);
  const visible = tile.rotate === -90 ? [a, b] : tile.rotate === 90 ? [b, a] : [a, b];
  const outline = tile.tone === 'gold' ? COLOR.gold : tile.tone === 'coral' ? COLOR.coral : tile.tone === 'muted' ? COLOR.muted : COLOR.blue;
  const opacity = tile.tone === 'muted' ? .42 : 1;
  const pipFace = (value: number, offset: number) => PIPS[value].map(([cx, cy]) =>
    `<circle cx="${18 + cx * 12}" cy="${offset + 14 + cy * 12}" r="4.1" fill="${COLOR.pip}"/>`).join('');
  return `<g data-tile-id="${esc(tile.id)}" data-visible-halves="${visible[0]}-${visible[1]}" transform="translate(${tile.x} ${tile.y}) scale(${tile.scale ?? 1})" opacity="${opacity}"><g transform="rotate(${tile.rotate ?? 0} 28 56)">
    <rect x="1" y="1" width="54" height="110" rx="8" fill="${COLOR.bone}" stroke="${outline}" stroke-width="3"/>
    <line x1="7" y1="56" x2="49" y2="56" stroke="${COLOR.pip}" stroke-width="2"/>
    ${pipFace(a, 4)}${pipFace(b, 60)}
  </g></g>`;
}

function backsSvg(group: DiagramBacks): string {
  const step = 13;
  const width = 24;
  const height = 48;
  const cards = Array.from({ length: group.count }, (_, index) =>
    `<g transform="translate(${index * step} 0)"><rect width="${width}" height="${height}" rx="5" fill="${COLOR.signal}" stroke="${COLOR.muted}" stroke-width="2"/><circle cx="12" cy="15" r="2" fill="${COLOR.blue}"/><circle cx="12" cy="33" r="2" fill="${COLOR.blue}"/></g>`).join('');
  const totalWidth = width + Math.max(0, group.count - 1) * step;
  return `<g data-back-count="${group.count}" transform="translate(${group.x} ${group.y}) rotate(${group.rotate ?? 0}) scale(${group.scale ?? 1}) translate(${-totalWidth / 2} ${-height / 2})">${cards}</g>`;
}

/** Render a lesson diagram with built-in accessible title and description. */
export function renderDiagram(spec: DiagramSpec): string {
  if (spec.connectedLine) validateConnectedLine(spec.tiles);
  validateNoTileOverlap(spec.tiles);
  const width = spec.width ?? 760;
  const height = spec.height ?? 380;
  const tone = (name?: string) => COLOR[(name ?? 'muted') as keyof typeof COLOR] ?? COLOR.muted;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title description"${spec.connectedLine ? ' data-connected-line="true"' : ''}${spec.backs ? ` data-face-count="${spec.tiles.length}"` : ''}>
  <title id="title">${esc(spec.title)}</title><desc id="description">${esc(spec.description)}</desc>
  <defs><pattern id="felt" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><rect width="12" height="12" fill="#147A42"/><line x1="0" y1="0" x2="0" y2="12" stroke="#22A45B" stroke-opacity=".28" stroke-width="3"/></pattern></defs>
  <rect width="${width}" height="${height}" rx="18" fill="${COLOR.deep}"/>
  <rect x="12" y="12" width="${width - 24}" height="${height - 24}" rx="13" fill="url(#felt)" stroke="${COLOR.blue}" stroke-width="3"/>
${(spec.lines ?? []).map((line) => `<line x1="${line.x1}" y1="${line.y1}" x2="${line.x2}" y2="${line.y2}" stroke="${tone(line.tone)}" stroke-width="5" stroke-linecap="round" ${line.dash ? 'stroke-dasharray="10 10"' : ''}/>`).join('')}
${spec.tiles.map(tileSvg).join('')}${(spec.backs ?? []).map(backsSvg).join('')}
${(spec.badges ?? []).map((badge) => {
    const width = Math.max(110, badge.text.length * 9 + 28);
    return `<g transform="translate(${badge.x} ${badge.y})"><rect x="${-width / 2}" y="-18" width="${width}" height="36" rx="18" fill="${tone(badge.tone)}"/><text text-anchor="middle" y="6" fill="${COLOR.pip}" font-family="system-ui,sans-serif" font-size="15" font-weight="800">${esc(badge.text)}</text></g>`;
  }).join('')}
${(spec.labels ?? []).map((label) => `<text x="${label.x}" y="${label.y}" text-anchor="${label.anchor ?? 'start'}" fill="${tone(label.tone)}" font-family="system-ui,sans-serif" font-size="${label.size ?? 18}" font-weight="${label.weight ?? 700}">${esc(label.text)}</text>`).join('')}
  </svg>`;
}
