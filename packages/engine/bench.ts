import { createSet, applyHandResult } from './src/set.ts';
import { deal, legalMoves, applyMove } from './src/hand.ts';
import { provablyFairShuffle } from './src/shuffle.ts';
import { dealPlan } from './src/tiles.ts';

function rngFrom(seed: number) {
  return () => { seed|=0; seed=(seed+0x6d2b79f5)|0; let t=Math.imul(seed^(seed>>>15),1|seed);
    t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; };
}

async function run(mode: any, format: any, seatCount: any, seed: number) {
  const rng = rngFrom(seed);
  let s = createSet({ mode, format, seatCount });
  const { removeDoubleBlank } = dealPlan(seatCount, false);
  let hands = 0, blocked = 0, ties = 0;
  while (s.winnerSide === null && hands < 200000) {
    hands++;
    const order = await provablyFairShuffle({
      serverSeed: `s${seed}`, clientSeeds: [`${hands}`], handId: `${hands}`, removeDoubleBlank });
    let h = deal({ order, seatCount, mode, useBoneyard: false,
      poser: s.poseMustBeDoubleSix ? undefined : s.poser,
      poseMustBeDoubleSix: s.poseMustBeDoubleSix });
    while (h.status === 'active') {
      const m = legalMoves(h); h = applyMove(h, m[Math.floor(rng()*m.length)]);
    }
    if (h.status === 'blocked') blocked++;
    if (h.result!.tie) ties++;
    s = applyHandResult(s, h.result!);
  }
  return { hands, blocked, ties };
}

for (const [mode, format, seats, label] of [
  ['partner','sixlove',4,'Partner · six love · 4p'],
  ['cutthroat','sixlove',4,'Cut throat · six love · 4p'],
  ['partner','firstToSix',4,'Partner · first to six · 4p'],
] as any[]) {
  const runs = [];
  for (let seed=1; seed<=30; seed++) runs.push(await run(mode, format, seats, seed));
  const hs = runs.map(r=>r.hands).sort((a,b)=>a-b);
  const med = hs[Math.floor(hs.length/2)];
  const mean = Math.round(hs.reduce((a,b)=>a+b,0)/hs.length);
  const blockPct = Math.round(100*runs.reduce((a,r)=>a+r.blocked,0)/runs.reduce((a,r)=>a+r.hands,0));
  const tiePct = (100*runs.reduce((a,r)=>a+r.ties,0)/runs.reduce((a,r)=>a+r.hands,0)).toFixed(1);
  console.log(`${label.padEnd(28)} median ${String(med).padStart(6)} hands | mean ${String(mean).padStart(6)} | max ${String(hs[hs.length-1]).padStart(6)} | blocked ${blockPct}% | tied ${tiePct}%`);
}
