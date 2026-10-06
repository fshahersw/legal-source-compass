// Supervisor for ONE frozen official-court queue (one court host): runs the existing hash-verifying transfer worker and the registration watcher
// with the host's pacing, restarts the worker after transient stops, and records what was registered. It reuses the pdf-backfill pipeline unchanged.
//   node --use-system-ca scripts/ingest/official-mdl/run-batch.mjs --manifest=<queues/b001-njd.queue.jsonl.manifest.json> --credentials=<ingest/preview credentials json>
//        [--delay-ms=<n>] [--run-dir=<dir>] [--max-restarts=3]
// Pacing: the host's robots Crawl-delay + 0.5 s when robots.txt asked for one (njd, paed, moed, jpml publish `Crawl-delay: 10`), else 2.5 s. One worker, one request at a time.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { disposition } from '../run-seeger-focus-pdf-batches.mjs';
import { resolveRunDir, parseArgs, readJsonl, appendJsonl } from './store.mjs';

const pause = ms => new Promise(r => setTimeout(r, ms));
const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

export function hostDelayMs(runDir, host, override = null) {
  if (override !== null) return Number(override);
  const robots = readJsonl(path.join(runDir, 'capture-index.jsonl')).filter(e => e.role === 'robots' && e.host === host).sort((a, b) => String(b.retrieved_at).localeCompare(String(a.retrieved_at)))[0];
  const crawl = robots?.robots_policy?.crawl_delay_s;
  return Math.max(2500, crawl ? Math.ceil(crawl * 1000) + 500 : 0);
}
const NODE_SYSTEM_CA = spawnSync(process.execPath, ['--use-system-ca', '-e', '0'], { encoding: 'utf8' }).status === 0;
function launch(script, values, log) {
  const fd = fs.openSync(log, 'a');
  const child = spawn(process.execPath, [...(NODE_SYSTEM_CA ? ['--use-system-ca'] : []), script, ...values], { windowsHide: true, stdio: ['ignore', fd, fd] });
  const done = new Promise((resolve, reject) => { child.once('error', e => { fs.closeSync(fd); reject(e); }); child.once('exit', (code, signal) => { fs.closeSync(fd); resolve(code ?? (signal ? 128 : 1)); }); });
  return { child, done };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runDir = resolveRunDir(args['run-dir']);
  const manifestFile = path.resolve(String(args.manifest));
  const manifest = readJson(manifestFile);
  if (!manifest || !['official-court', 'govinfo'].includes(manifest.provider)) throw Error('OFFICIAL_SOURCE_MANIFEST_REQUIRED');
  const credentials = String(args.credentials);
  const label = path.basename(manifest.queue).replace('.queue.jsonl', '');
  const repo = fileURLToPath(new URL('../../../', import.meta.url));
  const transferScript = path.join(repo, 'scripts/ingest/backfill-pdfs-to-supabase.mjs'), registrationScript = path.join(repo, 'scripts/admin/register-private-pdf-assets.mjs');
  const transfer = path.join(runDir, 'transfers', label), registration = path.join(runDir, 'registration', label), logs = path.join(runDir, 'logs');
  for (const d of [transfer, registration, logs]) fs.mkdirSync(d, { recursive: true });
  const delay = hostDelayMs(runDir, manifest.host, args['delay-ms'] ?? null);
  const stopFile = path.join(registration, 'transfer-exited.json'), progressFile = path.join(transfer, 'progress.json');
  const status = file => fs.writeFileSync(path.join(runDir, 'status-' + label + '.json'), JSON.stringify({ label, host: manifest.host, pid: process.pid, delay_ms: delay, ...file, at: new Date().toISOString() }, null, 1));
  const maxRestarts = Number(args['max-restarts'] ?? 3);
  let attempt = 0, idleRestarts = 0, outcome = null;
  for (;;) {
    attempt++;
    fs.rmSync(stopFile, { force: true });
    if (fs.existsSync(progressFile)) fs.renameSync(progressFile, path.join(transfer, 'progress.attempt-' + String(attempt - 1).padStart(3, '0') + '.json'));
    status({ state: 'transferring', attempt });
    const transferRun = launch(transferScript, ['--queue=' + manifest.queue, '--queue-sha256=' + manifest.sha256, '--cache=' + transfer, '--credentials=' + credentials, '--max-files=100000', '--concurrency=1',
      '--source-delay-ms=' + delay, '--worker-delay-ms=' + delay, '--pacing-file=' + path.join(runDir, 'pacing-' + manifest.host + '.json'), '--execute'], path.join(logs, label + '.transfer.log'));
    const registrationRun = launch(registrationScript, ['--transfers=' + transfer, '--out=' + registration, '--credentials=' + credentials, '--watch', '--stop-file=' + stopFile], path.join(logs, label + '.registration.log'));
    const exitCode = await transferRun.done.catch(() => 1);
    fs.writeFileSync(stopFile, JSON.stringify({ exited_at: new Date().toISOString(), exit_code: exitCode }));
    let registrationCode = await registrationRun.done.catch(() => 1);
    for (let flush = 0; ![0, 2].includes(registrationCode) && flush < 3; flush++) {
      await pause(30000);
      registrationCode = await launch(registrationScript, ['--transfers=' + transfer, '--out=' + registration, '--credentials=' + credentials], path.join(logs, label + '.registration.log')).done.catch(() => 1);
    }
    const progress = readJson(progressFile);
    if (progress?.processed > 0) idleRestarts = 0; else idleRestarts++;
    const next = disposition({ progress, exitCode, idleRestarts, maxIdleRestarts: maxRestarts });
    if (next.action === 'done') {
      const completion = readJson(path.join(registration, 'completion.json'));
      fs.writeFileSync(manifestFile + '.done.json', JSON.stringify({ completed_at: new Date().toISOString(), attempts: attempt, delay_ms: delay, progress, registration_exit_code: registrationCode, registration_completion: completion }, null, 1));
      // ledger of what this run registered (queue builders skip rows already registered with the same source record): only for fully registered batches
      if (completion && completion.rejected_receipts === 0) {
        const receipts = new Map(readJsonl(path.join(transfer, 'transfer-receipts.jsonl')).filter(r => r.state === 'cloud_verified' || r.state === 'dedup_matched').map(r => [r.provider + '|' + r.native_document_id, r]));
        for (const line of fs.readFileSync(manifest.queue, 'utf8').trim().split('\n')) {
          const row = JSON.parse(line), r = receipts.get(row.provider + '|' + row.native_document_id);
          if (r) appendJsonl(path.join(runDir, 'registered-official.jsonl'), { provider: row.provider, native_document_id: row.native_document_id, url: row.download_url, native_case_id: row.native_case_id, record_sha256: row.selected_source_record_sha256, sha256: r.sha256, bytes: r.bytes, storage_key: r.storage_key, object_origin: r.object_origin ?? null, label, registered_at: new Date().toISOString() });
        }
      }
      outcome = 'done'; break;
    }
    if (next.action === 'halt') {
      fs.writeFileSync(manifestFile + '.halted.json', JSON.stringify({ halted_at: new Date().toISOString(), attempts: attempt, reason: next.reason, progress, preserved_receipts: transfer, registration_exit_code: registrationCode }, null, 1));
      outcome = 'halted'; break;
    }
    status({ state: 'cooling_down', attempt, reason: next.reason, resume_after: new Date(Date.now() + next.cooldownMs).toISOString() });
    await pause(next.cooldownMs);
  }
  status({ state: outcome });
  console.log(JSON.stringify({ label, outcome, attempts: attempt }));
  if (outcome !== 'done') process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(e => { console.error(JSON.stringify({ fatal: String(e.message).slice(0, 300) })); process.exitCode = 1; });
