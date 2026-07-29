import test from 'node:test';
import assert from 'node:assert/strict';
import {
  customerOf, expiresAt, GRACE_DAYS, invoicePeriodEnd, PROVISIONAL_DAYS,
  subscriptionPeriodEnd, tierFromInvoice, userFromInvoice,
} from './billing.ts';

const DAY_MS = 86_400_000;
const JAN_2027 = 1_798_761_600; // Unix seconds, comfortably in the future.

test('a subscription on the old API layout still reports its period', () => {
  assert.equal(subscriptionPeriodEnd({ current_period_end: JAN_2027 }), JAN_2027);
});

test('a subscription on the 2025 layout reports its period from the item', () => {
  const sub = { items: { data: [{ current_period_end: JAN_2027 }] } };
  assert.equal(subscriptionPeriodEnd(sub), JAN_2027);
});

test('the paid-through date is the latest item, not the first', () => {
  const sub = { items: { data: [{ current_period_end: JAN_2027 }, { current_period_end: JAN_2027 + DAY_MS }] } };
  assert.equal(subscriptionPeriodEnd(sub), JAN_2027 + DAY_MS);
});

test('a subscription that names no period is null rather than NaN', () => {
  // The regression: undefined here became NaN, and new Date(NaN).toISOString()
  // throws, so the cancellation 500'd and Stripe retried it forever.
  assert.equal(subscriptionPeriodEnd({ customer: 'cus_1' }), null);
  assert.equal(subscriptionPeriodEnd({ items: { data: [] } }), null);
  assert.equal(subscriptionPeriodEnd(null), null);
});

test('rubbish where a timestamp should be is refused', () => {
  assert.equal(subscriptionPeriodEnd({ current_period_end: 'soon' }), null);
  assert.equal(subscriptionPeriodEnd({ current_period_end: 0 }), null);
  assert.equal(subscriptionPeriodEnd({ current_period_end: Number.NaN }), null);
});

test('an invoice pays the membership up to its line period', () => {
  const invoice = { lines: { data: [{ period: { end: JAN_2027 } }] } };
  assert.equal(invoicePeriodEnd(invoice), JAN_2027);
});

test('a proration invoice grants the period it buys, not the one it leaves', () => {
  const invoice = {
    lines: { data: [{ period: { end: JAN_2027 } }, { period: { end: JAN_2027 + 30 * DAY_MS } }] },
  };
  assert.equal(invoicePeriodEnd(invoice), JAN_2027 + 30 * DAY_MS);
});

test('an invoice with no lines is null rather than a crash', () => {
  assert.equal(invoicePeriodEnd({}), null);
  assert.equal(invoicePeriodEnd({ lines: { data: [{}] } }), null);
});

test('a known period expires at that period plus grace', () => {
  const iso = expiresAt(JAN_2027);
  assert.equal(iso, new Date(JAN_2027 * 1000 + GRACE_DAYS * DAY_MS).toISOString());
});

test('an unknown period still expires, and never grants a silent year', () => {
  // Never null: `effective_tier()` reads a null tier_expires_at as forever.
  const now = Date.UTC(2026, 6, 28);
  const iso = expiresAt(null, now);
  const granted = (Date.parse(iso) - now) / DAY_MS;
  assert.equal(granted, PROVISIONAL_DAYS + GRACE_DAYS);
  assert.ok(granted < 60, 'a failed lookup must not hand out a year');
});

test('a subscription we stamped identifies its own member', () => {
  const invoice = { subscription_details: { metadata: { user_id: 'u_1', tier: 'vip' } } };
  assert.equal(userFromInvoice(invoice), 'u_1');
  assert.equal(tierFromInvoice(invoice), 'vip');
});

test('a subscription sold before we stamped them falls back to the customer', () => {
  const invoice = { customer: 'cus_9', lines: { data: [{ period: { end: JAN_2027 } }] } };
  assert.equal(userFromInvoice(invoice), null);
  assert.equal(tierFromInvoice(invoice), null);
  assert.equal(customerOf(invoice), 'cus_9');
});

test('a tier we do not sell is never granted from metadata', () => {
  assert.equal(tierFromInvoice({ subscription_details: { metadata: { tier: 'don' } } }), null);
  assert.equal(tierFromInvoice({ subscription_details: { metadata: { tier: 'guest' } } }), null);
});

test('an expanded customer object is not mistaken for an id', () => {
  assert.equal(customerOf({ customer: { id: 'cus_9' } as unknown }), null);
  assert.equal(customerOf({}), null);
});
