-- A refunded or disputed membership has to be distinguishable from one that
-- simply lapsed, or the next payment quietly re-grants an account that was
-- taken away on purpose. `.claude/rules/billing.md`: "Refunds and chargebacks
-- revoke immediately", and a dispute additionally flags the account.
--
-- Note the existing `profiles.flag` is a territory code ('jm', 'tt') and has
-- nothing to do with this.

alter table public.profiles
  add column billing_hold text
    check (billing_hold in ('refunded', 'disputed'));

comment on column public.profiles.billing_hold is
  'Set by stripe-webhook on refund or chargeback. Non-null means do not grant '
  'membership on a later payment without a human looking first. Cleared by hand.';

-- Written only by the webhook under the service role, which bypasses RLS. No
-- client policy is added: the existing profiles policies do not grant update
-- on this column to anyone, and a member must never clear their own hold.
