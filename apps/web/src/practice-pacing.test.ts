import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const localSource = readFileSync(new URL('./local.ts', import.meta.url), 'utf8');
const practiceSource = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
const onlineTableSource = readFileSync(new URL('./onlinetableview.ts', import.meta.url), 'utf8');
// The VIEW is onlinetableview.ts above; this is the CONTROLLER that drives
// turns and talks to the Edge Functions. Two different files, easy to confuse.
const onlineControllerSource = readFileSync(new URL('./onlinetable.ts', import.meta.url), 'utf8');
const renderSource = readFileSync(new URL('./render.ts', import.meta.url), 'utf8');
const loungeViewSource = readFileSync(new URL('./loungeview.ts', import.meta.url), 'utf8');
const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

test('practice Duppies never move faster than 3.5 seconds and pause for the final bone', () => {
  assert.match(localSource, /quick: DUPPY_PACE_SECONDS\.quick \* 1_000/);
  assert.match(localSource, /brisk: DUPPY_PACE_SECONDS\.brisk \* 1_000/);
  assert.match(localSource, /yard: DUPPY_PACE_SECONDS\.yard \* 1_000/);
  assert.match(localSource, /relaxed: DUPPY_PACE_SECONDS\.relaxed \* 1_000/);
  assert.match(localSource, /DUPPY_PACE_MS\[this\.options\.duppyPace\]/);
  // A PASS puts nothing on the board, so it must not cost a full move's beat.
  // Reported on a live French table 2026-09-12 as the game "freezing": French
  // passes heavily during the filling phase (you need a tile carrying the
  // spinner's own value), and at the 7.5s default that was 7.5 seconds of an
  // unchanged board, several turns running. Measured before the fix: 7.5s,
  // 7.3s and 7.5s gaps between board changes, with the worst main-thread block
  // only 92ms -- nothing was stuck, it was waiting.
  //
  // The move is therefore decided BEFORE the beat is chosen, so a pass can be
  // given the quick beat. It keeps a visible beat rather than none: the
  // original 420ms pace let a pass and the answering tile land before a
  // newcomer knew whose turn it was, which is the bug this delay exists for.
  assert.match(localSource, /DUPPY_PASS_PAUSE_MS/);
  assert.match(localSource,
    /const move = duppyMove\(this\.hand, this\.options\.duppy\);[\s\S]{0,300}?setTimeout\([\s\S]{0,160}?move\.kind === 'pass' \? Math\.min\(DUPPY_PASS_PAUSE_MS, pace\) : pace/,
    'the move must be decided before the beat, or a pass cannot be paced differently');
  // ...and the beat must still come before the move is applied, or the board
  // would change and only then wait, which is the 420ms bug inverted.
  // The only thing allowed between the beat and the move is the check that the
  // hand is still the one the move was decided for (leaving or redealing
  // during the pause must not play an old move into a new hand).
  assert.match(localSource,
    /setTimeout\([\s\S]{0,160}?\)\);\s*(?:\/\/[^\n]*\n\s*)*if \(!this\.hand \|\| this\.hand !== decidedOn\) return;\s*this\.hand = applyMove\(this\.hand, move\);/,
    'the beat comes before the move, guarded only by the same-hand check');
  // One Duppy loop at a time: a pose made during the deal animation started a
  // second loop beside startHand's, and the slower one threw "not seat N's
  // turn" and froze the hand (390px Practice run, 2026-09-14).
  assert.match(localSource, /this\.duppyLoop \?\?= this\.duppyTurns\(\)\.finally\(\(\) => \{ this\.duppyLoop = null; \}\);/,
    'a second call joins the Duppy loop already running instead of starting another');
  assert.match(localSource, /DUPPY_LAST_BONE_PAUSE_MS = DUPPY_PACE_SECONDS\.quick \* 1_000/);
  assert.match(localSource,
    /setTimeout\(r, DUPPY_LAST_BONE_PAUSE_MS\)[\s\S]*?this\.finishHand\(\);/);
});

test('practice exposes the same Duppy paces as a live table, from the same source', () => {
  // Both pickers build their options from the engine's list rather than
  // hand-written <option> tags. Practice previously hardcoded them and went
  // stale the moment a pace changed, so assert the generation itself: a
  // literal seconds string in either file is the bug coming back.
  const generated = /DUPPY_PACE_NAMES\.map\(\(pace\) =>\s*`<option value="\$\{pace\}">\$\{DUPPY_PACE_LABELS\[pace\]\}<\/option>`\)/;
  assert.match(practiceSource, generated);
  assert.match(onlineTableSource, generated);
  // Not "no hardcoded <option> anywhere" — the Duppy *level* picker beside
  // this one legitimately hardcodes its own, and one of its values is also
  // called "yard". The drift risk is specifically a pace duration written
  // out by hand, so that is what must never reappear.
  assert.doesNotMatch(practiceSource, /seconds? per move/);
  // The default is still 'yard' in both, but it now lives in the module-scope
  // value the form is restored from rather than being assigned to the element
  // inline — see the form-memory test below for why that moved.
  // Default cut 'yard' (7.5s) -> 'brisk' (5s), 2026-09-12. The owner reported a
  // live table as having "just froze... then continued"; measured, the gaps
  // between board changes were 7.5s, 7.3s and 7.5s with a worst main-thread
  // block of 92ms, i.e. exactly the configured pace and nothing stuck. Practice
  // shows no thinking indicator either -- only a highlighted seat card -- so
  // three duppies at 7.5s is 22 seconds of a still board between your own
  // turns. This is the same axis the pace was already cut down once before
  // (10s -> 7.5s, see DUPPY_PACE_SECONDS); all four options remain on the
  // picker, so anyone wanting the slower beat still has it.
  assert.match(practiceSource, /let lobbyPace: DuppyPace = 'brisk'/);
  assert.match(practiceSource, /duppyPace\.value = lobbyPace/);
  assert.match(onlineTableSource, /let startPace: DuppyPace = 'brisk'/);
  assert.match(onlineTableSource, /duppyPace\.value = startPace/);
});

