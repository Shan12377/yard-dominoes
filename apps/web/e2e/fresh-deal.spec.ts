import { test, expect, type Page } from '@playwright/test';

/**
 * Regression coverage for the fresh-deal tile race fixed 2026-08-26 (see
 * client.md's "Realtime" section) — and the broader class it belongs to.
 * This is the one path packages/engine's 297 pure-function tests cannot
 * reach: a real Supabase Realtime round trip in a real browser. Runs
 * against a real project via guest sign-in (ensureSignedIn() in online.ts
 * needs no credentials at all), so it needs no test-account setup.
 *
 * Tiles render as `<div class="tile" role="img" aria-label="A B">`, not a
 * literal `<img>` element — render.ts's tileEl(). Select on `.tile`.
 */

async function startCutThroatTableWithDuppies(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Lounges' }).click();

  // A fresh session (no age confirmed yet on this device) hits the age
  // gate before it can reach a lounge at all — see legal.ts's ageGate().
  const yearField = page.getByRole('spinbutton', { name: 'Year of birth' });
  if (await yearField.isVisible().catch(() => false)) {
    await yearField.fill('1995');
    await page.getByRole('button', { name: 'Continue' }).click();
  }

  await page.locator('.lounge-card', { hasText: 'Cut Throat Yard' })
    .getByRole('button', { name: 'Enter' }).click();

  await page.getByLabel('Game', { exact: false }).selectOption('Cut throat');
  await page.getByRole('button', { name: 'Start table' }).click();
  await page.getByRole('button', { name: 'Start hand' }).click();
}

test('a fresh deal shows my hand, not an empty panel', async ({ page }) => {
  await startCutThroatTableWithDuppies(page);

  const myHand = page.locator('.my-hand-panel');
  await expect(myHand).toBeVisible({ timeout: 20_000 });
  // Seven tiles, real values — not just "the panel exists but is empty",
  // which is exactly the shape the live bug took (panel rendered, zero tiles).
  await expect(myHand.locator('.tile')).toHaveCount(7, { timeout: 20_000 });
});

test('reloading mid-hand still shows my hand', async ({ page }) => {
  await startCutThroatTableWithDuppies(page);
  await expect(page.locator('.my-hand-panel .tile')).toHaveCount(7, { timeout: 20_000 });

  // Exercises open()'s initial loadPrivateTiles() path fresh, on a hand
  // that already exists rather than one just dealt in this same session —
  // a different code path than the fresh-deal fix, worth covering
  // separately since it's the same class of "do I actually have my tiles."
  await page.reload();

  const myHand = page.locator('.my-hand-panel');
  await expect(myHand).toBeVisible({ timeout: 20_000 });
  await expect(myHand.locator('.tile')).toHaveCount(7, { timeout: 20_000 });
});
