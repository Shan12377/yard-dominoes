/**
 * Provably fair shuffle.
 *
 * The protocol, and the reason it exists:
 *
 *   1. Before the deal, the server generates `serverSeed` and publishes
 *      SHA-256(serverSeed) to every player. It is now committed — it cannot
 *      change the seed later without breaking the hash.
 *   2. Every client contributes a `clientSeed`. The server cannot know these
 *      in advance, so it cannot search for a serverSeed that produces a
 *      favourable deal.
 *   3. The deal is a deterministic Fisher-Yates shuffle keyed on
 *      HMAC-SHA256(serverSeed, clientSeeds ‖ handId).
 *   4. When the hand ends the server reveals `serverSeed`.
 *   5. Any player recomputes the shuffle and confirms it matches what was
 *      dealt.
 *
 * "The algorithm is rigged" is the single most common complaint against every
 * domino app on both stores. This is the only durable answer to it: not a
 * promise, a proof.
 */

import { fullSet, DOUBLE_BLANK } from './tiles.ts';
import type { TileId } from './types.ts';

const enc = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Commitment published to all players BEFORE the deal. */
export async function commit(serverSeed: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(serverSeed)));
}

export async function verifyCommitment(serverSeed: string, published: string): Promise<boolean> {
  return (await commit(serverSeed)) === published;
}

export function randomSeed(bytes = 32): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/**
 * Deterministic keystream. Counter-mode HMAC gives us as many unbiased bytes
 * as the shuffle needs, reproducibly.
 */
async function keystream(serverSeed: string, message: string, blocks: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(serverSeed),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const out = new Uint8Array(blocks * 32);
  for (let i = 0; i < blocks; i++) {
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${message}:${i}`));
    out.set(new Uint8Array(sig), i * 32);
  }
  return out;
}

/**
 * Unbiased integer in [0, max) via rejection sampling. Naive modulo would
 * skew the deal very slightly — which is exactly the kind of thing a player
 * running the verifier would eventually catch.
 */
function boundedInt(stream: Uint8Array, cursor: { i: number }, max: number): number {
  if (max <= 1) return 0;
  const limit = Math.floor(0x100000000 / max) * max;
  for (;;) {
    if (cursor.i + 4 > stream.length) throw new Error('keystream exhausted');
    const v =
      ((stream[cursor.i] << 24) >>> 0) +
      (stream[cursor.i + 1] << 16) +
      (stream[cursor.i + 2] << 8) +
      stream[cursor.i + 3];
    cursor.i += 4;
    if (v < limit) return v % max;
  }
}

export interface ShuffleInput {
  serverSeed: string;
  clientSeeds: string[];
  handId: string;
  removeDoubleBlank?: boolean;
}

/**
 * Deterministic Fisher-Yates over an arbitrary tile array, keyed the same
 * way the deal itself is. Shared by `provablyFairShuffle` (always the fixed
 * 28-tile set) and `shufflePool` (an arbitrary caller-supplied pool — French's
 * mid-hand reshuffle, which has no boneyard to draw fresh tiles from and so
 * has to reshuffle whatever's actually still in play).
 */
async function keyedShuffle(tiles: TileId[], serverSeed: string, message: string): Promise<TileId[]> {
  const out = [...tiles];
  // 32 bytes per block; rejection sampling may burn draws, so allow headroom.
  const stream = await keystream(serverSeed, message, 8);
  const cursor = { i: 0 };
  for (let i = out.length - 1; i > 0; i--) {
    const j = boundedInt(stream, cursor, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** The deal. Same inputs always produce the same ordering, on any machine. */
export async function provablyFairShuffle(input: ShuffleInput): Promise<TileId[]> {
  const tiles = fullSet().filter((t) => !(input.removeDoubleBlank && t === DOUBLE_BLANK));
  const message = `${input.clientSeeds.join('|')}:${input.handId}`;
  return keyedShuffle(tiles, input.serverSeed, message);
}

/**
 * French's paid mid-hand reshuffle. No boneyard exists in 4-player French —
 * every one of the 28 tiles is always in some seat's hand or already
 * played — so there is no spare pile to draw fresh tiles from. `pool` is
 * whatever the caller pooled together (every still-unplayed seat's hand);
 * this just orders it deterministically and reproducibly from the SAME
 * committed serverSeed the hand's own deal used, keyed by a distinct
 * `handId` suffix so it never collides with the original deal's ordering.
 */
export async function shufflePool(pool: TileId[], input: ShuffleInput): Promise<TileId[]> {
  const message = `${input.clientSeeds.join('|')}:${input.handId}`;
  return keyedShuffle(pool, input.serverSeed, message);
}

export interface HandReceipt {
  handId: string;
  commitment: string;
  serverSeed: string;
  clientSeeds: string[];
  removeDoubleBlank: boolean;
  dealt: TileId[][];
}

/**
 * What the "Verify this hand" button runs. Confirms the revealed seed matches
 * the pre-published commitment AND that the deal follows from it.
 */
export async function verifyHand(receipt: HandReceipt): Promise<{ ok: boolean; reason?: string }> {
  if (!(await verifyCommitment(receipt.serverSeed, receipt.commitment))) {
    return { ok: false, reason: 'revealed seed does not match the published commitment' };
  }
  const order = await provablyFairShuffle({
    serverSeed: receipt.serverSeed,
    clientSeeds: receipt.clientSeeds,
    handId: receipt.handId,
    removeDoubleBlank: receipt.removeDoubleBlank,
  });
  const flat = receipt.dealt.flat();
  const expected = order.slice(0, flat.length);
  for (let i = 0; i < flat.length; i++) {
    if (flat[i] !== expected[i]) return { ok: false, reason: `deal diverges at tile ${i}` };
  }
  return { ok: true };
}
