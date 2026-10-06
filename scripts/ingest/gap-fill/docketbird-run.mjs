// Continuous, checkpointed DocketBird run over the Tier-1 master dockets (owner decision 2026-10-06): for each case in order, follow it (logged before and
// after with the exact response), then repeat { pull up to the next 2,000 PDFs, register them, land the new sheet rows as evidence, project into
// sw_docket_documents_v1, write a report line } until the case is complete. It continues automatically; it STOPS (and writes stop.json) on any
// non-success status other than a recorded "document not found", on any API-reported charge amount, or on a repeated rate limit.
//   node docketbird-run.mjs --work=<dir> --cases=<id,id,...> [--chunk=2000] [--project-stage=<dir,dir>] [--store=<dir>]
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {atomicWriteJson, readJson, appendJsonl, sleep} from './lib.mjs';
import {followCase} from './docketbird-follow.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const exec = (script, args) => new Promise(resolve => { const p = spawn('node', [script, ...args], {stdio: ['ignore', 'inherit', 'inherit']}); p.on('exit', code => resolve(code)); });
const RUN_3E9 = '3e9f9e50-1ef8-4410-a91d-96a194666c82';

export const isRateStop = text => /RATE_LIMIT/.test(String(text ?? ''));

async function lines(file, from) {
  const buf = await fs.readFile(file).catch(() => Buffer.alloc(0));
  const end = buf.lastIndexOf(10) + 1;
  return {text: buf.subarray(from, end).toString('utf8'), end};
}

