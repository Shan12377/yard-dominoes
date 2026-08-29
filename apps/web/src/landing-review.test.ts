import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

test('the landing review is responsive text, not a screenshot or a temporary player id', () => {
  assert.match(main, /function playerReview\(\): HTMLElement/);
  assert.match(main, /document\.createElement\('blockquote'\)/);
  assert.match(main, /Super cool real domino game!!/);
  assert.match(main, /rating\.setAttribute\('aria-label', '5 out of 5 stars'\)/);
  assert.match(main, /next\.appendChild\(playerReview\(\)\)/);
  assert.doesNotMatch(main, /player_1597c7f6|20h ago/);
});

test('the landing page states every public referral reward without overstating eligibility', () => {
  assert.match(main, /function referralCallout\(\): HTMLElement/);
  assert.match(main, /When a friend becomes a paid member/);
  assert.match(main, /5% commission on their first payment and every renewal/);
  assert.match(main, /plus 100 coins/);
  assert.match(main, /They get 5% off that first payment too/);
  assert.match(main, /next\.appendChild\(referralCallout\(\)\)/);
  assert.match(main, /action\.textContent = 'Get my referral link'/);
  assert.match(main, /loungeModule\.openReferralSection\(\)/);
});
