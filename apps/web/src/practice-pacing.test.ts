import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const localSource = readFileSync(new URL('./local.ts', import.meta.url), 'utf8');
const practiceSource = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
const onlineTableSource = readFileSync(new URL('./onlinetableview.ts', import.meta.url), 'utf8');

test('practice Duppies never move faster than 3.5 seconds and pause for the final bone', () => {
  assert.match(localSource, /quick: DUPPY_PACE_SECONDS\.quick \* 1_000/);
  assert.match(localSource, /yard: DUPPY_PACE_SECONDS\.yard \* 1_000/);
  assert.match(localSource, /relaxed: DUPPY_PACE_SECONDS\.relaxed \* 1_000/);
  assert.match(localSource, /DUPPY_PACE_MS\[this\.options\.duppyPace\]/);
  assert.match(localSource, /DUPPY_LAST_BONE_PAUSE_MS = DUPPY_PACE_SECONDS\.quick \* 1_000/);
  assert.match(localSource,
    /setTimeout\(r, DUPPY_LAST_BONE_PAUSE_MS\)[\s\S]*?this\.finishHand\(\);/);
});

test('practice exposes the same three Duppy paces as a live table', () => {
  assert.match(practiceSource, /Quick — 3\.5 seconds per move/);
  assert.match(practiceSource, /Yard — 10 seconds per move/);
  assert.match(practiceSource, /Relaxed — 20 seconds per move/);
  assert.match(practiceSource, /duppyPace\.value = 'yard'/);
});

test('practice Duppies sit visibly at their physical table edges', () => {
  assert.match(practiceSource, /function practiceDuppyIdentity/);
  assert.match(practiceSource, /duppyPersonaUrl\(duppyPersona\(level, seat\)\)/);
  assert.match(practiceSource, /DUPPY_LABELS\[level\].*AI opponent/);
});

test('practice leaves a named record of the last non-winning play during the reading beat', () => {
  assert.ok(practiceSource.includes('`${g.seatLabel(recentPlaySeat)} · ${recentPlayedTile}`'));
  assert.match(practiceSource, /setTimeout\([\s\S]*?\}, 2_500\)/);
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
