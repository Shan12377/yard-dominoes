// Reading paid periods out of Stripe payloads. Pure — no Deno, no network — so
// `npm test` can cover it without a Stripe account or a Deno runtime.
//
// Stripe moved `current_period_end` off the Subscription object and onto its
// items in the 2025-03-31 API version, so every read here checks both places.
// This is not defensive padding: reading the absent one yields undefined,
// `undefined * 1000` is NaN, and `new Date(NaN).toISOString()` throws — which
// is exactly how a cancellation used to 500 the webhook, retry forever, and
// never actually apply.

/** Slack past the paid period, for clock skew and Stripe's retry lag. */
export const GRACE_DAYS = 2;

/**
 * What to grant when Stripe never told us the term. Bounded on purpose: a null
 * `tier_expires_at` reads as members-forever in `effective_tier()`, so the
 * failure has to expire. One month never locks out a monthly subscriber, and
 * caps an annual one's over-grant at a month that `invoice.paid` corrects.
 */
export const PROVISIONAL_DAYS = 31;

const DAY_MS = 86_400_000;

interface Period { end?: unknown }
interface Line { period?: Period }

export interface StripeSubscription {
  customer?: unknown;
  current_period_end?: unknown;
  items?: { data?: { current_period_end?: unknown }[] };
}

export interface StripeInvoice {
  customer?: unknown;
  subscription_details?: { metadata?: Record<string, unknown> | null } | null;
  lines?: { data?: Line[] };
}

/** A Unix-seconds timestamp Stripe actually sent, or null for anything else. */
function seconds(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** When a subscription's paid period ends, across both API layouts. */
export function subscriptionPeriodEnd(sub: StripeSubscription | null | undefined): number | null {
  if (!sub) return null;
  const direct = seconds(sub.current_period_end);
  if (direct !== null) return direct;
  const items = sub.items?.data ?? [];
  // Items can differ; the subscription is paid up to the last one standing.
  return items.reduce<number | null>(
    (latest, item) => {
      const end = seconds(item?.current_period_end);
      return end !== null && (latest === null || end > latest) ? end : latest;
    },
    null,
  );
}

/** How far an invoice pays a membership forward. */
export function invoicePeriodEnd(invoice: StripeInvoice | null | undefined): number | null {
  const lines = invoice?.lines?.data ?? [];
  // A proration invoice carries the period it is leaving as well as the one it
  // is buying, so the newest line is the one that decides.
  return lines.reduce<number | null>(
    (latest, line) => {
      const end = seconds(line?.period?.end);
      return end !== null && (latest === null || end > latest) ? end : latest;
    },
    null,
  );
}

/** The timestamp to write to `tier_expires_at`, grace included. */
export function expiresAt(periodEnd: number | null, now = Date.now()): string {
  const base = periodEnd !== null ? periodEnd * 1000 : now + PROVISIONAL_DAYS * DAY_MS;
  return new Date(base + GRACE_DAYS * DAY_MS).toISOString();
}

/** A Stripe id we put on the object ourselves, or null if it is not ours. */
function id(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Who an invoice belongs to. Only subscriptions sold after the checkout
 * function started stamping `subscription_data[metadata]` carry this; older
 * ones have to be found by customer id instead.
 */
export function userFromInvoice(invoice: StripeInvoice | null | undefined): string | null {
  return id(invoice?.subscription_details?.metadata?.user_id);
}

/** The tier an invoice renews, when the subscription says so. */
export function tierFromInvoice(invoice: StripeInvoice | null | undefined): 'yardie' | 'vip' | null {
  const tier = invoice?.subscription_details?.metadata?.tier;
  return tier === 'yardie' || tier === 'vip' ? tier : null;
}

/** The Stripe customer to match a profile on. */
export function customerOf(object: { customer?: unknown } | null | undefined): string | null {
  return id(object?.customer);
}
