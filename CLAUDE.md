# YaadDominoes — Jamaican Dominoes

## Current owner-approved plan — 2026-09-12

Read `docs/table-experience-plan.md` before table/UX work and update its tracker,
evidence, decisions and exact resume point after each session. The owner has
authorized scoped local implementation and correction of conflicting project
preferences; do not ask again merely because an older instruction opposes the
approved corner photographs, desktop right sidebar or illuminated-hand cues.
That plan governs these changes. Preserve newer French routing, readable-phone
behavior, rules fixes, server authority and privacy. Approval to improve UX is
not a claim that a prototype is implemented or that production is verified.

Web-first PWA. Two halves: online play, and an academy that takes a total
beginner to tournament level. Not in any app store, by choice.

See @README.md for setup and architecture.

## Product identity

- **YaadDominoes** is the confirmed user-facing product and brand name. It is
  a different product from Yaadmoji. Use YaadDominoes on all new visible
  product surfaces and in new current-facing documentation.
- **“Beat di table.”** is the confirmed public slogan. Use it for the primary
  invitation to play; “Slam dem down” is retired and must not return.
- The canonical visual brand specification is `docs/branding.md`. Read it
  before changing colors, typography, imagery, logos, table art, or marketing
  presentation.
- Do not mechanically rename stable internal identifiers: the GitHub repository
  remains `yard-dominoes`, the engine package remains `@yard/engine`, and
  existing `yard:*` localStorage keys remain intact to avoid breaking users.
- Vocabulary that describes the culture or product model remains valid rather
  than being rebranded: Yard duppy level, Yardie membership, Yard Gate lounge,
  yard rules, and Sunday Yard.
- The legal entity is separate from the product brand. Owner, 2026-09-15: no
  placeholder text on the site; `ENTITY` in legal.ts is blank (pages name
  YaadDominoes) and the contact email is info@drshallandahunter.com until the
  LLC exists. Fill in the registered name and address only when the owner
  confirms them.

## Commands

```bash
npm test              # 420 tests — run after ANY engine change
npm run bench         # set-length distributions
npm run dev           # client on :5173
npm run typecheck     # client types — run before declaring done
npm run build         # production build
npm run preview --workspace @yard/web -- --host 127.0.0.1 --port 4173
                      # production preview used for Lighthouse, never audit dev
npm run sync:engine   # vendor engine into supabase/functions/_shared/engine
npm run fn:serve      # local Edge Functions (runs sync:engine first)
```

Node 22+ runs TypeScript directly. The engine has no build step.

## Layout

- `packages/engine/` — pure rules, zero dependencies, the source of truth
- `supabase/migrations/` — schema and RLS
- `supabase/functions/` — Edge Functions, the game authority
- `apps/web/` — Vite client, PWA

Detailed rules live in `.claude/rules/` and load when you touch matching files.

## Live-table visual correctness gate

- **Practice and Lounge are one visual contract with two implementations.**
  Any request to change the live table, board, dominoes, hands, racks, player
  stations, spacing, or responsive behaviour in either Practice or Lounge
  automatically requires consulting and correcting both. Inspect both DOM
  builders (`main.ts` and `onlinetableview.ts`) and their shared and
  surface-specific CSS. Never infer that changing the shared renderer fixed
  both. Browser-test a fresh deal and a played-out hand in both surfaces before
  declaring the request complete, even when the user named only one surface.
  Apply this as a required parity matrix: Practice/Lounge × Partner/Cut Throat/
  French/Across where supported × narrow desktop/wide desktop/mobile. A change
  is incomplete until every applicable cell is inspected; any intentional
  exception must be named and justified in `docs/table-experience-plan.md`.
- The board renderer reads only the engine's `Board`/`CrossBoard`. Never hand-place
  a decorative live chain or carry a prototype tile array into production.
- One flat domino primitive serves hand, board and rack: same 1:2 ratio, thin
  light-grey edge, firm centre divider, black pips and immutable 3×3 pip map.
  Rotation rotates the completed face grid; it never changes a pip layout.
  Face-down opponent and duppy racks are plain ivory backs—never blue cards,
  patterned backs, or a separate visual language. Every back remains fully
  visible with table showing between bones: never fan, stack, or use negative
  margins to overlap a hand. A 14-bone opponent hand uses two rows of seven.
