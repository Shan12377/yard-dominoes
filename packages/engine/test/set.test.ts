import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { createSet, applyHandResult } from '../src/set.ts';
import { deal, legalMoves, applyMove } from '../src/hand.ts';
import { provablyFairShuffle } from '../src/shuffle.ts';
import { handCount, dealPlan } from '../src/tiles.ts';
import type { HandResult, SetOptions, SetState } from '../src/types.ts';

/** A decisive hand won by `seat` (partner sides: even seats = 0, odd = 1). */
function won(seat: number): HandResult {
  return {
    status: 'domino',
    winnerSeat: seat,
    winnerSide: seat % 2,
    tie: false,
    counts: [0, 5, 5, 5],
  };
}

const tied: HandResult = {
  status: 'blocked',
  winnerSeat: null,
  winnerSide: null,
  tie: true,
  counts: [6, 6, 9, 9],
};

describe('six love', () => {
  test('a side that keeps winning keeps adding', () => {
    let s = createSet({ mode: 'partner', format: 'sixlove' });
    for (let i = 1; i <= 5; i++) {
      s = applyHandResult(s, won(0));
      assert.deepEqual(s.scores, [i, 0]);
      assert.equal(s.winnerSide, null);
    }
    s = applyHandResult(s, won(0));
    assert.deepEqual(s.scores, [6, 0]);
    assert.equal(s.winnerSide, 0);
    assert.equal(s.sixLove, true, 'six straight with the opponent under love');
  });

  test('the six opens the first hand of every set and must be LED, casual included', async () => {
    // House rule: a set always starts on the double six, led, whatever the
    // table's casual/tournament setting says. Two things had to be true for
    // that to hold, and each was separately broken once:
    //
    //   1. The 6-6's holder opens — not seat 0. The callers used to pass
    //      set.poser ("the previous winner opens") on hand one, where there
    //      is no previous winner, so the open fell to seat 0 whoever held it.
    //   2. He must LEAD it, not merely hold it. createSet only forced that
    //      for tournament tables, and the lounge never sends `tournament` at
    //      all — so no online set forced the six.
    for (const tournament of [false, true]) {
      const s = createSet({ mode: 'cutthroat', format: 'firstToSix', seatCount: 4, tournament });
      assert.equal(s.handsPlayed, 0);
      assert.equal(s.poseMustBeDoubleSix, true, 'a fresh set always opens on the six');

      for (let i = 0; i < 25; i++) {
        const order = await provablyFairShuffle({
          serverSeed: `seed-${tournament}-${i}`, clientSeeds: ['c'], handId: `h${i}`,
        });
        const h = deal({
          order,
          seatCount: 4,
          mode: 'cutthroat',
          useBoneyard: false,
          // The caller rule under test, mirrored from local.ts / start-hand.
          poser: s.poseMustBeDoubleSix || s.handsPlayed === 0 ? undefined : s.poser,
          poseMustBeDoubleSix: s.poseMustBeDoubleSix,
        });
        assert.ok(
          h.hands[h.poser].includes('6-6'),
          `${tournament ? 'tournament' : 'casual'}: seat ${h.poser} opened without holding the six`,
        );
        assert.deepEqual(legalMoves(h), [{ kind: 'pose', seat: h.poser, tile: '6-6' }],
          `${tournament ? 'tournament' : 'casual'}: the six must be led, no sporting to open a set`);
      }
    }
  });

  test('tournament forces the six at the same three moments as casual, not every hand', () => {
    // The six opens a set's FIRST hand, a tied replay, and the hand after a
    // bruk. That is the whole list, and it is identical in casual and
    // tournament play — tournament is not "the six every hand". Both callers
    // used to OR the tournament flag into the deal, which meant a tournament
    // set never let the previous winner pose at all.
    for (const tournament of [false, true]) {
      const label = tournament ? 'tournament' : 'casual';
      let s = createSet({ mode: 'partner', format: 'sixlove', tournament });
      assert.equal(s.poseMustBeDoubleSix, true, `${label}: a set opens on the six`);

      // An ordinary win hands the pose to the winner, six no longer forced.
      s = applyHandResult(s, won(1));
      assert.equal(s.poseMustBeDoubleSix, false, `${label}: the winner poses the next hand`);
      assert.equal(s.poser, 1);

      // A tied blocked hand puts the six back on the open.
      s = applyHandResult(s, { tie: true, counts: [5, 5, 5, 5], winnerSide: null, winnerSeat: null });
      assert.equal(s.poseMustBeDoubleSix, true, `${label}: a tie replays on the six`);

      // And the bruk — the side under love wins, the score resets to love-all
      // and the set effectively starts over, so the six opens again.
      let b = createSet({ mode: 'partner', format: 'sixlove', tournament });
      b = applyHandResult(b, won(0));            // side 0 leads 1-0
      assert.equal(b.poseMustBeDoubleSix, false);
      b = applyHandResult(b, won(1));            // the side on zero strikes back
      assert.deepEqual(b.scores, [0, 0], `${label}: a bruk resets to love-all`);
      assert.equal(b.poseMustBeDoubleSix, true, `${label}: the six opens after a bruk`);
    }
  });

  test('French opens its first hand on the chucha, not the six', async () => {
    // The same always-forced flag drives French, where the opening tile is
    // the double blank. Forcing the six there would break the chucha rule.
    const s = createSet({ format: 'french' });
    assert.equal(s.poseMustBeDoubleSix, true);
    for (let i = 0; i < 15; i++) {
      const order = await provablyFairShuffle({
        serverSeed: `fr-${i}`, clientSeeds: ['c'], handId: `h${i}`,
      });
      const h = deal({
        order,
        seatCount: 4,
        mode: 'cutthroat',
        useBoneyard: false,
        poser: undefined,
        poseMustBeDoubleSix: true,
        openingTile: '0-0',
        format: 'french',
      });
      assert.ok(h.hands[h.poser].includes('0-0'), 'the chucha holder opens French');
      assert.deepEqual(legalMoves(h), [{ kind: 'pose', seat: h.poser, tile: '0-0' }]);
    }
  });

  test('the winner of a hand poses the next one, and may pose anything', () => {
    let s = createSet({ mode: 'partner', format: 'sixlove' });
    s = applyHandResult(s, won(3));
    assert.equal(s.poser, 3);
    assert.equal(s.poseMustBeDoubleSix, false);
  });

  test('a win by the side under love BRUKS the score back to love all', () => {
    let s = createSet({ mode: 'partner', format: 'sixlove', oneAllPlayTwo: false });
    s = applyHandResult(s, won(0));
    s = applyHandResult(s, won(0));
    s = applyHandResult(s, won(0));
    assert.deepEqual(s.scores, [3, 0]);

    s = applyHandResult(s, won(1)); // the trailing side strikes
    assert.deepEqual(s.scores, [0, 0], 'everything resets — they do not score 1');
    assert.equal(s.poseMustBeDoubleSix, true, 'the double-six opens after a bruk');
    assert.equal(s.handValue, 1);
    assert.equal(s.winnerSide, null);
  });

  test('a five-nil lead is worth nothing if they win the sixth', () => {
    let s = createSet({ mode: 'partner', format: 'sixlove', oneAllPlayTwo: false });
    for (let i = 0; i < 5; i++) s = applyHandResult(s, won(2));
    assert.deepEqual(s.scores, [5, 0]);
    s = applyHandResult(s, won(1));
    assert.deepEqual(s.scores, [0, 0]);
    assert.equal(s.winnerSide, null);
  });

  test('only one side can ever hold points', () => {
    let s = createSet({ mode: 'partner', format: 'sixlove', oneAllPlayTwo: false });
    const seats = [0, 1, 0, 0, 1, 2, 3, 0, 2, 1, 1, 0];
    for (const seat of seats) {
      s = applyHandResult(s, won(seat));
      if (s.winnerSide !== null) break;
      assert.ok(s.scores.filter((v) => v > 0).length <= 1, `bad scoreline ${s.scores}`);
    }
  });
});

