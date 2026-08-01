---
paths:
  - "apps/web/src/video.ts"
  - "supabase/functions/video-session/index.ts"
---

# Video rules

VIP-gated table video, via Cloudflare Realtime (Calls). Read this before
touching `video.ts` or `video-session` — it is architecturally a different
thing from `voice.ts`, not a variant of it, and treating it like the mesh
will reintroduce bugs the mesh already had to solve differently.

## Not a mesh — an SFU, and that changes everything

`voice.ts` is P2P: every seat connects to every other seat directly, which
is fine for audio (~40kbps × 3 is nothing) and wrong for video (~1.5–3Mbps
of simultaneous upload on the mobile data this product is built for —
plan §7.2's math). Cloudflare Realtime is an SFU instead: **every seat holds
exactly ONE `RTCPeerConnection`, to Cloudflare, never to another seat.**

Consequences that matter when editing this code:

- **No mesh cap, no polite/impolite glare handling, no `isPolite()`.** There
  is only ever one peer connection per client, so none of that machinery
  from `voice.ts` applies here. Do not port it over "for consistency" — it
  would be solving a problem this architecture doesn't have.
- **Signalling is a session id, not an SDP exchange between peers.** A seat
  publishing video just needs to tell the table "here is my Cloudflare
  session id and track name" (carried on lounge presence, same field
  pattern as `voice`). Pulling it is a server-mediated call, not a
  broadcast-and-negotiate dance.
- **Pulls are strictly sequential per client** (`video.ts`'s `pullQueue`).
  Two renegotiations racing the same `RTCPeerConnection` is a collision
  worth never risking, and a domino table has at most three peers to pull —
  there is no throughput reason to parallelize.

## The server-side gate is not optional, unlike the mic's

`canSpeak()` is deliberately client-side-only — voice.md says so explicitly,
because the mic costs this app nothing and the fix "when it matters" is
Realtime Authorization, not urgent today. **Video is different: every
session costs real Cloudflare usage**, so `video-session`'s VIP + actually-
seated check runs server-side on every single action (`create`, `push`,
`pull`, `renegotiate`, `stop`) — never trust the client's tier claim for
something that has a real bill attached.

`seats.video_session_id` (migration 0025) is the authority the `pull` action
checks against — NOT lounge presence, which is entirely client-broadcast and
therefore never a security boundary. A patched client could announce any
`videoSessionId` it likes over presence; the Edge Function only ever acts on
what's actually written in `seats`, which only the Edge Function itself
(service role) can write.

## Cloudflare API shape, verified live against the real API (2026-08-01)

Base URL `https://rtc.live.cloudflare.com/v1/apps/{appId}`, `Authorization:
Bearer {appSecret}`. Confirmed against Cloudflare's own OpenAPI schema, not
assumed from memory — the schema is thin on prose, so re-check it before
changing any request shape rather than guessing from an old example:

1. `POST /sessions/new` — **callable with no body at all** to create an
   empty session before any track exists. Returns `sessionId`.
2. `POST /sessions/{id}/tracks/new`, pushing a local track — body is
   `{ sessionDescription: {sdp, type:'offer'}, tracks: [{location:'local',
   mid, trackName, kind}] }`. Response's `sessionDescription` is the answer.
3. `POST /sessions/{id}/tracks/new`, pulling a remote track — body is
   `{ tracks: [{location:'remote', sessionId: theirSessionId, trackName}] }`.
   Response may carry `requiresImmediateRenegotiation: true` plus a new
   offer for YOUR session (adding their track changed your own SDP) — if
   so, answer it and call `renegotiate`, don't skip this step.
4. `PUT /sessions/{id}/renegotiate` — body `{ sessionDescription:
   {sdp, type:'answer'} }`.

## What has and hasn't been proven live

Verified against the real Cloudflare API and a real seated VIP test account
(2026-08-01): `create` returns a genuine Cloudflare `sessionId` and writes
it to `seats.video_session_id`; the VIP gate rejects a guest with 403; the
seated gate rejects an unseated table id with 403; the pull gate rejects a
fabricated `remoteSessionId` not seated at the caller's table with 403.

**Not yet proven: a real two-browser video call end to end** (camera →
push → pull → render on the other side). That needs two real seated VIP
clients with real cameras, same as voice.md's "two tabs sharing
`localStorage` is not two players" warning — a single browser cannot
prove this by itself. Prove it with two real accounts before trusting the
`push`/`pull`/`renegotiate` SDP plumbing beyond what a single-client test
of `create` already covers.

## Failure modes to handle the same way voice.md does

- **Camera refused or unavailable:** `joinVideo` returns `null`. Video
  stays off; nothing else about the table breaks. Same rule as the mic.
- **iOS backgrounding:** untested here specifically, but assume the same
  Safari WebSocket-death behavior voice.md documents applies to the
  signalling side (presence). The `RTCPeerConnection` to Cloudflare itself
  may also need an ICE restart on foreground return — watch for this on a
  real device before assuming it "just works" because voice does.
- **Leaving must stop every track**, same as voice — `leave()` stops the
  camera's tracks AND every receiver's track, not just the local one. A
  camera light left on after leaving is the video equivalent of voice.md's
  "recording light left on" trust-breaker.
- **Table-scoped, not lounge-scoped.** Unlike voice (which rides the whole
  lounge and stays connected as you move between the lobby and a table),
  video only exists while `loungeState.onlineGame` is set, and tears down
  the moment you leave the table (`loungeview.ts`'s leave-table callback).
  Do not make video lounge-wide without re-deriving the cost math in plan
  §7.2 — that pricing was computed for a 4-seat table, not a room of
  spectators.
- **Camera dies mid-session** (unplugged, another app takes it, permission
  revoked while backgrounded): WebRTC does not surface this on its own — a
  sender just keeps "sending" a track producing no frames, silently.
  `track.onended` catches it and flips to a camera-off state rather than
  leaving a frozen tile up.
- **A stream with zero video tracks** (a broken driver handing back an
  empty `MediaStream` despite a resolved `getUserMedia({video:true})`) is
  treated as a full camera failure before anything touches the
  `RTCPeerConnection`, not assumed away.
- **The most reliable disconnect-cleanup path is `leave-seat`, not
  `video.leave()`.** A crashed tab or a killed app never calls the video
  panel's "Leave video" button, so `seats.video_session_id` would otherwise
  sit there stale. `leave-seat` clears it unconditionally as part of
  vacating the seat — that function is reached by every path off a seat
  this codebase already has (explicit leave, and it is what a future
  disconnect-detection mechanism would call too), so it is where cleanup
  for an ungraceful exit actually lands, not a bespoke video-only handler.

## Known accepted risks — not engineered around, on purpose

- **A revoked or expired VIP tier does not cut an in-progress stream.**
  The gate is re-checked on every `video-session` action, so a lapsed VIP
  cannot start or extend anything — but Cloudflare itself never re-checks
  our DB mid-session, so a stream that was already flowing when tier
  expired keeps flowing until it naturally ends. A domino hand is minutes
  long and memberships do not expire mid-second; not worth a mid-stream
  kill switch for the traffic this app sees.
- **Same seat, two tabs:** calling `create` from a second tab overwrites
  `seats.video_session_id`, orphaning the first tab's still-running
  `RTCPeerConnection` (it is never told its session was superseded — it
  just stops being pullable by anyone). Matches voice.md's existing
  "two tabs is not two players" reality elsewhere in this app; not solved
  specially for video.
