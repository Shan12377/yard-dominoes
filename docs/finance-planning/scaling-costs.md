# Scaling costs — finance planning

Estimates only, not measured data. The single biggest unknown throughout is
Realtime message volume (moves, board state, presence heartbeats, chat) —
assumed at ~31,000 messages/month per regularly-active player. If that's off
by 2x, most dollar figures below move by roughly the same factor. Treat the
*shape* of these numbers (which stage costs what, when to check something)
as more trustworthy than the exact dollars.

Last updated: 2026-08-07.

## What Supabase Pro buys over Free

No more 7-day auto-pause on inactivity, daily backups + optional PITR,
7-day log retention (vs 1 day), and every quota jumps — 500 Realtime
connections base (2,500 msgs/sec ceiling with spend cap off, vs Free's hard
100/sec), 100K MAU, 250GB egress, 100GB storage, 8GB DB, 2M Edge Function
calls, 5M Realtime messages. Base cost: **$25/mo + ~$15/mo compute (net ~$5
after the $10 compute credit)** ≈ **~$30/mo fixed floor**, before usage.

## Free plan capacity

Free's real ceiling is **messages (2,000,000/month, hard cap, no paid
overage)**, not connections (200) — messages run out first. At the assumed
per-player rate, that's roughly **~64 active players/month** before Free's
Fair Use Policy grace period kicks in. Free is realistically a dev/test tier
only, not a soft-launch stage, once real players show up.

## Supabase Pro cost drivers (confirmed pricing)

| Item | Included on Pro | Overage rate |
|---|---|---|
| Realtime peak connections | 500 | $10 / 1,000 |
| Realtime messages | 5M | $2.50 / 1M |
| Edge Function invocations | 2M | $2 / 1M |
| Egress (uncached) | 250 GB | $0.09 / GB |
| Auth MAU | 100,000 | $0.00325 / MAU |
| Database size | 8 GB | $0.125 / GB |
| Storage size | 100 GB | $0.0213 / GB |

**Realtime messages dominate.** Connections, egress, MAU, DB size, and
storage all stay near-zero cost even at 100K MAU; messages alone account for
the large majority of the bill at every stage past the first few hundred
users. Every DB change and broadcast bills per listening client, and
presence heartbeats bill the same way in the background the whole time a tab
is open — this is the one item worth actually instrumenting early.

## The upgrade ladder

Keyed to active-user (MAU) milestones, not calendar time — the milestone is
the real trigger; the month estimates below are one illustrative growth
scenario, not a prediction.

**FREE** — 0 → ~1,500 MAU · **$0/mo** · *illustrative months 0–3*
Watch: Realtime peak connections. Upgrade when peak concurrent clears ~150
(75% of the 200 cap) — don't wait for `too_many_connections` itself.

↓

**PRO — inside all included quotas** — ~1,500 → ~200 MAU *(narrow band —
Pro's 5M message quota covers only ~160 active players before overage
starts)* · **~$30/mo flat** · *~month 3*

↓

**PRO — messages overage ramping** — ~200 → ~5,000 MAU · **~$30 →
~$430/mo** · *illustrative months 3–9*
Break-even: ~215 paying Yardie-equivalent members (~4.3% conversion) covers
this whole band.

↓

**PRO — compute bump likely needed** — ~5,000 → ~20,000 MAU · **~$430 →
~$1,650/mo** · *illustrative months 9–18*
Break-even: ~825 paying members (~4.1%). Watch DB CPU/connection graphs
separately from the Realtime bill — the default Micro compute instance is
likely to need an upgrade here, independent of message costs.

↓

**PRO, spend cap off (or Team)** — ~20,000 → ~100,000 MAU · **~$1,650 →
~$8,400/mo** · *illustrative year 2+*
Break-even: ~4,200 paying members (~4.2%) — conversion ratio holds roughly
flat across every stage, since messages (dominant cost) and members
(dominant revenue) both scale linearly with active users.

↓

**ENTERPRISE conversation** — 100,000+ MAU · custom pricing
Trigger: approaching the 10,000-concurrent-connection / 2,500-msg/sec
ceiling that even Pro-with-spend-cap-off can't exceed. By this point ~4%
conversion math implies $8K+/mo in membership revenue already, so this is a
negotiation from strength, not urgency.

## The other three costs

Confirmed from Stripe's and Cloudflare's own pricing pages (2026-08-07):

- **Stripe Checkout + Billing:** 2.9% + $0.30/charge, plus Stripe Billing's
  0.7%-of-volume fee for the recurring-subscription part → **~3.6% + $0.30
  per charge**, ~4.5–4.6% of revenue blended across Yardie/VIP. Billed once
  per member per year (annual plans). **No upgrade tier exists** — flat-rate
  forever unless processing >$1M/year, which even the 100K-MAU stage is
  nowhere near.
- **Cloudflare Realtime (voice TURN relay + VIP video SFU, shared pool):**
  $0.05/GB egress, **1,000GB/month free**, shared between voice and video.
  Video is ~500x more expensive per hour than voice — a full 4-way VIP
  video table burns ~4.32GB/hour vs voice's ~9MB/user-hour. Voice alone
  barely dents the free tier even at 100K MAU; VIP video adoption is the
  one to actually watch/instrument, since it's the highest-egress-per-hour
  feature in the app by a wide margin.
- **Vercel Pro:** $20/mo/seat, 1TB fast data transfer included, $0.15/GB
  over. Upgrade trigger is not a user count — it's the day Stripe goes
  live (Vercel's free Hobby tier is non-commercial-use only). Bandwidth
  overage is a non-issue for years: the build is ~1.1MB, cached by the
  service worker after first visit, so cost scales with *new* visitors, not
  total users — would need ~900,000 new visitors in a single month to blow
  past the included 1TB.

## Combined bill, revenue, and net by stage

Assumes ~4.2% of MAU convert to paying membership, split 85% Yardie ($24/yr)
/ 15% VIP ($69/yr). "Monthly-equiv revenue" is the annual fee ÷ 12, shown
only to compare against the monthly cost line — real cash lands once a year
per member, on their signup anniversary, not smoothed monthly.

| MAU | Paying (Yardie / VIP) | Annual revenue | Monthly infra cost (Supabase + Stripe + Cloudflare + Vercel) | **Monthly net** |
|---|---|---|---|---|
| 200 | 7 / 1 | ~$237/yr (~$20/mo equiv) | ~$51/mo | **–$31/mo** (loss) |
| 5,000 | 183 / 32 | ~$6,600/yr (~$550/mo equiv) | ~$475/mo | **+$75/mo** |
| 20,000 | 701 / 124 | ~$25,380/yr (~$2,115/mo equiv) | ~$1,767/mo | **+$348/mo** |
| 100,000 | 3,570 / 630 | ~$129,150/yr (~$10,763/mo equiv) | ~$8,929/mo | **+$1,834/mo** |

Notable: the 200-MAU stage runs at a loss — the ~$51/mo fixed floor
(Supabase $30 + Vercel $20) exceeds revenue until roughly 15–20 paying
members exist. It turns solidly positive well before the 5,000-MAU stage,
and margin widens with scale since messages/revenue both scale linearly
with active users, keeping the ~4% break-even conversion rate roughly flat.
