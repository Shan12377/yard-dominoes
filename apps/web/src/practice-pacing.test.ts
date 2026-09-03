import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const localSource = readFileSync(new URL('./local.ts', import.meta.url), 'utf8');
const practiceSource = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
const onlineTableSource = readFileSync(new URL('./onlinetableview.ts', import.meta.url), 'utf8');
const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

test('practice Duppies never move faster than 3.5 seconds and pause for the final bone', () => {
  assert.match(localSource, /quick: DUPPY_PACE_SECONDS\.quick \* 1_000/);
  assert.match(localSource, /brisk: DUPPY_PACE_SECONDS\.brisk \* 1_000/);
  assert.match(localSource, /yard: DUPPY_PACE_SECONDS\.yard \* 1_000/);
  assert.match(localSource, /relaxed: DUPPY_PACE_SECONDS\.relaxed \* 1_000/);
  assert.match(localSource, /DUPPY_PACE_MS\[this\.options\.duppyPace\]/);
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
  assert.match(practiceSource, /duppyPace\.value = 'yard'/);
  assert.match(onlineTableSource, /duppyPace\.value = 'yard'/);
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
  assert.match(onlineTableSource, /const lastPlay = playCallout\(game\);[\s\S]*?feltShell\.appendChild\(lastPlay\)/);
});

test('the two-end choice stays above the turn clock in an online hand', () => {
  const dock = onlineTableSource.indexOf('if (handActions) feltSlot.appendChild(handActions);');
  const clock = onlineTableSource.indexOf("if (game.hand?.status === 'active' && game.hand.turn_expires_at)", dock);
  assert.ok(dock >= 0);
  assert.ok(clock > dock);
});
