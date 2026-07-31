// Stripe webhook. The ONLY writer to profiles.tier, payments and coin_ledger
// purchase/refund rows.
//
// Env: STRIPE_WEBHOOK_SECRET, STRIPE_SECRET_KEY. Set verify_jwt = false for
// this function (Stripe cannot send a Supabase JWT).
//
// Enable exactly these events on the endpoint in the Stripe dashboard —
// test mode and live mode each have their own endpoint and event list, so
// ticking one does nothing to the other (see billing.md's cutover
// checklist):
//   checkout.session.completed      — first payment: grants the tier, or coins
//   invoice.paid                    — every renewal: extends the tier
//   customer.subscription.deleted   — cancelled: stops renewing
//   charge.refunded                 — revoke immediately
//   charge.dispute.created          — revoke immediately, flag the account
// `invoice.paid` is not optional. Without it a membership expires at the end
// of the term it was bought with and never renews, however much the member
// keeps paying. `invoice.payment_failed` deliberately has no handler: Stripe
// dunning retries for weeks and ends in subscription.deleted, which is
// handled, so acting on the first failure would cut off a member whose card
// is about to go through.

import { json, serviceClient } from '../_shared/lib.ts';
import {
  customerOf, expiresAt, invoicePeriodEnd, subscriptionPeriodEnd,
  tierFromInvoice, userFromInvoice,
} from '../_shared/billing.ts';
import type { StripeSubscription } from '../_shared/billing.ts';

const enc = new TextEncoder();

/**
 * Read an object back from Stripe. Needed twice: the checkout session says
 * which tier was bought but never how long for (the term lives in a price id
 * set in the dashboard, so guessing it here is guessing at somebody's money),
 * and a Dispute names only the charge it came from, never the customer.
 *
 * Returns null rather than throwing — a 500 here makes Stripe retry the event
 * forever, and every caller has a safe fallback.
 */
async function stripeGet(path: string): Promise<Record<string, unknown> | null> {
  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key) return null;
  try {
    const res = await fetch(`https://api.stripe.com/v1/${path}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** Verify Stripe's signature header against the raw body. */
async function verifySignature(payload: string, header: string | null, secret: string): Promise<boolean> {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const t = parts['t'];
  const v1 = parts['v1'];
  if (!t || !v1) return false;
  // Reject stale events (replay window: 5 minutes).
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;

  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${payload}`));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
  // Constant-time compare.
  if (hex.length !== v1.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ v1.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!secret) return json({ error: 'webhook not configured' }, 503);

  const payload = await req.text();
  const ok = await verifySignature(payload, req.headers.get('stripe-signature'), secret);
  if (!ok) return json({ error: 'bad signature' }, 400);

  const event = JSON.parse(payload);
  const db = serviceClient();

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.metadata?.user_id ?? session.client_reference_id;
    const tier = session.metadata?.tier;

    // Coins are a one-time payment, never a subscription — handled first and
    // separately, since a coin session carries none of the subscription
    // fields (session.subscription, subscription_data) the tier branch reads.
    if (userId && session.metadata?.product === 'coins') {
      const coins = Number(session.metadata?.coins);
      if (Number.isInteger(coins) && coins > 0) {
        // grant_coins is idempotent on this session id, so a Stripe retry of
        // this same event is a safe no-op rather than a double grant. Errors
        // are logged rather than swallowed — an RPC failure here is a paid
        // coin purchase that silently granted nothing, which must be
        // diagnosable from the function logs, not invisible.
        const { error: grantError } = await db.rpc('grant_coins', {
          p_user_id: userId, p_amount: coins, p_kind: 'purchase', p_reference: session.id,
        });
        if (grantError) console.error('grant_coins failed', grantError);
      }
    } else if (userId && (tier === 'yardie' || tier === 'vip')) {
      // Was a hardcoded year. A monthly price therefore bought twelve months
      // for one, and cancelling after the first payment kept the other eleven.
      const subId = typeof session.subscription === 'string' ? session.subscription : null;
      const sub = subId ? await stripeGet(`subscriptions/${subId}`) : null;
      const expires = expiresAt(subscriptionPeriodEnd(sub as StripeSubscription | null));
      await db.from('profiles').update({
        tier,
        tier_expires_at: expires,
        stripe_customer_id: session.customer ?? null,
      }).eq('id', userId);
      await db.from('payments').insert({
        user_id: userId,
        stripe_session_id: session.id,
        tier,
        amount_cents: session.amount_total ?? 0,
        currency: session.currency ?? 'usd',
      });
    }
  }

  // Every renewal lands here. Without it a membership quietly dies at the end
  // of the term it was bought with, while Stripe carries on charging for it.
  if (event.type === 'invoice.paid') {
    const invoice = event.data.object;
    const paidTo = invoicePeriodEnd(invoice);
    if (paidTo !== null) {
      const tier = tierFromInvoice(invoice);
      const patch = { tier_expires_at: expiresAt(paidTo), ...(tier ? { tier } : {}) };
      // Subscriptions sold from this checkout carry the member's id, so a
      // renewal resolves without depending on checkout.session.completed
      // having landed first. Ones sold before that are found by customer.
      const userId = userFromInvoice(invoice);
      const customer = customerOf(invoice);
      if (userId) await db.from('profiles').update(patch).eq('id', userId);
      else if (customer) await db.from('profiles').update(patch).eq('stripe_customer_id', customer);
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object;
    const customer = customerOf(sub);
    if (customer) {
      // Let the term they paid for run out; just do not renew. Stripe fires
      // this at the end of the period, so an unreadable date means now.
      await db.from('profiles')
        .update({ tier_expires_at: expiresAt(subscriptionPeriodEnd(sub) ?? Math.floor(Date.now() / 1000)) })
        .eq('stripe_customer_id', customer);
    }
  }

  // "A refunded member is not a member" — .claude/rules/billing.md. Expiring
  // rather than clearing `tier` keeps the record of what they had, and the
  // hold stops a later payment quietly re-granting it without a human looking.
  const revokes: Record<string, 'refunded' | 'disputed'> = {
    'charge.refunded': 'refunded',
    'charge.dispute.created': 'disputed',
  };
  const hold = revokes[event.type];
  if (hold) {
    const object = event.data.object;
    // A Charge carries its customer. A Dispute does not — it names only the
    // charge it came from, so that has to be read back before we know whose
    // membership this is.
    let customer = customerOf(object);
    if (!customer && typeof object?.charge === 'string') {
      customer = customerOf(await stripeGet(`charges/${object.charge}`));
    }
    if (customer) {
      await db.from('profiles')
        .update({ tier_expires_at: new Date().toISOString(), billing_hold: hold })
        .eq('stripe_customer_id', customer);
    }
  }

  return json({ received: true });
});