describe('one all play two', () => {
  test('at one all the score does not reset — a two point decider is played', () => {
    let s = createSet({ mode: 'partner', format: 'sixlove', oneAllPlayTwo: true });
    s = applyHandResult(s, won(0));
    assert.deepEqual(s.scores, [1, 0]);

    s = applyHandResult(s, won(1)); // would normally bruk
    assert.deepEqual(s.scores, [0, 0]);
    assert.equal(s.playoff, true);
    assert.equal(s.handValue, 2, 'the playoff hand is worth two');
    assert.equal(s.poseMustBeDoubleSix, true);

    s = applyHandResult(s, won(1));
    assert.deepEqual(s.scores, [0, 2], 'the playoff winner goes straight to two');
    assert.equal(s.playoff, false);
    assert.equal(s.handValue, 1);
  });

  test('with the rule off, one all simply bruks', () => {
    let s = createSet({ mode: 'partner', format: 'sixlove', oneAllPlayTwo: false });
    s = applyHandResult(s, won(0));
    s = applyHandResult(s, won(1));
    assert.deepEqual(s.scores, [0, 0]);
    assert.equal(s.playoff, false);
    assert.equal(s.handValue, 1);
  });
});

describe('tied blocked hands', () => {
  test('a tie is replayed for a flat 2 points, whatever the score currently reads', () => {
    let s = createSet({ mode: 'partner', format: 'sixlove' });
    assert.equal(s.handValue, 1);

    s = applyHandResult(s, tied);
    assert.equal(s.handValue, 2);
    assert.equal(s.poseMustBeDoubleSix, true, 'the double-six opens the replay');

    // A tie AGAIN just repeats — still forced double-six, still worth 2,
    // never climbing to 3 or 4 the way an earlier version did.
    s = applyHandResult(s, tied);
    assert.equal(s.handValue, 2);
    assert.equal(s.poseMustBeDoubleSix, true);

    s = applyHandResult(s, won(0));
    assert.deepEqual(s.scores, [2, 0], 'the replay was worth a flat 2, however many ties preceded it');
    assert.equal(s.handValue, 1, 'value resets once a hand is decided');
  });

  test('the double-six opens the replay even when a side already leads — never "sporting"', () => {
    let s = createSet({ mode: 'partner', format: 'sixlove' });
    s = applyHandResult(s, won(1)); // side 1 to 1-0
    s = applyHandResult(s, tied);
    assert.equal(s.handValue, 2);
    assert.equal(s.poseMustBeDoubleSix, true, 'forced double-six, regardless of who leads');
  });

  test('a leading side that loses the replay loses everything', () => {
    let s = createSet({ mode: 'partner', format: 'sixlove', oneAllPlayTwo: false });
    s = applyHandResult(s, won(0));
    s = applyHandResult(s, won(0)); // 2-0
    s = applyHandResult(s, tied);   // replay worth 2
    assert.equal(s.handValue, 2);
    s = applyHandResult(s, won(1)); // leaders lose the replay
    assert.deepEqual(s.scores, [0, 0]);
    assert.equal(s.handValue, 1);
  });
});

