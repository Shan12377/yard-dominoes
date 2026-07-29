/** Phase 1: sign two isolated clients in, persist their sessions, report ids. */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const URL = 'http://localhost:5174/';
const browser = await chromium.launch({ headless: true });

for (const name of ['A', 'B']) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /^lounges$/i }).click();
  await page.waitForTimeout(4000);

  const id = await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('sb-') && k.includes('auth-token')) {
        try {
          const v = JSON.parse(localStorage.getItem(k));
          if (v?.user?.id) return v.user.id;
        } catch { /* not the token */ }
      }
    }
    return null;
  });

  await ctx.storageState({ path: `state-${name}.json` });
  console.log(`${name}=${id}`);
  writeFileSync(`id-${name}.txt`, id ?? '');
  await ctx.close();
}

await browser.close();
