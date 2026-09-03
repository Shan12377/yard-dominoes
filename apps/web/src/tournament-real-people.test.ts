import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const start = read('supabase/functions/start-hand/index.ts');
const advance = read('supabase/functions/advance-duppy/index.ts');
const expire = read('supabase/functions/expire-turns/index.ts');
const rating = read('supabase/functions/_shared/apply-rating.ts');
const host = read('supabase/functions/tournament-host/index.ts');

/**
 * A tournament here is a scheduled EVENT played by real people — never a way
 * to play, and never against a bot.
 *
 * The teeth behind that are three server guards plus one fact about rating,
 * and the fact is what makes the guards load-bearing rather than cosmetic:
 * `apply-rating.ts` refuses to rate a set containing ANY duppy seat, so a
 * round played out against a no-show's placeholder would count for nobody.
 * Losing any one of these guards turns the flagship competitive event into
 * unranked games without a single error being raised.
 */
test('a tournament hand is never dealt while a placeholder seat is unfilled', () => {
  assert.match(start, /if \(table\.tournament_id\) \{/);
  assert.match(start, /placeholders = seats!\.filter\(\(s: any\) => !s\.user_id\)/);
  assert.match(start, /throw new HttpError\(409,[\s\S]{0,200}?real people/);
});

test('no bot ever takes a turn on a tournament table', () => {
  // Client-driven duppy turns are refused outright there...
  assert.match(advance, /if \(table!\.tournament_id\) \{[\s\S]{0,200}?throw new HttpError\(409/);
  // ...and the cron steps over an unfilled seat rather than playing it. A
  // timed-out HUMAN seat still gets a legal move: that is the standing rule,
  // and without it one absent player could stall a whole event.
  assert.match(expire, /if \(table!\.tournament_id && !seats!\[timedOut\]\.user_id\) continue;/);
  assert.match(expire, /duppyMove\(state, seats!\[timedOut\]\.duppy_level \?\? 'yard'\)/);
});

test('rating still refuses any set holding a duppy seat — the reason the guards matter', () => {
  assert.match(rating, /humanIds\.length !== seatUsers\.length\) return/);
});

test('the retired casual/tournament rules flag is not written back anywhere', () => {
  // `tables.tournament` meant "force the six", which every table does anyway.
  // It is left in the schema unwritten; nothing should set it again, least of
  // all the host, whose tables ARE the event sense of the word.
  assert.doesNotMatch(host, /\btournament: true\b/);
  assert.doesNotMatch(start, /table\.tournament\b(?!_id)/);
  assert.doesNotMatch(advance, /table!\.tournament\b(?!_id)/);
  assert.doesNotMatch(expire, /table!\.tournament\b(?!_id)/);
});
