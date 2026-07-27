// POST /checkout  { tier: 'yardie' | 'vip' }
//
// Creates a Stripe Checkout session. Because we are web-first with no app
// store, this is a plain card payment — no 30% platform cut, no IAP rules,
// instant activation on webhook. Compare JamDom, where Jamaican players
// deposit at a bank branch and email the receipt.
//
// Env needed: STRIPE_SECRET_KEY, STRIPE_PRICE_YARDIE, STRIPE_PRICE_VIP,
// SITE_URL. Set with `supabase secrets set`.

import { handled, json, requireUser, serviceClient, HttpError } from '../_shared/lib.ts';

const PRICES: Record<string, string | undefined> = {
  yardie: Deno.env.get('STRIPE_PRICE_YARDIE'),
  vip: Deno.env.get('STRIPE_PRICE_VIP'),
};

Deno.serve(handled(async (req) => {
  const user = await requireUser(req);
  const { tier } = await req.json() as { tier: 'yardie' | 'vip' };
  const price = PRICES[tier];
  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!price || !key) throw new HttpError(503, 'payments are not configured yet');

  const db = serviceClient();
  const { data: profile } = await db.from('profiles')
    .select('stripe_customer_id, username').eq('id', user.id).single();

  // Trimmed defensively: a stray trailing newline from a pasted dashboard
  // secret once turned this into an embedded-newline URL that Stripe
  // rejected outright with "Not a valid URL".
  const siteUrl = (Deno.env.get('SITE_URL') ?? '').trim();

  const params = new URLSearchParams({
    mode: 'subscription',
    'line_items[0][price]': price,
    'line_items[0][quantity]': '1',
    success_url: `${siteUrl}/?upgraded=${tier}`,
    cancel_url: `${siteUrl}/?upgrade=cancelled`,
    client_reference_id: user.id,
    'metadata[user_id]': user.id,
    'metadata[tier]': tier,
  });
  if (profile?.stripe_customer_id) params.set('customer', profile.stripe_customer_id);

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