test('the game-setup forms remember what was picked across a redraw', () => {
  // render() rebuilds the page, so a <select> holds its value only until the
  // next redraw — and the practice page guarantees one, ten seconds after
  // load, when the site-stats fetch resolves. Confirmed on production
  // 2026-09-04: choose cut throat + first to six, wait thirteen seconds, and
  // the form reads partner + six love with nothing on screen to say so, then
  // deals a game nobody asked for. Every one of these selects must be seeded
  // from module scope and write back on change.
  for (const [source, prefix] of [
    [practiceSource, 'lobby'],
    [onlineTableSource, 'start'],
  ] as const) {
    const mode = prefix === 'lobby' ? 'lobbyMode' : 'startMode';
    const format = prefix === 'lobby' ? 'lobbyFormat' : 'startFormat';
    assert.match(source, new RegExp(`mode\\.value = ${mode}`));
    assert.match(source, new RegExp(`${mode} = mode\\.value`));
    assert.match(source, new RegExp(`${format} = format\\.value`));
    // Rebuilding the format options resets the select, so the remembered
    // choice has to be put back explicitly afterwards.
    assert.match(source, new RegExp(`format\\.value = ${format}`));
  }
});

test('practice Duppies sit visibly at their physical table edges', () => {
  assert.match(practiceSource, /function practiceDuppyIdentity/);
  assert.match(practiceSource, /duppyPersonaUrl\(duppyPersona\(level, seat\)\)/);
  assert.match(practiceSource, /DUPPY_LABELS\[level\].*AI opponent/);
});

