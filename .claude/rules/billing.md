---
paths:
  - "supabase/functions/checkout/**"
  - "supabase/functions/stripe-webhook/**"
  - "supabase/migrations/**"
  - "apps/web/src/lounges.ts"
  - "apps/web/src/loungeview.ts"
---

# Billing rules

This product is **web-only and subscription-funded**. There is no app store, so
no platform takes a cut and no store review applies. Stripe is the only payment
path.

Tiers: Guest free forever, Yardie $24/yr, VIP $69/yr. The game is free; the
subscription buys the social layer.

## Access is decided in one place

`effective_tier(profile)` in SQL is the single source of truth. It returns
`guest` when `tier_expires_at` has passed, whatever `tier` says. Every RLS
policy calls it.

**Never gate a paid feature in the client.** A tier check in TypeScript is a
suggestion; a tier check in an RLS policy is a wall. If a guest can read VIP
lounge chat by patching the bundle, there is no paywall.

## Renewal — never break this

`checkout.session.completed` creates the membership. **`invoice.paid` keeps it
alive** by extending `tier_expires_at` to the invoice's `period_end` on every
successful payment.

Both are required. If expiry is only set once at checkout and never extended,
Stripe renews and charges the card at month twelve while `effective_tier` sees
an expired date and drops a paying member to guest — locked out, still paying,
with nothing on screen to explain it. This was a real bug in an earlier version;
do not reintroduce it by simplifying the webhook.

## Webhook events to handle

Only `checkout.session.completed` and `customer.subscription.deleted` are wired
today. A subscription business needs all of these:

| Event | What it must do |
|---|---|
| `checkout.session.completed` | Set tier, store `stripe_customer_id`, write a `payments` row |
| `invoice.paid` | **Extend `tier_expires_at` to `period_end`.** This is the one that keeps members alive |
| `invoice.payment_failed` | Do not revoke. Stripe retries for days — see grace period below |
| `customer.subscription.updated` | Handle upgrade Yardie → VIP and downgrade; tier follows the price id |
| `customer.subscription.deleted` | Let the paid period run out. Set `tier_expires_at` to `current_period_end`, do not revoke immediately |
| `charge.refunded` | Revoke immediately. A refunded member is not a member |
| `charge.dispute.created` | Revoke immediately and flag the account |

Every handler must be idempotent — Stripe retries on any non-2xx, and will
happily deliver the same event twice. `payments.stripe_session_id` is unique,
which covers checkout; use the Stripe event id for the rest.

## Grace period

When a renewal fails, keep access for the full Stripe retry window rather than
cutting someone off the moment a card expires. Most failed payments are expired
cards, not people leaving.

Show a banner in the app — never a modal, and never during a live hand — with a
link to the Stripe billing portal to update the card.

## Refunds and cancellation

- Cancelling ends renewal, not access. They keep the year they paid for. This is
  stated on the membership page and must stay true.
- Refunds and chargebacks revoke immediately.
- Never delete a `payments` row. It is the financial record.

## Things that will bite you

- **Test with Stripe test keys and the CLI**, not by making real payments.
  `stripe listen --forward-to localhost:54321/functions/v1/stripe-webhook`.
- **`stripe-webhook` must keep `verify_jwt = false`.** Stripe cannot send a
  Supabase JWT. Signature verification replaces it, including the replay window.
- **Never trust the client about which tier was bought.** Read it from the
  Stripe price id in the event, not from the request body.
- **Selling digital services cross-border creates tax obligations** — UK VAT,
  EU VAT, Canadian GST. Enable Stripe Tax before launch rather than discovering
  this at year end. Canada matters here: it is a large share of the incumbent's
  traffic.
- **Currency.** Prices are USD. Jamaican players will see their bank's
  conversion. Consider showing an approximate JMD figure on the membership page
  so the number is not a surprise at checkout.
- **A `payments` row is not proof of access.** Access comes from
  `effective_tier`. Do not write a second code path that reads `payments`.

## Real-money gambling — different thing entirely

Subscriptions and cash-stakes gaming are unrelated problems. Being web-only
removes the app store constraint but changes nothing about gambling law: a
licence is required wherever dominoes-for-money counts as gambling, and a public
website is reachable from everywhere unless you geo-gate it deliberately.

Payment processors also treat skill gaming as high risk and often classify it
under merchant code 7995 alongside gambling — Stripe's standard terms do not
cover it.

So: **no stakes, pots, chips, or casino imagery in this codebase.** If it ever
gets built, it is a separate application with its own legal opinion, licensing,
KYC, geo-gating, and a specialist processor. The groundwork is already here —
server authority, a score ledger, and a provably fair shuffle that doubles as an
audit trail.
