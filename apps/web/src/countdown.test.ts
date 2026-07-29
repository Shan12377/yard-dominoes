import test from 'node:test';
import assert from 'node:assert/strict';
import { tickInterval, untilLabel } from './countdown.ts';

const NOW = Date.parse('2026-08-02T09:00:00Z');
const at = (ms: number) => new Date(NOW + ms).toISOString();

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// ----------------------------------------------------------------- label ----
test('days are counted in whole days, because that is what somebody planning '
  + 'their Sunday actually needs', () => {
  assert.equal(untilLabel(at(3 * DAY + 5 * HOUR), NOW), 'in 3 days');
});

test('one day is singular', () => {
  assert.equal(untilLabel(at(DAY + MINUTE), NOW), 'in 1 day');
});

test('under a day falls back to hours', () => {
  assert.equal(untilLabel(at(8 * HOUR), NOW), 'in 8 hours');
});

test('one hour is singular', () => {
  assert.equal(untilLabel(at(HOUR + 30 * SECOND), NOW), 'in 1 hour');
});

test('under an hour falls back to minutes', () => {
  assert.equal(untilLabel(at(5 * MINUTE), NOW), 'in 5 minutes');
});

test('one minute is singular', () => {
  assert.equal(untilLabel(at(MINUTE + SECOND), NOW), 'in 1 minute');
});

test('seconds appear only in the last minute, which is the one time they matter', () => {
  assert.equal(untilLabel(at(30 * SECOND), NOW), 'in 30s');
});

test('the start time itself reads as now, not as zero', () => {
  assert.equal(untilLabel(at(0), NOW), 'now');
});

test('a start time already past never counts backwards — a negative countdown '
  + 'reads as a bug even when it is not', () => {
  assert.equal(untilLabel(at(-3 * HOUR), NOW), 'now');
});

test('an unparseable timestamp reads as now rather than NaN', () => {
  assert.equal(untilLabel('not a date', NOW), 'now');
});

// ------------------------------------------------------------- tick rate ----
test('days out, the label is redrawn hourly — not sixty times a minute to '
  + 'write the same string', () => {
  assert.equal(tickInterval(at(3 * DAY), NOW), HOUR);
});

test('hours out, once a minute', () => {
  assert.equal(tickInterval(at(4 * HOUR), NOW), MINUTE);
});

test('minutes out, every fifteen seconds', () => {
  assert.equal(tickInterval(at(20 * MINUTE), NOW), 15_000);
});

test('inside the final minute, every second', () => {
  assert.equal(tickInterval(at(30 * SECOND), NOW), SECOND);
});

test('once it has started there is nothing left to count, so the caller can '
  + 'stop the timer instead of spinning on "now"', () => {
  assert.equal(tickInterval(at(0), NOW), null);
  assert.equal(tickInterval(at(-HOUR), NOW), null);
});

test('an unparseable timestamp stops the timer rather than spinning', () => {
  assert.equal(tickInterval('not a date', NOW), null);
});
