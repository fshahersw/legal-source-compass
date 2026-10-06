// Quarterly CourtListener dockets bulk re-match (owner decision B2, 2026-10-06). Stages, each failing loudly:
//   discover  newest quarter-end archive (last day of Mar/Jun/Sep/Dec) from the public S3 listing
//   download  fetch, then verify size AND the S3 (multipart) ETag; record sha256
//   open-run  corpus_gapfill_bulk_open_run_v1 with a deterministic run id; a different sha256 for the same date is rejected by the database
//   match     exact court+docket-key scan of the whole archive against the registry (match-docket-bulk.py)
//   evidence  decisions, `docket-bulk-match` evidence (schema /2) and `no_termination_recorded` evidence
//   land      send-staged.mjs --provider=bulk, then a --verify re-send (0 new versions)
//   project   blanks and termination-note phases only (never overwrites; conflicts and date corrections stay owner-gated)
//   finish    corpus_gapfill_bulk_finish_run_v1
// Credentials: EXTERNAL_SUPABASE_URL / EXTERNAL_SUPABASE_SERVICE_ROLE_KEY from the environment only.
//   node rematch.mjs --work=<dir> [--date=YYYY-MM-DD] [--stages=discover,download,...] [--dry-run]
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {BUCKET_URL, newestQuarterlyArchive, verifyDownload, sha256File, runIdFor, isQuarterEnd} from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const gap = path.resolve(here, '../gap-fill');
const ALL = ['discover', 'download', 'open-run', 'match', 'evidence', 'land', 'project', 'finish'];

const run = (cmd, args, opts = {}) => new Promise((resolve, reject) => {
  const p = spawn(cmd, args, {stdio: ['ignore', 'inherit', 'inherit'], ...opts});
  p.on('error', reject); p.on('exit', code => code === 0 ? resolve() : reject(new Error(`${cmd} ${path.basename(args[0] ?? '')} exited ${code}`)));
});

