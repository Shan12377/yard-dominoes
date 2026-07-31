-- =============================================================================
-- 0022_coin_economy_grants.sql
--
-- 0021 revoked EXECUTE on grant_coins/spend_coins/gift_coins from public,
-- anon and authenticated, matching commit_move's pattern (0003) — but never
-- added the one grant commit_move actually has: an explicit
-- `service_role`. A function's default EXECUTE grant goes to the PUBLIC
-- pseudo-role, which every role — including service_role — inherits from
-- unless it holds an explicit grant of its own. Revoking from PUBLIC
-- therefore revoked service_role's only path in, and every coin grant
-- silently failed: the Edge Functions call these through supabase-js's
-- `.rpc()`, which returns failures as `{ error }` rather than throwing, and
-- the webhook handler was not checking that field — so a real Stripe
-- purchase would have charged a card and granted zero coins with no error
-- visible anywhere. Caught in this session's own live verification, not by
-- a user report, because the same discipline used throughout this app
-- (verify against the real deployed function, not just against `npm test`)
-- was applied here before calling this done.
-- =============================================================================

grant execute on function public.grant_coins(uuid, int, text, text) to service_role;
grant execute on function public.spend_coins(uuid, int, text, text) to service_role;
grant execute on function public.gift_coins(uuid, uuid, int) to service_role;
