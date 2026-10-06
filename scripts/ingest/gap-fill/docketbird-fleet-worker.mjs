// Shard worker: CSV inventory first, then checkpointed PDF pulls for assigned cases only (disjoint partition).
//   node docketbird-fleet-worker.mjs --work=<dir> --shard=<n> --universe=<dir> [--chunk=2000] [--exclude=case]
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {appendJsonl, readJson, atomicWriteJson} from './lib.mjs';
import {landCaseInventory} from './docketbird-document-list.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const RUN = '3e9f9e50-1ef8-4410-a91d-96a194666c82';
const exec = (script, args) => new Promise(resolve => { const p = spawn('node', [script, ...args], {stdio: ['ignore', 'inherit', 'inherit']}); p.on('exit', code => resolve(code)); });

async function waitFollow(work, caseId) {
  const state = path.join(work, 'follow-state.json');
  const queue = path.join(work, 'follow-queue.jsonl');
  await appendJsonl(queue, {case_id: caseId, at: new Date().toISOString()});
  for (let i = 0; i < 720; i++) {
    const st = await readJson(state, {});
    if (st.stopped) throw new Error(`FOLLOW_COORDINATOR_STOPPED ${JSON.stringify(st.stopped)}`);
    if (st.done?.[caseId]) return st.done[caseId];
    await new Promise(r => setTimeout(r, 5000));
  }
  throw new Error('FOLLOW_TIMEOUT');
}

export async function main(argv) {
  const args = Object.fromEntries(argv.map(a => { const i = a.indexOf('='); return i < 0 ? [a.replace(/^--/, ''), true] : [a.slice(2, i), a.slice(i + 1)]; }));
  const work = path.resolve(args.work);
  const universeDir = path.resolve(args.universe);
  const shard = Number(args.shard);
  const chunk = Number(args.chunk ?? 2000);
  const exclude = new Set(String(args.exclude ?? '').split(',').map(s => s.trim()).filter(Boolean));
  const part = await readJson(path.join(universeDir, `partition-shard-${shard}-of-${Number(args.shards ?? 4)}.json`));
  const cases = part.case_ids.filter(c => !exclude.has(c));
  const fleet = path.resolve(args.fleet ?? path.join(work, '..', 'db-fleet'));
  const progress = path.join(work, 'worker-progress.jsonl');
  for (const caseId of cases) {
    const caseWork = path.join(work, 'cases', caseId.replace(/[^A-Za-z0-9]/g, '_'));
    await fs.mkdir(caseWork, {recursive: true});
    let probe = await fetch(`https://api.docketbird.com/cases/${encodeURIComponent(caseId)}`, {headers: {Authorization: `Bearer ${process.env.DOCKETBIRD_API_KEY}`}, signal: AbortSignal.timeout(60000)});
    if (probe.status === 429) { await new Promise(r => setTimeout(r, 60000)); probe = await fetch(`https://api.docketbird.com/cases/${encodeURIComponent(caseId)}`, {headers: {Authorization: `Bearer ${process.env.DOCKETBIRD_API_KEY}`}, signal: AbortSignal.timeout(60000)}); }
    if (probe.status !== 200) await waitFollow(fleet, caseId);
    const inv = await landCaseInventory({work: caseWork, caseId, stageDir: path.join(caseWork, 'stage/docketbird-rest'), runId: RUN, apply: true});
    await appendJsonl(progress, {event: 'inventory', case_id: caseId, ...inv});
    for (;;) {
      const ck = await readJson(path.join(caseWork, 'checkpoint.json'), {cases: {}, totals: {pdfs_cloud_verified: 0}});
      if (ck.cases[caseId]?.complete) break;
      const target = (ck.totals.pdfs_cloud_verified ?? 0) + chunk;
      const code = await exec(path.join(here, 'docketbird-pull.mjs'), [`--work=${caseWork}`, `--case=${caseId}`, `--stop-at-pdfs=${target}`, '--min-gap-ms=250']);
      if (code !== 0) {
        const stop = await readJson(path.join(caseWork, 'last-stop.json'), {});
        await appendJsonl(progress, {event: 'pull_stop', case_id: caseId, stop});
        if (/NEW_CHARGE_AMOUNT|FOLLOW/.test(stop.stopped ?? '')) process.exitCode = 3;
        break;
      }
      await exec(path.join(here, '../../admin/register-private-pdf-assets.mjs'), [`--transfers=${path.join(caseWork, 'transfer')}`, `--out=${path.join(caseWork, 'registration')}`]);
      const delta = path.join(caseWork, 'delta'); await fs.rm(delta, {recursive: true, force: true});
      await fs.mkdir(path.join(delta, 'docketbird-rest'), {recursive: true});
      const stage = path.join(caseWork, 'stage/docketbird-rest');
      for (const f of ['case.jsonl', 'docket-document.jsonl']) {
        const txt = await fs.readFile(path.join(stage, f), 'utf8').catch(() => '');
        if (txt.trim()) await fs.writeFile(path.join(delta, 'docketbird-rest', f), txt);
      }
      await exec(path.join(here, 'send-staged.mjs'), ['--provider=docketbird', `--stage=${delta}`, `--run=${RUN}`, '--apply']);
      await exec(path.join(here, 'project-docketbird-documents.mjs'), [`--stage=${path.join(caseWork, 'stage')}`, `--ledger=${path.join(caseWork, 'removed-rows-ledger.jsonl')}`]);
      const ck2 = await readJson(path.join(caseWork, 'checkpoint.json'), {cases: {}});
      await appendJsonl(progress, {event: 'chunk', case_id: caseId, complete: Boolean(ck2.cases[caseId]?.complete), pdfs: ck2.totals?.pdfs_cloud_verified});
      if (ck2.cases[caseId]?.complete) break;
    }
  }
  console.log(JSON.stringify({DONE: true, shard, cases: cases.length}));
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2)).catch(e => { console.error(String(e.message ?? e)); process.exitCode = 1; });