async function rpc(name, body) {
  const url = process.env.EXTERNAL_SUPABASE_URL, key = process.env.EXTERNAL_SUPABASE_KEY ?? process.env.EXTERNAL_SUPABASE_SERVICE_ROLE_KEY;
  if (url !== 'https://xosqzzsnhxcyehcnirpa.supabase.co' || !key) throw new Error('Wrong or missing corpus credentials');
  const r = await fetch(`${url}/rest/v1/rpc/${name}`, {method: 'POST', headers: {apikey: key, 'Content-Type': 'application/json'}, body: JSON.stringify(body), signal: AbortSignal.timeout(120000)});
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${name} HTTP ${r.status} ${data.code ?? ''} ${String(data.message ?? '').slice(0, 200)}`);
  return data;
}

export async function main(argv) {
  const args = Object.fromEntries(argv.map(a => { const i = a.indexOf('='); return i < 0 ? [a.replace(/^--/, ''), true] : [a.slice(2, i), a.slice(i + 1)]; }));
  const work = path.resolve(args.work ?? 'work'); await fs.mkdir(work, {recursive: true});
  const stages = (args.stages ?? ALL.join(',')).split(',');
  const cpFile = path.join(work, 'rematch-checkpoint.json');
  const cp = JSON.parse(await fs.readFile(cpFile, 'utf8').catch(() => '{}'));
  const save = () => fs.writeFile(cpFile, JSON.stringify(cp, null, 2));
  const out = (k, v) => process.env.GITHUB_OUTPUT && fs.appendFile(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);

  if (stages.includes('discover')) {
    const xml = await (await fetch(`${BUCKET_URL}/?prefix=bulk-data/dockets-&max-keys=1000`, {signal: AbortSignal.timeout(60000)})).text();
    if (args.date && !isQuarterEnd(args.date)) throw new Error('DATE_NOT_QUARTER_END');
    const a = newestQuarterlyArchive(xml, {date: args.date ?? null});
    if (!a) throw new Error('DISCOVER_FAILED no quarterly dockets archive in the listing');
    Object.assign(cp, {archive: a, discovered_at: new Date().toISOString()}); await save();
    console.log(JSON.stringify({discovered: a})); out('snapshot_date', a.date);
  }
  const a = cp.archive; if (!a) throw new Error('No discovered archive; run the discover stage');
  const file = path.join(work, `dockets-${a.date}.csv.bz2`), url = `${BUCKET_URL}/${a.key}`;
  const matchDir = path.join(work, 'match'), evDir = path.join(work, 'evidence'), ledger = path.join(work, 'projection');

  if (stages.includes('download')) {
    const head = await fetch(url, {method: 'HEAD'}); const size = Number(head.headers.get('content-length')), etag = (head.headers.get('etag') ?? '').replace(/"/g, '');
    if (!head.ok || !size || !etag) throw new Error('DOWNLOAD_HEAD_FAILED');
    if (a.size && a.size !== size) throw new Error(`HASH_MISMATCH listing size ${a.size} != object size ${size}`);
    let have = 0; try { have = (await fs.stat(file)).size; } catch { /* fresh */ }
    if (have !== size) await run('curl', ['-fL', '--retry', '5', '--retry-delay', '10', '-C', '-', '-o', file, url]);
    cp.verified = await verifyDownload(file, {size, etag}); cp.archive_sha256 = await sha256File(file); cp.archive_bytes = size; await save();
    console.log(JSON.stringify({downloaded: a.date, ...cp.verified, sha256: cp.archive_sha256}));
  }
  if (args['dry-run']) { console.log('dry run: stopping before any database call'); return; }
  const runId = runIdFor(a.date);
  if (stages.includes('open-run')) {
    const r = await rpc('corpus_gapfill_bulk_open_run_v1', {p_run: runId, p_scope: {source_system: 'courtlistener', contract: 'courtlistener-bulk-match/2', snapshot_date: a.date, archive_url: url, archive_sha256: cp.archive_sha256, private_only: true}});
    if (r.status === 'completed') { console.log(JSON.stringify({skip: 'run already completed', run_id: runId})); return; }
    cp.run_id = runId; await save(); console.log(JSON.stringify({run: r.run_id, status: r.status}));
  }
  if (stages.includes('match')) {
    await run('node', [path.join(gap, 'export-registry-targets.mjs'), path.join(work, 'registry.jsonl')]);
    await run('python3', [path.join(gap, 'match-docket-bulk.py'), '--bulk', file, '--targets', path.join(work, 'registry.jsonl'), '--out', matchDir, '--parallel', String(args.parallel ?? 4), '--source-url', url, '--snapshot-date', a.date, ...(args['python-deps'] ? ['--python-deps', args['python-deps']] : [])]);
    const receipt = JSON.parse(await fs.readFile(path.join(matchDir, 'receipt.json'), 'utf8'));
    if (receipt.archive_sha256 !== cp.archive_sha256) throw new Error('HASH_MISMATCH matcher saw a different archive sha256');
    cp.rows_scanned = receipt.rows_scanned; await save();
  }
  if (stages.includes('evidence')) {
    await run('node', [path.join(gap, 'build-bulk-evidence.mjs'), matchDir, path.join(work, 'registry.jsonl'), path.join(evDir, 'exact')]);
    await run('node', [path.join(gap, 'build-termination-note-evidence.mjs'), path.join(matchDir, 'matches.jsonl'), path.join(work, 'registry.jsonl'), path.join(evDir, 'exact/stage-bulk/docket-bulk-match.jsonl'), path.join(matchDir, 'receipt.json'), path.join(evDir, 'term')]);
  }
  if (stages.includes('land')) {
    const stage = path.join(evDir, 'term/delta');
    await run('node', [path.join(gap, 'send-staged.mjs'), '--provider=bulk', `--stage=${stage}`, `--run=${runId}`, '--apply']);
    await run('node', [path.join(gap, 'send-staged.mjs'), '--provider=bulk', `--stage=${stage}`, `--run=${runId}`, '--apply', '--verify']);
  }
  if (stages.includes('project')) {
    await fs.mkdir(ledger, {recursive: true});
    for (const phase of ['blanks', 'termination-note']) {
      await run('node', [path.join(gap, 'project-registry.mjs'), `--phase=${phase}`, `--decisions=${phase === 'blanks' ? path.join(evDir, 'exact') : path.join(evDir, 'term/merged')}`, `--ledger=${path.join(ledger, `ledger-${phase}.jsonl`)}`, '--apply']);
    }
  }
  if (stages.includes('finish')) {
    const r = await rpc('corpus_gapfill_bulk_finish_run_v1', {p_run: runId, p_status: 'completed', p_counts: {snapshot_date: a.date, rows_scanned: cp.rows_scanned ?? null}});
    console.log(JSON.stringify(r));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2)).catch(e => { console.error(`::error::${String(e.message ?? e).replace(/sb_secret_[A-Za-z0-9_]+/g, '[redacted]')}`); process.exitCode = 1; });
