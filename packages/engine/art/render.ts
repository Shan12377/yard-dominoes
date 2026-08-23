/** Deterministic SVG teaching diagrams. No DOM and no dependencies. */

export type DiagramTile = {
  id: string;
  x: number;
  y: number;
  rotate?: 0 | 90;
  /** Teaching overviews can fit a full set without inventing new tile art. */
  scale?: number;
  tone?: 'normal' | 'gold' | 'muted' | 'coral';
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
  labels?: DiagramLabel[];
  lines?: Array<{ x1: number; y1: number; x2: number; y2: number; tone?: 'gold' | 'green' | 'coral' | 'muted'; dash?: boolean }>;
  badges?: Array<{ text: string; x: number; y: number; tone?: 'gold' | 'green' | 'coral' }>;
  width?: number;
  height?: number;
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

function tileSvg(tile: DiagramTile): string {
  const [a, b] = tile.id.split('-').map(Number);
  const outline = tile.tone === 'gold' ? COLOR.gold : tile.tone === 'coral' ? COLOR.coral : tile.tone === 'muted' ? COLOR.muted : COLOR.blue;
  const opacity = tile.tone === 'muted' ? .42 : 1;
  const pipFace = (value: number, offset: number) => PIPS[value].map(([cx, cy]) =>
    `<circle cx="${18 + cx * 12}" cy="${offset + 14 + cy * 12}" r="4.1" fill="${COLOR.pip}"/>`).join('');
  return `<g transform="translate(${tile.x} ${tile.y}) scale(${tile.scale ?? 1})" opacity="${opacity}"><g transform="rotate(${tile.rotate ?? 0} 28 56)">
    <rect x="1" y="1" width="54" height="110" rx="8" fill="${COLOR.bone}" stroke="${outline}" stroke-width="3"/>
    <line x1="7" y1="56" x2="49" y2="56" stroke="${COLOR.pip}" stroke-width="2"/>
    ${pipFace(a, 4)}${pipFace(b, 60)}
  </g></g>`;
}

/** Render a lesson diagram with built-in accessible title and description. */
export function renderDiagram(spec: DiagramSpec): string {
  const width = spec.width ?? 760;
  const height = spec.height ?? 380;
  const tone = (name?: string) => COLOR[(name ?? 'muted') as keyof typeof COLOR] ?? COLOR.muted;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title description">
  <title id="title">${esc(spec.title)}</title><desc id="description">${esc(spec.description)}</desc>
  <defs><pattern id="felt" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><rect width="12" height="12" fill="#147A42"/><line x1="0" y1="0" x2="0" y2="12" stroke="#22A45B" stroke-opacity=".28" stroke-width="3"/></pattern></defs>
  <rect width="${width}" height="${height}" rx="18" fill="${COLOR.deep}"/>
  <rect x="12" y="12" width="${width - 24}" height="${height - 24}" rx="13" fill="url(#felt)" stroke="${COLOR.blue}" stroke-width="3"/>
  ${(spec.lines ?? []).map((line) => `<line x1="${line.x1}" y1="${line.y1}" x2="${line.x2}" y2="${line.y2}" stroke="${tone(line.tone)}" stroke-width="5" stroke-linecap="round" ${line.dash ? 'stroke-dasharray="10 10"' : ''}/>`).join('')}
  ${spec.tiles.map(tileSvg).join('')}
${(spec.badges ?? []).map((badge) => {
    const width = Math.max(110, badge.text.length * 9 + 28);
    return `<g transform="translate(${badge.x} ${badge.y})"><rect x="${-width / 2}" y="-18" width="${width}" height="36" rx="18" fill="${tone(badge.tone)}"/><text text-anchor="middle" y="6" fill="${COLOR.pip}" font-family="system-ui,sans-serif" font-size="15" font-weight="800">${esc(badge.text)}</text></g>`;
  }).join('')}
${(spec.labels ?? []).map((label) => `<text x="${label.x}" y="${label.y}" text-anchor="${label.anchor ?? 'start'}" fill="${tone(label.tone)}" font-family="system-ui,sans-serif" font-size="${label.size ?? 18}" font-weight="${label.weight ?? 700}">${esc(label.text)}</text>`).join('')}
  </svg>`;
}
