import test from 'node:test';
import assert from 'node:assert/strict';
import { halves } from '@yard/engine';
import type { Move, Pip, TileId } from '@yard/engine';
import { boardAfter, decodeHand, encodeHand } from './replay.ts';

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A plausible move log: a pose, then legal plays and the odd pass. */
function fakeHand(rand: () => number): { moves: Move[]; poser: number } {
  const pool: TileId[] = [];
  for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) pool.push(`${a}-${b}`);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  const poser = Math.floor(rand() * 4);
  const first = pool.shift()!;
  const [fa, fb] = halves(first);
  const moves: Move[] = [{ kind: 'pose', seat: poser, tile: first }];
  let left: Pip = fa, right: Pip = fb;
  let seat = (poser + 1) % 4;

  for (let n = 0; n < 18 && pool.length; n++) {
    if (rand() < 0.18) {
      moves.push({ kind: 'pass', seat });
      seat = (seat + 1) % 4;
      continue;
    }
    const end = rand() < 0.5 ? 'left' : 'right';
    const target = end === 'left' ? left : right;
    const idx = pool.findIndex((t) => halves(t).includes(target));
    if (idx === -1) break;
    const [tile] = pool.splice(idx, 1);
    const [a, b] = halves(tile);
    const other = (a === target ? b : a) as Pip;
    if (end === 'left') left = other; else right = other;
    moves.push({ kind: 'play', seat, tile, end });
    seat = (seat + 1) % 4;
  }
  return { moves, poser };
}

test('a hand survives the round trip through a URL', () => {
  const rand = mulberry32(11);
  for (let i = 0; i < 300; i++) {
    const { moves, poser } = fakeHand(rand);
    const code = encodeHand(moves, poser, 0);
    const back = decodeHand(code);
    assert.ok(back, `seed ${i}: failed to decode "${code}"`);
    assert.equal(back!.steps.length, moves.length);
    assert.equal(back!.poser, poser);

    moves.forEach((move, k) => {
      const step = back!.steps[k];
      assert.equal(step.kind, move.kind, `step ${k} kind`);
      assert.equal(step.seat, move.seat, `step ${k} seat`);
      if ('tile' in move && 'tile' in step) assert.equal(step.tile, move.tile);
      if (move.kind === 'play' && step.kind === 'play') assert.equal(step.end, move.end);
    });
  }
});

test('the rebuilt board matches the tiles that were played', () => {
  const rand = mulberry32(29);
  for (let i = 0; i < 200; i++) {
    const { moves, poser } = fakeHand(rand);
    const replay = decodeHand(encodeHand(moves, poser, 0))!;
    const board = boardAfter(replay, replay.steps.length);
    assert.ok(board, `seed ${i}: board did not rebuild`);

    const played = moves.filter((m) => 'tile' in m).length;
    assert.equal(board!.line.length, played);
    // Every junction must match, or the replay is drawing a line that could
    // not have been played.
    for (let k = 1; k < board!.line.length; k++) {
      const prev = halves(board!.line[k - 1].tile);
      const cur = halves(board!.line[k].tile);
      assert.ok(prev.some((p) => cur.includes(p)), `junction ${k} does not touch`);
    }
  }
});

test('the board grows one tile at a time', () => {
  const rand = mulberry32(5);
  const { moves, poser } = fakeHand(rand);
  const replay = decodeHand(encodeHand(moves, poser, 0))!;
  let last = 0;
  for (let step = 0; step <= replay.steps.length; step++) {
    const board = boardAfter(replay, step);
    const size = board?.line.length ?? 0;
    assert.ok(size === last || size === last + 1, `jumped from ${last} to ${size}`);
    last = size;
  }
});

test('a drawn tile is never published', () => {
  const moves: Move[] = [
    { kind: 'pose', seat: 0, tile: '6-6' },
    { kind: 'draw', seat: 1, tile: '0-3' },
    { kind: 'pass', seat: 1 },
  ];
  const code = encodeHand(moves, 0, 0);
  assert.ok(!code.includes(ALPHABET_FOR('0-3')), 'the drawn tile leaked into the URL');
  const back = decodeHand(code)!;
  assert.equal(back.steps[1].kind, 'draw');
  assert.ok(!('tile' in back.steps[1]), 'a draw must carry no tile');
});

/** The character a tile would encode as, for the leak check above. */
function ALPHABET_FOR(tile: TileId): string {
  const tiles: TileId[] = [];
  for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) tiles.push(`${a}-${b}`);
  return '0123456789abcdefghijklmnopqr'[tiles.indexOf(tile)];
}

test('a drawn tile does not skip the drawing seat', () => {
  // Drawing does not end a turn: the same seat acts again.
  const moves: Move[] = [
    { kind: 'pose', seat: 0, tile: '6-6' },
    { kind: 'draw', seat: 1, tile: '0-3' },
    { kind: 'play', seat: 1, tile: '1-6', end: 'left' },
    { kind: 'pass', seat: 2 },
  ];
  const back = decodeHand(encodeHand(moves, 0, 0))!;
  assert.deepEqual(back.steps.map((s) => s.seat), [0, 1, 1, 2]);
});

test('rubbish in the URL is rejected, never thrown', () => {
  for (const bad of [
    '', 'x', '1', '9004Pa', '1004', '1004Z', '1004P', '1004Pz',
    '1904Pa', '1094Pa', '1000Pa', 'not-a-hand', '1004' + 'P'.repeat(50),
  ]) {
    assert.doesNotThrow(() => decodeHand(bad));
    const out = decodeHand(bad);
    assert.ok(out === null || out.steps.length > 0, `"${bad}" decoded to something empty`);
  }
});

test('a tampered board refuses to draw rather than drawing nonsense', () => {
  // 6-6 posed, then a 1-2 claimed on the left end. It does not touch.
  const replay = decodeHand('1004P' + 'r' + 'L' + '9')!;
  assert.equal(boardAfter(replay, replay.steps.length), null);
});
