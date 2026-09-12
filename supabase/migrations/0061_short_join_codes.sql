-- Short, speakable join codes.
--
-- Codes were six characters from a 32-letter alphabet (ZMLWTN). Reported by
-- the owner: that is a frustrating thing to ask an older player to read off a
-- screen and type in, and this game's players are mostly older. A table code
-- is read aloud across a room as often as it is copied.
--
-- So: the SHORTEST free number, 1-9 first, then 10-99, then 100-999, 1000-9999.
-- Measured on production the day this shipped, the table held 130 finished
-- tables against 10 live ones, so single digits cover ordinary load on their
-- own and double digits are the real ceiling.
--
-- That only works if codes are RECYCLED. The old unique constraint was global
-- and permanent, so the ninth table ever created would have exhausted single
-- digits forever. Uniqueness now applies only to tables that have not
-- finished, and 0060's hourly sweep already finishes abandoned ones, so the
-- short codes free themselves without anybody tidying up.
--
-- The deliberate trade, stated because it is a real one: with a six-character
-- random code a typo almost always fails harmlessly, whereas mistyping 3 for 2
-- now lands you at a different LIVE table. You can see you are in the wrong
-- room and leave. Being able to say the code out loud is worth more to this
-- audience than a typo always failing.

alter table public.tables drop constraint if exists tables_join_code_key;

-- Partial, so a finished table keeps its code in history without holding it
-- back from the pool.
create unique index if not exists tables_join_code_live
  on public.tables (join_code)
  where status <> 'finished';

create or replace function public.generate_join_code() returns text
language plpgsql set search_path = public as $$
declare
  width int;
  lo bigint;
  hi bigint;
  candidate text;
begin
  -- Shortest width that still has a free code, then a RANDOM free one inside
  -- it rather than always the lowest. Always taking the lowest would hand the
  -- same "1" to table after table, so a stale code would reliably land
  -- somebody in a stranger's game rather than merely occasionally.
  for width in 1..4 loop
    lo := case when width = 1 then 1 else power(10, width - 1)::bigint end;
    hi := power(10, width)::bigint - 1;
    select gs::text into candidate
      from generate_series(lo, hi) gs
     where not exists (
       select 1 from public.tables t
        where t.join_code = gs::text
          and t.status <> 'finished')
     order by random()
     limit 1;
    if candidate is not null then
      return candidate;
    end if;
  end loop;

  -- Over ten thousand live tables at once. Not a real state, but never return
  -- null and never loop forever: fall back to something certainly free.
  loop
    candidate := 'T' || substr(md5(random()::text), 1, 5);
    exit when not exists (
      select 1 from public.tables t
       where t.join_code = candidate
         and t.status <> 'finished');
  end loop;
  return candidate;
end;
$$;

revoke execute on function public.generate_join_code() from public, anon, authenticated;
grant execute on function public.generate_join_code() to service_role;
