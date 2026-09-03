import test from 'node:test';
import assert from 'node:assert/strict';
import {
  afterTurn, allowance, deadline, duppyThinkSeconds, FRESH_BANK, maxBank, SPEED_CLOCK, usedBy, YARD_CLOCK,
  DEFAULT_DUPPY_PACE, DUPPY_PACE_LABELS, DUPPY_PACE_NAMES, DUPPY_PACE_SECONDS,
} from '../src/index.ts';
import type { Clock } from '../src/index.ts';

test('a fresh seat gets exactly the base, no more', () => {
  assert.equal(allowance(SPEED_CLOCK, FRESH_BANK), 10);
  assert.equal(allowance(YARD_CLOCK, FRESH_BANK), 20);
});

test('playing fast keeps the difference', () => {
  // Ten seconds granted, three used, seven kept.
  assert.equal(afterTurn(SPEED_CLOCK, FRESH_BANK, 3), 7);
  assert.equal(allowance(SPEED_CLOCK, 7), 17);
});

test('the bank fills over several quick turns and then stops', () => {
  let bank = FRESH_BANK;
  for (let turn = 0; turn < 20; turn++) bank = afterTurn(SPEED_CLOCK, bank, 1);
  assert.equal(bank, maxBank(SPEED_CLOCK));
  // A full bank reaches the ceiling exactly — never past it.
  assert.equal(allowance(SPEED_CLOCK, bank), SPEED_CLOCK.cap);
});

test('no turn can ever run longer than the cap', () => {
  for (const clock of [SPEED_CLOCK, YARD_CLOCK]) {
    for (const bank of [0, 5, 30, 500, Number.MAX_SAFE_INTEGER]) {
      assert.ok(allowance(clock, bank) <= clock.cap,
        `bank ${bank} bought ${allowance(clock, bank)}s against a ${clock.cap}s cap`);
    }
  }
});

test('a long think draws the bank down instead of being free', () => {
  // 10 base + 20 banked = 30 available; a 25-second think leaves 5.
  assert.equal(allowance(SPEED_CLOCK, 20), 30);
  assert.equal(afterTurn(SPEED_CLOCK, 20, 25), 5);
});

test('burning the whole allowance empties the bank rather than going negative', () => {
  assert.equal(afterTurn(SPEED_CLOCK, 30, 40), 0);
  assert.equal(afterTurn(SPEED_CLOCK, 0, 10), 0);
  // Even an over-long sweep cannot push it below empty.
  assert.equal(afterTurn(SPEED_CLOCK, 0, 9999), 0);
});

test('the partner\'s scenario: start at 10, bank up, never past 40', () => {
  let bank = FRESH_BANK;
  const seen: number[] = [];
  // Six brisk turns, then one long read.
  for (let i = 0; i < 6; i++) {
    seen.push(allowance(SPEED_CLOCK, bank));
    bank = afterTurn(SPEED_CLOCK, bank, 4);
  }
  assert.equal(seen[0], 10, 'first turn is the base');
  assert.ok(seen[seen.length - 1] > seen[0], 'a fast player ends up with more time');
  assert.ok(seen.every((s) => s <= 40), `something exceeded the cap: ${seen}`);
  // And the long read is affordable precisely because of the earlier speed.
  assert.ok(allowance(SPEED_CLOCK, bank) >= 30);
});

test('a new hand starts everyone level again', () => {
  const hoard = afterTurn(SPEED_CLOCK, 30, 0);
  assert.equal(hoard, maxBank(SPEED_CLOCK));
  // Nobody carries it into the next hand.
  assert.equal(allowance(SPEED_CLOCK, FRESH_BANK), SPEED_CLOCK.base);
});

test('a late cron sweep never bills a seat for time it was asleep', () => {
  const started = 1_000_000;
  // The job ran five minutes late; the seat still only loses its allowance.
  const used = usedBy(SPEED_CLOCK, FRESH_BANK, started, started + 300_000);
  assert.equal(used, 10);
  assert.equal(afterTurn(SPEED_CLOCK, FRESH_BANK, used), 0);
});

test('elapsed time is measured in seconds, deadlines in milliseconds', () => {
  const started = 5_000;
  assert.equal(deadline(SPEED_CLOCK, FRESH_BANK, started), 15_000);
  assert.equal(deadline(SPEED_CLOCK, 7, started), 22_000);
  assert.equal(usedBy(SPEED_CLOCK, FRESH_BANK, started, 8_000), 3);
});

test('a nonsense clock from a bad table row still plays', () => {
  const broken = { base: Number.NaN, cap: 0 } as Clock;
  assert.ok(allowance(broken, 0) > 0, 'a seat must always get some time');
  assert.ok(Number.isFinite(afterTurn(broken, Number.NaN, Number.NaN)));
  // A cap below the base cannot hand out less than one base turn.
  assert.equal(allowance({ base: 20, cap: 5 }, 0), 20);
  assert.equal(maxBank({ base: 20, cap: 5 }), 0);
});

test('Duppy reading paces are bounded choices, never an arbitrary client delay', () => {
  assert.equal(duppyThinkSeconds('quick'), 3.5);
  assert.equal(duppyThinkSeconds('brisk'), 5);
  assert.equal(duppyThinkSeconds('yard'), 7.5);
  assert.equal(duppyThinkSeconds('relaxed'), 20);
  // Anything unrecognised falls back to the default pace, never to zero —
  // a tampered value must not let a Duppy move instantly.
  assert.equal(duppyThinkSeconds('tampered'), 7.5);
  assert.equal(duppyThinkSeconds(undefined), 7.5);
  assert.equal(duppyThinkSeconds(''), 7.5);
  assert.equal(duppyThinkSeconds(0), 7.5);
});

test('every Duppy pace is listed fastest first and labelled with its real seconds', () => {
  const seconds = DUPPY_PACE_NAMES.map((name) => DUPPY_PACE_SECONDS[name]);
  assert.deepEqual(seconds, [...seconds].sort((a, b) => a - b), 'paces must list fastest to slowest');

  // The label is what a player reads before choosing. If it ever disagrees
  // with the seconds actually served, the picker is lying about the game.
  for (const name of DUPPY_PACE_NAMES) {
    assert.match(
      DUPPY_PACE_LABELS[name],
      new RegExp(`\\b${DUPPY_PACE_SECONDS[name]} seconds? per move$`),
      `${name}'s label must state its own duration`,
    );
  }

  // The default has to be one of the real choices, or duppyPaceByName's
  // fallback would resolve to a pace no picker offers.
  assert.ok(DUPPY_PACE_NAMES.includes(DEFAULT_DUPPY_PACE));
});
