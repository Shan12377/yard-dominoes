-- =============================================================================
-- 0023_coin_balance_search_path.sql
--
-- coin_balance() shipped in 0021 without a pinned search_path — the exact
-- bug class 0004 already found and fixed once in this codebase
-- (generate_join_code, effective_tier), caught this time by
-- get_advisors(security) rather than a second live incident. A function
-- with a mutable search_path can be hijacked by a session that prepends a
-- writable schema ahead of `public`, so a same-named object there shadows
-- the real one. coin_balance is intentionally still callable by anon/
-- authenticated — the underlying coin_ledger RLS policy ("you read only
-- your own ledger") already confines what it can return, since this
-- function is plain `language sql`, not `security definer`.
-- =============================================================================

create or replace function public.coin_balance(p_user_id uuid)
returns bigint language sql stable set search_path = public as $$
  select coalesce(sum(amount), 0)::bigint from public.coin_ledger where user_id = p_user_id;
$$;
