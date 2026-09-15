# YaadDominoes — living table experience plan

Last updated: 2026-09-14. Status: reference-led final-table revision approved; implementation and acceptance in progress.
Owner: project owner. Execution: whichever AI/developer resumes this file.

## Read first: authorization and resume point

The owner explicitly authorized this consolidated plan, ongoing progress updates, and overriding conflicting CLAUDE.md/project preferences where needed to deliver the agreed table experience. Do not repeatedly request permission for scoped local implementation, mockups, review, or verification already covered here. Preserve Claude's working improvements and existing user edits.

This plan supersedes older local instructions requiring tiny circular identities, enclosed mid-edge player cards, desktop social tools below the table, and redundant floating play prompts. It does not authorize unrelated changes, deployment, external messages, destructive rewrites, changes to payments, or removal of server authority and hidden-hand protections. Record any newly discovered conflict and its resolution below. New explicit owner decisions take precedence; do not interpret “perfection” as permission to invent game rules.

**Resume here:** physically verify the current mobile Practice correction at 360/390 width: larger edge-to-edge board bones matched to the hand; clean elbows including doubles; centre line left/right, left arm up then across, right arm down then left; compact hand tray; no white self-play label; shuffle followed by one-at-a-time dealing. Continue through a dense hand and confirm both end arrows remain reachable. Preserve the existing French phone route, Lounge layout, rules, privacy, end-hand remaining-tile reveal and expandable teaching. The owner explicitly cancelled the separate mockup and requested direct app work, with the running result shown before any commit. Do not replace the route engine merely to rearrange portraits.

Update this document after each meaningful work session. Maintain task status, evidence, blockers, exact next action, and decision history. This is the current plan; `docs/memory.md` and instruction files should link here rather than copy the whole plan.

## Objective

Deliver a familiar Jamaican table with clear corner photographs, a useful right sidebar, readable constant-size dominoes, authentic rules, and precise interaction feedback. Players should immediately understand whose turn it is, what they selected, where it can go, how much time remains, whether their move succeeded, and how to leave. Retain the YaadDominoes name and established branding while matching the spatial familiarity of the JamDom reference.

The business aim is to attract and retain complete groups through trustworthy play, comfortable readability, reliable reconnection and voice, easy invitations, and helpful learning. Do not promise migration of all JamDom users or describe existing competitor features as unique.

## Evidence and limits

- Local Practice inspected on 2026-09-12 at approximately 1265×712: table/hand extends below the viewport; At di table appears below the wood; portraits are small circles associated with racks. This is a viewport-specific observation, not proof every desktop fails.
- Relevant source inspected: `apps/web/src/styles.css`, `seatlayout.ts`, `table-rack.ts`, `render.ts`, `onlinetable.ts`, `profile.ts`, and current project instructions. Practice and Lounge have distinct DOM builders; shared rendering does not prove parity.
- A real four-person Lounge session was not tested in this planning review. Existing code or historical memory is not launch-readiness evidence.
- Reference videos: https://www.youtube.com/watch?v=yDPtQzPrsYQ and https://www.youtube.com/watch?v=lWxZZryHmnU . Prior frame measurements are estimates, not verified source dimensions.
- The earlier chat's reconstructed route arrays are NOT a validated placement algorithm. Do not paste them into production. Current CLAUDE.md documents newer measured geometry and phone exceptions; inspect the actual implementation and tests.
- JamDom's site advertised a phone version when checked on 2026-09-12: https://jamdom.com/ . Its social/tournament features are described at https://jamdom.com/memberships/standard.php and https://jamdom.com/memberships/vip.php . Recheck prices and capabilities before using them in marketing.

## Revised final-table sequence — owner approved 2026-09-13

The competitive objective is a familiar Jamaican table that established groups
choose to return to. Visual polish supports that objective; occupied tables,
completed sets and returning groups are the eventual measures of preference.

