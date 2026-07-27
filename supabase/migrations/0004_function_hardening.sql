-- =============================================================================
-- 0004_function_hardening.sql
--
-- Closes advisor warnings from the first live deploy of 0001-0003:
--
--   - generate_join_code and effective_tier had no pinned search_path, which
--     leaves them open to search_path hijacking.
--   - handle_new_user (trigger-only) and record_move_speed were reachable by
--     anon/authenticated via PostgREST's automatic RPC exposure, even though
--     only the service-role Edge Functions are meant to call them. Without
--     this, any signed-in client could call record_move_speed with someone
--     else's user id and forge their speed stats.
--
-- Revoking EXECUTE from anon/authenticated does not break handle_new_user's
-- trigger firing — trigger invocation is not subject to the caller's EXECUTE
-- grant, only direct SQL/RPC calls are.
-- =============================================================================

create or replace function public.generate_join_code() returns text
language plpgsql set search_path = public as $$
declare
  -- no O/0/I/1 — these get read aloud across a room
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text := '';
  i int;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(alphabet, floor(random() * length(alphabet) + 1)::int, 1);
    end loop;
    exit when not exists (select 1 from public.tables t where t.join_code = code);
  end loop;
  return code;
end;
$$;

create or replace function public.effective_tier(p public.profiles)
returns public.member_tier language sql stable set search_path = public as $$
  select case
    when p.tier = 'guest' then 'guest'::public.member_tier
    when p.tier_expires_at is null or p.tier_expires_at > now() then p.tier
    else 'guest'::public.member_tier
  end
$$;

revoke execute on function public.generate_join_code() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.record_move_speed(uuid, int) from public, anon, authenticated;
