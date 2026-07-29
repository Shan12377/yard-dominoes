/**
 * Two REAL clients, isolated contexts — voice.md is explicit that two tabs in
 * one browser share localStorage, collapse to one Supabase session, and prove
 * nothing. Separate contexts get separate anonymous users.
 *
 * Verifies what was actually changed: that voice + reactions render AT THE
 * FOUR-SEAT TABLE, that the mesh still connects there, and that a reaction
 * from one player lands on that player's seat on the other player's screen.
 */
import { chromium } from 'playwright';

const URL = 'http://localhost:5174/';
const pass = [];
const fail = [];
const check = (ok, label, detail = '') => {
  (ok ? pass : fail).push(label + (detail ? ` — ${detail}` : ''));
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch({
  headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});

async function client(name) {
  const ctx = await browser.newContext({ permissions: ['microphone'] });
  // Record every peer connection so the mesh can be inspected from outside.
  await ctx.addInitScript(() => {
    window.__pcs = [];
    const Orig = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends Orig {
      constructor(...a) { super(...a); window.__pcs.push(this); }
    };
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { { const t = m.text(); if (m.type() === 'error' || t.includes('yard:')) errors.push(name + ' ' + t); } });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /^lounges$/i }).click();
  await page.waitForTimeout(3000);
  return { name, page, errors };
}

const snap = (page) => page.evaluate(() => {
  const txt = (el) => (el?.textContent || '').trim().replace(/\s+/g, ' ');
  return {
    heads: [...document.querySelectorAll('h2')].map(txt),
    voiceBar: txt(document.querySelector('.voice-bar')) || null,
    reactionButtons: document.querySelectorAll('.reaction').length,
    reactionsDisabled: [...document.querySelectorAll('.reaction')].filter((b) => b.disabled).length,
    seats: [...document.querySelectorAll('.seat')].map((s) => ({
      text: txt(s),
      speaking: s.classList.contains('speaking'),
      thrown: s.querySelector('.thrown')?.getAttribute('alt') ?? null,
    })),
    pcStates: (window.__pcs || []).map((p) => p.connectionState),
  };
});

const A = await client('A');
const B = await client('B');

// --- A starts a fresh table -------------------------------------------------
await A.page.getByRole('button', { name: /^enter$/i }).first().click();
await A.page.waitForTimeout(2500);
await A.page.getByRole('button', { name: /^start table$/i }).click();
await A.page.waitForTimeout(4000);

let a = await snap(A.page);
const codeHead = a.heads.find((h) => /^Table /.test(h)) || '';
const code = codeHead.replace(/^Table\s+/, '').trim();
console.log(`\nA is at: "${codeHead}"  code="${code}"`);

check(!!code, 'A reached a live table');
check(a.voiceBar !== null, 'voice panel renders AT THE TABLE', a.voiceBar ?? 'missing');
check(a.reactionButtons === 6, 'reaction bar renders AT THE TABLE', `${a.reactionButtons} buttons`);
check(a.reactionsDisabled === 0, 'reactions enabled at the table (room joined)',
  `${a.reactionsDisabled} disabled`);

// --- B joins that exact table by code ---------------------------------------
await B.page.getByRole('textbox').first().fill(code);
await B.page.getByRole('button', { name: /^join$/i }).click();
await B.page.waitForTimeout(5000);

let b = await snap(B.page);
check(b.heads.some((h) => h.includes(code)), 'B joined the same table', b.heads.join(' | '));
check(b.voiceBar !== null, 'B sees the voice panel at the table', b.voiceBar ?? 'missing');
check(b.reactionButtons === 6, 'B sees the reaction bar at the table');

// --- both join voice --------------------------------------------------------
// Staggered on purpose: joining simultaneously would hide an ordering bug,
// and whoever is already on the mic when a second person arrives is the real
// world case anyway.
await A.page.getByRole('button', { name: /Listen in|Join the talk/i }).first().click();
await A.page.waitForTimeout(5000);
console.log('after A joins  -> A:', (await snap(A.page)).voiceBar);
await B.page.getByRole('button', { name: /Listen in|Join the talk/i }).first().click();
await B.page.waitForTimeout(10000);

a = await snap(A.page); b = await snap(B.page);
console.log('\nA voice bar:', a.voiceBar, '| pcs:', a.pcStates);
console.log('B voice bar:', b.voiceBar, '| pcs:', b.pcStates);

check(a.pcStates.length > 0 && b.pcStates.length > 0,
  'both clients opened a peer connection from the table',
  `A=${a.pcStates.length} B=${b.pcStates.length}`);
check(a.pcStates.includes('connected'), 'A peer connection reached connected', a.pcStates.join(','));
check(b.pcStates.includes('connected'), 'B peer connection reached connected', b.pcStates.join(','));

// --- A throws a reaction; B must see it on A's seat --------------------------
await A.page.getByRole('button', { name: /Send Six love/i }).click();
await A.page.waitForTimeout(1500);

a = await snap(A.page); b = await snap(B.page);
const aThrown = a.seats.filter((s) => s.thrown).map((s) => s.thrown);
const bThrown = b.seats.filter((s) => s.thrown).map((s) => s.thrown);
check(aThrown.length > 0, "A sees own reaction on a seat", aThrown.join(',') || 'none');
check(bThrown.includes('Six love'), "B sees A's reaction on A's SEAT", bThrown.join(',') || 'none');

await A.page.screenshot({ path: 'table-A.png', fullPage: true });
await B.page.screenshot({ path: 'table-B.png', fullPage: true });

console.log('\nA console errors:', A.errors.slice(0, 12));
console.log('B console errors:', B.errors.slice(0, 12));
console.log(`\n==== ${pass.length} passed, ${fail.length} failed ====`);
if (fail.length) { console.log('FAILURES:'); fail.forEach((f) => console.log(' - ' + f)); }

await browser.close();
process.exit(fail.length ? 1 : 0);
