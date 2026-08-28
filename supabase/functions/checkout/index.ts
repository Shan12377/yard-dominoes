// POST /checkout  { tier: 'yardie' | 'vip' } | { coins: 'coins25' }
//
// Creates a Stripe Checkout session. Because we are web-first with no app
// store, this is a plain card payment — no 30% platform cut, no IAP rules,
// instant activation on webhook. Compare JamDom, where Jamaican players
// deposit at a bank branch and email the receipt.
//
// Env needed: STRIPE_SECRET_KEY, STRIPE_PRICE_YARDIE, STRIPE_PRICE_VIP,
// STRIPE_PRICE_COINS25, SITE_URL. Set with `supabase secrets set`.

import { handled, json, requireUser, serviceClient, HttpError } from '../_shared/lib.ts';

const TIER_PRICES: Record<string, string | undefined> = {
  yardie: Deno.env.get('STRIPE_PRICE_YARDIE'),
  vip: Deno.env.get('STRIPE_PRICE_VIP'),
};

// Coin packs. One today ($5 -> 25 coins, per the confirmed spec) — a plain
// map so a second pack is a one-line addition, not a schema change.
const COIN_PACKS: Record<string, { price: string | undefined; coins: number }> = {
  coins25: { price: Deno.env.get('STRIPE_PRICE_COINS25'), coins: 25 },
};

Deno.serve(handled(async (req) => {
  const user = await requireUser(req);
  const body = await req.json() as { tier?: 'yardie' | 'vip'; coins?: string };
  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key) throw new HttpError(503, 'payments are not configured yet');

  const db = serviceClient();
  const { data: profile } = await db.from('profiles')
    .select('stripe_customer_id, username, referred_by_code_id').eq('id', user.id).single();

  // Trimmed defensively: a stray trailing newline from a pasted dashboard
  // secret once turned this into an embedded-newline URL that Stripe
  // rejected outright with "Not a valid URL".
  const siteUrl = (Deno.env.get('SITE_URL') ?? '').trim();

  const params = new URLSearchParams({
    client_reference_id: user.id,
    'metadata[user_id]': user.id,
  });
  if (profile?.stripe_customer_id) params.set('customer', profile.stripe_customer_id);

  if (body.coins) {
    // Coins are a one-time purchase, never a subscription — there is no
    // recurring "coin membership". mode: 'payment', not 'subscription'.
    const pack = COIN_PACKS[body.coins];
    if (!pack?.price) throw new HttpError(503, 'payments are not configured yet');
    params.set('mode', 'payment');
    params.set('line_items[0][price]', pack.price);
    params.set('line_items[0][quantity]', '1');
    params.set('success_url', `${siteUrl}/?coins=${pack.coins}`);
    params.set('cancel_url', `${siteUrl}/?coins=cancelled`);
    params.set('metadata[product]', 'coins');
    params.set('metadata[coins]', String(pack.coins));
  } else if (body.tier) {
    const tier = body.tier;
    const price = TIER_PRICES[tier];
    if (!price) throw new HttpError(503, 'payments are not configured yet');
    params.set('mode', 'subscription');
    params.set('line_items[0][price]', price);
    params.set('line_items[0][quantity]', '1');
    params.set('success_url', `${siteUrl}/?upgraded=${tier}`);
    params.set('cancel_url', `${siteUrl}/?upgrade=cancelled`);
    params.set('metadata[tier]', tier);
    // Session metadata does not reach the subscription, and renewal invoices
    // carry the subscription's. Without this a renewal a year from now can
    // only be traced back to a member by customer id.
    params.set('subscription_data[metadata][user_id]', user.id);
    params.set('subscription_data[metadata][tier]', tier);
    // A referred signup's welcome discount — `duration: 'once'` on the
    // coupon itself means Stripe only ever applies it to this first
    // invoice, never a renewal, with no extra bookkeeping needed here.
    // Eligibility is just "was this account referred at all" — an
    // inactive code still gave them the link, so it still honors the
    // discount even though creditReferralCommission would skip paying
    // the referrer for it.
    const welcomeCoupon = Deno.env.get('STRIPE_COUPON_REFERRAL_WELCOME');
    if (profile?.referred_by_code_id && welcomeCoupon) {
      params.set('discounts[0][coupon]', welcomeCoupon);
    }
  } else {
    throw new HttpError(400, 'nothing to buy');
  }

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });
  const session = await res.json();
  if (!res.ok) throw new HttpError(502, session?.error?.message ?? 'stripe error');

  return json({ ok: true, url: session.url });
}));
