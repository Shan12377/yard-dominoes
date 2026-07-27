// Stripe webhook. The ONLY writer to profiles.tier and payments.
//
// Env: STRIPE_WEBHOOK_SECRET. Configure the endpoint in the Stripe dashboard
// for checkout.session.completed and customer.subscription.deleted, and set
// verify_jwt = false for this function (Stripe cannot send a Supabase JWT).

import { json, serviceClient } from '../_shared/lib.ts';

const enc = new TextEncoder();

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
    if (userId && (tier === 'yardie' || tier === 'vip')) {
      const expires = new Date();
      expires.setFullYear(expires.getFullYear() + 1);
      await db.from('profiles').update({
        tier,
        tier_expires_at: expires.toISOString(),
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

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object;
    // Let the year they paid for run out; just do not renew.
    await db.from('profiles')
      .update({ tier_expires_at: new Date(sub.current_period_end * 1000).toISOString() })
      .eq('stripe_customer_id', sub.customer);
  }

  return json({ received: true });
});
