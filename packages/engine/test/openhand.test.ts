// Anti-cheat invariant, expressed as tests. These properties should have been
// executable before openhand was added — they encode the load-bearing claim at
// the top of bots.ts that a bot may only ever see information a human in that
// seat, playing that mode, would also see. Written first, then the code that
// makes them pass.

import test from 'node:test';
import assert from 'node:assert/strict';
import { deal } from '../src/hand.ts';
import { publicView, partnerHandOf, chooseMove } from '../src/bots.ts';
import { isPartnered, sideOf } from '../src/tiles.ts';
import type { GameMode, TileId } from '../src/types.ts';

const ORDER: TileId[] = [
  '0-0', '0-1', '0-2', '0-3', '0-4', '0-5', '0-6',
  '1-1', '1-2', '1-3', '1-4', '1-5', '1-6',
  '2-2', '2-3', '2-4', '2-5', '2-6',
  '3-3', '3-4', '3-5', '3-6',
  '4-4', '4-5', '4-6',
  '5-5', '5-6',
  '6-6',
];

const state = (mode: GameMode) => deal({ order: ORDER, seatCount: 4, mode });

// -------------------------------------------------- the invariant ---------
test('a partner-mode view carries no partner tiles — the field is undefined, '
  + 'and partnerHandOf returns null', () => {
  const s = state('partner');
  for (let seat = 0; seat < 4; seat++) {
    const v = publicView(s, seat);
    assert.equal(v.partnerHand, undefined, `seat ${seat} leaked partner tiles`);
    assert.equal(partnerHandOf(v), null);
  }
});

test('a cutthroat view carries nobody\'s tiles but the seat\'s own — no field '
  + 'in PublicView is capable of holding another seat\'s tiles', () => {
  const s = state('cutthroat');
  for (let seat = 0; seat < 4; seat++) {
    const v = publicView(s, seat);
    assert.equal(v.partnerHand, undefined);
    assert.equal(partnerHandOf(v), null);
    for (let other = 0; other < 4; other++) {
      if (other === seat) continue;
      assert.notDeepEqual(v.myHand, s.hands[other],
        `seat ${seat}'s myHand looks like seat ${other}'s hand`);
    }
  }
});

test('an openhand view carries the partner\'s tiles, and only the partner\'s '
  + '— cutthroat-shaped opponents remain hidden', () => {
  const s = state('openhand');
  for (let seat = 0; seat < 4; seat++) {
    const v = publicView(s, seat);
    const partner = seat ^ 2; // 0<->2, 1<->3, the openhand pairing
    assert.deepEqual(partnerHandOf(v), s.hands[partner],
      `seat ${seat} did not receive partner ${partner}'s tiles`);
    // Positive framing above; the negative framing below is what protects
    // against a bug where openhand quietly starts exposing opponents too.
    for (let other = 0; other < 4; other++) {
      if (other === seat || other === partner) continue;
      assert.notDeepEqual(v.partnerHand, s.hands[other],
        `seat ${seat} was shown opponent ${other}'s tiles in partnerHand`);
    }
  }
});

test('partnerHandOf returns null on any mode other than openhand, even when '
  + 'the field is set — a test fixture cannot bypass the mode gate', () => {
  const s = state('openhand');
  const v = publicView(s, 0);
  // Simulate a caller who forged the mode after the fact.
  const forged = { ...v, mode: 'partner' as const };
  assert.equal(partnerHandOf(forged), null);
});

// -------------------------------------------------- pairing preserved -----
test('openhand pairs seats exactly like partner — 0&2, 1&3, and the same side '
  + 'count', () => {
  for (let seat = 0; seat < 4; seat++) {
    assert.equal(sideOf(seat, 'openhand'), sideOf(seat, 'partner'),
      `seat ${seat} maps to a different side under openhand`);
  }
  assert.equal(isPartnered('openhand'), true);
  assert.equal(isPartnered('partner'), true);
  assert.equal(isPartnered('cutthroat'), false);
});

// -------------------------------------------------- bots use it safely ----
test('chooseMove in openhand picks a legal move at every level — the new '
  + 'partner-tile field does not blow up the naive strategy path', () => {
  const s = state('openhand');
  for (const level of ['pickney', 'yard', 'ranker', 'don'] as const) {
    const v = publicView(s, s.turn);
    const move = chooseMove(v, level);
    assert.equal(move.seat, s.turn, `${level} chose a move for the wrong seat`);
  }
});