describe('other formats', () => {
  test('first to six is a plain race with no bruk', () => {
    let s = createSet({ mode: 'partner', format: 'firstToSix' });
    s = applyHandResult(s, won(0));
    s = applyHandResult(s, won(1));
    assert.deepEqual(s.scores, [1, 1], 'nothing resets');
    for (let i = 0; i < 5; i++) s = applyHandResult(s, won(0));
    assert.equal(s.winnerSide, 0);
    assert.equal(s.sixLove, false, 'not a six love — the opponent scored');
  });

  test('cut throat gives every seat its own score', () => {
    let s = createSet({ mode: 'cutthroat', format: 'sixlove', seatCount: 4 });
    assert.equal(s.scores.length, 4);
    s = applyHandResult(s, { ...won(2), winnerSide: 2 });
    assert.deepEqual(s.scores, [0, 0, 1, 0]);
  });

  test('a single hand decides immediately', () => {
    let s = createSet({ format: 'single' });
    s = applyHandResult(s, won(1));
    assert.equal(s.winnerSide, 1);
  });
});

// ---------------------------------------------------------------------------
// End-to-end simulation. Plays complete sets with a random-legal-move bot and
// asserts the invariants that must never break, whatever the tiles do.
// ---------------------------------------------------------------------------

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function playSet(
  opts: Partial<SetOptions>,
  seedNum: number,
  maxHands = 400,
): Promise<SetState> {
  const rng = mulberry32(seedNum);
  let s = createSet(opts);
  const { seatCount, mode, useBoneyard } = s.options;
  const { perPlayer, removeDoubleBlank } = dealPlan(seatCount, useBoneyard);

  let hands = 0;
  while (s.winnerSide === null) {
    if (++hands > maxHands) throw new Error('set failed to terminate');

    const order = await provablyFairShuffle({
      serverSeed: `srv-${seedNum}`,
      clientSeeds: [`c-${hands}`],
      handId: `h-${hands}`,
      removeDoubleBlank,
    });
    let h = deal({
      order,
      seatCount,
      mode,
      useBoneyard,
      poser: s.poseMustBeDoubleSix ? undefined : s.poser,
      poseMustBeDoubleSix: s.poseMustBeDoubleSix,
    });

    const dealtTotal = h.hands.flat().length + h.boneyard.length;
    assert.equal(dealtTotal, removeDoubleBlank ? 27 : 28, 'every tile accounted for at the deal');
    assert.equal(h.hands[0].length, perPlayer);

    let steps = 0;
    while (h.status === 'active') {
      if (++steps > 500) throw new Error('hand failed to terminate');
      const moves = legalMoves(h);
      assert.ok(moves.length > 0, 'an active hand always offers at least one legal move');
      h = applyMove(h, moves[Math.floor(rng() * moves.length)]);

      const onBoard = h.board ? h.board.line.length : 0;
      const inHands = h.hands.flat().length;
      assert.equal(
        onBoard + inHands + h.boneyard.length,
        removeDoubleBlank ? 27 : 28,
        'tiles are conserved on every single move',
      );
    }

    assert.ok(h.result);
    if (h.status === 'domino') {
      assert.equal(h.hands[h.result!.winnerSeat!].length, 0);
      assert.equal(h.result!.tie, false);
    } else {
      assert.equal(h.consecutivePasses, seatCount, 'a block means everyone passed in turn');
      if (!h.result!.tie) {
        const lowest = Math.min(...h.result!.counts);
        assert.equal(h.result!.counts[h.result!.winnerSeat!], lowest);
        assert.equal(h.result!.counts.filter((c) => c === lowest).length, 1);
      }
    }
    for (let seat = 0; seat < seatCount; seat++) {
      assert.equal(h.result!.counts[seat], handCount(h.hands[seat]));
    }

    s = applyHandResult(s, h.result!);
    assert.ok(s.scores.every((v) => v >= 0));
  }
  return s;
}

