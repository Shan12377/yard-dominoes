# YaadDominoes — living table experience plan

Last updated: 2026-09-12. Status: first real-app desktop implementation is in review; not committed.
Owner: project owner. Execution: whichever AI/developer resumes this file.

## Read first: authorization and resume point

The owner explicitly authorized this consolidated plan, ongoing progress updates, and overriding conflicting CLAUDE.md/project preferences where needed to deliver the agreed table experience. Do not repeatedly request permission for scoped local implementation, mockups, review, or verification already covered here. Preserve Claude's working improvements and existing user edits.

This plan supersedes older local instructions requiring tiny circular identities, enclosed mid-edge player cards, desktop social tools below the table, and redundant floating play prompts. It does not authorize unrelated changes, deployment, external messages, destructive rewrites, changes to payments, or removal of server authority and hidden-hand protections. Record any newly discovered conflict and its resolution below. New explicit owner decisions take precedence; do not interpret “perfection” as permission to invent game rules.

**Resume here:** inspect the uncommitted table-experience changes and the latest session log below. The owner explicitly cancelled the separate mockup and requested direct app work, with the running result shown before any commit. Do not start over or replace the route engine merely to rearrange portraits.

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

## Before → after contract

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
