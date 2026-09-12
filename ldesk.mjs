import { chromium } from 'playwright';
const FMT = process.argv[2] || 'french';
const b = await chromium.launch({ args: ['--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling'] });
const p = await b.newPage({ viewport:{width:1920,height:1080}, deviceScaleFactor:1 });
await p.goto('http://127.0.0.1:4200/', { waitUntil:'networkidle' });
await p.waitForTimeout(1000);
await p.getByRole('button', { name:'Skip for now' }).click().catch(()=>{});
await p.waitForTimeout(300);
await p.getByRole('button', { name:/^Lounges$/ }).first().click().catch(()=>{});
await p.waitForTimeout(2500);
const yr=p.locator('input[type="number"], input[type="text"], select').first();
if (await yr.count()) await yr.fill('1985').catch(()=>{});
await p.getByRole('button', { name:/^Continue$/ }).click().catch(()=>{});
await p.waitForTimeout(4000);
await p.getByRole('button', { name:/^Enter$/ }).first().click().catch(()=>{});
await p.waitForTimeout(3500);
await p.getByText(/SEATS, CLOCK & DUPPIES/i).click().catch(()=>{});
await p.waitForTimeout(600);
for (const s of await p.locator('select').all()) {
  const vals = await s.evaluate(e => Array.from(e.options).map(o=>o.value));
  if (vals.includes(FMT)) { await s.selectOption(FMT); break; }
}
await p.waitForTimeout(500);
await p.getByRole('button', { name:/^Start table$/ }).click().catch(()=>{});
await p.waitForTimeout(7000);
await p.getByRole('button', { name:/^Start hand$/ }).click().catch(()=>{});
await p.waitForTimeout(9000);
for (let i=0;i<16;i++){
  const ends=p.locator('.in-felt-actions button:visible');
  if(await ends.count()){await ends.first().click().catch(()=>{});await p.waitForTimeout(260);continue;}
  const t=p.locator('.my-hand-panel .hand .tile:not(.dead)').first();
  if(await t.count())await t.click().catch(()=>{});
  await p.waitForTimeout(600);
}
const r = await p.evaluate(() => {
  const sz = e => e ? (r=>Math.round(Math.min(r.width,r.height)))(e.getBoundingClientRect()) : 0;
  const box = e => e ? (r=>`${Math.round(r.width)}x${Math.round(r.height)}`)(e.getBoundingClientRect()) : '-';
  const st=document.querySelector('.board-stage');
  return { n:document.querySelectorAll('.line .tile').length,
    room: box(document.querySelector('.table-room')),
    cross: box(document.querySelector('.table-cross')),
    feltShell: box(document.querySelector('.felt-shell')),
    felt: box(document.querySelector('.live-felt')),
    stage: box(st), inset: st?st.style.inset:'-',
    boardBone: sz(document.querySelector('.line .tile')),
    handBone: sz(document.querySelector('.my-hand-panel .hand .tile')),
    rack: sz(document.querySelector('.table-player-station-left .backs i')),
    pans: st?((st.scrollWidth>st.clientWidth+1)||(st.scrollHeight>st.clientHeight+1)):false };
});
console.log(`LOUNGE ${FMT} 1920x1080`);
console.log(JSON.stringify(r, null, 1));
await b.close();