- Size a player's rack layout from the engine's original 7-, 9-, or 14-bone
  deal, never from the shrinking number still held. A bone may not recolour,
  change pips, or gain an animation when it moves from hand to board. The
  renderer chooses one physical short-side measurement before the deal for the
  visible hand and played board; those two always use it together for the full
  hand. Gameplay and board density may never recalculate it. Concealed opponent
  racks may use one smaller, stable perimeter-counter size so they do not take
  the playing surface, but every back remains separate and all opponents use
  the same rack size. Never give the played chain an independent smaller tier.
  Preserve the same domino design and 1:2 ratio at every fitted size. This
  includes Across: hands may sit outside the felt in that mode, but every
  controlled face-up hand must still inherit the board's fitted short side.
  After the pre-deal measurement, the computed short sides of a played face-up bone
  and every controlled hand bone must differ by no more than 1 CSS pixel.
  **Owner-approved exception, 2026-09-14: mobile Practice (≤700px, not French,
  not Across) uses a stationary whole-felt board with big bones, like the
  owner's JamDom WhatsApp video.** Played bones never move, the board never
  scrolls or pans, and hand and board bones are one size. The stage is the
  whole felt above the tray; the top and side players are `blocked` rectangles
  the route flows round, not guards that shrink the board. The route is
  `phoneRouteRects()`/`layoutPhoneRoute()` in layout.ts: the centre row runs
  to the edge, then the LEFT end snakes upward in rows and the RIGHT end
  downward. **Every climb between rows is two full dominoes, in every hand**
  (owner, 2026-09-14: "goes up by 2 no matter what ... keep the size the same
  as now"). Doubles in a climb are extra, since they are half a domino tall;
  counting height instead made climbs of one and three. A climb turns early
  only where the table stops it: the partner's rack or the top or bottom edge,
  in the last row of a long hand. The bone size is still chosen as if climbs
  were one domino (`PHONE_SIZING_CLIMB`), so about one hand in twenty on a
  430×800 phone outgrows the board and is laid again one size smaller;
  forcing two dominoes at the edge too made it one hand in seven.
  Lanes are a double's width with one unit of look-ahead; bones meet edge to
  edge and keep a unit of felt from other rows (a double may touch where two
  doubles line up). **Doubles always stand across the line they arrive on.**
  A double on a turn makes the JamDom L: past the end of the line, one half
  level with the line it arrived on, the other half out into the turn, and the
  line carries on from that outer half — never docked at its waist like a T,
  never lying along the end bone (the owner's 3-3 and 5-5 complaints). With no
  room for the L it is laid where a turning bone goes.
  `phonePracticeGeometry()` picks the biggest bone for which at most
  `PHONE_ROUTE_CORPUS_TOLERANCE` (20) of the 400 hardest simulated hands in
  `phone-route-corpus.ts` overflow — about one hand in a thousand
  (regenerate with `node scripts/gen-phone-route-corpus.ts`). Such a hand is
  laid again one size smaller (main.ts, `lastPhoneRouteFit`). main.ts measures
  until the pose is down, then locks grid, blocked rects, stage inset and
  offset for the hand (`lastPhoneRouteKey`, keyed by hand and width). Measured bones: 430×932 30px, 430×800 26px,
  390×844 26px, 360×780 24px. When passing is the
  only move, Pass replaces the pace control in the tray header, because a row
  under the bones fell off the screen.
  A player's required Pass control appears immediately beside the active hand
  when pass is the only legal move. It says `No matching bone` and never waits
  for a tile tap or shares the bottom-left corner with the player's portrait.
  `Play here` and other board-end actions must remain readable over either
  ivory bones or dark felt. Use a defined high-contrast palette, a transparent
  48px yellow-ring arrow target that does not cover the bone, and keep the full
  action instruction in its accessible label. Generic ghost-button styling
  must never win that cascade. Across uses a 22-unit (44px) desktop floor for
  the played line and both controlled hands, through the shared physical token.
  French desktop uses the measured JamDom proportions as its baseline: a
  1000×800 game surface, a 450×390 routed board and 30×60 bones. **The French
  bone is capped by the board it must fit, and is never derived from viewport
  width alone.** The canvas is rigid — 30u wide by 26u tall — so a bone that
  does not fit does not overflow gracefully, it CLIPS. Sizing it from viewport
  width (an earlier "3% of table width, capped at 60px" rule) ignored height,
  which is what actually constrains the stage: measured 2026-09-11, 1368×900
  drew a 510×442 canvas into a 464×439 stage, and simulating 800 real French
  hands against that geometry cut a bone off in 786 of them, starting at the
  SEVENTH. The tell was 1368×1200 — same width, same bone, no clipping,
  because it is tall. Use `frenchCanvasUnit(box)` against the MEASURED stage,
  lock it for the hand, and route inside the corresponding board.
  **A landscape table fits the canvas to the board; a phone keeps the readable
  bone and pans.** Because the canvas is rigid it does not grow with the hand,
  so on desktop fitting it once fits it for the whole hand — 1368×900 lands on
  28px, the same bone the linear game uses, so it costs nothing there.
  **A phone is the deliberate exception and this has now been got wrong twice,
  so it is written down plainly: never shrink the French bone on a phone.**
  Fitting a late cross there works out at 20px, and 16px on a 360px screen,
  against 28px for the linear game. Dominoes is played by older people and the
  owner has ruled on it twice — the second time after a build shipped with 20px
  phone bones. A board that is fully visible but unreadable is worse than one
  that is readable and pans.
  **A phone lays French as JamDom's four-way clockwise pinwheel (owner,
  2026-09-14).** `phoneFrenchPinwheel()` in render.ts: each arm heads out
  from the chucha towards the player who opened it, runs to the table edge and
  turns clockwise, and keeps turning clockwise inside its own quarter, so no
  arm folds back and forth into stacked rows. The older `phoneCrossRoute()`
  did exactly that ("a comb", owner's complaint) and laid doubles along the
  arm. Now a double stands across the arm it arrives on, and a double on a
  turn makes the L (past the end of the line, one half level with it, the
  other half out into the turn); with no room for the L it lies where a
  turning bone goes, still across. Bones are laid in play order from the move
  log (a replay or the Coach, with no log, takes the arms in turn), and a
  bone's place depends only on bones already down. Arms keep a unit of felt
  between them. Only an arm with nowhere clockwise to go borrows free felt or
  turns the other way, and last of all it grows past the BOTTOM of the board
  so nothing already down moves (growing past the top would shift the whole
  board). The pinwheel is never swapped for another route mid-hand: that
  re-laid every bone. Phones 370px and wider (`frenchPinwheelPhone()`, which
  takes the smaller of the layout and screen width) get the whole felt, the
  player tabs and the pinwheel. A phone French board fits the stage's whole
  inner box (no linear line padding; keeping that 18px cost a 375px phone two
  columns), so 375px gets 26 columns, 390px 26 and 430px 30, and all three
  held two full hands with nothing moving and no bone under a tab. A 360px
  phone gets 24, where a real hand ran an arm out of room, so it keeps its
  full player badges and `phoneCrossRoute()` for the whole hand, guarded off
  the badges as before. **Decide this from that stable width, never a
  measured stage or bare `innerWidth`:** a first measurement can come in
  narrower than the settled one, and a page wider than the screen let
  `innerWidth` swing across the cutoff, flipping a hand between the routes.
  The French phone bone is never shrunk to make the pinwheel fit (owner: 28px,
  not lower). **The pinwheel board is top-aligned in its stage** so growing
  past the bottom never moves it, and a bone that could not be placed never
  shifts the board down. **French players on those phones are tabs at the rim**
  (`frenchPhoneTab()` in table-experience.ts, both surfaces): a 32px photo, a
  large bold bones-left badge and a plain "View" cue (owner: the numbers were
  too small and nothing said the tab opens); tapping opens a small panel with
  name, score and backs, and its open state lives in module scope so Duppy
  redraws never close it. The stage is the whole felt (`.french-phone-stage`),
  and `frenchTabBlocks()` measures each whole tab once per hand, with a unit of
  felt around it, against where the grid sits in the stage rather than a drawn
  board, so tabs are known before the first arm bone. French phone bones meet
  flush, with the same crisp faces as the phone partner board (no clipped
  reveal). Two layout movers found with it and fixed on phones: the six-second
  French penalty banner floats instead of pushing the table down 88px and
  back, and French's Pass control sits in the tray header like the linear
  game's.
  `centreCrossOnPose()` still holds the chucha in the middle of any stage that
  pans: `align-items: safe center` start-aligns anything larger than its box,
  which measured 44px of drift and hid a whole arm.
- `docs/prototypes/authentic-table.html` is the live-table composition authority:
  on desktop the local hand sits in a compact, content-width tray at the
  player's table edge; on phone it becomes the prototype's transparent,
  full-width bottom tray without card border, fill or shadow. Never divide the
  felt with a fixed-height hand panel. The
  played board and hand remain visually separate. Practice and Lounge must use
  the same table composition and fitting rules: perimeter stations hug or
  straddle the rim, leaving a broad, clear central square for play. A crowded
  line must fit completely inside its protected board zone with no scrolling.
  That zone is an invisible measured guard: its four edges sit beyond
  the actual top/side stations and above the actual local hand/action trays,
  with a safety gap. Played dominoes may never leave it. **It is never
  squared — not for a line, not for a cross, at any size.** Squaring was meant
  to give a four-arm cross equal clearance every way, but the French board is a
  FIXED 450×390 canvas: a rectangle, 1.15:1, whose own shape already guarantees
  that. Squaring the stage around it only discards whichever dimension is not
  binding. On a phone that cost height (360×780 lost 135px, holding the cross
  to six bones on a felt with room for nine). On desktop it cost width, badly:
  measured in a real 1920×1080 Lounge, a 1728px felt was inset **609px on each
  side** to make a square, leaving the board 490px of 1708 and forcing a 30px
  bone on a table with room for 46px — and the concealed racks, capped at 32px,
  then rendered LARGER than the played dominoes. Removing it: stage 490×636 →
  1516×636, bone 30px → 46px.
  An ordinary desktop line must choose one complete-hand route from the
  measured safe rectangle before the pose is dealt, then retain that route and
  physical bone size for the whole hand. The double-six route is bounded at
  32 half-tile columns by 22 rows; it may turn before consuming every spare
  pixel so a later bone never forces a resize or scrollbar. A Lounge phone may turn
  within a 20-half-tile lane and deliberately pan rather than shrink; mobile
  Practice never pans (see the JamDom phone-app exception above). A live French arm chooses its
  first lane from the measured guard: run straight while the protected square
  allows it, turn once near that boundary, then continue without curling back
  into the original line.
  Empty space comes from keeping stations on the perimeter—not miniaturising
  the played dominoes in the middle.
  Treat separation as measurable: adjacent hand bones have a positive gap,
  played bones retain at least a 1px table reveal, and the board and hand
  bounding boxes never touch or overlap (keep at least the 12px phone guard).
- `docs/prototypes/french-reference/` is the French board geometry authority.
  Its 450×390 logical coordinate route is based on the public JamDom desktop
  client's measured board and 30×60 bone constants. A French cross follows
  those fixed lanes and boundary turns; it never invents a density-based scale,
  shrinks during play, overlaps another arm, or reaches a protected player lane.
  The route is a fixed list of slots per arm and `renderCross` throws if an arm
  outgrows it. Measured over 800 simulated French hands, the longest arm ever
  seen is 14 tiles against a 16-slot minimum, so the margin is real but only
  two slots wide — extend the routes before changing the deal size or seat
  count, not after a player hits the crash.
- **A French arm runs towards the player who opened it.** On a real table you
  push your bone out in front of you, so the four opening bones lay out towards
  their own players — the owner's rule, 2026-09-12, against a live board. The
  arm belongs to whoever OPENED it, never to whoever later extends it.
  Direction cannot live in the engine: it is relative to the viewer (my right
  is the opposite seat's left) and one board is sent to all four seats. So
  `CrossArm.seat` records the fact and `armDirectionFor()` turns it into a
  compass direction per viewer. Play is anti-clockwise, so seat+1 is on my
  physical right. One seat can legally open two arms (the others pass and the
  turn comes round), so `crossArmDirections()` gives the first claim that
  seat's own lane and sends the second to the nearest free one — without that
  they draw on top of each other. `seat` is optional: a hand already in flight
  when this shipped keeps its stored fill-order direction.
- Owner update 2026-09-12: substantial corner photographs identify each player,
  with names, statistics and edge racks clearly associated by seat. A common
  logical station does not require one enclosing card. Measure the complete
  photo/rack/hand footprint so no station can cover the chain. Implement and
  verify against `docs/table-experience-plan.md` before marking this delivered.
- Owner update 2026-09-12: desktop Practice and Lounge reserve a permanent right
  sidebar for score, log, chat, spectators/queue and compact controls. Remove
  redundant player cards. Fit the active desktop table and sidebar together;
  retain a deliberate phone adaptation and the readable French pan exception.
  This supersedes the former below-table-only desktop social dock requirement.
- Coordinate turn state through an illuminated hand with an embedded Your turn
  label; preserve the timer and remove the redundant floating play panel.
  Selection, legal destination preview, pending/confirmed move, reconnect and
  exit states follow the living plan. An explicit Leave table confirmation is
  allowed during a live hand; unsolicited live-hand modals remain prohibited.
- Validate table geometry against a completed hand, not only a fresh deal. At
  every required viewport every played domino must be visible simultaneously,
  with no board scrollbar and nothing beneath the local hand tray.
- Keep a thin table reveal between every played bone. It is a visual separation
  only: never alter Board/CrossBoard geometry, joins, pip placement, or tile
  dimensions to create that gap.
- Before rendering, reject duplicate tiles, broken line joins, broken French-arm
  joins, wrong arm order, a non-double French centre, or a declared open end
  that does not match the rendered arm.
- Keep racks and the local hand in protected edge lanes. No played bone, pip,
  hand tile, rack or open end may be clipped or covered at 390×844 mobile or
  1368×1200 desktop. Also test the wide 2056×1170 paid-play presentation.
  Test 7-each, 9-each, 14-each and a dense French cross
  in both Practice and a real Lounge table; sharing a renderer is not a
  substitute for exercising both DOM compositions.
- A table visual change is not done until `npm test`, `npm run typecheck`,
  `npm run build`, and the exact-viewport browser visibility checks pass.

## Production deployment truth

- Production is currently promoted manually from
  `design/yaaddominoes-foundation` with `vercel --prod`. A push or merge to
  `main` is not the production mechanism for this project.
- `origin/main` is a stale, disconnected development baseline. Never infer
  what is live from `main`; inspect the YaadDominoes Vercel project's current
  production deployment and its exact commit SHA.
- As of 2026-09-15, `www.yaaddominoes.com` serves commit `8b9c0a1`
  (v156: legal pages show no company/address placeholders, contact info@drshallandahunter.com; v155: desktop boards fill the table with bigger bones and a 4-bone centre row, never clipped; JamDom French arms on desktop; Practice pass the pose; top hand inside the table; v154: Lounge Sign in to play, one-tap Google/Apple shown when enabled in
  Supabase, no email-link wait when confirmation is off; v153: Android smoothness pass, locked fixed board skips layout-forcing
  reads and cannot scroll; v152: desktop JamDom S board at today's bone, Practice Across, Pass in the
  hand header, never deal on a decided set, phone French board pinned; v151: Lounge desktop French pinwheel; Across shows my hand at the bottom
  and my partner hand at the top on a fixed board; v150: Lounge fixed board pinned every render and drawn with the predicted
  move log, so it never jumps; desktop cut throat/partner/open hand use the
  fixed JamDom board at desktop size; v149: phone Lounge cut throat/partner/open hand use Practice's fixed board,
  desktop side hands at the table edge, Lounge felt fits under its bars;
  v148: Lounge quick chat dropdown of patois lines; v147, Stage 2: Next hand on the Game Over card, swipes and the mouse wheel
  over a table scroll the page; on top of v146 Stage 1: French ask-who-poses
  rule, board pass kept in the move log,
  phone French three bones to each side; play-move, advance-duppy,
  expire-turns, start-hand and review-hand redeployed with that engine. If the
  Supabase CLI hangs after reading ~/.supabase/profile, pass
  SUPABASE_ACCESS_TOKEN from ~/.supabase/access-token), deployed with `vercel deploy --prod` from a clean worktree of
  `design/yaaddominoes-foundation`, which is also pushed to GitHub. For what
  any specific past deploy contained, read `git log` rather than trusting an
  accumulated list here — this line is a pointer to current truth, not a
  changelog. Update this line, don't append another one, next time.
- **`profiles.is_owner`** (0052) is narrower than `is_admin` — it gates
  referral financials specifically (stats, cash-out requests, marking
  paid) in `referral-admin`. Only Candy has it. Granting `is_admin` to a
  new account does NOT also grant this; that's the point.
- **Edge Functions deploy via the Supabase CLI** (`npx supabase functions
  deploy <name(s)> --project-ref iqixdijhckgilvyhduxb`), not by hand-assembling
  shared files through an MCP tool — the CLI resolves each function's real
  dependency tree automatically (including transitive `_shared/` and
  `_shared/engine/` files) and correctly preserves per-function
  `verify_jwt` settings from `supabase/config.toml` (confirmed:
  `stripe-webhook` stayed `verify_jwt: false` across a redeploy). Run
  `npm run sync:engine` first if `packages/engine/src` changed. The same
  CLI also runs arbitrary SQL when the Supabase MCP plugin needs
  re-authorization (its OAuth token expires independently of the CLI's own
  auth — one being down says nothing about the other): `npx supabase link
  --project-ref iqixdijhckgilvyhduxb` once, then `npx supabase db query
  "..." --linked` (must be `--linked`, not `--project-ref`, on the query
  itself).
- **`tables.status` only reaches `'finished'` when a full SET completes**
  (`tournaments.ts`), so an abandoned table used to sit in every lounge's
  "Open tables" list forever — including rows created by this project's own
  Playwright/curl testing, which hits this same production Supabase project
  (`iqixdijhckgilvyhduxb`), not a separate staging environment. An hourly
  pg_cron job (`sweep-stale-tables`, `0047_stale_table_sweep.sql`) now
  finishes any `waiting`/`playing` table with no `hand_public` activity in
  3+ hours, so this self-heals — no manual cleanup or special test-teardown
  needed going forward.
- Before claiming that a project rule or brand document is stale, read the
  real repository file. Conversation attachments and compacted context may
  contain older versions. The current `.claude/rules/design.md` specifies the
  Kingston Signal system; `docs/branding.md` is the canonical brand reference.

## The six invariants

Breaking any of these breaks the product's reason to exist. They are not
preferences.

1. **The engine has zero dependencies.** It runs in the browser, in Deno Edge
   Functions, and in the Node test runner. Use Web Crypto, never `node:crypto`.
2. **Clients never write game state.** No RLS write policy exists on `hands`,
   `hand_public`, `seat_hands`, or `sets`. Every move goes through the
   `play-move` Edge Function, which validates with `isLegal()` before applying.
3. **`hands` is never exposed to clients or Realtime.** Redaction happens in
   exactly one place — `persist()` in `supabase/functions/_shared/lib.ts`.
4. **Duppies never receive hidden tiles, and neither does the live coach.**
   Both take a `PublicView`, which has no field able to hold another seat's
   tiles. If you are passing `HandState` to a bot, stop. The same applies to
   `read.ts` (the live coach): practice runs in the browser, so the client
   genuinely holds every duppy's hand, and a coach that reached for it would
   teach reads that evaporate at a real table where the tiles are on a server.
   That file never imports `HandState` — the leak is unwritable, not guarded
   against. Keep it that way.
5. **The server seed is revealed only after a hand ends.** Never populate
   `hand_public.server_seed` while `status = 'active'`.
6. **No real-money play in this codebase.** Not behind a flag, not as hidden
   UI. See "Money" below.
## Rules competitors get wrong

Jamaican players notice these immediately. All are covered by tests.

- **Blocked hands go to the lowest INDIVIDUAL count.** In Partner, that
  player's team wins on that basis alone — the partner's tiles are irrelevant,
  and the winning team can hold more pips overall.
- **Play is anti-clockwise.** Seats are numbered in play order, so seat+1 is
  the player to your physical right and partners land opposite automatically.
- **Every set opens on the 6-6, LED, casual tables included** — the holder of
  the six opens, and the six is the only legal first move. Confirmed as a house
  rule 2026-09-03 after casual tables were seen posing anything to start.
  "Sporting" (declaring you'll open with another bone) stays in the Academy as
  real yard vocabulary, but it never opens a set here. `createSet` hardcodes
  `poseMustBeDoubleSix: true` and `start-hand` inserts the set flag the same
  way — do not make either conditional on `tournament`, because the lounge's
  create-table form never sends that field, so every online table is casual and
  a conditional would mean no online set ever forces the six. French is the
  same rule with the chucha (0-0) as its opening tile.
- **The six is forced at exactly three moments, and `tournament` is not one of
  them.** A set's first hand, a tied blocked hand's replay, and the hand after
  a bruk — identical in casual and tournament play. Every other hand is opened
  by the previous winner, who poses what he likes. `set.ts` already sets
  `poseMustBeDoubleSix` at precisely those three points, so the callers must
  pass it straight through: do NOT reintroduce `|| tournament` into
  `local.ts`'s or `start-hand`'s deal, which forced the six on every hand of a
  tournament set and meant the winner never posed. Confirmed 2026-09-03.
  There is no casual/tournament rules toggle any more — see "What a tournament
  is" below. `SetOptions` has no `tournament` field, the practice Rules picker
  and its walkthrough stop are gone, and `tables.tournament` survives in the
  schema unwritten. Do not resurrect it as a ruleset.
- **The score BRUKS when the LAST side still on love comes off it**, and the
  side that did it does not score one. Six love needs somebody to BE at love,
  which is the whole reason the reset exists.
  - **Partner:** two sides, so this is the familiar rule — the side under love
    wins and it goes straight back to 0-0.
  - **Cut throat:** four players are four sides, so several hold points at
    once and the board only wipes once EVERY one of them has won a hand.
    Winning is reaching six while ANOTHER player is still on zero — not while
    all of them are.
  - "Under six love only one side can hold points at a time" used to be
    written here and it was wrong: it is Partner's rule stated as if it were
    universal, and `applyHandResult` implemented it that way, wiping the board
    whenever any non-leader won. Corrected 2026-09-04 against pagat and a
    Jamaican player who hit it mid-set. `sixLove` (the whitewash celebration)
    stays stricter than the win condition — every other side on zero.
- **Tied blocked hands replay at a flat 2 points, double-six forced.** The
  double-six holder opens the replay no matter who currently leads — never
  "sporting" — and it's worth 2 points whoever wins it, however many ties
  happened first. An earlier version escalated the value each successive
  tie (2, then 3, then 4); that was wrong, confirmed against real play.
- **One all play two:** at 1-1 the playoff winner goes straight to 2-0.
  Unverified at cut throat, and worth a decision rather than an assumption:
  it hangs off the bruk, so since 2026-09-04 it fires there when every player
  is on exactly 1 (that being when the last one comes off love). Left as it
  was rather than invent a four-handed reading of a Partner rule — no source
  found either way.
- **Pass the pose, and pass it AFTER the deal.** In Partner the winner may hand
  the pose across the table, but never when the double-six is forced. **The
  choice is offered with the tiles already in hand** — "generally must deal
  before asking if partner wantes to keep pose or pass it… they need to see
  which hand is better first" (owner, 2026-09-12). Until then the client
  called `pass-pose` and only THEN `start-hand`, so the winner decided blind,
  which is the one thing the decision cannot be made without.
  Nothing about the deal changes when the pose is passed — the tiles are
  already out, only who opens changes. So `pass-pose` moves the LIVE hand's
  turn to the partner, through the same optimistic version check every move
  uses, and refuses once any bone is down (`move_log` non-empty) because by
  then the pose has been played. It also writes `hands.poser` and `sets.poser`
  so both records name whoever actually opened.
- **French: only a double left in hand counts twice — never the whole hand.**
  Holding 5-0 and 6-6 at hand end scores 5 + 12 + 12 = 29, not (5 + 12) × 2
  (owner, 2026-09-13). An earlier build doubled a seat's entire pip count if it
  held any double, which overcharged every hand with a double in it.
  `HandResult.doublePips` carries the pips on held doubles and `set.ts` adds
  them a second time. When the domino winner's own final tile was a double,
  every OTHER seat's hand score (held doubles already counted twice) then
  doubles; that part was not changed and has not been re-confirmed.
- **The key tile scores a flat 2, not 1 — and never stacks with handValue.**
  When the board's two open ends need two DIFFERENT pip values, the bone
  bearing both of them (ends need a 5 and a 1 — the "5-1" bone) closes the
  game and is the key.
  **It does NOT also require that every other tile of those suits is already
  down.** That stricter reading was here until 2026-09-12, taken off pagat,
  and it was wrong: the owner won a key in partner and was paid 1. Measured
  over 3,000 simulated partner hands it fired on 2.9% of wins against 13.1%
  for the real rule — rejecting about four key wins in five. At a table the
  key is simply the bone that shuts both ends when they want different
  numbers; what is still in somebody else's hand cannot be part of the test,
  because nobody can see it. Winning by playing it scores 2 points, full stop — not `handValue + 1`,
  so it lands on exactly 2 even during an already-elevated one-all-play-two
  decider. If the last playable tile happens to be a double (both ends
  coincidentally need the SAME value), that does NOT count as a key even
  though it's the sole legal play — normal 1 point only. Confirmed against
  pagat.com's Caribbean Dominoes rules and gamerules.com's Jamaican Cut
  Throat rules; `hand.ts`'s `isKeyTile` and `HandResult.keyWin`.

## Settled product decisions

Do not relitigate these without asking.

- **Cut throat defaults to first-to-six** — but this is no longer a settled
  decision, because the reason for it was a bug. It read "six love needs six
  consecutive wins from one player out of four, a ~196-hand median". Six in a
  row was never the rule; `applyHandResult` was wiping the board on every
  non-leader win (see the bruk rule under "Rules competitors get wrong").
  Fixed 2026-09-04, and `npm run bench` now measures **21 hands for cut throat
  six love against 19 for partner**. The default is unchanged pending a real
  decision; the length argument for it is gone.
- **The game is free; membership buys the social layer.** Guest free, Yardie
  $24/yr, VIP $69/yr. The incumbent gates basic play behind a paywall and
  bounces every newcomer; we do the opposite deliberately.
- **No social login is ever required.** Anonymous sign-in is on.
- **No modal during a live hand.** Not a gift, not a rate prompt, not an ad,
  not a service worker update.
- The desktop turn clock is a compact top-edge status pill with its numeric
  countdown, bank text and urgent bar intact. It must not consume a full-width
  board row or push the hand away from the table.
- **Lounge chat is scoped to exactly one lounge.** Ignore stale history,
  presence, reaction and message callbacks after changing rooms, filter every
  displayed message by the current `lounge_id`, and include the lounge name in
  the Table talk heading.
- Live table creation keeps optional controls collapsed, but the disclosure is
  an obvious `Table settings` control with seats/clock/Duppies scope, visible
  Open/Close state, strong contrast and a 44px+ target.
- **The live coach tells you what to play, and it is practice-only.** Built
  2026-09-04 on the owner's explicit call, reversing an earlier "teach, don't
  tell" position: the goal is players who walk into the lounge as champions.
  `read.ts` counts the suits, says what the passes proved, and ranks the plays
  by the duppies' own `scoreMove`, so following it plays at the strongest tier.
  Deliberately the heuristic and not `chooseMove`'s sampler — a win rate cannot
  explain itself, and every line has to say why. It is NOT gated: a server-side
  flag would drag Supabase into the offline practice bundle for nothing, and
  practice-only means nobody gains an edge over another player. If it is ever
  offered in the lounge, that is a competitive-integrity decision, not a
  feature flag.
- **A finished hand belongs to whoever PLAYED it, not to whoever is sitting
  there now.** `reveal-hand`, `review-hand` and `settle-hand` authorise against
  `seat_hands` (written per hand by `persist()`, never rewritten), not against
  `seats`. Asking `seats` was a real bug: `leave-seat` nulls `seats.user_id`,
  so leaving a table permanently locked a player out of verifying, reviewing or
  settling hands they had genuinely played — breaking the Verify promise below
  and the Coach, which is the reason to play here at all. Note the across case
  when reading that row: one player holds TWO seats (0&2), so the lookup takes
  the lower seat rather than expecting a single row. Fixed and verified live
  2026-09-03.
- **Deal verification is free and visual.** After a hand ends, a participant
  may ask for the immutable starting deal and commit-reveal receipt. Their
  browser reconstructs the shuffle and shows every starting hand; seeds and
  hashes live under Technical details. Never charge coins for trust, never
  reveal a live hand, and never expose the `hands` table itself.
- **No auto-play.** A tile fitting both ends prompts for which end. By
  default every tap only selects and the board confirms the move (a stray
  thumb used to play the neighbouring bone). **Practice Quick play** (owner,
  2026-09-14, like JamDom's "Click to Play") is the player's own opt-in in the
  lobby, stored as `yard:quick-play`, off by default: a bone with exactly one
  legal place then plays on one tap, and a bone with two places still asks.
  The Lounge has no Quick play yet.
- **Academy teaching is visual and interactive.** Every declared lesson has a
  deterministic SVG in `apps/web/public/art/boards/`, generated from
  `scripts/gen-diagrams.ts`; every declared drill resolves through
  `academycontent.ts` to one unambiguous, explained decision. Do not replace
  either with decorative AI imagery or a list of inert prompts.
- **Timed-out seats play a legal move, they do not forfeit.**
- **A tournament is a scheduled EVENT played by real people. It is never a way
  to play.** This is the JamDom sense of the word and the only one this product
  uses: an event with a start time, sign-ups, a host-run draw, rounds, and a
  substitutes line that VIP goes to the top of. The `tournaments` /
  `tournament_signups` tables and `tournament-host` are that feature; a table
  belongs to one when `tables.tournament_id` is set. There is deliberately no
  "tournament ruleset" — the six opens a set, a tied replay and the hand after
  a bruk on every table alike (see above), so a rules toggle would have been a
  difference that does not exist.

  **Real people is enforced, not merely intended, and rating is why.**
  `apply-rating.ts` refuses to rate a set containing ANY duppy seat. A host's
  draw fills each seat with a placeholder duppy (0001 forbids a seat that is
  neither person nor duppy) which the drawn player displaces by turning up — so
  a single no-show would otherwise produce a whole round that scores for
  nobody. Three guards prevent that, and `tournament-real-people.test.ts` pins
  all three: `start-hand` will not deal while any seat is unfilled,
  `advance-duppy` refuses on a table with a `tournament_id`, and `expire-turns`
  steps over an unfilled seat. A timed-out HUMAN seat still gets a legal move
  played for it, tournament or not — otherwise one absent player stalls the
  event. A walkout leaves a claimable seat: the leaver has 0053's rejoin window,
  then the substitutes line has it.

  Known consequence, accepted deliberately: a tournament hand PAUSES on an
  empty seat rather than letting a bot finish it. The host's `cancel`/`clear`
  actions are the escape hatch. If that proves too blunt in a real Sunday, give
  the host a "fill this seat" action — do not reintroduce a duppy.

  **Themes.** `tournaments.theme` (0056) says which kind of event this is, and
  a theme decides WHO SITS WITH WHOM — never the game rules. Seating lives in
  one place, `_shared/tournament-queue.ts`'s `drawForTheme`; the host calls
  that, not `drawCutLine`, so a new theme never means teaching the host a
  seating rule. Only themes whose draw is actually built may appear in the
  check constraint — a theme the draw cannot seat is a host scheduling an event
  that silently seats nobody.

  - `open` — the queue cut into full tables.
  - `battle_of_the_sexes` — women on seats 0&2, men on 1&3, which IS the two
    partner sides. Four-handed partner only (enforced in 0056 and in the host).
    `tournament-signup` refuses entry without `profiles.gender` set, because
    finding out on Sunday morning that you were never seatable is worse than
    being told while it is one tap to fix.
  - `couples` (0057) — two people who entered together sit as partners against
    another couple. A pair is two ordinary signup rows naming each other via
    `partner_user_id`, so confirmation falls out of the data instead of needing
    a status column, and **a one-sided claim never seats anybody**: a typed
    username must not be able to put a stranger in somebody's partner seat.
    A pair inherits the queue position of its higher-standing member, so a VIP
    does bring their partner up the line — the only coherent reading, since a
    couples event cannot seat a VIP without the partner they entered with.
  - `team_vs_team` (0059) — exactly two named teams (`tournaments.team_a_name`/
    `team_b_name`, required together, enforced by both the host and a check
    constraint). A table seats two of each on opposite sides — structurally
    the same shape as battle of the sexes, keyed on `tournament_signups.team`
    (`'a' | 'b'`, chosen at sign-up) instead of gender. Unlike couples, a
    team-mate needs no relationship to anybody: "on team A" is a roster
    affiliation, not a claim about a specific person, so there is nothing to
    confirm the way a couple's `partner_user_id` has to be mutual.

  **`tournament_signups` now holds two foreign keys to `profiles`** (`user_id`
  and `partner_user_id`), which means a PostgREST embed there MUST name its
  key — `profiles!tournament_signups_user_id_fkey(...)`. A bare `profiles(...)`
  became ambiguous the moment 0057 landed and PostgREST refuses the whole query
  rather than choosing, which broke every tournament read for every theme until
  the hint went in. Caught only by running the real endpoint.

  **A themed draw's seating must be enforced, not just computed** — the second
  trap already sprung. `drawForTheme` computes exactly which seat each drawn
  player belongs in, but `join-table` used to hand out "any open seat" to
  whoever tapped Join first, so which literal seat a real person landed in was
  a race. 0058 adds `tournament_signups.seat_index`, written per player at
  draw time (`start`, only for a non-open theme — open makes no seating
  promise, so it keeps the original free-for-all) and cleared on `mark`/
  `clear` alongside `table_id`. `join-table` enforces it ahead of both the
  request's own `seatIndex` and the open-seat fallback. Verified live:
  scrambled the join order — the man drawn for seat 1 joined FIRST, via the
  join code alone — and he still landed in seat 1, not the seat 0 a race would
  have given him.

  **Known gap, not yet fixed:** a substitute filling a no-show's seat has no
  `seat_index` of their own — only the four players the draw actually seated
  get one — so a substitute still falls through to "any open seat" and can
  land on the wrong side of a themed table. There is currently no host action
  to assign a substitute to a specific side. Flag this before relying on
  substitute-in-progress for a themed event; it is fine for `open`.

  **The trap a theme sets, already sprung once:** "above the cut" and "in the
  first N of the queue" are the same sentence only for an open event. With six
  women and two men the four who play sit at queue positions 1, 2, 5 and 7 — so
  anything comparing an index against a seat count tells two people they are
  out when they are in. `standingFor` and the host's queue view both ask the
  draw for membership instead. Any future theme inherits that for free; do not
  reintroduce a positional cut.

  All three non-open themes share the seat-assignment machinery above
  (`tournament_signups.seat_index`), so the join-order fix applies to each for
  free — verified live for `team_vs_team` the same way as the others:
  scrambled join order, correct final seating regardless.

  **Weekly recurrence — a "Repeat" button, deliberately not automation.**
  `prefillFromTournament` in `tournamentview.ts` fills the create form from an
  existing event (name, mode, theme, both team names, start time +7 days —
  `localDateTimeValue` keeps it in the browser's own local time rather than
  letting `toISOString()` silently shift it by the viewer's offset) and stops
  there: nothing is submitted, the host still reviews and hits Schedule, free
  to change whatever is different this week. No `pg_cron`, no server-side
  concept of recurrence at all — chosen deliberately over full automation so a
  theme or team-name change never has to be caught and fixed after the fact.

  This form's own fields (name, start time, mode, theme, both team names) all
  live in module state and write back on every keystroke/change, the same
  reason the team-name fields already needed it (`tournamentview.ts`'s
  `scheduleTick` can rebuild this panel as often as once a second near another
  event's start time). Before this pass `name`/`starts`/`mode`/`theme` had none
  of that — a pre-existing gap, exposed rather than caused by adding Repeat,
  since prefilling those same fields with a stale value the very next tick
  would silently discard was the whole reason to fix it now. Verified live
  with a real DOM check, not just a read: typed into the prefilled name field,
  forced a full unmount/remount of the host panel (closed and reopened it,
  which really removes and rebuilds `.tourney-new` — the same shape as a real
  tick), and the edited value survived; Schedule then created a second real
  tournament row with every field carried over and the start date shifted
  exactly +7 days.
- **Voice is a peer-to-peer mesh, never an SFU.** Live table voice ships in
  `apps/web/src/voice.ts`: each of the four seats sends audio straight to the
  other three, signalling over the Realtime channel the lounge already holds.
  No media server, no vendor, no per-minute bill. LiveKit and Daily were
  rejected — an SFU only earns its cost above roughly twenty in a room, and
  pricing a four-hander against one is what made voice look unaffordable.
  STUN is free; TURN relays only the minority of peers behind strict NAT and
  sits well inside Cloudflare's free tier. Do not reintroduce a media vendor.
- **Hearing the yard is free; talking is the membership.** Guests join
  listen-only and are never asked for a microphone, so a newcomer's first
  experience is the room rather than a permission dialog. The gate is
  `canSpeak()` in `voice.ts`, and it is currently client-side: a patched
  client could still transmit. The fix when it matters is Realtime
  Authorization — an RLS policy on `realtime.messages` for the `voice-signal`
  event — not a bigger check in the client.
- **Voice is additive and must never break the room.** It is the feature the
  incumbent's players complain about most, so it is the one ours is judged on
  hardest. A voice failure degrades to "no audio" with a plain explanation —
  it never takes down the lounge, the chat, or a live hand. Assume the
  microphone gets refused, two peers offer at once, ICE drops when a phone
  moves off wifi, and iOS suspends the whole channel in the background: those
  are normal conditions, not exceptions. Mute must actually stop transmitting
  and leaving must stop every track — a mute that only mutes the UI, or a
  recording light left on after leaving, loses trust permanently.
  `.claude/rules/voice.md` has the full failure list and loads when you open
  the file. Two tabs in one browser share a session and are not two players;
  verify with two real clients.

## Art

**Every image uses the template in `docs/art-direction.md`. Read it before
making or accepting any artwork.** The character is a domino tile with
pip-hole eyes, not a smiley with a flag behind it; flat vector, front-on,
solid forest-green background, no text baked into the picture, 128px WebP.
Never generate one image against a new rule while the rest of a set sits on
the old one — regenerate the whole set or change nothing.

Illustrations with people in them must show women playing and winning, not
spectating. It will not happen unless it is asked for every time.

## Competitive position

JamDom.com (since 2007) is the incumbent, not a generic app-store rival.
Standard membership $20.99/yr is mandatory for basic play; VIP is $74.95/yr;
Jamaican players pay by bank deposit and email the receipt. Their app is
offline practice only — real games need a desktop browser — and it sits at
3.51 stars from 250 ratings, last updated June 2020. After eighteen years they
still argue with players about "bad hands" on Facebook.

Our three answers: mobile-first PWA, a Verify button instead of an argument,
and a free game.

Match what they get right: lounges as places with regulars, pass-the-pose,
per-style rankings, per-move speed stats, spectator culture, patois register.

## Money

Web-only, subscription-funded. No app store, so no platform cut and no store
review. Stripe is the only payment path. Guest free, Yardie $24/yr, VIP $69/yr —
the game is free, the subscription buys the social layer.

Access is decided by `effective_tier()` in SQL and enforced in RLS. A tier check
in client code is a suggestion, not a paywall. See `.claude/rules/billing.md`
for the subscription lifecycle.

**Cash-stakes gaming is a separate problem from subscriptions.** Being web-only
removes the app-store constraint but changes nothing about gambling law — a
licence is needed wherever dominoes-for-money counts as gambling, and a public
site is reachable everywhere unless deliberately geo-gated. Processors also
treat skill gaming as high risk. So: no stakes, pots, chips, or casino imagery
in this codebase. If it is ever built it is a separate application with its own
legal opinion and processor.

## Secrets

- **Any env var prefixed `VITE_` is compiled into the client bundle and visible
  to anyone who opens devtools.** Only `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_ANON_KEY` belong there — the anon key is public by design and
  RLS is the real gate.
- Service role key, Stripe secret key, Stripe webhook secret, and any image-API
  key go in `supabase secrets set` or `.env.local`. Never in source, never in a
  `VITE_` var, never committed.
- Putting `SUPABASE_SERVICE_ROLE_KEY` behind a `VITE_` prefix bypasses every RLS
  policy in the database. That single underscore undoes the whole security model.
- Check `git diff --staged` for anything key-shaped before committing. If a
  secret was ever pushed, rotate it — deleting the commit is not enough.

## Working style

- Use em dashes only where the sentence genuinely needs an interruption. Do
  not use them as automatic decoration, list separators, or substitutes for
  commas, colons, parentheses, and full stops. Keep established compounds such
  as `anti-clockwise` unchanged.
- Run `npm test` and `npm run typecheck` before saying a task is done.
- When a test fails, work out whether the test or the code is wrong before
  changing either. Several tests encode rules that look wrong and are not.
- Do not add a dependency to `packages/engine`. Ask first.
- French is built: cross board, chucha opening, doubling, the +10 pass
  penalties, the blocked-tie chucha reshuffle — the set
  ends the instant ANY seat's score reaches or crosses 100, lowest score at
  that moment wins outright (confirmed against real play; an earlier
  "last-one-under-target-survives" design was wrong) — and the coin-tied
  mid-hand reshuffle at a 50-70 score window are all live — selectable from
  both local practice and real online tables.
  Across is built: partner's exact ruleset (six-love default, first-to-six
  selectable, same scoring, same pass-the-pose), played online by two real
  people instead of four — each one signed into both seats of a side (0&2 or
  1&3) and plays each in its own turn, never back-to-back. No new engine
  rules; `isPartnered()` covers it. Rules confirmed against a real Jamaican
  consultant, 2026-08-07. Local practice (a human plus duppies) is not yet
  wired up for it — online only so far.
  Shipping it first missed optimistic prediction on the partner seat, which
  looked like a stuck/delayed hand rather than just a slower one — see
  `.claude/rules/client.md`'s "Every playable seat needs optimistic
  prediction" before touching `OnlineGame.play()` again.
- Prefer editing existing files over creating new ones.
