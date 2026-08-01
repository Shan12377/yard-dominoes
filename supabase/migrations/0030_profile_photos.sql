-- =============================================================================
-- 0030_profile_photos.sql
--
-- "Rank badge and profile photo" has been sold in TIER_PITCH.yardie since
-- lounges.ts existed, but nothing ever let a player upload one — the same
-- dead-scaffolding shape as the old rating columns and the reports table
-- before this session's audit. design.md already anticipated this: "Never
-- use a real person's likeness. Human players upload their own photo."
--
-- No new profiles column for "has a photo" — the client just requests the
-- deterministic public URL and falls back to the preset avatar art on
-- `onerror`. A boolean here would only ever be a cache of what the storage
-- bucket already knows, and caches like that drift.
--
-- Path convention: `<user id>/photo.webp`, one object per user, upsert on
-- every re-upload. `(storage.foldername(name))[1]` reading the user id back
-- out of that path is what every policy below is keyed on.
-- =============================================================================

insert into storage.buckets (id, name, public)
values ('profile-photos', 'profile-photos', true)
on conflict (id) do nothing;

-- Public read: profile photos are meant to be seen by everyone at the table,
-- not just the uploader. The bucket's own `public` flag only affects whether
-- `getPublicUrl()` needs a signature — RLS on storage.objects still gates
-- every read regardless, so this policy is the thing actually doing it.
create policy "profile photos are public to view"
  on storage.objects for select
  using (bucket_id = 'profile-photos');

-- Upload, replace and remove all require the same two things: it is your own
-- folder, and you are Yardie or above — the perk this was sold as. Never
-- gated in the client alone (billing.md); this is the real wall.
create policy "yardie+ can upload their own profile photo"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and public.effective_tier(p) in ('yardie', 'vip')
    )
  );

create policy "yardie+ can replace their own profile photo"
  on storage.objects for update to authenticated
  using (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and public.effective_tier(p) in ('yardie', 'vip')
    )
  );

-- Delete is deliberately NOT gated on current tier: a lapsed member who paid
-- for a photo while Yardie should still be able to take it down after their
-- membership expires, not be stuck with a photo they can no longer remove.
create policy "you can delete your own profile photo"
  on storage.objects for delete to authenticated
  using (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);