describe('full game simulation', () => {
  test('partner six love sets always terminate with a legal scoreline', async () => {
    for (let seed = 1; seed <= 25; seed++) {
      const s = await playSet({ mode: 'partner', format: 'sixlove', seatCount: 4 }, seed);
      assert.ok(s.winnerSide === 0 || s.winnerSide === 1);
      assert.ok(s.scores[s.winnerSide!] >= 6);
      assert.equal(s.scores[1 - s.winnerSide!], 0, 'six love means the loser is under love');
      assert.equal(s.sixLove, true);
    }
  });

  test('cut throat sets always terminate', async () => {
    for (let seed = 1; seed <= 5; seed++) {
      // Six love in a four-hander demands six wins IN A ROW from one player.
      // Under random play that is a rare event, so this needs a long horizon.
      const s = await playSet({ mode: 'cutthroat', format: 'sixlove', seatCount: 4 }, seed, 40000);
      assert.ok(s.scores[s.winnerSide!] >= 6);
      assert.equal(
        s.scores.filter((v) => v > 0).length, 1,
        'everyone else finishes under love',
      );
    }
  });

  test('three handers work with the double-blank removed', async () => {
    for (let seed = 1; seed <= 10; seed++) {
      const s = await playSet({ mode: 'cutthroat', format: 'firstToSix', seatCount: 3 }, seed);
      assert.ok(s.winnerSide !== null);
    }
  });

  test('two handers work, with and without a boneyard', async () => {
    for (let seed = 1; seed <= 8; seed++) {
      const plain = await playSet(
        { mode: 'cutthroat', format: 'firstToSix', seatCount: 2, useBoneyard: false }, seed,
      );
      assert.ok(plain.winnerSide !== null);
      const drawn = await playSet(
        { mode: 'cutthroat', format: 'firstToSix', seatCount: 2, useBoneyard: true }, seed,
      );
      assert.ok(drawn.winnerSide !== null);
    }
  });

  test('tournament mode always opens on the double-six', async () => {
    for (let seed = 1; seed <= 8; seed++) {
      const s = await playSet(
        { mode: 'partner', format: 'sixlove', seatCount: 4, tournament: true }, seed,
      );
      assert.ok(s.winnerSide !== null);
    }
  });
});

