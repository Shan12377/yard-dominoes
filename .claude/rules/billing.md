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

**Status as of 2026-07-31: five of six are wired and verified live** in
`stripe-webhook/index.ts` — `checkout.session.completed`, `invoice.paid`,
`customer.subscription.deleted`, `charge.refunded`, `charge.dispute.created`.
The sixth, `customer.subscription.updated`, is a deliberate gap — see below.

| Event | What it must do | Code | Endpoint (test mode) |
|---|---|---|---|
| `checkout.session.completed` | Set tier, store `stripe_customer_id`, write a `payments` row | ✅ | ✅ |
| `invoice.paid` | **Extend `tier_expires_at` to `period_end`.** This is the one that keeps members alive | ✅ | ✅ (ticked 2026-07-31) |
| `invoice.payment_failed` | Do not revoke. Stripe retries for days — see grace period below | intentionally unhandled | — |
| `customer.subscription.updated` | Handle upgrade Yardie → VIP and downgrade; tier follows the price id | ❌ not built | — |
| `customer.subscription.deleted` | Let the paid period run out. Set `tier_expires_at` to `current_period_end`, do not revoke immediately | ✅ | ✅ |
| `charge.refunded` | Revoke immediately. A refunded member is not a member | ✅ | ✅ (ticked 2026-07-31) |
| `charge.dispute.created` | Revoke immediately and flag the account | ✅ | ✅ (ticked 2026-07-31) |

**`customer.subscription.updated` is deliberately not built** — from the
commit that fixed the other four (`555a84b`): *"pointless until a billing
portal exists."* There is currently no UI path for a member to change tier
except buying a new Checkout Session, so there is nothing yet that would fire
this event. Build it when a self-serve upgrade/downgrade flow ships, not
before — a handler with no caller is just surface area.

Every handler must be idempotent — Stripe retries on any non-2xx, and will
happily deliver the same event twice. `payments.stripe_session_id` is unique,
which covers checkout; use the Stripe event id for the rest.

## History — bugs found and fixed in the money path

Kept here, not just in `git log`, so the next person doesn't rediscover these
the hard way. All five were found and fixed together in commit `555a84b`
("close the free-VIP hole and repair the renewal path"), except the last,
found in this session's audit.

1. **CRITICAL — free VIP.** `0006` granted table-wide `UPDATE` on `profiles`
   to `authenticated` so RLS could act as the gate — but RLS is row-level
   only, it never restricts *which columns*. `effective_tier()` reads `tier`
   and `tier_expires_at`, both were user-writable, so one `PATCH` bought a
   free membership (verified live: before the fix, a real anonymous member
   could grant itself VIP until 2099; after, 403/42501). Ratings and
   `hands_played` were writable too, making the leaderboards fiction, and a
   member could overwrite *another* member's `stripe_customer_id`, letting
   their card extend a squatter's term. **Fix:** `0012` replaced the blanket
   grant with column grants — a member owns `username`, `flag`, `bio`,
   nothing else. `avatar`, `origin`, `gender` were added to that list later
   (`0014`, `0019`), `tier` never is.
2. **Checkout hardcoded a one-year term.** Regardless of which price was
   actually bought, so a *monthly* price sold twelve months for the price of
   one. **Fix:** the term now comes from the subscription's own period, read
   back from Stripe after the session completes.
3. **`invoice.paid` was never handled at all.** The exact failure this file
   warns about above, in bold: a membership expires at the end of the term
   it was bought with and never renews, however much the member keeps
   paying. **Fix:** handler added, extends `tier_expires_at` to the invoice's
   period end on every successful payment.
4. **Cancellation crashed and retried forever.** Stripe moved
   `current_period_end` off the `Subscription` object onto its *items* in API
   version `2025-03-31`. Reading the old field read `undefined`,
   `undefined * 1000` is `NaN`, and `new Date(NaN).toISOString()` throws — so
   the handler 500'd on every cancellation, Stripe retried indefinitely, the
   cancellation never applied, and a cancelled member kept access forever.
   **Fix:** `_shared/billing.ts`'s `subscriptionPeriodEnd()` checks both API
   layouts, and 14 unit tests in `billing.test.ts` (run by plain `npm test` —
   Deno is not installed in this environment, so without these the whole
   money path had no automated check at all) pin the NaN-refusal behavior
   specifically, by name, so it cannot regress silently.
