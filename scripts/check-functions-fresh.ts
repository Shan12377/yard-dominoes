/**
 * Which Edge Functions are running older code than the repository holds.
 *
 * Found the hard way (2026-09-16): `pass-pose` had been rewritten on 09-12 to
 * pass the pose AFTER the deal, but the deployed copy was from 08-07, so a
 * player's "Pass to partner" hit the old logic and the pose stayed put. The
 * same trap catches every function when `_shared/` changes, because the CLI
 * bundles that per function at deploy time.
 *
 *   SUPABASE_ACCESS_TOKEN=... node scripts/check-functions-fresh.ts
 *
 * Exits 1 when anything is stale, so it can gate a release.
 */
import { execFileSync } from 'node:child_process';

const PROJECT = process.env.SUPABASE_PROJECT_REF ?? 'iqixdijhckgilvyhduxb';

const lastChange = (path: string): number => {
  const out = execFileSync('git', ['log', '-1', '--format=%ct', '--', path], { encoding: 'utf8' }).trim();
  return out ? Number(out) * 1000 : 0;
};

const listed = execFileSync('npx', ['supabase', 'functions', 'list', '--project-ref', PROJECT], { encoding: 'utf8' });
const functions = JSON.parse(listed).functions as Array<{ slug: string; updated_at: number }>;
const shared = lastChange('supabase/functions/_shared');

const stale = functions
  .map((fn) => ({ fn, changed: Math.max(lastChange(`supabase/functions/${fn.slug}`), shared) }))
  .filter(({ fn, changed }) => changed > 0 && fn.updated_at < changed);

const when = (ms: number) => new Date(ms).toISOString().slice(0, 10);
if (!stale.length) {
  console.log(`Every Edge Function runs current code (shared last changed ${when(shared)}).`);
  process.exit(0);
}
console.log('These functions are running older code than the repository holds:\n');
for (const { fn, changed } of stale) {
  console.log(`  ${fn.slug.padEnd(20)} deployed ${when(fn.updated_at)}  source ${when(changed)}`);
}
console.log(`\nRedeploy them:\n  npx supabase functions deploy ${stale.map((s) => s.fn.slug).join(' ')} --project-ref ${PROJECT}`);
process.exit(1);