test('all four seat portraits stay fully inside the felt on desktop and mobile', () => {
  assert.match(styles, /\.table-seat-identity-top \{ top: 8px;/);
  assert.match(styles, /\.table-seat-identity-bottom \{ bottom: 8px;/);
  assert.match(styles, /\.table-seat-identity-left \{ left: 8px;/);
  assert.match(styles, /\.table-seat-identity-right \{ right: 8px;/);
  assert.match(styles, /\.table-seat-identity-top \{ top: 6px;/);
  assert.doesNotMatch(styles, /\.table-seat-identity-(?:top|bottom|left|right) \{[^}]*-10px/);
});

test('practice names an opponent play without repeating my own move under the hand', () => {
  assert.ok(practiceSource.includes('`${g.seatLabel(recentPlaySeat)} · ${recentPlayedTile}`'));
  assert.match(practiceSource, /recentPlaySeat === g\.mySeat/);
  assert.match(practiceSource, /setTimeout\([\s\S]*?\}, 2_500\)/);
});

test('mobile Practice shuffles and deals one concealed bone to each seat in turn', () => {
  assert.match(practiceSource, /for \(let i = 0; i < 28; i \+= 1\)/);
  assert.match(practiceSource, /seats\[i % seats\.length\]/);
  assert.match(practiceSource, /prefers-reduced-motion: reduce/);
  assert.match(styles, /\.practice-deal-bone[\s\S]{0,500}?will-change: transform, opacity/);
  assert.match(styles, /animation: practice-shuffle 3\.2s/);
  assert.match(styles, /animation: practice-deal 620ms/);
  assert.match(styles, /var\(--deal-index\) \* 165ms/);
  assert.match(practiceSource,
    /const finished = beginPracticeDealAnimation\(\);[\s\S]{0,180}?sfx\.play\('shuffle'\);\s*render\(\);\s*await finished;/,
    'the visible shuffle and its real domino sound must start together');
  assert.match(practiceSource, /await g\.startHand\(showPracticeDeal\)/);
  assert.match(localSource,
    /this\.emit\(\{ type: 'state' \}\);[\s\S]{0,300}?await onDealt\?\.\(\);\s*await this\.runDuppies\(\);/,
    'no Duppy may pose or play until the visible deal finishes');
});

test('Voice off is the master quiet control for Practice', () => {
  assert.match(practiceSource,
    /const turnVoiceOff = !voiceOff;[\s\S]{0,120}?setMuted\(turnVoiceOff\);[\s\S]{0,120}?if \(turnVoiceOff\) sfx\.setMuted\(true\);/);
});

test('mobile Practice keeps its full bone size and a stationary pose camera', () => {
  assert.match(practiceSource,
    /const keepOpeningUnit = g\.options\.mode === 'across'[\s\S]{0,120}?window\.innerWidth <= 700[\s\S]{0,120}?const measuredRouteUnit = keepOpeningUnit \? tableUnit/,
    'a measured mobile refit must keep the opening 36px bone tier');
  assert.match(practiceSource,
    /const boardFocusTile = \(g\.hand\?\.moveLog \?\? \[\]\)[\s\S]{0,20}?\.find\(\(move\) => move\.kind === 'pose'\)/,
    'the camera anchor must be the stationary pose');
  assert.match(practiceSource,
    /keepTileInView\(boardStage,[\s\S]{0,120}?boardFocusTile/,
    'the route camera must use the stationary pose anchor');
});

test('last hand\'s winning bone never lands on the next hand\'s felt', () => {
  // Reported live: after a hand was won, the winning tile kept reappearing as
  // a giant hero bone over the NEXT hand, because winningTile is module state
  // that only startGame() cleared — "Next hand" left it set, and every render
  // re-ran the celebration. Both the slam and its LAST BONE banner must be
  // tied to a hand that is actually over, and "Next hand" must clear them.
  assert.match(practiceSource, /const slam = g\.hand\?\.status !== 'active' \? winningTile : null;/);
  assert.match(practiceSource, /if \(slam\) \{\s*celebrateWinningTile\(slam, line, felt\);/);
  assert.match(practiceSource,
    /function practiceWinCallout[\s\S]{0,400}?if \(g\.hand\?\.status === 'active'\) return null;/);
  // The "Next hand" button clears the same state at the source.
  assert.match(practiceSource,
    /async function practiceNextHand[\s\S]{0,700}?winningTile = null;[\s\S]{0,200}?winningSeat = null;[\s\S]{0,300}?await g\.startHand\(showPracticeDeal\)/);
});

test('a finished hand says GAME OVER on the table and points to the result below', () => {
  // Owner, 2026-09-14: on a phone the result sat under the table and nothing
  // said it was there. The card is on the felt, only once the hand is over,
  // and its button scrolls to the result panel it names.
  assert.match(practiceSource,
    /function practiceGameOverCard[\s\S]{0,200}?if \(!r \|\| g\.hand\?\.status === 'active' \|\| gameOverDismissed\) return null;/);
  assert.match(practiceSource, /'SET OVER' : 'GAME OVER'/);
  assert.match(practiceSource, /getElementById\(PRACTICE_RESULT_ID\)\?\.scrollIntoView/);
  assert.match(practiceSource, /panel\.id = PRACTICE_RESULT_ID;/);
  assert.match(practiceSource, /felt\.appendChild\(gameOver\)/);
  // A new hand must bring the card back even if the last one was closed.
  assert.match(practiceSource, /pendingTile = null;\s*gameOverDismissed = false;/);
});

test('an online table shows the same GAME OVER card, closed per hand', () => {
  const online = readFileSync(new URL('./onlinetableview.ts', import.meta.url), 'utf8');
  assert.match(online,
    /function onlineGameOverCard[\s\S]{0,300}?hand\.status === 'active' \|\| gameOverDismissedHand === hand\.hand_id\) return null;/);
  assert.match(online, /getElementById\(ONLINE_RESULT_ID\)\?\.scrollIntoView/);
  assert.match(online, /panel\.id = ONLINE_RESULT_ID;/);
  assert.match(online, /felt\.appendChild\(gameOver\)/);
});

test('mobile French opens at the top of the table after the deal', () => {
  // Owner, 2026-09-15: the French hand opened scrolled, hiding the top player.
  assert.match(practiceSource,
    /function finishPracticeDealAnimation[\s\S]{0,500}?if \(window\.innerWidth <= 700\) window\.scrollTo\(\{ top: 0, left: 0, behavior: 'instant' \}\);[\s\S]{0,20}?render\(\);/);
  assert.match(practiceSource, /boardStage\.classList\.add\('french-phone-stage'\);\s*room\.classList\.add\('french-phone-room'\);/);
});

test('a new deal waits for the last hand to be scored and its Duppy loop to end', () => {
  assert.match(localSource,
    /async startHand\(onDealt\?[\s\S]{0,900}?if \(this\.duppyLoop\) await this\.duppyLoop;[\s\S]{0,400}?const serverSeed = randomSeed\(\);/);
});

test('the GAME OVER card goes straight to the next hand, or a new set once it is decided', () => {
  assert.match(practiceSource, /go\.textContent = 'New set';\s*go\.onclick = \(\) => leaveLocalGame\(\);/);
  assert.match(practiceSource, /go\.textContent = 'Next hand';\s*go\.onclick = \(\) => \{ go\.disabled = true; void practiceNextHand\(g\); \};/);
  assert.match(practiceSource, /next\.onclick = \(\) => void practiceNextHand\(g\);/, 'one next-hand path for both buttons');
  const online = readFileSync(new URL('./onlinetableview.ts', import.meta.url), 'utf8');
  assert.match(online, /if \(!setOver && !game\.isSpectator\) \{[\s\S]{0,400}?go\.onclick = \(\) => \{ go\.disabled = true; void game\.dealNext\(\); \};/);
});

test('Practice offers Across: the player plays both hands, partner hand at the top', () => {
  // Owner, 2026-09-15: Across belongs in Practice too.
  assert.match(practiceSource, /<option value="across">Across — you play both hands<\/option>/);
  assert.match(localSource, /controls\(seat: number\): boolean \{\s*return seat === this\.mySeat \|\| seat === this\.partnerSeat;/);
  assert.match(localSource, /while \(this\.hand\.status === 'active' && !this\.controls\(this\.hand\.turn\)\)/, 'duppies never play a seat the human controls');
  assert.match(practiceSource, /top\.classList\.add\('across-hand-partner'\)/);
  assert.match(practiceSource, /if \(passive\) \{ hand\.appendChild\(node\); continue; \}/, 'the waiting Across hand cannot be played');
});

test('a Next hand tapped as the set is decided never deals on a finished set', () => {
  assert.match(localSource,
    /if \(this\.duppyLoop\) await this\.duppyLoop;[\s\S]{0,300}?if \(this\.set\.winnerSide !== null\) \{\s*this\.emit\(\{ type: 'state' \}\);\s*return;/);
  assert.match(localSource, /if \(this\.scoredHand === this\.hand\) return;\s*this\.scoredHand = this\.hand;/, 'each hand is scored once');
});

test('Lounge sign-in offers one tap with Google or Apple and never strands a player on a confirmation link', () => {
  // Owner, 2026-09-15: older players often have no email they check.
  const lounge = readFileSync(new URL('./loungeview.ts', import.meta.url), 'utf8');
  const online = readFileSync(new URL('./online.ts', import.meta.url), 'utf8');
  assert.match(online, /auth\/v1\/settings/, 'buttons follow what Supabase has switched on');
  assert.match(online, /linkIdentity\(\{ provider, options: \{ redirectTo \} \}\)/, 'a guest keeps their account when they add Google or Apple');
  assert.match(lounge, /'Continue with Google' : 'Continue with Apple'/);
  assert.match(lounge, /"You're all set\. You can play in the Lounge now\."/);
  assert.match(lounge, /signIn\.textContent = 'Sign in to play';/);
});

test('practice names the person who laid the last domino before the result screen', () => {
  assert.ok(practiceSource.includes('`${g.seatLabel(winningSeat)} · LAST BONE`'));
  assert.ok(practiceSource.includes('`${g.seatLabel(winningSeat)} played the last domino`'));
});

test('online keeps the last played tile beside its player until the next move', () => {
  assert.match(onlineTableSource, /function playCallout\(game: OnlineGame\)/);
  assert.match(onlineTableSource, /lastMove\.seat === game\.mySeat\) return null/);
  assert.ok(onlineTableSource.includes('`${name} · ${lastMove.tile}`'));
  // The cue belongs to the same enclosed station as the player's portrait,
  // name and rack. A direct felt child can drift over the board or hand.
  assert.match(onlineTableSource,
    /const calloutHost =[\s\S]*?tableStations\.get\(lastMoveSlot\)[\s\S]*?const lastPlay = playCallout\(game\);[\s\S]*?\(calloutHost \?\? feltShell\)\.appendChild\(lastPlay\)/);
});

test('the turn clock stays above the felt and end choices are anchored on the board', () => {
  const clock = onlineTableSource.indexOf("if (game.hand?.status === 'active' && game.hand.turn_expires_at)");
  const felt = onlineTableSource.indexOf('feltSlot.appendChild(feltShell);', clock);
  const choices = onlineTableSource.indexOf('placeBoardChoices(boardStage, handActions, choiceHandHost)', felt);
  assert.ok(clock >= 0);
  assert.ok(felt > clock, 'clock must be appended before the felt');
  assert.ok(choices > felt, 'choice controls must be moved onto the rendered board stage');
});

test('Practice and Lounge keep Pass and other hand decisions on the felt', () => {
  for (const [surface, source] of [['Practice', practiceSource], ['Lounge', onlineTableSource]] as const) {
    // Practice's fixed phone board never pans, so it skips the mirrored
    // Left/Right row under the hand (the board arrows are always on screen).
    const call = surface === 'Practice'
      ? 'placeBoardChoices(boardStage, handActions, phoneFixedRoute ? null : choiceHandHost)'
      : 'placeBoardChoices(boardStage, handActions, choiceHandHost)';
    const choices = source.indexOf(call);
    assert.ok(choices >= 0, `${surface} must process end choices`);
    const decisionDock = source.slice(choices, choices + 300);
    assert.ok(decisionDock.includes("handActions.classList.add('in-felt-actions')"),
      `${surface} decisions need the protected in-felt dock`);
    assert.ok(decisionDock.includes('felt.appendChild(handActions)'),
      `${surface} Pass must remain visible on the table`);
  }
});

test('Practice and Lounge show Pass beside the hand before any tile is selected', () => {
  for (const [surface, source] of [['Practice', practiceSource], ['Lounge', onlineTableSource]] as const) {
    assert.match(source, /const onlyPass = legal\.length === 1 && legal\[0\]\.kind === 'pass'/,
      `${surface} must derive Pass directly from legal moves`);
    assert.match(source, /className = 'act pass-action'/,
      `${surface} needs the same prominent Pass action`);
    assert.match(source, /b\.dataset\.passAction = 'true'/,
      `${surface} Pass needs a stable interactive marker`);
    assert.match(source, /!child\.classList\.contains\('pass-action-row'\)/,
      `${surface} Pass must remain attached to the hand instead of the portrait corner`);
  }
  assert.match(styles, /\.pass-action-row[\s\S]{0,320}?min-height: 48px/);
  assert.match(styles, /\.pass-action-row \.pass-action \{ min-width: 92px; min-height: 44px; \}/);
});

test('board destination actions use a defined high-contrast palette', () => {
  assert.match(styles, /button\.board-end-choice[\s\S]{0,300}?background: #075d3c;[\s\S]{0,100}?color: #fff8d3;/);
  assert.match(styles, /board-end-choice\[data-opening-choice='true'\][\s\S]{0,120}?width: 48px/);
  assert.doesNotMatch(styles, /board-end-choice[\s\S]{0,300}?var\(--mango\)/);
});

test('table settings reads and behaves as an obvious control', () => {
  assert.match(onlineTableSource, /collapsible table-start-options/);
  assert.ok(onlineTableSource.includes("'Table settings'"));
  assert.ok(onlineTableSource.includes("'Seats · turn clock · Duppies'"));
  assert.match(styles, /\.table-start-options summary[\s\S]{0,300}?min-height: 52px/);
});

test('Across puts my hand at the bottom and my partner hand at the top, both on the table', () => {
  // Owner, 2026-09-15: "ensure that the across hand is at the top and the
  // partner can play both". The seat on turn is the live panel.
  assert.match(onlineTableSource, /felt\.classList\.add\('across-hands-on-felt'\)/);
  assert.match(onlineTableSource, /const activeSeat = game\.table\.mode === 'across' \? game\.activeSeat\(\) : game\.mySeat/);
  assert.match(onlineTableSource, /myHandPanel\(game, rerender, activeSeat\)/);
  assert.match(onlineTableSource, /top\.classList\.add\('across-hand-partner'\)/);
  assert.match(onlineTableSource, /own\.classList\.add\('across-hand-own'\)/);
  assert.match(onlineTableSource, /if \(!passive && pendingTileSeat !== seat\)/, 'the read-only hand never clears the live chosen tile');
  assert.match(onlineTableSource, /across: game\.table\.mode === 'across'/);
});

test('lounge chat rejects stale history and messages from every other lounge', () => {
  assert.match(loungeViewSource, /let loungeSessionGeneration = 0/);
  assert.match(loungeViewSource, /session !== loungeSessionGeneration/g);
  assert.match(loungeViewSource, /messages\.filter\(\(message\) => message\.lounge_id === lounge\.id\)/);
  assert.match(loungeViewSource, /msg\.lounge_id !== lounge\.id/);
  assert.ok(loungeViewSource.includes('`Table talk · ${lounge.name}`'));
  assert.doesNotMatch(loungeViewSource, /recentMessages\(lounge\.id\)/,
    'a new visit must not reload old table talk from a previous room session');
});

test('Practice and Lounge reserve rounding room inside the measured board guard', () => {
  for (const [surface, source] of [['Practice', practiceSource], ['Lounge', onlineTableSource]] as const) {
    assert.ok(source.includes('fitHost.clientWidth - 18'), `${surface} must inset the fitted width`);
    assert.ok(source.includes('fitHost.clientHeight - 18'), `${surface} must inset the fitted height`);
  }
});

test('Across and spectators keep the same protected board stage as every seated mode', () => {
  for (const [surface, source] of [['Practice', practiceSource], ['Lounge', onlineTableSource]] as const) {
    assert.ok(source.includes("const boardStage = el('div', 'board-stage');"),
      `${surface} must always create the invisible board guard`);
    assert.ok(source.includes('felt.appendChild(boardStage);'),
      `${surface} must attach the guard even when the hand lives below the felt`);
    assert.ok(source.includes('const fitHost = boardStage;'),
      `${surface} must fit every mode to the protected stage`);
  }
});

test('Practice and Lounge pin the French route and invisible guard for the whole hand', () => {
  for (const source of [practiceSource, onlineTableSource]) {
    assert.match(source, /line\.scrollWidth > fitHost\.clientWidth/);
    assert.match(source, /line\.scrollHeight > fitHost\.clientHeight/);
    assert.match(source, /boardStage\.dataset\.boardGuard = 'pinned-hand-square'/);
    // Was: /if \(frenchTable\) return;/ -- "French must never enter the
    // after-paint board rebuild path". The hazard that guarded against was a
    // rebuild on EVERY move, recreating the route after paint and recomputing
    // its centre from racks that were still shrinking. Both halves of that are
    // gone: the racks are pinned, and the rebuild below is guarded on a real
    // change of fitted unit, which can only happen the first time a French
    // hand is drawn at a given viewport.
    //
    // It had to change, because that early return was the reason French never
    // fitted. It returned BEFORE anything measured could reach the cross, so
    // the French bone came from feltBox()'s window guess and was never once
    // compared against the stage it had to fit -- a 510x442 canvas drawn into
    // a 464x439 stage, clipping 98% of desktop hands from the seventh bone.
    // A phone records the stage's whole inner box: a French phone board has no
    // line padding, and keeping the linear line's 18px cost a 375px phone two
    // columns of 28px bones (2026-09-14).
    assert.match(source,
      /lastFrenchFitBox = window\.innerWidth <= 700(?: \|\| frenchDeskPinwheel)?\s*\? \{ width: fitHost\.clientWidth, height: fitHost\.clientHeight \}\s*: box;/,
      'French must record the stage it was actually measured against');
    // A phone also rebuilds when its measured grid differs from the one it
    // was first drawn in (2026-09-13: phones route inside their own width).
    // Like the bone, that grid can only change the first time a French hand
    // is drawn at a given viewport, so the steady state is still no rebuild.
    assert.match(source, /if \(fittedUnit && \(want !== fittedUnit \|\| phoneGridStale\)\)/,
      'and may only rebuild when the fitted bone or the phone grid genuinely changes');
    assert.match(source,
      /const phoneGridStale = \(?window\.innerWidth <= 700(?: \|\| frenchDeskPinwheel\))?\s*&& line\.dataset\.crossGrid !== phoneCrossGridKey\(lockedBox, tableUnit\);/,
      'the phone grid check compares what was drawn against the measured stage');
    // The stage is measured once per hand. Re-measuring after a long arm made
    // the stage pan let a scrollbar narrow it, and re-routed every bone
    // already played (360px phone, 2026-09-13).
    assert.match(source, /lastFrenchFitKey = frenchGuardKey;/,
      'the French stage measurement is locked to the hand it was taken for');
    assert.match(source, /box: lockedBox,/,
      'the French redraw uses the locked measurement, not a fresh one');
    assert.doesNotMatch(source, /if \(frenchTable\) \{\s*const corrected = renderBoard/,
      'never an unconditional French rebuild after paint');
    assert.doesNotMatch(source,
      /if \(changed \|\| boardOverflowedGuard \|\| displayBoard\?\.kind === 'cross'\)/);
    // Was: /\.\.\.\(frenchTable \? \{ unit: tableUnit \} : \{\}\)/ — the pin used
    // to be French-only, which is exactly why the linear double-six game still
    // shrank as the chain filled. The intent behind this assertion ("pass the
    // pre-deal unit back into every render") is unchanged and now stronger:
    // every mode pins, so the conditional is gone rather than weakened.
    assert.match(source, /\n\s*unit: tableUnit,/,
      'every mode must pass the pre-deal unit back into every render');
    assert.doesNotMatch(source, /frenchTable \? \{ unit: tableUnit \}/,
      'the pin must not be conditional on French again');
  }
});

test('Lounge social utility bars follow the table instead of stealing board height', () => {
  const room = onlineTableSource.indexOf("const room = el('div', 'table-room')");
  const extras = onlineTableSource.indexOf("const liveExtras = el('div', 'table-live-extras')", room);
  assert.ok(room >= 0 && extras > room);
  assert.ok(!onlineTableSource.slice(0, room).includes('frag.appendChild(social.voicePanel)'));
  assert.ok(onlineTableSource.slice(extras, extras + 500).includes('liveExtras.appendChild(social.voicePanel)'));
});

test('a phone gives concealed racks a counter size, so the board keeps the felt width', () => {
  // Reported live, twice: "the space to play is still too short, the domino is
  // still hiding when almost played out". Measured on a real played-out hand at
  // 390x844 -- the chain started hiding under the local hand from the EIGHTEENTH
  // bone, which is an ordinary hand, not a freak one.
  //
  // The cause was not the board renderer. Three face-down opponent racks were
  // rendering at the full 28px PLAYING bone size on a phone, and the flank ones
  // were pinned at a hardcoded 44x22 that no token could reach. Each flank
  // station came out 54px wide, so the measured guard held the board 61px off
  // both felt edges and left the chain a 222px lane inside a 338px felt -- seven
  // tiles per row, and then it ran out of height.
  //
  // CLAUDE.md allows exactly this fix: concealed racks may take one smaller,
  // stable perimeter-counter size so they do not take the playing surface. The
  // played bone and the local hand are deliberately NOT touched -- they stay on
  // --table-bone-short, which is what keeps them within 1px of each other.
  const phone = styles.slice(styles.indexOf('@media (max-width: 700px)'));
  // BOTH hosts, and this is not belt-and-braces -- the two surfaces hang their
  // stations off different elements. Practice puts them inside .table-felt
  // (main.ts), while the Lounge appends them to .felt-shell, which is the
  // PARENT of .table-felt (onlinetableview.ts:1014 vs :981). A custom property
  // declared only on .table-felt therefore never inherits to a Lounge rack, and
  // it silently falls back: the top rack to the full playing bone, the flanks to
  // 22px. Shipped exactly that way and caught on a real phone -- Practice
  // correct, Lounge still carrying full-size counters. There is an older comment
  // at onlinetableview.ts:954 describing this same footgun for
  // --table-bone-short, which is the tell that this DOM split will keep biting.
  assert.match(phone, /\.table-felt,\s*\.felt-shell \{ --table-counter-short: 14px; \}/,
    'the counter size must reach the Lounge felt-shell as well as the practice felt');
  assert.doesNotMatch(phone.slice(0, phone.indexOf('.table-win-left')),
    /\.table-player-station-right \.backs i \{\s*width: 44px;/,
    'flank counters must not be hardcoded past the token again');
  // The rack rules read the counter token but fall back to the bone size, so
  // every surface that has not opted in is untouched.
  assert.match(styles,
    /\.table-rack \.backs i \{\s*width: var\(--table-counter-short, var\(--table-bone-short\)\);/);
});

test('the phone board stage floor never out-votes the measured guard', () => {
  // boardGuardInsets() seeds itself from the stage's CURRENT stylesheet box and
  // then only ever Math.max()es it larger, so whatever CSS puts here is a floor
  // the real measurement can never go below. It read 50px per side, which was a
  // guess at how far the old 54px stations reached. That guess silently beat the
  // measurement: shrinking the racks changed the stations but not the board,
  // because the floor was still 50px. Keep this a conservative first-paint
  // fallback, well under what the stations actually measure.
  const phone = styles.slice(styles.indexOf('@media (max-width: 700px)'));
  assert.match(phone, /\.practice-room \.board-stage \{ left: 0; right: 0; \}/,
    'owner-approved Practice uses the full rim; Lounge retains its conservative floor');
  const rule = phone.slice(phone.indexOf('\n  .board-stage {'));
  assert.doesNotMatch(rule.slice(0, rule.indexOf('}')), /\b50px\b/,
    'the 50px side floor is the bug: it pinned the board regardless of measurement');
  assert.match(rule.slice(0, rule.indexOf('}')), /\b24px\b/);
});

test('a phone does not square the French guard, because a phone is portrait', () => {
  // Squaring exists so a French cross gets equal clearance in all four
  // directions -- a real requirement on a landscape desktop table, where the
  // felt is much wider than it is tall and the spare width would otherwise let
  // an arm drift into a player's lane.
  //
  // A phone is the other way round. The flank stations cap the width, squaring
  // then throws away every pixel of height above that cap, and the cross gets
  // the SMALLER of two dimensions in both directions. Measured on real French
  // hands, with the bone pinned at its readable 28px:
  //
  //   430x745   squared 332x321 -> unsquared 332x392   11 bones -> 14 visible
  //   390x700   squared 292x282 -> unsquared 292x357    9 bones -> 11 visible
  //   360x780   squared 262x196 -> unsquared 262x331    6 bones ->  9 visible
  //
  // The 360px case is the clearest: squaring was costing 135px of height and
  // holding the cross to six bones on a felt with room for nine.
  for (const [surface, source] of [['Practice', practiceSource], ['Lounge', onlineTableSource]] as const) {
    // Nothing is squared any more, French included. The French board is a FIXED
    // 450x390 canvas -- a rectangle -- so its own shape already gives the four
    // arms equal clearance, and squaring the stage around it only discards
    // whichever dimension is not binding. Measured in a real 1920x1080 Lounge:
    // a 1728px felt inset 609px on EACH side to make a square, leaving the
    // board 490px of 1708 and a 30px bone on a table with room for 48px.
    assert.match(source, /felt\.querySelector<HTMLElement>\('\.in-felt-hand'\), false\);/,
      `${surface} must never square the board guard`);
    assert.doesNotMatch(source, /frenchTable \|\| displayBoard\?\.kind === 'cross'\)\);/,
      `${surface} must not bring squaring back`);
  }
});

test('a failed duppy turn is retried, not abandoned to the cron', () => {
  // Reported live 2026-09-12: "the indicator showed that the counting was
  // finished, but the game just paused", then resumed by itself a while later.
  //
  // Found in the production logs rather than guessed. advance-duppy runs
  // ~1.1s at the median, but the tail is bad: p99 4.7s, and at 06:30:13 a call
  // took 11.5 SECONDS, immediately followed at 06:30:20 by a 401 that itself
  // took 5.2s. advanceDuppyTurn() handled DuppyTurnConflictError (409) by
  // refetching and treated EVERY other failure -- a 401 during a token
  // refresh, a timeout, a dropped connection -- as final: emit an error and
  // stop. Nothing rescheduled the turn, so the table sat still until the
  // server-side expire-turns cron picked it up. That is the pause, and the
  // cron is why it "continued" on its own.
  //
  // Retries are bounded on purpose. The original comment here warned against
  // spinning on a permanent failure, and that warning still holds: a short
  // backoff ladder, then give up and tell the player.
  assert.match(onlineControllerSource, /const DUPPY_RETRY_DELAYS_MS/,
    'a failed duppy advance needs a bounded retry ladder');
  assert.match(onlineControllerSource,
    /private async advanceDuppyTurn\(handId: string, attempt = 0\)/,
    'the retry count must be carried, so the ladder can terminate');
  assert.match(onlineControllerSource,
    /attempt < DUPPY_RETRY_DELAYS_MS\.length/,
    'and must stop at the end of the ladder rather than spinning');
  // A 409 still means somebody else moved: refetch, never retry.
  assert.match(onlineControllerSource,
    /if \(err instanceof DuppyTurnConflictError\) \{[\s\S]{0,400}?await this\.refetchHand\(\);\s*return;/);
});

test('a French cross too big for the phone still keeps its pose centred', () => {
  // The owner, twice: older people play this game and cannot make out small
  // dominoes. Fitting a late French cross on a phone works out at a 20px bone,
  // 16px on a 360px screen, against the linear game's 28px -- so the bone stays
  // readable and the board pans instead. That decision is only livable if the
  // POSE stays put: `align-items: safe center` start-aligns anything bigger
  // than its box, which measured 44px of drift on a 430px phone and left the
  // whole right arm off-screen with nothing to indicate it.
  for (const [surface, source] of [['Practice', practiceSource], ['Lounge', onlineTableSource]] as const) {
    assert.match(source, /centreCrossOnPose\(boardStage, line\)/,
      `${surface} must hold the cross centred on its pose`);
  }
});

test('French has no "under love", because zero is the best score there', () => {
  // Spotted by the owner on a live French table: "Duppy 4 under love". Love is
  // a six-love idea — you are on nothing while the other side scores, and the
  // side under love bruks the board by winning. French has none of that. It is
  // a race to 100 where the LOWEST score wins, so 0 is not a hole to climb out
  // of, it is the best position at the table.
  //
  // Pre-existing, from da4d19f (2026-08-06), not a rule change: scoreTrack()
  // printed 'under love' for any zero regardless of format.
  //
  // The pip track had the same fault more subtly. Six pips scaled by `max`
  // means they LIGHT UP as a score climbs — progress toward winning at
  // six-love or first-to-six, but in French climbing is losing, so a full
  // track read as "doing well" when it meant the opposite.
  assert.match(renderSource, /score === 0 && !opts\.french \? 'under love' : String\(score\)/,
    'zero must only read as love where love exists');
  assert.match(renderSource, /french\?: boolean/, 'scoreTrack needs to know the format');
  assert.match(renderSource, /opts\.french/, 'and the pip track must use it too');
  // Both surfaces have to pass it, or the Lounge keeps the bug Practice loses.
  for (const [surface, source] of [['Practice', practiceSource], ['Lounge', onlineTableSource]] as const) {
    assert.match(source, /french: [^,\n]*=== 'french'/,
      `${surface} must tell the scoreboard when the table is French`);
  }
});

test('a phone never shrinks the French bone, however well the cross would fit', () => {
  // Got wrong twice, so it is pinned. Fitting a late French cross on a phone
  // costs a 20px bone, 16px on a 360px screen, against the linear game's 28px.
  // Older people play this game; the owner has ruled on it twice. A board that
  // is fully visible but unreadable is worse than one that is readable and
  // pans, and no routing scheme changes the arithmetic -- measured over 500
  // real French hands, even the flexible lane generator holds only ~13 bones
  // at 28px on a 430px phone.
  for (const [surface, source] of [['Practice', practiceSource], ['Lounge', onlineTableSource]] as const) {
    assert.match(source, /fitCrossToBox: window\.innerWidth > 700/,
      `${surface} must fit the cross only on a landscape table`);
  }
  // And the cap must never outrank the readable floor in the renderer.
  assert.match(renderSource,
    /const requested = opts\.fitCrossToBox === false \|\| opts\.frenchPinwheel \? pinned : Math\.min\(pinned, fitCap\)/);
  assert.match(renderSource, /const u = Math\.max\(readableFloor,/,
    'the readable minimum is the last word on bone size');
});

test('a board that can be panned says so, and the pinned strip keeps compact score lamps', () => {
  // Two things reported on a live table, both about reading the screen rather
  // than playing the game.
  //
  // "how will people know how to scroll up or down, not everyone will know" --
  // Phone panning still needs a visible affordance. Desktop is independently
  // required to fit its complete-hand route without exposing a scrollbar.
  for (const [surface, source] of [['Practice', practiceSource], ['Lounge', onlineTableSource]] as const) {
    assert.match(source, /markPannable\(boardStage\);/,
      `${surface} must mark a pannable board, for a line as well as a cross`);
  }
  assert.match(renderSource, /export function markPannable/);
  assert.match(renderSource, /classList\.toggle\('board-stage-fitted', ways\.length === 0\)/,
    'desktop may hide a board scrollbar only after the measured route fits');
  assert.match(styles, /\.board-stage\[data-pans~="y"\]/);
  assert.match(styles,
    /@media \(min-width: 701px\)[\s\S]*?\.board-stage\.board-stage-fitted[\s\S]*?overflow: hidden;/,
    'a proven-fit desktop board must not expose a scrollbar');

  // Owner restored the fast visual score: grey lamps at love, yellow lamps for
  // won points. They remain deliberately compact so the board keeps its room.
  assert.match(styles,
    /\.sticky-scores \.pips i[\s\S]{0,180}?background: #6f7b82/,
    'unearned score lamps must be visible in muted grey');
  assert.match(styles,
    /\.sticky-scores \.pips i\.lit[\s\S]{0,180}?background: #ffc928/,
    'earned score lamps must light yellow');
  assert.doesNotMatch(styles, /\.sticky-scores \.pips \{ display: none; \}/,
    'the compact score lamps must remain visible on phones too');
  assert.match(renderSource, /if \(!opts\.french\) \{[\s\S]{0,180}?pips/,
    'French must omit the six-lamp progress treatment');
});

test('Across hands its end choice to the board, like every other mode', () => {
  // Reported on a live across table: "you still keep the arrow at the hand, i
  // thought it should be on the table". Across was the one mode that never
  // did -- takeHandActions() was called only in the non-across branch, so
  // handActions was still null when placeBoardChoices() ran and it returned
  // straight back out. "Which end? Left end (6) / Right end (6)" names the two
  // OPEN ENDS, so it belongs beside them on the felt, not at the bottom of a
  // hand panel below the table.
  // Anchored on the HAND branch, not on the first `mode === 'across'` in the
  // file — the felt-slot marker above it matches that too, and an anchor that
  // drifts silently scans the wrong block and passes for the wrong reason.
  assert.match(onlineTableSource, /handActions = takeHandActions\(hand\)/,
    'the shared Open Hand tray supplies the board destination choice');
  assert.match(onlineTableSource, /handActions = placeBoardChoices\(boardStage, handActions, choiceHandHost\)/);
});

test('board choices have a hand-adjacent fallback when an endpoint is out of view', () => {
  assert.match(renderSource, /handHost: HTMLElement \| null = null/);
  assert.match(renderSource, /handChoices\.className = 'hand-end-choice-bar'/);
  assert.match(renderSource, /choice\.onclick = \(\) => button\.click\(\)/);
  assert.match(styles, /\.hand-end-choice-bar[\s\S]{0,260}?position: absolute/);
  assert.match(styles, /button\.hand-end-choice[\s\S]{0,220}?min-height: 44px/);
});

test('Lounge coordinates waiting and Across partner-hand selection like Practice', () => {
  // `!passive` too: Across draws the hand not on turn read-only (2026-09-15).
  assert.ok(onlineTableSource.includes('if (!passive && !pending && game.isMyTurn())'),
    'a waiting Lounge player must not select a misleading tile');
  assert.ok(onlineTableSource.includes("pendingTile ? 'Choose where it goes' : 'Your partner hand — your turn'"),
    'Across must show the same selected-bone instruction while controlling the partner hand');
});

test('tapping a bone never plays it outright — the board confirms every move', () => {
  // Reported on a live phone: "because they are so tiny and so close,
  // sometimes my hand touch the wrong domino that goes out". A tile with
  // exactly ONE legal end used to play on a single tap, instantly and
  // irreversibly, so a fat-finger on the neighbouring bone lost it. Only a
  // tile that fitted BOTH ends ever asked first.
  //
  // Every tap now selects, and the commit happens on the board — a big target,
  // far from the hand, showing which end the bone is going to. That is the
  // same flow two-ended tiles already used, so there is one interaction
  // instead of two, and no move is one stray thumb away any more.
  //
  // This does not weaken "no auto-play" (CLAUDE.md): the system still never
  // chooses an end for you. It strengthens it — now it never places a bone
  // without a second, deliberate confirmation either.
  for (const [surface, source] of [['Practice', practiceSource], ['Lounge', onlineTableSource]] as const) {
    assert.doesNotMatch(source, /if \(options\.length === 1\) \{\s*pendingTile = null;/,
      `${surface} must not play a single-ended bone straight off the tap`);
  }
  assert.doesNotMatch(onlineTableSource, /options\.length === 1[\s\S]{0,80}?void (g|game)\.play\(options\[0\]\)/,
    'the Lounge must not auto-commit from the hand at all');
});

test('Practice Quick play is an opt-in, off by default, and still asks when a bone has two places', () => {
  // Owner, 2026-09-14: some players want JamDom's "Click to Play" feel. The
  // confirm step above stays the default; a player switches Quick play on in
  // the lobby, and only a bone with exactly one legal place plays on one tap.
  assert.match(practiceSource, /localStorage\.getItem\(QUICK_PLAY_KEY\) === 'on'; \} catch \{ return false; \}/,
    'Quick play must start off, including when storage is unavailable');
  assert.match(practiceSource,
    /const options = quickPlay && can \? legal\.filter\(\(move\) => 'tile' in move && move\.tile === tile\) : \[\];\s*if \(quickPlay && options\.length === 1\) \{ pendingTile = null; void g\.play\(options\[0\]\); return; \}\s*pendingTile = pendingTile === tile \? null : tile;/,
    'only a Quick play tap on a bone with one legal place commits; everything else selects');
  assert.match(practiceSource, /\['Placing bones', placing\]/, 'the choice lives in the Practice lobby');
});

test('a move that fails in flight is retried, not silently dropped', () => {
  // Reported on a live phone: "sometimes when i select a domino, sometimes it
  // pauses before its sent and i have to redo it".
  //
  // Both halves were real. play() had NO retry: one failed request and the
  // move was gone, the prediction was torn down, and the only recovery was
  // noticing and tapping again. And the hand freezes for the whole round trip
  // (pending = predictedTilesFor(seat) !== null), which measured a 1372ms
  // median and a 5658ms p99 on play-move — so a slow one looks like a pause
  // and invites exactly the second tap the freeze exists to prevent.
  //
  // Retrying is safe here specifically because the server applies moves under
  // an optimistic version check: if the first request actually landed and only
  // its RESPONSE was lost, the retry is rejected as a conflict and refetches
  // rather than playing the bone twice.
  assert.match(onlineControllerSource, /const PLAY_RETRY_DELAYS_MS/,
    'a failed play needs a bounded retry ladder');
  assert.match(onlineControllerSource,
    /async play\(move: Move, attempt = 0\)/,
    'the attempt must be carried so the ladder can terminate');
  assert.match(onlineControllerSource, /attempt < PLAY_RETRY_DELAYS_MS\.length/,
    'and must stop at the end of the ladder rather than spinning');
  // A conflict means the board already moved: refetch, never retry.
  assert.match(onlineControllerSource,
    /if \(err instanceof ConflictError\) \{[\s\S]{0,300}?await this\.refetchHand\(\);\s*return;\s*\}/,
    'a conflict must refetch and never retry — the board really did move');
  // And the prediction must OUTLIVE a retry, or the bone flickers back into
  // the hand between attempts and invites the second tap all over again.
  assert.match(onlineControllerSource,
    /return this\.play\(move, attempt \+ 1\);/);
});

test('the pose is passed AFTER the deal, with the tiles in hand', () => {
  // Owner, 2026-09-12: "for partner game, generally must deal before asking if
  // partner wantes to keep pose or pass it... they need to see which hand is
  // better first".
  //
  // It was the other way round: the result panel asked "Who should pose?" and
  // both buttons called dealNext(pass), which passed the pose and THEN dealt.
  // The winner decided blind, without holding a single bone — which is the one
  // thing the choice is supposed to be based on.
  //
  // Nothing about the deal changes when the pose is passed; the tiles are
  // already out. Only who opens changes.
  assert.doesNotMatch(onlineControllerSource, /async dealNext\(pass: boolean\)/,
    'dealing must no longer carry a pose decision');
  assert.doesNotMatch(onlineTableSource, /dealNext\(true\)/,
    'no surface may pass the pose by dealing');
  assert.match(onlineControllerSource, /async passPose\(\)/,
    'passing the pose is its own action, taken on a hand already dealt');
  // The offer belongs where the tiles are, not on the result screen.
  assert.match(onlineControllerSource, /canPassPoseNow\(\)/);
  assert.match(onlineControllerSource,
    /this\.hand\?\.status === 'active'[\s\S]{0,400}?move_log[\s\S]{0,120}?length \?\? 0\) === 0/,
    'only while the hand is live and nothing has been played yet');
});

test('the Lounge asks for an email; Practice never does', () => {
  // Owner's partner, 2026-09-12: "for people to use lounge, they must have an
  // email." The Lounge is where you meet strangers, chat and talk on voice, so
  // it needs somebody reachable behind each seat — a ban a cleared browser
  // undoes is not a ban.
  //
  // This does NOT disturb the decisions it sits beside. Practice stays
  // anonymous and instant, so there is still no wall in front of a first game.
  // No SOCIAL login is required — an email and password is not Facebook. And
  // the game stays free: a guest WITH an email reaches every lounge a guest
  // could reach before, so this is an identity floor, not a paywall.
  const lounges = readFileSync(new URL('./lounges.ts', import.meta.url), 'utf8');
  assert.match(lounges, /export function canEnter\([\s\S]{0,1000}?hasEmail: boolean/,
    'the entry gate must know whether the account has an email');
  assert.match(lounges, /if \(!hasEmail\)/);
  // Practice must never grow one. It is the funnel.
  assert.doesNotMatch(practiceSource, /requireLoungeEmail|hasLoungeEmail/,
    'Practice must stay anonymous and instant');
});