describe('pass the pose', () => {
  test('the winning seat can hand the pose across the table', async () => {
    const { passPoseToPartner } = await import('../src/set.ts');
    let s = createSet({ mode: 'partner', format: 'sixlove' });
    s = applyHandResult(s, won(1));   // seat 1 wins and holds the pose
    assert.equal(s.poser, 1);
    s = passPoseToPartner(s);
    assert.equal(s.poser, 3, 'the pose crosses to the partner seat');
    assert.equal(s.poseMustBeDoubleSix, false);
  });

  test('the pose cannot be passed when the six is forced', async () => {
    const { passPoseToPartner } = await import('../src/set.ts');
    const s = createSet({ mode: 'partner', format: 'sixlove' }); // fresh set: six opens
    assert.throws(() => passPoseToPartner(s), /double-six/);
  });

  test('cut throat has no partner to pass to', async () => {
    const { passPoseToPartner } = await import('../src/set.ts');
    let s = createSet({ mode: 'cutthroat', format: 'firstToSix', seatCount: 4 });
    s = applyHandResult(s, { ...won(2), winnerSide: 2 });
    assert.throws(() => passPoseToPartner(s), /partner/);
  });
});

describe('the key tile', () => {
  test('a key win scores a flat 2 on an ordinary hand, not handValue (1)', () => {
    let s = createSet({ mode: 'partner', format: 'sixlove' });
    s = applyHandResult(s, { ...won(0), keyWin: true });
    assert.deepEqual(s.scores, [2, 0]);
  });

  test('a key win during an already-elevated one-all-play-two decider (handValue 2) still lands on exactly 2, not 3', () => {
    let s = createSet({ mode: 'partner', format: 'sixlove' });
    s = applyHandResult(s, won(0));              // 1-0
    s = applyHandResult(s, { ...won(1), winnerSide: 1 }); // 0 on zero beats the leader on 1 -> bruk, playoff worth 2
    assert.equal(s.playoff, true);
    assert.equal(s.handValue, 2);
    s = applyHandResult(s, { ...won(1), winnerSide: 1, keyWin: true });
    assert.deepEqual(s.scores, [0, 2]);
  });

  test('firstToSix also scores a key win as a flat 2', () => {
    let s = createSet({ mode: 'cutthroat', format: 'firstToSix', seatCount: 4 });
    s = applyHandResult(s, { ...won(2), winnerSide: 2, keyWin: true });
    assert.equal(s.scores[2], 2);
  });

  test('a non-key win is unaffected — still just handValue', () => {
    let s = createSet({ mode: 'partner', format: 'sixlove' });
    s = applyHandResult(s, won(0));
    assert.deepEqual(s.scores, [1, 0]);
  });
});