Reference evidence inspected in this task: Cut Throat at approximately 7:25 and
14:49 (https://www.youtube.com/watch?v=yDPtQzPrsYQ&t=445s), French at 2:57 and
5:55 (https://www.youtube.com/watch?v=lWxZZryHmnU&t=355s). The sampled frames
show a continuous wooden surface, four corner portraits, perimeter racks,
broad active-station highlighting, connected ivory bones and an adjacent log
and conversation rail. These are historical visual references, not evidence
of current sound quality, animation timing, mobile capability or reliability.

1. **Preserve the physical table first.** Keep recognizable corner portraits,
   associated names and racks, visible concealed bones, a quiet wood centre,
   and familiar opposite/anti-clockwise seat relationships. Preserve brand
   identity and existing avatar/photo entitlements.
2. **Clarify information and turn.** Compact high-contrast score, identified
   sides and timer; counts with player stations, without repeated counts in
   the sidebar. Desktop rail contains standings, recent moves, lounge-scoped
   chat and applicable spectator/seating tools. Illuminate the active rack
   itself as well as the portrait; reinforce with text. Never pulse, resize or
   reposition furniture to show a turn, selection, Pass or pending action.
3. **Lock geometry across supported modes.** Measure the full legal route and
   protected rectangles before the deal; preserve the current readable bone
   minimum and preview/placement parity. Preserve the newer French phone
   routing and deliberate internal pan exceptions. Across retains the latest
   owner-confirmed Open Hand furniture; do not revive the abandoned dock.
4. **Deliberate phone experience.** Board, active hand, score and recognizable
   opponents come first. Social tools must be reachable without covering legal
   actions. Verify keyboard open/closed, rotation and background/return as well
   as static sizes. At narrow desktop, measure the rail-versus-bone tradeoff;
   the current below-table rail at 901–1100px is an existing exception to review,
   not proof the simultaneous-visibility target has passed.
5. **Real acceptance before further redesign.** Practice and real Lounge;
   desktop 1024×768, 1280×800, 1440×900, 1920×1080; phone 360×780 and 390×844,
   plus existing short-screen gates. Cover opening, dense legal hands, two
   ends, pass, partner hand, pending/rejected move, timeout race, reconnect,
   result/next hand, chat isolation and leave/cancel. Use independent clients
   for invitations, correct partner seating, full sets, rematch and voice
   refusal/mute/leave. No unresolved rules, privacy, duplicate/lost-move or
   inaccessible-destination defects may pass.
6. **Authenticity pilot and performance.** Propose 3–5 established groups,
   including experienced JamDom and older players, for full-set observation.
   Record what feels wrong and what prevents a group returning. Track join and
   set completion, next-week group return, preference and support friction.
   Participation/outreach still requires separate arrangements. Measure time
   to playable table, dense-hand responsiveness and reconnect recovery; run
   Lighthouse on production homepage and live-table routes as diagnostics.
7. **Evidence then release.** Update status only after verification; record
   unresolved cells explicitly. Show the running result before commit, and
   retain the existing deployment authorization boundary.

| Revision item | Status | Evidence / next gate |
|---|---|---|
| Reference analysis and revised priorities | DONE | Four sampled frames above; owner requested implementation |
| Shared active-rack field and textual cue | IN PROGRESS | Implemented in both builders; Practice desktop/phone and 462 tests pass; real Lounge validation remains |
| Hierarchy, fixed geometry and phone acceptance | IN PROGRESS | Existing work preserved; full matrix remains unverified |
| Independent-client reliability and group pilot | TODO | Real Lounge access and participating groups required |
| Performance measurements and final release | TODO | Production-route audits and reviewed release still pending |

### Mobile Lounge screenshot review — 2026-09-13

Owner supplied an iPhone screenshot of yaaddominoes.com and asked whether the
phone should look like desktop, how to navigate, and that the no-cutoff work
and plan continuity always be preserved. Inspected source image:
`/Users/higgi/Library/Group Containers/group.com.apple.notes/Accounts/F1F4D23C-1F5F-467A-9670-F674FC992609/Media/43D03F61-9390-47E7-9E50-84051F680BDC/1_DCB33898-CC82-4B71-8354-F7C4DB780798/Image.heic`.

Observed: an opening 6-6 is wholly visible; the complete seven-bone local hand
is visible at the bottom of the wood; top opponent name/count are readable,
but the tiny side portraits are largely obscured by AI badges and have no
visible names. The floating “Chat & stickers” button covers the right portion
of the social tab row. The table is tall with much open space in this opening
state. The header is partly outside this capture; screenshot scroll position
and Safari chrome prevent inferring full-page fit. One opening bone is not
evidence of dense-hand containment or of which build is deployed.

Recommended direction: retain deliberate phone composition with the same
physical seat relationships/materials as desktop. Do not squeeze desktop
corner photos and a permanent side rail onto portrait phones. Improve compact
seat recognition without widening the protected rack lanes. Keep the current
bone sizes, locked hand geometry, French phone route and legal-end access.
Measure dense states before reclaiming empty opening space: never shorten
the table merely because the first bone leaves a lot of wood unused.

| Mobile follow-up | Status | Acceptance gate |
|---|---|---|
| Protect played-domino containment fixes | REQUIRED CONSTRAINT | No clipped bones/hidden legal destinations after any furniture change; preserve readable phone pan exceptions |
| Remove chat launcher/tab overlap | IN PROGRESS | Floating launcher removed from mobile; in-rail tabs remain to verify at 360/390 widths and keyboard states |
| Make side opponents recognizable | IN PROGRESS | Compact side names now render beside faces; verify lane containment and dense chains |
| Clarify social navigation and return to play | IN PROGRESS | Added in-rail Back to table control; real Lounge navigation still unverified |
| Review tall table/compact score and timer | TODO | Measure actual Safari viewport and dense legal chains before changing height; hand stays reachable |

Current navigation verified by source (`onlinetableview.ts`): select a bone,
then explicitly select its legal destination; tap it again to deselect.
“Chat & stickers” selects Table talk and scrolls to the social rail. Tabs are
Table talk, Watching, Standings, Log and You. Return to the table by scrolling
up; no dedicated return-to-hand control was found in the inspected rail.
The visible Table talk label currently fronts lounge-scoped chat, so the
scope should be made clearer in the navigation polish.

Implementation session 2026-09-13: removed the mobile floating Chat & stickers
launcher that could cover the social tabs, and added an in-rail Back to table
button that scrolls to the felt. Side stations now show a compact opponent name
beside the face and retain the AI cue; no board route, bone unit or protected
guard was changed. `npm run typecheck`, `npm test` (462/462), production build
and `git diff --check` pass. The local Lounge still requires a test email
before room entry, so real Lounge navigation and independent-client geometry
remain open. Next action is browser QA at 360/390 in dense hands, then measured
height/header polish. Continue updating this tracker after each session and
keep the played-domino no-cutoff constraint attached to every layout change.

## Before → after contract (existing detailed requirements)

| Area | Observed baseline / concern | Required result |
|---|---|---|
| Desktop composition | At inspected size, content requires scrolling | Entire active table, controlled hand, four identities, timer, and right sidebar visible together |
| Player identity | Small circles attached to rack panels | Four substantial corner photographs, names and compact statistics associated clearly with their seats |
| Right portion | Duplicate player cards; panel below table at inspected width | Permanent desktop sidebar with score, recent moves, chat, spectators/queue, compact controls |
| Domino readability | Readable local hand; full-hand parity still needs measurement | Controlled hand and played bones use equal dimensions, fixed throughout the hand; large dark pips |
| Turn prompt | Extra panel competes for space | Steady illuminated hand tray plus small embedded “Your turn”; no redundant floating play card |
| Time | Owner likes the timer | Retain timer, fixed location, current player identified, number plus progress bar |
| Selection / preview | Needs coordinated review | Distinct selection, correct legal targets, preview matches committed placement |
| Exit / errors | Needs full-path review | Plain actions, accurate consequences, recoverable errors, no ambiguous silent state |
| Practice / Lounge | Separate compositions | Same visual and interaction contract, both exercised explicitly |

## Layout requirements

### Four corner photographs

Use square or lightly rounded portraits as meaningful table elements, initially targeting 88–112 CSS pixels at a normal desktop presentation. These are design targets to validate, not fixed JamDom measurements. Preserve optional user photos and clear avatar fallbacks; do not silently change photo membership entitlements. Keep names readable and face crops adjustable where supported.

From the local viewer's perspective: upper-left photo identifies the left seat, upper-right identifies the top seat, lower-right identifies the right seat, lower-left identifies the local seat. Associate each rack and information block spatially with its owner's corner. Preserve anti-clockwise order and opposite partners. Spectators, three/two-seat modes, and Across need explicit seat mapping; never infer ownership from a hardcoded player number.

Keep the top hand along the upper edge, side hands along side lanes, and controlled hand near the bottom. Reserve portrait, rack, hand, and action rectangles before measuring the play region. They may share a logical station without sharing a large enclosing card. Played tiles never touch those reserved rectangles.

### Right sidebar and compact header

Start the mockup with 24–27% of desktop width allocated to the sidebar and validate remaining board capacity. Priority order: compact score/round; recent move log; chat with stable input; spectators/seating queue; small mic/sound/table controls. Scroll histories inside their panels. Avoid duplicate player cards and oversized theme swatches. Keep Leave table easy to find in a stable header location.

Minimize header height while preserving mode, score, active player and timer. User-requested exit confirmation is allowed during a live hand; unrelated popups remain prohibited. The table's clock must continue according to authoritative state during an exit confirmation.

### Readability, space and routing

- Never reduce played/controlled-hand bone size as the hand progresses. Measure available space before the deal; fit the complete route capacity then lock geometry for the hand.
- Hand and played short/long sides must match within 1 CSS pixel. Preserve 1:2 geometry, pip map, clear divider, and ivory face. Highlight selection around the bone without altering pips.
- Keep current stable concealed-rack sizing pending explicit visual review. The latest owner emphasis is readable controlled hands and played bones; do not revert Claude's perimeter-counter solution based solely on older chat demanding every back be identical.
- Use measured rectangular guards; “invisible square” means protected space, not forced equal width and height. Larger corner photos must enter the same collision measurements.
- Preserve the current tested French routes, viewer-relative arm ownership, and fixed bone sizing. Layout changes must be proven safe for dense hands.
- Desktop target is simultaneous full visibility. Preserve the documented readable-phone French pan behavior; do not shrink phone bones to meet the desktop rule. Provide clear overflow/direction cues and reachable legal endpoints. Keep controls and hand reachable while panning only the board.
- Preview and final tile must use the same layout calculation. A narrow reveal between played bones must not break their visual connection or change game geometry.

## Interaction state specification

All signals must derive from the same active seat, hand/version, selection and submission state. Avoid independent timers/highlights that disagree after a late response or reconnect.

| State | Visible cue | Permitted action / transition |
|---|---|---|
| Waiting for seats/deal | Plain waiting message; no false playable hand | Join/start only when actually available; explain disabled actions |
| Pose choice after deal | Actual dealt tiles visible; concise Keep pose / Pass pose when legal | Preserve existing after-deal pose rules; forced pose does not offer illegal passing |
| Your turn, no selection | Steady bright tray border/background, embedded Your turn, clear legal-tile outline | Select a tile; no premature placement preview |
| Tile selected | Slight lift/selection outline distinct from turn highlight | Show legal endpoints/arms; change selection or cancel easily |
| Destination selection | Accurate tile preview at legal target(s), concise label if needed | Explicitly choose among multiple ends/arms; never silently choose |
| Sending move | Playing… in existing tray header; recognizable pending tile | Prevent duplicate submission; reconcile confirmed version without double animation |
| Move accepted | One placement; matching final orientation/position | Clear selection; advance all turn cues together |
| Move rejected | Plain reason near hand, selection recoverable if still legal | Refresh state when stale; allow retry only when appropriate |
| No legal move | No matching tile — Pass where mode allows | Mode-correct pass/penalty semantics; do not invent free passes |
| Opponent turn | Opponent corner highlighted; timer names that player | Hand stays readable; no misleading playable cue |
| Timeout | Explain the actual timeout move/state | Follow existing legal-move timeout rule; avoid racing a manual submission |
| Reconnecting | Reconnecting… and clear temporary input state | Restore correct seat/hand/version; never show a false confirmed move |
| Round complete | Result and primary Next hand; replay/check-deal secondary | Preserve result semantics; no live-hand coaching leak |
| Leave requested | Leave table with accurate explanation of seat/rejoin consequence | Stay at table / Leave table; cancel returns focus; no generic OK/Cancel |

Keep the numeric timer and bar at a stable location. Remove redundant floating turn panels only when their information exists in the hand header or corner cue. Distinguish turn, legal tile, selected tile, pending, unavailable and failure states with text/shape as well as color. No flashing hand glow. Optional sound must respect mute; animation must respect reduced motion.

Every table-facing change is evaluated as one parity matrix: Practice and
Lounge; Partner, Cut Throat, French and Across wherever supported; narrow and
wide desktop plus mobile. “Shared code” is not evidence that all cells behave
the same. Record deliberate exceptions (for example readable French panning on
phones) explicitly; visual drift between applicable cells is a defect.

Accessibility targets for implementation: readable normal text contrast ≥4.5:1; meaningful controls/focus outlines ≥3:1 against adjacent colors; approximately 44×44 CSS-pixel action targets where practical; keyboard-selectable tiles and destinations; visible focus; status announcements that do not repeat every timer tick. Measure colors on each supported table background. Keep nonplayable tile pips readable.

## Authenticity and competitive work

Reconcile stale parent instructions against current engine, tests, latest CLAUDE.md and explicit owner decisions. Do not change rules solely to match an old video. Review actual examples of forced opening, after-deal pose passing, Cut Throat bruk, blocked ties, key wins, French doubles/penalties, and Across ownership. Preserve Practice-only live teaching; competitive Lounge receives no tactical coach. Post-hand review and free deal verification remain useful advantages.

Then verify group joining, refresh/rejoin, intermittent network, voice permission refusal, actual mute/leave behavior and seating queues with separate real clients. Test themed tournament substitutions before promoting them; current CLAUDE.md records an unresolved seat-assignment issue. Historical memory entries may already have been fixed: inspect before classifying anything as missing.

Growth follows reliability: pilot with several existing groups including older players; host recurring game nights; measure join completion, full-set completion, return of the same groups, support questions and reconnect success. Referrals, voice, tournaments and friends are foundations to verify/improve, not automatically missing features. No outreach or event scheduling is authorized by this document alone.

## Work tracker

Status values: TODO, IN PROGRESS, BLOCKED, DONE. DONE requires linked evidence, not a promise.

| ID | Work | Status | Completion evidence / gate |
|---|---|---|---|
| P0 | Consolidate decisions, authorization, instruction pointers and handoff | DONE | This file; project memory and instruction updates dated 2026-09-12 |
| P1 | Fresh baseline and complete interaction map | IN PROGRESS | Practice baseline and active/select/exit states captured at ~1265×712; real Lounge and failure/reconnect states remain |
| P2 | Before/after mockup and clickable interaction prototype | CANCELLED | Owner said “no mockup, just fix”; direct implementation supersedes this gate |
| P3 | Integrate layout and coordinated interaction states | IN PROGRESS | Desktop corner identities, protected rack lanes, hand cue, selection contrast, right rail, and exit confirmation implemented in both builders; real Lounge visual check remains |
| P4 | Automated and browser geometry/accessibility checks | IN PROGRESS | 445 tests, typecheck and production build pass; Practice active/select/exit visually checked at ~1265×712; viewport matrix remains |
| P5 | Authenticity and real-client reliability pilot | TODO | Experienced player feedback; four-client results; per-mode rules cases |
| P6 | Group retention and differentiation improvements | TODO | Prioritized pilot findings; invitations/trust/learning metrics; no unsupported superiority claims |

### Verification matrix

- Desktop: current problematic ~1265×712, 1366×768, 1440×900, 1920×1080; include 1368×1200 and 2056×1170 from existing gates.
- Phone: 360×780, 390×844, short 320×568; verify readable French pan behavior rather than forcing all tiles into view.
- Both Practice and real Lounge; fresh deal, selected tile, multiple destinations, pending/rejected action, dense hand, round end, reconnect, leave/cancel.
- Cover legal 7-, 9-, 14-bone deals and supported modes without inventing impossible fixtures. Use engine-produced fixtures for automated tests; actual live rendering consumes real game state.
- Geometry: constant hand/board size, correct doubles/pips/joins, no hidden/clipped endpoints, no overlap with protected stations or hand, correct viewer-relative French arms, preview equals placement.
- Run `npm test`, `npm run typecheck`, `npm run build` for implementation. Record exact outcomes and outstanding failures; neither shared code nor a passing build substitutes for browser checks.
- First-time/older-player tasks: identify turn, choose/play at intended end, pass, understand timeout/error, leave and cancel, locate chat/mute. Record confusion and fix it before calling the interaction complete.

## Instruction conflict register

| Older instruction | Decision |
|---|---|
| Desktop Lounge social tools must be below table | Superseded: right sidebar on desktop; deliberate phone adaptation |
| All opponent identities must sit inside translucent enclosed edge stations | Superseded: clear corner photos with associated edge hands and protected space |
| Tiny medallion portraits / detached repeated cards | Superseded by substantial recognizable corner identities |
| Separate floating play prompt | Superseded by steady hand highlight and compact embedded label; timer retained |
| No modal ever during a live hand | Unrelated popups remain prohibited; explicit user-requested leave confirmation is permitted |
| Old sporting/tie escalation/Cut Throat length/French-unbuilt descriptions | Historical: consult current engine/tests and latest owner-confirmed CLAUDE.md; do not restore old behavior |
| Earlier chat demands a literal square or copies fixed route arrays | Rejected as an implementation prescription; measure real rectangular guards and preserve validated routing |
| Full board visible on every phone even if bones shrink | Preserve newer readable-phone exception; desktop full-visibility target remains |

## Session log and next action

2026-09-13 — Reference-led revision approved and implementation started.
Shared `stationTurnCue` now coordinates the active rack with its corner
identity in Practice and Lounge. A steady green field and mango outline paint
the rack itself, including desktop where the station uses display:contents.
The desktop “Playing” label reserves a 16px line even when inactive; phones
keep their compact layout. Existing routing, rules, privacy and working-tree
changes were preserved.

Evidence: Practice Partner at 1280×720 showed the right rack highlighted with
the matching “Playing” portrait; labels became invisible on the local turn.
Selected 2-4 and committed through the left-end control. At 390×844 the next
opponent rack painted rgb(0,122,62), labels were display:none and document
width was 375px (no horizontal overflow). The phone was scrolled during play;
this is not a full-screen-visibility pass. Restored desktop preview afterwards.
Tests passed 462/462; typecheck, production build and diff whitespace check
passed. Real Lounge and the full acceptance matrix remain unverified. No
commit or deployment performed by this pass.

**Next action:** remove redundant desktop count summaries while preserving
phone identification; verify full visible hands and station guards at the
revised viewport matrix. Existing vertical scrolling remains to resolve.
Validate real Lounge with independent authenticated clients before marking
shared table parity complete.

2026-09-12 — Direct implementation began after the owner cancelled the mockup. Changed `main.ts`, `onlinetable.ts`, `onlinetableview.ts`, `render.ts`, `styles.css`, and added `table-experience.ts`. Practice now shows four large corner identities, separate side-rack lanes, equal-size hand/played bones, steady active-hand cue, distinct selected bone, explicit end choice, and a descriptive leave confirmation. The side racks were moved inward after the first capture showed portrait overlap. Desktop Practice and Lounge now keep the permanent right rail beside the felt from 901px upward. A linear hand precomputes a fixed 32-column by 22-row route from the measured stage, locking one bone size for the hand and preventing ordinary desktop board/page scrollbars. The stray `Play it?` text was removed: the hand says `Choose where it goes`, and destination controls sit beside the real open ends. Active-seat portrait glow is shared across Practice and Lounge. Across and spectator tables now receive the same measured inner board guard rather than treating the entire felt as an unprotected board/scroll surface. A short landscape/Across stage retains controlled panning unless a measured fit is proven, preventing hidden clipped bones. Lounge blocks tile selection while waiting, and an active Across partner hand receives the same `Choose where it goes` cue. Online leave errors remain recoverable instead of silently tearing down the table. Browser verification at 1440×900 measured document 1440×900 with no page overflow, a 1138×750 felt plus 260px right rail, and a 638×445 board stage with no overflow. At 1024×768, the compact-header correction measured document 1024×768 with scroll position zero and no page overflow; the selected opening pose showed one 108×42px `Play here` target centred in the protected stage, while hand and played bones shared the same 32×64 physical size. Independent code re-review approved the corrected breakpoint, overflow fallback and Lounge/Across coordination. Final gates: `npm test` passed 449/449, `npm run typecheck` passed, `npm run build` passed, and `git diff --check` passed. The 390×844 phone retains deliberate board panning and ordinary page scrolling. No commit was made. Real four-client Lounge, all-mode dense endgames, failure and reconnect states remain open.

2026-09-12 — Follow-up coordination pass addressed the owner's four new
screenshots. The collapsed live-table configuration is now an unmistakable
52px+ `Table settings` control with visible scope and Open/Close state. Board
destination buttons use a solid gold/dark high-contrast palette and a 48px
target, so `Play here` remains readable even when it overlaps an ivory bone.
The no-legal-move state now renders `No matching bone · Pass` directly in the
active hand tray on both Practice and Lounge, instead of extracting Pass to a
bottom-left dock underneath the player's portrait. Lounge history and realtime
callbacks are guarded by a room-session generation and every rendered message
is filtered by `lounge_id`; the panel names its scope (`Table talk · Yard
Gate`). Across now uses one side-by-side two-hand dock on desktop, removes the
unnecessary forced two-row second rack, and restores board height so the one
shared board/hand bone token stays readable. The compact two-hand structure is
also present in the otherwise online-only Practice branch for future parity.
Focused regression tests and typecheck pass. Browser checks confirmed the
settings disclosure at 255×75 on a 348px viewport, the live chat scope label,
a 1440×900 Across spectator board using 32×64 bones with no horizontal page
overflow, and a solid gold `Play here` control with dark text. Full gates and
production deployment follow. No commit was made.

2026-09-12 — Readability refinement from the next owner review: destination
choices no longer paint a large `Play here` pill over the bone. They retain a
transparent 48px yellow-ring target and a directional arrow; the full action
instruction remains in the accessible label. The desktop turn clock is now a
compact top-edge status pill, preserving the numeric countdown and urgent bar
while returning vertical room to the table. Across's desktop minimum is 22
renderer units (44px short side), applied to the played chain and both active
hands through the shared token. The first attempt forced a lane of at least 64
units; live captures proved that could exceed the protected felt and hide the
far end. That rule is superseded by the measured route below. Full automated
gates still pass. The browser
auto-review/usage gate prevented a fresh localhost capture during this pass;
the prior local measurements remain valid for the unchanged setup/chat/pass
surfaces. No commit was made.

Next AI: preserve the direct implementation and continue from P3/P4. Finish
the full test/build gates and production verification, then show the owner the
running result before any commit. Do not commit until the owner explicitly
approves it.

2026-09-12 — Across clipping root-cause correction. Live early-, middle- and
late-hand captures showed the right endpoint alternately clipped even though
the wood had unused vertical room. The board was not short of total area: its
route calculation divided the measured width by the 22px minimum unit instead
of the actual locked 22–32px unit, then forced a 64-unit minimum. That could
request 1,408–2,048px of route inside a narrower guarded stage. Across now
uses a safe 32-unit first-paint route, then derives the stable measured lane
from `floor(protected width / actual locked unit) - 2`. This preserves one
physical bone size, leaves one half-bone of clearance at both ends, and turns
earlier into the otherwise unused lower felt instead of clipping, shrinking or
adding page height. A new 300-case full-hand geometry gate covers 44px and
64px bones at narrow, ordinary and wide protected widths. `npm test` passes
456/456. Typecheck/build and live visual acceptance remain before owner
approval; no commit was made.

2026-09-12 — Across interaction stability and score-strip follow-up. The two
controlled hands now keep permanent slots (primary left, partner right), so a
turn change only changes colour, wording and controls. Across also disables
hover/selection lift transforms inside those trays. Non-French tables restore
six compact score lamps in the pinned strip: grey at love and yellow for earned
points; French stays numeric. A live phone check confirmed that the lamps fit
above the felt without covering the board or hand. Full automated gates pass;
desktop Across visual acceptance remains with the owner. No commit was made.

Documentation-session validation: `git diff --check` passed; `npm run typecheck` passed; `npm test` passed all 445 tests (0 failures). These checks establish the current baseline, not completion of the proposed UI. No build or new multiplayer/browser acceptance run was performed for this documentation-only change.

2026-09-12 — Across full-hand overflow correction. The ordinary desktop Lounge
breakpoint no longer spends 280px of the board on the social rail: until the
screen is genuinely wide, the rail follows the Across felt. The felt receives
a stable 560px desktop floor, while the route remains capped to the visible
camera and the selected-end target is clamped inside that camera. This keeps
full-size bones and both endpoints visible as a hand grows instead of allowing
the line to become a clipped single strip. The regression fixture now covers a
1,200×560 complete-hand board across 200 deterministic deals. `npm test` passes
457/457, `npm run typecheck` and `npm run build` pass, and no commit was made.

2026-09-12 — Live-room width correction. The side social rail was still taking
space from ordinary Lounge boards, not only Across. At 901–1699px the live
table now owns the full content width and the rail follows below it; the felt
gets a 520px floor (560px for Across). This preserves readable playing bones
and keeps the room visually centred instead of making seat placement determine
tile size. No commit was made.

Owner correction: the full-width-below-rail experiment was rejected. Practice
and Lounge restore the established side stations/side rail composition. The
remaining Across work must use a dedicated longer room while preserving those
side placements; do not move the table into the navigation/front chrome.

## Across rebuild — approved direction (2026-09-12)

The latest owner captures show the generic `layoutLine()` snake is not a
usable Across table: late rows become visually scattered, the felt is too
short, and a selected-bone state can expose the lower route outside the stage.
Do not solve this with another arbitrary lane constant.

Implementation order:

1. Give Across a dedicated full-width room geometry. Measure the felt after
   mount, reserve all four portrait/rack exclusion zones and the two-hand dock,
   and make the usable board rectangle explicit before routing any tile.
2. Add a pure `layoutAcrossLine()` route with deterministic lanes and bounded
   elbows. It must use the available width first, keep rows balanced around the
   centre, and return route bounds plus endpoint coordinates for arrow targets.
3. Choose one physical bone unit from the measured rectangle before the first
   play. Lock that unit by hand id and viewport; adding a tile, selecting a
   tile, showing Pass, or showing an arrow may never change it.
4. If the complete chain exceeds the rectangle, extend/pan the internal board
   camera. Never clip a tile and never shrink the board or either hand to make
   the route fit.
5. Keep both Across hands at the routed board unit. Highlight only the active
   hand; the other remains equally readable and never falls back to `.sm` tiles.
   The primary hand owns the left slot and the partner hand owns the right slot
   for the entire hand. Turn, selection and sending states may change colour,
   copy and controls, but may not reorder, lift, scale or animate either panel.
6. Validate at 390, 768, 1024, 1280, 1440 and 1920 widths through opening,
   10-tile, 20-tile and full-chain states, including two-end choices and the
   sending state. Acceptance requires zero clipped bones, zero unit changes,
   no page-level horizontal scroll and no overlap with hands or portraits.

2026-09-12 — Across dedicated-table implementation. Across now reclaims the
space beneath the old external hand trays: both controlled hands live on the
wood at fixed top- and bottom-centre stations, while all four player identities
remain at the table sides. The wood extends vertically without changing when a
turn begins or a bone is selected. Destination choices are mirrored beside the
active hand with 44px touch targets, while transparent endpoint arrows remain
on the board; either legal end stays available. Missing human portraits use the
neutral avatar instead of leaving an empty station. The mobile chat launcher is
hidden during an active turn so it cannot cover a hand, Pass, or an end choice.
Lounge chat now starts empty on each lounge entry and only accepts messages for
the current lounge/session, so stale room chatter is not replayed after leaving.
Live browser checks passed at 1440×900, 1024×768 and 390×844 with fixed-size
bones, no page-level horizontal overflow, visible identities and unobstructed
two-end controls. `npm test` passes 458/458, `npm run typecheck`, `npm run build`
and `git diff --check` pass. Production release remains the final step.

2026-09-12 — Owner clarified the Across product decision: reuse the proven
Open Hand furniture and routing, with Across's only applicable difference being
that the player's side may play either private hand. Removed the turn-swapping
two-hand dock from the Lounge builder and matched Practice's Across view to the
same companion-hand composition. The route now has an explicit Across entry
point and the old Practice width bug (a 64-unit lane that exceeded its measured
stage) is gone. Across rooms receive a taller felt so a fixed readable bone is
never traded for clipping. `npm test` passes 459/459, typecheck/build pass, and
`git diff --check` passes. Production deployment is still intentionally pending
until the owner reviews this revised composition.

2026-09-13 — French on phones routes inside the phone's own width. The owner's
iPhone screenshot of a live French Lounge table showed pieces of the cross
"floating": the 450×390 desktop reference route is 420px wide at the readable
28px phone bone, against a 290-320px stage, and every arm turned in columns
that fell off the screen. `phoneCrossRoute()` now gives each arm one pinwheel
quarter (first bone towards its opener, then rows back and forth growing away
from the chucha, one unit of felt between arms, a straight column when a band
is too narrow for another row). Both builders measure the stage once per hand
(`lastFrenchFitKey`), because re-measuring after a long arm panned let a
scrollbar narrow the stage and re-routed every played bone mid-hand. Desktop
keeps the reference route unchanged.
Evidence (local production build, Practice French, played to 17-18 bones):
430×932 grid 20×33, 0 bones off any edge, no pan; 390×844 grid 18×31, 0 off,
no pan; 360×780 grid 14×32 locked for all 88 samples, 0 off the side, vertical
pan only (≤2 bones out of view); 1440×900 reference route, 36px, 0 off, no pan.
Bone short side 28px on every phone. 2,000 simulated French hands: an arm
reaches 6 bones p50, 9 p95, 14 max. `npm test` 461/461 (also 461/461 with only
this change applied to HEAD), typecheck and build pass.
Not verified: a real Lounge French table (the email gate blocks the test
accounts) and a physical phone. Pre-existing, unchanged: at 360×780 the hand
can sit below the fold on some renders.

2026-09-13 — Practice mobile refinement and Android paint-cost pass. The owner
asked for the simpler, compact JamDom-style Practice table shown in supplied
reference captures, while explicitly leaving Lounge composition alone. Normal
Practice felt now uses `clamp(480px, 80svh, 710px)` on phones (Lounge remains
at its existing height; French keeps its taller cross rule). The routed board
stage remains internally pannable, so this reclaims empty opening space without
restoring clipped late dominoes. The former high-frequency ruled wood layers
were replaced with three broad, subdued colour layers that read as a quieter,
more natural wood surface. On phone Practice only, expensive station backdrop
blurs, rack filters and heavier rack shadows are removed; geometry, bone size,
turn signal and Lounge styling are unchanged.

Practice now offers eight locally bundled, persisted face choices before a
deal, with the prompt “Choose any face. No account needed.” It does not ask a
guest to select a gender. The selected face appears at the player station.
The `Duppy speed` selector now sits inside the Practice hand tray and changes
the Duppies' next thinking interval immediately; Practice has no player turn
clock, so none was invented. Local preview accessibility inspection confirmed
the eight-choice face picker. `npm test` passes 462/462, `npm run typecheck`,
`npm run build` and `git diff --check` pass.

Open acceptance: inspect normal Practice at 360×780 and 390×844 through a
dense 18+ bone chain on a physical Android device, including vertical board
pan and the in-tray speed select. A local preview refresh dropped the browser
automation's original localhost tab, so no Lounge email/test-account entry was
marked verified; the user authorized a test email, and real-Lounge navigation,
keyboard behavior and independent-client checks remain required. Continue to
keep the no-cutoff constraint on every table-height or station change.

2026-09-13 — Physical-phone preview enabled for the owner on the current home
network: Vite is deliberately running with `--host 0.0.0.0` and confirmed to
respond at `http://10.0.0.176:5173/`. `localhost`/`127.0.0.1` only describe the
phone itself when entered on a phone, so they cannot reach the developer Mac.
The phone must use the network URL while it and the Mac are on the same Wi-Fi;
this is a temporary local QA server, not deployment. Use it for the remaining
360/390 and Android responsiveness acceptance cases above.

2026-09-13 — Local phone QA defect corrected. Practice could load at the LAN
HTTP address but Deal failed before tiles were created: `crypto.subtle.digest`
is intentionally unavailable to a phone on an insecure origin, and the fair
shuffle commitment must never fall back to weaker browser code. Vite now reads
an ignored `.local/` certificate/key pair when present; normal developer use
and production build configuration are unaffected. A seven-day local
certificate with the current LAN IP as a subject alternative name was created
outside version control, and the active QA server is `https://10.0.0.176:5173/`.
The owner must accept the one-time browser warning for this self-signed local
certificate. HTTPS endpoint response, typecheck, production build and
`git diff --check` passed. Re-test Deal on physical Android before marking the
phone acceptance cell complete.

2026-09-13 — Owner clarified mobile Practice information hierarchy: do not
leave the full “who passed / who has what” teaching strip permanently under
the table. Desktop keeps its at-table rail. On phones, a `Table notes` button
now reveals or hides the existing Practice seat cards, pass facts and table
talk; starting a new game closes it again. The existing `Read` coaching control
remains available and unchanged. This preserves teaching rather than removing
it, while returning the default mobile view to board, score and controlled
hand.

Next Practice interaction: implement a short, skippable/reduced-motion-aware
deal reveal on the wood — shuffled face-down bones and YaadDominoes mark,
followed by the committed deal. At hand end, the result/review keeps the
existing truthful remaining-hand and fair-deal information available. Do not
use the competitor name, copy its artwork, delay a legal hand unnecessarily,
or expose any Duppy tile before the deal. Validate that an interrupted/failed
shuffle still produces one committed hand and that Talk/Read/Table notes remain
reachable at 360 and 390 widths.

2026-09-13 — Owner correction: leave the existing mobile Practice teaching,
full-play replay, coaching and fair-deal features where they are for now; do
not substitute a new “Table notes” control for them. That temporary control
was removed before release. The requested mobile layout defect was independent
of teaching: flank stations stacked a face above its rack near the top of the
wood. Reviewed the owner-provided WhatsApp recording
`/Users/higgi/Downloads/WhatsApp Video 2026-07-28 at 23.33.51.mp4`; its
perimeter racks stay centred on their physical sides while the live chain
forms a connected S. Practice phone stations now place a 28px face beside a
vertical face-down rack, centred halfway down each side. Existing route logic,
hand scale and no-cutoff pan behavior were not altered. `npm test` 462/462,
typecheck, production build and `git diff --check` pass. Physical 360/390
verification remains open.

2026-09-13 — Mobile Practice teaching and identities were refined again from
owner review. The default phone view now keeps the board and controlled hand
clear. `Table reads & teaching`, directly below the felt, is a native
expandable section containing the existing pass/player facts and the existing
live-table read control; it is not a replacement for post-hand Watch it back,
Coach, or fair-deal verification. Desktop keeps its direct Practice rail, and
Lounge is unchanged. A previous generic phone density rule was making the
side Duppy portraits 22px and applying the Practice side-station treatment to
Lounge. Practice side faces are now protected 40px medallions beside their
centred vertical racks, while Lounge retains its prior compact geometry. The
chosen guest face is now visibly placed in the phone hand-tray header, beside
the turn label and Duppy-speed control, instead of being hidden by the
desktop-only identity rule. Guest choice remains local and account-free; a
saved Practice choice appears consistently on that device. Account-profile
avatar adoption in offline Practice is a separate enhancement because Practice
does not load the social/auth bundle by design. `npm test` passes 462/462,
`npm run typecheck`, `npm run build`, and `git diff --check` pass. Still test
the final composition on physical 360px and 390px phones through a dense
chain before closing acceptance.

2026-09-13 — Practice hand-end clarity pass. Once a local hand completes,
the result panel now shows every seat's actual remaining tiles and count, so
a player can see exactly what was held on an ordinary win or blocked board.
The pose target now has an opaque green/high-contrast treatment and a brighter
gold opening state. Phone Practice side Duppy portraits now use a narrow,
tall 32×58px capsule above their centred rack: the face remains readable while
the central board pays only 32px of width per flank. The owner has specified a
further route requirement for standard play: anchor the pose and expand the
two ends through a full-field perimeter S, so a tile's physical field does not
shift after a later move. Do not approximate this by merely changing the
current compact row snake: it needs a hand-keyed, two-ended route cache and
must be acceptance-tested through a near-played-out hand at 360/390 before it
replaces the existing proven layout.

2026-09-13 — Standard Practice route now reconstructs from `moveLog`, rather
than recalculating from the current left-to-right board array. The pose stays
anchored; left-end plays take two horizontal bones left, climb toward the top
edge and cross, while right-end plays take two right, descend and cross back.
This is the owner-confirmed perimeter-S direction from the supplied WhatsApp
example. Bone sizing remains governed by the existing fixed live-table token.
Typecheck and 462 tests pass; physical 360/390 dense-hand visual acceptance is
still required before the route is considered final.

2026-09-13 — Route correction after physical-phone failure. The first
move-history implementation was rejected from the owner's capture: it used
two fixed horizontal slots, produced disconnected vertical columns, and made
the board read smaller. That implementation was removed. The WhatsApp video
was reviewed again at opening, middle and late-hand frames. The confirmed
pattern fills the centre horizontal line toward both rails first; the left
end then climbs and crosses the top, while the right end descends and crosses
the bottom. The replacement uses two independent endpoint cursors on one
fixed full-table grid, advances by each bone's real footprint, keeps doubles
crosswise, and rotates each cursor only when the next bone reaches its rail.
The pose therefore retains the same grid cell as either end grows. Standard
phone Practice now keeps a 32px short side (up from 28px), and side stations
may straddle the rim instead of narrowing the chain's measured stage. Endpoint
controls continue to attach to the actual first/last rendered bones. A new
route regression test verifies the anchored pose and opposite top/bottom
turns; 463 tests and typecheck pass. Automated browser capture was attempted,
but the local headless Chromium process could not produce an artifact in this
host session; physical 390px owner review remains the acceptance gate.

2026-09-14 — Mobile Practice precision pass from the owner's latest physical
capture and the downloaded WhatsApp reference. Every 90-degree route turn now
offsets its exposed join by one half-bone instead of reusing the preceding
bone's centreline. Crosswise doubles receive their full four-unit elbow
clearance. Regression coverage checks that ordinary bones and doubles remain
inside the fixed route without covering one another. The right arm now turns
left after exactly two bones in its downward leg, as explicitly requested;
the left arm still climbs toward the top before crossing. Standard mobile
Practice bones increased from a 32px to a fixed 36px short side. Lounge and
French geometry were not changed.

The pale self-play label that appeared beneath the local hand was removed;
opponent play labels remain associated with opponent stations. The phone hand
header is more compact while preserving the chosen self face, turn text and
Duppy speed. A roughly two-second, skippable Practice opening now shuffles
face-down bones over the YaadDominoes mark and sends all 28 bones to the four
seats one at a time. It uses transform/opacity only, has a reduced-motion path,
removes itself after dealing, and also runs for Next hand. End-hand remaining
tile reveal and the expandable teaching section remain intact.

Verification: `npm test` passes 465/465, including new S-route elbow/double,
self-label and sequential-deal checks; `npm run typecheck`, production build
and `git diff --check` pass. After the owner granted browser-launch permission,
an automated 390×844 HTTPS pass verified the live shuffle overlay, sequential
flights, compact selected-face/turn/speed header, complete seven-bone hand and
unobstructed opening table. Captures: `/private/tmp/yard-mobile-dealing.png`
and `/private/tmp/yard-mobile-table.png`. Exact next action: play densely on a
physical phone and inspect the upper-left, upper-right and lower-right elbows
plus both destination arrows.

2026-09-14 — Wi-Fi QA address changed. The Mac is now `192.168.1.221`; the
ignored seven-day local certificate was regenerated with that IP in its SAN,
the old server was stopped, and Vite was restarted on `0.0.0.0:5173`.
`https://192.168.1.221:5173/` returns HTTP 200. The phone must be on the same
Wi-Fi and accept the new self-signed certificate warning once. The former
`10.0.0.176` address is stale on this network.

2026-09-14 — Owner rejected the first shuffle timing and reported a specific
4-4 → 4-1 route defect from physical iPhone capture
`/private/tmp/yard-mobile-route-failure.png`. The WhatsApp reference was timed
again frame by frame: its branded shuffle holds for roughly three seconds,
then concealed bones visibly accumulate at the four hands. The replacement
uses a 3.2-second circular 14-bone shuffle followed by a 28-bone round-robin
deal at 165ms intervals. Dealt backs remain at each recipient rack until the
real hand is revealed. Total presentation is about 8.3 seconds, aligned with
the existing 8.53-second real-domino shuffle recording. Sound and visible
motion now start in the same render beat. `LocalGame.startHand()` awaits the
presentation hook before running opening Duppy moves, so no bone can be posed
behind or before the deal. Skip and reduced-motion paths remain available.

The route now remembers whether the preceding bone was a crosswise double. A
turn after a double leaves from that double's physical centre and advances to
its outside edge; it no longer uses the ordinary half-bone elbow offset. The
reported 4-4 → 4-1 sequence has a dedicated regression asserting equal
centrelines, one exact touching edge and zero overlap. On mobile Practice the
felt now spends the app's 16px side padding, placing its outer border at the
phone rim, and the board stage may use that full width. Lounge remains
unchanged.

Automated 390×844 HTTPS captures verified the circular shuffle, partially
filled destination racks during dealing and the final full-width opening:
`/private/tmp/yard-mobile-shuffling.png`,
`/private/tmp/yard-mobile-dealing.png`, and
`/private/tmp/yard-mobile-table.png`. `npm test` passes 466/466; typecheck,
production build and `git diff --check` pass. Remaining acceptance: refresh
and physically replay through the reported double-turn plus a dense S route.

2026-09-14 — Owner-approved follow-up from two physical iPhone captures. Deal
destinations moved inside the visible wood, so the round-robin animation now
shows all four recipients: bottom, right, top and left. The 390×844 browser
capture `/private/tmp/yard-mobile-dealing.png` shows bones accumulating at all
four racks. Practice Voice Off is now a master quiet control: switching it off
also switches off table effects, including Duppy calls such as “Tek dat” and
“Yuh nuh have none”; Table sound can still be adjusted separately while voice
is on.

The standard two-ended route now reserves separate upper and lower fields.
After the left opening reaches its rail, exactly three complete bones climb
before it crosses; later upper bands continue away from the pose. The right
opening drops two bones, crosses back, then turns downward again as requested,
with later bands continuing away from the centre. All eight turn combinations
apply half-bone or crosswise-double clearance before the next placement. The
fixed route height is shared by layout and renderer, and a redraw focuses the
real latest move from `moveLog` instead of a short-lived speech label. Mobile
Practice also keeps its 36px short side during the measured refit; it pans the
large fixed route rather than shrinking the bones.

Verification added an all-27-play dense route assertion and exercised 84,000
synthetic full-hand distributions with up to seven doubles without an overlap
or out-of-bounds placement. A real automated 390×844 Practice hand rendered
21–23 bones at the full size with clean joins; the stable capture is
`/private/tmp/yard-mobile-route-final.png`. The end screen also revealed every
remaining player's actual bones, including a tied blocked hand. Exact resume
point: owner physical-phone acceptance of the full-size scroll/pan and both
late turns; after that, return to the desktop/mobile acceptance matrix and
Android performance pass.

Final gate for this pass: 469/469 tests, client typecheck, production build and
`git diff --check` pass. A separate 390px interaction check confirms one tap
on Voice On changes both controls to Voice Off and Table sound Off. The active
same-Wi-Fi test address remains `https://192.168.1.221:5173/`.

2026-09-14 — Owner screen recording exposed a complete-table camera failure
that isolated route assertions did not catch: after the opening bone was
placed, a redraw could leave the tall fixed grid at its origin, showing empty
wood while the legal bone sat outside the viewport. `keepTileInView()` now
uses the tile's stable grid offset, centres the latest move directly, clamps
to the stage's scroll range, and settles in one frame. This keeps the opening
pose and every later turn visible while preserving fixed logical coordinates;
it also survives speech-label expiry, speed changes and teaching redraws.

The owner recording is now an explicit acceptance fixture for the next
physical pass: opening pose, first arrow choice, first committed double,
three-bone left rise, right drop/return, dense hand and post-hand reveal must
all be inspected as one continuous table. Browser launch permission is
currently unavailable because the host usage limit was reached, so this camera
correction was verified through source tests, 469/469 full tests, typecheck,
production build and diff check. Resume point: replay the same capture on the
physical phone before launch sign-off.

2026-09-14 — Follow-up recording showed that centring each newly played bone
still made the stationary route look as if it was moving. The Practice camera
now anchors once on the posed bone and never follows later plays. All route
coordinates remain fixed: the centre stays centred, the left arm rises three
bones then crosses, and the right arm drops, crosses back and drops again.
Manual scrolling remains available for a long hand, but no redraw, Duppy turn,
speech expiry, speed change or teaching toggle changes the viewport by itself.
The recording’s opening pose and first committed double are now explicit
acceptance checks alongside the dense-hand overlap checks.

2026-09-14 — Mobile Practice rebuilt as the JamDom phone app (Claude, taking
over from the ChatGPT handoff). Scope confirmed by the owner: mobile Practice
first; Lounge and desktop untouched. Owner decisions this session: the whole
board visible with nothing moving; a big hand about twice the board bone, like
the JamDom app (measured on the owner's screenshot: board 58px, hand 110px on a
945px screen); the wood filling the screen under a thin score strip.

Root cause of the recording: the previous route drew a 106-row grid (real hands
use 43-54 rows) with the pose 48 rows down, inside a board stage that scrolled
and a camera that re-anchored; a thumb on the board scrolled it. A non-double
pose (any later hand) was also placed so the first bones covered it.

Implemented: `layoutPhoneRoute()`/`phoneRouteArm()` in layout.ts (pose centred;
left rises exactly 3 then crosses right; right drops exactly 2, crosses back,
then turns down; later turns one bone; exact edge-to-edge joins including 4-4
into 4-1; placement depends only on each end's own move order). Height from
`phoneRouteRows()`, a worst-case table from an adversarial double search.
`phonePracticeGeometry()` picks the largest board bone that fits ANY hand;
main.ts measures until the pose, then locks grid, stage inset and pinned
offset per hand. Board stage `overflow: hidden; touch-action: none`, played
bones `pointer-events: none`, no tray end-choice row on the fixed board. Hand
columns shrink evenly to fit the tray. Duppy loop is single-flight and never
plays a move into a replaced hand (a pose during the deal animation had thrown
"not seat 2's turn"); taps are blocked during the deal.

Evidence (local production build, automated full hands at Quick pace):
390×844 — 18px board, 44px hand, 25 bones, zero movement or overflow while
live, arrows 22px from their open end, table bottom 844, 4 hands revealed.
360×780 — 18px board, 40px hand, 23 bones, same results. Tapping and dragging a
played bone changed nothing; forced scroll stayed 0. Deal animation: 28 bones,
bottom→right→top→left, 7 each. Voice Off silences speech and table effects.
`npm test` 474/474, typecheck, build, `git diff --check` pass.

Open: one shift of the whole board when the result screen replaces a finished
hand (after play ends; likely the winning-bone slam). Real Safari has less
height than the automated viewport, so the phone board bone will be smaller
there (about 16px on a 390px iPhone); physical-phone acceptance by the owner is
the resume point. Desktop and Lounge were not re-verified because they were out
of scope and unchanged. Nothing committed: the tree still carries the ChatGPT
session's uncommitted changes, which the owner has not reviewed.

2026-09-14 (later) — SUPERSEDES the fixed centred-grid entry above. The owner
said the 18px board bones were far too small and pointed at the WhatsApp video:
the line crosses the table, then goes all the way to the top. The phone route is
now a whole-table spiral (`phoneRouteRects`, `phoneRouteFits`,
`layoutPhoneRoute` in layout.ts; `phonePracticeGeometry` in render.ts); the
worst-case row table and big-hand layout are gone. The hand is about 15% bigger
than the board bone. Measured at 390×844: board 22px (grid 24×52 on a 277×574
stage), hand 25px, 25 bones, nothing moved or hid, 4 hands revealed. Owner
verdict: still wastes space, bones must be bigger. Resume point: reclaim width
from the side stations (they cost ~113px of 390) and size against the whole
table rather than 18 bones per half; then physical-phone acceptance. Nothing is
committed; production is still f494e28 (v136).

2026-09-14 (diagnostic) — The owner reported the latest screen as unacceptable;
the in-app browser currently shows “This site can’t be reached” at
`http://localhost:5173/`. A stale Vite process (PID 21145) still owns that port
but is not serving a reachable page. Static implementation checks remain green,
but visual acceptance is blocked until the local dev server is restarted.
Resume point: restart the server, reload Practice, then inspect the actual 360px
and 390px screens before any further styling decision.

2026-09-14 (big bones) — SUPERSEDES the whole-table spiral entry above. The
owner, with a second AI's comparison against JamDom, asked for much bigger
bones on the whole wood, flush joins, crisp pips, hand = board size, doubles
always across the line (a 3-3 had been laid along the end bone at a corner),
and the players and own tray kept where they are.

Measured cause of the wasted wood: rows stop about one bone short of every
edge (whole bone lengths), the stage was cut to the strip between the side
stations (304 of 376px), and the spiral walled long ends in against those
stations. Four-seat Practice hands (engine simulation, random legal play): at
most 24 plays; longest end 12 typical, 19 at the 99.9th percentile, 21 max.

Implemented: stage = whole felt above the tray (CSS inset 6px), stations passed
as blocked rectangles; route snakes outward in rows at pitch 4; corner doubles
stand across the incoming line; sizing by a generated corpus of the 400 hardest
of 20,000 hands with a tolerance of 20 (≈1 hand in 1,000 overflows; checked
against a fresh 20,000: 15), and a one-size-smaller relayout for such a hand;
Pass moves into the tray header on phones (it had rendered below the screen and
scrolled the table); pace label no longer clipped.

Evidence (dev server, Playwright touch taps, no auto-scroll): 390×844 — 28px
board and hand bones, grid 26×44, three hands, zero moves during play, zero
overlaps (only the winning-bone slam and the domino "shake" animate), no bone
under a player or the tray, Pass at y 718–767. 360×780 — 24px bones, 27×46,
two hands, same results. Forced fallback (corpus emptied in the page): board
stepped 40→36→34→30→26px as the hand grew and ended clean. `npm test` 476/476,
typecheck, build, `git diff --check` pass.

Open: the result screen's Next hand button sits below the fold (y≈1500) — a
pre-existing flow, untouched. Real Safari height is smaller than the automated
viewport, so the phone bone may be one size smaller there. Rows cluster around
the centre in short hands (the cost of holding long ones at this size); owner
to judge on the phone. Nothing committed; production is still f494e28 (v136);
bump sw.js VERSION before any deploy. Resume point: owner review on the phone
at https://192.168.1.221:5173/?practice=1.

2026-09-14 (row spacing, L doubles) — Owner, with phone screenshots: rows were
squashed by one-bone climbs, and a 5-5 on a turn was docked at its waist. Each
climb is now at least two bones (three when the same bone still fits), and a
double on a turn makes the JamDom L: past the end of the line, one half level
with it, the other half out into the turn, the line continuing from that half.
Cost, measured with the corpus: bones at 430px stay 28px; 390px drops 28→24px;
360px 24→22px. Tests rewritten for both rules; 476/476, typecheck, build pass.

2026-09-14 (size first) — Owner: the two-bone-climb build looked "smaller than
before" (it cost a size step: 430×800 went 26→22px). Size is now chosen first;
at that size each end's first climb is two bones where it fits, otherwise one.
Measured: 430×800 26px with a two-bone first climb; 430×740 24px; 390×700
22px; taller viewports (430×932 32px, 390×844 28px, 360×780 24px) keep full
size with one-bone climbs. Played a hand at 430×800: no move during play.

2026-09-14 (consistent climbs) — Owner: one game climbed two dominoes, the next
only one. Causes, traced over 2,000 simulated hands: the first-climb-only rule
(later climbs were one domino by design); climbs measured in height, so a
crosswise double (half a domino tall) added a third domino and a corner double
made the next climb look like one. Asked to choose between size and spacing,
the owner said: two dominoes no matter what, same bone size. Now every climb is
two full dominoes (doubles extra), bone size chosen as before. A climb turns
early only where the partner's rack (325 of 573 blocked hands) or the top (177)
or bottom (70) edge stops it; forbidding that raised mid-hand resizes to 15-23%
of hands. Resize rate with the exception: 430×800 4.8%, 430×932 2.3%, 390×844
4.6%, 360×780 1.1% (10,000 hands each). New test: every climb in 300 real
hands is two dominoes unless at the table edge. 477/477, typecheck, build pass.

2026-09-14 (French phone pinwheel research) — Owner asked for JamDom's 4-way
clockwise pinwheel on mobile French (arms run out, turn clockwise at the edge;
doubles across each arm) at 28px or larger. Findings, not yet implemented:
the stacked "comb" French layout (`phoneCrossRoute`) is what is LIVE (v136),
not a regression from this session; it also lays doubles in line. It pans in
16-23% of hands on 390/430 phones and nearly all on 360px. A clockwise
pinwheel prototype (.local/qa/pinglobal.ts: arms routed together in play
order, own quarter first, borrowing only when stuck) at 28px on the whole
felt, over 1,500 simulated French hands: players as today 26% (390px) / 25%
(430x800) / 96% (360px) of hands get an arm stuck; top badge off the wood and
side players photo-only 9% / 9% / 76%; nothing on the wood 3% / 3% / 72%.
Arm lengths: 6 typical, 9 at p95, 11 at p99, 14 max. Resume point: owner's
choice between clearing the wood of player badges during French, smaller
French bones, or keeping the comb; deploy stays on hold until French is
settled and the other session's Lounge/Across changes are checked.

2026-09-14 (French phone pinwheel built) — Owner chose JamDom's clockwise
pinwheel at 28px, players as tap-to-open tabs instead of badges on the wood,
and asked for work in the real app rather than prototypes. Built in the app:
`phoneFrenchPinwheel()` (render.ts) lays arms in play order, turns clockwise
at the edge, stands doubles across the arm, makes the L at a turn, keeps arms a
unit apart, and grows a stuck arm past the bottom so nothing already down
moves; `frenchPhoneTab()` (table-experience.ts) collapses each French player
on a phone to a 28px photo with a bones-left badge that opens a small panel;
French phones take the whole felt, with `frenchTabBlocks()` measuring the tabs
against the stage grid before the first arm bone. Also fixed on phones: the
six-second French penalty banner floats instead of pushing the table down 88px
and back, and French's Pass sits in the tray header. Removed mid-hand fallback
to the row route (it re-laid every bone). New `french-phone.test.ts` (6 tests:
first bone towards its player, clockwise turns, crosswise and L doubles,
stationarity, growth past the bottom, 200 real hands at 26x38 with tabs).

Evidence: `npm test` 483/483, typecheck, build, `git diff --check`. Finger-tap
Practice runs, two full French hands each: 390x844 (26x35) and 430x800 (28x32)
had zero board moves, zero on-screen moves, no bone under a tab, no page scroll,
every control on screen, no page errors. 360x780 (24x25) ran an arm out of room
at 20 bones, shifted the board a unit and put bones under a tab, so phones
under 380px keep the row route with the tabs guarded off it. Choosing that by a
measured stage flipped the chucha from the row route to the pinwheel at the
start of a 390px hand, so the choice follows the viewport width. Not yet verified:
a real Lounge French table (needs signed-in players), and the owner's phone.
Nothing committed; production still v136; deploy waits on the other session's
Lounge/Across changes being checked.

2026-09-14 (deployed) — Owner approved going live, including the other
session's Across change (Across laid out like partner/open hand, its own rules
only). Committed `27ce346` on `design/yaaddominoes-foundation`, service worker
v137, deployed with `vercel deploy --prod` from a clean worktree; live
`www.yaaddominoes.com/sw.js` serves v137 and the production deployment
`dpl_BcJsPh2BUqm9Jj4tfgSRnhBooqpW` is Ready. Resume point: owner's real-phone
check of the phone Practice board and French pinwheel; a real Lounge French
and Across table with signed-in players has still not been exercised.

2026-09-14 (Quick play, table opens at the top) — Owner: some players want
JamDom's "Click to Play" feel, and the Practice table did not fit the screen
when a game started. Added Practice Quick play: a "Placing bones" choice in the
lobby, stored as `yard:quick-play`, off by default; when on, a bone with exactly
one legal place plays on one tap and a bone with two places still asks. The
Lounge is unchanged. The table opened scrolled 171px down because reaching
"Deal" (or "Next hand") scrolled the page; every Practice deal now scrolls to
the top. Evidence at 390x844: after "Deal" from a lobby scrolled 1,298px down
the table sits at the top (felt 70-842 on an 855px screen); Quick play off, a
one-place bone only selects; on, it plays on one tap (hand 7 to 6); tests
484/484, typecheck, build. Not yet deployed.

2026-09-14 (French phone: joined bones, readable tabs, steady layout) — Owner
screenshot notes: gaps between French bones, a double in line, a hook after
one bone, no L at a turn, and player counts too small with no sign the tab
opens. The in-line double, the hook and the missing L are the row route,
which phones under 380px (e.g. 375px iPhones) still get; the whole felt gives
a 375px phone 24 columns, too few for a 28px pinwheel. Fixed: French phone
bones meet flush (crisp faces like the partner board); tabs are a 32px photo,
a large bold bones-left badge and a "View" cue; the pinwheel board is
top-aligned so growing past the bottom never moves it, and a bone that cannot
be placed never shifts it down; phones under 380px keep full player badges and
the guarded row route; the width decision uses min(innerWidth, screen.width)
because a page wider than the screen swung `innerWidth` across the cutoff.
Lounge production history, read with `vercel curl`: the partner/open-hand
Across was live only in the Sept 13 01:59 deploy (v134, uploaded from an
uncommitted working folder), was replaced by the four-sided Across at 03:36,
and is live again since `27ce346`. GitHub `origin` was last pushed Sept 10.

Evidence (Practice, finger taps, two full hands each): 430x800 and 390x844
pinwheel with zero board moves, no bone under a tab, no page scroll, no
errors (430 showed only the domino shake at a hand's end); 375x812 row route
for the whole game, nothing moved, no bone under a badge; 360x780 row route,
no bone under a badge, on-screen movement none. Tests 484/484, typecheck.
Resume point: owner approval to deploy; owner's phone check; a real Lounge
French and Across table.

2026-09-14 (375px phones get the pinwheel) — Owner: keep player info off the
table and bring the pinwheel to narrow phones without smaller dominoes. The
French phone board had been measured with the linear line's 18px padding
removed, padding a French board never has; that cost a 375px phone two columns
(24 instead of 26). It now fits the stage's whole inner box and the cutoff is
370px. Bones stay 28px. Evidence, full hands with finger taps: 375x812
pinwheel 26 columns, 390x844 26, 430x800 30, zero board or on-screen moves and
no bone under a tab; 360x780 row route, no bone under a badge. Tests 484/484.
A separate edge strip was not needed at 375: tabs sit at the rim.


2026-09-14 (Game over on the table) — Owner: like JamDom, say game over on
the table with something to tap that takes the player to hands left, or they
will not know the result is below. Practice now shows a GAME OVER (or SET
OVER) card on the felt naming the outcome, with "See hands left & scores" that
scrolls to the result panel and an x to hide it and look at the final board.
Verified by playing hands to the end: partner 375x812 and French 390x844, card
on screen, tap scrolled the result into view, no page errors. Tests 485/485.
Not deployed yet; Lounge tables not changed.

2026-09-15 (French phone opens on the table) — Owner: French Practice on a
phone still opened off the table, the top player needed a scroll, Duppy 3's
bone count hid under the photo, and the count wanted another colour. The
French score panel was 100px (two rows of four players plus tile counts),
which pushed the table past a real iPhone's visible height. French phones now
get a one-strip score bar (four scores in two columns, sky-blue numbers), the
page returns to the top when the eight-second deal animation ends, the bones
badge draws above the photo in sky blue, and the top tab's View cue clears
the turn ring. Measured: 390x664 felt 70-601 (was 116-647), 375x548 felt
70-550 (was 116-596); two full hands at 375 with zero moves, nothing under a
tab. Tests 487/487.

2026-09-15 (JamDom French legs, edge players, desktop pinwheel) — Owner, with a
JamDom table photo: lay French like JamDom (double in the middle, left and
right two bones then turn up and down, up and down three then turn right and
left), hang the players half off the table edge, and perfect desktop Practice
(bottom rows were cut off, a scrollbar sat mid-table, doubles lay inline).
Phone: `FRENCH_PINWHEEL_LEGS`; the owner accepted the simulated trade (about
330 of 400 hands fit cleanly vs 360 for the old full-out legs). Practice phone
tabs now sit half off the rim with vertical View, the count on the photo's
inner side and face-down bones half on the felt; left and right then make
their full two bones. Desktop Practice: `frenchPinwheel` lays the same
pinwheel over the whole felt (inset 12px), steering round corner cards, racks
and the hand (`frenchTabBlocks` selector). Evidence: 390x844 and 375x812 two
hands each, 1440x900 (60x40) and 1280x800 (58x39) full hands, zero board or
on-screen moves, nothing under a player, no errors. Lounge desktop French
still uses the fixed canvas. Not deployed.

2026-09-15 (French: a board pass resets the pass run) — Owner: fined 10 for a
third pass in a row when a board pass sat between the passes. The pass forced
by a board pass is already fined 10 there, so it and every earlier pass no
longer count; the next pass starts a new run of one. `HandState.lastBoardPass`
records the blocking move. Tests: the owner's case (no fine), three plain
passes (still 10), three passes after a board pass (still 10). 491/491. The
Online tables need the play-move and advance-duppy functions redeployed.
