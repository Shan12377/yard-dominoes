/**
 * Phase 2: two SPEAKING clients (Yardie tier) with fake microphones.
 *
 * Proves what signalling alone cannot: that audio actually leaves one phone
 * and arrives at the other, and that mute really stops transmitting rather
 * than only changing the button — voice.md calls that the worst bug this
 * feature can have, because someone gets overheard believing they are muted.
 */
import { chromium } from 'playwright';

const URL = 'http://localhost:5174/';
const pass = [], fail = [];
const check = (ok, label, detail = '') => {
  (ok ? pass : fail).push(label);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch({
  headless: true,
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
});

async function client(name) {
  const ctx = await browser.newContext({
    storageState: `state-${name}.json`, permissions: ['microphone'],
  });
  await ctx.addInitScript(() => {
    window.__pcs = [];
    const Orig = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends Orig {
      constructor(...a) { super(...a); window.__pcs.push(this); }
    };
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /^lounges$/i }).click();
  await page.waitForTimeout(4000);
  return { name, page, errors };
}

const audio = (page) => page.evaluate(async () => {
  const out = { inEnergy: 0, inBytes: 0, outBytes: 0, outPackets: 0 };
  for (const pc of window.__pcs || []) {
    const r = await pc.getStats();
    r.forEach((s) => {
      if (s.type === 'inbound-rtp' && s.kind === 'audio') {
        out.inEnergy += s.totalAudioEnergy || 0;
        out.inBytes += s.bytesReceived || 0;
      }
      if (s.type === 'outbound-rtp' && s.kind === 'audio') {
        out.outBytes += s.bytesSent || 0;
        out.outPackets += s.packetsSent || 0;
      }
    });
  }
  return out;
});

const bar = (page) => page.evaluate(() =>
  (document.querySelector('.voice-bar')?.textContent || '').replace(/\s+/g, ' ').trim());

const A = await client('A');
const B = await client('B');

// A opens a table, B joins it by code.
await A.page.getByRole('button', { name: /^enter$/i }).first().click();
await A.page.waitForTimeout(2500);
await A.page.getByRole('button', { name: /^start table$/i }).click();
await A.page.waitForTimeout(4000);
const code = (await A.page.evaluate(() =>
  [...document.querySelectorAll('h2')].map((h) => h.textContent).find((t) => /^Table /.test(t)) || ''))
  .replace(/^Table\s+/, '').trim();
await B.page.getByRole('textbox').first().fill(code);
await B.page.getByRole('button', { name: /^join$/i }).click();
await B.page.waitForTimeout(5000);
console.log(`table ${code}`);

check(/Join the talk/i.test(await bar(A.page)),
  'Yardie is offered the mic, not listen-only', await bar(A.page));

for (const c of [A, B]) {
  const btn = c.page.getByRole('button', { name: /Join the talk|Listen in/i });
  if (await btn.count()) await btn.first().click();
  await c.page.waitForTimeout(2500);
}
await A.page.waitForTimeout(9000);

const barA = await bar(A.page), barB = await bar(B.page);
console.log('A bar:', barA, '\nB bar:', barB);
check(/Mute/i.test(barA) && /Mute/i.test(barB),
  'both hold a real microphone (not listen-only)');

const a1 = await audio(A.page), b1 = await audio(B.page);
await A.page.waitForTimeout(6000);
const a2 = await audio(A.page), b2 = await audio(B.page);

console.log('A', a1, '->', a2);
console.log('B', b1, '->', b2);

check(a2.outPackets > 0 && b2.outPackets > 0, 'both are sending audio packets',
  `A=${a2.outPackets} B=${b2.outPackets}`);
check(a2.inBytes > a1.inBytes && b2.inBytes > b1.inBytes,
  'audio bytes are ARRIVING at the far end', `A +${a2.inBytes - a1.inBytes}B  B +${b2.inBytes - b1.inBytes}B`);
const energyA = a2.inEnergy - a1.inEnergy, energyB = b2.inEnergy - b1.inEnergy;
check(energyA > 0 && energyB > 0, 'the arriving audio carries real sound energy',
  `A +${energyA.toFixed(4)} B +${energyB.toFixed(4)}`);

// --- mute must actually stop transmitting -----------------------------------
await A.page.getByRole('button', { name: /^Mute$/i }).first().click();
await A.page.waitForTimeout(1500);
const b3 = await audio(B.page);
await B.page.waitForTimeout(6000);
const b4 = await audio(B.page);
const mutedEnergy = b4.inEnergy - b3.inEnergy;
console.log(`B inbound energy while A muted: +${mutedEnergy.toFixed(6)} (was +${energyB.toFixed(4)})`);
check(mutedEnergy < energyB * 0.05,
  'MUTE really stops transmitting, not just the button',
  `+${mutedEnergy.toFixed(6)} vs +${energyB.toFixed(4)} unmuted`);

// --- leaving must stop the microphone ---------------------------------------
await A.page.getByRole('button', { name: /Leave voice/i }).first().click();
await A.page.waitForTimeout(2500);
const live = await A.page.evaluate(() => {
  let n = 0;
  for (const pc of window.__pcs || []) {
    pc.getSenders().forEach((s) => { if (s.track && s.track.readyState === 'live') n++; });
  }
  return n;
});
check(live === 0, 'leaving voice stops every track (no recording light left on)',
  `${live} live sender tracks`);

console.log('\npage errors A:', A.errors, 'B:', B.errors);
console.log(`\n==== ${pass.length} passed, ${fail.length} failed ====`);
fail.forEach((f) => console.log(' - ' + f));
await browser.close();
process.exit(fail.length ? 1 : 0);
