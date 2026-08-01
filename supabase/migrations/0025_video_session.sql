-- =============================================================================
-- 0025_video_session.sql
--
-- VIP-gated video presence (plan §7.2). Cloudflare Realtime (Calls) is an
-- SFU, not the P2P mesh voice uses — every seat holds ONE connection to
-- Cloudflare, never to each other, so signalling a Cloudflare session id is
-- enough for a peer to pull that seat's track.
--
-- `seats.video_session_id` is the SERVER-SIDE source of truth for that
-- signalling, written only by the video-session Edge Function (service
-- role). Lounge presence (lounges.ts's PresenceEntry.videoSessionId) also
-- carries a copy for instant client-side discovery, but presence is
-- entirely client-controlled and never a security boundary — a patched
-- client could broadcast any sessionId it likes. Anything that costs real
-- Cloudflare money or hands over a video stream (the 'pull' action) checks
-- THIS column, not the broadcast, before ever calling Cloudflare's API.
-- =============================================================================

alter table public.seats
  add column video_session_id text;

comment on column public.seats.video_session_id is
  'This seat''s Cloudflare Realtime session id while publishing video, set '
  'and cleared only by the video-session Edge Function (service role). '
  'Authoritative for the pull-track security check — lounge presence '
  'carries a client-broadcast copy for UI discovery only, never trusted.';

-- Seats already has an RLS select policy readable by anyone who can see the
-- table (0001) — a new column on an existing table inherits it, no new
-- policy needed. No client write path exists or should exist: this column
-- is absent from every `grant update (...) on seats` a client ever gets.
