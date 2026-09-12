import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const localSource = readFileSync(new URL('./local.ts', import.meta.url), 'utf8');
const practiceSource = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
const onlineTableSource = readFileSync(new URL('./onlinetableview.ts', import.meta.url), 'utf8');
// The VIEW is onlinetableview.ts above; this is the CONTROLLER that drives
// turns and talks to the Edge Functions. Two different files, easy to confuse.
const onlineControllerSource = readFileSync(new URL('./onlinetable.ts', import.meta.url), 'utf8');
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
  assert.match(localSource,
    /setTimeout\([\s\S]{0,160}?\)\);\s*this\.hand = applyMove\(this\.hand, move\);/);
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

test('practice leaves a named record of the last non-winning play during the reading beat', () => {
  assert.ok(practiceSource.includes('`${g.seatLabel(recentPlaySeat)} · ${recentPlayedTile}`'));
  assert.match(practiceSource, /setTimeout\([\s\S]*?\}, 2_500\)/);
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
    /next\.onclick[\s\S]{0,700}?winningTile = null;[\s\S]{0,200}?winningSeat = null;[\s\S]{0,300}?await g\.startHand\(\)/);
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
  const choices = onlineTableSource.indexOf('placeBoardChoices(boardStage, handActions)', felt);
  assert.ok(clock >= 0);
  assert.ok(felt > clock, 'clock must be appended before the felt');
  assert.ok(choices > felt, 'choice controls must be moved onto the rendered board stage');
});

test('Practice and Lounge keep Pass and other hand decisions on the felt', () => {
  for (const [surface, source] of [['Practice', practiceSource], ['Lounge', onlineTableSource]] as const) {
    const choices = source.indexOf('placeBoardChoices(boardStage, handActions)');
    assert.ok(choices >= 0, `${surface} must process end choices`);
    const decisionDock = source.slice(choices, choices + 300);
    assert.ok(decisionDock.includes("handActions.classList.add('in-felt-actions')"),
      `${surface} decisions need the protected in-felt dock`);
    assert.ok(decisionDock.includes('felt.appendChild(handActions)'),
      `${surface} Pass must remain visible on the table`);
  }
});

test('Practice and Lounge reserve rounding room inside the measured board guard', () => {
  for (const [surface, source] of [['Practice', practiceSource], ['Lounge', onlineTableSource]] as const) {
    assert.ok(source.includes('fitHost.clientWidth - 18'), `${surface} must inset the fitted width`);
    assert.ok(source.includes('fitHost.clientHeight - 18'), `${surface} must inset the fitted height`);
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
    assert.match(source, /lastFrenchFitBox = box;/,
      'French must record the stage it was actually measured against');
    assert.match(source, /if \(fittedUnit && want !== fittedUnit\)/,
      'and may only rebuild when the fitted bone genuinely changes');
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
  const rule = phone.slice(phone.indexOf('.board-stage {'));
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
    assert.match(source, /window\.innerWidth > 700 && \(frenchTable \|\| displayBoard\?\.kind === 'cross'\)/,
      `${surface} must square the French guard only where the table is landscape`);
    assert.doesNotMatch(source, /\n\s*frenchTable \|\| displayBoard\?\.kind === 'cross'\);/,
      `${surface} must not square a phone's French guard`);
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