export async function main(argv) {
  const args = Object.fromEntries(argv.map(a => { const i = a.indexOf('='); return i < 0 ? [a.replace(/^--/, ''), true] : [a.slice(2, i), a.slice(i + 1)]; }));
  const work = path.resolve(args.work), cases = String(args.cases).split(',').filter(Boolean), chunk = Number(args.chunk ?? 2000);
  const key = process.env.DOCKETBIRD_API_KEY; if (!key) throw new Error('DOCKETBIRD_API_KEY is required');
  const runFile = path.join(work, 'run-state.json'), ledger = path.join(work, 'follow-ledger.jsonl'), reports = path.join(work, 'chunk-reports.jsonl');
  const rs = await readJson(runFile, {followed: {}, landed: {docs: 0, cases: 0}, chunks: 0});
  const save = () => atomicWriteJson(runFile, rs);
  // First run: whatever is already in the stage files was landed by hand before this orchestrator existed.
  if (rs.landed.docs_bytes === undefined) for (const [f, k] of [['case.jsonl', 'cases'], ['docket-document.jsonl', 'docs']]) rs.landed[k + '_bytes'] = (await lines(path.join(work, 'stage/docketbird-rest', f), 0)).end;
  const stop = async (reason, extra = {}) => { await atomicWriteJson(path.join(work, 'stop.json'), {stopped_at: new Date().toISOString(), reason, ...extra}); console.log(JSON.stringify({STOPPED: reason, ...extra})); process.exitCode = 3; };
  const stageDir = path.join(work, 'stage/docketbird-rest');
  const store = args.store ? path.resolve(args.store) : null;

  const postChunk = async caseId => {
    // register every transferred receipt, land only the new rows, then project the dataset
    await exec(path.join(here, '../../admin/register-private-pdf-assets.mjs'), [`--transfers=${path.join(work, 'transfer')}`, `--out=${path.join(work, 'registration')}`]);
    const delta = path.join(work, 'delta/docketbird-rest'); await fs.rm(path.join(work, 'delta'), {recursive: true, force: true}); await fs.mkdir(delta, {recursive: true});
    let landedRows = 0;
    for (const [f, k] of [['case.jsonl', 'cases'], ['docket-document.jsonl', 'docs']]) {
      const {text, end} = await lines(path.join(stageDir, f), rs.landed[k + '_bytes'] ?? 0);
      if (text) { await fs.writeFile(path.join(delta, f), text); landedRows += text.split('\n').filter(Boolean).length; }
      rs.landed[k + '_next'] = end;
    }
    if (landedRows) {
      let c = await exec(path.join(here, 'send-staged.mjs'), ['--provider=docketbird', `--stage=${path.join(work, 'delta')}`, `--run=${RUN_3E9}`, '--apply']);
      if (c === 0) c = await exec(path.join(here, 'send-staged.mjs'), ['--provider=docketbird', `--stage=${path.join(work, 'delta')}`, `--run=${RUN_3E9}`, '--apply', '--verify']);
      if (c !== 0) return {ok: false, reason: 'EVIDENCE_LANDING_FAILED'};
    }
    for (const k of ['cases', 'docs']) rs.landed[k + '_bytes'] = rs.landed[k + '_next'];
    const pc = await exec(path.join(here, 'project-docketbird-documents.mjs'), [`--stage=${args['project-stage'] ?? stageDir.replace(/\/docketbird-rest$/, '')}`, `--ledger=${path.join(work, 'removed-rows-ledger.jsonl')}`]);
    if (pc !== 0) return {ok: false, reason: 'PROJECTION_FAILED'};
    await save();
    return {ok: true, landedRows};
  };

  for (const caseId of cases) {
    const ck0 = await readJson(path.join(work, 'checkpoint.json'), {cases: {}, totals: {pdfs_cloud_verified: 0}});
    if (ck0.cases[caseId]?.complete) continue;
    if (!rs.followed[caseId]) {
      // A case the account can already read (tracked earlier) is never followed again: a second follow could be billed twice.
      const probe = await fetch(`https://api.docketbird.com/cases/${encodeURIComponent(caseId).replace(/%3A/gi, ':')}`, {headers: {Authorization: `Bearer ${key}`}, signal: AbortSignal.timeout(60000)});
      await appendJsonl(ledger, {event: 'access_probe', case_id: caseId, at: new Date().toISOString(), status: probe.status});
      if (probe.status === 200) { rs.followed[caseId] = 'already_accessible'; await save(); }
    }
    if (!rs.followed[caseId]) {
      const r = await followCase({caseId, ledger, key});
      let body = null; try { body = JSON.parse(r.body); } catch { /* not JSON */ }
      if (r.status !== 200 || body?.status !== 'success' || r.amounts_reported.length) return stop('FOLLOW_NOT_SUCCESS_OR_CHARGE', {case_id: caseId, status: r.status, body: r.body, amounts: r.amounts_reported});
      rs.followed[caseId] = r.at; await save();
    }
    for (let tries = 0; ; ) {
      const ck = await readJson(path.join(work, 'checkpoint.json'), {cases: {}, totals: {pdfs_cloud_verified: 0}});
      if (ck.cases[caseId]?.complete) break;
      const target = (ck.totals.pdfs_cloud_verified ?? 0) + chunk;
      const code = await exec(path.join(here, 'docketbird-pull.mjs'), [`--work=${work}`, `--case=${caseId}`, `--stop-at-pdfs=${target}`, '--min-gap-ms=250']);
      const after = await readJson(path.join(work, 'checkpoint.json'), {cases: {}, totals: {}});
      if (code !== 0) {
        const pullLog = await readJson(path.join(work, 'last-stop.json'), {});
        if (isRateStop(pullLog.stopped) && ++tries <= 6) { await appendJsonl(reports, {event: 'rate_limit_wait', case_id: caseId, at: new Date().toISOString(), tries}); await sleep(600000); continue; }
        return stop('PULL_STOPPED', {case_id: caseId, detail: pullLog.stopped ?? `exit ${code}`});
      }
      tries = 0;
      const post = await postChunk(caseId);
      if (!post.ok) return stop(post.reason, {case_id: caseId});
      rs.chunks++; await save();
      const st = after.cases[caseId] ?? {};
      const line = {event: 'chunk_report', at: new Date().toISOString(), chunk: rs.chunks, case_id: caseId, case_read: Object.keys(st.details_done ?? {}).length, case_enumerated: st.search?.ids?.length ?? null, case_found: st.search?.found ?? null, case_complete: Boolean(st.complete),
        totals: after.totals, rows_landed_this_chunk: post.landedRows};
      await appendJsonl(reports, line); console.log(JSON.stringify(line));
      if (store) { await fs.mkdir(store, {recursive: true}); for (const f of ['follow-ledger.jsonl', 'chunk-reports.jsonl', 'checkpoint.json', 'run-state.json', 'cost-ledger.jsonl']) await fs.copyFile(path.join(work, f), path.join(store, f === 'checkpoint.json' ? 'pull-checkpoint.json' : f)).catch(() => {}); }
      if (st.complete) break;
    }
  }
  console.log(JSON.stringify({DONE: true}));
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2)).catch(e => { console.error(String(e.message ?? e).replace(/[A-Za-z0-9]{32,}/g, '[redacted]')); process.exitCode = 1; });
