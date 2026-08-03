---
paths:
  - "apps/web/src/voice.ts"
  - "apps/web/src/loungeview.ts"
---

# Voice rules

Voice is the feature JamDom's players complain about most, and it is the
feature ours will be judged on hardest. Treat every change here as a change to
something that is allowed to be silent, but never allowed to break the room.

## The one invariant

**Voice is additive. It must never take the lounge, the chat, or a live hand
down with it.** Every entry point is wrapped so a voice failure degrades to
"no audio" and says so, rather than throwing into `render()`. If you add a new
path into `voice.ts`, it needs the same treatment. A player who cannot hear
anyone must still be able to play dominoes and type in chat.

Corollary: never `await` voice work inside the render path, and never let a
rejected promise from voice escape unhandled.

## Failure modes that have actually bitten us

Both of these were live bugs, found by running two real clients — not by
reading the code. Neither one throws an error.

- **Dialling people who are not on the mic.** Lounge presence tells you who is
  in the room, not who joined voice. Dial only peers whose presence carries
  `voice: true`. Getting this wrong opens a dead connection to every reader in
  the room and leaves offers hanging in `have-local-offer` forever.
- **A control that renders before the thing it controls exists.** The lounge
  channel is joined asynchronously, so the voice bar can paint before
  `loungeState.room` is set. Tapping it then does nothing, silently. Any
  control that depends on the room must be disabled until the room is there,
  and must say why.
- **No TURN relay configured in production at all** (found 2026-08-02, a real
  user report: "camera works, I hear nothing on either device"). `iceServers()`
  only ever returned two public STUN servers — STUN alone fails to connect two
  real devices whenever either is behind a NAT type that needs a relay, which
  is common on home routers and cellular. Video worked anyway because it talks
  to one predictable Cloudflare server, not another arbitrary residential
  network, so this went unnoticed until voice specifically was tested between
  two real devices. See "TURN" below for the fix.
- **`audio.play()`'s rejection silently swallowed** (found 2026-08-03, same
  shape of report: mic permission granted, no sound, no error). Desktop
  browsers can block autoplay independently of microphone permission — those
  are two separate gates, and a blocked `.play()` on the incoming `<audio>`
  element is indistinguishable from a real connection failure if the
  rejection isn't surfaced. Fixed by routing it through `handlers.onError`
  like every other failure mode here.

## Before you touch this file, know these will happen

Each of these is normal, not exceptional. Handle it, don't guard against it.

- **The microphone is refused.** Dropping to listen-only is the correct
  response — never drop the player out of voice entirely, and never retry the
  permission prompt in a loop.
- **Two peers offer at the same moment.** That is glare, and it is resolved by
  the polite/impolite rule in `isPolite()`, not by adding delays or retries.
  Both sides must independently agree who yields, with no round trip.
- **ICE fails mid-call.** Restart it. Networks change when a phone moves from
  wifi to cellular; this is expected, not an error to surface.
- **iOS backgrounds the page.** Safari kills WebSockets and suspends audio
  when a PWA goes to the background, so the signalling channel dies without a
  close event. Voice must recover on return rather than sitting there mute.
  Test this by actually backgrounding the app, not by trusting the code.
- **Autoplay is blocked.** `audio.play()` rejects unless the player has
  interacted with the page. Joining voice is itself a tap, which is why it is
  a button and must stay one — never auto-join.
- **Presence flaps.** A reconnect can fire several syncs in a row. Roster
  handling must be idempotent: the same roster twice does nothing. That is
  what `diffRoster()` is for; do not bypass it.

## Rules that protect the player

- **Mute must actually stop transmitting** (`track.enabled = false`), never
  just change the button. A mute that only mutes the UI is the worst bug this
  feature can have — someone gets overheard believing they are muted.
- **Leaving must stop every track.** If tracks are left running the browser
  keeps the recording indicator lit after the player left voice, which reads
  as spyware and is the single fastest way to lose trust in the app.
- **Keep `echoCancellation`, `noiseSuppression` and `autoGainControl` on.**
  Four people on phone speakers in a real yard is exactly the environment they
  exist for.
- **Never play your own stream back.** That is not a monitor, that is feedback.

## TURN

`iceServers()` (this file) returns STUN unconditionally, plus TURN when a
`TurnCall` is injected — `video.ts` uses the exact same function, injected the
same way, since both P2P mesh and Cloudflare SFU legs need real NAT
traversal.

Real TURN credentials must be generated **server-side**, per-session,
short-lived — there is no static client-side credential Cloudflare's TURN
service supports, so this cannot be a `VITE_*` env var no matter how
tempting that looks. `supabase/functions/turn-credentials/index.ts` calls
`POST https://rtc.live.cloudflare.com/v1/turn/keys/$KEY_ID/credentials/generate-ice-servers`
server-side using two Supabase secrets — `CLOUDFLARE_TURN_KEY_ID` and
`CLOUDFLARE_TURN_KEY_API_TOKEN`, generated once in the Cloudflare dashboard's
Calls section — and hands back a 6-hour-TTL credential. No tier gate: even a
listen-only guest's `RTCPeerConnection` needs real connectivity to *receive*
audio from a speaker behind strict NAT.

TURN is additive, same posture as everything else in this file — a fetch
failure inside `iceServers()` is swallowed, never blocks a connection
attempt. STUN-only still works for the majority of real-world networks; TURN
only matters for the minority that need a relay.

## The mesh has a ceiling

A mesh is every peer connected to every other, so connections grow with the
square of the room. `MAX_VOICE_PEERS` exists because past a handful of live
microphones it is the phone doing the encoding, not the network, that gives
out. A lounge may hold far more people than that — they simply do not all get
the mic at once. If you raise the cap, measure on a mid-range Android before
you do, not on a laptop.

When peers are capped, every client must independently choose the *same*
subset, or each connects to a different few and the room fragments. That is
why the selection is sorted rather than insertion-ordered.

## The gate is not airtight, and that is a known choice

`canSpeak()` runs in the client, so a patched client can still transmit. The
fix, when freeloading actually shows up, is Realtime Authorization — an RLS
policy on `realtime.messages` covering the `voice-signal` event — so the
server refuses to carry signalling for a guest. It needs a migration. Do not
respond to this by adding more client-side checks; they cost real complexity
and stop nobody who is bothered enough to bypass the first one.

## Testing it

The pure logic — politeness, roster diffing, the cap, the tier gate — is
covered in `voice.test.ts` and must stay covered. Everything else needs two
real clients.

**Two tabs in one browser is not two players.** They share `localStorage`, so
they share the anonymous Supabase session and collapse to a single presence
entry — the mesh correctly refuses to dial you to yourself and you learn
nothing. Use two profiles, two browsers, or a private window, and confirm
`connectionState` reaches `connected` on both sides before believing it works.