5. **Refunds and disputes never revoked access.** `charge.refunded` and
   `charge.dispute.created` had no handler, so a refunded or disputed member
   kept their tier. **Fix:** `0011` added `billing_hold`; both events now
   expire `tier_expires_at` immediately. A Dispute object names only the
   charge it came from, never the customer, so the handler reads the charge
   back from Stripe first.
6. **Dashboard config drift — the code was fixed, the endpoint wasn't
   listening.** `555a84b` fixed bugs 2–5 above but explicitly flagged at the
   bottom of its own commit message: *"the endpoint is subscribed only to
   the original two events... three of these four fixes never fire"* until
   `invoice.paid`, `charge.refunded` and `charge.dispute.created` were ticked
   in the Stripe Dashboard. That remained true for two days after the code
   fix landed. **Fix (2026-07-31):** ticked in the **test-mode** endpoint via
   the API, then verified live — `stripe trigger` fired real signed test
   events at the deployed function for all five handled types, all returned
   200, and a bad-signature probe still correctly got 400. **Update
   (2026-08-25): a live-mode endpoint now exists**, created via the API in
   the "Vibe Code Ja" Stripe account (not Hunters Holistic Health, kept
   deliberately separate so its name never shows at checkout) with all five
   handled event types enabled from creation. Verified by reading the
   created products, prices, and webhook status back from Stripe's API
   directly rather than trusting the creation response. Do not assume
   ticking test mode also ticks live mode — they are entirely separate
   endpoint objects even on the same Stripe account, and the two accounts
   involved here are separate Stripe accounts entirely, not just separate
   modes of one.
7. **A security-definer function missing its `service_role` grant, and an
   RPC error nobody was checking — together, a completely invisible
   failure.** Found building the coin economy (0021/0022), same file
   pattern as bug 6: `revoke all on function ... from public, anon,
   authenticated` strips the function's *default* PUBLIC-inherited grant —
   which `service_role` normally rides on too, unless it holds an explicit
   grant of its own. `commit_move` (0003) has one; the new coin functions
   didn't, so `serviceClient()` calling them from an Edge Function failed
   every time. That alone would have been loud — except the webhook's
   `await db.rpc('grant_coins', ...)` wasn't checking the returned
   `{ error }`, supabase-js doesn't throw on it, so the call failed and
   `stripe-webhook` still answered `200 { received: true }`. A real coin
   purchase would have charged a card and granted nothing, forever, with no
   error anywhere. **Fix:** `0022` adds the explicit `service_role` grant;
   the webhook now checks and `console.error`s every RPC error rather than
   discarding it. **The lesson for the next security-definer function:**
   check `pg_proc.proacl` for an explicit `service_role` entry — a bare
   `revoke ... from public, anon, authenticated` is not enough on its own —
   and always destructure `{ error }` from a Supabase RPC call. Caught only
   because this session tested the real deployed function end-to-end
   instead of trusting the 200.

## Before flipping test keys to live

None of the five bugs above are specific to test mode — they were all in the
handler code or the RLS grant, so fixing them once covers both. What does
**not** carry over automatically from test to live:

- **The webhook endpoint itself.** Test mode and live mode each have their
  own `webhook_endpoints` list, even pointed at the same URL. Creating and
  configuring one does nothing to the other. The live endpoint needs its own
  `enabled_events` set to all five handled types, ticked the same way this
  session ticked test mode.
- **`STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` on the deployed function**
  (`supabase secrets set`) must be swapped from `sk_test_…`/`whsec_…(test)`
  to the live equivalents together, not one at a time — a mismatched pair
  fails every signature check (400, safe, but silently blocks all payments
  until noticed).
- **`STRIPE_PRICE_YARDIE` / `STRIPE_PRICE_VIP`** must point at live-mode
  price ids. A test price id used with a live key (or vice versa) is
  rejected by Stripe outright, not silently mischarged — but check anyway,
  since "outright rejected at checkout" is still a broken signup flow.
- **`stripe trigger` is test-mode only.** It cannot be used to verify the
  live endpoint. Live verification means a real low-value purchase (or
  Stripe's live-mode test clocks, if the account has them) — plan for that
  deliberately rather than assuming the test-mode pass above covers it.
- **Enable Stripe Tax** before real money moves — see "things that will bite
  you" below. Untested in either mode as of this writing.

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
